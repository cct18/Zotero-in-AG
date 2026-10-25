import sys
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.fixtures.mock_zotero import ensure_mock_if_needed
ensure_mock_if_needed()

from src.sidecar.server import app

def test_sidecar_endpoints():
    client = TestClient(app)

    print("--- 1. Testing GET /api/health ---")
    res = client.get("/api/health")
    print(res.json())
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["db_exists"] is True

    print("--- 2. Testing GET /api/collections ---")
    res = client.get("/api/collections")
    data = res.json()
    assert res.status_code == 200
    assert len(data["collections"]) > 0
    print(f"Collections count: {len(data['collections'])}")

    print("--- 3. Testing GET /api/items ---")
    res = client.get("/api/items?limit=5")
    data = res.json()
    assert res.status_code == 200
    assert len(data["items"]) > 0
    first_item = data["items"][0]
    print(f"First item: [{first_item['itemKey']}] {first_item.get('title')[:40]}")

    print("--- 4. Testing GET /api/item/{key} ---")
    res = client.get(f"/api/item/{first_item['itemKey']}")
    assert res.status_code == 200
    assert res.json()["item"]["itemKey"] == first_item["itemKey"]

    print("--- 5. Testing GET / (index.html) ---")
    res = client.get("/")
    assert res.status_code == 200
    assert "Zotero in AG" in res.text

    # Test PDF streaming if first item has PDF
    pdf_attach_key = first_item.get("pdfAttachmentKey")
    if pdf_attach_key:
        print(f"--- 6. Testing GET /api/pdf/{pdf_attach_key} ---")
        pdf_res = client.get(f"/api/pdf/{pdf_attach_key}")
        assert pdf_res.status_code == 200
        assert pdf_res.headers["content-type"] == "application/pdf"
        assert len(pdf_res.content) > 1000
        print(f"Streamed PDF successfully, size: {len(pdf_res.content)} bytes")

    print("--- 6.1 Testing Path Traversal Defense on /api/pdf ---")
    bad_pdf1 = client.get("/api/pdf/..%5Csomething")
    assert bad_pdf1.status_code in (400, 404)
    bad_pdf2 = client.get("/api/pdf/invalid_key_length")
    assert bad_pdf2.status_code == 400

    print("--- 7. Testing POST /api/locate/{key} ---")
    from unittest.mock import patch
    with patch("subprocess.Popen"), patch("src.core.zotero_api.ZoteroAPIClient._open_protocol_uri"):
        locate_res = client.post(f"/api/locate/{first_item['itemKey']}")
        print("Locate response:", locate_res.json())
        assert locate_res.status_code == 200
        assert "success" in locate_res.json()

    print("--- 8. Testing POST /api/translate and GET deprecation ---")
    # GET /api/translate should be rejected (405) to prevent API key query parameter leakage
    get_res = client.get("/api/translate?text=variation")
    assert get_res.status_code == 405

    trans_word = client.post("/api/translate", json={"text": "variation", "engine": "builtin"})
    assert trans_word.status_code == 200
    if trans_word.json().get("success"):
        assert "translation" in trans_word.json()
        print("Word POST translation response:", trans_word.json()["translation"][:40])
    else:
        print("Word POST translation returned network/fallback status:", trans_word.json().get("error"))

    trans_sent = client.post("/api/translate", json={
        "text": "The dominant sequence transduction models are based on neural networks",
        "engine": "builtin"
    })
    assert trans_sent.status_code == 200
    if trans_sent.json().get("success"):
        assert "translation" in trans_sent.json()
        print("Sentence POST translation response:", trans_sent.json()["translation"][:40])

    # Test /api/test_ai_model with empty key validation
    test_empty = client.post("/api/test_ai_model", json={"api_key": ""})
    assert test_empty.status_code == 200
    assert test_empty.json()["success"] is False

    # Test SSRF link-local cloud metadata defense (Standard, Integer, Hexadecimal variants)
    for bad_ssrf_host in ("http://169.254.169.254", "http://2852039166", "http://0xa9fe01a9"):
        test_ssrf = client.post("/api/test_ai_model", json={
            "api_base": f"{bad_ssrf_host}/latest/meta-data",
            "api_key": "dummy_key"
        })
        assert test_ssrf.status_code == 200
        assert test_ssrf.json()["success"] is False
        assert "链路本地" in test_ssrf.json().get("error", "") or "元数据" in test_ssrf.json().get("error", "")
    print("SSRF link-local cloud metadata endpoints (standard/int/hex) blocked successfully.")

    print("--- 9. Testing GET /api/annotations/{key} ---")
    ann_res = client.get(f"/api/annotations/{first_item['itemKey']}")
    assert ann_res.status_code == 200
    assert ann_res.json()["success"] is True
    assert "zotero_annotations" in ann_res.json()
    assert "local_annotations" in ann_res.json()
    print("Annotations count:", len(ann_res.json()["zotero_annotations"]))

    print("--- 10. Testing POST & DELETE /api/annotations ---")
    test_ann = {
        "id": "ann_test_123",
        "itemKey": first_item['itemKey'],
        "pageNum": 1,
        "color": "#ffd400",
        "mode": "highlight",
        "text": "test selection",
        "rects": [{"left": 10, "top": 10, "width": 100, "height": 20}],
        "createdAt": 123456789
    }
    save_res = client.post(f"/api/annotations/{first_item['itemKey']}", json=test_ann)
    assert save_res.status_code == 200
    assert save_res.json()["success"] is True

    del_res = client.delete(f"/api/annotations/{first_item['itemKey']}/ann_test_123")
    assert del_res.status_code == 200
    assert del_res.json()["success"] is True

    # Test rejecting deletion of read-only native Zotero annotations
    del_zotero_res = client.delete(f"/api/annotations/{first_item['itemKey']}/zotero_99999")
    assert del_zotero_res.status_code == 400
    assert "只读" in del_zotero_res.json().get("detail", "")
    print("Native Zotero annotation deletion rejection verified successfully.")

    print("--- 11. Testing /api/note 8-character Key Validation ---")
    bad_note_res = client.post("/api/note", json={
        "item_key": "invalid_too_long_key",
        "title": "Test Title",
        "content": "Test Note"
    })
    assert bad_note_res.status_code in (400, 422)
    print("/api/note key validation verified successfully.")

    print("\n>>> ALL SIDECAR API TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    test_sidecar_endpoints()
