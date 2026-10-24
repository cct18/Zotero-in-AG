import sys
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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

    print("--- 7. Testing POST /api/locate/{key} ---")
    locate_res = client.post(f"/api/locate/{first_item['itemKey']}")
    print("Locate response:", locate_res.json())
    assert locate_res.status_code == 200
    assert "success" in locate_res.json()

    print("--- 8. Testing GET & POST /api/translate ---")
    trans_word = client.get("/api/translate?text=variation")
    assert trans_word.status_code == 200
    assert trans_word.json()["success"] is True
    assert "translation" in trans_word.json()
    print("Word translation response:", trans_word.json()["translation"][:40])

    trans_sent = client.post("/api/translate", json={
        "text": "The dominant sequence transduction models are based on neural networks",
        "engine": "builtin"
    })
    assert trans_sent.status_code == 200
    assert trans_sent.json()["success"] is True
    assert "translation" in trans_sent.json()
    print("Sentence POST translation response:", trans_sent.json()["translation"][:40])

    # Test /api/test_ai_model with empty key validation
    test_empty = client.post("/api/test_ai_model", json={"api_key": ""})
    assert test_empty.status_code == 200
    assert test_empty.json()["success"] is False

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

    print("\n>>> ALL SIDECAR API TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    test_sidecar_endpoints()
