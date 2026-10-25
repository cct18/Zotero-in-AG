import os
import sys
import re
import json
import asyncio
import tempfile
import logging
from pathlib import Path
from typing import Optional
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from src.core.db import ZoteroDB
from src.core.storage import StorageResolver
from src.core.zotero_api import ZoteroAPIClient
from src.core.config import get_config

app = FastAPI(title="Zotero Antigravity Sidecar Hub")

# Enable CORS restricted strictly to Antigravity webviews and local loopback origins
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$|^vscode-webview://.*",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

db = ZoteroDB()
storage = StorageResolver()
api = ZoteroAPIClient()

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

class NoteCreateRequest(BaseModel):
    item_key: str
    title: str
    content: str
    tags: Optional[list[str]] = None

class TranslateRequest(BaseModel):
    text: str
    engine: Optional[str] = "builtin" # "builtin" | "custom"
    api_base: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    prompt: Optional[str] = None

class TestAiRequest(BaseModel):
    api_base: Optional[str] = None
    api_key: str
    model: Optional[str] = None

class AnnotationCreateRequest(BaseModel):
    id: str
    pageNum: int
    color: str
    mode: str = "highlight"
    text: Optional[str] = None
    rects: list[dict[str, float]]
    createdAt: Optional[int] = None

_cache_lock = asyncio.Lock()

def _get_cache_file() -> Path:
    env_cache = os.environ.get("ZOTERO_IN_AG_CACHE_FILE")
    if env_cache:
        return Path(env_cache)
    gemini_dir = Path.home() / ".gemini" / "antigravity"
    if gemini_dir.exists():
        return gemini_dir / "zotero_annotations_cache.json"
    return Path.home() / ".zotero_in_ag_annotations.json"

def _load_cached_annotations_unlocked() -> dict[str, list[dict]]:
    cache_file = _get_cache_file()
    if cache_file.exists():
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logging.warning(f"Failed to read annotations cache: {e}")
            return {}
    return {}

def _save_cached_annotations_unlocked(data: dict[str, list[dict]]) -> bool:
    cache_file = _get_cache_file()
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", dir=str(cache_file.parent), delete=False, encoding="utf-8") as tf:
            json.dump(data, tf, ensure_ascii=False, indent=2)
            temp_name = tf.name
        os.replace(temp_name, cache_file)
        return True
    except Exception as e:
        logging.error(f"Failed to persist annotations cache to {cache_file}: {e}")
        return False

async def _get_cached_annotations_for_item(item_key: str) -> list[dict]:
    async with _cache_lock:
        return _load_cached_annotations_unlocked().get(item_key, [])

async def _save_annotation_atomic(item_key: str, ann_dict: dict) -> dict:
    async with _cache_lock:
        all_cached = _load_cached_annotations_unlocked()
        item_list = all_cached.setdefault(item_key, [])
        existing_idx = next((i for i, x in enumerate(item_list) if x.get("id") == ann_dict.get("id")), -1)
        if existing_idx >= 0:
            item_list[existing_idx] = ann_dict
        else:
            item_list.append(ann_dict)
        _save_cached_annotations_unlocked(all_cached)
        return ann_dict

async def _delete_annotation_atomic(item_key: str, annotation_id: str) -> bool:
    async with _cache_lock:
        all_cached = _load_cached_annotations_unlocked()
        if item_key in all_cached:
            all_cached[item_key] = [x for x in all_cached[item_key] if x.get("id") != annotation_id]
            _save_cached_annotations_unlocked(all_cached)
        return True

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(
        str(index_file),
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )

@app.get("/api/health")
async def get_health():
    cfg = get_config()
    zotero_running = await api.is_running_async()
    return {
        "status": "ok",
        "zotero_running": zotero_running,
        "data_dir": str(cfg.data_dir),
        "db_exists": cfg.sqlite_path.exists(),
        "storage_exists": cfg.storage_path.exists(),
    }

@app.get("/api/collections")
async def get_collections():
    try:
        tree = db.get_collections_tree()
        return {"success": True, "collections": tree}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/items")
async def get_items(
    collection_key: Optional[str] = Query(None),
    query: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    sort: str = Query("date_desc"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    try:
        items = db.get_items(
            collection_key=collection_key,
            query=query,
            tag=tag,
            limit=limit,
            offset=offset,
            order_by=sort,
        )
        return {"success": True, "count": len(items), "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/item/{item_key}")
async def get_item_detail(item_key: str):
    item = db.get_item_by_key(item_key)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"success": True, "item": item}

@app.get("/api/pdf/{attachment_key}")
async def get_pdf_file(attachment_key: str):
    if not attachment_key or not re.match(r"^[A-Za-z0-9]{8}$", attachment_key):
        raise HTTPException(status_code=400, detail="Invalid attachment key format")

    # Try resolving PDF file from storage/<attachment_key>
    pdf_path = storage.resolve_pdf_path(attachment_key)
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF attachment file not found on disk")

    from urllib.parse import quote
    ascii_filename = f"{attachment_key}.pdf"
    encoded_filename = quote(pdf_path.name)
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f"inline; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}",
        },
    )

@app.post("/api/locate/{item_key}")
async def locate_item(item_key: str):
    return await api.locate_item_in_zotero_async(item_key)

@app.post("/api/note")
async def create_note(req: NoteCreateRequest):
    res = await api.create_item_note_async(
        parent_item_key=req.item_key,
        note_title=req.title,
        note_markdown=req.content,
        tags=req.tags,
    )
    return res

def normalize_chat_endpoint(base_url: str) -> str:
    import urllib.parse
    url = (base_url or "").strip().rstrip('/')
    if not url:
        return "https://api.deepseek.com/v1/chat/completions"

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"不支持的协议 '{parsed.scheme}'，仅支持 http:// 或 https://")

    hostname = (parsed.hostname or "").lower()
    # 防范云端元数据窃取 (AWS/GCP/Azure link-local metadata 169.254.x.x)
    if hostname.startswith("169.254.") or hostname in ("metadata.google.internal", "instance-data"):
        raise ValueError("禁止访问链路本地/云平台元数据地址 (Link-local metadata)")

    if url.endswith("/chat/completions"):
        return url
    if url.endswith("/v1"):
        return f"{url}/chat/completions"
    return f"{url}/v1/chat/completions"

async def execute_translation(req_data: TranslateRequest) -> dict:
    """
    Core translation worker:
    1. If engine == 'custom' and api_key is present:
       - If short word/phrase: still queries Youdao for phonetics & dictionary definitions.
       - Calls the custom AI model (OpenAI-compatible format) for professional academic translation.
    2. If engine == 'builtin' (or no api_key):
       - Words: Youdao dictionary (ec + web_trans) with phonetics.
       - Sentences: Youdao AI Neural Machine Translation with Google fallback.
    """
    import urllib.parse
    cleaned = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', req_data.text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    if not cleaned:
        return {"success": False, "error": "文本为空"}

    words = cleaned.split()
    is_short = len(words) <= 3 and any(c.isalpha() for c in cleaned)

    usphone = ""
    ukphone = ""
    trs_list = []

    # 1. Look up phonetics & dictionary entries if short
    if is_short:
        try:
            url = f"https://dict.youdao.com/jsonapi?q={urllib.parse.quote(cleaned)}"
            async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                if resp.status_code == 200:
                    data = resp.json()
                    ec = data.get("ec", {})
                    w_list = ec.get("word", [])
                    if w_list:
                        w = w_list[0]
                        usphone = w.get("usphone") or ""
                        ukphone = w.get("ukphone") or ""
                        for tr in w.get("trs", []):
                            explain = tr.get("tr", [{}])[0].get("l", {}).get("i", [""])[0]
                            if explain:
                                trs_list.append(explain)

                    if not trs_list and "web_trans" in data:
                        for item in data["web_trans"].get("web-translation", []):
                            vals = [x.get("value") for x in item.get("trans", []) if x.get("value")]
                            k = item.get("key")
                            if vals:
                                trs_list.append(f"{k}: {', '.join(vals[:3])}")
        except Exception:
            pass

    # 2. Branch A: Custom AI Model Mode
    if req_data.engine == "custom" and req_data.api_key:
        try:
            ai_url = normalize_chat_endpoint(req_data.api_base or "")
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {req_data.api_key.strip()}",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            }
            system_prompt = req_data.prompt or "你是一位资深学术审稿专家，请将用户提供的学术英文文本翻译为地道、准确的学术中文，保留专业术语，直接输出翻译结果，不要输出任何多余解释。"
            ai_payload = {
                "model": req_data.model or "deepseek-chat",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": cleaned}
                ],
                "temperature": 0.3
            }
            async with httpx.AsyncClient(timeout=12.0, trust_env=False) as client:
                resp = await client.post(ai_url, json=ai_payload, headers=headers)
                if resp.status_code == 200:
                    res_json = resp.json()
                    ai_text = res_json["choices"][0]["message"]["content"].strip()
                    if ai_text:
                        full_text = ai_text
                        if trs_list and len(trs_list) <= 3:
                            full_text = f"【AI 译文】\n{ai_text}\n\n【词典释义】\n" + "\n".join(trs_list)
                        return {
                            "success": True,
                            "query": cleaned,
                            "is_word": is_short,
                            "usphone": usphone,
                            "ukphone": ukphone,
                            "translation": full_text,
                        }
                else:
                    return {"success": False, "error": f"自定义 AI 服务返回异常: HTTP {resp.status_code}"}
        except Exception as e:
            return {"success": False, "error": f"自定义 AI 模型调用失败: {str(e)}"}

    # 2. Branch B: Built-in Academic Engine Mode
    if is_short and trs_list:
        return {
            "success": True,
            "query": cleaned,
            "is_word": True,
            "usphone": usphone,
            "ukphone": ukphone,
            "translation": "\n".join(trs_list),
        }

    # Sentence / paragraph translation via Youdao AI Neural Machine Translation
    try:
        async with httpx.AsyncClient(timeout=4.0, trust_env=False) as client:
            resp = await client.post(
                "https://aidemo.youdao.com/trans",
                data={"q": cleaned, "from": "Auto", "to": "zh-CHS"},
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Referer": "https://ai.youdao.com/",
                }
            )
            if resp.status_code == 200:
                data = resp.json()
                trans = data.get("translation")
                if trans and isinstance(trans, list):
                    res_text = "".join(trans).strip()
                    if res_text:
                        return {
                            "success": True,
                            "query": cleaned,
                            "is_word": False,
                            "translation": res_text,
                        }
    except Exception:
        pass

    # Google Translate fallback
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q={urllib.parse.quote(cleaned)}"
        async with httpx.AsyncClient(timeout=2.5, trust_env=False) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            if resp.status_code == 200:
                res = resp.json()
                trans = "".join([part[0] for part in res[0] if part[0]]).strip()
                if trans:
                    return {
                        "success": True,
                        "query": cleaned,
                        "is_word": False,
                        "translation": trans,
                    }
    except Exception:
        pass

    return {"success": False, "error": "未能获取到释义，请检查网络或稍后重试"}

@app.post("/api/translate")
async def translate_text_post(req: TranslateRequest):
    return await execute_translation(req)

@app.post("/api/test_ai_model")
async def test_ai_model(req: TestAiRequest):
    if not req.api_key:
        return {"success": False, "error": "请先输入 API Key"}
    try:
        url = normalize_chat_endpoint(req.api_base or "")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {req.api_key.strip()}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
        payload = {
            "model": req.model or "deepseek-chat",
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 5
        }
        async with httpx.AsyncClient(timeout=8.0, trust_env=False) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                return {"success": True, "model": req.model or "deepseek-chat"}
            else:
                return {"success": False, "error": f"HTTP {resp.status_code}: {resp.text[:100]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/annotations/{item_key}")
async def get_annotations(item_key: str):
    """
    Returns both Zotero desktop DB annotations and user annotations created in Antigravity.
    """
    # 1. Load from Zotero SQLite DB
    db_annotations = []
    try:
        raw_db = db.get_annotations_for_item(item_key)
        for a in raw_db:
            pos = {}
            if a.get("position"):
                try:
                    pos = json.loads(a["position"])
                except Exception:
                    pass
            db_annotations.append({
                "id": f"zotero_{a['annotationId']}",
                "source": "zotero",
                "annotationType": a.get("annotationType", 1), # 1=highlight, 3=underline
                "color": a.get("color") or "#ffd400",
                "text": a.get("text") or "",
                "comment": a.get("comment") or "",
                "pageLabel": a.get("pageLabel"),
                "position": pos,
                "pageIndex": pos.get("pageIndex", 0),
                "rects": pos.get("rects", []),
            })
    except Exception:
        pass

    # 2. Load from local cache safely under lock
    cached = await _get_cached_annotations_for_item(item_key)

    return {
        "success": True,
        "item_key": item_key,
        "zotero_annotations": db_annotations,
        "local_annotations": cached,
    }

@app.post("/api/annotations/{item_key}")
async def save_annotation(item_key: str, ann: AnnotationCreateRequest):
    saved = await _save_annotation_atomic(item_key, ann.model_dump())
    return {"success": True, "annotation": saved}

@app.delete("/api/annotations/{item_key}/{annotation_id}")
async def delete_annotation(item_key: str, annotation_id: str):
    await _delete_annotation_atomic(item_key, annotation_id)
    return {"success": True}

def run_server(port: int = 23180):
    import uvicorn
    # If environment variable ANTIGRAVITY_SIDECAR_WEB_PORT is passed, use it!
    env_port = os.environ.get("ANTIGRAVITY_SIDECAR_WEB_PORT")
    actual_port = port
    if env_port:
        try:
            actual_port = int(env_port)
        except ValueError:
            actual_port = port
    print(f"Starting Zotero Sidecar Hub on http://127.0.0.1:{actual_port}")
    uvicorn.run(app, host="127.0.0.1", port=actual_port, log_level="info")

if __name__ == "__main__":
    run_server()
