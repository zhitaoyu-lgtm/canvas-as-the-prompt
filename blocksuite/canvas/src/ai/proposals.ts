// How AI work shows on the board: the answer is placed directly and looks like the user's own,
// plus a small static 2×2 mark at the corner of each AI-made thing — the "working" mark, still.

import { aiIds } from './provenance';
import type { Box } from './reading';

type El = HTMLElement;
const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export function mountProposals(rootEl: any) {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const marks = h('div', 'cx-marks'); document.body.append(marks);

  const toView = (b: Box) => {
    const rr = rootEl.getBoundingClientRect();
    const [x0, y0] = gfx.viewport.toViewCoord(b.x, b.y), [x1, y1] = gfx.viewport.toViewCoord(b.x + b.w, b.y + b.h);
    return { x: rr.left + x0, y: rr.top + y0, w: x1 - x0, h: y1 - y0 };
  };
  // which AI things get a mark: top-level ones (a legend group, not its parts); no lines
  const markable = () => {
    const ids = new Set(aiIds(store));
    return [...ids].filter(id => {
      const e: any = gfx.getElementById(id); if (!e || e.type === 'connector') return false;
      const g = e.group; return !(g && ids.has(g.id));
    });
  };

  let raf = 0;
  const draw = () => {
    raf = 0;
    let mh = '';
    for (const id of markable()) {
      const e: any = gfx.getElementById(id); if (!e) continue;
      const v = toView(e.elementBound);
      if (v.x + v.w < 0 || v.y + v.h < 0 || v.x > innerWidth || v.y > innerHeight || v.w < 20) continue;
      mh += `<i class="cx-ai-mark" style="left:${v.x + v.w + 5}px;top:${v.y - 1}px"><b></b><b></b><b></b><b></b></i>`;
    }
    marks.innerHTML = mh;
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  gfx.viewport.viewportUpdated?.subscribe?.(redraw);
  store.slots?.blockUpdated?.subscribe?.(redraw);
  gfx.surface?.elementUpdated?.subscribe?.(redraw);
  gfx.surface?.elementAdded?.subscribe?.(redraw);
  gfx.surface?.elementRemoved?.subscribe?.(redraw);
  addEventListener('resize', redraw);
  setInterval(redraw, 1000);   // cheap safety net for changes no slot reports
  redraw();
  return { redraw };
}

/** A short line near a point, for errors; fades by itself. */
export function toast(msg: string, at?: { x: number; y: number }) {
  const t = h('div', 'cx-toast'); t.textContent = msg; document.body.append(t);
  const w = t.offsetWidth;
  t.style.left = `${Math.max(12, Math.min((at?.x ?? innerWidth / 2) - w / 2, innerWidth - w - 12))}px`;
  t.style.top = `${at?.y ?? 80}px`;
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, 3200);
}
