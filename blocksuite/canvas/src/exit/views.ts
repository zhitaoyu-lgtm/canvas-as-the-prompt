// Two views of one board: the canvas, and the document it translates into (AFFiNE's page mode).
// Switching to the document is the exit: the board is read and written out as linear text that keeps its
// spatial grammar (see translate.ts). The document is then the user's own: if they edit it, a later change on
// the board does not overwrite it; they are asked first.
//
// Top bar: left, the view switch and the board's name; right, Share (Markdown for any model) and the side panel.

import { Text } from '@blocksuite/affine/store';
import { readBoard, toPrompt } from '../ai/reading';
import { toast } from '../ai/proposals';
import { translateBoard, type Blk, type Run } from './translate';

const DOC_ID = 'doc:main';
const K_BOARD = 'cx:doc-board-hash', K_DOC = 'cx:doc-hash';
type View = 'canvas' | 'doc';

const I = {
  doc: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.25" y="2.75" width="11.5" height="14.5" rx="2.5"/><path d="M7.5 7h5M7.5 10h5M7.5 13h3"/></svg>',
  canvas: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="3.25" width="6" height="5" rx="1.5"/><circle cx="14.5" cy="13.5" r="3"/><path d="M5.75 8.25v3.5a1.75 1.75 0 0 0 1.75 1.75h4"/></svg>',
  panel: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path d="M12.25 3.75v12.5M14.25 7h1M14.25 9.5h1"/></svg>',
};

export function mountViews(rootEl: any, collection: any, makeDocEditor: (store: any) => HTMLElement) {
  const gfx = rootEl.gfx;
  let docStore: any = null, docEditor: HTMLElement | null = null;
  let view: View = 'canvas', side = false;

  // ── the document behind the doc view ──
  function ensureDoc() {
    if (docStore) return docStore;
    let d = collection.getDoc(DOC_ID);
    if (!d) {
      d = collection.createDoc(DOC_ID);
      const st = d.getStore();
      d.load(() => { const page = st.addBlock('affine:page', { title: new Text() }); st.addBlock('affine:surface', {}, page); st.addBlock('affine:note', {}, page); });
      st.resetHistory();
    }
    if (!d.loaded) d.load();
    docStore = d.getStore();
    return docStore;
  }
  const noteOf = (st: any) => { const page = st.root; let n = page.children.find((c: any) => c.flavour === 'affine:note'); if (!n) { st.addBlock('affine:note', {}, page.id); n = page.children.find((c: any) => c.flavour === 'affine:note'); } return n; };

  const deltaOf = (runs: Run[]) => runs.filter(r => r.text).map(r => {
    const a: any = {};
    if (r.bold) a.bold = true; if (r.italic) a.italic = true; if (r.link) a.link = r.link;
    if (r.hl) a.background = `var(--affine-text-highlight-${r.hl === 'gray' ? 'grey' : r.hl})`;
    if (r.muted) a.color = 'var(--affine-text-highlight-foreground-grey)';
    return Object.keys(a).length ? { insert: r.text, attributes: a } : { insert: r.text };
  });
  function write(title: string, blocks: Blk[]) {
    const st = ensureDoc();
    try {
      st.transact(() => {
        st.updateBlock(st.root, { title: new Text(title) });
        const note = noteOf(st);
        for (const c of [...note.children]) st.deleteBlock(c);
        for (const b of blocks) {
          if (b.type === 'divider') st.addBlock('affine:divider', {}, note.id);
          else if (b.type === 'bulleted' || b.type === 'numbered') st.addBlock('affine:list', { type: b.type, text: new Text(deltaOf(b.runs) as any) }, note.id);
          else st.addBlock('affine:paragraph', { type: b.type, text: new Text(deltaOf(b.runs) as any) }, note.id);
        }
      });
      st.resetHistory?.();
    } catch (e) { console.warn('[doc] could not write', e); }
  }

  // ── the board → the document, unless the user has made the document their own ──
  const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };
  const boardHash = () => hash(toPrompt(readBoard(gfx, {}), { maxItems: 100000 }).replace(/^SELECTED.*$/m, ''));
  const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* no storage */ } };
  function rebuild() {
    const out = translateBoard(rootEl);
    write(out.title, out.blocks);
    set(K_BOARD, boardHash()); set(K_DOC, hash(toMarkdown(ensureDoc())));
    title.textContent = out.title;
    banner.hidden = true;
  }
  function refresh() {
    const st = ensureDoc();
    const empty = !noteOf(st).children.length;
    const boardChanged = get(K_BOARD) !== boardHash();
    const edited = !empty && get(K_DOC) !== hash(toMarkdown(st));
    if (empty || (boardChanged && !edited)) rebuild();
    else banner.hidden = !boardChanged;      // their edits stay; offer the update
  }

  // ── UI ──
  const bar = el('div', 'cx-top cx-top-left');
  const seg = el('div', 'cx-seg');
  const bDoc = btn('cx-seg-b', I.doc, 'Document'), bCanvas = btn('cx-seg-b on', I.canvas, 'Canvas');
  seg.append(bDoc, bCanvas);
  const title = el('div', 'cx-top-title'); title.textContent = 'Board';
  bar.append(seg, el('i', 'cx-top-div'), title);
  const right = el('div', 'cx-top cx-top-right');
  const share = el('button', 'cx-share'); share.textContent = 'Share';
  const bPanel = btn('cx-icon-b', I.panel, 'Side panel');
  right.append(share, bPanel);
  const host = el('div', 'cx-doc-host'); host.hidden = true;
  const banner = el('div', 'cx-doc-banner'); banner.hidden = true;
  banner.innerHTML = '<span>The board has changed since this document was made.</span>';
  const upd = el('button', 'cx-doc-update'); upd.textContent = 'Update from board'; banner.append(upd);
  host.append(banner);
  document.body.append(host, bar, right);

  const mountEditor = () => { if (docEditor) return; docEditor = makeDocEditor(ensureDoc()); docEditor.classList.add('cx-doc-editor'); host.append(docEditor); };
  function show(v: View, s = side) {
    view = v; side = v === 'canvas' && s;
    bDoc.classList.toggle('on', v === 'doc'); bCanvas.classList.toggle('on', v === 'canvas');
    bPanel.classList.toggle('on', side);
    document.body.classList.toggle('cx-docmode', v === 'doc');
    if (v === 'doc' || side) { refresh(); mountEditor(); host.hidden = false; host.classList.toggle('side', side); }
    else host.hidden = true;
  }
  bDoc.onclick = () => show('doc');
  bCanvas.onclick = () => show('canvas', false);
  bPanel.onclick = () => show('canvas', !side);
  upd.onclick = () => rebuild();

  // Share: the document as Markdown, ready for Claude, GPT or any model
  const menu = el('div', 'cx-menu'); menu.hidden = true;
  const item = (label: string, fn: () => void) => { const b = el('button', 'cx-menu-i'); b.textContent = label; b.onclick = () => { menu.hidden = true; fn(); }; menu.append(b); };
  const markdown = () => { refresh(); return toMarkdown(ensureDoc()); };
  item('Copy as Markdown', async () => {
    const md = markdown();
    try { await navigator.clipboard.writeText(md); toast('Copied as Markdown', anchorBelow(share)); }
    catch { toast('Copy was blocked here', anchorBelow(share)); }
  });
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) item('Download .md', () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown' }));
    a.download = (title.textContent || 'board').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.md'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  right.append(menu);
  share.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== share) menu.hidden = true; });

  // the board's name, once it has settled
  setTimeout(() => { try { title.textContent = translateBoard(rootEl).title; } catch { /* keep */ } }, 1200);
  (window as any).cxViews = { show, rebuild, markdown: () => markdown(), get view() { return view; } };
}

// ── the document as Markdown (whatever the user has edited since) ──
export function toMarkdown(st: any): string {
  const inl = (t: any) => {
    let out = '';
    for (const d of (t?.toDelta?.() ?? []) as any[]) {
      let s = String(d.insert ?? ''); const a = d.attributes ?? {};
      if (!s) continue;
      const lead = s.match(/^\s*/)![0], trail = s.match(/\s*$/)![0]; let core = s.trim();
      if (!core) { out += s; continue; }
      if (a.link) core = `[${core}](${a.link})`;
      if (a.background) core = `==${core}==`;
      if (a.bold) core = `**${core}**`;
      if (a.italic) core = `*${core}*`;
      out += lead + core + trail;
    }
    return out;
  };
  const lines: string[] = [];
  const title = st.root?.props?.title?.toString?.() ?? '';
  if (title) lines.push(`# ${title}`, '');
  let n = 0;
  const walk = (b: any, depth: number) => {
    const f = b.flavour, p = b.props ?? {};
    if (f !== 'affine:list' || p.type !== 'numbered') n = 0;
    const pad = '  '.repeat(depth);
    if (f === 'affine:paragraph') {
      const t = inl(p.text), ty = p.type ?? 'text';
      if (/^h[1-6]$/.test(ty)) lines.push('', `${'#'.repeat(Math.min(6, +ty[1] + 1))} ${t}`, '');
      else if (ty === 'quote') lines.push(`> ${t}`, '');
      else if (t.trim()) lines.push(t, '');
    } else if (f === 'affine:list') lines.push(`${pad}${p.type === 'numbered' ? `${++n}.` : p.type === 'todo' ? (p.checked ? '- [x]' : '- [ ]') : '-'} ${inl(p.text)}`);
    else if (f === 'affine:divider') lines.push('', '---', '');
    for (const c of b.children ?? []) walk(c, f === 'affine:list' ? depth + 1 : depth);
    if (f === 'affine:list' && depth === 0 && !(b.nextSibling?.flavour === 'affine:list')) lines.push('');
  };
  for (const note of st.root?.children ?? []) if (note.flavour === 'affine:note') for (const c of note.children) walk(c, 0);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function el(tag: string, cls: string) { const e = document.createElement(tag); e.className = cls; return e; }
function btn(cls: string, svg: string, label: string) { const b = el('button', cls); b.innerHTML = svg; b.setAttribute('aria-label', label); return b; }
function anchorBelow(e: HTMLElement) { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 14 }; }
