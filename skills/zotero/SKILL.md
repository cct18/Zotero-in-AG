---
name: zotero
description: 唤起 Zotero in AG 侧边栏，进行文献阅读、检索、管理与论文精读。
---

# Zotero in AG Skill

当用户输入 `/zotero` 时，只回复：

已为您就绪 Zotero in AG 文献工作台！

👉 [打开 Zotero in AG 侧边栏](sidecar://zotero-in-ag/zotero-pane/) (点击即可在右侧副面板中展开极简文献库与自适应 PDF 阅读器)

不要附带“快捷操作与研究指引”部分。

## 学术工作流
1. 用户要求搜索时，调用 `zotero_search(query="...")`。
2. 用户要求精读时，调用 `zotero_read_pdf(item_key=..., start_page=1, end_page=5)`。
3. 用户要求保存笔记时，调用 `zotero_add_note(item_key=..., title="...", content_markdown=...)`。
