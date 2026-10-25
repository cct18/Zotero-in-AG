// Zotero in AG Frontend State and Configuration

export const DEFAULT_SETTINGS = {
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

export function loadSettings() {
  try {
    const saved = localStorage.getItem('zotero_ag_settings');
    if (saved) {
      return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(saved));
    }
  } catch (e) {}
  return Object.assign({}, DEFAULT_SETTINGS);
}

export function saveSettings(newSettings) {
  state.settings = Object.assign({}, state.settings, newSettings);
  try {
    localStorage.setItem('zotero_ag_settings', JSON.stringify(state.settings));
  } catch (e) {}
  applySettings();
}

export function applySettings() {
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
  const pdfContainerEl = document.getElementById('pdfContainer');
  if (pdfContainerEl) {
    pdfContainerEl.classList.remove('filter-sepia', 'filter-dark');
    if (s.pdfFilter === 'sepia') {
      pdfContainerEl.classList.add('filter-sepia');
    } else if (s.pdfFilter === 'dark') {
      pdfContainerEl.classList.add('filter-dark');
    }
  }
}

export const state = {
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

export const ICON_DATE_DESC = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/></svg>`;
export const ICON_DATE_ASC = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 8h7"/><path d="M11 4h10"/></svg>`;

export function showToast(msg) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2800);
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function copyToClipboard(text, message) {
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
