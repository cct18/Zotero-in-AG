import { state, applySettings, escapeHtml } from '../state.js';
import { registerTextLayerSentinel, textLayersSentinelMap } from './shield.js';
import { loadAnnotations, renderAnnotationsForPage } from '../annotations/layer.js';

const pdfjsLib = window['pdfjs-dist/build/pdf'];
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.js';
}

export function updateZoom(newScale) {
  state.scale = Math.round(newScale * 100) / 100;
  const zoomPercentEl = document.getElementById('zoomPercent');
  if (zoomPercentEl) {
    zoomPercentEl.textContent = `${Math.round(state.scale * 100)}%`;
  }
  reRenderPages();
}

export function fitWidth() {
  const pdfContainerEl = document.getElementById('pdfContainer');
  if (!state.firstPageWidth || !pdfContainerEl) return;
  const containerWidth = pdfContainerEl.clientWidth - 48; // padding margin
  if (containerWidth > 100) {
    const newScale = containerWidth / state.firstPageWidth;
    updateZoom(Math.max(0.5, Math.min(2.5, newScale)));
  }
}

export function showNoPdfState() {
  state.currentPdfDoc = null;
  const pageIndicatorEl = document.getElementById('pageIndicator');
  const pdfContainerEl = document.getElementById('pdfContainer');
  if (pageIndicatorEl) pageIndicatorEl.textContent = '无 PDF 附件';
  if (pdfContainerEl) {
    pdfContainerEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <h3>该条目暂无本地 PDF 原文</h3>
        <p style="font-size: 12px; max-width: 400px; line-height: 1.6;">
          ${escapeHtml(state.selectedItem?.abstractNote || '未收录摘要。您可在 Zotero 桌面端中添加附件或通过 DOI 下载。')}
        </p>
      </div>
    `;
  }
}

export function setupContinuousObserver() {
  const pdfContainerEl = document.getElementById('pdfContainer');
  const pageIndicatorEl = document.getElementById('pageIndicator');
  if (!pdfContainerEl) return;

  const options = {
    root: pdfContainerEl,
    rootMargin: '200px 0px 200px 0px',
    threshold: 0.1,
  };

  state.observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const pageNum = parseInt(entry.target.dataset.pageNum, 10);
      if (entry.isIntersecting) {
        state.currentPageNum = pageNum;
        if (pageIndicatorEl) {
          pageIndicatorEl.textContent = `${pageNum} / ${state.totalPdfPages}`;
        }
        renderPage(pageNum);
      } else {
        const pageWrapper = entry.target;
        const canvas = pageWrapper.querySelector('canvas');
        if (canvas && state.renderedPages.has(pageNum)) {
          const ctx = canvas.getContext('2d');
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          canvas.width = 1;
          canvas.height = 1;
          const textLayer = pageWrapper.querySelector('.textLayer');
          if (textLayer) {
            textLayer.innerHTML = '';
          }
          state.renderedPages.delete(pageNum);
        }
      }
    });
  }, options);

  for (let p = 1; p <= state.totalPdfPages; p++) {
    const el = document.getElementById(`pdf-page-${p}`);
    if (el) state.observer.observe(el);
  }
}

export async function renderPage(pageNum) {
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

    let endDiv = textLayer.querySelector('.endOfContent');
    if (!endDiv) {
      endDiv = document.createElement('div');
      endDiv.className = 'endOfContent';
      textLayer.appendChild(endDiv);
    }
    registerTextLayerSentinel(textLayer, endDiv);

    renderAnnotationsForPage(pageNum, viewport);

    state.renderedPages.add(pageNum);
  } catch (err) {
    console.error(`Render page ${pageNum} error:`, err);
  } finally {
    state.renderingPages.delete(pageNum);
  }
}

export function reRenderPages() {
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

  const start = Math.max(1, state.currentPageNum - 1);
  const end = Math.min(state.totalPdfPages, state.currentPageNum + 2);
  for (let p = start; p <= end; p++) {
    renderPage(p);
  }
}

export function scrollToPage(pageNum) {
  const target = document.getElementById(`pdf-page-${pageNum}`);
  const pageIndicatorEl = document.getElementById('pageIndicator');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    state.currentPageNum = pageNum;
    if (pageIndicatorEl) {
      pageIndicatorEl.textContent = `${pageNum} / ${state.totalPdfPages}`;
    }
  }
}

export async function loadPdfContinuous(pdfUrl) {
  const pageIndicatorEl = document.getElementById('pageIndicator');
  const pdfContainerEl = document.getElementById('pdfContainer');
  const zoomPercentEl = document.getElementById('zoomPercent');

  try {
    if (pageIndicatorEl) pageIndicatorEl.textContent = '正在加载 PDF...';
    if (pdfContainerEl) pdfContainerEl.innerHTML = '<div style="color: var(--fg-muted); padding: 30px; font-size: 13px;">正在解析文档页码...</div>';

    if (state.observer) {
      state.observer.disconnect();
    }
    state.renderedPages.clear();
    state.renderingPages.clear();
    textLayersSentinelMap.clear();

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      cMapUrl: '/static/vendor/pdfjs/cmaps/',
      cMapPacked: true,
    });

    state.currentPdfDoc = await loadingTask.promise;
    state.totalPdfPages = state.currentPdfDoc.numPages;
    state.currentPageNum = 1;
    if (pageIndicatorEl) pageIndicatorEl.textContent = `1 / ${state.totalPdfPages}`;

    const firstPage = await state.currentPdfDoc.getPage(1);
    const unscaledViewport = firstPage.getViewport({ scale: 1.0 });
    state.firstPageWidth = unscaledViewport.width;

    const availableWidth = ((pdfContainerEl ? pdfContainerEl.clientWidth : 800) || 800) - 32;
    if (availableWidth > 150 && state.firstPageWidth > 0) {
      state.scale = Math.round((availableWidth / state.firstPageWidth) * 100) / 100;
      state.scale = Math.max(0.5, Math.min(2.5, state.scale));
    }
    if (zoomPercentEl) zoomPercentEl.textContent = `${Math.round(state.scale * 100)}%`;

    applySettings();
    if (pdfContainerEl) {
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
    }

    setupContinuousObserver();

    renderPage(1);
    if (state.totalPdfPages > 1) {
      renderPage(2);
    }
  } catch (e) {
    console.error('Failed to load PDF:', e);
    if (pdfContainerEl) {
      pdfContainerEl.innerHTML = `<div class="empty-state"><p>加载 PDF 出错: ${escapeHtml(e.message)}</p></div>`;
    }
  }
}
