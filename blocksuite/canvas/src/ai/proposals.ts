// How AI work shows on the board.
//  · Pending: what the AI added looks translucent; what it changed gets the same hairline box as
//    "working". A small capsule under it: the AI's one-line note, Keep, Discard.
//    Enter / double-click keeps, Esc discards (one undo step, so nothing of it stays).
//  · Kept: everything looks like the user's own, plus a small static 2×2 mark at the corner of
//    each AI-made thing — the same mark as "working", just still.

import { aiIds, markUser } from './provenance';
import type { Box } from './reading';

type El = HTMLElement;
const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

export function mountProposals(rootEl: any) {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const layer = h('div', 'cx-prop-layer'); document.body.append(layer);
  const marks = h('div', 'cx-marks'); document.body.append(marks);
  const bar = h('div', 'cx-prop-bar', `<span class="cx-prop-say"></span><button class="cx-prop-keep" type="button">Keep</button><button class="cx-prop-drop" type="button">Discard</button>`);
  layer.append(bar);
  const say = bar.querySelector('.cx-prop-say') as El;
  let pending: { created: string[]; changed: string[]; depth: number; resolve: (kept: boolean) => void } | null = null;
  const stack = () => store.history?.undoManager?.undoStack?.length ?? 0;

  const toView = (b: Box) => {
    const rr = rootEl.getBoundingClientRect();
    const [x0, y0] = gfx.viewport.toViewCoord(b.x, b.y), [x1, y1] = gfx.viewport.toViewCoord(b.x + b.w, b.y + b.h);
    return { x: rr.left + x0, y: rr.top + y0, w: x1 - x0, h: y1 - y0 };
  };
  const boxOf = (id: string): Box | null => { const e = gfx.getElementById(id); return e ? e.elementBound : null; };

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
    // pending veils and boxes
    let html = '';
    if (pending) {
      for (const id of pending.created) {
        const e: any = gfx.getElementById(id); if (!e || e.type === 'connector' || e.type === 'group') continue;
        const v = toView(e.elementBound);
        html += `<div class="cx-veil" style="left:${v.x}px;top:${v.y}px;width:${v.w}px;height:${v.h}px"></div>`;
      }
      for (const id of pending.changed) {
        const b = boxOf(id); if (!b) continue; const v = toView(b);
        html += `<div class="cx-pend-box on" style="left:${v.x - 4}px;top:${v.y - 4}px;width:${v.w + 8}px;height:${v.h + 8}px"></div>`;
      }
      const all = [...pending.created, ...pending.changed].map(boxOf).filter(Boolean) as Box[];
      if (all.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const b of all) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
        const v = toView({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        const bw = bar.offsetWidth || 220, bh = 40;
        let top = v.y + v.h + 14; if (top + bh > innerHeight - 90) top = Math.max(12, v.y - bh - 14);
        bar.style.left = `${Math.max(12, Math.min(v.x + v.w / 2 - bw / 2, innerWidth - bw - 12))}px`; bar.style.top = `${top}px`;
      }
    }
    // kept marks
    let mh = '';
    for (const id of markable()) {
      if (pending?.created.includes(id)) continue;
      const b = boxOf(id); if (!b) continue; const v = toView(b);
      if (v.x + v.w < 0 || v.y + v.h < 0 || v.x > innerWidth || v.y > innerHeight || v.w < 20) continue;
      mh += `<i class="cx-ai-mark" style="left:${v.x + v.w + 5}px;top:${v.y - 1}px"><b></b><b></b><b></b><b></b></i>`;
    }
    marks.innerHTML = mh;
    layer.querySelectorAll('.cx-veil, .cx-pend-box').forEach(n => n.remove());
    bar.insertAdjacentHTML('beforebegin', html);
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

  function finish(kept: boolean) {
    if (!pending) return;
    const p = pending; pending = null;
    bar.classList.remove('on');
    if (!kept) {
      // undo everything since the answer was placed, including late layout writes (connector routes, note heights)
      store.captureSync();
      for (let i = 0; i < 50 && stack() > p.depth; i++) store.undo();
      markUser(store, p.created);
    }
    p.resolve(kept);
    redraw();
  }
  bar.querySelector('.cx-prop-keep')!.addEventListener('click', () => finish(true));
  bar.querySelector('.cx-prop-drop')!.addEventListener('click', () => finish(false));
  addEventListener('keydown', e => {
    if (!pending) return;
    const t = e.target as El; if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  }, true);
  addEventListener('dblclick', e => {
    if (!pending) return;
    const rr = rootEl.getBoundingClientRect();
    const [mx, my] = gfx.viewport.toModelCoord(e.clientX - rr.left, e.clientY - rr.top);
    const hit = [...pending.created, ...pending.changed].some(id => { const b = boxOf(id); return b && mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h; });
    if (hit) { e.stopPropagation(); e.preventDefault(); finish(true); }
  }, true);

  return {
    /** Show a fresh result as a proposal; resolves when the user keeps or discards it. */
    propose(created: string[], changed: string[], note?: string, depth = 0): Promise<boolean> {
      if (pending) finish(true);
      return new Promise(resolve => {
        pending = { created, changed, depth, resolve };
        say.textContent = note ?? ''; say.hidden = !note;
        bar.classList.add('on');
        redraw();
      });
    },
    get busy() { return !!pending; },
    /** Undo depth to return to on Discard; read it before placing the answer. */
    depth: stack,
  };
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
