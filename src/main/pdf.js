const fs = require('fs');
const path = require('path');

let pdfjsLibPromise = null;
function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLibPromise;
}

function applyMatrixToPoint(m, p) {
  const [a, b, c, d, e, f] = m;
  const [x, y] = p;
  return [a * x + c * y + e, b * x + d * y + f];
}

function rectFromQuadPoints(quadPoints) {
  // quadPoints is array of 8 numbers per rect [x1,y1,x2,y2,x3,y3,x4,y4]
  const rects = [];
  for (let i = 0; i < quadPoints.length; i += 8) {
    const xs = [quadPoints[i], quadPoints[i + 2], quadPoints[i + 4], quadPoints[i + 6]];
    const ys = [quadPoints[i + 1], quadPoints[i + 3], quadPoints[i + 5], quadPoints[i + 7]];
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    rects.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  }
  return rects;
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

async function extractHighlightedText(page, annotation) {
  try {
    const quadPoints = annotation.quadPoints || annotation.quadpoints || annotation.QuadPoints;
    if (!quadPoints || !quadPoints.length) return '';
    const textContent = await page.getTextContent({ includeMarkedContent: true });
    const viewport = page.getViewport({ scale: 1.0 });
    const vm = viewport.transform;
    const rectsVp = rectFromQuadPoints(quadPoints).map(r => {
      const p1 = applyMatrixToPoint(vm, [r.x, r.y]);
      const p2 = applyMatrixToPoint(vm, [r.x + r.w, r.y + r.h]);
      const x = Math.min(p1[0], p2[0]);
      const y = Math.min(p1[1], p2[1]);
      const w = Math.abs(p2[0] - p1[0]);
      const h = Math.abs(p2[1] - p1[1]);
      return { x, y, w, h };
    });

    const captured = [];
    for (let idx = 0; idx < textContent.items.length; idx++) {
      const it = textContent.items[idx];
      const t = it.transform; // [a,b,c,d,e,f]
      const [x0, y0] = applyMatrixToPoint(vm, [t[4], t[5]]);
      const w = (it.width || 0) * Math.hypot(vm[0], vm[1]);
      const h = Math.hypot(t[2], t[3]) * Math.hypot(vm[2], vm[3]) || 0;
      const cx = x0 + (w || 0) / 2;
      const cy = y0 - (h || 0) / 2; // y decreases downward in viewport
      if (rectsVp.some(r => pointInRect(cx, cy, r))) {
        captured.push(it.str);
      }
    }
    // Merge contiguous spaces
    const text = captured.join('').replace(/\s+$/g, '').replace(/^\s+/g, '');
    const minY = Math.min(...rectsVp.map(r => r.y));
    const maxY = Math.max(...rectsVp.map(r => r.y + r.h));
    return { text, minY, maxY };
  } catch (e) {
    return { text: '', minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
  }
}

async function extractHighlightsFromFile(filePath) {
  /* */
  const pdfjsLib = await getPdfjs();
  const buffer = fs.readFileSync(filePath);
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableWorker: true });
  const doc = await loadingTask.promise;
  let title = '';
  try {
    const meta = await doc.getMetadata();
    title = meta?.info?.Title || meta?.metadata?.get('dc:title') || '';
  } catch {}
  const notes = [];
  const numPages = doc.numPages || 0;
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const annots = await page.getAnnotations();
      for (const a of annots) {
        const subtype = (a.subtype || '').toLowerCase();
        if (subtype === 'highlight' || subtype === 'underline' || subtype === 'squiggly') {
          const { text, minY, maxY } = await extractHighlightedText(page, a);
          notes.push({
            page: i,
            subtype: a.subtype || 'Highlight',
            contents: (a.contents || '').trim(),
            text: text || '',
            minY,
            maxY,
            color: a.color || null,
          });
        }
      }
    } catch (e) {
      // ignore page errors; continue
    }
  }
  // 分组：同页内按纵向排序，连续（前一高亮的 maxY 与后一高亮的 minY 距离很小）归为一组
  const groups = [];
  const byPage = new Map();
  for (const n of notes) {
    const arr = byPage.get(n.page) || [];
    arr.push(n);
    byPage.set(n.page, arr);
  }
  for (const [page, arr] of byPage.entries()) {
    arr.sort((a, b) => (a.minY - b.minY));
    let current = null;
    const threshold = 8; // viewport 像素，近似换行间距
    for (const n of arr) {
      if (!current) {
        current = { page, minY: n.minY, maxY: n.maxY, items: [n] };
        continue;
      }
      if (n.minY - current.maxY <= threshold) {
        current.items.push(n);
        current.maxY = Math.max(current.maxY, n.maxY);
      } else {
        groups.push(current);
        current = { page, minY: n.minY, maxY: n.maxY, items: [n] };
      }
    }
    if (current) groups.push(current);
  }
  // 排序组：有批注（组内任一 items 有 contents）的在前，然后按页码和纵向顺序
  groups.sort((g1, g2) => {
    const c1 = g1.items.some(x => x.contents && x.contents.length) ? 1 : 0;
    const c2 = g2.items.some(x => x.contents && x.contents.length) ? 1 : 0;
    if (c1 !== c2) return c2 - c1;
    if ((g1.page || 0) !== (g2.page || 0)) return (g1.page || 0) - (g2.page || 0);
    return g1.minY - g2.minY;
  });
  try { await doc.destroy(); } catch {}
  return {
    path: filePath,
    name: path.basename(filePath),
    title,
    notes,
    groups: groups.map(g => ({
      page: g.page,
      count: g.items.length,
      contents: g.items.map(i => i.contents).filter(Boolean),
      text: g.items.map(i => i.text).filter(Boolean).join(' '),
      items: g.items.map(({ page, subtype, contents, text, color }) => ({ page, subtype, contents, text, color }))
    }))
  };
}

async function extractHighlightsFromFiles(paths) {
  const out = [];
  for (const p of paths || []) {
    try {
      const info = await extractHighlightsFromFile(p);
      out.push(info);
    } catch (e) {
      out.push({ path: p, name: path.basename(p), title: '', notes: [], error: e?.message || String(e) });
    }
  }
  return out;
}

module.exports = { extractHighlightsFromFiles };
