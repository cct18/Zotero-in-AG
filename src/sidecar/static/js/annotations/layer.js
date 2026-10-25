import { state, showToast } from '../state.js';
import { fetchAnnotations, saveAnnotationOnServer, deleteAnnotationOnServer } from '../api.js';
import { showTooltipAtRect, hideSelectionTooltip } from '../ui/tooltip.js';

export function rectsOverlap(r1, r2) {
  const overlapX = Math.max(0, Math.min(r1.left + r1.width, r2.left + r2.width) - Math.max(r1.left, r2.left));
  const overlapY = Math.max(0, Math.min(r1.top + r1.height, r2.top + r2.height) - Math.max(r1.top, r2.top));
  const overlapArea = overlapX * overlapY;
  const minArea = Math.min(r1.width * r1.height, r2.width * r2.height);
  if (minArea <= 0) return false;
  return (overlapArea / minArea > 0.25) || (overlapY > 6 && overlapX > 10);
}

export function isAnnotationOverlapping(ann, pageNum, newRects, newText) {
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

export function saveAnnotationsToStorage(itemKey) {
  if (!itemKey) return;
  try {
    const localOnly = state.annotations.filter(a => a.source !== 'zotero');
    localStorage.setItem(`zotero_ag_annotations_${itemKey}`, JSON.stringify(localOnly));
  } catch (e) {}
}

export async function loadAnnotations(itemKey) {
  if (!itemKey) return;
  state.annotations = [];
  try {
    const data = await fetchAnnotations(itemKey);
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

export function renderAnnotationsForPage(pageNum, viewport) {
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

export async function applyAnnotation(color, mode) {
  if (!state.selectedItem) {
    showToast('请先选择文献');
    return;
  }

  // 1. Direct mark edit (opened by clicking an existing annotation)
  if (state.activeAnnotation) {
    const ann = state.activeAnnotation;
    if (ann.source === 'zotero' || String(ann.id).startsWith('zotero_')) {
      showToast('Zotero 原生批注为只读，请在桌面端客户端修改或删除');
      state.activeAnnotation = null;
      hideSelectionTooltip();
      return;
    }
    const pageNum = ann.pageNum || (ann.pageIndex !== undefined ? ann.pageIndex + 1 : 1);

    // Toggle OFF if user clicks the SAME color AND mode!
    if (ann.color === color && ann.mode === mode) {
      state.annotations = state.annotations.filter(a => a.id !== ann.id);
      saveAnnotationsToStorage(state.selectedItem.itemKey);
      deleteAnnotationOnServer(state.selectedItem.itemKey, ann.id).catch(() => {});
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
    saveAnnotationOnServer(state.selectedItem.itemKey, ann).catch(() => {});

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
      removedIds.forEach(id => deleteAnnotationOnServer(state.selectedItem.itemKey, id).catch(() => {}));
      renderAnnotationsForPage(pageNum);
      hideSelectionTooltip();
      showToast('已取消标注');
      return;
    }

    // Different color or mode: REPLACE (remove old overlapping, apply new, NO STACKING!)
    const removedIds = overlapping.map(a => a.id);
    state.annotations = state.annotations.filter(a => !removedIds.includes(a.id));
    removedIds.forEach(id => deleteAnnotationOnServer(state.selectedItem.itemKey, id).catch(() => {}));
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
  saveAnnotationOnServer(state.selectedItem.itemKey, ann).catch(() => {});

  renderAnnotationsForPage(pageNum);

  if (!state.isTranslationOpen) {
    hideSelectionTooltip();
  }
  showToast(mode === 'underline' ? '已添加下划线标注' : '已添加高亮标注');
}

export function clearCurrentAnnotation() {
  if (!state.selectedItem) return;

  let targetPageNum = null;
  const removedIds = [];

  if (state.activeAnnotation) {
    if (state.activeAnnotation.source === 'zotero' || String(state.activeAnnotation.id).startsWith('zotero_')) {
      showToast('Zotero 原生批注为只读，请在桌面端客户端修改或删除');
      state.activeAnnotation = null;
      hideSelectionTooltip();
      return;
    }
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
    removedIds.forEach(id => deleteAnnotationOnServer(state.selectedItem.itemKey, id).catch(() => {}));
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
