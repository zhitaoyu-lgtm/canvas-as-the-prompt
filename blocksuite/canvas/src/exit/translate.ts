// Exit: the board translated into a linear document.
//
// Not a dump of card text: the arrangement carries meaning, and the document says it in its own terms.
//
//   On the board                                   In the document
//   ─────────────────────────────────────────────  ──────────────────────────────────────────────
//   a named section (frame), its heading text      a heading (depth = nesting); its subtitle in italics
//   a titled group of things                       a sub-heading with its things under it
//   things side by side, no title                  a list, in reading order
//   a source (link / paper card)                   a reference [n], listed at the end
//   notes stuck on / under a source                points about that source, each citing it [n]
//   a big note, a circled or underlined one,       a key point: highlighted, and gathered at the top
//     one with votes, or one said more than once     (votes and repeats are counted, never hidden)
//   words highlighted inside a note                the same words, same highlight colour
//   a colour with a meaning (legend, key, tag)     a local definition at the start of its section;
//                                                    the meaning travels with the thing as a label
//   number badges on things                        a numbered list in that order
//   an arrow between two things                    a relation sentence: A → B (label)
//   an empty note, an open slot                    an open question at the end
//   a comment pin                                  a quoted note under the thing it is about
//   things outside every section                   "Other notes"
// Uncertainty is kept: nothing loose is promoted to a finding, and the document says how it was made.

import { readBoard, type Item, type Reading } from '../ai/reading';

import { bars, boardMap, mapLegend, noteCards, pinned as pinnedViz, sourceTable, timeline, type MapItem } from './visuals';

export type Run = { text: string; bold?: boolean; italic?: boolean; link?: string; hl?: string; muted?: boolean };
export type Blk =
  | { type: 'h1' | 'h2' | 'h3' | 'text' | 'quote'; runs: Run[] }
  | { type: 'bulleted' | 'numbered'; runs: Run[]; depth?: number }
  | { type: 'divider' }
  | { type: 'figure'; box: { x: number; y: number; w: number; h: number }; caption: string }
  // a few things from the board, enlarged and set side by side
  | { type: 'gallery'; boxes: { x: number; y: number; w: number; h: number }[]; caption: string }
  // a picture the document draws itself (map, table, chart, note cards); html is ready to place
  | { type: 'visual'; kind: string; head: string; html: string; caption: string; box?: { x: number; y: number; w: number; h: number } };
export type DocOut = { title: string; blocks: Blk[] };

// ── as prose: a document reads in paragraphs, like a book; lists only where a list is the point ──
const textOf = (rs: Run[]) => rs.map(r => r.text).join('');
const isCite = (r?: Run) => !!r && /^\s*\[\d+\]\s*$/.test(r.text);
const lower = (rs: Run[]) => { const c = rs.map(r => ({ ...r })); const f = c.find(r => r.text.trim() && !r.bold && !r.link); if (f && /^[A-Z][a-z]/.test(f.text.trim())) f.text = f.text.replace(/^(\s*)([A-Z])/, (_m, a, b) => a + b.toLowerCase()); return c; };
const endSentence = (rs: Run[]): Run[] => {
  const out = rs.map(r => ({ ...r })); const cites = []; while (isCite(out[out.length - 1])) cites.unshift(out.pop()!);
  // the last words of the sentence (before any "(3 votes)" aside)
  let k = out.length - 1; while (k >= 0 && (out[k].muted || !out[k].text.trim())) k--;
  if (k >= 0 && !/[.!?:]\s*$/.test(out[k].text)) out[k].text = out[k].text.replace(/\s*$/, '') + '.';
  if (k >= 0 && k < out.length - 1) { const tail = out.splice(k + 1); const dot = out[k].text.endsWith('.') ? (out[k].text = out[k].text.slice(0, -1), '.') : ''; out.push(...tail.map(t => ({ ...t, text: ' ' + t.text.trim() }))); out.push({ text: dot }); }
  return [...out, ...cites];
};
/** Text and pictures in a steady rhythm, like an edited article: a section's own picture stays under its heading;
 *  any other picture waits until at least two paragraphs have passed since the last one, so pictures never pile
 *  up, and pictures still waiting are let in where the text runs long. Whatever is left goes before References. */
export function pace(blocks: Blk[]): Blk[] {
  // Text and pictures in a steady rhythm, like an edited article. Fixed in place: the first picture (the board map,
  // which opens the document) and a section's own picture under its heading. Every other picture is spread evenly
  // over the paragraphs before References, in its original order, so pictures never pile up and long text gets relief.
  const isPic = (b: Blk) => b.type === 'figure' || b.type === 'gallery' || b.type === 'visual';
  const isHead = (b?: Blk) => !!b && (b.type === 'h1' || b.type === 'h2' || b.type === 'h3');
  const texty = (b: Blk) => b.type === 'text' || b.type === 'quote' || b.type === 'bulleted' || b.type === 'numbered';
  const firstPic = blocks.findIndex(isPic);
  const body: Blk[] = [], floating: Blk[] = [];
  blocks.forEach((b, i) => { if (isPic(b) && i !== firstPic && !(b.type === 'figure' && isHead(blocks[i - 1]))) floating.push(b); else body.push(b); });
  if (!floating.length) return body;
  const refAt = body.findIndex(b => isHead(b) && textOf((b as any).runs) === 'References');
  const end = refAt < 0 ? body.findIndex(b => b.type === 'divider') : refAt;
  const slots = body.slice(0, end < 0 ? body.length : end).map((b, i) => texty(b) ? i : -1).filter(i => i >= 0);
  if (!slots.length) { const at = end < 0 ? body.length : end; body.splice(at, 0, ...floating); return body; }
  const K = floating.length, T = slots.length;
  const after = new Map<number, Blk[]>();
  floating.forEach((f, j) => { const at = slots[Math.max(0, Math.min(T - 1, Math.round((j + 1) * T / (K + 1)) - 1))]; after.set(at, [...(after.get(at) ?? []), f]); });
  const out: Blk[] = [];
  body.forEach((b, i) => { out.push(b); const fs = after.get(i); if (fs) out.push(...fs); });
  return out;
}

export function asProse(blocks: Blk[]): Blk[] {
  const out: Blk[] = [];
  let i = 0;
  const listAt = (j: number) => { const items: Blk[] = []; while (j < blocks.length && (blocks[j].type === 'bulleted' || blocks[j].type === 'numbered')) items.push(blocks[j++]); return items as { type: 'bulleted' | 'numbered'; runs: Run[] }[]; };
  while (i < blocks.length) {
    const b = blocks[i];
    // "Key points" + its quotes → an opening paragraph
    if (b.type === 'h2' && textOf(b.runs) === 'Key points') {
      const qs: Run[][] = []; i++; while (i < blocks.length && blocks[i].type === 'quote') qs.push((blocks[i++] as any).runs);
      const runs: Run[] = [{ text: 'What stands out on the board: ' }];
      qs.forEach((q, k) => { if (k) runs.push({ text: k === qs.length - 1 ? '; and ' : '; ' }); runs.push(...lower(q.filter(r => !isCite(r)))); });
      runs.push({ text: '.' });
      out.push({ type: 'quote', runs }); continue;
    }
    // References stay a list
    if ((b.type === 'h1' || b.type === 'h2') && textOf(b.runs) === 'References') { out.push(b); i++; const items = listAt(i); out.push(...items); i += items.length; continue; }
    // "How they connect" + its lines → sentences
    if (b.type === 'text' && textOf(b.runs) === 'How they connect') {
      i++; const items = listAt(i); i += items.length;
      out.push({ type: 'text', runs: items.flatMap((it, k) => [...(k ? [{ text: ' ' }] : []), ...endSentence(it.runs.map(r => r.text === ' → ' ? { text: ' leads to ' } : r.text === ' — ' ? { text: ' is tied to ' } : r))]) });
      continue;
    }
    // notes under a source → the same paragraph, cited once
    if (b.type === 'text' && isCite(b.runs[b.runs.length - 1]) && (blocks[i + 1]?.type === 'bulleted')) {
      const items = listAt(i + 1); const cite = b.runs[b.runs.length - 1];
      const strip = (rs: Run[]) => rs.filter(r => !isCite(r));
      const runs: Run[] = [...b.runs.slice(0, -1), { text: items.length > 1 ? ' The notes placed beside it add that ' : ' A note placed beside it adds that ' }];
      items.forEach((it, k) => { if (k) runs.push({ text: k === items.length - 1 ? ', and that ' : ', that ' }); runs.push(...lower(strip(it.runs))); });
      out.push({ type: 'text', runs: [...endSentence(runs), cite] }); i += 1 + items.length; continue;
    }
    // any other run of list items → one paragraph of sentences (numbered: first, then, finally)
    if (b.type === 'bulleted' || b.type === 'numbered') {
      const items = listAt(i); i += items.length;
      const ordered = items[0].type === 'numbered' && items.length > 1;
      const runs: Run[] = [];
      items.forEach((it, k) => {
        if (k) runs.push({ text: ' ' });
        if (ordered) runs.push({ text: k === 0 ? 'First, ' : k === items.length - 1 ? 'Finally, ' : 'Then, ' });
        runs.push(...endSentence(ordered ? lower(it.runs) : it.runs));
      });
      out.push({ type: 'text', runs }); continue;
    }
    out.push(b); i++;
  }
  return out;
}

const COMMENTS = 'cx:comments';
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[.。!！?？]+$/, '').trim();
const words = (t: string) => t.replace(/\s+/g, ' ').trim();
const HL = new Set(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'grey', 'gray', 'pink']);

export function translateBoard(rootEl: any): DocOut {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const r: Reading = readBoard(gfx, {});
  const by = r.byRef;
  const blocks: Blk[] = [];
  const used = new Set<string>();             // refs already said

  // ── what counts as content ──
  const isMark = (i: Item) => ['dot', 'badge', 'sticker', 'connector', 'drawing', 'highlight', 'tag'].includes(i.kind) || (i as any)._partOfTag;
  const kidsOf = (ref: string) => r.items.filter(i => i.parent === ref);
  const cardText = (i: Item) => i.kind === 'card' ? kidsOf(i.ref).filter(k => k.kind === 'text').map(k => k.text).filter(Boolean) : [];

  // ── sources: things with a link, or a note whose first line is a titled reference ──
  const linkOf = (i: Item): string | undefined => {
    const el: any = gfx.getElementById(i.id); if (!el) return;
    if (el.props?.url || el.url) return el.props?.url ?? el.url;
    let found: string | undefined;
    const walk = (m: any) => { if (found) return; const t = m?.props?.text ?? m?.text; try { for (const d of t?.toDelta?.() ?? []) if (d.attributes?.link) { found = d.attributes.link; return; } } catch { /* plain */ } for (const c of m?.children ?? []) walk(c); };
    walk(el);
    return found;
  };
  const sources = new Map<string, { n: number; title: string; url?: string; meta?: string; body?: string }>();
  const sourceOrder: string[] = [];
  const noteParts = (i: Item) => {
    // our link cards: [meta] title body; user notes: lines
    const el: any = gfx.getElementById(i.id);
    const paras: { type?: string; text: string }[] = [];
    const walk = (m: any) => { const t = m?.props?.text; const s = t?.toString?.() ?? ''; if (s.trim()) paras.push({ type: m.props?.type, text: s.trim() }); for (const c of m?.children ?? []) walk(c); };
    for (const c of el?.children ?? []) walk(c);
    return paras;
  };
  const META = /(\b(1[89]|20)\d\d\b|\b[a-z0-9-]+\.(com|org|net|io|ai|so|edu|app|dev|google)\b|·)/i;
  const cardOf = (i: Item) => {
    const parts = i.kind === 'doc' ? noteParts(i) : [];
    if (parts.length < 2) return null;
    const head = parts.find(p => /^h[1-6]$/.test(p.type ?? '')) ?? parts.find(p => !(p.text.length <= 60 && META.test(p.text)));
    if (!head || head.text.length > 120) return null;
    const rest = parts.filter(p => p !== head);
    const meta = rest.filter(p => p.text.length <= 60 && META.test(p.text)).map(p => p.text);
    const body = rest.filter(p => !meta.includes(p.text)).map(p => p.text);
    return { title: head.text, meta: meta.join(' · '), body: body.join(' ') };
  };
  const isSource = (i: Item) => (i.kind === 'doc' || i.kind === 'embed' || i.kind === 'card') && (!!linkOf(i) || !!cardOf(i)?.meta);
  const cite = (ref: string) => {
    let s = sources.get(ref);
    if (!s) {
      const i = by.get(ref)!; const c = cardOf(i);
      s = { n: sources.size + 1, title: c?.title ?? i.text.split('\n')[0] ?? 'Source', url: linkOf(i), meta: c?.meta || undefined, body: c?.body }; sources.set(ref, s); sourceOrder.push(ref);
    }
    return s.n;
  };

  // notes stuck on or right under a source belong to it (and notes stuck to those, down the column)
  const near = (a: Item, b: Item, slack: number) => {
    const ax1 = a.box.x + a.box.w, ay1 = a.box.y + a.box.h, bx1 = b.box.x + b.box.w, by1 = b.box.y + b.box.h;
    const dx = Math.max(0, Math.max(a.box.x, b.box.x) - Math.min(ax1, bx1)), dy = Math.max(0, Math.max(a.box.y, b.box.y) - Math.min(ay1, by1));
    return Math.hypot(dx, dy) <= slack;
  };
  const aboutSource = new Map<string, string>();   // note ref → source ref
  {
    const src = r.items.filter(isSource);
    const notes = r.items.filter(i => (i.kind === 'sticky' || (i.kind === 'text' && i.text.length < 200)) && !isMark(i));
    for (const n of notes) {
      const host = r.relations.attached.get(n.ref);
      if (host && src.some(s => s.ref === host)) { aboutSource.set(n.ref, host); continue; }
      const s = src.find(s => s.parent === n.parent && near(n, s, 18) && n.box.y >= s.box.y - 4);
      if (s) aboutSource.set(n.ref, s.ref);
    }
    for (let pass = 0; pass < 4; pass++) for (const n of notes) {
      if (aboutSource.has(n.ref)) continue;
      const m = notes.find(o => aboutSource.has(o.ref) && o.parent === n.parent && near(n, o, 14) && n.box.y >= o.box.y - 4);
      if (m) aboutSource.set(n.ref, aboutSource.get(m.ref)!);
    }
  }

  // ── emphasis: big, circled, underlined, voted, repeated ──
  const votes = new Map<string, number>(), badges = new Map<string, number>(), labels = new Map<string, string[]>();
  for (const [a, host] of r.relations.attached) {
    const m = by.get(a); if (!m) continue;
    if (m.kind === 'dot') votes.set(host, (votes.get(host) ?? 0) + 1);
    else if (m.kind === 'badge' && /^\d+$/.test(m.text.trim())) badges.set(host, +m.text.trim());
    else if (m.kind === 'tag' && m.text) (labels.get(host) ?? labels.set(host, []).get(host)!).push(m.text.trim());
  }
  // colour dots on corners (our tags) and legends: colour → meaning, scoped to where the legend is
  const legend = new Map<string, { label: string; scope?: string }>();
  for (const l of r.relations.legend) legend.set(l.colour, { label: l.label, scope: by.get(l.ref)?.parent });
  // marks that point at one thing: a loop around it, a stroke under it
  const marked = new Set<string>();
  for (const d of r.items.filter(i => i.kind === 'drawing' || i.kind === 'highlight')) {
    const inside = r.items.filter(i => i.parent === d.ref && !isMark(i));
    if (inside.length === 1) marked.add(inside[0].ref);
    if (d.box.h <= 28 && d.box.w >= 30) {
      const under = r.items.find(i => !isMark(i) && i.kind !== 'frame' && d.box.y >= i.box.y + i.box.h - 12 && d.box.y <= i.box.y + i.box.h + 30 && Math.min(d.box.x + d.box.w, i.box.x + i.box.w) - Math.max(d.box.x, i.box.x) > d.box.w * 0.5);
      if (under) marked.add(under.ref);
    }
  }
  const textOf = (i: Item) => i.kind === 'card' ? cardText(i).join(' · ') : i.text;
  const said = new Map<string, Item[]>();
  for (const i of r.items) if (!isMark(i) && i.kind !== 'frame' && i.kind !== 'group' && textOf(i).trim().length > 3) {
    const k = norm(textOf(i)); (said.get(k) ?? said.set(k, []).get(k)!).push(i);
  }
  const repeats = (i: Item) => said.get(norm(textOf(i)))?.length ?? 1;
  const weight = (i: Item) => (i.size === 'large' && (i.kind === 'sticky' || i.kind === 'shape') ? 2 : 0) + (marked.has(i.ref) ? 2 : 0) + Math.min(3, votes.get(i.ref) ?? 0) + (repeats(i) > 1 ? 2 : 0);

  // ── comments ──
  const comments = new Map<string, string[]>();
  try { const m = store.spaceDoc?.getMap?.(COMMENTS) ?? store.doc?.spaceDoc?.getMap?.(COMMENTS); for (const c of m?.values?.() ?? []) { const on = r.byId.get(c.on)?.ref; if (on) (comments.get(on) ?? comments.set(on, []).get(on)!).push(c.text); } } catch { /* none */ }

  // ── one thing → runs ──
  const meaningOf = (i: Item, scope?: string) => {
    const out = [...(labels.get(i.ref) ?? [])];
    const lg = i.colour ? legend.get(i.colour) : undefined;
    if (lg && (!lg.scope || lg.scope === scope || i.parent === lg.scope)) out.unshift(lg.label);
    return out;
  };
  const runsFor = (i: Item, scope?: string): Run[] => {
    const runs: Run[] = [];
    const lab = meaningOf(i, scope);
    if (lab.length) runs.push({ text: lab.join(', ') + ': ', bold: true });
    const w = weight(i), hl = w >= 2 ? 'yellow' : undefined;
    const t = words(textOf(i));
    // words the user highlighted inside a note keep their colour
    const mk = (i.marks ?? []).filter(m => m.text && t.includes(words(m.text)));
    if (mk.length) {
      let rest = t;
      for (const m of mk) { const s = words(m.text); const k = rest.indexOf(s); if (k < 0) continue; if (k) runs.push({ text: rest.slice(0, k), hl }); runs.push({ text: s, hl: HL.has(m.colour) ? m.colour : 'yellow', bold: true }); rest = rest.slice(k + s.length); }
      if (rest) runs.push({ text: rest, hl });
    } else runs.push({ text: t, hl, bold: w >= 3 });
    const extra: string[] = [];
    const v = votes.get(i.ref); if (v) extra.push(`${v} vote${v > 1 ? 's' : ''}`);
    if (repeats(i) > 1) extra.push(`raised ${repeats(i)} times`);
    if (marked.has(i.ref)) extra.push('marked on the board');
    if (extra.length) runs.push({ text: `  (${extra.join(', ')})`, muted: true, italic: true });
    const src = aboutSource.get(i.ref); if (src) runs.push({ text: ` [${cite(src)}]`, muted: true });
    return runs;
  };

  const sourceBlock = (s: Item): Blk[] => {
    const n = cite(s.ref), info = sources.get(s.ref)!;
    const body = info.body ? ' ' + info.body.replace(/^[.\s]+/, '').replace(/([^.!?])$/, '$1.') : '';
    const out: Blk[] = [{ type: 'text', runs: [{ text: info.title, bold: true, link: info.url }, { text: (info.meta ? ` (${info.meta}).` : '.') + body }, { text: ` [${n}]`, muted: true }] }];
    const pts = r.items.filter(i => aboutSource.get(i.ref) === s.ref);
    for (const p of pts) { used.add(p.ref); out.push({ type: 'bulleted', runs: runsFor(p) }); for (const c of comments.get(p.ref) ?? []) out.push({ type: 'quote', runs: [{ text: c, italic: true }] }); }
    for (const c of comments.get(s.ref) ?? []) out.push({ type: 'quote', runs: [{ text: c, italic: true }] });
    return out;
  };

  // ── a set of things → blocks ──
  const say = (list: Item[], scope?: string, depth = 1): Blk[] => {
    const out: Blk[] = [];
    // in order of their number badges when the user numbered them
    const numbered = list.length > 1 && list.filter(i => badges.has(i.ref)).length >= Math.ceil(list.length / 2);
    if (numbered) list = [...list].sort((a, b) => (badges.get(a.ref) ?? 99) - (badges.get(b.ref) ?? 99));
    for (const i of list) {
      if (used.has(i.ref) || isMark(i)) continue;
      if (aboutSource.has(i.ref) && !used.has(aboutSource.get(i.ref)!)) continue;   // said with its source
      used.add(i.ref);
      if (i.kind === 'frame' || (i.children?.length && i.kind !== 'card')) { out.push(...container(i, depth + 1)); continue; }
      if (isSource(i)) { out.push(...sourceBlock(i)); continue; }
      if (i.kind === 'image') continue;
      if (i.kind === 'table' && i.table) { for (const row of i.table) out.push({ type: 'bulleted', runs: [{ text: row.filter(Boolean).join(' · ') }] }); continue; }
      if (!textOf(i).trim()) continue;
      // a note already said elsewhere (repeated): once is enough
      const twins = said.get(norm(textOf(i))) ?? []; twins.forEach(t => used.add(t.ref));
      const c = i.kind === 'doc' ? cardOf(i) : null;
      if (c) out.push({ type: 'text', runs: [{ text: c.title, bold: true }, ...(c.body ? [{ text: '. ' + c.body }] : [])] });
      else if (i.kind === 'doc' && i.text.includes('\n')) {
        for (const p of noteParts(i)) out.push(/^h[1-6]$/.test(p.type ?? '') ? { type: 'h3', runs: [{ text: p.text }] } : { type: 'text', runs: [{ text: p.text }] });
      } else out.push({ type: numbered ? 'numbered' : list.length > 1 || i.kind === 'sticky' ? 'bulleted' : 'text', runs: runsFor(i, scope) });
      for (const c of comments.get(i.ref) ?? []) out.push({ type: 'quote', runs: [{ text: c, italic: true }] });
    }
    return out;
  };

  // a section: its heading, its local key, then its groups and things in reading order
  const headingOf = (f: Item) => {
    if (f.text?.trim()) return { title: f.text.trim(), skip: [] as string[] };
    const kids = kidsOf(f.ref).filter(k => k.kind === 'text').sort((a, b) => a.box.y - b.box.y);
    const top = kids[0];
    if (top && (top.size === 'large' || (top.fontSize ?? 0) >= 18 || /bold/.test(top.style ?? '')) && top.box.y - f.box.y < 120) {
      const sub = kids.find(k => k !== top && k.box.y > top.box.y && k.box.y - (top.box.y + top.box.h) < 24 && (k.fontSize ?? 16) <= 16);
      return { title: top.text.trim(), sub: sub?.text.trim(), skip: [top.ref, ...(sub ? [sub.ref] : [])] };
    }
    const t = r.relations.titles.get(f.ref); const ti = t ? by.get(t) : undefined;
    return ti ? { title: ti.text.trim(), skip: [ti.ref] } : { title: '', skip: [] as string[] };
  };
  const container = (f: Item, depth: number): Blk[] => {
    const out: Blk[] = [];
    const h = headingOf(f); h.skip.forEach(s => used.add(s));
    if (h.title) out.push({ type: depth <= 1 ? 'h1' : depth === 2 ? 'h2' : 'h3', runs: [{ text: h.title }] });
    if (h.sub) out.push({ type: 'text', runs: [{ text: h.sub, italic: true, muted: true }] });
    if (depth <= 1 && f.kind === 'frame') out.push({ type: 'figure', box: f.box, caption: h.title || 'This section' });
    // a key that applies here, said here
    const here = r.relations.legend.filter(l => by.get(l.ref)?.parent === f.ref);
    if (here.length) { out.push({ type: 'text', runs: [{ text: 'Key: ', bold: true }, { text: here.map(l => `${l.colour} = ${l.label}`).join('; '), italic: true }] }); here.forEach(l => used.add(l.ref)); }
    const kids = kidsOf(f.ref).filter(k => !used.has(k.ref) && k.kind !== 'connector');
    // titled groups inside become sub-headings
    for (const g of r.groups.filter(g => g.in === f.ref && g.members.length > 1)) {
      const t = r.relations.titles.get(g.ref); const ti = t ? by.get(t) : undefined;
      if (!ti || used.has(ti.ref)) continue;
      used.add(ti.ref);
      out.push({ type: depth <= 1 ? 'h2' : 'h3', runs: [{ text: ti.text.trim() }] });
      out.push(...say(g.members.map(m => by.get(m)!).filter(Boolean), f.ref, depth + 1));
    }
    out.push(...say(kids, f.ref, depth));
    // relations drawn inside this section
    out.push(...lines(kids.map(k => k.ref).concat(r.items.filter(i => i.parent === f.ref && i.kind === 'connector').map(i => i.ref))));
    return out;
  };
  const lineDone = new Set<string>();
  const lines = (refs: string[]): Blk[] => {
    const set = new Set(refs), out: Blk[] = [];
    for (const c of r.items.filter(i => i.kind === 'connector' && i.arrow?.from && i.arrow?.to && !lineDone.has(i.ref))) {
      const a = by.get(c.arrow!.from!), b = by.get(c.arrow!.to!);
      if (!a || !b || !(set.has(c.ref) || set.has(a.ref) || set.has(b.ref))) continue;
      lineDone.add(c.ref);
      const name = (x: Item) => isSource(x) ? (cite(x.ref), sources.get(x.ref)!.title) : clip(textOf(x), 60);
      out.push({ type: 'bulleted', runs: [{ text: name(a), bold: true }, { text: c.arrow!.directed ? ' → ' : ' — ' }, { text: name(b), bold: true }, ...(c.arrow!.label ? [{ text: `: ${c.arrow!.label}`, italic: true }] : [])] });
    }
    return out.length ? [{ type: 'text', runs: [{ text: 'How they connect', bold: true }] } as Blk, ...out] : [];
  };

  // ── the document ──
  const tops = r.items.filter(i => !i.parent && !r.relations.attached.has(i.ref));
  const title = (() => {
    const t = tops.filter(i => i.kind === 'text' && (i.size === 'large' || (i.fontSize ?? 0) >= 24)).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)[0];
    if (t) { used.add(t.ref); return t.text.trim(); }
    return 'Board';
  })();

  // key points first: what the user stressed, wherever it is
  const key = r.items.filter(i => !isMark(i) && i.kind !== 'frame' && weight(i) >= 2 && textOf(i).trim()).sort((a, b) => weight(b) - weight(a));
  const seenKey = new Set<string>();
  const keyBlocks: Blk[] = [];
  for (const i of key) { const k = norm(textOf(i)); if (seenKey.has(k)) continue; seenKey.add(k); if (keyBlocks.length < 5) keyBlocks.push({ type: 'quote', runs: runsFor(i) }); }
  if (keyBlocks.length) blocks.push({ type: 'h2', runs: [{ text: 'Key points' }] }, ...keyBlocks);

  const sections = tops.filter(i => i.kind === 'frame' || (i.children?.length && !['card', 'group'].includes(i.kind)));
  // pictures: with no sections to show one by one, the whole board opens the document
  const union = (xs: Item[]) => { const x = Math.min(...xs.map(i => i.box.x)), y = Math.min(...xs.map(i => i.box.y)); return { x, y, w: Math.max(...xs.map(i => i.box.x + i.box.w)) - x, h: Math.max(...xs.map(i => i.box.y + i.box.h)) - y }; };
  const fillOf = (i: Item): string | undefined => { const el: any = gfx.getElementById(i.id); const f = el?.fillColor ?? el?.props?.background; const v = typeof f === 'string' ? f : f?.normal ?? f?.light; return typeof v === 'string' && v.startsWith('#') ? v : undefined; };
  const isNote = (i: Item) => i.kind === 'sticky' || i.kind === 'shape';
  const drawn = r.items.filter(i => !isMark(i) && i.kind !== 'connector' && i.kind !== 'group' && i.box.w > 4 && i.box.h > 4);
  if (drawn.length > 2) {
    const mi: MapItem[] = drawn.map(i => ({ kind: i.kind === 'frame' ? 'frame' : isNote(i) ? 'sticky' : i.kind === 'text' ? 'text' : 'card', box: i.box, fill: isNote(i) ? fillOf(i) : undefined, label: i.kind === 'frame' ? headingOf(i).title : i.kind === 'text' ? i.text.trim() : undefined }));
    blocks.push({ type: 'visual', kind: 'map', head: 'Board map', html: boardMap(mi) + mapLegend(drawn.filter(isNote).map(fillOf).filter(Boolean) as string[]), caption: sections.length ? 'The board redrawn: each section and note where it was placed' : 'The board redrawn: every note and card where it was placed', box: union(drawn) });
  }
  for (const f of sections) { used.add(f.ref); blocks.push(...container(f, 1)); }
  // loose groups and things: titled groups become sections; the rest is "Other notes"
  for (const g of r.groups.filter(g => !g.in && g.members.length > 1)) {
    const t = r.relations.titles.get(g.ref); const ti = t ? by.get(t) : undefined;
    const ms = g.members.map(m => by.get(m)!).filter(m => m && !used.has(m.ref));
    if (!ms.length || !ti || used.has(ti.ref)) continue;
    used.add(ti.ref);
    blocks.push({ type: 'h1', runs: [{ text: ti.text.trim() }] }, ...say(ms, undefined, 1));
  }
  const looseSet = new Set(tops.filter(i => !used.has(i.ref) && !isMark(i) && i.kind !== 'connector').map(i => i.ref));
  // loose things are read the way boards are laid out: column by column (left to right), each top to bottom
  const cols: Item[][] = [];
  for (const i of [...looseSet].map(m => by.get(m)!).sort((a, b) => a.box.x - b.box.x)) {
    const c = cols.find(c => { const x0 = Math.min(...c.map(k => k.box.x)), x1 = Math.max(...c.map(k => k.box.x + k.box.w)); return i.box.x + i.box.w / 2 > x0 && i.box.x + i.box.w / 2 < x1; });
    c ? c.push(i) : cols.push([i]);
  }
  const rest: Blk[] = [];
  // the user's own notes, enlarged side by side: what they wrote, in their colours
  const stickies = cols.flat().filter(i => (i.kind === 'sticky' || i.kind === 'shape') && textOf(i).trim()).sort((a, b) => weight(b) - weight(a)).slice(0, 3).sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const own = cols.flat().filter(i => isNote(i) && textOf(i).trim() && !aboutSource.has(i.ref)).sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y).slice(0, 6);
  if (own.length >= 2) rest.push({ type: 'visual', kind: 'notes', head: 'Your notes', html: noteCards(own.map(i => ({ text: words(textOf(i)), fill: fillOf(i) }))), caption: 'The notes as written on the board, in their colours', box: union(own) });
  void stickies;
  for (const c of cols) rest.push(...say(c.sort((a, b) => a.box.y - b.box.y), undefined, 1));
  // close-ups of the notes the user placed on a source: the placement is the citation
  const pinned = sourceOrder.map(ref => [by.get(ref)!, ...r.items.filter(i => aboutSource.get(i.ref) === ref)]).filter(g => g[0] && g.length > 1).slice(0, 2);
  if (pinned.length) rest.splice(rest[0]?.type === 'visual' ? 1 : 0, 0, { type: 'visual', kind: 'pinned', head: 'Placed on a source', box: union(pinned.flat()),
    html: pinnedViz(pinned.map(g => { const s = sources.get(g[0].ref); return { n: s?.n ?? 0, title: s?.title ?? words(textOf(g[0])).slice(0, 60), meta: s?.meta, notes: g.slice(1).map(i => ({ text: words(textOf(i)), fill: fillOf(i) })) }; })),
    caption: pinned.length > 1 ? 'Notes placed on sources become citations of them' : 'A note placed on a source becomes a citation of it' } as Blk);
  if (rest.length) blocks.push({ type: 'h1', runs: [{ text: sections.length ? 'Other notes' : 'Notes' }] }, ...rest);
  const lineRest = lines(r.items.filter(i => i.kind === 'connector').map(i => i.ref));
  if (lineRest.length) blocks.push(...lineRest);

  // what was left open: empty notes and open slots
  const open: Blk[] = [];
  for (const i of r.items.filter(i => i.empty && (i.kind === 'sticky' || i.kind === 'shape'))) {
    const ctx = i.parent ? headingOf(by.get(i.parent)!).title : '';
    open.push({ type: 'bulleted', runs: [{ text: `An empty note${ctx ? ` in "${ctx}"` : ''} is waiting to be filled.`, italic: true }] });
  }
  if (open.length) blocks.push({ type: 'h1', runs: [{ text: 'Open questions' }] }, ...open.slice(0, 8));

  if (sources.size >= 2) {
    const kindOf = (m = '') => /paper/i.test(m) ? 'Paper' : /pdf/i.test(m) ? 'Paper' : /video/i.test(m) ? 'Video' : /forum/i.test(m) ? 'Forum thread' : /blog/i.test(m) ? 'Blog post' : /[a-z0-9-]+\.(com|org|net|io|ai|so|edu|app|dev|google)/i.test(m) ? 'Product / site' : 'Card';
    const yearOf = (m = '') => /\b(1[89]\d\d|20\d\d)\b/.exec(m)?.[1];
    const rows = sourceOrder.map(ref => { const s = sources.get(ref)!; return { n: s.n, title: s.title, kind: kindOf(s.meta), year: yearOf(s.meta), says: s.body ? clip(s.body, 110) : '', notes: r.items.filter(i => aboutSource.get(i.ref) === ref).map(i => clip(textOf(i), 60)) }; });
    const sb = union(sourceOrder.map(ref => by.get(ref)!).filter(Boolean));
    blocks.push({ type: 'visual', kind: 'table', head: 'Sources at a glance', html: sourceTable(rows), caption: `${rows.length} sources on the board, with what the board says about each`, box: sb });
    const dated = rows.filter(r => r.year).map(r => ({ year: +r.year!, label: r.title, n: r.n }));
    if (dated.length >= 2) {
      const und = new Map<string, number>(); for (const r of rows.filter(r => !r.year)) und.set(r.kind, (und.get(r.kind) ?? 0) + 1);
      blocks.push({ type: 'visual', kind: 'timeline', head: 'Timeline', html: timeline(dated, [...und].map(([k, n]) => ({ label: (n > 1 ? k.replace(/ \/ site$/, 's / sites').replace(/(Video|Card|Blog post|Forum thread)$/, '$1s') : k).toLowerCase(), n }))), caption: 'Dated sources in order; undated products and sites are today’s examples' });
    }
    const count = new Map<string, number>(); for (const r of rows) count.set(r.kind, (count.get(r.kind) ?? 0) + 1);
    const notesAll = r.items.filter(i => isNote(i) && textOf(i).trim());
    const comp = [...count].map(([label, value]) => ({ label: value > 1 && !/s$/.test(label) ? label.replace(/^Product \/ site$/, 'Products / sites') + (label === 'Product / site' ? '' : 's') : label, value }));
    if (notesAll.length) comp.push({ label: 'Your notes', value: notesAll.length, color: fillOf(notesAll[0]) ?? '#ffd3a8' } as any);
    const placed = notesAll.filter(i => aboutSource.has(i.ref)).length; if (placed) comp.push({ label: 'Notes placed on a source', value: placed, color: '#8b877c' } as any);
    if (comp.length >= 3) blocks.push({ type: 'visual', kind: 'bars', head: 'What the board is made of', html: bars(comp.sort((a, b) => b.value - a.value)), caption: 'Things on the board, by kind' });
  }
  if (sources.size) {
    blocks.push({ type: 'h1', runs: [{ text: 'References' }] });
    for (const ref of sourceOrder) { const s = sources.get(ref)!; blocks.push({ type: 'numbered', runs: [{ text: s.title, link: s.url }, ...(s.meta ? [{ text: `. ${s.meta}`, muted: true }] : [])] }); }
  }
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'text', runs: [{ text: `Translated from the board on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Headings are its sections; a point marked [n] was placed on that source; highlighted points were made big, circled, underlined, voted on or raised more than once.`, italic: true, muted: true }] });
  return { title, blocks };
}

const clip = (t: string, n: number) => { const s = words(t); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

