// Reading layer: turns the board into what a person would see.
//
//   L1 marks      what each thing is, its colour, its size, its words (and highlighted words inside them)
//   L2 space      which things sit together (rows, columns, grids, clusters), what is inside what,
//                 what is aligned, what small mark annotates which item
//   L3 structure  arrows and lines, the chains and branches they form, reading order, open slots
//
// Deterministic and fast: no model involved. The model gets `toPrompt(reading)`; code that places
// answers uses the same `Reading` object, so both sides talk about the same ids.

import { authorOf } from './provenance';

// ── Types ───────────────────────────────────────────────────────────────────────────
export type Kind =
  | 'sticky' | 'shape' | 'text' | 'doc' | 'table' | 'image' | 'sticker' | 'frame'
  | 'group' | 'connector' | 'drawing' | 'highlight' | 'mindmap' | 'embed' | 'item';

export type Box = { x: number; y: number; w: number; h: number };

export type Mark = { colour: string; text: string };             // highlighted words inside a text

export type Item = {
  ref: string;            // short id the model uses: s1, n2, f1 …
  id: string;             // real element id
  kind: Kind;
  box: Box;
  text: string;           // its words (docs and tables flattened, trimmed)
  colour?: string;        // colour name of its main paint
  hex?: string;
  shape?: string;         // for shapes: rect, ellipse, diamond, triangle …
  size?: 'small' | 'large';
  fontSize?: number;
  marks?: Mark[];
  table?: string[][];     // rows × columns, for tables
  empty?: boolean;        // has no words where words are expected
  author: 'user' | 'ai';
  parent?: string;        // ref of the frame / group / container it sits in
  arrow?: { from?: string; to?: string; directed: boolean; label?: string };
  children?: string[];    // frames, groups, containers
  order?: number;         // reading order (1-based)
};

export type Layout = 'row' | 'column' | 'grid' | 'cluster' | 'stack';

export type Group = {
  ref: string;            // G1 …  (spatial group, not the AFFiNE "group" element)
  layout: Layout;
  members: string[];      // in reading order
  box: Box;
  rows?: number; cols?: number;
  gap?: number;           // typical spacing between neighbours
  aligned?: string[];     // 'top', 'left', 'centre', …
  in?: string;            // container ref
  kinds: string;          // e.g. "4 stickies"
  colours?: Record<string, number>;
  slots?: Slot[];
};

export type Slot = { where: string; box: Box; why: string };

export type Chain = { refs: string[]; branches?: Record<string, string[]>; cycle?: boolean };

export type Reading = {
  items: Item[];
  groups: Group[];
  chains: Chain[];
  colours: { colour: string; refs: string[]; hex?: string[] }[];
  selection: string[];
  focus: string[];        // selection plus what sits with it
  viewport: Box;
  byRef: Map<string, Item>;
  byId: Map<string, Item>;
  groupOf: Map<string, string>;   // item ref → group ref
};

// ── Colours ───────────────────────────────────────────────────────────────────────────
function paint(v: any): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  return v.normal ?? v.light ?? v.dark ?? undefined;
}
function toRgb(hex: string): [number, number, number] | null {
  let s = hex.trim();
  if (s.startsWith('--')) return null;
  const m = s.match(/^rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(Number); if (p.length >= 4 && p[3] === 0) return null; return [p[0], p[1], p[2]]; }
  if (!s.startsWith('#')) return null;
  s = s.slice(1);
  if (s.length === 3 || s.length === 4) s = s.split('').map(c => c + c).join('');
  if (s.length === 8 && s.slice(6) === '00') return null;
  const n = parseInt(s.slice(0, 6), 16);
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function colourName(hex?: string): string | undefined {
  if (!hex || hex === 'transparent') return undefined;
  const rgb = toRgb(hex); if (!rgb) return undefined;
  const [r, g, b] = rgb.map(c => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.14 || d < 0.06) return l > 0.93 ? 'white' : l < 0.18 ? 'black' : l > 0.7 ? 'light gray' : 'gray';
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  const light = l > 0.8 ? 'light ' : '';
  const name = hue < 14 ? 'red' : hue < 40 ? 'orange' : hue < 68 ? 'yellow' : hue < 160 ? 'green'
    : hue < 195 ? 'teal' : hue < 250 ? 'blue' : hue < 290 ? 'purple' : hue < 340 ? 'pink' : 'red';
  return light + name;
}

// ── Text ──────────────────────────────────────────────────────────────────────────────
const str = (t: any): string => {
  if (!t) return '';
  if (typeof t === 'string') return t;
  try { return t.toString(); } catch { return ''; }
};
const deltaOf = (t: any): any[] => { try { return t?.toDelta?.() ?? t?.yText?.toDelta?.() ?? []; } catch { return []; } };
function marksOf(t: any): Mark[] {
  const out: Mark[] = [];
  for (const d of deltaOf(t)) {
    const bg = d.attributes?.background;
    if (!bg || typeof d.insert !== 'string' || !d.insert.trim()) continue;
    const hex = typeof bg === 'string' && bg.startsWith('var(') ? cssVar(bg) : bg;
    const colour = colourName(hex) ?? cssVarName(bg);
    const last = out[out.length - 1];
    if (last && last.colour === colour) last.text += d.insert; else out.push({ colour, text: d.insert });
  }
  return out.map(m => ({ ...m, text: m.text.trim() }));
}
function cssVar(v: string): string {
  const name = v.match(/var\((--[^),]+)/)?.[1];
  if (!name) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || v;
}
function cssVarName(v: string): string {
  // --affine-text-highlight-yellow → yellow
  return (v.match(/highlight-([a-z]+)/)?.[1] ?? 'marked').replace('grey', 'gray');
}

// Docs (notes): headings, paragraphs, lists, tables, in order.
function readNote(model: any): { text: string; marks: Mark[]; table?: string[][] } {
  const lines: string[] = []; const marks: Mark[] = []; let table: string[][] | undefined;
  const walk = (m: any, depth: number) => {
    const f = m.flavour, p = m.props ?? m;
    if (f === 'affine:table') {
      const t = readTable(m); table ??= t;
      lines.push(t.map(r => '| ' + r.join(' | ') + ' |').join('\n'));
    } else if (p.text) {
      const s = str(p.text).trim();
      const type = p.type;
      const pre = f === 'affine:list' ? (type === 'numbered' ? '1. ' : type === 'todo' ? (p.checked ? '[x] ' : '[ ] ') : '- ')
        : /^h[1-6]$/.test(type) ? '#'.repeat(+type[1]) + ' ' : type === 'quote' ? '> ' : '';
      if (s) lines.push('  '.repeat(depth) + pre + s);
      marks.push(...marksOf(p.text));
    } else if (f === 'affine:image') lines.push('[image]');
    for (const c of m.children ?? []) walk(c, f === 'affine:list' ? depth + 1 : depth);
  };
  for (const c of model.children ?? []) walk(c, 0);
  return { text: lines.join('\n'), marks, table };
}
function readTable(m: any): string[][] {
  const p = m.props ?? m;
  const rows = Object.values(p.rows ?? {}).sort((a: any, b: any) => (a.order > b.order ? 1 : -1)) as any[];
  const cols = Object.values(p.columns ?? {}).sort((a: any, b: any) => (a.order > b.order ? 1 : -1)) as any[];
  return rows.map(r => cols.map(c => str(p.cells?.[`${r.rowId}:${c.columnId}`]?.text).trim()));
}

// ── Geometry ──────────────────────────────────────────────────────────────────────────
const boxOf = (e: any): Box => { const b = e.elementBound ?? e; return { x: b.x, y: b.y, w: b.w, h: b.h }; };
const cx = (b: Box) => b.x + b.w / 2, cy = (b: Box) => b.y + b.h / 2;
const gap = (a: Box, b: Box) => {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
};
const inside = (inner: Box, outer: Box, slack = 2) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack &&
  inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;
const union = (bs: Box[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const r0 = (n: number) => Math.round(n);

// ── Kinds ─────────────────────────────────────────────────────────────────────────────
function kindOf(e: any): Kind {
  const f = e.flavour ?? e.type;
  switch (f) {
    case 'shape': return e.filled && (e.strokeWidth ?? 0) === 0 && e.shapeType === 'rect' ? 'sticky' : 'shape';
    case 'affine:note': {
      const kids = e.children ?? [];
      return kids.length === 1 && kids[0].flavour === 'affine:table' ? 'table' : 'doc';
    }
    case 'affine:image': { const b = boxOf(e); return Math.max(b.w, b.h) <= 110 ? 'sticker' : 'image'; }
    case 'affine:frame': return 'frame';
    case 'group': return 'group';
    case 'connector': return 'connector';
    case 'text': case 'affine:edgeless-text': return 'text';
    case 'brush': return 'drawing';
    case 'highlighter': return 'highlight';
    case 'mindmap': return 'mindmap';
    default: return typeof f === 'string' && f.startsWith('affine:embed') ? 'embed' : 'item';
  }
}
const PREFIX: Record<Kind, string> = {
  sticky: 's', shape: 'sh', text: 't', doc: 'n', table: 'tb', image: 'i', sticker: 'k', frame: 'f',
  group: 'g', connector: 'c', drawing: 'd', highlight: 'h', mindmap: 'm', embed: 'e', item: 'x',
};
const NOUN: Record<Kind, [string, string]> = {
  sticky: ['sticky', 'stickies'], shape: ['shape', 'shapes'], text: ['text', 'texts'], doc: ['doc', 'docs'],
  table: ['table', 'tables'], image: ['image', 'images'], sticker: ['sticker', 'stickers'], frame: ['frame', 'frames'],
  group: ['group', 'groups'], connector: ['line', 'lines'], drawing: ['drawing', 'drawings'], highlight: ['marker stroke', 'marker strokes'],
  mindmap: ['mind map', 'mind maps'], embed: ['embed', 'embeds'], item: ['item', 'items'],
};
export const noun = (k: Kind, n = 1) => NOUN[k][n === 1 ? 0 : 1];

// ── Read ──────────────────────────────────────────────────────────────────────────────
export function readBoard(gfx: any, opts: { selection?: string[] } = {}): Reading {
  const store = gfx.doc ?? gfx.std?.store;
  const raw: any[] = (gfx.gfxElements as any[]).filter(e => !(e.flavour === 'affine:surface'));
  const items: Item[] = [];
  const byId = new Map<string, Item>();

  for (const e of raw) {
    const kind = kindOf(e);
    const it: Item = { ref: '', id: e.id, kind, box: boxOf(e), text: '', author: authorOf(store, e.id) };
    const p = e.props ?? e;
    switch (kind) {
      case 'sticky': case 'shape': {
        it.text = str(e.text).trim();
        it.hex = paint(e.fillColor); if (!e.filled) it.hex = paint(e.strokeColor);
        it.shape = e.shapeType === 'rect' && (e.radius ?? 0) > 0.05 ? 'rounded rect' : e.shapeType;
        if (!it.text) it.empty = true;
        it.marks = marksOf(e.text);
        break;
      }
      case 'text': it.text = str(p.text).trim(); it.hex = paint(p.color); it.fontSize = p.fontSize; it.marks = marksOf(p.text);
        if (kind === 'text' && e.flavour === 'affine:edgeless-text') { const r = readNote(e); it.text = r.text; it.marks = r.marks; }
        break;
      case 'doc': case 'table': {
        const r = readNote(e); it.text = r.text; it.marks = r.marks; it.table = r.table;
        it.hex = paint(p.background); if (!it.text.trim()) it.empty = true;
        break;
      }
      case 'image': case 'sticker': it.text = str(p.caption).trim(); break;
      case 'frame': it.text = str(p.title).trim(); it.hex = paint(p.background); break;
      case 'connector': {
        const front = e.frontEndpointStyle ?? 'None', rear = e.rearEndpointStyle ?? 'Arrow';
        it.text = str(e.text).trim(); it.hex = paint(e.stroke);
        it.arrow = { from: e.source?.id, to: e.target?.id, directed: front !== rear || rear !== 'None', label: it.text || undefined };
        if (front !== 'None' && rear === 'None') it.arrow = { ...it.arrow, from: e.target?.id, to: e.source?.id };
        break;
      }
      case 'drawing': case 'highlight': it.hex = paint(e.color); break;
      case 'mindmap': {
        const lines: string[] = [];
        const walk = (n: any, d: number) => { if (!n) return; lines.push('  '.repeat(d) + '- ' + str(n.element?.text).trim()); (n.children ?? []).forEach((c: any) => walk(c, d + 1)); };
        walk(e.tree, 0); it.text = lines.join('\n');
        break;
      }
    }
    it.colour = colourName(it.hex);
    if (it.marks && !it.marks.length) delete it.marks;
    items.push(it); byId.set(e.id, it);
  }

  // Explicit containers: frames, groups, mind maps own their children.
  const ownerOf = new Map<string, Item>();
  for (const e of raw) {
    const it = byId.get(e.id)!;
    let kids: string[] = [];
    if (it.kind === 'frame') kids = Object.keys(e.props?.childElementIds ?? {});
    else if (it.kind === 'group' || it.kind === 'mindmap') kids = [...(e.childIds ?? [])];
    kids = kids.filter(k => byId.has(k));
    if (it.kind === 'frame') {   // things lying inside a frame belong to it, as in FigJam
      for (const o of items) if (o !== it && o.kind !== 'frame' && o.kind !== 'connector' && !kids.includes(o.id) && inside(o.box, it.box) && !ownerOf.has(o.id)) kids.push(o.id);
    }
    for (const k of kids) { const prev = ownerOf.get(k); if (!prev || area(prev.box) > area(it.box)) ownerOf.set(k, it); }
  }
  // Drawn containers: a large unfilled shape or a highlight loop around things.
  for (const it of items) {
    if (!(it.kind === 'shape' || it.kind === 'drawing')) continue;
    if (it.kind === 'shape' && it.text) continue;
    for (const o of items) {
      if (o === it || o.kind === 'connector' || o.kind === 'frame' || ownerOf.get(o.id)?.kind === 'group') continue;
      if (area(o.box) * 1.6 < area(it.box) && inside(o.box, it.box, 6)) {
        const prev = ownerOf.get(o.id);
        if (!prev || (prev.kind !== 'group' && area(prev.box) > area(it.box))) ownerOf.set(o.id, it);
      }
    }
  }

  // Size, relative to things of the same kind.
  const byKind = new Map<Kind, Item[]>();
  for (const it of items) { const l = byKind.get(it.kind) ?? []; l.push(it); byKind.set(it.kind, l); }
  for (const [, list] of byKind) {
    if (list.length < 3) continue;
    const m = median(list.map(i => area(i.box)));
    for (const i of list) { const a = area(i.box); if (a > m * 2.2) i.size = 'large'; else if (a < m / 2.2) i.size = 'small'; }
  }
  const texts = byKind.get('text') ?? [];
  if (texts.length >= 2) { const m = median(texts.map(t => t.fontSize ?? 16)); for (const t of texts) if ((t.fontSize ?? 16) >= m * 1.5) t.size = 'large'; }

  // ── L2: spatial groups, per container ──────────────────────────────────────────────
  const placeable = (it: Item) => !['connector', 'frame', 'group'].includes(it.kind) && !(ownerOf.get(it.id)?.kind === 'mindmap');
  const scopes = new Map<string, Item[]>();       // container id ('' = board) → items
  for (const it of items) {
    if (!placeable(it)) continue;
    const owner = ownerOf.get(it.id);
    if (owner?.kind === 'group') continue;        // a group is read as one unit
    const key = owner?.id ?? ''; const l = scopes.get(key) ?? []; l.push(it); scopes.set(key, l);
  }
  // groups themselves sit in their parent scope as units
  const units = new Map<string, Item>();
  for (const it of items) if (it.kind === 'group' || it.kind === 'frame' || it.kind === 'mindmap') {
    const owner = ownerOf.get(it.id); const key = owner?.id ?? '';
    if (it.kind === 'frame' && !owner) continue;   // top-level frames are scopes, not units
    const l = scopes.get(key) ?? []; l.push(it); scopes.set(key, l); units.set(it.id, it);
  }

  const groups: Omit<Group, 'ref'>[] = [];
  for (const [scope, list] of scopes) {
    for (const cl of cluster(list)) {
      const g = describeGroup(cl);
      if (scope) g.in = scope;
      groups.push(g);
    }
  }

  // Arrows decide order where they exist.
  const conns = items.filter(i => i.kind === 'connector' && i.arrow);
  const chains = chainsOf(conns, byId, ownerOf);

  // ── Reading order: containers top→bottom, left→right; inside a group its own order ──
  const tops = [
    ...items.filter(i => i.kind === 'frame' && !ownerOf.get(i.id)),
    ...groups.filter(g => !g.in).map(g => ({ box: g.box, group: g })),
  ] as any[];
  sortReading(tops, b => b.box);
  let n = 0;
  const order = (it: Item) => { if (it.order == null) it.order = ++n; };
  const owners = new Set([...ownerOf.values()].map(o => o.id));
  const groupsIn = (id: string) => groups.filter(g => g.in === id);
  const visitGroup = (g: Omit<Group, 'ref'>) => {
    for (const ref of g.members) {
      const it = byId.get(ref)!; order(it);
      if (owners.has(it.id)) visitContainer(it);
    }
  };
  const visitContainer = (c: Item) => {
    order(c);
    const inner = groupsIn(c.id);
    sortReading(inner, g => g.box);
    inner.forEach(visitGroup);
    for (const it of items) if (ownerOf.get(it.id) === c) order(it);
  };
  for (const t of tops) t.group ? visitGroup(t.group) : visitContainer(t);
  for (const it of items) if (it.kind !== 'connector') order(it);
  for (const it of items) order(it);

  // Short refs, numbered per kind in reading order.
  items.sort((a, b) => a.order! - b.order!);
  const counters: Record<string, number> = {};
  for (const it of items) { const p = PREFIX[it.kind]; counters[p] = (counters[p] ?? 0) + 1; it.ref = p + counters[p]; }
  const refOf = (id: string) => byId.get(id)?.ref ?? id;
  for (const it of items) {
    const o = ownerOf.get(it.id); if (o) it.parent = o.ref;
    if (it.arrow) it.arrow = { ...it.arrow, from: it.arrow.from && refOf(it.arrow.from), to: it.arrow.to && refOf(it.arrow.to) };
  }
  for (const it of items) { const kids = items.filter(o => o.parent === it.ref).map(o => o.ref); if (kids.length) it.children = kids; }

  const finalGroups: Group[] = groups
    .map(g => ({ ...g, members: g.members.map(refOf), in: g.in && refOf(g.in), slots: g.slots?.map(sl => ({ ...sl, where: sl.where.replace(/between (\S+) and (\S+)/, (_, a, b) => `between ${refOf(a)} and ${refOf(b)}`) })) }))
    .sort((a, b) => byId.get(idOfRef(items, a.members[0]))!.order! - byId.get(idOfRef(items, b.members[0]))!.order!)
    .map((g, i) => ({ ref: 'G' + (i + 1), ...g }));
  const groupOf = new Map<string, string>();
  for (const g of finalGroups) for (const m of g.members) groupOf.set(m, g.ref);
  const finalChains = chains.map(c => ({
    refs: c.refs.map(refOf), cycle: c.cycle,
    branches: c.branches && Object.fromEntries(Object.entries(c.branches).map(([k, v]) => [refOf(k), v.map(refOf)])),
  }));

  // L1 categories: which colours are in use, by what.
  const colours = new Map<string, string[]>();
  const hexes = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.colour || it.kind === 'frame' || it.kind === 'connector' || ((it.kind === 'text' || it.kind === 'drawing') && it.colour === 'black')) continue;
    if ((it.kind === 'doc' || it.kind === 'table') && it.colour === 'white') continue;
    const l = colours.get(it.colour) ?? []; l.push(it.ref); colours.set(it.colour, l);
    if (it.hex) { const hs = hexes.get(it.colour) ?? new Set(); hs.add(it.hex.toUpperCase()); hexes.set(it.colour, hs); }
  }
  for (const it of items) for (const m of it.marks ?? []) { const l = colours.get(m.colour) ?? []; if (!l.includes(it.ref)) l.push(it.ref); colours.set(m.colour, l); }

  const byRef = new Map(items.map(i => [i.ref, i]));
  const selection = (opts.selection ?? gfx.selection?.selectedElements?.map((e: any) => e.id) ?? []).map(refOf).filter((r: string) => byRef.has(r));
  const focus = new Set<string>(selection);
  for (const r of selection) {
    const g = groupOf.get(r); if (g) finalGroups.find(x => x.ref === g)!.members.forEach(m => focus.add(m));
    const it = byRef.get(r)!; it.children?.forEach(c => focus.add(c));
    for (const c of items) if (c.arrow && (c.arrow.from === r || c.arrow.to === r)) { focus.add(c.ref); c.arrow.from && focus.add(c.arrow.from); c.arrow.to && focus.add(c.arrow.to); }
  }
  const vb = gfx.viewport?.viewportBounds;
  return {
    items, groups: finalGroups, chains: finalChains,
    colours: [...colours].map(([colour, refs]) => ({ colour, refs, hex: hexes.has(colour) ? [...hexes.get(colour)!] : undefined })),
    selection, focus: [...focus], viewport: vb ? { x: vb.x, y: vb.y, w: vb.w, h: vb.h } : { x: 0, y: 0, w: 0, h: 0 },
    byRef, byId, groupOf,
  };
}
const area = (b: Box) => b.w * b.h;
const idOfRef = (items: Item[], ref: string) => items.find(i => i.ref === ref)?.id ?? ref;

// Single-linkage: two things are together when the gap between them is small for their size.
function cluster(list: Item[]): Item[][] {
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i].box, b = list[j].box;
    const s = Math.min(Math.min(a.w, a.h), Math.min(b.w, b.h));
    const limit = Math.max(16, Math.min(100, s * 0.45));
    if (gap(a, b) <= limit) parent[find(i)] = find(j);
  }
  const out = new Map<number, Item[]>();
  list.forEach((it, i) => { const r = find(i); const l = out.get(r) ?? []; l.push(it); out.set(r, l); });
  return [...out.values()];
}

// Rows by vertical overlap, then decide row / column / grid / cluster.
function bandRows(list: Item[]): Item[][] {
  const sorted = [...list].sort((a, b) => cy(a.box) - cy(b.box));
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows.find(r => { const m = median(r.map(x => cy(x.box))); const h = median(r.map(x => x.box.h)); return Math.abs(cy(it.box) - m) < Math.min(h, it.box.h) * 0.5; });
    if (row) row.push(it); else rows.push([it]);
  }
  rows.forEach(r => r.sort((a, b) => a.box.x - b.box.x));
  return rows.sort((a, b) => median(a.map(x => cy(x.box))) - median(b.map(x => cy(x.box))));
}
function describeGroup(list: Item[]): Omit<Group, 'ref'> {
  const box = union(list.map(i => i.box));
  const kindsCount = new Map<Kind, number>(); for (const i of list) kindsCount.set(i.kind, (kindsCount.get(i.kind) ?? 0) + 1);
  const kinds = [...kindsCount].map(([k, n]) => `${n} ${noun(k, n)}`).join(', ');
  const colours: Record<string, number> = {}; for (const i of list) if (i.colour) colours[i.colour] = (colours[i.colour] ?? 0) + 1;
  const g: Omit<Group, 'ref'> = { layout: 'cluster', members: list.map(i => i.id), box, kinds, colours: Object.keys(colours).length ? colours : undefined };
  if (list.length === 1) { g.layout = 'stack'; return g; }

  const rows = bandRows(list);
  const isColumn = rows.length === list.length && list.every(a => list.every(b => a === b || overlapX(a.box, b.box) > 0.3));
  if (rows.length === 1) {
    g.layout = 'row'; g.members = rows[0].map(i => i.id);
    const gaps = rows[0].slice(1).map((it, i) => it.box.x - (rows[0][i].box.x + rows[0][i].box.w));
    g.gap = r0(median(gaps)); g.aligned = alignedOf(rows[0], 'h'); g.slots = slotsInLine(rows[0], gaps, 'h');
  } else if (isColumn) {
    const col = [...list].sort((a, b) => a.box.y - b.box.y);
    g.layout = 'column'; g.members = col.map(i => i.id);
    const gaps = col.slice(1).map((it, i) => it.box.y - (col[i].box.y + col[i].box.h));
    g.gap = r0(median(gaps)); g.aligned = alignedOf(col, 'v'); g.slots = slotsInLine(col, gaps, 'v');
  } else {
    const colXs = columnsOf(list);
    const fits = rows.every(r => r.every(it => colXs.some(x => Math.abs(cx(it.box) - x) < it.box.w * 0.35)));
    g.members = rows.flat().map(i => i.id);
    const mw = median(list.map(x => x.box.w)), mh = median(list.map(x => x.box.h));
    const uniform = list.every(i => Math.abs(i.box.w - mw) < mw * 0.4 && Math.abs(i.box.h - mh) < mh * 0.4);
    if (fits && uniform && colXs.length >= 2 && rows.length >= 2) {
      g.layout = 'grid'; g.rows = rows.length; g.cols = colXs.length;
      const cw = median(list.map(i => i.box.w)), ch = median(list.map(i => i.box.h));
      const rowYs = rows.map(r => median(r.map(i => i.box.y)));
      const slots: Slot[] = [];
      rows.forEach((r, ri) => colXs.forEach((x, ci) => {
        if (!r.some(it => Math.abs(cx(it.box) - x) < it.box.w * 0.35)) slots.push({ where: `row ${ri + 1}, column ${ci + 1}`, box: { x: r0(x - cw / 2), y: r0(rowYs[ri]), w: r0(cw), h: r0(ch) }, why: 'empty cell' });
      }));
      if (slots.length) g.slots = slots;
      const hg = rows.flatMap(r => r.slice(1).map((it, i) => it.box.x - (r[i].box.x + r[i].box.w)));
      g.gap = r0(median(hg));
    }
  }
  return g;
}
const overlapX = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) / Math.min(a.w, b.w);
function columnsOf(list: Item[]): number[] {
  const xs = list.map(i => cx(i.box)).sort((a, b) => a - b);
  const w = median(list.map(i => i.box.w));
  const cols: number[][] = [];
  for (const x of xs) { const c = cols.find(c => Math.abs(median(c) - x) < w * 0.35); if (c) c.push(x); else cols.push([x]); }
  return cols.map(median);
}
function alignedOf(line: Item[], dir: 'h' | 'v'): string[] | undefined {
  const tol = 4; const out: string[] = [];
  const same = (f: (b: Box) => number) => { const v = line.map(i => f(i.box)); return Math.max(...v) - Math.min(...v) <= tol; };
  if (dir === 'h') { if (same(b => b.y)) out.push('top'); if (same(cy)) out.push('middle'); if (same(b => b.y + b.h)) out.push('bottom'); }
  else { if (same(b => b.x)) out.push('left'); if (same(cx)) out.push('centre'); if (same(b => b.x + b.w)) out.push('right'); }
  const sizes = line.map(i => `${r0(i.box.w)}x${r0(i.box.h)}`);
  if (new Set(sizes).size === 1) out.push('same size');
  return out.length ? out : undefined;
}
// A regular line with one wide gap has a hole; every line has a next place after its end.
function slotsInLine(line: Item[], gaps: number[], dir: 'h' | 'v'): Slot[] {
  const m = median(gaps.filter(g => g >= 0)); const out: Slot[] = [];
  const unit = median(line.map(i => (dir === 'h' ? i.box.w : i.box.h)));
  gaps.forEach((g, i) => {
    if (g > m + unit * 0.8 && gaps.length >= 2) {
      const a = line[i].box;
      out.push({ where: `between ${line[i].id} and ${line[i + 1].id}`, why: 'gap in a regular line',
        box: dir === 'h' ? { x: r0(a.x + a.w + m), y: r0(a.y), w: r0(unit), h: r0(a.h) } : { x: r0(a.x), y: r0(a.y + a.h + m), w: r0(a.w), h: r0(unit) } });
    }
  });
  return out;
}

// L3: arrows into chains (paths), noting where they branch or loop.
function chainsOf(conns: Item[], byId: Map<string, Item>, ownerOf: Map<string, Item>): { refs: string[]; branches?: Record<string, string[]>; cycle?: boolean }[] {
  const lift = (id?: string) => { if (!id) return undefined; let o = ownerOf.get(id); while (o && o.kind === 'group') { id = o.id; o = ownerOf.get(o.id); } return id; };
  const out = new Map<string, string[]>(), indeg = new Map<string, number>();
  for (const c of conns) {
    const a = lift(c.arrow!.from), b = lift(c.arrow!.to);
    if (!a || !b || !byId.has(a) || !byId.has(b)) continue;
    const pairs = c.arrow!.directed ? [[a, b]] : [[a, b]];
    for (const [s, t] of pairs) { (out.get(s) ?? out.set(s, []).get(s)!).push(t); indeg.set(t, (indeg.get(t) ?? 0) + 1); indeg.set(s, indeg.get(s) ?? 0); }
  }
  if (!out.size) return [];
  const nodes = [...indeg.keys()]; const used = new Set<string>(); const chains: { refs: string[]; branches?: Record<string, string[]>; cycle?: boolean }[] = [];
  const starts = nodes.filter(n => (indeg.get(n) ?? 0) === 0);
  const walk = (start: string) => {
    const refs = [start]; const branches: Record<string, string[]> = {}; let cur = start; let cycle = false; used.add(start);
    for (;;) {
      const next = out.get(cur) ?? [];
      if (next.length > 1) branches[cur] = next;
      const n = next.find(x => !used.has(x)) ?? next[0];
      if (!n) break;
      if (used.has(n)) { cycle = refs.includes(n); break; }
      refs.push(n); used.add(n); cur = n;
    }
    chains.push({ refs, branches: Object.keys(branches).length ? branches : undefined, cycle: cycle || undefined });
  };
  for (const s of starts) walk(s);
  for (const n of nodes) if (!used.has(n) && out.has(n)) walk(n);
  return chains.filter(c => c.refs.length >= 2);
}

function sortReading<T>(list: T[], boxOfT: (t: T) => Box) {
  // band by vertical overlap so a slightly lower item on the same line still reads left to right
  list.sort((a, b) => {
    const A = boxOfT(a), B = boxOfT(b);
    const sameBand = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > Math.min(A.h, B.h) * 0.4;
    return sameBand ? A.x - B.x : A.y - B.y;
  });
}

// ── For the model ─────────────────────────────────────────────────────────────────────
// Compact, plain text: one line per item, then the structure. Coordinates are board units.
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const q = (s: string) => JSON.stringify(s);

export function toPrompt(r: Reading, opts: { maxItems?: number; textLimit?: number } = {}): string {
  const max = opts.maxItems ?? 160, tl = opts.textLimit ?? 600;
  const focus = new Set(r.focus);
  let shown = r.items;
  let note = '';
  if (shown.length > max) {
    const vb = r.viewport;
    shown = r.items.filter(i => focus.has(i.ref) || (i.box.x < vb.x + vb.w && i.box.x + i.box.w > vb.x && i.box.y < vb.y + vb.h && i.box.y + i.box.h > vb.y)).slice(0, max);
    note = ` (showing ${shown.length} near the view and selection)`;
  }
  const L: string[] = [];
  L.push(`BOARD ${r.items.length} things${note}. Coordinates are board units (x→right, y↓down).`);
  L.push(`SELECTED ${r.selection.length ? r.selection.join(' ') : 'nothing'}`);
  L.push('');
  L.push('THINGS  (ref kind [colour] [size] @x,y w×h [in parent] [by ai] — text)');
  for (const i of shown) {
    if (i.kind === 'connector') continue;
    const bits = [i.ref, i.shape && i.kind === 'shape' ? i.shape : i.kind];
    if (i.colour) bits.push(i.colour);
    if (i.size) bits.push(i.size);
    bits.push(`@${r0(i.box.x)},${r0(i.box.y)} ${r0(i.box.w)}×${r0(i.box.h)}`);
    if (i.parent) bits.push(`in ${i.parent}`);
    if (i.author === 'ai') bits.push('by ai');
    if (i.fontSize && i.kind === 'text') bits.push(`${i.fontSize}px`);
    let line = bits.join(' ');
    if (i.kind === 'table' && i.table) line += '\n' + i.table.map(row => '    | ' + row.map(c => clip(c, 60) || '·').join(' | ') + ' |').join('\n');
    else if (i.text) line += i.text.includes('\n') ? '\n' + clip(i.text, tl).split('\n').map(s => '    ' + s).join('\n') : ' — ' + q(clip(i.text, tl));
    else if (i.empty) line += ' — (empty)';
    if (i.marks?.length) line += '\n    marked: ' + i.marks.map(m => `${m.colour} ${q(clip(m.text, 140))}`).join('; ');
    L.push(line);
  }
  const lines = shown.filter(i => i.kind === 'connector');
  if (lines.length) {
    L.push('');
    L.push('LINES');
    for (const c of lines) {
      const a = c.arrow!;
      L.push(`${c.ref} ${a.from ?? '(loose)'} ${a.directed ? '→' : '—'} ${a.to ?? '(loose)'}${a.label ? ' ' + q(a.label) : ''}${c.colour && c.colour !== 'black' ? ' ' + c.colour : ''}${c.author === 'ai' ? ' by ai' : ''}`);
    }
  }
  if (r.chains.length) {
    L.push('');
    L.push('CHAINS (following the arrows)');
    for (const ch of r.chains) {
      let s = ch.refs.join(' → ') + (ch.cycle ? ' → (back to start)' : '');
      if (ch.branches) s += '  branches: ' + Object.entries(ch.branches).map(([k, v]) => `${k}→{${v.join(',')}}`).join(' ');
      L.push(s);
    }
  }
  const gs = r.groups.filter(g => g.members.length > 1 || g.in);
  if (gs.length) {
    L.push('');
    L.push('GROUPS (what sits together, in reading order)');
    for (const g of gs) {
      const bits = [`${g.ref} ${g.layout}${g.rows ? ` ${g.rows}×${g.cols}` : ''}`, `of ${g.kinds}`];
      if (g.in) bits.push(`in ${g.in}`);
      if (g.gap != null && g.members.length > 1) bits.push(`gap ${g.gap}`);
      if (g.aligned) bits.push(`aligned ${g.aligned.join(', ')}`);
      if (g.colours && Object.keys(g.colours).length > 1) bits.push('colours ' + Object.entries(g.colours).map(([c, n]) => `${c}×${n}`).join(' '));
      bits.push(`@${r0(g.box.x)},${r0(g.box.y)} ${r0(g.box.w)}×${r0(g.box.h)}`);
      L.push(bits.join(' · ') + `: ${g.members.join(' ')}`);
      for (const s of g.slots ?? []) L.push(`    open slot ${s.where} @${s.box.x},${s.box.y} ${s.box.w}×${s.box.h} (${s.why})`);
    }
  }
  const cs = r.colours.filter(c => c.refs.length);
  if (cs.length) {
    L.push('');
    L.push('COLOURS IN USE');
    for (const c of cs) L.push(`${c.colour}${c.hex ? ' (' + c.hex.join(', ') + ')' : ' (text highlight)'}: ${c.refs.join(' ')}`);
  }
  return L.join('\n');
}
