import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.core.config import get_config
from src.core.db import ZoteroDB
from src.core.storage import StorageResolver
from src.core.pdf_extractor import PDFExtractor
from src.core.zotero_api import ZoteroAPIClient

def test_config():
    cfg = get_config()
    print("[Config] Data dir:", cfg.data_dir, "Exists:", cfg.data_dir.exists())
    print("[Config] SQLite:", cfg.sqlite_path, "Exists:", cfg.sqlite_path.exists())
    print("[Config] Storage:", cfg.storage_path, "Exists:", cfg.storage_path.exists())
    assert cfg.sqlite_path.exists()

def test_db_collections():
    db = ZoteroDB()
    tree = db.get_collections_tree()
    print(f"\n[DB] Found {len(tree)} root collections:")
    for c in tree:
        print(f"  - {c['name']} (Key: {c['key']}, Children: {len(c['children'])})")
    assert len(tree) > 0

def test_db_items():
    db = ZoteroDB()
    items = db.get_items(limit=5)
    print(f"\n[DB] Loaded {len(items)} items:")
    for it in items:
        authors = ", ".join(it.get("creators", []))
        print(f"  [{it['itemKey']}] {it.get('title', 'No Title')[:45]} | Authors: {authors[:30]} | Has PDF: {it['hasPdf']}")
    assert len(items) > 0

def test_pdf_resolution_and_text():
    db = ZoteroDB()
    resolver = StorageResolver()
    items = db.get_items(limit=10)
    pdf_items = [it for it in items if it.get("hasPdf")]
    print(f"\n[Storage & PDF] Testing {len(pdf_items)} items with PDF:")
    assert len(pdf_items) > 0

    first = pdf_items[0]
    attach_key = first["pdfAttachmentKey"]
    raw_path = first.get("pdfPath")
    pdf_path = resolver.resolve_pdf_path(attach_key, raw_path)
    print(f"  Resolved item [{first['itemKey']}] attachment [{attach_key}]: {pdf_path}")
    assert pdf_path is not None and pdf_path.exists()

    # Test PDF text extraction
    info = PDFExtractor.get_info(pdf_path)
    print(f"  PDF Info: {info['num_pages']} pages, Title: {info['title']}")
    extracted = PDFExtractor.extract_text(pdf_path, start_page=1, end_page=2, max_chars=1500)
    print(f"  Extracted {extracted['total_chars']} chars from page {extracted['start_page']} to {extracted['end_page']}")
    print("  Snippet:\n" + extracted["content"][:300] + "...")
    assert extracted["total_chars"] > 0

def test_zotero_api():
    client = ZoteroAPIClient()
    running = client.is_running()
    print(f"\n[API] Zotero desktop running check: {running}")

if __name__ == "__main__":
    test_config()
    test_db_collections()
    test_db_items()
    test_pdf_resolution_and_text()
    test_zotero_api()
    print("\n>>> ALL CORE TESTS PASSED SUCCESSFULLY! <<<")
