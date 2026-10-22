import json
import sys
from pathlib import Path
from typing import Optional

# Ensure project root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from mcp.server.mcpserver import MCPServer
from src.core.db import ZoteroDB
from src.core.storage import StorageResolver
from src.core.pdf_extractor import PDFExtractor
from src.core.zotero_api import ZoteroAPIClient

# Initialize MCP Server
app = MCPServer(
    name="zotero",
    instructions="Zotero Academic Assistant MCP Server. Provides tools for searching papers, reading PDF content, inspecting metadata, and saving reading notes back to Zotero.",
)

db = ZoteroDB()
storage = StorageResolver()
api = ZoteroAPIClient()

@app.tool()
def zotero_search(
    query: str = "",
    collection_key: str = "",
    tag: str = "",
    limit: int = 10,
) -> str:
    """
    Search papers in the user's local Zotero library by title, abstract, or author name.
    
    Args:
        query: Keywords to search across titles, abstracts, and authors.
        collection_key: Optional collection key to restrict search to a specific folder.
        tag: Optional tag name to filter items.
        limit: Maximum number of papers to return (default 10).
    """
    items = db.get_items(
        collection_key=collection_key or None,
        query=query or None,
        tag=tag or None,
        limit=min(50, max(1, limit)),
    )

    if not items:
        return f"未找到匹配的文献。检索条件: query='{query}', collection='{collection_key}', tag='{tag}'。"

    lines = [f"### 检索到 {len(items)} 篇文献：\n"]
    for i, it in enumerate(items, 1):
        key = it["itemKey"]
        title = it.get("title") or "（无标题）"
        authors = ", ".join(it.get("creators", [])) or "未知作者"
        date = it.get("date") or "未知年份"
        pub = it.get("publication") or ""
        has_pdf = "✅ 有 PDF 原文" if it.get("hasPdf") else "❌ 无本地 PDF"

        lines.append(f"**{i}. {title}**")
        lines.append(f"- **Key**: `{key}` | **年份**: {date} | **类型**: `{it.get('itemType')}`")
        lines.append(f"- **作者**: {authors}")
        if pub:
            lines.append(f"- **出版/期刊**: {pub}")
        lines.append(f"- **附件**: {has_pdf}")
        if it.get("doi"):
            lines.append(f"- **DOI**: `{it.get('doi')}`")
        lines.append("")

    lines.append("\n> 提示：可使用 `zotero_read_pdf(item_key='...')` 直接精读正文，或使用 `zotero_get_item(item_key='...')` 查看完整摘要。")
    return "\n".join(lines)

@app.tool()
def zotero_get_collections() -> str:
    """
    Get the complete hierarchical collections (folders) tree from the user's Zotero library.
    """
    tree = db.get_collections_tree()
    if not tree:
        return "文献库中当前没有创建任何分类集合（Collections）。"

    lines = ["### Zotero 文献分类树结构：\n"]

    def render_node(node: dict, indent: int = 0):
        prefix = "  " * indent + "- "
        lines.append(f"{prefix}📁 **{node['name']}** (Key: `{node['key']}`)")
        for child in node.get("children", []):
            render_node(child, indent + 1)

    for root_node in tree:
        render_node(root_node, 0)

    lines.append("\n> 提示：可以在 `zotero_search` 中传入 `collection_key` 来限定检索范围。")
    return "\n".join(lines)

@app.tool()
def zotero_get_item(item_key: str) -> str:
    """
    Get full metadata, abstract, authors, existing notes, and attachments for a specific paper.
    
    Args:
        item_key: The 8-character Zotero item key (e.g., 'DQGFST6U').
    """
    item = db.get_item_by_key(item_key)
    if not item:
        return f"错误：未找到 Key 为 `{item_key}` 的文献条目。"

    title = item.get("title") or "（无标题）"
    authors = ", ".join(item.get("creators", [])) or "未知作者"
    abstract = item.get("abstractNote") or "（无摘要）"
    date = item.get("date") or "未知"
    doi = item.get("DOI") or "无"
    url = item.get("url") or "无"
    pub = item.get("publicationTitle") or "无"
    tags = ", ".join(item.get("tags", [])) or "无"

    cols = ", ".join([f"{c['collectionName']} (`{c['key']}`)" for c in item.get("collections", [])]) or "根目录"
    pdfs = item.get("pdfAttachments", [])
    notes = item.get("notes", [])

    lines = [
        f"# {title}",
        f"- **Item Key**: `{item_key}`",
        f"- **作者**: {authors}",
        f"- **发表日期**: {date}",
        f"- **期刊/出版物**: {pub}",
        f"- **DOI**: `{doi}`",
        f"- **链接**: {url}",
        f"- **所在分类**: {cols}",
        f"- **标签**: {tags}",
        "",
        "## 摘要 (Abstract)",
        abstract,
        "",
        f"## PDF 附件 ({len(pdfs)} 个)",
    ]

    for p in pdfs:
        lines.append(f"- 📎 Attachment Key: `{p['attachmentKey']}` | 路径: `{p.get('path', '')}`")

    if notes:
        lines.append(f"\n## 现有笔记 ({len(notes)} 条)")
        for n in notes:
            lines.append(f"### 笔记: {n.get('title') or '未命名'}")
            lines.append(n.get("note", ""))

    return "\n".join(lines)

@app.tool()
def zotero_read_pdf(
    item_key: str,
    start_page: int = 1,
    end_page: int = 5,
) -> str:
    """
    Read and extract text from the PDF attachment of a paper.
    
    Args:
        item_key: The 8-character Zotero item key (e.g., 'DQGFST6U').
        start_page: Starting page number (1-indexed, default 1).
        end_page: Ending page number (inclusive, default 5). Maximum 10 pages per call.
    """
    # Restrict max pages per call to prevent prompt bloat
    if end_page < start_page:
        end_page = start_page
    if end_page - start_page > 9:
        end_page = start_page + 9

    att = db.get_pdf_attachment_for_item(item_key)
    if not att:
        return f"未找到文献 `{item_key}` 对应的本地 PDF 附件。请确认该条目是否已下载 PDF。"

    attach_key = att["attachmentKey"]
    raw_path = att.get("path")
    pdf_path = storage.resolve_pdf_path(attach_key, raw_path)

    if not pdf_path or not pdf_path.exists():
        return f"文献 `{item_key}` 的附件目录已找到 (`{attach_key}`)，但在磁盘上未检测到 PDF 实体文件。"

    try:
        extracted = PDFExtractor.extract_text(
            pdf_path=pdf_path,
            start_page=start_page,
            end_page=end_page,
            max_chars=25000,
        )
    except Exception as e:
        return f"读取 PDF 文件失败: {str(e)}"

    header = [
        f"### 论文 PDF 提取内容 (Key: `{item_key}`)",
        f"- **文件**: `{pdf_path.name}`",
        f"- **总页数**: {extracted['total_pages']} 页 | **当前读取**: 第 {extracted['start_page']} 至 {extracted['end_page']} 页",
        f"- **提取字符数**: {extracted['total_chars']} 字符",
    ]
    if extracted.get("is_truncated"):
        header.append("> ⚠️ 提示：因单次上下文限制，部分超长内容已做安全截断。如需精读后续章节，请指定 `start_page` 翻页读取。")

    header.append("\n" + extracted["content"])
    return "\n".join(header)

@app.tool()
def zotero_add_note(
    item_key: str,
    title: str,
    content_markdown: str,
) -> str:
    """
    Save an agent-generated literature review, summary, or critique as an independent rich-text Note attached to the paper in Zotero (Option A).
    
    Args:
        item_key: The 8-character Zotero item key (e.g., 'DQGFST6U').
        title: Title of the note (e.g. 'Agent 精读总结: 核心贡献与公式推导').
        content_markdown: The markdown content of the reading note.
    """
    res = api.create_item_note(
        parent_item_key=item_key,
        note_title=title,
        note_markdown=content_markdown,
    )
    if res.get("success"):
        return f"✅ {res.get('message')}\n笔记标题: **{title}**\n已安全存入本地 Zotero 10 并即时生效。"
    else:
        return f"❌ 保存笔记失败: {res.get('error')}"

@app.tool()
def zotero_add_tags(
    item_key: str,
    tags: list[str],
) -> str:
    """
    Add tags to a paper in Zotero (e.g. ['agent-reviewed', 'transformer', 'high-priority']).
    
    Args:
        item_key: The 8-character Zotero item key.
        tags: List of tag strings to attach.
    """
    res = api.add_tags_to_item(item_key, tags)
    if res.get("success"):
        return f"✅ {res.get('message')}"
    return f"❌ 添加标签失败: {res.get('error')}"

def main():
    """Run MCP server in stdio mode"""
    app.run()

if __name__ == "__main__":
    main()
