import { state, DEFAULT_SETTINGS, showToast, copyToClipboard } from '../state.js';
import { translateText } from '../api.js';

let currentTransWord = '';

export function showTooltipAtRect(rect) {
  state.isTranslationOpen = false;
  const tooltipTranslationCard = document.getElementById('tooltipTranslationCard');
  const tooltipTranslateBtn = document.getElementById('tooltipTranslateBtn');
  if (tooltipTranslationCard) tooltipTranslationCard.style.display = 'none';
  if (tooltipTranslateBtn) tooltipTranslateBtn.classList.remove('active');

  const selectionTooltipEl = document.getElementById('selectionTooltip');
  if (!selectionTooltipEl) return;

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

export function hideSelectionTooltip() {
  const selectionTooltipEl = document.getElementById('selectionTooltip');
  if (selectionTooltipEl) selectionTooltipEl.classList.remove('show');
  state.isTranslationOpen = false;
  const tooltipTranslationCard = document.getElementById('tooltipTranslationCard');
  const tooltipTranslateBtn = document.getElementById('tooltipTranslateBtn');
  if (tooltipTranslationCard) tooltipTranslationCard.style.display = 'none';
  if (tooltipTranslateBtn) tooltipTranslateBtn.classList.remove('active');
}

export async function toggleTranslation() {
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

    const data = await translateText(reqPayload);
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
      const selectionTooltipEl = document.getElementById('selectionTooltip');
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

export function speakCurrentWord(lang = 'en-US') {
  if (!currentTransWord) return;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(currentTransWord);
    u.lang = lang;
    window.speechSynthesis.speak(u);
  }
}

export function handleTextSelection(e) {
  const selectionTooltipEl = document.getElementById('selectionTooltip');
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
