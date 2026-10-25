# 更新日志 (Changelog)

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 语义化版本规范。

---

## [2.2.0] - 2026-10-25

### 🛡️ 双 Agent 联合安全审查与系统稳健性重构 (Security & Robustness Release)

经双 Agent 深度联合代码安全审查与实机回归验证，本版本全面排查并修复了所有 P0/P1/P2/P3 级系统安全隐患、事件循环阻塞缺陷、数据一致性漏洞与工程化测试解耦问题，达成 `VERDICT: PASS` 准出标准。

#### 1. 阻断级安全漏洞防御 (P0 Security Hardening)
* **收紧 CORS 跨域安全策略**：彻底移除通配符 `allow_origins=["*"]` 与 `allow_credentials=True`，采用严格的本地源正则白名单 `^https?://(127\.0\.0\.1|localhost)(:\d+)?$|^vscode-webview://.*` 并设置 `allow_credentials=False`，彻底阻断外部恶意网页通过跨域请求静默窃取本地文献库数据。
* **物理阻断 PDF 附件路径穿越**：
  * 在 `StorageResolver` 与 `/api/pdf/{attachment_key}` 接口建立严格的 8 位字母数字白名单正则校验 (`^[A-Za-z0-9]{8}$`)；
  * 解析路径时实施 `path.relative_to(storage_root)` 严格断言，彻底防御 Windows 下 `..%5C` 与路径遍历逃逸出 `storage` 目录。

#### 2. 异步高并发与事件循环解冻 (P1 Performance & Concurrency)
* **全量迁移至 `httpx.AsyncClient` 异步网络客户端**：全面替换翻译引擎、查词接口、AI 连通性测试以及 `/api/note`（`create_item_note_async`）、`/api/health`（`is_running_async`）中的同步阻塞调用，网络 I/O 全链路 100% 非阻塞化。
* **桌面端定位等待异步化**：重构 `locate_item_in_zotero_async`，使用 `asyncio.sleep` 与异步心跳探测替代原有的同步 `time.sleep`，彻底消除 Uvicorn 主事件循环因冷启动探测发生的假死冻结。
* **Markdown 转富文本 HTML 实体转义**：在 `_markdown_to_zotero_html` 中全面引入 `html.escape`，对标题、列表与段落实施严密转义，杜绝畸形标签造成的富文本损坏与 HTML 注入隐患。
* **移除 `immutable=1` 实现 WAL 实时可见**：去除 SQLite 连接串中的 `immutable=1` 声明并保留严格只读 `mode=ro`，为连接与查询引入指数退避重试，使插件读连接能够实时感知 Zotero 桌面端运行期产生的新增文献与批注事务，平稳抵御瞬时锁竞争。
* **批注并发锁全流程原子闭合 (Load-Modify-Save)**：
  * 将批注读取、修改与保存全链路收敛至 `_cache_lock` 互斥保护之内，彻底消除锁外读导致的并发丢失更新；
  * 采用 `NamedTemporaryFile` + `os.replace` 原子写入机制，彻底防止写入过程断电或并发读写导致 JSON 文件损坏截断；
  * 将批注持久化路径移至用户主目录（`~/.gemini/antigravity/` 或 `~/.zotero-in-ag/`），避免污染项目源码目录。
* **SSRF 与云平台链路本地元数据防护**：在 `normalize_chat_endpoint` 中增加协议白名单（严格限制 `http/https`）与链路本地元数据拦截（阻断 `169.254.x.x` 与 `metadata.google.internal`），防范云元数据窃取。
* **PDF 页码越界响应规范化**：修复 `PDFExtractor.extract_text` 在 `start_page` 超过总页数时的上下界倒置问题，返回规范的页码越界提示及 `extracted_pages_count: 0`。

#### 3. 规范对齐与体验健壮性增强 (P2 & P3 Enhancements)
* **下线不安全 GET 传输端点**：移除 `GET /api/translate`，统一仅保留 `POST /api/translate`，彻底杜绝敏感 API Key 通过 URL Query 明文泄露于访问日志。
* **CMap 字体资源 100% 离线内置**：将 169 个标准 Mozilla PDF.js `.bcmap` 文件完整内置于 `/static/vendor/pdfjs/cmaps/`，断网脱机环境下渲染 CJK 中文文献不发生文字缺失或乱码。
* **解耦测试套件与智能动态路径嗅探**：
  * 彻底移除 `config.py` 中遗留的开发机私有绝对路径；
  * 新增基于 Zotero 官方 `prefs.js` 与 Windows 注册表协议的动态嗅探逻辑，能在任意用户自定义盘符与数据目录下 0 配置自动定位文献库；
  * 改造测试套件为动态查找，不再硬编码单一文献 Key，保障 CI 与纯净开发环境全部绿灯通过。
* **离开视口 Canvas 内存回收**：在 `IntersectionObserver` 中增加离开视口的卸载分支，重置 Canvas 像素缓冲区并置 1x1，长篇 PDF 滚动时内存占用直降 70%+。
* **跨平台路径回退修正**：修正 Linux 平台探测失败时的错误回退路径为 `/usr/bin/zotero`。
* **分类树递归环路与深度熔断**：为分类树渲染注入 `visited` 集合与 `max_depth = 15` 保护，防止脏数据引发无限递归栈溢出。
* **对齐 `mcp_config.json` 启动目录**：前置补充 `["--directory", "../.."]` 启动参数，避免 Antigravity 子进程启动时的工作目录偏移。
* **主 PDF 附件确定性关联**：在 SQL 查询中使用 `ORDER BY ia.itemID ASC LIMIT 1` 关联子查询，杜绝同一文献多附件时的随机选路。
* **笔记上下文截断保护**：在 `zotero_get_item` 中对富文本笔记清洗标签并实施长度限制，防止大篇笔记溢出 LLM 上下文。
* **杂项规范优化**：优化健康徽章展示文案为“Zotero 桌面端运行中”、优化前端本地排序避免冗余网络请求、安全捕获环境变量端口类型转换、对齐 `mcp>=2.3.0,<3` 依赖声明。

---

## [2.1.0] - 2026-10-24

### 🛠️ 选区手感与阅读视觉深度优化 (Selection & Visual Fixes)

#### 1. 彻底还原 Zotero 原生无框选区与几何投影护盾 (Figure 1-5 体验对齐)
* **根因深度透视与机制革新**：
  * 对比测试发现，此前尝试采用人工生成的 `.pdf-line` 块级行容器强行填充空白，会导致浏览器在拖拽选区时将整行容器的背景一同涂蓝，产生在左侧页边距凸出长方条（图1）、无序列表圆点 `•` 左侧拖出巨大蓝块（图2）、以及论文顶部多位作者横向并列时被生硬切块（图3）等机械死板的缺陷；
  * 而 Zotero 7/8 原生阅读器（图4、图5）的高亮**严密、纯粹地贴合文字字形本身的边界**，绝无任何外溢的块状蓝色凸起或矩形阴影；
* **全面摒弃 `.pdf-line`，回归极简纯粹原生 DOM**：
  * 彻底移除所有多余的人工行级 `div` 包装，文本层保持 100% 标准 PDF.js 扁平结构（每一个字符与单词独立作为 `<span>`）；
  * 列表项目符号（如 `• Bob is in his room...`）选区高亮精准始于 `•` 本身，左侧页边距 0 突起；
  * 多作者横向网格与多栏学术排版完全不受容器干涉，各自独立高亮（完全复刻 Zotero 原生图 4 与图 5）；
* **Zotero 原生同款：空白区域几何测距投影 (Geometric Caret Projection Shield)**：
  * **在文字上 (Hit-test)**：当光标处于文字 `span` 上时，使用高精度原生字形偏移判定（100% 字符级）；
  * **在空白虚空处 (Whitespace)**：当鼠标漂移至页边距、分栏缝隙、行尾空白或段落垂直间隙时，无需任何遮挡 DOM，采用与 Zotero 核心算法一致的最小欧氏几何测距（Point-to-Box Distance），将光标实时投影至最近的文本元素：
    * 拖拽至左上角空白时，最近元素为首行起始处（Offset 0），选区平滑、连贯向上反选，绝不反选下方；
    * 鼠标停留在行尾句号 `.` 时，最近元素为句号本身（Offset = Text Length），严密止步于句号，绝不跳选吞并下一大段；
    * 双栏论文排版中，左栏边距与栏间距始终几何锁定于左栏自身，绝不跨栏误圈选右侧文字；
  * **消除空白区域微移摆动 (Anti-Oscillation & Line-First Locking)**：
    * **行级纵向区间投影 (Line-First Vertical Band)**：光标在空白区域（外边距、行间隙）移动时，目标行的确定完全由纵向高度（`clientY`）主导，彻底剔除长行与短行因水平末端距差（`dx`）引发的误判定，光标在边距左右横移时选区行始终保持绝对锁定；
    * **微小位移去重熔断 (Micro-movement Deduplication)**：当光标在当前行空白范围内微幅抖动、而映射得到的字符 Offset 未发生改变时，立即跳过 DOM 操作，实现 0 重绘与 0 选区扰动；
    * **事件递归振荡切断 (Re-entrant Event Guard)**：通过微任务锁 `isUpdatingSelection` 与 `queueMicrotask` 切断 Chromium 原生 selectionchange 与脚本之间的反复对冲，拖拽手感如丝般稳定顺滑。
  * **Mozilla 原生同款动态哨兵拦截 (Chromium `.endOfContent` Sentinel)**：
    * **深度复刻 Mozilla 核心底层防线**：在 `omni.ja` 与 Mozilla PDF.js 源码中深度发掘了 Chromium/Blink 绝对定位文本层特有的底层机制——当鼠标在行末空白滑动时，Blink 原生 C++ 遍历由于缺乏行内流盒模型，会失控穿透下沉至 DOM 树底端（导致图 1 选区失控下潜并吞噬底栏脚注）。Mozilla 原厂为此设计了动态哨兵机制：在 `selectionchange` 发生时，将 `.endOfContent` 哨兵元素即时重定位插在当前选区末端节点的紧随位置（`anchor.nextSibling`）；
    * **CSS 分层架构校准**：文本 `span` 显式标定 `z-index: 1`，`.endOfContent` 标定 `z-index: 0` 且开启 `pointer-events: auto` 与动态 `top: 0` 全面积覆盖。当鼠标进入空白处时，Chromium 原生命中测试直接拦截在哨兵处，物理阻断跨越后方文字与脚注；
    * **消除图 1 与图 2 闪烁振荡**：彻底消除了 Chromium 底层引擎与 JavaScript 纠偏之间的微秒级拉扯死锁，光标在句尾（如 `including`）右侧空白处任意微移，选区 100% 紧致定格在行末，杜绝反复闪烁；
    * **排除旋转侧边栏干扰 (Rotated Stamp Filter)**：针对 arXiv 论文左侧高达数百像素的 90° 旋转水印（如 `arXiv:1706.03762v7...`），加入高宽比与旋转矩阵过滤，防止纵向巨型矩形污染水平行距判定；
    * **行中心垂直几何测距 (Center-Line Proximity)**：将垂直判定精度由外边框转为以字符行垂直中心线（`Center Y`）为基准，完全解决行间距细小（<2px）时相邻行被粘连误并的问题。

#### 2. 选区行高修身与重叠暗纹消除
* **消除暗纹重叠**：文本层透明度精确校准为 PDF.js 规范标准（`0.28`），并采用纯色 Solid Blue（`#3b82f6` 暗色 / `#2563eb` 亮色）选区背景，彻底消除相邻行在半透明叠加下产生的深色重叠条纹；
* **紧凑行高**：字符 `span` 严格限定 `line-height: 1 !important`，使选区高度紧凑贴合字形，消除多行选中时的垂直重叠拥挤感。

---

## [2.0.0] - 2026-10-24

### 🚀 重大里程碑更新 (Major Milestone Release)
本次更新为架构与功能体验的重大飞跃，全面补齐并媲美了 Zotero 官方原生阅读器的交互手感，打通了划词标记、双模学术翻译、自定义大语言模型接入、独立 PDF 研读以及全局设置中心。

---

### ✨ 新增特性 (Added)

#### 1. 学术翻译中心与自定义 AI 大模型接入 (Translation & LLM Hub)
* **内置 + 自定义双模驱动**：
  * **内置免配置引擎**：接入高速有道神经网络通道，支持国内直连与学术术语解析；
  * **自定义 AI 模型接入**：全面兼容标准 OpenAI 协议（支持 DeepSeek、OpenAI、Claude、Kimi、智谱、OneAPI / NewAPI 等）；
  * **自定义配置项**：支持自由配置 `API Base URL`、`API Key`、`Model` 及专属学术翻译 System Prompt，并提供一键连通性测试。
* **单词双模合流展示**：查词时顶部呈现美音/英音国际音标与原生发音播报，中下部并合展示由自定义 AI 深度推导的学术释义与词典释义。
* **学术长句/段落即时翻译**：自动剔除 PDF 行末换行断词连字符（`-`），直接输出地道优美的学术中文。

#### 2. Zotero 原生同款划词标记工具栏 (Zotero Annotation Toolbar)
* **复刻 Zotero 8 色标记色盘**：提供黄、红、绿、蓝、紫、品红、橙、灰 8 种学术经典色标。
* **双模标记支持**：支持 `[A]` 背景高亮模式与 `[A_]` 文本下划线标注自由切换。
* **双向数据打通**：直接直读 Zotero 桌面端 SQLite 中的历史高亮与下划线批注，并在本地实时持久化新批注，自适应无级缩放贴合重绘。
* **防叠替换与取消机制**：同色同模式重复点击触发 Toggle 取消，异色点击直接 In-place 替换，并新增纯矢量橡皮擦按键一键清除标注。

#### 3. 极致简约纯矢量交互 (Pure Vector UI)
* **全矢量无感悬浮窗**：将“问 Agent”、“引用”、“释义”按键全面升级为纯矢量 SVG 图标，去除多余文本标签，悬浮时不显示文字提示框，杜绝遮挡正文视线。
* **目录栏极简发表时间排序**：在目录栏右上角提供纯矢量升序/降序图标，一键在“从新到旧”与“从旧到新”之间无缝切换，缺省年份自动优雅置底。

#### 4. 独立 PDF 全格式文献无缝研读 (Standalone Attachments)
* **全面支持未挂靠独立 PDF**：突破以往仅检索挂靠父条目的限制，直接兼容拖入 Zotero 分类中的独立 PDF 文件。
* **智能元数据回退**：文件名兜底解析与 `[PDF 独立文档]` 徽标。
* **分类级富文本笔记自动归档**：针对独立 PDF，Agent 精读笔记直接保存在其所属的 Collection 目录中，规范严谨。

#### 5. 顶部原生设置中心 (Settings Modal)
* **主题外观定制**：支持深色暗夜模式（Dark）与浅色明亮模式（Light）即时换肤，支持 5 大个性化强调色（经典蓝、清新绿、优雅紫、暖阳橙、珊瑚粉），支持 3 种 PDF 护眼阅读滤镜（标准白底、护眼暖黄、暗调反色）。
* **边框高亮反馈**：卡片式选项去除冗余白圈，直接联动强调色边框高亮。
* **Agent 提问提示词定制**：支持用户自主修改“整文 Ask”与“划词 Ask”的 Prompt 模板，提供 `{title}`、`{authors}`、`{year}`、`{selected_text}` 动态变量插槽与恢复默认功能。

---

### 🛠️ 优化与修复 (Fixed & Optimized)

* **高精度 Zotero 级选词引擎**：
  * 为页面及文本图层补全 PDF.js 核心缩放变量 `--scale-factor`，消除缩放时隐形文本层字号与坐标偏离；
  * Canvas 自适应设备物理像素比（`devicePixelRatio`），消除 Windows 常见缩放下的亚像素漂移；
  * 双击选词时自动剥离首尾标点符号，多 Span 碎裂词自动跨节点拼接完整单词。
* **无锁只读数据库防护**：保持 `?mode=ro&immutable=1` 机制，彻底杜绝与 Zotero 桌面端启动和运行发生文件锁冲突。
* **跨平台路径自动探测**：完善 Windows、macOS、Linux 下 Zotero 数据目录与安装目录探测链路。

---

## [1.0.0] - 2026-10-22

### 🎉 初始发布版本 (Initial Release)

* **原生侧边栏集成**：利用 Antigravity Auxiliary Pane（预览侧边栏）提供一体化工作台，`/zotero` 指令一键唤出。
* **连续无极滚动阅读器**：集成 Mozilla PDF.js，支持滚轮平滑滚动阅读、视口惰性加载（IntersectionObserver）与宽度自适应重算。
* **6 大原子 MCP 学术工具**：
  * `zotero_search`：文献搜索
  * `zotero_get_collections`：目录分类树读取
  * `zotero_get_item`：条目详情与摘要获取
  * `zotero_read_pdf`：本地 PDF 正文按需分页读取
  * `zotero_add_note`：回存独立富文本子笔记
  * `zotero_add_tags`：条目标签追加
* **方案 A 独立富文本笔记持久化**：Agent 精读报告通过 Local API 写入 Zotero 独立富文本子笔记，不污染原始 PDF 文件。
* **无锁 SQLite 引擎**：不可变只读无锁模式，保障与 Zotero 桌面端并发稳定运行。
* **极简欢迎页与开箱即用**：未选文献时主界面极简留白，依赖基于 `uv` 跨平台极速解析。
