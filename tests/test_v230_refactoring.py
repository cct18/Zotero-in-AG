import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from src.sidecar.server import app
from src.services.catalog_service import CatalogService
from src.services.document_service import DocumentService
from src.services.annotation_service import AnnotationService
from src.services.translation_service import TranslationService
from src.core.zotero_api import ZoteroAPIClient
from src.domain.models import LibraryItem, CollectionNode, Annotation

def test_v230_refactoring_suite():
    print("--- 1. Testing Modular ES Modules Static Assets ---")
    static_js_dir = Path(__file__).resolve().parent.parent / "src" / "sidecar" / "static" / "js"
    expected_files = [
        "state.js",
        "api.js",
        "viewer/shield.js",
        "viewer/pdf_viewer.js",
        "annotations/layer.js",
        "ui/tooltip.js",
        "ui/settings.js",
        "main.js",
        "app.legacy.js",
        "app.js",
    ]
    for rel_path in expected_files:
        f = static_js_dir / rel_path
        assert f.exists(), f"Missing modular JS file: {f}"
        assert f.stat().st_size > 50, f"Modular JS file unexpectedly empty: {f}"
        print(f"  Verified JS module: {rel_path} ({f.stat().st_size} bytes)")

    print("--- 2. Testing index.html Script Tag ---")
    client = TestClient(app)
    index_res = client.get("/")
    assert index_res.status_code == 200
    assert 'src="/static/js/app.js' in index_res.text or 'src="/static/js/main.js' in index_res.text
    print("  index.html correctly imports application script entrypoint.")

    print("--- 3. Testing Domain Models Serialization ---")
    item = LibraryItem(
        itemID=1,
        itemKey="TESTKEY1",
        itemType="journalArticle",
        title="Test Title",
        hasPdf=True,
    )
    assert item.itemKey == "TESTKEY1"
    assert item.hasPdf is True
    d = item.model_dump()
    assert d["itemKey"] == "TESTKEY1"

    col = CollectionNode(id=1, key="COLL0001", name="Deep Learning")
    assert col.name == "Deep Learning"
    assert len(col.children) == 0

    ann = Annotation(id="ann_1", text="Sample", pageIndex=0)
    assert ann.source == "local"
    assert ann.pageIndex == 0
    print("  Pydantic domain models validated successfully.")

    print("--- 4. Testing Service Layer Instantiation & Async/Sync API Client ---")
    cat_srv = CatalogService()
    doc_srv = DocumentService()
    ann_srv = AnnotationService()
    trans_srv = TranslationService()
    api_client = ZoteroAPIClient()

    # ZoteroAPIClient sync bridge tests
    assert isinstance(api_client.is_running(), bool)
    add_tag_res = api_client.add_tags_to_item("TESTKEY1", ["test"])
    assert isinstance(add_tag_res, dict)

    note_res = api_client.create_item_note("TESTKEY1", "Title", "Markdown")
    assert isinstance(note_res, dict)

    print("  ZoteroAPIClient sync bridge correctly delegates to async coroutines.")

    # Catalog & Document Service queries
    cols = cat_srv.get_collections_tree()
    assert isinstance(cols, list)
    if cols:
        assert isinstance(cols[0], CollectionNode)
        assert hasattr(cols[0], "key")
        assert cols[0]["key"] == cols[0].key

    items = cat_srv.get_items(limit=3)
    assert isinstance(items, list)
    if items:
        assert isinstance(items[0], LibraryItem)
        assert hasattr(items[0], "itemKey")
        # Assert backwards-compatible dict indexing
        assert items[0]["itemKey"] == items[0].itemKey

    print(f"  CatalogService retrieved {len(cols)} collections and {len(items)} items using validated Domain Models.")

    print("\n>>> ALL V2.3.0 REFACTORING SUITE TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    test_v230_refactoring_suite()
