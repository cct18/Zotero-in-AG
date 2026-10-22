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

    print("\n>>> ALL SIDECAR API TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    test_sidecar_endpoints()
