import {
  state,
  DEFAULT_SETTINGS,
  applySettings,
  showToast,
  copyToClipboard,
  escapeHtml,
  ICON_DATE_DESC,
  ICON_DATE_ASC,
} from './state.js';
import {
  fetchHealth,
  fetchCollections,
  fetchItems,
  fetchItemDetail,
  locateItem,
} from './api.js';
import { initTextSelectionShield } from './viewer/shield.js';
import {
  updateZoom,
  fitWidth,
  showNoPdfState,
  loadPdfContinuous,
  scrollToPage,
} from './viewer/pdf_viewer.js';
import {
  applyAnnotation,
  clearCurrentAnnotation,
  loadAnnotations,
} from './annotations/layer.js';
import {
  handleTextSelection,
  toggleTranslation,
  speakCurrentWord,
  hideSelectionTooltip,
} from './ui/tooltip.js';
import { setupSettingsUi } from './ui/settings.js';

// Dynamic DOM Elements getters to strictly prevent any null reference on early module evaluation
const getCollectionsListEl = () => document.getElementById('collectionsList');
const getItemsListEl = () => document.getElementById('itemsList');
const getItemsHeaderRowEl = () => document.getElementById('itemsHeaderRow');
const getItemsSectionHeaderEl = () => document.getElementById('itemsSectionHeader');
const getSortDateBtnEl = () => document.getElementById('sortDateBtn');
const getSearchInputEl = () => document.getElementById('searchInput');

const getEmptyStateEl = () => document.getElementById('emptyState');
const getPaperViewerEl = () => document.getElementById('paperViewer');
const getPaperTitleEl = () => document.getElementById('paperTitle');
const getPaperMetaEl = () => document.getElementById('paperMeta');
const getStatusBadgeEl = () => document.getElementById('statusBadge');

export async function checkHealth() {
  const statusBadgeEl = getStatusBadgeEl();
  if (!statusBadgeEl) return;
  try {
    const data = await fetchHealth();
    if (data.zotero_running) {
      statusBadgeEl.innerHTML = `<span class="status-dot"></span> Zotero 桌面端运行中`;
    } else {
      statusBadgeEl.innerHTML = `<span class="status-dot" style="background: #f9e2af"></span> 本地 SQLite 直读`;
    }
  } catch (e) {
    statusBadgeEl.innerHTML = `<span class="status-dot" style="background: #f38ba8"></span> 离线`;
  }
}

export async function loadCollections() {
  try {
    const data = await fetchCollections();
    state.collections = data.collections || [];
    renderCollections();
  } catch (e) {
    console.error('Failed to load collections:', e);
  }
}

export function renderCollections() {
  const collectionsListEl = getCollectionsListEl();
  if (!collectionsListEl) return;
  collectionsListEl.innerHTML = `
    <div class="collection-item ${state.selectedCollectionKey === null ? 'active' : ''}" id="colItemAll">
      <span>📚 全部文献</span>
    </div>
  `;
  const allBtn = document.getElementById('colItemAll');
  if (allBtn) allBtn.onclick = () => selectCollection(null);

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

export function selectCollection(key, name) {
  state.selectedCollectionKey = key;
  renderCollections();
  const itemsHeaderRowEl = getItemsHeaderRowEl();
  const itemsSectionHeaderEl = getItemsSectionHeaderEl();
  if (itemsHeaderRowEl) itemsHeaderRowEl.style.display = 'flex';
  if (itemsSectionHeaderEl) itemsSectionHeaderEl.textContent = name ? `目录: ${name}` : '全部文献';
  loadItems();
}
window.selectCollection = selectCollection;

export function sortItemsLocally() {
  if (!state.items || state.items.length <= 1) return;

  state.items.sort((a, b) => {
    const dateA = (a.date || '').trim();
    const dateB = (b.date || '').trim();

    if (!dateA && !dateB) {
      const modA = (a.dateModified || '').trim();
      const modB = (b.dateModified || '').trim();
      return state.sortBy === 'date_asc' ? modA.localeCompare(modB) : modB.localeCompare(modA);
    }
    if (!dateA) return 1;
    if (!dateB) return -1;

    if (state.sortBy === 'date_asc') {
      return dateA.localeCompare(dateB);
    } else {
      return dateB.localeCompare(dateA);
    }
  });
}

export async function loadItems(query = '') {
  try {
    const data = await fetchItems(state.sortBy, state.selectedCollectionKey, query);
    state.items = data.items || [];
    sortItemsLocally();
    renderItems();
  } catch (e) {
    console.error('Failed to load items:', e);
  }
}

export function renderItems() {
  const itemsListEl = getItemsListEl();
  if (!itemsListEl) return;
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
    const isAttachment = item.itemType === 'attachment';
    const authors = isAttachment
      ? 'PDF 独立文档'
      : escapeHtml((item.creators || []).slice(0, 3).join(', ') || '未知作者');
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

export async function selectItem(item) {
  state.selectedItem = item;
  renderItems();

  try {
    const data = await fetchItemDetail(item.itemKey);
    if (data.item) {
      state.selectedItem = data.item;
    }
  } catch (e) {}

  await displaySelectedItem();
}
window.selectItem = selectItem;

export async function displaySelectedItem() {
  const item = state.selectedItem;
  if (!item) return;

  const emptyStateEl = getEmptyStateEl();
  const paperViewerEl = getPaperViewerEl();
  const paperTitleEl = getPaperTitleEl();
  const paperMetaEl = getPaperMetaEl();

  if (emptyStateEl) emptyStateEl.style.display = 'none';
  if (paperViewerEl) paperViewerEl.style.display = 'flex';

  if (paperTitleEl) paperTitleEl.textContent = item.title || '（无标题）';
  const isAttachment = item.itemType === 'attachment';
  if (paperMetaEl) {
    if (isAttachment) {
      paperMetaEl.textContent = 'PDF 独立文档';
    } else {
      const authors = (item.creators || []).join(', ') || '未知作者';
      const year = (item.date || '').substring(0, 4) || '';
      const pub = item.publicationTitle || '';
      paperMetaEl.textContent = `${authors} ${year ? '· ' + year : ''} ${pub ? '· ' + pub : ''}`;
    }
  }

  const pdfAttachments = item.pdfAttachments || [];
  if (pdfAttachments.length > 0) {
    await loadAnnotations(item.itemKey);
    const attachKey = pdfAttachments[0].attachmentKey;
    loadPdfContinuous(`/api/pdf/${attachKey}`);
  } else {
    showNoPdfState();
  }
}

function setupEventListeners() {
  const searchInputEl = getSearchInputEl();
  const sortDateBtnEl = getSortDateBtnEl();
  const itemsHeaderRowEl = getItemsHeaderRowEl();
  const itemsSectionHeaderEl = getItemsSectionHeaderEl();
  const itemsListEl = getItemsListEl();

  // Search
  let debounceTimer;
  if (searchInputEl) {
    searchInputEl.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = e.target.value.trim();
        if (q) {
          if (itemsHeaderRowEl) itemsHeaderRowEl.style.display = 'flex';
          if (itemsSectionHeaderEl) itemsSectionHeaderEl.textContent = `搜索: "${q}"`;
          loadItems(q);
        } else if (state.selectedCollectionKey) {
          loadItems();
        } else {
          if (itemsListEl) itemsListEl.innerHTML = '';
          if (itemsHeaderRowEl) itemsHeaderRowEl.style.display = 'none';
        }
      }, 300);
    });
  }

  // Toggle Date Sort
  if (sortDateBtnEl) {
    sortDateBtnEl.addEventListener('click', () => {
      if (state.sortBy === 'date_desc') {
        state.sortBy = 'date_asc';
        sortDateBtnEl.innerHTML = ICON_DATE_ASC;
      } else {
        state.sortBy = 'date_desc';
        sortDateBtnEl.innerHTML = ICON_DATE_DESC;
      }
      sortItemsLocally();
      renderItems();

      if (state.items.length >= 100) {
        const q = searchInputEl ? searchInputEl.value.trim() : '';
        loadItems(q);
      }
    });
  }

  // Prev / Next Page Jump
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (state.currentPageNum > 1) {
        scrollToPage(state.currentPageNum - 1);
      }
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      if (state.currentPageNum < state.totalPdfPages) {
        scrollToPage(state.currentPageNum + 1);
      }
    });
  }

  // Zoom Controls
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomFitBtn = document.getElementById('zoomFitBtn');
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      updateZoom(Math.min(2.5, state.scale + 0.2));
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      updateZoom(Math.max(0.5, state.scale - 0.2));
    });
  }
  if (zoomFitBtn) {
    zoomFitBtn.addEventListener('click', () => {
      fitWidth();
    });
  }

  // Action Buttons
  const askAgentBtn = document.getElementById('askAgentBtn');
  if (askAgentBtn) {
    askAgentBtn.addEventListener('click', () => {
      if (!state.selectedItem) return;
      const it = state.selectedItem;
      const title = it.title || '（无标题）';
      const authors = (it.creators || []).join(', ') || (it.itemType === 'attachment' ? 'PDF 独立文档' : '未知作者');
      const year = (it.date || '').substring(0, 4) || '';

      let template = (state.settings && state.settings.fullTextPrompt) || DEFAULT_SETTINGS.fullTextPrompt;
      if (it.itemType === 'attachment' && (!state.settings || !state.settings.fullTextPrompt)) {
        template = '请帮我深入分析文档《{title}》的核心内容、要点与关键细节。';
      }

      const prompt = template
        .replaceAll('{title}', title)
        .replaceAll('{authors}', authors)
        .replaceAll('{year}', year);

      copyToClipboard(prompt, '已复制分析 Prompt！请直接粘贴至 Antigravity 对话框 🚀');
    });
  }

  const copyBibtexBtn = document.getElementById('copyBibtexBtn');
  if (copyBibtexBtn) {
    copyBibtexBtn.addEventListener('click', () => {
      if (!state.selectedItem) return;
      const it = state.selectedItem;
      const citeKey = it.itemKey;
      const isAttachment = it.itemType === 'attachment';
      const year = (it.date || '').substring(0, 4) || '';
      const doi = it.doi || it.DOI || '';
      const bibtex = isAttachment
        ? `@misc{${citeKey},\n  title={${it.title || ''}}\n}`
        : `@article{${citeKey},\n  title={${it.title || ''}},\n  author={${(it.creators || []).join(' and ')}},\n  year={${year}},\n  doi={${doi}}\n}`;
      copyToClipboard(bibtex, '已复制 BibTeX 条目到剪贴板！');
    });
  }

  const openInZoteroBtn = document.getElementById('openInZoteroBtn');
  if (openInZoteroBtn) {
    openInZoteroBtn.addEventListener('click', async () => {
      if (!state.selectedItem) return;
      showToast('正在调起本地 Zotero 客户端...');
      try {
        const data = await locateItem(state.selectedItem.itemKey);
        if (data.success) {
          showToast(data.message || '已在 Zotero 中定位该条目！');
        } else {
          showToast('定位失败: ' + (data.error || '未知错误'));
        }
      } catch (e) {
        showToast('请求定位失败: ' + e.message);
      }
    });
  }

  // Text Selection Tooltip & Selection Shield
  initTextSelectionShield();
  document.addEventListener('mouseup', handleTextSelection);

  // Marking colors swatches
  document.querySelectorAll('.ann-color-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = btn.dataset.color;
      applyAnnotation(color, state.annotationMode);
    });
  });

  // Clear / Eraser Button
  const clearAnnotationBtn = document.getElementById('clearAnnotationBtn');
  if (clearAnnotationBtn) {
    clearAnnotationBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearCurrentAnnotation();
    });
  }

  // Mode Toggle: Highlight vs Underline
  const modeHighlightBtn = document.getElementById('modeHighlightBtn');
  const modeUnderlineBtn = document.getElementById('modeUnderlineBtn');
  if (modeHighlightBtn && modeUnderlineBtn) {
    modeHighlightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.annotationMode = 'highlight';
      modeHighlightBtn.classList.add('active');
      modeUnderlineBtn.classList.remove('active');
    });
    modeUnderlineBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.annotationMode = 'underline';
      modeUnderlineBtn.classList.add('active');
      modeHighlightBtn.classList.remove('active');
    });
  }

  // Translation Toggle & Card
  const tooltipTranslateBtn = document.getElementById('tooltipTranslateBtn');
  if (tooltipTranslateBtn) {
    tooltipTranslateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTranslation();
    });
  }

  // Pronunciation buttons
  const speakUsBtn = document.getElementById('speakUsBtn');
  const speakUkBtn = document.getElementById('speakUkBtn');
  if (speakUsBtn) {
    speakUsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakCurrentWord('en-US');
    });
  }
  if (speakUkBtn) {
    speakUkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakCurrentWord('en-GB');
    });
  }

  // Ask Agent Vector Button
  const tooltipAskBtn = document.getElementById('tooltipAskBtn');
  if (tooltipAskBtn) {
    tooltipAskBtn.addEventListener('click', () => {
      if (!state.selectedText) return;
      const it = state.selectedItem;
      const title = it ? (it.title || '（无标题）') : '选中文档';
      const template = (state.settings && state.settings.selectionPrompt) || DEFAULT_SETTINGS.selectionPrompt;

      const prompt = template
        .replaceAll('{title}', title)
        .replaceAll('{selected_text}', state.selectedText);

      copyToClipboard(prompt, '已生成提问 Prompt 并复制到剪贴板！请直接粘贴提问。');
      hideSelectionTooltip();
    });
  }

  // Quote Vector Button
  const tooltipCopyBtn = document.getElementById('tooltipCopyBtn');
  if (tooltipCopyBtn) {
    tooltipCopyBtn.addEventListener('click', () => {
      if (!state.selectedText) return;
      const quote = `> "${state.selectedText}" ([@${state.selectedItem?.itemKey || 'Zotero'}])`;
      copyToClipboard(quote, '已复制引用文本！');
      hideSelectionTooltip();
    });
  }

  // Sidebar toggle button
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('collapsed');
      setTimeout(fitWidth, 250);
    });
  }

  // Setup Settings UI
  setupSettingsUi();

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

export async function initApp() {
  setupEventListeners();
  applySettings();
  await checkHealth();
  await loadCollections();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

