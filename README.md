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
   - **极简发表时间排序**：目录栏右上角提供极简图标，一键在论文发表年份（新 ➔ 旧 / 旧 ➔ 新）之间即时切换。
   - **全格式文献兼容**：完整支持标准文献条目与未挂靠父条目的**独立 PDF**，智能识别并标注 `[PDF]`。
   - 默认展示极简欢迎页，点击打开文献后自适应铺满主舞台。
2. **极速自适应 PDF 阅读器与动态选区护盾 (PDF.js & Selection Shield)**
   - 内置轻量离线 **Mozilla PDF.js**，支持本地 PDF 原文毫秒级加载。
   - **自然滚轮翻页**：视口惰性加载（IntersectionObserver），百页大论文平滑滚动，内存占用极低。
   - **自适应宽度**：切换侧边栏宽度时自动保持满幅阅读，动态显示当前缩放百分比。
   - 🛡️ **Zotero 同款动态选区护盾 (Selection Shield)**：集成 `endOfContent` 动态拦截与智能词边界吸附，彻底杜绝划词时光标进入行尾留白导致向后跳选下方多段。
3. **划选标记、即时释义与双向桥梁 (Selection Action Tooltip & Annotation)**
   - 在侧边栏 PDF 中划选正文段落，弹出极简悬浮工具栏：
     - 🎨 **Zotero 同款 8 色高亮与下划线**：复刻原生 8 色标记色盘，支持 `[A]` 高亮与 `[A_]` 下划线双模标记，实时在视口中保持贴合缩放，并直接直读 Zotero 历史批注。
     - 🔤 **即时查词与自定义 AI 翻译**：集成美音/英音国际音标、纯发音播报（Web Speech API）与精选词义；长句学术翻译；支持免配置内置引擎及自定义接入任意 OpenAI 格式大模型（如 DeepSeek、OpenAI、Claude 等）。
     - 💬 **纯矢量问 Agent**：纯矢量图标一键生成结构化上下文提问并发送给对话区。
     - 📋 **纯矢量引用**：纯矢量图标快速复制包含引文标注的 Markdown 引用文本与规范 BibTeX。
     - 悬浮窗内图标鼠标悬浮不显示多余文本描述，小巧清爽不挡视线。
4. **方案 A 独立富文本笔记联动 (Option A)**
   - Agent 深度研读文献后，调用 MCP 工具直接在 Zotero 该条目下创建层级 Rich-text Note 独立子笔记。
   - 针对独立 PDF，笔记自动直接保存在所属分类目录中，条理清晰且绝不污染原版 PDF。
5. **高度可定制外观、Prompt 与翻译模型中心 (Settings Hub)**
   - 顶部提供原生设置中心，包含【外观】、【提示词】与【翻译】三大板块：
     - **外观**：支持白天/黑夜模式、5 种个性化强调色（边框高亮联动反馈）与 PDF 护眼暖黄/暗调反色阅览底色；
     - **提示词**：支持自由配置整文 Ask 与划词 Ask 的 Agent 提示词模板（支持 `{title}`、`{authors}`、`{year}`、`{selected_text}` 动态插槽）；
     - **翻译**：支持在免配置引擎与自定义 AI 模型间一键切换，自定义 Base URL、API Key、Model 及专属学术翻译 System Prompt，支持一键连通性测试。
6. **无锁高可用引擎 (Zero File Locks & WAL Real-time Sync)**
   - 采用 `?mode=ro` 只读连接、WAL 实时感知与退避重试机制。
   - 即使在 Windows 严格文件锁机制下，也能与 Zotero 桌面端并发共存，绝不阻塞 Zotero 启动。
7. **基于 `uv` 的极速现代后端 (Zero-Config)**
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
├── CHANGELOG.md                   # 插件全版本更新日志 (SemVer 规范)
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
│   ├── domain/                    # 领域契约模型 (LibraryItem, Annotation 等 Pydantic 模型)
│   ├── services/                  # 统一应用服务层 (Catalog, Document, Annotation, Translation)
│   ├── core/                      # 底层驱动与基础设施 (SQLite, Storage, API)
│   ├── mcp_server/                # MCP 工具协议层 (search, read_pdf, add_note 等)
│   └── sidecar/                   # FastAPI Web 服务与原生 ES Modules 前端
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
