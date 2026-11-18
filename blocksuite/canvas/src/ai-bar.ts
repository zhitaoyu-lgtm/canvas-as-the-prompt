// AI entry on the selection toolbar.
// One object, three forms: the element toolbar → (fold into the ring) → an input capsule → back.
// While the model works, the selection stays as it is; only a small ring beside it hops.
//
// The model is not wired yet: sending shows the working state, then returns. `onSubmit` is the hook
// the next step fills in (read the selection → ask the model → place proposals on the canvas).

import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { html } from 'lit';

// Line icon in the toolbar's own style (24px, stroke 1.4, currentColor): a four-point spark.
export const SPARK_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3.8c.55 4.2 2.65 6.35 6.9 6.95-4.25.6-6.35 2.75-6.9 6.95-.55-4.2-2.65-6.35-6.9-6.95 4.25-.6 6.35-2.75 6.9-6.95Z"/>
  <path d="M18.6 15.6v3.2M17 17.2h3.2" stroke-linecap="round"/>
</svg>`;

// ── The button that lives inside AFFiNE's toolbar ────────────────────────────────
class AiEntry extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { display: inline-flex; }
      /* same hit area as the bar; the visible hover is a 24px pill with 4px corners, like every other button */
      button { all: unset; box-sizing: border-box; height: 36px; padding: 0 4px; display: inline-flex; align-items: center; cursor: pointer; }
      .pill {
        display: inline-flex; align-items: center; height: 24px; padding: 0 6px; box-sizing: border-box;
        border-radius: 8px; color: var(--affine-icon-color, #77757d);
        font: 500 14px/1 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
        transition: background .12s ease;
      }
      button:hover .pill { background: var(--affine-hover-color, rgba(0,0,0,.04)); }
      button:active .pill { background: rgba(0,0,0,.07); }
      button:focus-visible .pill { outline: 2px solid #0c8ce9; outline-offset: 1px; }
      svg { display: block; }
    </style><button aria-label="Ask"><span class="pill">Ask</span></button>`;
    root.querySelector('button')!.addEventListener('click', e => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('cx-ai-open', { detail: { from: this } }));
    });
  }
}
if (!customElements.get('cx-ai-entry')) customElements.define('cx-ai-entry', AiEntry);

export const aiToolbarExtension = ToolbarModuleExtension({
  id: BlockFlavourIdentifier('custom:affine:*'),
  config: {
    actions: [{
      id: '0.cx-ai',
      placement: ActionPlacement.Start,
      when: (ctx: ToolbarContext) => ctx.isEdgelessMode && ctx.gfx.selection.selectedElements.length > 0 && !ctx.gfx.selection.editing,
      content: html`<cx-ai-entry></cx-ai-entry>`,
    }],
  } as any,
});

// ── The capsule and the working indicator ─────────────────────────────────────────
type El = HTMLElement;
const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

function deepFind(root: Document | ShadowRoot, pred: (e: Element) => boolean): El | null {
  for (const c of root.querySelectorAll('*')) {
    if (pred(c)) return c as El;
    if ((c as El).shadowRoot) { const r = deepFind((c as El).shadowRoot!, pred); if (r) return r; }
  }
  return null;
}

function describe(models: any[]): { label: string; kind: string } {
  const kinds = models.map(m => {
    const f = m.flavour ?? m.type;
    if (f === 'shape') return m.shapeType === 'rect' && m.filled && (m.strokeWidth ?? 0) === 0 ? 'sticky' : 'shape';
    if (f === 'affine:note') return 'doc';
    if (f === 'affine:image') return 'image';
    if (f === 'affine:frame') return 'frame';
    if (f === 'connector') return 'connector';
    if (f === 'text' || f === 'affine:edgeless-text') return 'text';
    if (f === 'brush' || f === 'highlighter') return 'drawing';
    if (f === 'mindmap') return 'mind map';
    return 'item';
  });
  const n = kinds.length;
  const same = kinds.every(k => k === kinds[0]);
  const noun = same ? kinds[0] : 'item';
  const plural = (w: string) => (w === 'sticky' ? 'stickies' : w === 'mind map' ? 'mind maps' : w + 's');
  return { label: n === 1 ? `this ${noun}` : `these ${n} ${plural(noun)}`, kind: same ? kinds[0] : 'mixed' };
}

export function mountAiBar(rootEl: any, onSubmit?: (prompt: string, ids: string[]) => Promise<boolean | void>) {
  const gfx = rootEl.gfx;
  const layer = h('div', 'cx-ai-layer');
  document.body.append(layer);

  const cap = h('div', 'cx-cap');
  cap.setAttribute('role', 'dialog');
  cap.innerHTML = `
    <span class="cx-cap-pivot" aria-hidden="true"><span>Ask</span></span>
    <form class="cx-cap-row">
      <input class="cx-cap-input" type="text" autocomplete="off" spellcheck="false" aria-label="Instruction">
      <button type="button" class="cx-cap-mic" aria-label="Dictate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="9" y="4" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></svg></button>
      <button type="submit" class="cx-cap-send" aria-label="Send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
    </form>`;
  layer.append(cap);
  const input = cap.querySelector('input') as HTMLInputElement;
  const form = cap.querySelector('form') as HTMLFormElement;

  // Pending: a hairline box around what was selected, and a 2×2 dot mark beside its top-left corner.
  const pendBox = h('div', 'cx-pend-box');
  const badge = h('div', 'cx-pend-dots', '<i></i><i></i><i></i><i></i>');
  badge.setAttribute('role', 'status'); badge.setAttribute('aria-label', 'Working');
  layer.append(pendBox, badge);

  let open = false, toolbar: El | null = null, ids: string[] = [], busy = false;
  let pivotL = 0, pivotW = 0, cutL = 0;
  const OPEN_W = 440;

  const toolbarEl = () => deepFind(document, e => e.tagName === 'EDITOR-TOOLBAR' && (e as El).getBoundingClientRect().width > 0);
  const toolbarKids = (t: El) => [...t.children].filter(c => c.tagName !== 'CX-AI-ENTRY' && !c.querySelector?.('cx-ai-entry')) as El[];

  // (the older flow, from the toolbar's Ask button; kept for the MCP/demo paths that call it)
  // @ts-ignore unused now that the dot opens the capsule
  async function openBar() {
    if (open || busy) return;
    toolbar = toolbarEl(); if (!toolbar) return;
    const sel = gfx.selection.selectedElements as any[];
    ids = sel.map(m => m.id);
    const { label } = describe(sel);
    input.value = ''; input.placeholder = `What should happen to ${label}?`;
    const r = toolbar.getBoundingClientRect();
    const entry = deepFind(toolbar, e => e.tagName === 'CX-AI-ENTRY') ?? deepFind(document, e => e.tagName === 'CX-AI-ENTRY' && (e as El).getBoundingClientRect().width > 0);
    const a = entry ? entry.getBoundingClientRect() : r;
    pivotL = a.left - 4; pivotW = r.right - pivotL; cutL = pivotL - r.left;
    open = true;

    // 1 · fold: everything slides right into "Ask", the bar narrows to it
    const kids = toolbarKids(toolbar);
    kids.forEach((k, i) => k.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(10px)' }], { duration: 120, delay: i * 12, fill: 'forwards', easing: 'ease-in' }));
    const fold = toolbar.animate([{ clipPath: 'inset(0 0 0 0 round 14px)' }, { clipPath: `inset(0 0 0 ${cutL}px round 14px)` }], { duration: 180, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    await fold.finished;

    // 2 · swap to the capsule in the same place, then grow it into an input centred on the selection
    cap.style.left = `${pivotL}px`; cap.style.top = `${r.top}px`; cap.style.height = `${r.height}px`;
    cap.style.width = `${pivotW}px`;
    cap.style.setProperty('--h', `${r.height}px`); cap.style.setProperty('--pw', `${pivotW}px`);
    cap.classList.add('on'); toolbar.style.visibility = 'hidden';
    await new Promise(res => setTimeout(res, 30));
    const w = Math.min(OPEN_W, innerWidth - 32);
    const cx = r.left + r.width / 2;
    const left = Math.max(16, Math.min(cx - w / 2, innerWidth - 16 - w));
    cap.animate([{ left: `${pivotL}px`, width: `${pivotW}px` }, { left: `${left}px`, width: `${w}px` }], { duration: 300, easing: 'cubic-bezier(.2,.9,.25,1.05)', fill: 'forwards' });
    cap.classList.add('wide');
    setTimeout(() => input.focus(), 180);
  }

  async function closeBar(restore = true) {
    if (!open) return;
    open = false;
    cap.classList.remove('wide');
    const cr = cap.getBoundingClientRect();
    await cap.animate([{ left: `${cr.left}px`, width: `${cr.width}px` }, { left: `${pivotL}px`, width: `${pivotW}px` }], { duration: 220, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).finished;
    cap.classList.remove('on'); cap.getAnimations().forEach(x => x.cancel());
    const t = toolbar; toolbar = null;
    if (!t) { placeDot(); return; }
    t.style.visibility = '';
    if (!restore) { t.getAnimations().forEach(x => x.cancel()); toolbarKids(t).forEach(k => k.getAnimations().forEach(x => x.cancel())); return; }
    t.animate([{ clipPath: `inset(0 0 0 ${cutL}px round 14px)` }, { clipPath: 'inset(0 0 0 0 round 14px)' }], { duration: 230, easing: 'cubic-bezier(.2,.9,.25,1.05)' }).finished.then(() => t.getAnimations().forEach(x => x.cancel()));
    const kids = toolbarKids(t);
    kids.forEach((k, i) => { k.getAnimations().forEach(x => x.cancel()); k.animate([{ opacity: 0, transform: 'translateX(10px)' }, { opacity: 1, transform: 'none' }], { duration: 160, delay: 40 + (kids.length - i) * 14, easing: 'ease-out', fill: 'backwards' }); });
  }

  // Working: the toolbar, handles and group label go away; only a thin, muted box and the dot mark stay.
  let follow = 0;
  function placeBadge() {
    const els = ids.map(id => gfx.getElementById(id)).filter(Boolean) as any[];
    if (!els.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) { const b = e.elementBound; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const rr = rootEl.getBoundingClientRect();
    const [ax, ay] = gfx.viewport.toViewCoord(x0, y0);
    const [bx, by] = gfx.viewport.toViewCoord(x1, y1);
    const pad = 4;
    const L = rr.left + ax - pad, T = rr.top + ay - pad;
    pendBox.style.left = `${L}px`; pendBox.style.top = `${T}px`;
    pendBox.style.width = `${bx - ax + pad * 2}px`; pendBox.style.height = `${by - ay + pad * 2}px`;
    badge.style.left = `${L + (bx - ax) + pad * 2 + 6}px`; badge.style.top = `${T + pad - 2}px`;   // where the selection dot was: outside the top-right corner
  }
  function startWorking() {
    gfx.selection.clear?.() ?? gfx.selection.set({ elements: [] });
    placeBadge(); pendBox.classList.add('on'); badge.classList.add('on');
    const tick = () => { placeBadge(); follow = requestAnimationFrame(tick); }; follow = requestAnimationFrame(tick);
  }
  function stopWorking(reselect = true) {
    cancelAnimationFrame(follow); pendBox.classList.remove('on'); badge.classList.remove('on');
    const still = ids.filter(id => gfx.getElementById(id));
    if (reselect && still.length) gfx.selection.set({ elements: still });   // hand the selection back
  }

  async function submit() {
    const prompt = input.value.trim();
    if (!prompt || busy) return;
    busy = true;
    await closeBar(false);
    startWorking();
    let reselect = true;
    try {
      // the handler returns false when it put a proposal on the board: leave the selection off so it shows
      if (onSubmit) reselect = (await onSubmit(prompt, ids)) !== false;
      else await new Promise(res => setTimeout(res, 2400));
    } finally { stopWorking(reselect); busy = false; }
  }

  form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeBar(); } e.stopPropagation(); });

  // Dictation where the platform has it (desktop app); hidden otherwise.
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const mic = cap.querySelector('.cx-cap-mic') as El;
  if (!SR) mic.hidden = true;
  else mic.addEventListener('click', () => {
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
    mic.classList.add('live');
    rec.onresult = (ev: any) => { input.value = [...ev.results].map((r: any) => r[0].transcript).join(''); };
    rec.onend = () => mic.classList.remove('live');
    try { rec.start(); } catch { mic.classList.remove('live'); }
  });

  // ── left click selects quietly; right click edits ───────────────────────────────
  // A selection shows only its outline and one small blue dot outside its top-right corner. The resize handles
  // still work but are not drawn; AFFiNE's element toolbar appears only on right click. The dot opens the
  // instruction capsule just above the selection; while Claude works, the 2×2 dots take the dot's place.
  const dot = h('button', 'cx-sel-dot'); dot.setAttribute('aria-label', 'Ask Claude about this'); layer.append(dot);
  let tbOn = false;
  const SEL_CSS = '.handle > *, .rotate, [class*="rotate-handle"] { opacity: 0 !important; }';
  const TB_CSS = ':host(:not([data-cx-tb])) editor-toolbar { opacity: 0 !important; pointer-events: none !important; }';
  const inject = (tag: string, css: string) => { const host = deepFind(document, e => e.tagName === tag) as El | null; const sr = host?.shadowRoot; if (!sr || sr.querySelector('style[data-cx]')) return host; const st = document.createElement('style'); st.dataset.cx = '1'; st.textContent = css; sr.append(st); return host; };
  const toolbarHost = () => deepFind(document, e => e.tagName === 'AFFINE-TOOLBAR-WIDGET') as El | null;
  const setTb = (on: boolean) => { tbOn = on; const hst = toolbarHost(); if (hst) on ? hst.setAttribute('data-cx-tb', '') : hst.removeAttribute('data-cx-tb'); };
  setInterval(() => { inject('EDGELESS-SELECTED-RECT', SEL_CSS); inject('AFFINE-TOOLBAR-WIDGET', TB_CSS); }, 400);
  const selBound = () => {
    const els = gfx.selection.selectedElements as any[]; if (!els.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) { const b = e.elementBound; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const rr = rootEl.getBoundingClientRect(); const [ax, ay] = gfx.viewport.toViewCoord(x0, y0); const [bx, by] = gfx.viewport.toViewCoord(x1, y1);
    return { L: rr.left + ax, T: rr.top + ay, R: rr.left + bx, B: rr.top + by };
  };
  function placeDot() {
    const b = selBound();
    const show = !!b && !open && !busy && !gfx.selection.editing && !document.body.classList.contains('cx-dragging');
    dot.classList.toggle('on', show);
    if (b && show) { dot.style.left = `${b.R + 9}px`; dot.style.top = `${b.T + 1}px`; }
  }
  const loop = () => { placeDot(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  window.addEventListener('pointerdown', e => { if ((e.target as El).closest?.('.cx-ai-layer')) return; if (e.button === 0) { document.body.classList.add('cx-dragging'); if (tbOn) setTb(false); } }, true);
  window.addEventListener('pointerup', () => document.body.classList.remove('cx-dragging'), true);
  gfx.selection.slots?.updated?.subscribe?.(() => { if (tbOn && !holdTb) setTb(false); });
  let holdTb = false;
  rootEl.addEventListener('contextmenu', (e: MouseEvent) => {
    if ((e.target as El).closest?.('input, textarea, [contenteditable="true"]') && gfx.selection.editing) return;
    const [mx, my] = gfx.viewport.toModelCoordFromClientCoord([e.clientX, e.clientY]);
    let hit: any = null; try { hit = gfx.getElementByPoint(mx, my); } catch { /* none */ }
    const sel = gfx.selection.selectedElements as any[];
    if (!hit && !sel.length) return;
    e.preventDefault(); e.stopPropagation();
    holdTb = true;
    const want = hit && !sel.some(s => s.id === hit.id) ? [hit.id] : sel.map(s => s.id);
    setTb(true);
    // AFFiNE folds its toolbar on any pointer press; selecting again (after the press is over) opens it
    setTimeout(() => { gfx.selection.set({ elements: [] }); gfx.selection.set({ elements: want }); setTb(true); setTimeout(() => { holdTb = false; }, 50); }, 40);
  }, true);

  // the dot → the capsule, opened just above the selection, as wide as it (within reason)
  async function openFromDot() {
    if (open || busy) return;
    const b = selBound(); if (!b) return;
    const sel = gfx.selection.selectedElements as any[]; ids = sel.map(m => m.id);
    const { label } = describe(sel);
    input.value = ''; input.placeholder = `What should happen to ${label}?`;
    setTb(false); open = true; dot.classList.remove('on');
    const H = 42, w = Math.max(300, Math.min(520, b.R - b.L));
    const left = Math.max(16, Math.min(b.L, innerWidth - 16 - w)), top = Math.max(12, b.T - H - 10);
    const d = dot.getBoundingClientRect();
    pivotL = d.left - 4; pivotW = 16;
    cap.style.top = `${top}px`; cap.style.height = `${H}px`; cap.style.setProperty('--h', `${H}px`); cap.style.setProperty('--pw', `16px`);
    cap.classList.add('on', 'from-dot');
    cap.animate([{ left: `${d.left - 4}px`, width: '16px', top: `${d.top - 4}px`, opacity: .4 }, { left: `${left}px`, width: `${w}px`, top: `${top}px`, opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.9,.25,1.05)', fill: 'forwards' });
    cap.style.left = `${left}px`; cap.style.width = `${w}px`;
    cap.classList.add('wide');
    setTimeout(() => input.focus(), 160);
  }
  dot.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
  dot.addEventListener('click', e => { e.stopPropagation(); openFromDot(); });

  window.addEventListener('cx-ai-open', () => openFromDot());
  // Keyboard: "/" with a selection opens the prompt.
  window.addEventListener('keydown', e => {
    if (e.key !== '/' || open) return;
    const t = e.target as El;
    if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (!gfx.selection.selectedElements.length || gfx.selection.editing) return;
    e.preventDefault(); openFromDot();
  });
  // Clicking the board elsewhere closes it; so does a selection change.
  window.addEventListener('pointerdown', e => { if (open && !(e.target as El).closest?.('.cx-ai-layer')) closeBar(); }, true);
  gfx.selection.slots?.updated?.subscribe?.(() => { if (open) closeBar(false); });
}
