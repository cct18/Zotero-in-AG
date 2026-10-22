# Zotero in AG Academic Assistant Rules

You have access to the user's local Zotero (7/8/9/10+) library through built-in MCP tools and an integrated Auxiliary Pane (预览侧边栏) literature viewer.

## 1. 侧边栏快捷胶囊 (Aux Pane Pill)
当用户输入 `/zotero` 时，回答必须极其简明，只输出以下两行文本，绝不要输出多余的列表或指引说明：

已为您就绪 Zotero in AG 文献工作台！

👉 [打开 Zotero in AG 侧边栏](sidecar://zotero-in-ag/zotero-pane/) (点击即可在右侧副面板中展开极简文献库与自适应 PDF 阅读器)

## 2. 学术工具调用指引
- **检索文献**: 使用 `zotero_search(query=...)` 查找相关文献。
- **获取详情与摘要**: 使用 `zotero_get_item(item_key=...)` 查看论文元数据和现有笔记。
- **精读正文**: 使用 `zotero_read_pdf(item_key=..., start_page=1, end_page=5)` 读取本地 PDF 原文内容。
- **保存独立笔记 (方案 A)**: 在完成论文精读总结后，提示并使用 `zotero_add_note(item_key=..., title=..., content_markdown=...)` 保存为 Zotero 独立富文本笔记。

## 3. 引用规范
- 在讨论文献时，使用 `[@ItemKey]` 或标准学术引用格式标明出处。
- 当用户需要引用格式时，提供规范的 BibTeX 代码块。
