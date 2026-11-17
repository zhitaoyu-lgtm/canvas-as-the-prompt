// The side panel: one quiet button at the top right opens it. Two tabs:
//   Document — the board translated into a linear document that keeps its spatial grammar (translate.ts).
//              Typeset like a book; editable; right-click a selection to highlight it; hover a paragraph and a
//              small bubble asks Claude to change just that paragraph.
//   Chat     — talk to Claude about the board; it reads the board (and the document) each time.
// The document is a one-way snapshot: re-translated when it is opened and the board has changed, unless the
// user has edited it; then a line offers the update instead.

import { ask, ModelError } from '../ai/model';
import { readBoard, toPrompt } from '../ai/reading';
import { translateBoard, type Blk, type Run } from './translate';

const KEY = 'cx:document';
type Saved = { title: string; html: string; board: string; edited: boolean };

const I = {
  panel: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path d="M12.25 3.75v12.5M14.25 7h1M14.25 9.5h1"/></svg>',
  more: '<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="10" r="1.4"/><circle cx="10" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/></svg>',
  expand: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 3.75h4.75V8.5M8.5 16.25H3.75V11.5M16.25 3.75l-5 5M3.75 16.25l5-5"/></svg>',
  shrink: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8.75h-4.75V4M4 11.25h4.75V16M11.25 8.75l5-5M8.75 11.25l-5 5"/></svg>',
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>',
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
  const panel = el('aside', 'cx-pn'); panel.hidden = true;
  const head = el('div', 'cx-pn-head');
  const tabs = el('div', 'cx-pn-tabs');
  const tDoc = el('button', 'cx-pn-tab on'), tChat = el('button', 'cx-pn-tab');
  tDoc.textContent = 'Document'; tChat.textContent = 'Chat';
  tabs.append(tDoc, tChat);
  const acts = el('div', 'cx-pn-acts');
  const bMore = btn('cx-pn-ib', I.more, 'More'), bExpand = btn('cx-pn-ib', I.expand, 'Expand'), bClose = btn('cx-pn-ib', I.close, 'Close');
  acts.append(bMore, bExpand, bClose);
  head.append(tabs, acts);
  const docPane = el('div', 'cx-pn-body cx-doc-pane');
  const chatPane = el('div', 'cx-pn-body cx-chat-pane'); chatPane.hidden = true;
  panel.append(head, docPane, chatPane);
  document.body.append(open, panel);

  let tab: 'doc' | 'chat' = 'doc', wide = false;
  const show = (on: boolean) => { panel.hidden = !on; open.hidden = on; document.body.classList.toggle('cx-pn-on', on); if (on && tab === 'doc') refresh(); };
  const setTab = (t: 'doc' | 'chat') => {
    tab = t; tDoc.classList.toggle('on', t === 'doc'); tChat.classList.toggle('on', t === 'chat');
    docPane.hidden = t !== 'doc'; chatPane.hidden = t !== 'chat'; bMore.hidden = t !== 'doc';
    if (t === 'doc') refresh(); else input.focus();
  };
  open.onclick = () => show(true);
  bClose.onclick = () => show(false);
  bExpand.onclick = () => { wide = !wide; panel.classList.toggle('wide', wide); bExpand.innerHTML = wide ? I.shrink : I.expand; };
  tDoc.onclick = () => setTab('doc'); tChat.onclick = () => setTab('chat');

  // ── document ──
  const banner = el('div', 'cx-doc-note'); banner.hidden = true;
  banner.innerHTML = '<span>The board has changed since this was written.</span>';
  const bUpd = el('button', 'cx-doc-note-b'); bUpd.textContent = 'Update'; banner.append(bUpd);
  const page = el('article', 'cx-doc');
  page.contentEditable = 'true'; page.spellcheck = false;
  docPane.append(banner, page);

  const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };
  const boardHash = () => hash(toPrompt(readBoard(gfx, {}), { maxItems: 100000 }).replace(/^SELECTED.*$/m, ''));
  function rebuild() {
    const out = translateBoard(rootEl);
    page.innerHTML = render(out.title, out.blocks);
    save({ title: out.title, html: page.innerHTML, board: boardHash(), edited: false });
    banner.hidden = true;
  }
  function refresh() {
    flush();
    const s = load();
    if (!s) return rebuild();
    if (page.innerHTML !== s.html) page.innerHTML = s.html;
    const changed = s.board !== boardHash();
    if (changed && !s.edited) rebuild(); else banner.hidden = !changed;
  }
  bUpd.onclick = () => rebuild();
  let saving: any = null;
  const flush = () => { if (saving === null) return; clearTimeout(saving); saving = null; const s = load(); save({ title: titleOf(), html: page.innerHTML, board: s?.board ?? '', edited: true }); };
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
  let asking: HTMLElement | null = null;
  hover.onclick = () => {
    if (!target) return; asking = target; hover.hidden = true;
    asking.classList.add('cx-doc-focus');
    const pr = docPane.getBoundingClientRect(), br = asking.getBoundingClientRect();
    askBox.style.top = `${br.bottom - pr.top + docPane.scrollTop + 8}px`; askBox.hidden = false; askIn.value = ''; askIn.focus();
  };
  const closeAsk = () => { askBox.hidden = true; asking?.classList.remove('cx-doc-focus'); asking = null; };
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
    const b = asking, req = askIn.value.trim(); if (!b || !req) return;
    askBox.classList.add('busy'); askIn.disabled = true;
    try {
      const sys = `You edit one paragraph of a document that was translated from the user's spatial canvas (a whiteboard).
Return only the new paragraph, nothing else: no quotes, no preface. English. Keep citation markers like [2] where they still apply.
You may use **bold** and ==highlight==. Keep it about as long unless asked otherwise.`;
      const user = `THE WHOLE DOCUMENT (for context)\n${toMarkdown(page)}\n\nTHE PARAGRAPH TO CHANGE\n${b.textContent}\n\nWHAT TO CHANGE\n${req}`;
      const mock = (window as any).cxMockDoc;
      const out = String(mock ? (typeof mock === 'function' ? await mock(b.textContent, req) : mock) : await ask(sys, user)).trim();
      if (out) { b.innerHTML = inline(out); page.dispatchEvent(new Event('input')); }
      closeAsk();
    } catch (e: any) { flash(e instanceof ModelError && e.code === 'no_model' ? 'Connect Claude in settings first' : 'Claude could not answer'); }
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
    e.preventDefault(); range = s.getRangeAt(0).cloneRange();
    const pr = panel.getBoundingClientRect();
    palette.style.left = `${Math.min(e.clientX - pr.left, pr.width - 250)}px`; palette.style.top = `${e.clientY - pr.top + 8}px`; palette.hidden = false;
  });
  function mark(hex: string) {
    restore(); document.execCommand('styleWithCSS', false, 'true'); document.execCommand('hiliteColor', false, hex);
    palette.hidden = true; getSelection()?.removeAllRanges(); page.dispatchEvent(new Event('input'));
  }

  // ── chat ──
  const log = el('div', 'cx-chat-log');
  const empty = el('div', 'cx-chat-empty'); empty.textContent = 'Ask about your board. Claude reads it each time you ask.'; log.append(empty);
  const box = el('div', 'cx-chat-box');
  const input = document.createElement('textarea'); input.className = 'cx-chat-in'; input.placeholder = 'Reply to Claude…'; input.rows = 1;
  const go = btn('cx-chat-go', I.send, 'Send');
  box.append(input, go); chatPane.append(log, box);
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
      wait.textContent = e instanceof ModelError && e.code === 'no_model' ? 'Connect Claude in settings to chat.' : 'Couldn’t reach Claude. Try again.';
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
  let list: string | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const b of blocks) {
    if (b.type === 'bulleted' || b.type === 'numbered') {
      const tag = b.type === 'bulleted' ? 'ul' : 'ol';
      if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${runs(b.runs)}</li>`); continue;
    }
    close();
    if (b.type === 'divider') out.push('<hr>');
    else if (b.type === 'h1') out.push(`<h2>${runs(b.runs)}</h2>`);
    else if (b.type === 'h2') out.push(`<h3>${runs(b.runs)}</h3>`);
    else if (b.type === 'h3') out.push(`<h4>${runs(b.runs)}</h4>`);
    else if (b.type === 'quote') out.push(`<blockquote>${runs(b.runs)}</blockquote>`);
    else out.push(`<p>${runs(b.runs)}</p>`);
  }
  close();
  return out.join('');
}
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
export function toMarkdown(page: HTMLElement): string {
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
      case 'UL': case 'OL': [...b.children].forEach((li, i) => lines.push(`${b.tagName === 'OL' ? `${i + 1}.` : '-'} ${md(li).trim()}`)); lines.push(''); break;
      default: if (text) lines.push(text, '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function el(tag: string, cls: string) { const e = document.createElement(tag); e.className = cls; return e; }
function btn(cls: string, svg: string, label: string) { const b = el('button', cls); b.innerHTML = svg; b.setAttribute('aria-label', label); return b; }
