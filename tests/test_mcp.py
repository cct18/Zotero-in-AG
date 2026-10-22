import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.mcp_server.server import (
    zotero_search,
    zotero_get_collections,
    zotero_get_item,
    zotero_read_pdf,
    zotero_add_note,
)

def test_mcp_tools():
    print("--- 1. Testing zotero_get_collections ---")
    cols_res = zotero_get_collections()
    print(cols_res[:200] + "...\n")
    assert "Zotero 文献分类树结构" in cols_res

    print("--- 2. Testing zotero_search ---")
    search_res = zotero_search(query="Language", limit=3)
    print(search_res[:300] + "...\n")
    assert "检索到" in search_res

    print("--- 3. Testing zotero_get_item ---")
    item_res = zotero_get_item("DQGFST6U")
    print(item_res[:300] + "...\n")
    assert "Language Models are Unsupervised Multitask Learners" in item_res

    print("--- 4. Testing zotero_read_pdf ---")
    pdf_res = zotero_read_pdf("DQGFST6U", start_page=1, end_page=2)
    print(pdf_res[:400] + "...\n")
    assert "论文 PDF 提取内容" in pdf_res
    assert "Page 1" in pdf_res

    print("--- 5. Testing zotero_add_note (Zotero not running check) ---")
    note_res = zotero_add_note("DQGFST6U", "Test Title", "Test Note Content")
    print(note_res + "\n")
    # Since Zotero isn't running right now, it should gracefully report that Zotero isn't running
    assert "Zotero 桌面端当前未运行" in note_res or "成功" in note_res

    print(">>> ALL MCP TOOL TESTS PASSED! <<<")

if __name__ == "__main__":
    test_mcp_tools()
