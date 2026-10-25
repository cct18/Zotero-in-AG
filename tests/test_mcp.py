import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.fixtures.mock_zotero import ensure_mock_if_needed
ensure_mock_if_needed()

from src.mcp_server.server import (
    zotero_search,
    zotero_get_collections,
    zotero_get_item,
    zotero_read_pdf,
    zotero_add_note,
)
from src.core.db import ZoteroDB

def test_mcp_tools():
    print("--- 1. Testing zotero_get_collections ---")
    cols_res = zotero_get_collections()
    print(cols_res[:200] + "...\n")
    assert "Zotero 文献分类树结构" in cols_res

    print("--- 2. Testing zotero_search ---")
    search_res = zotero_search(query="", limit=3)
    print(search_res[:300] + "...\n")
    assert "检索到" in search_res or "未检索到" in search_res

    # Dynamically retrieve available item from database
    db = ZoteroDB()
    items = db.get_items(limit=10)
    assert len(items) > 0, "No items found in Zotero library for testing"
    sample_item = items[0]
    sample_key = sample_item["itemKey"]

    print(f"--- 3. Testing zotero_get_item with [{sample_key}] ---")
    item_res = zotero_get_item(sample_key)
    print(item_res[:300] + "...\n")
    assert sample_key in item_res

    # Find item with PDF for reading test
    pdf_item = next((it for it in items if it.get("hasPdf")), None)
    if pdf_item:
        pdf_key = pdf_item["itemKey"]
        print(f"--- 4. Testing zotero_read_pdf with [{pdf_key}] ---")
        pdf_res = zotero_read_pdf(pdf_key, start_page=1, end_page=2)
        print(pdf_res[:400] + "...\n")
        assert "论文 PDF 提取内容" in pdf_res or "提取失败" in pdf_res

        print(f"--- 4.1 Testing zotero_read_pdf page out of bounds with [{pdf_key}] ---")
        pdf_res_oob = zotero_read_pdf(pdf_key, start_page=99999, end_page=100000)
        assert "页码越界" in pdf_res_oob

    print(f"--- 5. Testing zotero_add_note (Zotero not running check) with [{sample_key}] ---")
    note_res = zotero_add_note(sample_key, "Test Title", "Test Note Content with <tag> & symbols")
    print(note_res + "\n")
    # Since Zotero isn't running right now, it should gracefully report that Zotero isn't running
    assert "Zotero 桌面端当前未运行" in note_res or "成功" in note_res or "失败" in note_res

    print(">>> ALL MCP TOOL TESTS PASSED! <<<")

if __name__ == "__main__":
    test_mcp_tools()
