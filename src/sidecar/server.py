import os
import sys
from pathlib import Path
from typing import Optional
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

# Enable CORS for local iframe/webview interactions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(str(index_file))

@app.get("/api/health")
async def get_health():
    cfg = get_config()
    return {
        "status": "ok",
        "zotero_running": api.is_running(),
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
    return api.locate_item_in_zotero(item_key)

@app.post("/api/note")
async def create_note(req: NoteCreateRequest):
    res = api.create_item_note(
        parent_item_key=req.item_key,
        note_title=req.title,
        note_markdown=req.content,
        tags=req.tags,
    )
    return res

def run_server(port: int = 23180):
    import uvicorn
    # If environment variable ANTIGRAVITY_SIDECAR_WEB_PORT is passed, use it!
    env_port = os.environ.get("ANTIGRAVITY_SIDECAR_WEB_PORT")
    actual_port = int(env_port) if env_port else port
    print(f"Starting Zotero Sidecar Hub on http://127.0.0.1:{actual_port}")
    uvicorn.run(app, host="127.0.0.1", port=actual_port, log_level="info")

if __name__ == "__main__":
    run_server()
