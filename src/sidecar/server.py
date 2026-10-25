import os
import sys
from urllib.parse import quote
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from src.core.config import get_config
from src.core.zotero_api import ZoteroAPIClient
from src.domain.models import NoteCreateRequest, TranslateRequest, TestAiRequest, AnnotationCreateRequest
from src.services.validation import validate_8char_key
from src.services.catalog_service import CatalogService
from src.services.document_service import DocumentService
from src.services.annotation_service import AnnotationService
from src.services.translation_service import TranslationService

app = FastAPI(title="Zotero Antigravity Sidecar Hub")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$|^vscode-webview://.*",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

catalog_service = CatalogService()
document_service = DocumentService()
annotation_service = AnnotationService()
translation_service = TranslationService()
api = ZoteroAPIClient()

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(
        str(index_file),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
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
        tree = await catalog_service.get_collections_tree_async()
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
        items = await catalog_service.get_items_async(
            collection_key=collection_key, query=query, tag=tag, limit=limit, offset=offset, order_by=sort
        )
        return {"success": True, "count": len(items), "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/item/{item_key}")
async def get_item_detail(item_key: str):
    if not validate_8char_key(item_key):
        raise HTTPException(status_code=400, detail="Invalid item key format")
    item = await catalog_service.get_item_by_key_async(item_key)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"success": True, "item": item}

@app.get("/api/pdf/{attachment_key}")
async def get_pdf_file(attachment_key: str):
    if not validate_8char_key(attachment_key):
        raise HTTPException(status_code=400, detail="Invalid attachment key format")
    pdf_path = await document_service.resolve_pdf_path_async(attachment_key)
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF attachment file not found on disk")
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f"inline; filename=\"{attachment_key}.pdf\"; filename*=UTF-8''{quote(pdf_path.name)}",
        },
    )

@app.post("/api/locate/{item_key}")
async def locate_item(item_key: str):
    if not validate_8char_key(item_key):
        raise HTTPException(status_code=400, detail="Invalid item key format")
    return await api.locate_item_in_zotero_async(item_key)

@app.post("/api/note")
async def create_note(req: NoteCreateRequest):
    if not validate_8char_key(req.item_key):
        raise HTTPException(status_code=400, detail="Invalid item key format")
    return await api.create_item_note_async(
        parent_item_key=req.item_key,
        note_title=req.title,
        note_markdown=req.content,
        tags=req.tags,
    )

@app.post("/api/translate")
async def translate_text_post(req: TranslateRequest):
    return await translation_service.execute_translation(req)

@app.post("/api/test_ai_model")
async def test_ai_model(req: TestAiRequest):
    return await translation_service.test_ai_model(req)

@app.get("/api/annotations/{item_key}")
async def get_annotations(item_key: str):
    if not validate_8char_key(item_key):
        raise HTTPException(status_code=400, detail="Invalid item key format")
    return await annotation_service.get_annotations_for_item(item_key)

@app.post("/api/annotations/{item_key}")
async def save_annotation(item_key: str, ann: AnnotationCreateRequest):
    if not validate_8char_key(item_key):
        raise HTTPException(status_code=400, detail="Invalid item key format")
    return await annotation_service.save_annotation(item_key, ann)

@app.delete("/api/annotations/{item_key}/{annotation_id}")
async def delete_annotation(item_key: str, annotation_id: str):
    if not validate_8char_key(item_key):
        raise HTTPException(status_code=400, detail="Invalid item key format")
    res = await annotation_service.delete_annotation(item_key, annotation_id)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to delete annotation"))
    return res

def run_server(port: int = 23180):
    import uvicorn
    env_port = os.environ.get("ANTIGRAVITY_SIDECAR_WEB_PORT")
    actual_port = int(env_port) if env_port and env_port.isdigit() else port
    print(f"Starting Zotero Sidecar Hub on http://127.0.0.1:{actual_port}")
    uvicorn.run(app, host="127.0.0.1", port=actual_port, log_level="info")

if __name__ == "__main__":
    run_server()
