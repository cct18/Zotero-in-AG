# Zotero in AG (Zotero Literature Hub for Google Antigravity)

[![Antigravity Plugin](https://img.shields.io/badge/Antigravity-Plugin-blue)](https://antigravity.google)
[![Python uv](https://img.shields.io/badge/Python-uv-purple)](https://astral.sh/uv)
[![Zotero 7+](https://img.shields.io/badge/Zotero-7%20%7C%208%20%7C%209%20%7C%2010+-red)](https://zotero.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

将 **Zotero 文献库原生嵌入 Google Antigravity (Agent)** 的全功能学术插件。以 Antigravity Agent 为研究枢纽，在预览侧边栏（Auxiliary Pane）中无缝阅读 PDF、检索文献、划选提问，并将 Agent 精读报告自动存回 Zotero 独立富文本笔记。

---

## ✨ 核心特性

1. **预览侧边栏原生集成 (Auxiliary Pane)**
   - 通过 `/zotero` 指令一键唤出侧边栏胶囊。
   - 树状展示本地 Collections 文献分类、实时模糊搜索、条目卡片。
   - 默认展示极简欢迎页，点击打开文献后自适应铺满主舞台。
2. **极速自适应 PDF 阅读器 (Continuous Scroll & Fit Width)**
   - 内置轻量离线 **Mozilla PDF.js**，支持本地 PDF 原文毫秒级加载。
   - **自然滚轮翻页**：视口惰性加载（IntersectionObserver），百页大论文平滑滚动，内存占用极低。
   - **自适应宽度**：切换侧边栏宽度时自动保持满幅阅读，动态显示当前缩放百分比。
3. **划选互动与双向桥梁 (Selection Action Tooltip)**
   - 在侧边栏 PDF 中划选公式、图表或难懂段落，弹出悬浮动作胶囊：
     - 💬 **问 Agent**：一键生成结构化上下文提问并发送给对话区。
     - 📋 **引用**：快速复制包含引文标注的 Markdown 引用文本与 BibTeX。
     - 🔗 **Zotero 定位**：一键调起本地 Zotero 桌面端并高亮选中条目。
4. **方案 A 独立富文本笔记联动 (Option A)**
   - Agent 深度研读文献后，调用 MCP 工具直接在 Zotero 该条目下创建层级 Rich-text Note 独立子笔记。
   - 绝不污染原版 PDF 文本，并在 Zotero 桌面端即时刷新。
5. **无锁高可用引擎 (Zero File Locks)**
   - 采用 `?mode=ro&immutable=1` 只读无锁连接与毫秒级连接释放机制。
   - 即使在 Windows 严格文件锁机制下，也能与 Zotero 桌面端并发共存，绝不阻塞 Zotero 启动。
6. **基于 `uv` 的极速现代后端 (Zero-Config)**
   - 依赖声明于 `pyproject.toml`，由 Rust 驱动的 `uv` 跨平台秒级就绪。
   - 自动跨平台探测 Windows、macOS 和 Linux 上的 Zotero 数据目录与安装位置。

---

## 📁 目录结构概览

```text
zotero-in-ag/
├── plugin.json                    # Antigravity 插件核心清单
├── mcp_config.json                # 内嵌 MCP 服务声明
├── pyproject.toml                 # uv 依赖管理定义
├── uv.lock                        # 跨平台依赖锁文件
├── LICENSE                        # MIT 开源许可证
├── README.md                      # 项目主页与说明
├── PROJECT_STRUCTURE.md           # 插件开发与架构设计文档
├── assets/
│   └── logo.svg                   # 插件 Logo 图标
├── rules/
│   └── AGENTS.md                  # 常驻学术规则与侧边栏快捷胶囊
├── skills/
│   └── zotero/
│       └── SKILL.md               # /zotero 技能与学术精读工作流
├── sidecars/
│   └── zotero-pane/
│       └── sidecar.json           # 声明 Auxiliary Pane 右侧副面板视图
├── src/
│   ├── core/                      # 核心数据访问层 (SQLite 无锁驱动, Storage, API)
│   ├── mcp_server/                # MCP 工具实现 (search, read_pdf, add_note 等)
│   └── sidecar/                   # FastAPI Web 服务与 Webview 前端
│       └── static/                # 侧边栏前端界面与本地离线 PDF.js 资源
└── tests/                         # 自动化集成测试套件
```

---

## 🚀 快速安装与配置

### 前置要求
1. 安装 [Google Antigravity 2.0+](https://antigravity.google)
2. 安装 [Zotero (7 / 8 / 9 / 10+)](https://www.zotero.org/)
3. 安装 Python 包管理工具 [uv](https://astral.sh/uv)（推荐）：
   - **Windows**: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
   - **macOS / Linux**: `curl -LsSf https://astral.sh/uv/install.sh | sh`

---

### 步骤 1：克隆本项目
```bash
git clone https://github.com/<your-username>/zotero-in-ag.git
cd zotero-in-ag
```

### 步骤 2：安装依赖
在项目根目录下运行：
```bash
uv sync
```

### 步骤 3：挂载到 Antigravity 全局插件目录
将本项目软链接（或复制）到 Antigravity 全局插件目录：

**Windows (PowerShell 管理员身份)**:
```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.gemini\config\plugins"
New-Item -ItemType SymbolicLink -Path "$HOME\.gemini\config\plugins\zotero-in-ag" -Target "$PWD"
```

**macOS / Linux**:
```bash
mkdir -p ~/.gemini/config/plugins
ln -s "$(pwd)" ~/.gemini/config/plugins/zotero-in-ag
```

### 步骤 4：重启 Antigravity
重启 Antigravity 客户端后，插件即自动生效！

---

## 💡 使用指南

1. **唤起侧边栏**：
   在 Antigravity 聊天框中输入：
   ```text
   /zotero
   ```
   点击输出中的胶囊即可在右侧展开文献工作台。
2. **沉浸式阅读布局**：
   按下快捷键 `Ctrl + B`（Mac 为 `Cmd + B`）收起 Antigravity 最左侧项目树，对话区与 Zotero in AG 工作台将自动以 **1 : 3** 的黄金比例平铺整个屏幕。
3. **查阅与翻页**：
   在左侧分类树点击目录选择论文，PDF 将自动自适应宽度铺满，使用鼠标滚轮即可自然连续翻页。
4. **与 Agent 协同精读**：
   - 直接在对话框让 Agent 调研主题：`“帮我检索关于 Transformer 架构的相关论文”`
   - Agent 会自动调用 MCP 工具列出文献、提取正文段落，并将研读结论作为**独立富文本笔记**保存回 Zotero。

---

## 🛠️ MCP 工具清单

| 工具名称 | 功能描述 | 核心入参 |
| :--- | :--- | :--- |
| `zotero_search` | 多维度检索论文（标题、作者、摘要模糊搜索） | `query`, `collection_key`, `tag`, `limit` |
| `zotero_get_collections` | 获取树状文献分类目录结构 | 无 |
| `zotero_get_item` | 获取完整元数据、作者、现有笔记与附件路径 | `item_key` |
| `zotero_read_pdf` | 自动提取本地 PDF 原文指定页码的纯文本内容 | `item_key`, `start_page`, `end_page` |
| `zotero_add_note` | 将 Agent 报告存为条目下的独立富文本笔记 (方案 A) | `item_key`, `title`, `content_markdown` |
| `zotero_add_tags` | 为论文打上学术或分类标签 | `item_key`, `tags` |

---

## ⚙️ 高级配置 (可选环境变量)

本插件内置了智能探测机制，绝大多数用户**无需任何配置即可开箱即用**。如您的 Zotero 安装在特殊自定义路径，可通过环境变量覆盖：

| 环境变量 | 默认探测行为 | 说明 |
| :--- | :--- | :--- |
| `ZOTERO_DATA_DIR` | 自动探测 `~/Zotero` 或常见自定义数据目录 | Zotero 数据目录（包含 `zotero.sqlite` 和 `storage/`） |
| `ZOTERO_APP_DIR` | 自动探测系统标准安装路径（如 `Program Files/Zotero`） | Zotero 客户端安装路径（包含可执行程序） |
| `ZOTERO_LOCAL_API_URL` | `http://127.0.0.1:23119` | Zotero 本地 HTTP 服务地址 |

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 开源协议。
