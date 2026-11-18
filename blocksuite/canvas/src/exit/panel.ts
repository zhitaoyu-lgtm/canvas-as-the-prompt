// The side panel: one quiet button at the top right opens it. Two tabs:
//   Document — the board translated into a linear document that keeps its spatial grammar (translate.ts).
//              Typeset like a book; editable; right-click a selection to highlight it; hover a paragraph and a
//              small bubble asks Claude to change just that paragraph.
//   Chat     — talk to Claude about the board; it reads the board (and the document) each time.
// The document is a one-way snapshot: re-translated when it is opened and the board has changed, unless the
// user has edited it; then a line offers the update instead.

import { ask, available, ModelError } from '../ai/model';
import { readBoard, toPrompt } from '../ai/reading';
import { snapshot } from '../ai/snapshot';
import { figHead } from './visuals';
import { asProse, pace, translateBoard, type Blk, type Run } from './translate';

const KEY = 'cx:document';
type Saved = { title: string; html: string; board: string; edited: boolean; gen?: string };
// bump when the way documents are written changes: unedited documents are written again
const GEN = '2026-11-17';

const I = {
  panel: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path d="M12.25 3.75v12.5M14.25 7h1M14.25 9.5h1"/></svg>',
  more: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/></svg>',
  expand: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 3.75h4.75V8.5M8.5 16.25H3.75V11.5M16.25 3.75l-5 5M3.75 16.25l5-5"/></svg>',
  shrink: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8.75h-4.75V4M4 11.25h4.75V16M11.25 8.75l5-5M8.75 11.25l-5 5"/></svg>',
  collapse: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5l4.5 4.5L5 14.5M10.5 5.5L15 10l-4.5 4.5"/></svg>',
  doc: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.25" y="2.75" width="11.5" height="14.5" rx="2.5"/><path d="M7.5 7h5M7.5 10h5M7.5 13h3"/></svg>',
  chat: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M10 3.5c3.9 0 6.75 2.45 6.75 5.6s-2.85 5.6-6.75 5.6c-.8 0-1.55-.1-2.25-.3L4.5 16v-3.1C3.75 11.9 3.25 10.6 3.25 9.1 3.25 5.95 6.1 3.5 10 3.5z"/></svg>',
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>',
  grip: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="7.5" cy="5" r="1.3"/><circle cx="12.5" cy="5" r="1.3"/><circle cx="7.5" cy="10" r="1.3"/><circle cx="12.5" cy="10" r="1.3"/><circle cx="7.5" cy="15" r="1.3"/><circle cx="12.5" cy="15" r="1.3"/></svg>',
  bubble: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5c3.9 0 6.75 2.45 6.75 5.6s-2.85 5.6-6.75 5.6c-.8 0-1.55-.1-2.25-.3L4.5 16v-3.1C3.75 11.9 3.25 10.6 3.25 9.1 3.25 5.95 6.1 3.5 10 3.5z"/><path d="M10 7v4M8 9h4"/></svg>',
  send: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9"/></svg>',
};
const HUES: [string, string][] = [['yellow', '#fdf0b4'], ['green', '#d9f2dc'], ['blue', '#dbeafe'], ['pink', '#fbe0ec'], ['purple', '#ece3fb'], ['gray', '#ececec']];

export function mountPanel(rootEl: any) {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const map = () => store.spaceDoc?.getMap?.(KEY) ?? store.doc?.spaceDoc?.getMap?.(KEY);
  const load = (): Saved | null => { try { return map()?.get('doc') ?? null; } catch { return null; } };
  const save = (s: Saved) => { try { map()?.set('doc', s); } catch { /* not kept */ } };

  // ── shell ──
  const open = btn('cx-pn-open', I.panel, 'Open panel');
  const panel = el('aside', 'cx-pn');
  const head = el('div', 'cx-pn-head');
  const tabs = el('div', 'cx-pn-tabs');
  const tDoc = btn('cx-pn-tab on', I.doc, 'Document'), tChat = btn('cx-pn-tab', I.chat, 'Chat');
  tabs.append(tDoc, tChat);
  const acts = el('div', 'cx-pn-acts');
  const bMore = btn('cx-pn-ib', I.more, 'More'), bExpand = btn('cx-pn-ib', I.expand, 'Expand'), bClose = btn('cx-pn-ib', I.collapse, 'Close panel');
  acts.append(bMore, bExpand, bClose);
  head.append(tabs, acts);
  const docPane = el('div', 'cx-pn-body cx-doc-pane');
  const chatPane = el('div', 'cx-pn-body cx-chat-pane'); chatPane.hidden = true;
  panel.append(head, docPane, chatPane);
  document.body.append(open, panel);

  let tab: 'doc' | 'chat' = 'doc', wide = false;
  // the canvas eases into a two-column layout (Heptabase-like); the canvas keeps redrawing while it narrows
  const settle = () => { const t0 = performance.now(); const tick = () => { window.dispatchEvent(new Event('resize')); if (performance.now() - t0 < 460) requestAnimationFrame(tick); }; requestAnimationFrame(tick); };
  // the window's title bar takes the colour around the canvas (desktop app window)
  const tint = (_on: boolean) => { const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', '#ffffff'); };
  // the edge between the canvas and the panel can be dragged, like Heptabase
  const W_KEY = 'cx:panel-width';
  let userW = 440; try { userW = Number(localStorage.getItem(W_KEY)) || 440; } catch { /* default */ }
  const clampW = (w: number) => Math.round(Math.max(340, Math.min(w, window.innerWidth * 0.7)));
  const setW = (w: number) => document.body.style.setProperty('--pnw', `${clampW(w)}px`);
  setW(userW);
  const grip = el('div', 'cx-pn-grip'); document.body.append(grip);
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    document.body.classList.add('cx-resizing'); wide = false; panel.classList.remove('wide'); bExpand.innerHTML = I.expand;
    let raf = 0;
    const move = (ev: PointerEvent) => { userW = clampW(window.innerWidth - ev.clientX - 12); setW(userW); if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.dispatchEvent(new Event('resize')); }); };
    const up = () => { grip.removeEventListener('pointermove', move); document.body.classList.remove('cx-resizing'); try { localStorage.setItem(W_KEY, String(userW)); } catch { /* fine */ } window.dispatchEvent(new Event('resize')); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up, { once: true }); grip.addEventListener('pointercancel', up, { once: true });
  });
  grip.addEventListener('dblclick', () => { userW = 440; setW(userW); try { localStorage.setItem(W_KEY, '440'); } catch { /* fine */ } settle(); });
  const show = (on: boolean) => { tint(on); panel.classList.toggle('on', on); panel.inert = !on; open.classList.toggle('off', on); document.body.classList.toggle('cx-pn-on', on); settle(); if (on && tab === 'doc') refresh(); };
  const setTab = (t: 'doc' | 'chat') => {
    tab = t; tDoc.classList.toggle('on', t === 'doc'); tChat.classList.toggle('on', t === 'chat');
    docPane.hidden = t !== 'doc'; chatPane.hidden = t !== 'chat'; bMore.hidden = t !== 'doc';
    if (t === 'doc') refresh(); else input.focus();
  };
  open.onclick = () => show(true);
  bClose.onclick = () => show(false);
  bExpand.onclick = () => { wide = !wide; panel.classList.toggle('wide', wide); wide ? document.body.style.setProperty('--pnw', 'min(880px, 60vw)') : setW(userW); bExpand.innerHTML = wide ? I.shrink : I.expand; settle(); };
  tDoc.onclick = () => setTab('doc'); tChat.onclick = () => setTab('chat');

  // ── document ──
  const banner = el('div', 'cx-doc-note'); banner.hidden = true;
  banner.innerHTML = '<span>The board has changed since this was written.</span>';
  const bUpd = el('button', 'cx-doc-note-b'); bUpd.textContent = 'Update'; banner.append(bUpd);
  const page = el('article', 'cx-doc'); page.lang = 'en';
  page.contentEditable = 'true'; page.spellcheck = false;
  docPane.append(banner, page);

  const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };
  const boardHash = () => hash(toPrompt(readBoard(gfx, {}), { maxItems: 100000 }).replace(/^SELECTED.*$/m, ''));
  let writing = 0;
  function rebuild() {
    const out = translateBoard(rootEl);
    page.innerHTML = render(out.title, pace(asProse(out.blocks)));
    save({ title: out.title, html: page.innerHTML, board: boardHash(), edited: false, gen: GEN });
    banner.hidden = true;
    void pictures().then(() => writeUp());
  }
  // a picture of each section, as arranged on the board
  async function pictures() {
    for (const f of [...page.querySelectorAll<HTMLElement>('figure.cx-fig[data-box]')]) {
      const [x, y, w, h] = (f.dataset.box ?? '').split(',').map(Number); if (!w || !h) continue;
      try {
        const blob = await snapshot(rootEl, { x: x - 24, y: y - 24, w: w + 48, h: h + 48 }, 1100); if (!blob) continue;
        const url = await jpeg(blob); const img = f.querySelector('img') ?? f.insertBefore(document.createElement('img'), f.querySelector('figcaption'));
        img.src = url; img.alt = f.querySelector('figcaption')?.textContent ?? ''; f.removeAttribute('data-box');
      } catch { /* leave the caption */ }
    }
    // galleries: each thing on its own, enlarged, in a row
    for (const f of [...page.querySelectorAll<HTMLElement>('figure.cx-gal[data-boxes]')]) {
      const row = el('div', 'cx-gal-row');
      for (const b of (f.dataset.boxes ?? '').split(';')) {
        const [x, y, w, h] = b.split(',').map(Number); if (!w || !h) continue;
        try {
          const blob = await snapshot(rootEl, { x: x - 6, y: y - 6, w: w + 12, h: h + 12 }, 640, 0); if (!blob) continue;
          const img = document.createElement('img'); img.src = await jpeg(blob); img.alt = ''; row.append(img);
        } catch { /* skip this one */ }
      }
      if (row.children.length) { row.style.setProperty('--n', String(row.children.length === 3 ? 3 : Math.min(2, row.children.length))); f.insertBefore(row, f.firstChild); f.removeAttribute('data-boxes'); }
      else f.remove();
    }
    const s = load(); if (s && !s.edited) save({ ...s, html: page.innerHTML });
  }
  // Claude turns the faithful draft into book-like prose, keeping its structure, figures and citations
  async function writeUp() {
    if (!(await available()) && !(window as any).cxMockWrite) return;
    const run = ++writing, before = page.innerHTML;
    const status = el('div', 'cx-doc-status'); status.innerHTML = '<i></i><i></i><i></i><span>Claude is writing this up</span>';
    page.querySelector('.cx-doc-title')?.after(status);
    const figs = [...page.querySelectorAll('figure.cx-fig')].map(f => f.outerHTML);
    const refs = page.querySelector('ol.cx-refs')?.outerHTML ?? '', refsHead = refs ? '<h2>References</h2>' : '';
    try {
      const md = toMarkdown(page, true);
      const sys = `You turn a draft into a short, well-written document. The draft was translated from the user's spatial canvas (a whiteboard where placement carries meaning), so its structure is the user's: keep every heading, in the same order, and every [[Figure n]] line exactly where it is.
Write in paragraphs, like a carefully edited book chapter: a short opening paragraph, then 1–3 paragraphs under each heading. Use a bullet list only if the content is truly a list. No new headings.
Keep every citation marker like [2] after the claim it supports. Keep ==highlighted== phrases highlighted (they are what the user stressed). Say what the arrangement means (which notes sit with which source, what is grouped, what is still open); never invent sources or facts that are not in the draft.
English. Plain Markdown: ## for headings, ### for sub-headings. Return only the document body, without the title and without the references list.
Shape: read like a short book chapter. Mostly paragraphs; bullet points only where the draft has a real list. Start every paragraph with one short topic sentence in **bold** that says what the paragraph is about, then the detail. Keep ## and ### headings as they are (they get numbered).`;
      const mock = (window as any).cxMockWrite;
      const raw = String(mock ? (typeof mock === 'function' ? await mock(md) : mock) : await ask(sys, md.replace(/\n## References[\s\S]*$/, ''))).trim();
      if (run !== writing || page.innerHTML.replace(status.outerHTML, '') !== before) return;     // the user changed it meanwhile: keep theirs
      const body = mdToHtml(raw, figs);
      if (!body || body.length < 200) throw new Error('too short');
      const title = page.querySelector('.cx-doc-title')?.outerHTML ?? '';
      const used = (body.match(/<figure/g) ?? []).length;
      page.innerHTML = title + body + figs.slice(used).join('') + refsHead + refs + (page.querySelector('.cx-doc-foot')?.outerHTML ?? '');
      const s = load(); save({ title: titleOf(), html: page.innerHTML, board: s?.board ?? boardHash(), edited: false, gen: s?.gen ?? GEN });
    } catch { /* the draft stays */ } finally { status.remove(); }
  }
  function refresh() {
    flush();
    const s = load();
    if (!s) return rebuild();
    if (page.innerHTML !== s.html && !writing) page.innerHTML = s.html;
    const changed = s.board !== boardHash() || s.gen !== GEN;
    if (changed && !s.edited) rebuild(); else banner.hidden = !changed;
  }
  bUpd.onclick = () => rebuild();
  let saving: any = null;
  const flush = () => { if (saving === null) return; clearTimeout(saving); saving = null; const s = load(); save({ title: titleOf(), html: page.innerHTML, board: s?.board ?? '', edited: true, gen: s?.gen }); };
  page.addEventListener('input', () => { clearTimeout(saving); saving = setTimeout(flush, 400); });
  const titleOf = () => page.querySelector('h1.cx-doc-title')?.textContent ?? 'Board';

  // ··· menu
  const menu = el('div', 'cx-pn-menu'); menu.hidden = true;
  const mi = (label: string, fn: () => void, danger = false) => { const b = el('button', 'cx-pn-mi' + (danger ? ' danger' : '')); b.textContent = label; b.onclick = () => { menu.hidden = true; fn(); }; menu.append(b); };
  mi('Update from board', () => rebuild());
  mi('Copy as Markdown', async () => { try { await navigator.clipboard.writeText(toMarkdown(page)); flash('Copied'); } catch { flash('Copy was blocked here'); } });
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) mi('Export .md', () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toMarkdown(page)], { type: 'text/markdown' }));
    a.download = titleOf().replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  menu.append(el('i', 'cx-pn-sep'));
  mi('Delete document', () => { try { map()?.delete('doc'); } catch { /* */ } page.innerHTML = ''; show(false); }, true);
  panel.append(menu);
  bMore.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  const flash = (t: string) => { const f = el('div', 'cx-pn-flash'); f.textContent = t; panel.append(f); setTimeout(() => f.remove(), 1600); };

  // hover a paragraph → a small bubble on its right; click → tell Claude what to change
  const hover = btn('cx-doc-hover', I.bubble, 'Ask Claude about this'); hover.hidden = true; docPane.append(hover);
  let target: HTMLElement | null = null;
  const BLOCK = 'p, li, h2, h3, h4, blockquote';
  docPane.addEventListener('mousemove', (e) => {
    if (asking) return;
    const b = (e.target as HTMLElement).closest?.(BLOCK) as HTMLElement | null;
    if (b && page.contains(b)) { target = b; place(hover, b); hover.hidden = false; }
    else if (!(e.target as HTMLElement).closest?.('.cx-doc-hover')) hover.hidden = true;
  });
  docPane.addEventListener('scroll', () => { hover.hidden = true; });
  const place = (h: HTMLElement, b: HTMLElement) => { const pr = docPane.getBoundingClientRect(), br = b.getBoundingClientRect(); h.style.top = `${br.top - pr.top + docPane.scrollTop + 1}px`; };

  const askBox = el('div', 'cx-doc-ask'); askBox.hidden = true;
  const askIn = document.createElement('textarea'); askIn.className = 'cx-doc-ask-in'; askIn.placeholder = 'Tell Claude what to change'; askIn.rows = 1;
  const askGo = btn('cx-doc-ask-go', I.send, 'Send');
  askBox.append(askIn, askGo); docPane.append(askBox);
  let asking: HTMLElement | null = null, picked: Range | null = null;
  // select words → a small Claude bubble above them (the selection stays); click it → the instruction box,
  // while the chosen words stay marked even though the cursor is now in the box
  const selBub = btn('cx-sel-bub', I.bubble, 'Ask Claude about this'); selBub.hidden = true; docPane.append(selBub);
  const HLS: any = (CSS as any).highlights, HLC: any = (globalThis as any).Highlight;
  const showPicked = (r: Range | null) => { try { r ? HLS?.set('cx-picked', new HLC(r)) : HLS?.delete('cx-picked'); } catch { /* older browser */ } };
  const blockOf = (r: Range) => (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer as HTMLElement : r.commonAncestorContainer.parentElement)?.closest(BLOCK) as HTMLElement | null;
  let selecting = false;
  page.addEventListener('pointerdown', () => { selecting = true; selBub.hidden = true; });
  document.addEventListener('pointerup', () => { if (selecting) { selecting = false; setTimeout(placeSelBub, 0); } });
  document.addEventListener('selectionchange', () => { if (!selecting) placeSelBub(); });
  function placeSelBub() {
    if (!askBox.hidden || !palette.hidden) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !page.contains(sel.anchorNode) || sel.toString().trim().length < 2) { selBub.hidden = true; return; }
    const r = sel.getRangeAt(0); if (!blockOf(r)) { selBub.hidden = true; return; }
    const pr = docPane.getBoundingClientRect(), first = r.getClientRects()[0] ?? r.getBoundingClientRect();
    selBub.style.top = `${first.top - pr.top + docPane.scrollTop - 36}px`;
    selBub.style.left = `${Math.max(8, Math.min(first.left - pr.left - 4, pr.width - 44))}px`;
    selBub.hidden = false; hover.hidden = true;
  }
  docPane.addEventListener('scroll', () => { selBub.hidden = true; });
  selBub.addEventListener('mousedown', (e) => e.preventDefault());   // keep the selection
  selBub.onclick = () => {
    const sel = getSelection(); if (!sel || sel.isCollapsed) return;
    const r = sel.getRangeAt(0); const blk = blockOf(r); if (!blk) return;
    picked = r.cloneRange(); asking = blk; selBub.hidden = true; hover.hidden = true; showPicked(picked);
    const pr = docPane.getBoundingClientRect(), rr = r.getBoundingClientRect();
    askBox.style.top = `${rr.bottom - pr.top + docPane.scrollTop + 10}px`; askBox.hidden = false; askIn.value = ''; askIn.placeholder = 'Tell Claude what to change'; askIn.focus();
  };
  hover.onclick = () => {
    if (!target) return; asking = target; picked = null; hover.hidden = true;
    asking.classList.add('cx-doc-focus');
    const pr = docPane.getBoundingClientRect(), br = asking.getBoundingClientRect();
    askBox.style.top = `${br.bottom - pr.top + docPane.scrollTop + 8}px`; askBox.hidden = false; askIn.value = ''; askIn.focus();
  };
  const closeAsk = () => { askBox.hidden = true; asking?.classList.remove('cx-doc-focus'); asking = null; picked = null; showPicked(null); };
  askIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAsk(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void change(); } });
  askIn.addEventListener('input', () => { askIn.style.height = 'auto'; askIn.style.height = `${Math.min(120, askIn.scrollHeight)}px`; });
  askGo.onclick = () => void change();
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (!askBox.hidden && !askBox.contains(t)) closeAsk();
    if (!menu.hidden && !menu.contains(t) && t !== bMore && !bMore.contains(t)) menu.hidden = true;
    if (!palette.hidden && !palette.contains(t)) palette.hidden = true;
  }, true);
  async function change() {
    const b = asking, req = askIn.value.trim(), part = picked; if (!b || !req) return;
    askBox.classList.add('busy'); askIn.disabled = true;
    try {
      const words = part?.toString() ?? '';
      const sys = `You edit part of a document that was translated from the user's spatial canvas (a whiteboard).
Return only the replacement text, nothing else: no quotes, no preface. English. Keep citation markers like [2] where they still apply.
You may use **bold** and ==highlight==. ${words ? 'Replace only the selected words; the result must read well inside the paragraph.' : 'Rewrite the whole paragraph; keep it about as long unless asked otherwise.'}`;
      const user = `THE WHOLE DOCUMENT (for context)\n${toMarkdown(page)}\n\nTHE PARAGRAPH\n${b.textContent}\n\n${words ? `THE SELECTED WORDS (replace only these)\n${words}\n\n` : ''}WHAT TO CHANGE\n${req}`;
      const mock = (window as any).cxMockDoc;
      const out = String(mock ? (typeof mock === 'function' ? await mock(words || b.textContent, req) : mock) : await ask(sys, user)).trim();
      if (out) {
        if (part) { part.deleteContents(); const t = document.createElement('template'); t.innerHTML = inline(out); part.insertNode(t.content); }
        else b.innerHTML = inline(out);
        page.dispatchEvent(new Event('input'));
      }
      closeAsk(); getSelection()?.removeAllRanges();
    } catch (e: any) { flash(e instanceof ModelError && e.code === 'no_model' ? 'Claude isn’t connected on this computer' : 'Claude could not answer'); }
    finally { askBox.classList.remove('busy'); askIn.disabled = false; }
  }

  // right-click a selection → highlight colours
  const palette = el('div', 'cx-doc-pal'); palette.hidden = true;
  for (const [name, hex] of HUES) { const s = el('button', 'cx-doc-sw'); s.style.background = hex; s.setAttribute('aria-label', name); s.onmousedown = (e) => { e.preventDefault(); mark(hex); }; palette.append(s); }
  const none = el('button', 'cx-doc-sw none'); none.setAttribute('aria-label', 'No highlight'); none.onmousedown = (e) => { e.preventDefault(); mark('transparent'); }; palette.append(none);
  const bold = el('button', 'cx-doc-sw b'); bold.textContent = 'B'; bold.setAttribute('aria-label', 'Bold'); bold.onmousedown = (e) => { e.preventDefault(); restore(); document.execCommand('bold'); palette.hidden = true; }; palette.append(bold);
  panel.append(palette);
  let range: Range | null = null;
  const restore = () => { if (!range) return; page.focus({ preventScroll: true }); const s = getSelection(); s?.removeAllRanges(); s?.addRange(range); };
  page.addEventListener('contextmenu', (e) => {
    const s = getSelection(); if (!s || s.isCollapsed || !page.contains(s.anchorNode)) return;
    e.preventDefault(); range = s.getRangeAt(0).cloneRange(); selBub.hidden = true;
    const pr = panel.getBoundingClientRect();
    palette.style.left = `${Math.min(e.clientX - pr.left, pr.width - 250)}px`; palette.style.top = `${e.clientY - pr.top + 8}px`; palette.hidden = false;
  });
  function mark(hex: string) {
    restore(); document.execCommand('styleWithCSS', false, 'true'); document.execCommand('hiliteColor', false, hex);
    palette.hidden = true; getSelection()?.removeAllRanges(); page.dispatchEvent(new Event('input'));
  }

  // "Show on board": the canvas moves to the place a picture or table came from
  page.addEventListener('click', (e) => {
    const g = (e.target as HTMLElement).closest?.('.cx-goto') as HTMLElement | null; if (!g) return;
    e.preventDefault();
    const [x, y, w, h] = (g.dataset.goto ?? '').split(',').map(Number); if (!w || !h) return;
    try { const vp = rootEl.gfx.viewport; const B = vp.viewportBounds.constructor; vp.setViewportByBound(new B(x, y, w, h), [60, 60, 60, 60], true); } catch { /* keep the view */ }
  });
  // ── blocks, like Notion: a bgrip on the left of each block; drag it to move the block, click it for a menu ──
  const bgrip = el('div', 'cx-blk-grip'); bgrip.innerHTML = I.grip; bgrip.hidden = true; docPane.append(bgrip);
  const drop = el('div', 'cx-blk-drop'); drop.hidden = true; docPane.append(drop);
  const bmenu = el('div', 'cx-pn-menu cx-blk-menu'); bmenu.hidden = true; docPane.append(bmenu);
  let gb: HTMLElement | null = null;
  const topOf = (n: Element | null): HTMLElement | null => { while (n && n.parentElement !== page) n = n.parentElement; return n && n !== page && !n.classList.contains('cx-doc-title') ? n as HTMLElement : null; };
  const blocks = () => ([...page.children] as HTMLElement[]).filter(b => !b.classList.contains('cx-doc-title'));
  docPane.addEventListener('mousemove', (e) => {
    if (dragging || !bmenu.hidden) return;
    const t = e.target as HTMLElement;
    if (t.closest?.('.cx-blk-grip')) return;
    // the bgrip follows the block under the pointer, also when the pointer is in the left margin
    const pr = page.getBoundingClientRect();
    const b = topOf(t.closest?.('.cx-doc > *') ?? null) ?? blocks().find(k => { const r = k.getBoundingClientRect(); return e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4 && e.clientX > pr.left; }) ?? null;
    if (!b) { bgrip.hidden = true; return; }
    gb = b; const dr = docPane.getBoundingClientRect(), br = b.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(b).lineHeight) || 24;
    bgrip.style.top = `${br.top - dr.top + docPane.scrollTop + (b.tagName === 'FIGURE' ? 4 : Math.max(0, lh / 2 - 11))}px`;
    bgrip.style.left = `${pr.left - dr.left + 14}px`; bgrip.hidden = false;
  });
  docPane.addEventListener('mouseleave', () => { if (!dragging) bgrip.hidden = true; });
  let dragging = false;
  bgrip.addEventListener('pointerdown', (e) => {
    if (!gb) return; e.preventDefault(); bgrip.setPointerCapture(e.pointerId);
    const src = gb, y0 = e.clientY; let moved = false, before: HTMLElement | null | undefined;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      moved = true; dragging = true; src.classList.add('cx-blk-moving'); bmenu.hidden = true;
      const list = blocks(); const dr = docPane.getBoundingClientRect(), pr = page.getBoundingClientRect();
      before = list.find(k => { const r = k.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }) ?? null;
      const ref = before ? before.getBoundingClientRect().top - 7 : list[list.length - 1].getBoundingClientRect().bottom + 4;
      drop.style.top = `${ref - dr.top + docPane.scrollTop}px`; drop.style.left = `${pr.left - dr.left + 40}px`; drop.style.width = `${pr.width - 80}px`; drop.hidden = false;
      // scroll while dragging near the edges
      if (ev.clientY < dr.top + 40) docPane.scrollTop -= 12; else if (ev.clientY > dr.bottom - 40) docPane.scrollTop += 12;
    };
    const up = () => {
      bgrip.removeEventListener('pointermove', move); drop.hidden = true; src.classList.remove('cx-blk-moving');
      if (moved) { if (before !== undefined && before !== src) page.insertBefore(src, before); dragging = false; page.dispatchEvent(new Event('input')); }
      else openBlockMenu(src);
    };
    bgrip.addEventListener('pointermove', move); bgrip.addEventListener('pointerup', up, { once: true });
  });
  const TEXTY = ['P', 'H2', 'H3', 'H4', 'BLOCKQUOTE'];
  function openBlockMenu(b: HTMLElement) {
    bmenu.innerHTML = '';
    const item = (label: string, fn: () => void, on = false, danger = false) => { const x = el('button', 'cx-pn-mi' + (on ? ' on' : '') + (danger ? ' danger' : '')); x.textContent = label; x.onclick = () => { bmenu.hidden = true; fn(); page.dispatchEvent(new Event('input')); }; bmenu.append(x); };
    const isToggle = b.classList.contains('cx-tg');
    if (TEXTY.includes(b.tagName) || isToggle) {
      const head = el('div', 'cx-pn-mh'); head.textContent = 'Turn into'; bmenu.append(head);
      for (const [label, tag] of [['Text', 'P'], ['Heading 1', 'H2'], ['Heading 2', 'H3'], ['Heading 3', 'H4'], ['Quote', 'BLOCKQUOTE']] as const) item(label, () => turnInto(b, tag), b.tagName === tag && !isToggle);
      item('Toggle list', () => toToggle(b), isToggle);
      bmenu.append(el('i', 'cx-pn-sep'));
    }
    item('Duplicate', () => b.after(b.cloneNode(true)));
    item('Delete', () => b.remove(), false, true);
    const dr = docPane.getBoundingClientRect(), gr = bgrip.getBoundingClientRect();
    bmenu.style.top = `${gr.bottom - dr.top + docPane.scrollTop + 4}px`; bmenu.style.left = `${gr.left - dr.left}px`; bmenu.hidden = false;
  }
  const textOfBlock = (b: HTMLElement) => b.classList.contains('cx-tg') ? (b.querySelector('.cx-tg-t')?.innerHTML ?? '') : b.innerHTML;
  function turnInto(b: HTMLElement, tag: string) {
    const n = document.createElement(tag); n.innerHTML = textOfBlock(b) || '<br>';
    if (b.classList.contains('cx-tg')) { const body = [...(b.querySelector('.cx-tg-b')?.children ?? [])]; b.replaceWith(n); n.after(...body); return; }
    b.replaceWith(n);
  }
  function toToggle(b: HTMLElement) {
    if (b.classList.contains('cx-tg')) return;
    const t = el('div', 'cx-tg'); t.dataset.open = '1';
    t.innerHTML = `<div class="cx-tg-h"><span class="cx-tg-a" contenteditable="false"></span><span class="cx-tg-t">${textOfBlock(b)}</span></div><div class="cx-tg-b"><p><br></p></div>`;
    // a heading takes what follows it, up to the next heading of the same or higher level, into the toggle
    const lvl = /^H([2-4])$/.exec(b.tagName)?.[1];
    if (lvl) { const body = t.querySelector('.cx-tg-b')!; body.innerHTML = ''; let n = b.nextElementSibling as HTMLElement | null;
      while (n && !(/^H[2-4]$/.test(n.tagName) && n.tagName[1] <= lvl) && !n.classList.contains('cx-refs')) { const nx = n.nextElementSibling as HTMLElement | null; body.append(n); n = nx; }
      if (!body.children.length) body.innerHTML = '<p><br></p>'; t.classList.add('h' + lvl); }
    b.replaceWith(t);
  }
  page.addEventListener('mousedown', (e) => {
    const a = (e.target as HTMLElement).closest?.('.cx-tg-a'); if (!a) return;
    e.preventDefault(); const t = a.closest('.cx-tg') as HTMLElement; t.dataset.open = t.dataset.open === '1' ? '0' : '1'; page.dispatchEvent(new Event('input'));
  });
  document.addEventListener('pointerdown', (e) => { const t = e.target as Node; if (!bmenu.hidden && !bmenu.contains(t) && !bgrip.contains(t)) bmenu.hidden = true; }, true);

  // text size for the document (kept on this computer)
  const SIZE_KEY = 'cx:doc-size';
  const sizes: Record<string, number> = { S: 0.92, M: 1, L: 1.1 };
  const setSize = (k: string) => { page.style.zoom = String(sizes[k] ?? 1); try { localStorage.setItem(SIZE_KEY, k); } catch { /* fine */ } seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === k)); };
  const seg = el('div', 'cx-pn-seg'); seg.innerHTML = '<span>Text size</span>';
  for (const k of ['S', 'M', 'L']) { const b = el('button', ''); b.textContent = k; b.onclick = (e) => { e.stopPropagation(); setSize(k); }; seg.append(b); }
  menu.prepend(seg, el('i', 'cx-pn-sep'));
  let size0 = 'M'; try { size0 = localStorage.getItem(SIZE_KEY) || 'M'; } catch { /* default */ }
  setSize(size0);

  // ── chat ──
  const log = el('div', 'cx-chat-log');
  const empty = el('div', 'cx-chat-empty'); empty.textContent = 'Ask about your board. Claude reads it each time you ask.'; log.append(empty);
  const box = el('div', 'cx-chat-box');
  const input = document.createElement('textarea'); input.className = 'cx-chat-in'; input.placeholder = 'Reply to Claude…'; input.rows = 1;
  const go = btn('cx-chat-go', I.send, 'Send');
  box.append(input, go); chatPane.append(log, box);
  // no setup inside the app: on this computer the key lives in a file the server reads; if it is missing, say so quietly
  const keyNote = el('div', 'cx-key'); keyNote.hidden = true;
  keyNote.innerHTML = '<p>Claude isn’t connected on this computer yet. See README → Claude.</p>';
  chatPane.insertBefore(keyNote, box);
  const checkKey = async () => { keyNote.hidden = await available(); };
  tChat.addEventListener('click', () => void checkKey());
  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } });
  go.onclick = () => void send();
  async function send() {
    const q = input.value.trim(); if (!q) return;
    input.value = ''; input.style.height = 'auto'; empty.remove();
    bubble('user', q); history.push({ role: 'user', text: q });
    const wait = bubble('assistant', ''); wait.classList.add('busy'); wait.innerHTML = '<i></i><i></i><i></i>';
    try {
      const sys = `You are Claude, beside the user's spatial canvas (a whiteboard where layout carries meaning: groups, sections, notes placed on sources, arrows, colours, votes).
Answer their question about the board in a few short paragraphs or bullets. Refer to things by their own words, never by refs like s3 or G2.
Read the arrangement, not just the words. Reply in the user's language.`;
      const board = toPrompt(readBoard(gfx, {}));
      const user = `BOARD\n${board}\n\nCONVERSATION SO FAR\n${history.slice(0, -1).map(m => `${m.role === 'user' ? 'User' : 'Claude'}: ${m.text}`).join('\n') || '(none)'}\n\nUSER\n${q}`;
      const mock = (window as any).cxMockChat;
      const a = String(mock ? (typeof mock === 'function' ? await mock(q) : mock) : await ask(sys, user)).trim();
      wait.classList.remove('busy'); wait.innerHTML = blocksOf(a); history.push({ role: 'assistant', text: a });
    } catch (e: any) {
      wait.classList.remove('busy'); wait.classList.add('err');
      wait.textContent = e instanceof ModelError && e.code === 'no_model' ? 'Claude isn’t connected on this computer.' : 'Couldn’t reach Claude. Try again.';
    }
    log.scrollTop = log.scrollHeight;
  }
  function bubble(role: string, text: string) { const m = el('div', `cx-msg ${role}`); m.textContent = text; log.append(m); log.scrollTop = log.scrollHeight; return m; }

  (window as any).cxPanel = { show, setTab, rebuild, markdown: () => { refresh(); return toMarkdown(page); } };
}

// ── document ⇄ HTML ⇄ Markdown ─────────────────────────────────────────────────
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HEX: Record<string, string> = Object.fromEntries(HUES);
function runs(rs: Run[]) {
  return rs.filter(r => r.text).map(r => {
    const cite = /^\s*\[\d+\]\s*$/.test(r.text);
    let t = esc(r.text);
    if (cite) return `<sup class="cx-cite">${esc(r.text.trim())}</sup>`;
    if (r.link) t = `<a href="${esc(r.link)}" target="_blank" rel="noopener">${t}</a>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    if (r.italic) t = `<em>${t}</em>`;
    if (r.hl) t = `<span style="background-color:${HEX[r.hl === 'grey' ? 'gray' : r.hl] ?? HEX.yellow}">${t}</span>`;
    if (r.muted) t = `<span class="cx-muted">${t}</span>`;
    return t;
  }).join('');
}
export function render(title: string, blocks: Blk[]): string {
  const out: string[] = [`<h1 class="cx-doc-title">${esc(title)}</h1>`];
  let list: string | null = null, refs = false, fig = 0, tab = 0;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  blocks.forEach((b, i) => {
    if (b.type === 'bulleted' || b.type === 'numbered') {
      const tag = b.type === 'bulleted' ? 'ul' : 'ol';
      if (list !== tag) { close(); out.push(`<${tag}${refs && tag === 'ol' ? ' class="cx-refs"' : ''}>`); list = tag; }
      out.push(`<li>${runs(b.runs)}</li>`); return;
    }
    close();
    if (b.type === 'visual') {
      const lab = b.kind === 'table' ? `Table ${++tab}` : `Figure ${++fig}`;
      out.push(`<figure class="cx-fig cx-viz cx-viz-${b.kind}" contenteditable="false">${figHead(b.head, b.box)}<div class="cx-viz-body">${b.html}</div><figcaption>${lab}. ${esc(b.caption)}.</figcaption></figure>`); return;
    }
    if (b.type === 'gallery') { fig++; out.push(`<figure class="cx-fig cx-gal" data-boxes="${b.boxes.map(x => [x.x, x.y, x.w, x.h].map(Math.round).join(',')).join(';')}" contenteditable="false"><figcaption>Figure ${fig}. ${esc(b.caption)}.</figcaption></figure>`); return; }
    if (b.type === 'figure') { fig++; out.push(`<figure class="cx-fig cx-shot" data-box="${Math.round(b.box.x)},${Math.round(b.box.y)},${Math.round(b.box.w)},${Math.round(b.box.h)}" contenteditable="false">${figHead(b.caption.replace(/\.$/, ''), b.box)}<figcaption>Figure ${fig}. ${esc(b.caption)}${/\.$/.test(b.caption) ? '' : ', as arranged on the board.'}</figcaption></figure>`); return; }
    if (b.type === 'divider') { out.push('<hr>'); return; }
    const t = runs(b.runs);
    if (b.type === 'h1') { refs = /References/.test(t); out.push(refs ? `<h2 class="cx-nonum">${t}</h2>` : `<h2>${t}</h2>`); }
    else if (b.type === 'h2') out.push(`<h3>${t}</h3>`);
    else if (b.type === 'h3') out.push(`<h4>${t}</h4>`);
    else if (b.type === 'quote' && i === 0) out.push(`<p class="cx-lede">${t}</p>`);
    else if (b.type === 'quote') out.push(`<blockquote>${t}</blockquote>`);
    else if (i === blocks.length - 1 && blocks[i - 1]?.type === 'divider') out.push(`<p class="cx-doc-foot">${t}</p>`);
    else out.push(`<p>${t}</p>`);
  });
  close();
  return out.join('');
}
/** Claude's write-up (Markdown) → HTML; [[Figure n]] lines become the board's pictures. */
function mdToHtml(md: string, figs: string[]) {
  const out: string[] = []; let ul = false, para: string[] = [], first = true;
  const flushP = () => { if (para.length) { out.push(`<p${first ? ' class="cx-lede"' : ''}>${inline(para.join(' '))}</p>`); para = []; first = false; } };
  for (const line of md.replace(/\r/g, '').split('\n')) {
    const l = line.trim();
    const fm = /^\[\[Figure (\d+)\]\]$/.exec(l);
    const li = /^[-*•]\s+(.*)/.exec(l);
    if (!l) { flushP(); if (ul) { out.push('</ul>'); ul = false; } continue; }
    if (fm) { flushP(); const f = figs[+fm[1] - 1]; if (f) out.push(f); continue; }
    if (/^#{1,2}\s/.test(l)) { flushP(); first = false; out.push(`<h2>${inline(l.replace(/^#+\s*/, ''))}</h2>`); continue; }
    if (/^#{3,}\s/.test(l)) { flushP(); out.push(`<h3>${inline(l.replace(/^#+\s*/, ''))}</h3>`); continue; }
    if (li) { flushP(); if (!ul) { out.push('<ul>'); ul = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (/^>\s?/.test(l)) { flushP(); out.push(`<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    para.push(l);
  }
  flushP(); if (ul) out.push('</ul>');
  return out.join('');
}
const jpeg = (blob: Blob) => new Promise<string>((res, rej) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0); URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.86)); }; img.onerror = rej; img.src = URL.createObjectURL(blob); });
/** Claude's few marks (**bold**, ==highlight==, [text](url)) → HTML. */
function inline(md: string) {
  return esc(md).replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/==([^=]+)==/g, `<span style="background-color:${HEX.yellow}">$1</span>`)
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/\s?\[(\d+)\]/g, '<sup class="cx-cite">[$1]</sup>');
}
function blocksOf(md: string) {
  const out: string[] = []; let ul = false;
  for (const line of md.split('\n')) {
    const l = line.trim();
    const li = /^[-*•]\s+(.*)/.exec(l) ?? /^\d+[.)]\s+(.*)/.exec(l);
    if (li) { if (!ul) { out.push('<ul>'); ul = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (ul) { out.push('</ul>'); ul = false; }
    if (!l) continue;
    const h = /^#{1,4}\s+(.*)/.exec(l);
    out.push(h ? `<p><strong>${inline(h[1])}</strong></p>` : `<p>${inline(l)}</p>`);
  }
  if (ul) out.push('</ul>');
  return out.join('');
}
export function toMarkdown(page: HTMLElement, figures = false): string {
  const md = (n: Node): string => {
    if (n.nodeType === 3) return (n.textContent ?? '').replace(/\s+/g, ' ');
    if (!(n instanceof HTMLElement)) return '';
    const inner = [...n.childNodes].map(md).join('');
    const t = inner.trim(); if (!t) return inner;
    const pad = (s: string) => (inner.startsWith(' ') ? ' ' : '') + s + (inner.endsWith(' ') ? ' ' : '');
    switch (n.tagName) {
      case 'STRONG': case 'B': return pad(`**${t}**`);
      case 'EM': case 'I': return pad(`*${t}*`);
      case 'A': return pad(`[${t}](${n.getAttribute('href')})`);
      case 'SUP': return ` ${t}`;
      case 'BR': return '\n';
      default: {
        const bg = n.style?.backgroundColor;
        return bg && bg !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(bg) ? pad(`==${t}==`) : inner;
      }
    }
  };
  const lines: string[] = [];
  for (const b of [...page.children] as HTMLElement[]) {
    const text = md(b).trim();
    switch (b.tagName) {
      case 'H1': lines.push(`# ${text}`, ''); break;
      case 'H2': lines.push(`## ${text}`, ''); break;
      case 'H3': lines.push(`### ${text}`, ''); break;
      case 'H4': lines.push(`#### ${text}`, ''); break;
      case 'BLOCKQUOTE': lines.push(`> ${text}`, ''); break;
      case 'HR': lines.push('---', ''); break;
      case 'FIGURE': { const n = [...page.querySelectorAll('figure')].indexOf(b) + 1; if (figures) lines.push(`[[Figure ${n}]]`, ''); else { const cap = b.querySelector('figcaption')?.textContent ?? ''; const tb = b.querySelector('table'); if (tb) { const rows = [...tb.querySelectorAll('tr')].map(tr => [...tr.children].map(c => (c as HTMLElement).innerText.replace(/\s+/g, ' ').replace(/\|/g, '/').trim())); if (rows.length) { lines.push(`| ${rows[0].join(' | ')} |`, `|${rows[0].map(() => ' --- ').join('|')}|`, ...rows.slice(1).map(r => `| ${r.join(' | ')} |`)); } } lines.push(`*${cap}*`, ''); } break; }
      case 'DIV': if (b.classList.contains('cx-tg')) { lines.push(`**${md(b.querySelector('.cx-tg-t') as HTMLElement).trim()}**`, ''); for (const k of [...(b.querySelector('.cx-tg-b')?.children ?? [])] as HTMLElement[]) { const t = md(k).trim(); if (t) lines.push(t, ''); } } break;
      case 'UL': case 'OL': [...b.children].forEach((li, i) => lines.push(`${b.tagName === 'OL' ? `${i + 1}.` : '-'} ${md(li).trim()}`)); lines.push(''); break;
      default: if (text) lines.push(text, '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function el(tag: string, cls: string) { const e = document.createElement(tag); e.className = cls; return e; }
function btn(cls: string, svg: string, label: string) { const b = el('button', cls); b.innerHTML = svg; b.setAttribute('aria-label', label); return b; }
