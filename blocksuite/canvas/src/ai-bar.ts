// AI entry on the selection toolbar.
// One object, three forms: the element toolbar → (fold into the ring) → an input capsule → back.
// While the model works, the selection stays as it is; only a small ring beside it hops.
//
// The model is not wired yet: sending shows the working state, then returns. `onSubmit` is the hook
// the next step fills in (read the selection → ask the model → place proposals on the canvas).

import { ActionPlacement, ToolbarModuleExtension, type ToolbarContext } from '@blocksuite/affine/shared/services';
import { BlockFlavourIdentifier } from '@blocksuite/affine/std';
import { html } from 'lit';

// The ring, as drawn in Figma: a soft gray band around a pale centre.
export const RING_SVG = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
  <circle class="band" cx="11" cy="11" r="7.4" fill="#fafafa" stroke="#b9b9b9" stroke-width="3"/>
  <circle cx="11" cy="11" r="5.6" stroke="#e9e9e9" stroke-width="1"/>
</svg>`;

// ── The button that lives inside AFFiNE's toolbar ────────────────────────────────
class AiEntry extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { display: inline-flex; }
      button { all: unset; box-sizing: border-box; width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; cursor: pointer; transition: background .12s ease, transform .14s ease; }
      .band { transition: stroke .12s ease; }
      button:hover .band { stroke: #8f8f8f; }
      button:active { transform: scale(.94); }
      button:focus-visible { outline: 2px solid #0c8ce9; outline-offset: 1px; }
      svg { display: block; }
    </style><button aria-label="Open prompt">${RING_SVG}</button>`;
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

export function mountAiBar(rootEl: any, onSubmit?: (prompt: string, ids: string[]) => Promise<void>) {
  const gfx = rootEl.gfx;
  const layer = h('div', 'cx-ai-layer');
  document.body.append(layer);

  const cap = h('div', 'cx-cap');
  cap.setAttribute('role', 'dialog');
  cap.innerHTML = `
    <span class="cx-cap-ring" aria-hidden="true">${RING_SVG}</span>
    <form class="cx-cap-row">
      <input class="cx-cap-input" type="text" autocomplete="off" spellcheck="false" aria-label="Instruction">
      <button type="button" class="cx-cap-mic" aria-label="Dictate"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="9" y="4" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/></svg></button>
      <button type="submit" class="cx-cap-send" aria-label="Send"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
    </form>`;
  layer.append(cap);
  const input = cap.querySelector('input') as HTMLInputElement;
  const form = cap.querySelector('form') as HTMLFormElement;

  const badge = h('div', 'cx-working', `<span class="cx-hop">${RING_SVG}</span>`);
  badge.setAttribute('aria-label', 'Working');
  layer.append(badge);

  let open = false, toolbar: El | null = null, ids: string[] = [], busy = false;
  const OPEN_W = 440;

  const toolbarEl = () => deepFind(document, e => e.tagName === 'EDITOR-TOOLBAR' && (e as El).getBoundingClientRect().width > 0);
  const toolbarKids = (t: El) => [...t.children].filter(c => c.tagName !== 'CX-AI-ENTRY' && !c.querySelector?.('cx-ai-entry')) as El[];

  async function openBar() {
    if (open || busy) return;
    toolbar = toolbarEl(); if (!toolbar) return;
    const sel = gfx.selection.selectedElements as any[];
    ids = sel.map(m => m.id);
    const { label } = describe(sel);
    input.value = ''; input.placeholder = `What should happen to ${label}?`;
    const r = toolbar.getBoundingClientRect();
    open = true;

    // 1 · fold: the toolbar's other buttons slide into the ring, the bar narrows to the ring
    toolbarKids(toolbar).forEach((k, i, a) => k.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-10px)' }], { duration: 120, delay: (a.length - i) * 12, fill: 'forwards', easing: 'ease-in' }));
    const fold = toolbar.animate([{ clipPath: `inset(0 0 0 0 round 14px)` }, { clipPath: `inset(0 ${r.width - r.height}px 0 0 round 14px)` }], { duration: 170, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    await fold.finished;

    // 2 · swap to the capsule (same place, same height), breathe once, then grow into an input
    cap.style.left = `${r.left}px`; cap.style.top = `${r.top}px`; cap.style.height = `${r.height}px`;
    cap.style.setProperty('--h', `${r.height}px`);
    cap.style.width = `${r.height}px`;
    cap.classList.add('on'); toolbar.style.visibility = 'hidden';
    cap.querySelector('.cx-cap-ring')!.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    await new Promise(res => setTimeout(res, 40));
    const w = Math.min(OPEN_W, innerWidth - r.left - 16);
    cap.animate([{ width: `${r.height}px` }, { width: `${w}px` }], { duration: 260, easing: 'cubic-bezier(.2,.9,.25,1.08)', fill: 'forwards' });
    cap.classList.add('wide');
    setTimeout(() => input.focus(), 180);
  }

  async function closeBar(restore = true) {
    if (!open) return;
    open = false;
    cap.classList.remove('wide');
    const w = cap.getBoundingClientRect().width, hgt = cap.getBoundingClientRect().height;
    await cap.animate([{ width: `${w}px` }, { width: `${hgt}px` }], { duration: 180, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).finished;
    cap.classList.remove('on'); cap.getAnimations().forEach(a => a.cancel());
    const t = toolbar; toolbar = null;
    if (!t) return;
    t.style.visibility = '';
    if (!restore) { t.getAnimations().forEach(a => a.cancel()); toolbarKids(t).forEach(k => k.getAnimations().forEach(a => a.cancel())); return; }
    const r = t.getBoundingClientRect();
    t.animate([{ clipPath: `inset(0 ${r.width - r.height}px 0 0 round 14px)` }, { clipPath: `inset(0 0 0 0 round 14px)` }], { duration: 220, easing: 'cubic-bezier(.2,.9,.25,1.05)' }).finished.then(() => t.getAnimations().forEach(a => a.cancel()));
    toolbarKids(t).forEach((k, i) => { k.getAnimations().forEach(a => a.cancel()); k.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 160, delay: 40 + i * 14, easing: 'ease-out', fill: 'backwards' }); });
  }

  // Working indicator: a small ring just outside the selection's top-right corner. It hops, it doesn't spin.
  let follow = 0;
  function placeBadge() {
    const els = ids.map(id => gfx.getElementById(id)).filter(Boolean) as any[];
    if (!els.length) return;
    let x1 = -Infinity, y0 = Infinity;
    for (const e of els) { const b = e.elementBound; x1 = Math.max(x1, b.x + b.w); y0 = Math.min(y0, b.y); }
    const rr = rootEl.getBoundingClientRect();
    const [sx, sy] = gfx.viewport.toViewCoord(x1, y0);
    badge.style.left = `${rr.left + sx + 10}px`; badge.style.top = `${rr.top + sy - 10}px`;
  }
  function startWorking() {
    placeBadge(); badge.classList.add('on');
    const tick = () => { placeBadge(); follow = requestAnimationFrame(tick); }; follow = requestAnimationFrame(tick);
  }
  function stopWorking() { cancelAnimationFrame(follow); badge.classList.remove('on'); }

  async function submit() {
    const prompt = input.value.trim();
    if (!prompt || busy) return;
    busy = true;
    await closeBar(false);
    startWorking();
    try {
      if (onSubmit) await onSubmit(prompt, ids);
      else await new Promise(res => setTimeout(res, 2400));   // model not wired yet
    } finally { stopWorking(); busy = false; }
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

  window.addEventListener('cx-ai-open', () => openBar());
  // Keyboard: "/" with a selection opens the prompt.
  window.addEventListener('keydown', e => {
    if (e.key !== '/' || open) return;
    const t = e.target as El;
    if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (!gfx.selection.selectedElements.length || gfx.selection.editing) return;
    e.preventDefault(); openBar();
  });
  // Clicking the board elsewhere closes it; so does a selection change.
  window.addEventListener('pointerdown', e => { if (open && !(e.target as El).closest?.('.cx-ai-layer')) closeBar(); }, true);
  gfx.selection.slots?.updated?.subscribe?.(() => { if (open) closeBar(false); });
}
