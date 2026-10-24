// Zotero in AG Frontend Controller
const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.js';
}

const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark' | 'light'
  accentColor: '#89b4fa',
  pdfFilter: 'normal', // 'normal' | 'sepia' | 'dark'
  fullTextPrompt: '请帮我深入分析论文《{title}》的核心贡献、解决的主要问题、以及实验对比结论。',
  selectionPrompt: '关于论文《{title}》，请解析我选中的以下内容：\n\n> "{selected_text}"\n\n请详细推导其中的原理、公式或学术背景。',
  transEngine: 'builtin', // 'builtin' | 'custom'
  transApiBase: 'https://api.deepseek.com/v1',
  transApiKey: '',
  transModel: 'deepseek-chat',
  transPrompt: '你是一位资深学术审稿专家，请将用户提供的学术英文文本翻译为地道、准确的学术中文，保留专业术语，直接输出翻译结果，不要输出任何多余解释。',
};

function loadSettings() {
  try {
    const saved = localStorage.getItem('zotero_ag_settings');
    if (saved) {
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(saved));
    }
  } catch (e) {}
  return Object.assign({}, DEFAULT_SETTINGS);
}

function saveSettings(newSettings) {
  state.settings = Object.assign({}, state.settings, newSettings);
  try {
    localStorage.setItem('zotero_ag_settings', JSON.stringify(state.settings));
  } catch (e) {}
  applySettings();
}

function applySettings() {
  const s = state.settings || DEFAULT_SETTINGS;
  // 1. Theme
  if (s.theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  // 2. Accent Color
  if (s.accentColor) {
    document.documentElement.style.setProperty('--accent-color', s.accentColor);
  }

  // 3. PDF Reading Filter
  if (pdfContainerEl) {
    pdfContainerEl.classList.remove('filter-sepia', 'filter-dark');
    if (s.pdfFilter === 'sepia') {
      pdfContainerEl.classList.add('filter-sepia');
    } else if (s.pdfFilter === 'dark') {
      pdfContainerEl.classList.add('filter-dark');
    }
  }
}

const state = {
  collections: [],
  selectedCollectionKey: null,
  items: [],
  selectedItem: null,
  sortBy: 'date_desc',
  settings: loadSettings(),
  currentPdfDoc: null,
  currentPageNum: 1,
  totalPdfPages: 0,
  scale: 1.25,
  renderedPages: new Set(),
  renderingPages: new Set(),
  selectedText: '',
  selectedRange: null,
  annotationMode: 'highlight', // 'highlight' | 'underline'
  annotations: [],
  activeAnnotation: null,
  isTranslationOpen: false,
  observer: null,
  firstPageWidth: null,
};

// DOM Elements
const collectionsListEl = document.getElementById('collectionsList');
const itemsListEl = document.getElementById('itemsList');
const itemsHeaderRowEl = document.getElementById('itemsHeaderRow');
const itemsSectionHeaderEl = document.getElementById('itemsSectionHeader');
const sortDateBtnEl = document.getElementById('sortDateBtn');
const searchInputEl = document.getElementById('searchInput');

const ICON_DATE_DESC = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/></svg>`;
const ICON_DATE_ASC = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 8h7"/><path d="M11 4h10"/></svg>`;
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
  applySettings();
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
        if (itemsHeaderRowEl) itemsHeaderRowEl.style.display = 'flex';
        itemsSectionHeaderEl.textContent = `搜索: "${q}"`;
        loadItems(q);
      } else if (state.selectedCollectionKey) {
        loadItems();
      } else {
        itemsListEl.innerHTML = '';
        if (itemsHeaderRowEl) itemsHeaderRowEl.style.display = 'none';
      }
    }, 300);
  });

  // Toggle Date Sort (Newest <-> Oldest)
  if (sortDateBtnEl) {
    sortDateBtnEl.addEventListener('click', () => {
      if (state.sortBy === 'date_desc') {
        state.sortBy = 'date_asc';
        sortDateBtnEl.innerHTML = ICON_DATE_ASC;
      } else {
        state.sortBy = 'date_desc';
        sortDateBtnEl.innerHTML = ICON_DATE_DESC;
      }
      // Instant in-memory re-sort and render
      sortItemsLocally();
      renderItems();

      const q = searchInputEl.value.trim();
      loadItems(q);
    });
  }

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

  document.getElementById('copyBibtexBtn').addEventListener('click', () => {
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

  // Text Selection Tooltip & Zotero Selection Shield
  initTextSelectionShield();
  document.addEventListener('mouseup', handleTextSelection);

  // 1. Zotero 8-color marking swatches
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

  // 2. Mode Toggle: Highlight [A] vs Underline [A_]
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

  // 3. Translation Toggle & Card
  const tooltipTranslateBtn = document.getElementById('tooltipTranslateBtn');
  if (tooltipTranslateBtn) {
    tooltipTranslateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTranslation();
    });
  }

  // Sound pronunciation buttons
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

  // 4. Ask Agent Vector Button
  document.getElementById('tooltipAskBtn').addEventListener('click', () => {
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

  // 5. Quote Vector Button
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

  // Settings Modal Controls
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const fullTextPromptInput = document.getElementById('fullTextPromptInput');
  const selectionPromptInput = document.getElementById('selectionPromptInput');
  const resetFullPromptBtn = document.getElementById('resetFullPromptBtn');
  const resetSelectionPromptBtn = document.getElementById('resetSelectionPromptBtn');

  // Translation Settings inputs
  const transApiBaseInput = document.getElementById('transApiBaseInput');
  const transApiKeyInput = document.getElementById('transApiKeyInput');
  const transModelInput = document.getElementById('transModelInput');
  const transPromptInput = document.getElementById('transPromptInput');
  const resetTransPromptBtn = document.getElementById('resetTransPromptBtn');
  const testTransApiBtn = document.getElementById('testTransApiBtn');
  const testApiStatus = document.getElementById('testApiStatus');

  // Tab switching in settings
  document.querySelectorAll('.settings-nav-item').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      const targetTab = tabBtn.dataset.tab;
      const tabApp = document.getElementById('tabAppearance');
      const tabPr = document.getElementById('tabPrompts');
      const tabTr = document.getElementById('tabTranslation');
      if (tabApp) tabApp.style.display = targetTab === 'appearance' ? 'flex' : 'none';
      if (tabPr) tabPr.style.display = targetTab === 'prompts' ? 'flex' : 'none';
      if (tabTr) tabTr.style.display = targetTab === 'translation' ? 'flex' : 'none';
    });
  });

  // Color picker dots
  document.querySelectorAll('.color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      // Live preview accent color on cards and UI
      if (dot.dataset.color) {
        document.documentElement.style.setProperty('--accent-color', dot.dataset.color);
      }
    });
  });

  // Radio cards state helper
  function updateRadioCards(name) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
      const card = input.closest('.setting-radio-card');
      if (card) {
        if (input.checked) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      }
    });
  }

  document.querySelectorAll('input[name="themeMode"], input[name="pdfFilter"], input[name="transEngine"]').forEach(input => {
    input.addEventListener('change', () => {
      updateRadioCards(input.name);
      if (input.name === 'transEngine') {
        const customAiGroup = document.getElementById('customAiModelGroup');
        if (customAiGroup) {
          customAiGroup.style.display = (input.value === 'custom') ? 'flex' : 'none';
        }
      }
    });
  });

  function openSettings() {
    const s = state.settings || DEFAULT_SETTINGS;
    // Set theme radio
    const themeRadio = document.querySelector(`input[name="themeMode"][value="${s.theme}"]`);
    if (themeRadio) {
      themeRadio.checked = true;
      updateRadioCards('themeMode');
    }

    // Set accent color active dot
    document.querySelectorAll('.color-dot').forEach(dot => {
      if (dot.dataset.color.toLowerCase() === (s.accentColor || '#89b4fa').toLowerCase()) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });

    // Set PDF filter radio
    const filterRadio = document.querySelector(`input[name="pdfFilter"][value="${s.pdfFilter}"]`);
    if (filterRadio) {
      filterRadio.checked = true;
      updateRadioCards('pdfFilter');
    }

    // Set prompt templates
    if (fullTextPromptInput) fullTextPromptInput.value = s.fullTextPrompt || DEFAULT_SETTINGS.fullTextPrompt;
    if (selectionPromptInput) selectionPromptInput.value = s.selectionPrompt || DEFAULT_SETTINGS.selectionPrompt;

    // Set translation settings
    const engineRadio = document.querySelector(`input[name="transEngine"][value="${s.transEngine || 'builtin'}"]`);
    if (engineRadio) {
      engineRadio.checked = true;
      updateRadioCards('transEngine');
    }
    const customAiGroup = document.getElementById('customAiModelGroup');
    if (customAiGroup) {
      customAiGroup.style.display = (s.transEngine === 'custom') ? 'flex' : 'none';
    }

    if (transApiBaseInput) transApiBaseInput.value = s.transApiBase || DEFAULT_SETTINGS.transApiBase;
    if (transApiKeyInput) transApiKeyInput.value = s.transApiKey || '';
    if (transModelInput) transModelInput.value = s.transModel || DEFAULT_SETTINGS.transModel;
    if (transPromptInput) transPromptInput.value = s.transPrompt || DEFAULT_SETTINGS.transPrompt;
    if (testApiStatus) testApiStatus.textContent = '';

    if (settingsModal) settingsModal.style.display = 'flex';
  }

  function closeSettings() {
    if (settingsModal) settingsModal.style.display = 'none';
    // Revert un-saved preview if any
    applySettings();
  }

  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeSettings);

  // Close modal when clicking outside dialog
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettings();
    });
  }

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsModal && settingsModal.style.display === 'flex') {
      closeSettings();
    }
  });

  // Reset prompt buttons
  if (resetFullPromptBtn) {
    resetFullPromptBtn.addEventListener('click', () => {
      if (fullTextPromptInput) fullTextPromptInput.value = DEFAULT_SETTINGS.fullTextPrompt;
    });
  }
  if (resetSelectionPromptBtn) {
    resetSelectionPromptBtn.addEventListener('click', () => {
      if (selectionPromptInput) selectionPromptInput.value = DEFAULT_SETTINGS.selectionPrompt;
    });
  }
  if (resetTransPromptBtn) {
    resetTransPromptBtn.addEventListener('click', () => {
      if (transPromptInput) transPromptInput.value = DEFAULT_SETTINGS.transPrompt;
    });
  }

  // Test AI Model Connection
  if (testTransApiBtn) {
    testTransApiBtn.addEventListener('click', async () => {
      const apiKey = transApiKeyInput ? transApiKeyInput.value.trim() : '';
      const apiBase = transApiBaseInput ? transApiBaseInput.value.trim() : '';
      const model = transModelInput ? transModelInput.value.trim() : '';
      if (!apiKey) {
        if (testApiStatus) testApiStatus.textContent = '❌ 请先输入 API Key';
        return;
      }
      if (testApiStatus) testApiStatus.textContent = '⏳ 正在测试模型连接...';
      try {
        const res = await fetch('/api/test_ai_model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_base: apiBase, api_key: apiKey, model: model }),
        });
        const data = await res.json();
        if (data.success) {
          if (testApiStatus) testApiStatus.textContent = `✅ 连接成功 (${data.model || 'OK'})`;
        } else {
          if (testApiStatus) testApiStatus.textContent = `❌ 失败: ${data.error || '错误'}`;
        }
      } catch (err) {
        if (testApiStatus) testApiStatus.textContent = `❌ 连接异常: ${err.message}`;
      }
    });
  }

  // Save Settings
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
      const selectedTheme = document.querySelector('input[name="themeMode"]:checked')?.value || 'dark';
      const activeColorDot = document.querySelector('.color-dot.active');
      const selectedColor = activeColorDot ? activeColorDot.dataset.color : '#89b4fa';
      const selectedFilter = document.querySelector('input[name="pdfFilter"]:checked')?.value || 'normal';
      const fullPrompt = (fullTextPromptInput ? fullTextPromptInput.value.trim() : '') || DEFAULT_SETTINGS.fullTextPrompt;
      const selectPrompt = (selectionPromptInput ? selectionPromptInput.value.trim() : '') || DEFAULT_SETTINGS.selectionPrompt;

      const selectedEngine = document.querySelector('input[name="transEngine"]:checked')?.value || 'builtin';
      const apiBase = (transApiBaseInput ? transApiBaseInput.value.trim() : '') || DEFAULT_SETTINGS.transApiBase;
      const apiKey = transApiKeyInput ? transApiKeyInput.value.trim() : '';
      const model = (transModelInput ? transModelInput.value.trim() : '') || DEFAULT_SETTINGS.transModel;
      const transPrompt = (transPromptInput ? transPromptInput.value.trim() : '') || DEFAULT_SETTINGS.transPrompt;

      saveSettings({
        theme: selectedTheme,
        accentColor: selectedColor,
        pdfFilter: selectedFilter,
        fullTextPrompt: fullPrompt,
        selectionPrompt: selectPrompt,
        transEngine: selectedEngine,
        transApiBase: apiBase,
        transApiKey: apiKey,
        transModel: model,
        transPrompt: transPrompt,
      });

      closeSettings();
      showToast('设置已保存并即时生效 ✨');
    });
  }

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
  if (itemsHeaderRowEl) itemsHeaderRowEl.style.display = 'flex';
  itemsSectionHeaderEl.textContent = name ? `目录: ${name}` : '全部文献';
  loadItems();
};

function sortItemsLocally() {
  if (!state.items || state.items.length <= 1) return;

  state.items.sort((a, b) => {
    const dateA = (a.date || '').trim();
    const dateB = (b.date || '').trim();

    // If both have no publication date, fallback to modified date
    if (!dateA && !dateB) {
      const modA = (a.dateModified || '').trim();
      const modB = (b.dateModified || '').trim();
      return state.sortBy === 'date_asc' ? modA.localeCompare(modB) : modB.localeCompare(modA);
    }
    // Items without publication date always go to bottom
    if (!dateA) return 1;
    if (!dateB) return -1;

    if (state.sortBy === 'date_asc') {
      return dateA.localeCompare(dateB);
    } else {
      return dateB.localeCompare(dateA);
    }
  });
}

async function loadItems(query = '') {
  try {
    let url = `/api/items?limit=100&sort=${encodeURIComponent(state.sortBy)}`;
    if (state.selectedCollectionKey) {
      url += `&collection_key=${encodeURIComponent(state.selectedCollectionKey)}`;
    }
    if (query) {
      url += `&query=${encodeURIComponent(query)}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    state.items = data.items || [];
    sortItemsLocally();
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

  await displaySelectedItem();
};

async function displaySelectedItem() {
  const item = state.selectedItem;
  if (!item) return;

  emptyStateEl.style.display = 'none';
  paperViewerEl.style.display = 'flex';

  paperTitleEl.textContent = item.title || '（无标题）';
  const isAttachment = item.itemType === 'attachment';
  if (isAttachment) {
    paperMetaEl.textContent = 'PDF 独立文档';
  } else {
    const authors = (item.creators || []).join(', ') || '未知作者';
    const year = (item.date || '').substring(0, 4) || '';
    const pub = item.publicationTitle || '';
    paperMetaEl.textContent = `${authors} ${year ? '· ' + year : ''} ${pub ? '· ' + pub : ''}`;
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
    textLayersSentinelMap.clear();

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
    applySettings();
    pdfContainerEl.innerHTML = '';
    for (let p = 1; p <= state.totalPdfPages; p++) {
      const pageWrapper = document.createElement('div');
      pageWrapper.id = `pdf-page-${p}`;
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.dataset.pageNum = String(p);
      pageWrapper.style.setProperty('--scale-factor', String(state.scale));
      pageWrapper.style.width = `${unscaledViewport.width * state.scale}px`;
      pageWrapper.style.minHeight = `${unscaledViewport.height * state.scale}px`;

      pageWrapper.innerHTML = `
        <canvas id="canvas-page-${p}" class="pdf-canvas"></canvas>
        <div id="highlightlayer-page-${p}" class="pdf-highlight-layer"></div>
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

// ==========================================
// Text Selection Boundary & Caret Projection Shield (Zotero & Mozilla PDF.js Standard)
// ==========================================
const textLayersSentinelMap = new Map();

function registerTextLayerSentinel(textLayer, endDiv) {
  textLayersSentinelMap.set(textLayer, endDiv);
}

function initTextSelectionShield() {
  let isMouseDown = false;
  let isPointerDown = false;
  let dragAnchor = null; // { node, offset }
  let activeTextLayer = null;
  let hasMoved = false;
  let startX = 0;
  let startY = 0;
  let isUpdatingSelection = false;
  let prevRange = null;

  function safeSetBaseAndExtent(sel, anchorNode, anchorOffset, focusNode, focusOffset) {
    if (isUpdatingSelection) return;
    isUpdatingSelection = true;
    try {
      sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    } catch (err) {}
    finally {
      queueMicrotask(() => { isUpdatingSelection = false; });
    }
  }

  const resetSentinels = (end, tl) => {
    if (end && tl) {
      tl.append(end);
      end.style.width = "";
      end.style.height = "";
      end.style.userSelect = "none";
      tl.classList.remove("selecting");
    }
  };

  function getPointCaret(clientX, clientY, textLayer) {
    if (!textLayer) return null;

    // 1. Direct hit-test: Is cursor directly over a text span inside the textLayer?
    const el = document.elementFromPoint(clientX, clientY);
    if (el && el.tagName === 'SPAN' && el.closest('.textLayer') === textLayer && el.firstChild) {
      if (document.caretPositionFromPoint) {
        try {
          const pos = document.caretPositionFromPoint(clientX, clientY);
          if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
            return { node: pos.offsetNode, offset: pos.offset };
          }
        } catch (e) {}
      } else if (document.caretRangeFromPoint) {
        try {
          const range = document.caretRangeFromPoint(clientX, clientY);
          if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
            return { node: range.startContainer, offset: range.startOffset };
          }
        } catch (e) {}
      }

      // Span-local proportional fallback
      const rect = el.getBoundingClientRect();
      const textNode = el.firstChild;
      const textLen = textNode.nodeValue ? textNode.nodeValue.length : 0;
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
      const offset = Math.max(0, Math.min(textLen, Math.round(ratio * textLen)));
      return { node: textNode, offset };
    }

    // 2. Whitespace projection: Cursor is in margin, gutter, or inter-paragraph gap
    // CRITICAL: Text is strictly structured into horizontal line bands.
    // Line identification must be governed purely by vertical proximity (clientY)
    // to prevent shorter/longer lines from competing horizontally and swinging wildly.
    const spans = Array.from(textLayer.querySelectorAll('span:not(.markedContent)')).filter(s => {
      if (!s.firstChild || s.firstChild.nodeType !== Node.TEXT_NODE || !s.textContent.trim().length) return false;
      const r = s.getBoundingClientRect();
      // Exclude vertical rotated sidebars (like arXiv stamps) which span vertically across multiple lines
      if ((r.bottom - r.top) > 40 && (r.bottom - r.top) > (r.right - r.left) * 1.5) return false;
      return true;
    });
    if (spans.length === 0) return null;

    // Multi-column filtering: if page has side-by-side columns, prioritize the cursor's half
    const tlRect = textLayer.getBoundingClientRect();
    const midX = tlRect.left + tlRect.width / 2;
    const leftColCount = spans.filter(s => s.getBoundingClientRect().right < (midX + 15)).length;
    const rightColCount = spans.filter(s => s.getBoundingClientRect().left > (midX - 15)).length;
    const isMultiCol = leftColCount >= 4 && rightColCount >= 4;

    let candidateSpans = spans;
    if (isMultiCol) {
      const colSpans = spans.filter(s => {
        const r = s.getBoundingClientRect();
        const isFull = (r.right - r.left) > (tlRect.width * 0.75);
        if (isFull) return true;
        if (clientX < midX) return r.left < midX;
        return r.right > midX;
      });
      if (colSpans.length > 0) candidateSpans = colSpans;
    }

    // Step 2A: Find minimum vertical distance to determine the active line band by center point
    let minCenterDy = Infinity;
    for (const span of candidateSpans) {
      const r = span.getBoundingClientRect();
      const center = (r.top + r.bottom) / 2;
      const dy = Math.abs(clientY - center);
      if (dy < minCenterDy) minCenterDy = dy;
    }

    // Step 2B: Collect all spans belonging to this closest horizontal line
    const lineSpans = candidateSpans.filter(span => {
      const r = span.getBoundingClientRect();
      const center = (r.top + r.bottom) / 2;
      return Math.abs(clientY - center) <= (minCenterDy + 4);
    }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    if (lineSpans.length === 0) return null;

    // Check if line spans are divided by a column gutter
    const colGroups = [];
    let curGroup = [lineSpans[0]];
    for (let i = 1; i < lineSpans.length; i++) {
      const prevRect = lineSpans[i - 1].getBoundingClientRect();
      const currRect = lineSpans[i].getBoundingClientRect();
      if ((currRect.left - prevRect.right) > 28) {
        colGroups.push(curGroup);
        curGroup = [lineSpans[i]];
      } else {
        curGroup.push(lineSpans[i]);
      }
    }
    colGroups.push(curGroup);

    // Pick the group closest horizontally to clientX
    let activeGroup = colGroups[0];
    if (colGroups.length > 1) {
      let minGroupDx = Infinity;
      for (const grp of colGroups) {
        const gLeft = grp[0].getBoundingClientRect().left;
        const gRight = grp[grp.length - 1].getBoundingClientRect().right;
        const gDx = clientX < gLeft ? (gLeft - clientX) : (clientX > gRight ? (clientX - gRight) : 0);
        if (gDx < minGroupDx) {
          minGroupDx = gDx;
          activeGroup = grp;
        }
      }
    }

    const firstSpan = activeGroup[0];
    const lastSpan = activeGroup[activeGroup.length - 1];
    const firstRect = firstSpan.getBoundingClientRect();
    const lastRect = lastSpan.getBoundingClientRect();

    // Step 2C: Horizontal caret placement within the locked line
    if (clientX <= firstRect.left) {
      // In left margin: lock rock-solid to the line start (offset 0)
      return { node: firstSpan.firstChild, offset: 0 };
    } else if (clientX >= lastRect.right) {
      // In right margin: lock rock-solid to the line end (offset = text length)
      const textNode = lastSpan.firstChild;
      return { node: textNode, offset: textNode.nodeValue ? textNode.nodeValue.length : 0 };
    } else {
      // Horizontally within the line: find matching span
      let targetSpan = activeGroup.find(s => {
        const r = s.getBoundingClientRect();
        return clientX >= r.left && clientX <= r.right;
      });
      if (!targetSpan) {
        // In inter-word space on the same line
        let minDx = Infinity;
        for (const s of activeGroup) {
          const r = s.getBoundingClientRect();
          const dx = clientX < r.left ? (r.left - clientX) : (clientX > r.right ? (clientX - r.right) : 0);
          if (dx < minDx) {
            minDx = dx;
            targetSpan = s;
          }
        }
      }
      if (!targetSpan) targetSpan = firstSpan;
      const r = targetSpan.getBoundingClientRect();
      const textNode = targetSpan.firstChild;
      const textLen = textNode.nodeValue ? textNode.nodeValue.length : 0;
      const ratio = r.width > 0 ? (clientX - r.left) / r.width : 0.5;
      const offset = Math.max(0, Math.min(textLen, Math.round(ratio * textLen)));
      return { node: textNode, offset };
    }
  }

  document.addEventListener('pointerdown', () => {
    isPointerDown = true;
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const tl = e.target.closest ? e.target.closest('.textLayer') : null;
    if (tl) {
      isMouseDown = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      activeTextLayer = tl;
      tl.classList.add('selecting');
      dragAnchor = getPointCaret(e.clientX, e.clientY, tl);
    }
  }, true);

  document.addEventListener('mousemove', (e) => {
    if (!isMouseDown || !dragAnchor || !activeTextLayer) return;

    if (!hasMoved && Math.hypot(e.clientX - startX, e.clientY - startY) > 3) {
      hasMoved = true;
    }
    if (!hasMoved) return;

    // Detect target page (even when cursor moves into outer gray margin)
    let pageWrapper = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pdf-page-wrapper');
    if (!pageWrapper) {
      const pages = Array.from(document.querySelectorAll('.pdf-page-wrapper'));
      if (pages.length > 0) {
        pageWrapper = pages.find(p => {
          const r = p.getBoundingClientRect();
          return e.clientY >= r.top && e.clientY <= r.bottom;
        });
        if (!pageWrapper) {
          if (e.clientY < pages[0].getBoundingClientRect().top) {
            pageWrapper = pages[0];
          } else if (e.clientY > pages[pages.length - 1].getBoundingClientRect().bottom) {
            pageWrapper = pages[pages.length - 1];
          } else {
            pageWrapper = activeTextLayer?.closest('.pdf-page-wrapper');
          }
        }
      }
    }
    const currentTl = (pageWrapper ? pageWrapper.querySelector('.textLayer') : null) || activeTextLayer;

    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    const isOnSpan = targetEl && targetEl.tagName === 'SPAN' && targetEl.closest('.textLayer');

    // Only project when cursor is outside text spans (in margins or blank whitespace)
    if (!isOnSpan) {
      const caret = getPointCaret(e.clientX, e.clientY, currentTl);
      if (caret && caret.node) {
        const sel = window.getSelection();
        if (sel && (sel.focusNode !== caret.node || sel.focusOffset !== caret.offset)) {
          safeSetBaseAndExtent(sel, dragAnchor.node, dragAnchor.offset, caret.node, caret.offset);
        }
      }
    }
  }, true);

  // Mozilla PDF.js Global Selection Listener:
  // Dynamically relocates the .endOfContent sentinel element right after (or before) the active anchor span.
  // This physically intercepts Chromium's C++ SelectionController, completely eliminating runaway selection jumps to footnotes.
  document.addEventListener('selectionchange', () => {
    if (isUpdatingSelection) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      textLayersSentinelMap.forEach(resetSentinels);
      return;
    }

    const activeTextLayers = new Set();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const textLayerDiv of textLayersSentinelMap.keys()) {
        if (!activeTextLayers.has(textLayerDiv) && range.intersectsNode(textLayerDiv)) {
          activeTextLayers.add(textLayerDiv);
        }
      }
    }

    for (const [textLayerDiv, endDiv] of textLayersSentinelMap) {
      if (activeTextLayers.has(textLayerDiv)) {
        textLayerDiv.classList.add('selecting');
      } else {
        resetSentinels(endDiv, textLayerDiv);
      }
    }

    const range = selection.getRangeAt(0);
    const modifyStart = prevRange && (
      range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
      range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0
    );
    let anchor = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) {
      anchor = anchor.parentNode;
    }
    if (anchor.classList?.contains('highlight')) {
      anchor = anchor.parentNode;
    }
    if (!modifyStart && range.endOffset === 0) {
      do {
        while (!anchor.previousSibling) {
          anchor = anchor.parentNode;
        }
        anchor = anchor.previousSibling;
      } while (!anchor.childNodes.length);
    }
    const parentTextLayer = anchor.parentElement?.closest('.textLayer');
    const endDiv = textLayersSentinelMap.get(parentTextLayer);
    if (endDiv && anchor.parentElement) {
      endDiv.style.width = parentTextLayer.style.width || '100%';
      endDiv.style.height = parentTextLayer.style.height || '100%';
      endDiv.style.userSelect = 'text';
      anchor.parentElement.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling);
    }
    prevRange = range.cloneRange();
  });

  const onPointerEnd = () => {
    isPointerDown = false;
    isMouseDown = false;
    hasMoved = false;
    dragAnchor = null;
    activeTextLayer = null;
    textLayersSentinelMap.forEach(resetSentinels);
  };

  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('mouseup', onPointerEnd, true);
  window.addEventListener('blur', onPointerEnd);
  document.addEventListener('keyup', () => {
    if (!isPointerDown && !isMouseDown) {
      textLayersSentinelMap.forEach(resetSentinels);
    }
  });
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
    wrapper.style.setProperty('--scale-factor', String(state.scale));

    // HiDPI / Retina Crisp Rendering: render at device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const context = canvas.getContext('2d');
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    };

    await page.render(renderContext).promise;

    // Render Text Layer with exact scale-factor
    textLayer.innerHTML = '';
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    textLayer.style.setProperty('--scale-factor', String(state.scale));

    const textContent = await page.getTextContent();
    const textLayerTask = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport: viewport,
      textDivs: [],
    });
    await textLayerTask.promise;

    // Sentinel endOfContent for seamless whitespace dragging (Mozilla PDF.js standard)
    let endDiv = textLayer.querySelector('.endOfContent');
    if (!endDiv) {
      endDiv = document.createElement('div');
      endDiv.className = 'endOfContent';
      textLayer.appendChild(endDiv);
    }
    registerTextLayerSentinel(textLayer, endDiv);

    // Render Highlights & Annotations Layer
    renderAnnotationsForPage(pageNum, viewport);

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
      wrapper.style.setProperty('--scale-factor', String(state.scale));
      if (state.firstPageWidth) {
        wrapper.style.width = `${state.firstPageWidth * state.scale}px`;
      }
      const canvas = document.getElementById(`canvas-page-${p}`);
      const textLayer = document.getElementById(`textlayer-page-${p}`);
      const highlightLayer = document.getElementById(`highlightlayer-page-${p}`);
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      if (textLayer) textLayer.innerHTML = '';
      if (highlightLayer) highlightLayer.innerHTML = '';
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

// --- Annotations & Marking Logic ---

function showTooltipAtRect(rect) {
  state.isTranslationOpen = false;
  const tooltipTranslationCard = document.getElementById('tooltipTranslationCard');
  const tooltipTranslateBtn = document.getElementById('tooltipTranslateBtn');
  if (tooltipTranslationCard) tooltipTranslationCard.style.display = 'none';
  if (tooltipTranslateBtn) tooltipTranslateBtn.classList.remove('active');

  const tooltipWidth = 270;
  const tooltipHeight = 72;
  let left = rect.left + window.scrollX;
  let top = rect.top + window.scrollY - tooltipHeight - 8;

  if (left + tooltipWidth > window.innerWidth - 10) {
    left = window.innerWidth - tooltipWidth - 10;
  }
  if (left < 10) left = 10;

  if (top < window.scrollY + 10) {
    top = (rect.bottom || rect.top) + window.scrollY + 8;
  }

  selectionTooltipEl.style.left = `${left}px`;
  selectionTooltipEl.style.top = `${top}px`;
  selectionTooltipEl.classList.add('show');
}

function rectsOverlap(r1, r2) {
  const overlapX = Math.max(0, Math.min(r1.left + r1.width, r2.left + r2.width) - Math.max(r1.left, r2.left));
  const overlapY = Math.max(0, Math.min(r1.top + r1.height, r2.top + r2.height) - Math.max(r1.top, r2.top));
  const overlapArea = overlapX * overlapY;
  const minArea = Math.min(r1.width * r1.height, r2.width * r2.height);
  if (minArea <= 0) return false;
  return (overlapArea / minArea > 0.25) || (overlapY > 6 && overlapX > 10);
}

function isAnnotationOverlapping(ann, pageNum, newRects, newText) {
  const annPage = ann.pageNum !== undefined ? ann.pageNum : (ann.pageIndex !== undefined ? ann.pageIndex + 1 : 1);
  if (annPage !== pageNum) return false;

  // 1. Text overlap check
  if (newText && ann.text) {
    const t1 = ann.text.replace(/\s+/g, '').trim().toLowerCase();
    const t2 = newText.replace(/\s+/g, '').trim().toLowerCase();
    if (t1 && t2 && (t1 === t2 || t1.includes(t2) || t2.includes(t1))) {
      return true;
    }
  }

  // 2. Geometric overlap check
  if (!ann.rects || !Array.isArray(ann.rects) || !newRects || !newRects.length) return false;
  for (const r1 of newRects) {
    for (const r2 of ann.rects) {
      let rectObj = r2;
      if (Array.isArray(r2) && r2.length >= 4) {
        rectObj = {
          left: Math.min(r2[0], r2[2]),
          top: Math.min(r2[1], r2[3]),
          width: Math.abs(r2[2] - r2[0]),
          height: Math.abs(r2[3] - r2[1]),
        };
      }
      if (rectsOverlap(r1, rectObj)) {
        return true;
      }
    }
  }
  return false;
}

function saveAnnotationsToStorage(itemKey) {
  if (!itemKey) return;
  try {
    const localOnly = state.annotations.filter(a => a.source !== 'zotero');
    localStorage.setItem(`zotero_ag_annotations_${itemKey}`, JSON.stringify(localOnly));
  } catch (e) {}
}

function deleteAnnotationOnServer(itemKey, annId) {
  if (!itemKey || !annId) return;
  fetch(`/api/annotations/${encodeURIComponent(itemKey)}/${encodeURIComponent(annId)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

async function loadAnnotations(itemKey) {
  if (!itemKey) return;
  state.annotations = [];
  try {
    const res = await fetch(`/api/annotations/${encodeURIComponent(itemKey)}`);
    const data = await res.json();
    const zoteroAnns = data.zotero_annotations || [];
    const localAnns = data.local_annotations || [];
    let savedLocal = [];
    try {
      savedLocal = JSON.parse(localStorage.getItem(`zotero_ag_annotations_${itemKey}`) || '[]');
    } catch (e) {}

    const allMap = new Map();
    zoteroAnns.forEach(a => allMap.set(a.id, a));
    localAnns.forEach(a => allMap.set(a.id, a));
    savedLocal.forEach(a => allMap.set(a.id, a));

    // Deduplicate overlapping duplicate annotations (keeping latest, clean up historical stacks)
    const rawList = Array.from(allMap.values());
    const deduped = [];
    for (const ann of rawList) {
      const pageNum = ann.pageNum || (ann.pageIndex !== undefined ? ann.pageIndex + 1 : 1);
      const isDupe = deduped.some((existing, idx) => {
        const existPage = existing.pageNum || (existing.pageIndex !== undefined ? existing.pageIndex + 1 : 1);
        if (existPage === pageNum && isAnnotationOverlapping(existing, pageNum, ann.rects || [], ann.text || '')) {
          if ((ann.createdAt || 0) >= (existing.createdAt || 0)) {
            deduped[idx] = ann;
          }
          return true;
        }
        return false;
      });
      if (!isDupe) {
        deduped.push(ann);
      }
    }

    state.annotations = deduped;
    saveAnnotationsToStorage(itemKey);
  } catch (e) {
    console.warn('Failed to load annotations:', e);
  }
}

function renderAnnotationsForPage(pageNum, viewport) {
  const highlightLayer = document.getElementById(`highlightlayer-page-${pageNum}`);
  if (!highlightLayer) return;
  highlightLayer.innerHTML = '';

  const pageIndex = pageNum - 1;
  const pageAnns = state.annotations.filter(a => {
    if (a.pageNum !== undefined) return a.pageNum === pageNum;
    if (a.pageIndex !== undefined) return a.pageIndex === pageIndex;
    return false;
  });

  pageAnns.forEach(ann => {
    const mode = ann.mode || (ann.annotationType === 3 ? 'underline' : 'highlight');
    const color = ann.color || '#ffd400';

    function attachMarkEvents(mark) {
      mark.dataset.annId = ann.id;
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        state.activeAnnotation = ann;
        state.selectedText = ann.text || '';
        state.selectedRange = null;

        // Sync mode buttons
        const modeHighlightBtn = document.getElementById('modeHighlightBtn');
        const modeUnderlineBtn = document.getElementById('modeUnderlineBtn');
        if (mode === 'underline') {
          state.annotationMode = 'underline';
          if (modeUnderlineBtn) modeUnderlineBtn.classList.add('active');
          if (modeHighlightBtn) modeHighlightBtn.classList.remove('active');
        } else {
          state.annotationMode = 'highlight';
          if (modeHighlightBtn) modeHighlightBtn.classList.add('active');
          if (modeUnderlineBtn) modeUnderlineBtn.classList.remove('active');
        }

        const markRect = mark.getBoundingClientRect();
        showTooltipAtRect(markRect);
      });
    }

    if (ann.source === 'zotero' && ann.rects) {
      // Zotero DB points converted by viewport
      ann.rects.forEach(r => {
        if (!Array.isArray(r) || r.length < 4) return;
        let left, top, width, height;
        if (viewport && typeof viewport.convertToViewportRectangle === 'function') {
          const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(r);
          left = Math.min(vx1, vx2);
          top = Math.min(vy1, vy2);
          width = Math.abs(vx1 - vx2);
          height = Math.abs(vy1 - vy2);
        } else {
          left = r[0] * state.scale;
          top = r[1] * state.scale;
          width = (r[2] - r[0]) * state.scale;
          height = (r[3] - r[1]) * state.scale;
        }

        const mark = document.createElement('div');
        mark.className = `pdf-annotation-mark mode-${mode}`;
        mark.style.left = `${left}px`;
        mark.style.top = `${top}px`;
        mark.style.width = `${width}px`;
        mark.style.height = `${height}px`;
        if (mode === 'underline') {
          mark.style.borderBottomColor = color;
        } else {
          mark.style.backgroundColor = color;
        }
        attachMarkEvents(mark);
        highlightLayer.appendChild(mark);
      });
    } else if (ann.rects) {
      // Local annotations normalized rects
      ann.rects.forEach(r => {
        const left = r.left * state.scale;
        const top = r.top * state.scale;
        const width = r.width * state.scale;
        const height = r.height * state.scale;

        const mark = document.createElement('div');
        mark.className = `pdf-annotation-mark mode-${mode}`;
        mark.style.left = `${left}px`;
        mark.style.top = `${top}px`;
        mark.style.width = `${width}px`;
        mark.style.height = `${height}px`;
        if (mode === 'underline') {
          mark.style.borderBottomColor = color;
        } else {
          mark.style.backgroundColor = color;
        }
        attachMarkEvents(mark);
        highlightLayer.appendChild(mark);
      });
    }
  });
}

async function applyAnnotation(color, mode) {
  if (!state.selectedItem) {
    showToast('请先选择文献');
    return;
  }

  // 1. Direct mark edit (opened by clicking an existing annotation)
  if (state.activeAnnotation) {
    const ann = state.activeAnnotation;
    const pageNum = ann.pageNum || (ann.pageIndex !== undefined ? ann.pageIndex + 1 : 1);

    // Toggle OFF if user clicks the SAME color AND mode!
    if (ann.color === color && ann.mode === mode) {
      state.annotations = state.annotations.filter(a => a.id !== ann.id);
      saveAnnotationsToStorage(state.selectedItem.itemKey);
      deleteAnnotationOnServer(state.selectedItem.itemKey, ann.id);
      renderAnnotationsForPage(pageNum);
      state.activeAnnotation = null;
      hideSelectionTooltip();
      showToast('已取消标注');
      return;
    }

    // Otherwise update color / mode in-place (no stacking!)
    ann.color = color;
    ann.mode = mode;
    saveAnnotationsToStorage(state.selectedItem.itemKey);
    try {
      fetch(`/api/annotations/${encodeURIComponent(state.selectedItem.itemKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ann),
      }).catch(() => {});
    } catch (e) {}

    renderAnnotationsForPage(pageNum);
    state.activeAnnotation = null;
    hideSelectionTooltip();
    showToast(mode === 'underline' ? '已更新为下划线' : '已更新标注颜色');
    return;
  }

  // 2. Text selected via range
  if (!state.selectedRange) {
    showToast('请先划选正文文本');
    return;
  }

  const range = state.selectedRange;
  const text = state.selectedText;
  if (!text) return;

  const pageWrapper = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer.closest('.pdf-page-wrapper')
    : range.commonAncestorContainer.parentElement?.closest('.pdf-page-wrapper');

  if (!pageWrapper) {
    showToast('未能定位页面位置');
    return;
  }

  const pageNum = parseInt(pageWrapper.dataset.pageNum, 10);
  const pageRect = pageWrapper.getBoundingClientRect();
  const clientRects = range.getClientRects();

  const normalizedRects = [];
  for (let i = 0; i < clientRects.length; i++) {
    const r = clientRects[i];
    if (r.width > 0 && r.height > 0) {
      normalizedRects.push({
        left: (r.left - pageRect.left) / state.scale,
        top: (r.top - pageRect.top) / state.scale,
        width: r.width / state.scale,
        height: r.height / state.scale,
      });
    }
  }

  if (normalizedRects.length === 0) return;

  // Overlap detection with existing annotations
  const overlapping = state.annotations.filter(a => isAnnotationOverlapping(a, pageNum, normalizedRects, text));

  if (overlapping.length > 0) {
    const firstOverlapping = overlapping[0];
    // If user clicked the SAME color AND mode: TOGGLE OFF / REMOVE
    if (firstOverlapping.color === color && (firstOverlapping.mode || 'highlight') === mode) {
      const removedIds = overlapping.map(a => a.id);
      state.annotations = state.annotations.filter(a => !removedIds.includes(a.id));
      saveAnnotationsToStorage(state.selectedItem.itemKey);
      removedIds.forEach(id => deleteAnnotationOnServer(state.selectedItem.itemKey, id));
      renderAnnotationsForPage(pageNum);
      hideSelectionTooltip();
      showToast('已取消标注');
      return;
    }

    // Different color or mode: REPLACE (remove old overlapping, apply new, NO STACKING!)
    const removedIds = overlapping.map(a => a.id);
    state.annotations = state.annotations.filter(a => !removedIds.includes(a.id));
    removedIds.forEach(id => deleteAnnotationOnServer(state.selectedItem.itemKey, id));
  }

  const annId = 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const ann = {
    id: annId,
    itemKey: state.selectedItem.itemKey,
    pageNum: pageNum,
    color: color,
    mode: mode,
    text: text,
    rects: normalizedRects,
    createdAt: Date.now(),
  };

  state.annotations.push(ann);
  saveAnnotationsToStorage(state.selectedItem.itemKey);

  // Sync to sidecar backend
  try {
    fetch(`/api/annotations/${encodeURIComponent(state.selectedItem.itemKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ann),
    }).catch(() => {});
  } catch (e) {}

  renderAnnotationsForPage(pageNum);

  if (!state.isTranslationOpen) {
    hideSelectionTooltip();
  }
  showToast(mode === 'underline' ? '已添加下划线标注' : '已添加高亮标注');
}

function clearCurrentAnnotation() {
  if (!state.selectedItem) return;

  let targetPageNum = null;
  const removedIds = [];

  if (state.activeAnnotation) {
    targetPageNum = state.activeAnnotation.pageNum || (state.activeAnnotation.pageIndex !== undefined ? state.activeAnnotation.pageIndex + 1 : 1);
    removedIds.push(state.activeAnnotation.id);
    state.annotations = state.annotations.filter(a => a.id !== state.activeAnnotation.id);
  } else if (state.selectedRange) {
    const range = state.selectedRange;
    const pageWrapper = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer.closest('.pdf-page-wrapper')
      : range.commonAncestorContainer.parentElement?.closest('.pdf-page-wrapper');
    if (pageWrapper) {
      targetPageNum = parseInt(pageWrapper.dataset.pageNum, 10);
      const pageRect = pageWrapper.getBoundingClientRect();
      const clientRects = range.getClientRects();
      const normalizedRects = [];
      for (let i = 0; i < clientRects.length; i++) {
        const r = clientRects[i];
        if (r.width > 0 && r.height > 0) {
          normalizedRects.push({
            left: (r.left - pageRect.left) / state.scale,
            top: (r.top - pageRect.top) / state.scale,
            width: r.width / state.scale,
            height: r.height / state.scale,
          });
        }
      }
      const overlapping = state.annotations.filter(a => isAnnotationOverlapping(a, targetPageNum, normalizedRects, state.selectedText));
      overlapping.forEach(a => removedIds.push(a.id));
      if (removedIds.length > 0) {
        state.annotations = state.annotations.filter(a => !removedIds.includes(a.id));
      }
    }
  }

  if (removedIds.length > 0) {
    saveAnnotationsToStorage(state.selectedItem.itemKey);
    removedIds.forEach(id => deleteAnnotationOnServer(state.selectedItem.itemKey, id));
    if (targetPageNum) {
      renderAnnotationsForPage(targetPageNum);
    }
    showToast('已清除标注');
  } else {
    showToast('当前选中区域无标注');
  }

  state.activeAnnotation = null;
  hideSelectionTooltip();
}

// --- Translation Logic (Figure 2) ---
let currentTransWord = '';

async function toggleTranslation() {
  const tooltipTranslateBtn = document.getElementById('tooltipTranslateBtn');
  const tooltipTranslationCard = document.getElementById('tooltipTranslationCard');
  const transPhoneticsRow = document.getElementById('transPhoneticsRow');
  const usPhoneText = document.getElementById('usPhoneText');
  const ukPhoneText = document.getElementById('ukPhoneText');
  const transResultBody = document.getElementById('transResultBody');
  const speakUsBtn = document.getElementById('speakUsBtn');
  const speakUkBtn = document.getElementById('speakUkBtn');

  if (!state.selectedText) return;

  if (state.isTranslationOpen) {
    state.isTranslationOpen = false;
    if (tooltipTranslationCard) tooltipTranslationCard.style.display = 'none';
    if (tooltipTranslateBtn) tooltipTranslateBtn.classList.remove('active');
    return;
  }

  state.isTranslationOpen = true;
  if (tooltipTranslateBtn) tooltipTranslateBtn.classList.add('active');
  if (tooltipTranslationCard) tooltipTranslationCard.style.display = 'flex';
  if (transResultBody) transResultBody.textContent = '正在查询释义...';
  if (transPhoneticsRow) transPhoneticsRow.style.display = 'none';

  try {
    const s = state.settings || DEFAULT_SETTINGS;
    const reqPayload = {
      text: state.selectedText,
      engine: s.transEngine || 'builtin',
      api_base: s.transApiBase,
      api_key: s.transApiKey,
      model: s.transModel,
      prompt: s.transPrompt,
    };

    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqPayload),
    });

    if (!res.ok) {
      if (transResultBody) transResultBody.textContent = `翻译服务响应异常 (HTTP ${res.status})，请刷新侧边栏重试`;
      return;
    }
    const data = await res.json();
    if (!data.success) {
      if (transResultBody) transResultBody.textContent = data.error || '未能查询到该词释义';
      return;
    }

    currentTransWord = data.query || state.selectedText;
    if (data.is_word && (data.usphone || data.ukphone)) {
      if (transPhoneticsRow) transPhoneticsRow.style.display = 'flex';
      if (usPhoneText) usPhoneText.textContent = data.usphone ? `[${data.usphone}]` : '';
      if (ukPhoneText) ukPhoneText.textContent = data.ukphone ? `[${data.ukphone}]` : '';
      if (speakUsBtn) speakUsBtn.style.display = data.usphone ? 'flex' : 'none';
      if (speakUkBtn) speakUkBtn.style.display = data.ukphone ? 'flex' : 'none';
    } else {
      if (transPhoneticsRow) transPhoneticsRow.style.display = 'none';
    }

    if (transResultBody) transResultBody.textContent = data.translation || '（无释义）';

    // Auto-adjust tooltip vertical position if expanding past window bottom
    setTimeout(() => {
      if (selectionTooltipEl && selectionTooltipEl.classList.contains('show')) {
        const tooltipRect = selectionTooltipEl.getBoundingClientRect();
        if (tooltipRect.bottom > window.innerHeight - 10) {
          const overflow = tooltipRect.bottom - (window.innerHeight - 10);
          const currentTop = parseFloat(selectionTooltipEl.style.top) || 0;
          selectionTooltipEl.style.top = `${Math.max(10, currentTop - overflow)}px`;
        }
      }
    }, 50);
  } catch (e) {
    if (transResultBody) transResultBody.textContent = '查询释义失败: ' + e.message;
  }
}

function speakCurrentWord(lang = 'en-US') {
  if (!currentTransWord) return;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(currentTransWord);
    u.lang = lang;
    window.speechSynthesis.speak(u);
  }
}

// Text Selection & Action Tooltip
function handleTextSelection(e) {
  // If clicked inside selection tooltip, do not collapse
  if (selectionTooltipEl && selectionTooltipEl.contains(e.target)) {
    return;
  }

  const selection = window.getSelection();
  let text = selection ? selection.toString() : '';
  text = text.trim();

  if (text.length >= 1) {
    try {
      const range = selection.getRangeAt(0);

      // Zotero-style Smart Word Snapping & Boundary Precision
      const isSingleWord = !/\s/.test(text);
      if (isSingleWord && text.length > 0) {
        // 1. Strip leading and trailing punctuation (e.g. "model," -> "model", "(BERT)" -> "BERT")
        const cleaned = text.replace(/^[^\w\u4e00-\u9fa5]+|[^\w\u4e00-\u9fa5]+$/g, '');
        if (cleaned.length > 0 && cleaned !== text) {
          if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
            const rawNodeText = range.startContainer.textContent;
            const subStr = rawNodeText.substring(range.startOffset, range.endOffset);
            const leadMatch = subStr.match(/^[^\w\u4e00-\u9fa5]+/);
            const trailMatch = subStr.match(/[^\w\u4e00-\u9fa5]+$/);
            const leadLen = leadMatch ? leadMatch[0].length : 0;
            const trailLen = trailMatch ? trailMatch[0].length : 0;

            if (range.endOffset - trailLen > range.startOffset + leadLen) {
              range.setStart(range.startContainer, range.startOffset + leadLen);
              range.setEnd(range.startContainer, range.endOffset - trailLen);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
          text = cleaned;
        }

        // 2. Multi-span word fragmentation check on double click
        if (e.detail >= 2 && range.startContainer && range.startContainer.parentElement) {
          const currentSpan = range.startContainer.parentElement;
          if (currentSpan.classList && (currentSpan.tagName === 'SPAN' || currentSpan.closest('.textLayer'))) {
            const nextSpan = currentSpan.nextElementSibling;
            if (nextSpan && nextSpan.tagName === 'SPAN' && nextSpan.firstChild) {
              const nextText = nextSpan.textContent || '';
              if (/[\w\u4e00-\u9fa5]$/.test(text) && /^[\w\u4e00-\u9fa5]/.test(nextText)) {
                const curRect = currentSpan.getBoundingClientRect();
                const nextRect = nextSpan.getBoundingClientRect();
                if (Math.abs(curRect.top - nextRect.top) < 6 && (nextRect.left - curRect.right) < 6) {
                  const nextWordPart = nextText.split(/[\s\p{P}]/u)[0];
                  if (nextWordPart) {
                    range.setEnd(nextSpan.firstChild, nextWordPart.length);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    text = text + nextWordPart;
                  }
                }
              }
            }
          }
        }
      } else if (text.length > 0) {
        // Multi-word selection: clean line-break hyphens e.g. "convolu-\n tional" -> "convolutional"
        text = text.replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2').replace(/\s+/g, ' ').trim();
      }

      state.activeAnnotation = null;
      state.selectedText = text;
      state.selectedRange = range.cloneRange();
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hideSelectionTooltip();
        return;
      }

      showTooltipAtRect(rect);
    } catch (err) {
      hideSelectionTooltip();
    }
  } else {
    // If not dragging/selecting text, hit-test if user clicked directly on an existing mark
    const targetWrapper = e.target.closest ? e.target.closest('.pdf-page-wrapper') : null;
    if (targetWrapper && state.annotations && state.annotations.length > 0) {
      const pageNum = parseInt(targetWrapper.dataset.pageNum, 10);
      const pageRect = targetWrapper.getBoundingClientRect();
      const clickX = (e.clientX - pageRect.left) / state.scale;
      const clickY = (e.clientY - pageRect.top) / state.scale;

      const clickedAnn = state.annotations.find(ann => {
        const annPage = ann.pageNum !== undefined ? ann.pageNum : (ann.pageIndex !== undefined ? ann.pageIndex + 1 : 1);
        if (annPage !== pageNum) return false;
        if (!ann.rects) return false;
        return ann.rects.some(r => {
          let rectObj = r;
          if (Array.isArray(r) && r.length >= 4) {
            rectObj = {
              left: Math.min(r[0], r[2]),
              top: Math.min(r[1], r[3]),
              width: Math.abs(r[2] - r[0]),
              height: Math.abs(r[3] - r[1]),
            };
          }
          return clickX >= (rectObj.left - 4) && clickX <= (rectObj.left + rectObj.width + 4) &&
                 clickY >= (rectObj.top - 2) && clickY <= (rectObj.top + rectObj.height + 2);
        });
      });

      if (clickedAnn) {
        state.activeAnnotation = clickedAnn;
        state.selectedText = clickedAnn.text || '';
        state.selectedRange = null;

        const modeHighlightBtn = document.getElementById('modeHighlightBtn');
        const modeUnderlineBtn = document.getElementById('modeUnderlineBtn');
        const annMode = clickedAnn.mode || (clickedAnn.annotationType === 3 ? 'underline' : 'highlight');
        if (annMode === 'underline') {
          state.annotationMode = 'underline';
          if (modeUnderlineBtn) modeUnderlineBtn.classList.add('active');
          if (modeHighlightBtn) modeHighlightBtn.classList.remove('active');
        } else {
          state.annotationMode = 'highlight';
          if (modeHighlightBtn) modeHighlightBtn.classList.add('active');
          if (modeUnderlineBtn) modeUnderlineBtn.classList.remove('active');
        }

        showTooltipAtRect({
          left: e.clientX,
          top: e.clientY,
          right: e.clientX,
          bottom: e.clientY,
          width: 0,
          height: 0,
        });
        return;
      }
    }

    state.activeAnnotation = null;
    hideSelectionTooltip();
  }
}

function hideSelectionTooltip() {
  selectionTooltipEl.classList.remove('show');
  state.isTranslationOpen = false;
  const tooltipTranslationCard = document.getElementById('tooltipTranslationCard');
  const tooltipTranslateBtn = document.getElementById('tooltipTranslateBtn');
  if (tooltipTranslationCard) tooltipTranslationCard.style.display = 'none';
  if (tooltipTranslateBtn) tooltipTranslateBtn.classList.remove('active');
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
