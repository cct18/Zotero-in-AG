// ==========================================
// Text Selection Boundary & Caret Projection Shield (Zotero & Mozilla PDF.js Standard)
// Algorithm Frozen - Do not alter mathematical projection or sentinel interception logic
// ==========================================

export const textLayersSentinelMap = new Map();

export function registerTextLayerSentinel(textLayer, endDiv) {
  textLayersSentinelMap.set(textLayer, endDiv);
}

export function initTextSelectionShield() {
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
