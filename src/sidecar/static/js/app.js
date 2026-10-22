// Zotero in AG Frontend Controller
const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.js';
}

const state = {
  collections: [],
  selectedCollectionKey: null,
  items: [],
  selectedItem: null,
  currentPdfDoc: null,
  currentPageNum: 1,
  totalPdfPages: 0,
  scale: 1.25,
  renderedPages: new Set(),
  renderingPages: new Set(),
  selectedText: '',
  observer: null,
  firstPageWidth: null,
};

// DOM Elements
const collectionsListEl = document.getElementById('collectionsList');
const itemsListEl = document.getElementById('itemsList');
const itemsSectionHeaderEl = document.getElementById('itemsSectionHeader');
const searchInputEl = document.getElementById('searchInput');
const emptyStateEl = document.getElementById('emptyState');
const paperViewerEl = document.getElementById('paperViewer');
const paperTitleEl = document.getElementById('paperTitle');
const paperMetaEl = document.getElementById('paperMeta');
const pdfContainerEl = document.getElementById('pdfContainer');
const pageIndicatorEl = document.getElementById('pageIndicator');
const zoomPercentEl = document.getElementById('zoomPercent');
const selectionTooltipEl = document.getElementById('selectionTooltip');
const toastEl = document.getElementById('toast');
const statusBadgeEl = document.getElementById('statusBadge');

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkHealth();
  // Initially only load collections! Empty main area by default.
  await loadCollections();
});

function setupEventListeners() {
  // Search
  let debounceTimer;
  searchInputEl.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = e.target.value.trim();
      if (q) {
        itemsSectionHeaderEl.style.display = 'block';
        itemsSectionHeaderEl.textContent = `搜索结果: "${q}"`;
        loadItems(q);
      } else if (state.selectedCollectionKey) {
        loadItems();
      } else {
        itemsListEl.innerHTML = '';
        itemsSectionHeaderEl.style.display = 'none';
      }
    }, 300);
  });

  // Prev / Next Page Jump
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (state.currentPageNum > 1) {
      scrollToPage(state.currentPageNum - 1);
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    if (state.currentPageNum < state.totalPdfPages) {
      scrollToPage(state.currentPageNum + 1);
    }
  });

  // Zoom Controls
  document.getElementById('zoomInBtn').addEventListener('click', () => {
    updateZoom(Math.min(2.5, state.scale + 0.2));
  });

  document.getElementById('zoomOutBtn').addEventListener('click', () => {
    updateZoom(Math.max(0.5, state.scale - 0.2));
  });

  document.getElementById('zoomFitBtn').addEventListener('click', () => {
    fitWidth();
  });

  // Action Buttons
  document.getElementById('askAgentBtn').addEventListener('click', () => {
    if (!state.selectedItem) return;
    const prompt = `请帮我深入分析论文《${state.selectedItem.title || 'Untitled'}》的核心贡献、解决的主要问题、以及实验对比结论。`;
    copyToClipboard(prompt, '已复制分析 Prompt！请直接粘贴至 Antigravity 对话框 🚀');
  });

  document.getElementById('copyBibtexBtn').addEventListener('click', () => {
    if (!state.selectedItem) return;
    const it = state.selectedItem;
    const citeKey = it.itemKey;
    const bibtex = `@article{${citeKey},\n  title={${it.title || ''}},\n  author={${(it.creators || []).join(' and ')}},\n  year={${it.date || ''}},\n  doi={${it.DOI || ''}}\n}`;
    copyToClipboard(bibtex, '已复制 BibTeX 条目到剪贴板！');
  });

  // Fix: Locate in Zotero Desktop via dedicated backend endpoint
  document.getElementById('openInZoteroBtn').addEventListener('click', async () => {
    if (!state.selectedItem) return;
    showToast('正在调起本地 Zotero 客户端...');
    try {
      const res = await fetch(`/api/locate/${state.selectedItem.itemKey}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || '已在 Zotero 中定位该条目！');
      } else {
        showToast('定位失败: ' + (data.error || '未知错误'));
      }
    } catch (e) {
      showToast('请求定位失败: ' + e.message);
    }
  });

  // Text Selection Tooltip on PDF text
  document.addEventListener('mouseup', handleTextSelection);

  document.getElementById('tooltipAskBtn').addEventListener('click', () => {
    if (!state.selectedText) return;
    const it = state.selectedItem;
    const prompt = `关于论文《${it ? it.title : ''}》，请解析我选中的以下内容：\n\n> "${state.selectedText}"\n\n请详细推导其中的原理、公式或学术背景。`;
    copyToClipboard(prompt, '已生成提问 Prompt 并复制到剪贴板！请直接粘贴提问。');
    hideSelectionTooltip();
  });

  document.getElementById('tooltipCopyBtn').addEventListener('click', () => {
    if (!state.selectedText) return;
    const quote = `> "${state.selectedText}" ([@${state.selectedItem?.itemKey || 'Zotero'}])`;
    copyToClipboard(quote, '已复制引用文本！');
    hideSelectionTooltip();
  });

  // Sidebar toggle button with native Antigravity layout icon
  document.getElementById('toggleSidebarBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    setTimeout(fitWidth, 250);
  });

  // Auto-fit PDF on window/pane resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.currentPdfDoc) {
        fitWidth();
      }
    }, 200);
  });
}

function updateZoom(newScale) {
  state.scale = Math.round(newScale * 100) / 100;
  zoomPercentEl.textContent = `${Math.round(state.scale * 100)}%`;
  // Re-render all current pages with new scale
  reRenderPages();
}

function fitWidth() {
  if (!state.firstPageWidth || !pdfContainerEl) return;
  const containerWidth = pdfContainerEl.clientWidth - 48; // padding margin
  if (containerWidth > 100) {
    const newScale = containerWidth / state.firstPageWidth;
    updateZoom(Math.max(0.5, Math.min(2.5, newScale)));
  }
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.zotero_running) {
      statusBadgeEl.innerHTML = `<span class="status-dot"></span> Zotero 10 运行中`;
    } else {
      statusBadgeEl.innerHTML = `<span class="status-dot" style="background: #f9e2af"></span> 本地 SQLite 直读`;
    }
  } catch (e) {
    statusBadgeEl.innerHTML = `<span class="status-dot" style="background: #f38ba8"></span> 离线`;
  }
}

async function loadCollections() {
  try {
    const res = await fetch('/api/collections');
    const data = await res.json();
    state.collections = data.collections || [];
    renderCollections();
  } catch (e) {
    console.error('Failed to load collections:', e);
  }
}

function renderCollections() {
  collectionsListEl.innerHTML = `
    <div class="collection-item ${state.selectedCollectionKey === null ? 'active' : ''}" onclick="selectCollection(null)">
      <span>📚 全部文献</span>
    </div>
  `;

  function addNode(node, depth = 0) {
    const div = document.createElement('div');
    div.className = `collection-item ${state.selectedCollectionKey === node.key ? 'active' : ''}`;
    div.style.paddingLeft = `${depth * 14 + 10}px`;
    div.innerHTML = `<span>📁 ${escapeHtml(node.name)}</span>`;
    div.onclick = () => selectCollection(node.key, node.name);
    collectionsListEl.appendChild(div);

    if (node.children) {
      node.children.forEach(child => addNode(child, depth + 1));
    }
  }

  state.collections.forEach(node => addNode(node, 0));
}

window.selectCollection = (key, name) => {
  state.selectedCollectionKey = key;
  renderCollections();
  itemsSectionHeaderEl.style.display = 'block';
  itemsSectionHeaderEl.textContent = name ? `目录: ${name}` : '全部文献';
  loadItems();
};

async function loadItems(query = '') {
  try {
    let url = `/api/items?limit=50`;
    if (state.selectedCollectionKey) {
      url += `&collection_key=${encodeURIComponent(state.selectedCollectionKey)}`;
    }
    if (query) {
      url += `&query=${encodeURIComponent(query)}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    state.items = data.items || [];
    renderItems();
  } catch (e) {
    console.error('Failed to load items:', e);
  }
}

function renderItems() {
  if (state.items.length === 0) {
    itemsListEl.innerHTML = '<div style="padding: 16px; color: var(--fg-muted); font-size: 12px; text-align: center;">该目录下暂无文献</div>';
    return;
  }

  itemsListEl.innerHTML = '';
  state.items.forEach(item => {
    const div = document.createElement('div');
    const isActive = state.selectedItem && state.selectedItem.itemKey === item.itemKey;
    div.className = `item-card ${isActive ? 'active' : ''}`;
    div.onclick = () => selectItem(item);

    const title = escapeHtml(item.title || '（无标题）');
    const authors = escapeHtml((item.creators || []).slice(0, 3).join(', ') || '未知作者');
    const year = (item.date || '').substring(0, 4) || '';
    const hasPdf = item.hasPdf ? '<span class="badge-pdf">PDF</span>' : '';

    div.innerHTML = `
      <div class="item-title">${title}</div>
      <div class="item-meta">
        <span>${authors}</span>
        ${year ? `<span>· ${year}</span>` : ''}
        ${hasPdf}
      </div>
    `;
    itemsListEl.appendChild(div);
  });
}

window.selectItem = async (item) => {
  state.selectedItem = item;
  renderItems();

  try {
    const res = await fetch(`/api/item/${item.itemKey}`);
    const data = await res.json();
    if (data.item) {
      state.selectedItem = data.item;
    }
  } catch (e) {}

  displaySelectedItem();
};

function displaySelectedItem() {
  const item = state.selectedItem;
  if (!item) return;

  emptyStateEl.style.display = 'none';
  paperViewerEl.style.display = 'flex';

  paperTitleEl.textContent = item.title || '（无标题）';
  const authors = (item.creators || []).join(', ') || '未知作者';
  const year = (item.date || '').substring(0, 4) || '';
  const pub = item.publicationTitle || '';
  paperMetaEl.textContent = `${authors} ${year ? '· ' + year : ''} ${pub ? '· ' + pub : ''}`;

  const pdfAttachments = item.pdfAttachments || [];
  if (pdfAttachments.length > 0) {
    const attachKey = pdfAttachments[0].attachmentKey;
    loadPdfContinuous(`/api/pdf/${attachKey}`);
  } else {
    showNoPdfState();
  }
}

function showNoPdfState() {
  state.currentPdfDoc = null;
  pageIndicatorEl.textContent = '无 PDF 附件';
  pdfContainerEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📄</div>
      <h3>该条目暂无本地 PDF 原文</h3>
      <p style="font-size: 12px; max-width: 400px; line-height: 1.6;">
        ${escapeHtml(state.selectedItem.abstractNote || '未收录摘要。您可在 Zotero 桌面端中添加附件或通过 DOI 下载。')}
      </p>
    </div>
  `;
}

// Continuous Scroll PDF Loader
async function loadPdfContinuous(pdfUrl) {
  try {
    pageIndicatorEl.textContent = '正在加载 PDF...';
    pdfContainerEl.innerHTML = '<div style="color: var(--fg-muted); padding: 30px; font-size: 13px;">正在解析文档页码...</div>';

    if (state.observer) {
      state.observer.disconnect();
    }
    state.renderedPages.clear();
    state.renderingPages.clear();

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
    });

    state.currentPdfDoc = await loadingTask.promise;
    state.totalPdfPages = state.currentPdfDoc.numPages;
    state.currentPageNum = 1;
    pageIndicatorEl.textContent = `1 / ${state.totalPdfPages}`;

    // Get unscaled width of first page for fitWidth
    const firstPage = await state.currentPdfDoc.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    state.firstPageWidth = unscaledViewport.width;

    // Automatically calculate and set Fit Width on opening!
    const availableWidth = (pdfContainerEl.clientWidth || 800) - 32;
    if (availableWidth > 150 && state.firstPageWidth > 0) {
      state.scale = Math.round((availableWidth / state.firstPageWidth) * 100) / 100;
      state.scale = Math.max(0.5, Math.min(2.5, state.scale));
    }
    zoomPercentEl.textContent = `${Math.round(state.scale * 100)}%`;

    // Build page placeholders for continuous scrolling
    pdfContainerEl.innerHTML = '';
    for (let p = 1; p <= state.totalPdfPages; p++) {
      const pageWrapper = document.createElement('div');
      pageWrapper.id = `pdf-page-${p}`;
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.dataset.pageNum = String(p);
      pageWrapper.style.width = `${unscaledViewport.width * state.scale}px`;
      pageWrapper.style.minHeight = `${unscaledViewport.height * state.scale}px`;

      pageWrapper.innerHTML = `
        <canvas id="canvas-page-${p}" class="pdf-canvas"></canvas>
        <div id="textlayer-page-${p}" class="textLayer"></div>
      `;
      pdfContainerEl.appendChild(pageWrapper);
    }

    // Setup IntersectionObserver for continuous scroll lazy rendering and page tracking
    setupContinuousObserver();

    // Render first 2 pages immediately
    renderPage(1);
    if (state.totalPdfPages > 1) {
      renderPage(2);
    }
  } catch (e) {
    console.error('Failed to load PDF:', e);
    pdfContainerEl.innerHTML = `<div class="empty-state"><p>加载 PDF 出错: ${escapeHtml(e.message)}</p></div>`;
  }
}

function setupContinuousObserver() {
  const options = {
    root: pdfContainerEl,
    rootMargin: '200px 0px 200px 0px',
    threshold: 0.1,
  };

  state.observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const pageNum = parseInt(entry.target.dataset.pageNum, 10);
      if (entry.isIntersecting) {
        // Update current page indicator based on visible page
        state.currentPageNum = pageNum;
        pageIndicatorEl.textContent = `${pageNum} / ${state.totalPdfPages}`;
        renderPage(pageNum);
      }
    });
  }, options);

  for (let p = 1; p <= state.totalPdfPages; p++) {
    const el = document.getElementById(`pdf-page-${p}`);
    if (el) state.observer.observe(el);
  }
}

async function renderPage(pageNum) {
  if (!state.currentPdfDoc || pageNum < 1 || pageNum > state.totalPdfPages) return;
  if (state.renderedPages.has(pageNum) || state.renderingPages.has(pageNum)) return;

  state.renderingPages.add(pageNum);

  try {
    const page = await state.currentPdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });

    const wrapper = document.getElementById(`pdf-page-${pageNum}`);
    const canvas = document.getElementById(`canvas-page-${pageNum}`);
    const textLayer = document.getElementById(`textlayer-page-${pageNum}`);

    if (!wrapper || !canvas || !textLayer) {
      state.renderingPages.delete(pageNum);
      return;
    }

    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.minHeight = `${viewport.height}px`;

    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // Render Text Layer
    textLayer.innerHTML = '';
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;

    const textContent = await page.getTextContent();
    pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport: viewport,
      textDivs: [],
    });

    state.renderedPages.add(pageNum);
  } catch (err) {
    console.error(`Render page ${pageNum} error:`, err);
  } finally {
    state.renderingPages.delete(pageNum);
  }
}

function reRenderPages() {
  if (!state.currentPdfDoc) return;
  state.renderedPages.clear();
  state.renderingPages.clear();

  for (let p = 1; p <= state.totalPdfPages; p++) {
    const wrapper = document.getElementById(`pdf-page-${p}`);
    if (wrapper) {
      const canvas = document.getElementById(`canvas-page-${p}`);
      const textLayer = document.getElementById(`textlayer-page-${p}`);
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      if (textLayer) textLayer.innerHTML = '';
    }
  }

  // Re-render visible pages around current page
  const start = Math.max(1, state.currentPageNum - 1);
  const end = Math.min(state.totalPdfPages, state.currentPageNum + 2);
  for (let p = start; p <= end; p++) {
    renderPage(p);
  }
}

function scrollToPage(pageNum) {
  const target = document.getElementById(`pdf-page-${pageNum}`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    state.currentPageNum = pageNum;
    pageIndicatorEl.textContent = `${pageNum} / ${state.totalPdfPages}`;
  }
}

// Text Selection & Action Tooltip
function handleTextSelection() {
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';

  if (text.length > 3) {
    state.selectedText = text;
    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      selectionTooltipEl.style.left = `${Math.max(10, rect.left + window.scrollX - 40)}px`;
      selectionTooltipEl.style.top = `${Math.max(10, rect.top + window.scrollY - 42)}px`;
      selectionTooltipEl.classList.add('show');
    } catch (e) {}
  } else {
    hideSelectionTooltip();
  }
}

function hideSelectionTooltip() {
  selectionTooltipEl.classList.remove('show');
}

function copyToClipboard(text, message) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(message);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(message);
  });
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
