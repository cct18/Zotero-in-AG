import { state, DEFAULT_SETTINGS, saveSettings, applySettings, showToast } from '../state.js';
import { testAiModel } from '../api.js';

export function updateRadioCards(name) {
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

export function openSettings() {
  const s = state.settings || DEFAULT_SETTINGS;
  const settingsModal = document.getElementById('settingsModal');

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
  const fullTextPromptInput = document.getElementById('fullTextPromptInput');
  const selectionPromptInput = document.getElementById('selectionPromptInput');
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

  const transApiBaseInput = document.getElementById('transApiBaseInput');
  const transApiKeyInput = document.getElementById('transApiKeyInput');
  const transModelInput = document.getElementById('transModelInput');
  const transPromptInput = document.getElementById('transPromptInput');
  const testApiStatus = document.getElementById('testApiStatus');

  if (transApiBaseInput) transApiBaseInput.value = s.transApiBase || DEFAULT_SETTINGS.transApiBase;
  if (transApiKeyInput) transApiKeyInput.value = s.transApiKey || '';
  if (transModelInput) transModelInput.value = s.transModel || DEFAULT_SETTINGS.transModel;
  if (transPromptInput) transPromptInput.value = s.transPrompt || DEFAULT_SETTINGS.transPrompt;
  if (testApiStatus) testApiStatus.textContent = '';

  if (settingsModal) settingsModal.style.display = 'flex';
}

export function closeSettings() {
  const settingsModal = document.getElementById('settingsModal');
  if (settingsModal) settingsModal.style.display = 'none';
  applySettings();
}

export function setupSettingsUi() {
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const settingsModal = document.getElementById('settingsModal');

  const fullTextPromptInput = document.getElementById('fullTextPromptInput');
  const selectionPromptInput = document.getElementById('selectionPromptInput');
  const resetFullPromptBtn = document.getElementById('resetFullPromptBtn');
  const resetSelectionPromptBtn = document.getElementById('resetSelectionPromptBtn');

  const transApiBaseInput = document.getElementById('transApiBaseInput');
  const transApiKeyInput = document.getElementById('transApiKeyInput');
  const transModelInput = document.getElementById('transModelInput');
  const transPromptInput = document.getElementById('transPromptInput');
  const resetTransPromptBtn = document.getElementById('resetTransPromptBtn');
  const testTransApiBtn = document.getElementById('testTransApiBtn');
  const testApiStatus = document.getElementById('testApiStatus');

  // Tab switching
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
      if (dot.dataset.color) {
        document.documentElement.style.setProperty('--accent-color', dot.dataset.color);
      }
    });
  });

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

  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeSettings);

  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettings();
    });
  }

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
        const data = await testAiModel({ api_base: apiBase, api_key: apiKey, model: model });
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
}
