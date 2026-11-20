// Executes the model's answer on the board.
// The model says what and roughly where ("after s4", "in f1", "like s2"); this file decides exact
// positions, sizes and colours from the user's own layout, so additions sit in their structure.

import { TableDataManager } from '@blocksuite/affine/blocks/table';
import { Text } from '@blocksuite/affine/store';
import { addComment } from './comments';
import { generateKeyBetween } from '@blocksuite/affine/std/gfx';
import * as Y from 'yjs';

import { CARD_STYLE, FILL, INK as INKH, RADIUS, SHADOW, TEXT, TINT as TINTH, TYPE, fitSize, snap } from '../design';
import { lookup, remember as rememberLink } from './links';
import { markAi } from './provenance';
import type { Box, Item, Reading } from './reading';

export type Place = {
  after?: string; before?: string; below?: string; above?: string; right?: string; left?: string;
  slot?: string; n?: number; in?: string; near?: string; at?: [number, number];
  cell?: string; row?: number; col?: number; venn?: string[];
};
export type Action = { do: string; [k: string]: any };
export type Answer = { read?: string; say?: string; actions: Action[] };
export type Result = { created: string[]; changed: string[]; errors: string[]; box: Box | null };

// ── Colours ─────────────────────────────────────────────────────────────────────────────
// Every colour comes from the shared design system (../design.ts), the same one the toolbar uses.
const alias = (m: Record<string, string>) => ({ ...m, grey: m.gray, purple: m.violet });
const STICKY: Record<string, string> = alias(FILL as any);
const LINE = { color: '#6e6e73', width: 2 };
const INK: Record<string, string> = { ...alias(INKH as any), black: TEXT.ink };
const HL = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'grey'];
const base = (c: string) => c.toLowerCase().replace(/^light\s+/, '').replace('gray', 'grey').trim();

// ── Geometry ────────────────────────────────────────────────────────────────────────────
const overlaps = (a: Box, b: Box, m = 8) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
const union = (bs: Box[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const xywh = (b: Box) => `[${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}]`;
const textWidth = (s: string, size: number) => {
  const c = document.createElement('canvas').getContext('2d')!; c.font = `${size}px Inter, sans-serif`;
  return Math.max(...s.split('\n').map(l => c.measureText(l).width)) + 8;
};

// Words shown to the user never carry our internal refs (s3, n12 …): they become the thing's own words.
const SHOWN = new Set(['text', 'title', 'subtitle', 'body', 'label', 'note', 'meta', 'summary', 'comment', 'why', 'key', 'caption', 'callout', 'who', 'role', 'value', 'delta', 'name_shown']);
export function cleanRefs(text: string, reading: Reading): string {
  return text.replace(/\(?\b([a-z]{1,2}\d{1,3}|G\d{1,3}|L\d{1,3}|col \d+|row \d+)\b\)?/g, (m, ref) => {
    const it = reading.byRef.get(ref); if (!it) return m.startsWith('(') ? '' : m;
    const words = it.text.replace(/\s+/g, ' ').trim(); if (!words) return '';
    return `“${words.length > 28 ? words.slice(0, 26).trim() + '…' : words}”`;
  }).replace(/\s{2,}/g, ' ').trim();
}
function cleanAction(v: any, reading: Reading, key = ''): any {
  if (typeof v === 'string') return SHOWN.has(key) ? cleanRefs(v, reading) : v;
  if (Array.isArray(v)) return v.map(x => cleanAction(x, reading, key === 'items' || key === 'tags' ? 'text' : key));
  if (v && typeof v === 'object') { const o: any = {}; for (const [k, x] of Object.entries(v)) o[k] = cleanAction(x, reading, k); return o; }
  return v;
}

export async function execute(rootEl: any, reading: Reading, answer: Answer): Promise<Result> {
  answer = { ...answer, actions: (answer.actions ?? []).map(a => cleanAction(a, reading)) };
  const clean = (t: string) => cleanRefs(t, reading);
  const gfx = rootEl.gfx, std = rootEl.std, store = std.store, surf = gfx.surface;
  const created: string[] = [], changed = new Set<string>(), errors: string[] = [];
  let topKey: string | null = null;
  for (const e of gfx.gfxElements as any[]) { const k = e.index ?? e.props?.index; if (typeof k === 'string' && (!topKey || k > topKey)) topKey = k; }
  const nextTop = () => { try { topKey = generateKeyBetween(topKey, null); } catch { topKey = (topKey ?? 'a0') + 'V'; } return topKey!; };
  const addEl = (props: any) => gfx.surface.addElement({ ...props, index: props.index ?? nextTop() });
  const named = new Map<string, { id: string; box: Box; like?: Item }>();
  const newBoxes: Box[] = [];

  // what is used where: the user's own hex for a colour name wins over the default palette
  const userHex = new Map<string, string>();
  // the user's own shade of a hue, for stickies; pale container tints are not a sticky colour (a sticky in
  // the tint of its own section would vanish)
  const pale = (h: string) => { const m = /^#?([0-9a-f]{6})/i.exec(h); if (!m) return true; const n = parseInt(m[1], 16); return Math.min((n >> 16) & 255, (n >> 8) & 255, n & 255) > 215; };
  for (const c of reading.colours) { const h = (c.hex ?? []).find(x => !pale(x)); if (h) userHex.set(base(c.colour), h); }
  const fillOf = (c?: string) => !c ? undefined : c.startsWith('#') ? c : userHex.get(base(c)) ?? STICKY[base(c)] ?? STICKY.yellow;
  const inkOf = (c?: string) => !c ? undefined : c.startsWith('#') ? c : INK[base(c)] ?? INK.black;

  const item = (ref?: string): Item | undefined => (ref ? reading.byRef.get(ref) : undefined);
  const boxOfRef = (ref?: string): Box | undefined => {
    if (!ref) return;
    const n = named.get(ref); if (n) { const el: any = gfx.getElementById(n.id); return el ? { ...el.elementBound } : n.box; }
    const it = item(ref); if (it) { const el = gfx.getElementById(it.id); return el ? { ...el.elementBound } : it.box; }
    const g = reading.groups.find(g => g.ref === ref); if (g) return g.box;
    const st = reading.structures.find(x => x.ref === ref); if (st) return st.box;
    return undefined;
  };
  const idOf = (ref?: string) => (ref ? named.get(ref)?.id ?? item(ref)?.id : undefined);
  const groupOfRef = (ref: string) => reading.groups.find(g => g.ref === reading.groupOf.get(ref));

  // obstacles: everything except containers (frames, groups, loops) and lines
  const containers = new Set(reading.items.filter(i => i.children?.length || i.kind === 'frame' || i.kind === 'group').map(i => i.ref));
  // free lines (axes, dividers, timelines) are drawn structure: nothing may be dropped across them
  const lineBoxes = reading.items.filter(i => i.kind === 'connector' && (!i.arrow?.from || !i.arrow?.to)).map(i => ({ x: i.box.x - 6, y: i.box.y - 6, w: i.box.w + 12, h: i.box.h + 12 }));
  const obstacles = () => [
    ...reading.items.filter(i => !containers.has(i.ref) && i.kind !== 'connector').map(i => boxOfRef(i.ref)!),
    ...lineBoxes,
    ...newBoxes,
  ];
  const free = (b: Box, ignore?: Box) => !obstacles().some(o => o !== ignore && overlaps(b, o));

  // a cell of a drawn structure (L1 row 1 col 2), or of a spatial grid group
  function cellOf(p: Place): Box | undefined {
    const st = reading.structures.find(x => x.ref === p.cell);
    const c = st?.cells.find(c => c.row === (p.row ?? 1) && c.col === (p.col ?? 1));
    return c?.box;
  }
  /** Size that fits a cell (stickies shrink to fit, keeping square). */
  function fitCell(p: Place | undefined, w: number, h: number): [number, number] {
    const c = p?.cell ? cellOf(p) : undefined; if (!c) return [w, h];
    const k = Math.min(1, (c.w - 32) / w, (c.h - 32) / h);
    return [Math.max(48, Math.round(w * k)), Math.max(48, Math.round(h * k))];
  }
  function place(p: Place | undefined, w: number, h: number, fallbackRef?: string): Box {
    const b = placeRaw(p, w, h, fallbackRef);
    if (p?.cell || p?.venn || p?.slot) return b;          // fitted inside a shape: keep exact
    const s0 = { ...b, x: snap(b.x), y: snap(b.y) };
    return free(s0) || !free(b) ? s0 : b;
  }
  function placeRaw(p: Place | undefined, w: number, h: number, fallbackRef?: string): Box {
    p = p ?? {};
    const dirOf = (ref: string) => {
      const g = groupOfRef(ref);
      if (g?.layout === 'column') return 'below';
      return 'right';
    };
    const gapNear = (ref: string) => groupOfRef(ref)?.gap ?? 40;
    const step = (from: Box, dir: string, gap: number): Box => {
      // stay on the anchor's line: share its top (rows) or its left (columns)
      switch (dir) {
        // same-size things centre on the anchor's line; bigger things align to its edge (top / left)
        case 'right': return { x: from.x + from.w + gap, y: Math.abs(h - from.h) < 12 ? from.y + (from.h - h) / 2 : from.y, w, h };
        case 'left': return { x: from.x - gap - w, y: Math.abs(h - from.h) < 12 ? from.y + (from.h - h) / 2 : from.y, w, h };
        case 'below': return { x: Math.abs(w - from.w) < 12 ? from.x + (from.w - w) / 2 : from.x, y: from.y + from.h + gap, w, h };
        default: return { x: Math.abs(w - from.w) < 12 ? from.x + (from.w - w) / 2 : from.x, y: from.y - gap - h, w, h };
      }
    };
    const walk = (anchor: Box, dir: string, gap: number, strict = true) => {
      let b = step(anchor, dir, gap);
      for (let i = 0; i < 200 && !free(b); i++) {
        // beside something (not continuing a line): don't wander far; try the other sides first
        if (!strict && i === 12) for (const d of ['below', 'right', 'above', 'left']) { const c = step(anchor, d, gap); if (free(c)) return c; }
        // continuing a line steps a whole item (keeps the rhythm); beside something, nudge 24px at a time
        if (strict) b = step(b, dir, gap);
        else { const dx = dir === 'right' ? 24 : dir === 'left' ? -24 : 0, dy = dir === 'below' ? 24 : dir === 'above' ? -24 : 0; b = { ...b, x: b.x + dx, y: b.y + dy }; }
      }
      return b;
    };
    if (p.venn?.length) {   // a free spot inside these circles and outside the others
      const all = reading.items.filter(i => i.shape === 'ellipse' && i.box.w >= 140);
      const want = p.venn.map(r => item(r)).filter(Boolean) as Item[];
      const inE = (c: Item, x: number, y: number) => { const rx = c.box.w / 2, ry = c.box.h / 2; const dx = (x - c.box.x - rx) / rx, dy = (y - c.box.y - ry) / ry; return dx * dx + dy * dy <= 0.92; };
      if (want.length) {
        const u = union(want.map(w0 => w0.box));
        for (let y = u.y; y + h <= u.y + u.h; y += 8) for (let x = u.x; x + w <= u.x + u.w; x += 8) {
          const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
          const ok = corners.every(([px, py]) => want.every(c => inE(c, px, py)) && all.filter(c => !want.includes(c)).every(c => !inE(c, px, py)));
          const b = { x, y, w, h }; if (ok && !obstacles().some(o => !all.some(c => { const cb = boxOfRef(c.ref); return cb && cb.x === o.x && cb.y === o.y && cb.w === o.w; }) && overlaps(b, o))) return b;
        }
      }
    }
    if (p.cell) {
      const c = cellOf(p);
      if (c) {
        // fill the cell like a person would: rows from its top-left, inside a small margin
        const pad = 16;
        const centred = { x: c.x + (c.w - w) / 2, y: c.y + pad, w, h };   // alone in its cell: centred across it
        if (free(centred) && !reading.items.some(i => i.kind !== 'connector' && overlaps(i.box, c, -8) && !(i.box.w > c.w && i.box.h > c.h))) return centred;
        for (let y = c.y + pad; y + h <= c.y + c.h - pad / 2 || y === c.y + pad; y += 8)
          for (let x = c.x + pad; x + w <= c.x + c.w - pad / 2 || x === c.x + pad; x += 8) { const b = { x, y, w, h }; if (free(b)) return b; }
        return { x: c.x + pad, y: c.y + c.h - pad - h, w, h };
      }
    }
    if (p.slot) {
      const g = reading.groups.find(g => g.ref === p!.slot);
      const s = g?.slots?.[(p.n ?? 1) - 1];
      if (s) return { x: s.box.x + (s.box.w - w) / 2, y: s.box.y + (s.box.h - h) / 2, w, h };
      if (g) { const last = g.members[g.members.length - 1]; return walk(boxOfRef(last)!, dirOf(last), g.gap ?? 40); }
    }
    const rel: [keyof Place, string][] = [['after', ''], ['before', ''], ['below', 'below'], ['above', 'above'], ['right', 'right'], ['left', 'left']];
    for (const [k, d] of rel) {
      const ref = p[k] as string | undefined; const a = boxOfRef(ref); if (!ref || !a) continue;
      if (k === 'after') return walk(a, dirOf(ref), gapNear(ref));
      if (k === 'before') return walk(a, dirOf(ref) === 'below' ? 'above' : 'left', gapNear(ref));
      return walk(a, d, gapNear(ref), false);
    }
    if (p.in) {
      const f = boxOfRef(p.in);
      if (f) {
        const pad = 32;
        for (let y = f.y + pad + 24; y + h <= f.y + f.h - pad / 2; y += 24)
          for (let x = f.x + pad; x + w <= f.x + f.w - pad / 2; x += 24) { const b = { x, y, w, h }; if (free(b)) return b; }
        // too big for the frame: start at its top-left, under whatever is already inside; the frame grows to fit
        const inside = reading.items.filter(i => i.kind !== 'frame' && i.box.x >= f.x - 2 && i.box.y >= f.y - 2 && i.box.x + i.box.w <= f.x + f.w + 2 && i.box.y + i.box.h <= f.y + f.h + 2);
        const y0 = inside.length ? Math.max(...inside.map(i => i.box.y + i.box.h)) + 32 : f.y + pad;
        return { x: f.x + pad, y: y0, w, h };
      }
    }
    if (p.at) return { x: p.at[0], y: p.at[1], w, h };
    const near = p.near ?? fallbackRef;
    const nb = boxOfRef(near);
    if (nb) {
      for (const d of ['right', 'below', 'left', 'above']) { const b = step(nb, d, 40); if (free(b)) return b; }
      return walk(nb, 'right', 40);
    }
    if (p.at) return { x: p.at[0], y: p.at[1], w, h };
    const v = reading.viewport; return walk({ x: v.x + v.w / 2 - w / 2, y: v.y + v.h / 2 - h / 2, w, h: 0 }, 'below', 0);
  }

  const setBox = (id: string, b: Box) => {
    const el = gfx.getElementById(id); if (!el) return;
    if (el.flavour) store.updateBlock(el, { xywh: xywh(b) }); else surf.updateElement(id, { xywh: xywh(b) });
    changed.add(id);
  };
  const remember = (a: Action, id: string, box: Box, like?: Item) => {
    created.push(id); newBoxes.push(box);
    if (a.name) named.set(a.name, { id, box, like });
  };
  const anchorOf = (a: Action) => a.like ?? a.place?.after ?? a.place?.before ?? a.place?.near ?? a.place?.below ?? a.place?.right ?? a.place?.left ?? a.place?.above;

  // ── Parts ─────────────────────────────────────────────────────────────────────────────
  function addSticky(a: Action) {
    const like = item(a.like) ?? item(a.place?.after) ?? item(a.place?.before);
    const likeEl = like && gfx.getElementById(like.id);
    const s = a.size === 'small' ? 120 : a.size === 'large' ? 260 : 184;
    let w = like?.kind === 'sticky' ? like.box.w : s, h = like?.kind === 'sticky' ? like.box.h : s;
    if (a.place?.venn) { w = h = 88; }
    if (a.place?.cell) { const c = cellOf(a.place); if (c) { const fit = Math.min(184, Math.floor((c.w - 32 - 12) / 2), c.h - 32); if (fit >= 96) { w = h = fit; } } [w, h] = fitCell(a.place, w, h); }
    const box = place(a.place, w, h, anchorOf(a));
    const fill = fillOf(a.colour) ?? (likeEl?.fillColor && typeof likeEl.fillColor === 'string' ? likeEl.fillColor : STICKY.yellow);
    const t = new Y.Text(); t.insert(0, String(a.text ?? ''));
    const copy = (k: string, d: any) => (likeEl && likeEl[k] !== undefined ? likeEl[k] : d);
    const id = addEl({
      type: 'shape', shapeType: 'rect', xywh: xywh(box), radius: copy('radius', 0.04), filled: true, fillColor: fill,
      strokeColor: 'transparent', strokeWidth: 0, color: copy('color', TEXT.ink), fontSize: likeEl?.fontSize ?? fitSize(w, String(a.text ?? '')),
      fontFamily: copy('fontFamily', 'blocksuite:surface:Inter'), fontWeight: copy('fontWeight', '400'),
      textAlign: copy('textAlign', 'left'), textHorizontalAlign: copy('textHorizontalAlign', 'left'), textVerticalAlign: copy('textVerticalAlign', 'top'),
      padding: copy('padding', [16, 16]), shadow: copy('shadow', SHADOW.sticky), text: t,
    });
    remember(a, id, box, like);
  }
  function addShape(a: Action) {
    const like = item(a.like); const likeEl = like && gfx.getElementById(like.id);
    const w = like ? like.box.w : 160, h = like ? like.box.h : 100;
    const box = place(a.place, w, h, anchorOf(a));
    const t = new Y.Text(); t.insert(0, String(a.text ?? ''));
    const id = addEl({
      type: 'shape', shapeType: a.shape ?? likeEl?.shapeType ?? 'rect', xywh: xywh(box), filled: true,
      fillColor: fillOf(a.colour) ?? likeEl?.fillColor ?? '#ffffff', strokeColor: likeEl?.strokeColor ?? '#1e1e1e',
      strokeWidth: likeEl?.strokeWidth ?? 2, color: '#1e1e1e', fontSize: likeEl?.fontSize ?? 16, fontFamily: 'blocksuite:surface:Inter', text: t,
    });
    remember(a, id, box, like);
  }
  function addText(a: Action, fontSize?: number, colour?: string, at?: Box) {
    const like = item(a.like); const likeEl = like && gfx.getElementById(like.id);
    const size = fontSize ?? likeEl?.fontSize ?? (a.size === 'large' ? 28 : a.size === 'small' ? 13 : 16);
    const text = String(a.text ?? '');
    const w = Math.min(textWidth(text, size), 360), lines = Math.max(1, Math.ceil(textWidth(text, size) / 360)) + (text.match(/\n/g)?.length ?? 0);
    const h = Math.ceil(size * 1.4 * lines);
    const box = at ?? place(a.place, w, h, anchorOf(a));
    const t = new Y.Text(); t.insert(0, text);
    const id = addEl({
      type: 'text', xywh: xywh({ ...box, w, h }), text: t, color: colour ?? inkOf(a.colour) ?? likeEl?.color ?? '#1e1e1e',
      fontSize: size, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', hasMaxWidth: w >= 360,
    });
    remember(a, id, { ...box, w, h }, like);
    return id;
  }
  function addDoc(a: Action) {
    const like = item(a.like);
    const w = like?.kind === 'doc' ? like.box.w : 420;
    const lines = String(a.text ?? '').split('\n');
    const h = 60 + lines.length * 28;
    const box = place(a.place, w, h, anchorOf(a));
    const noteId = store.addBlock('affine:note', { xywh: xywh(box), background: '#ffffff', index: nextTop() } as any, store.root.id);
    for (const l of lines) {
      const m = l.match(/^(#{1,3})\s+(.*)$/), li = l.match(/^[-•]\s+(.*)$/);
      if (m) store.addBlock('affine:paragraph', { type: 'h' + (m[1].length + 1), text: new Text(m[2]) }, noteId);
      else if (li) store.addBlock('affine:list', { type: 'bulleted', text: new Text(li[1]) }, noteId);
      else store.addBlock('affine:paragraph', { text: new Text(l) }, noteId);
    }
    remember(a, noteId, box, like);
  }
  function addFrame(a: Action, refs: string[], title: string) {
    const ids = refs.map(idOf).filter(Boolean) as string[];
    const boxes = refs.map(boxOfRef).filter(Boolean) as Box[];
    if (!boxes.length) { errors.push('frame: nothing to wrap'); return; }
    const u = union(boxes), pad = 40;
    const box = { x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2 };
    const id = store.addBlock('affine:frame', {
      xywh: xywh(box), title: new Text(title || 'Frame'), background: '#ffffff',
      childElementIds: Object.fromEntries(ids.map(i => [i, true])), index: gfx.layer.generateIndex(true),
    } as any, surf.id);
    created.push(id); if (a.name) named.set(a.name, { id, box });
  }
  // Lines read like FigJam's: a thin gray elbow line with an open arrow, the label sitting on the line's
  // middle; dashed means asynchronous / weaker / planned. A user's own line style wins when there is one.
  function connect(a: Action) {
    const from = idOf(a.from), to = idOf(a.to);
    if (!from || !to) { errors.push(`connect: unknown ${!from ? a.from : a.to}`); return; }
    const sample = reading.items.find(i => i.kind === 'connector' && i.author === 'user' && i.arrow?.from && i.arrow?.to);
    const sEl = sample && gfx.getElementById(sample.id);
    const props: any = {
      type: 'connector', source: { id: from }, target: { id: to },
      stroke: sEl?.stroke ?? LINE.color, strokeWidth: sEl?.strokeWidth ?? LINE.width, mode: a.curve ? 2 : a.straight ? 0 : (sEl?.mode ?? 1),
      strokeStyle: a.dashed || a.style === 'dashed' ? 'dash' : 'solid',
      rearEndpointStyle: a.arrow === false ? 'None' : sEl?.rearEndpointStyle ?? 'Arrow', frontEndpointStyle: a.both ? 'Arrow' : sEl?.frontEndpointStyle ?? 'None',
    };
    if (a.label) {
      const label = String(a.label); const t = new Y.Text(); t.insert(0, label);
      Object.assign(props, { text: t, labelDisplay: true, labelOffset: { distance: a.at ?? 0.5, anchor: 'center' },
        labelXYWH: [0, 0, Math.ceil(textWidth(label, TYPE.caption)) + 12, 20],
        labelStyle: { color: TEXT.body, fontSize: TYPE.caption, fontFamily: 'blocksuite:surface:Inter', fontWeight: '400', fontStyle: 'normal', textAlign: 'center' } });
    }
    const id = addEl(props);
    created.push(id); return id;
  }
  function write(a: Action) {
    const it = item(a.ref); const el = it && gfx.getElementById(it.id);
    if (!el) { errors.push(`write: unknown ${a.ref}`); return; }
    if (it!.text) { errors.push(`write: ${a.ref} already has words`); return; }
    if (el.text instanceof Y.Text) { el.text.insert(0, String(a.text ?? '')); changed.add(el.id); }
  }
  function fill(a: Action) {
    const it = item(a.ref); const note = it && gfx.getElementById(it.id);
    const table = note?.children?.find((c: any) => c.flavour === 'affine:table') ?? (note?.flavour === 'affine:table' ? note : null);
    if (!table) { errors.push(`fill: ${a.ref} has no table`); return; }
    const dm = new TableDataManager(table);
    let rows = dm.rows$.value; const cols = dm.columns$.value;
    const r = Number(a.row), c = Number(a.col);
    if (!(c >= 1 && c <= cols.length) || !(r >= 1)) { errors.push('fill: cell out of range'); return; }
    while (rows.length < r) { dm.addRow(rows.length - 1); rows = dm.rows$.value; }
    const cell = dm.getCell(rows[r - 1].rowId, cols[c - 1].columnId);
    if (!cell) return;
    if (cell.text.toString().trim()) { errors.push(`fill: row ${r} col ${c} already has words`); return; }
    cell.text.insert(String(a.text ?? ''), 0);
    changed.add(note.id);
  }
  function highlight(a: Action) {
    const it = item(a.ref); const el = it && gfx.getElementById(it.id);
    const quote = String(a.quote ?? '').trim();
    if (!el || !quote) { errors.push(`highlight: unknown ${a.ref}`); return; }
    const c = base(a.colour ?? 'yellow'); const colour = HL.includes(c) ? c : c === 'pink' ? 'red' : c === 'violet' ? 'purple' : 'yellow';
    const texts: any[] = [];
    const walk = (m: any) => { if (m.props?.text) texts.push(m.props.text); (m.children ?? []).forEach(walk); };
    walk(el);
    const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').toLowerCase();
    for (const t of texts) {
      const s = t.toString(); let i = s.indexOf(quote);
      if (i < 0) i = norm(s).indexOf(norm(quote));
      if (i >= 0) { t.format(i, quote.length, { background: `var(--affine-text-highlight-${colour})` }); changed.add(el.id); return; }
    }
    errors.push(`highlight: "${quote.slice(0, 40)}" not found in ${a.ref}`);
  }
  function recolour(a: Action) {
    for (const ref of a.refs ?? []) {
      const it = item(ref) ?? undefined; const id = idOf(ref); const el = id && gfx.getElementById(id);
      if (!el) continue;
      const kind = it?.kind ?? named.get(ref)?.like?.kind;
      if (el.flavour === 'affine:note') store.updateBlock(el, { background: fillOf(a.colour) });
      else if (el.type === 'shape') surf.updateElement(id, el.filled ? { fillColor: fillOf(a.colour) } : { strokeColor: inkOf(a.colour) });
      else if (el.type === 'text') surf.updateElement(id, { color: inkOf(a.colour) });
      else if (el.type === 'connector') surf.updateElement(id, { stroke: inkOf(a.colour) });
      else if (el.type === 'brush' || el.type === 'highlighter') surf.updateElement(id, { color: inkOf(a.colour) });
      void kind; changed.add(id);
    }
  }
  function move(a: Action) {
    const refs: string[] = a.refs ?? [];
    const boxes = refs.map(boxOfRef).filter(Boolean) as Box[]; if (!boxes.length) return;
    const saved = reading.items.filter(i => refs.includes(i.ref));
    saved.forEach(i => containers.add(i.ref));
    if (a.place?.cell) {   // into a cell: one by one, shrinking to fit
      for (const ref of refs) {
        const id = idOf(ref), b = boxOfRef(ref); if (!id || !b) continue;
        const [w, h] = fitCell(a.place, b.w, b.h); const t = place(a.place, w, h);
        setBox(id, t); newBoxes.push(t);
      }
      saved.forEach(i => containers.delete(i.ref)); return;
    }
    const u = union(boxes);
    // the moved things should not block their own new place
    const target = place(a.place, u.w, u.h, refs[0]);
    saved.forEach(i => containers.delete(i.ref));
    const dx = target.x - u.x, dy = target.y - u.y;
    refs.forEach(ref => { const id = idOf(ref); const b = boxOfRef(ref); if (id && b) setBox(id, { ...b, x: b.x + dx, y: b.y + dy }); });
    newBoxes.push(target);
  }
  function arrange(a: Action) {
    const refs: string[] = (a.refs ?? []).filter((r: string) => idOf(r));
    if (!refs.length) return;
    const boxes = refs.map(r => boxOfRef(r)!);
    const gap = 40, w = Math.max(...boxes.map(b => b.w)), h = Math.max(...boxes.map(b => b.h));
    const cols = a.layout === 'column' ? 1 : a.layout === 'row' ? refs.length : Math.max(1, a.cols ?? Math.ceil(Math.sqrt(refs.length)));
    const rows = Math.ceil(refs.length / cols);
    refs.forEach(r => containers.add(r));
    const u = union(boxes);
    const origin = a.place ? place(a.place, cols * (w + gap) - gap, rows * (h + gap) - gap) : u;
    refs.forEach(r => containers.delete(r));
    refs.forEach((r, i) => {
      const b = boxOfRef(r)!; const cx = i % cols, cy = Math.floor(i / cols);
      setBox(idOf(r)!, { x: origin.x + cx * (w + gap), y: origin.y + cy * (h + gap), w: b.w, h: b.h });
    });
    newBoxes.push({ x: origin.x, y: origin.y, w: cols * (w + gap) - gap, h: rows * (h + gap) - gap });
  }
  function note(a: Action) {
    // a remark about one thing is a comment on it (Figma-style pin), not loose text on the board
    const onId = idOf(a.on);
    if (onId) { addComment(store, onId, clean(String(a.text ?? ''))); return; }
    const on = boxOfRef(a.on);
    const text = String(a.text ?? '');
    const size = 13;
    const w = Math.min(textWidth(text, size), 240), lines = Math.ceil(textWidth(text, size) / 240), h = Math.ceil(size * 1.45 * lines);
    let box: Box;
    if (on) {
      const cands = [{ x: on.x + on.w + 12, y: on.y, w, h }, { x: on.x, y: on.y + on.h + 10, w, h }, { x: on.x - 12 - w, y: on.y, w, h }];
      box = cands.find(b => free(b)) ?? place({ near: a.on }, w, h);
    } else box = place(a.place, w, h);
    addText({ ...a, text }, size, '#8a8984', box);
  }
  // ── More parts: votes, numbers, plotting, timelines, mind maps, curves, circles, funnels, bars, clusters ──
  const SYS = { blue: INK.blue, orange: INK.orange, red: INK.red, green: INK.green, gray: TEXT.muted, ink: TEXT.ink, fill: '#f2f2f2' };
  const sysOf = (c?: string) => (c ? DOT[base(c)] ?? (c.startsWith('#') ? c : SYS.blue) : SYS.blue);
  const groupIds = (ids: string[], title = '') => { const gid = addEl({ type: 'group', children: Object.fromEntries(ids.map(i => [i, true])), title: new Y.Text(title) }); created.push(gid); return gid; };

  
  const top = nextTop;
  // votes: dots along the top-right inside edge, in the board's existing vote colour
  function vote(a: Action) {
    const existing = reading.items.find(i => i.kind === 'dot' && reading.relations.attached.has(i.ref));
    const colour = existing?.hex ?? sysOf(a.colour);
    for (const ref of a.refs ?? []) {
      const b = boxOfRef(ref); if (!b) continue;
      const have = reading.items.filter(i => i.kind === 'dot' && reading.relations.attached.get(i.ref) === ref).length + newBoxes.filter(nb => nb.w === 12 && nb.y === b.y - 6 && nb.x > b.x && nb.x < b.x + b.w).length;
      for (let i = 0; i < (a.n ?? 1); i++) {
        const x = b.x + b.w - 12 - 12 - (have + i) * 16, y = b.y - 6;
        const id = addEl({ type: 'shape', shapeType: 'ellipse', index: top(), xywh: xywh({ x, y, w: 12, h: 12 }), filled: true, fillColor: colour, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() });
        created.push(id); newBoxes.push({ x, y, w: 12, h: 12 });
      }
    }
  }
  // order numbers: a small dark circle on the top-left corner of each thing, in the given order
  function number(a: Action) {
    (a.refs ?? []).slice(0, 6).forEach((ref: string, i: number) => {    // a few at most: order is for the first things to look at
      const b = boxOfRef(ref); if (!b) return;
      badge(b.x - 11, b.y - 11, 24, String((a.start ?? 1) + i), SYS.ink, '#ffffff', '#ffffff');
    });
  }
  // a round badge with its digit truly centred (a separate text box, sized to the digit's line)
  function badge(x: number, y: number, d: number, label: string, fill: string, ink: string, ring: string) {
    created.push(addEl({ type: 'shape', shapeType: 'ellipse', index: top(), xywh: xywh({ x, y, w: d, h: d }), filled: true, fillColor: fill, strokeColor: ring, strokeWidth: 1.5, text: new Y.Text() }));
    const fs = d <= 20 ? 10 : 11, lh = Math.round(fs * 1.2), t = new Y.Text(); t.insert(0, label);
    created.push(addEl({ type: 'text', index: top(), xywh: xywh({ x, y: y + (d - lh) / 2 + (d <= 20 ? 1 : 0), w: d, h: lh }), text: t, color: ink, fontSize: fs, fontWeight: '600', fontFamily: 'blocksuite:surface:Inter', textAlign: 'center' }));
  }
  // Tidy a container in place: keep its own structure (its sections, their titles, which card belongs where)
  // and its order, and only repair the layout: titles at the top, cards on an even grid, every section wrapping
  // what it holds, sections stacked with even gaps, the outer frame grown or shrunk to fit. Adds nothing.
  async function tidy(a: Action) {
    const roots = ((a.refs ?? (a.in ? [a.in] : a.ref ? [a.ref] : reading.selection)) as string[]).map(r0 => idOf(r0)).filter(Boolean) as string[];
    const frames = roots.map(id => gfx.getElementById(id)).filter((e: any) => e?.flavour === 'affine:frame');
    if (!frames.length) { errors.push('tidy: no section selected'); return; }
    await frame2();
    for (const f of frames) tidyFrame(f);
  }
  const PAD = 40, GAP = 24;
  type T = { id: string; el: any; kind: 'frame' | 'title' | 'sub' | 'full' | 'item'; w: number; h: number; kids?: T[] };
  const isText = (e: any) => !e.flavour && e.type === 'text';
  // Who belongs where: frames nest by their own child lists (or by sitting inside); every other thing goes to the
  // deepest frame that lists it, else the deepest frame its centre sits in. Things that spilled out stay home.
  let owner = new Map<string, string>();
  let riders: { id: string; host: string; dx: number; dy: number; w: number; h: number }[] = [];
  function assign(rootF: any) {
    owner = new Map();
    const inside = (o: Box, i: Box) => i.x >= o.x - 2 && i.y >= o.y - 2 && i.x + i.w <= o.x + o.w + 2 && i.y + i.h <= o.y + o.h + 2;
    // every frame inside the root, then each one's parent: the smallest frame that lists it or holds it
    const rb0 = rootF.elementBound;
    const all = (gfx.gfxElements as any[]).filter(e => e.flavour === 'affine:frame' && e.id !== rootF.id && (inside(rb0, e.elementBound) || (rootF.childIds ?? []).includes(e.id)));
    const frames: any[] = [rootF, ...all];
    const area = (f: any) => f.elementBound.w * f.elementBound.h;
    for (const f of all) {
      const cands = frames.filter(p0 => p0 !== f && ((p0.childIds ?? []).includes(f.id) || inside(p0.elementBound, f.elementBound)));
      owner.set(f.id, (cands.sort((p0, q0) => area(p0) - area(q0))[0] ?? rootF).id);
    }
    const depth = new Map<string, number>();
    const dOf = (id: string): number => { if (id === rootF.id) return 0; if (depth.has(id)) return depth.get(id)!; const d = dOf(owner.get(id)!) + 1; depth.set(id, d); return d; };
    depth.set(rootF.id, 0); for (const f of all) dOf(f.id);
    const listedBy = new Map<string, string>();
    for (const f of frames) for (const id of Object.keys(f.props?.childElementIds ?? {})) {
      const prev = listedBy.get(id); if (!prev || depth.get(f.id)! > depth.get(prev)!) listedBy.set(id, f.id);
    }
    const rb = rootF.elementBound;
    for (const e of gfx.gfxElements as any[]) {
      if (depth.has(e.id) || e.flavour === 'affine:surface' || (!e.flavour && e.type === 'connector')) continue;
      let o = listedBy.get(e.id);
      if (!o) {
        const b = e.elementBound, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const hits = frames.filter(f => { const fb = f.elementBound; return cx >= fb.x && cx <= fb.x + fb.w && cy >= fb.y && cy <= fb.y + fb.h; });
        if (!hits.length || !inside({ x: rb.x - 40, y: rb.y - 40, w: rb.w + 80, h: rb.h + 80 }, b)) continue;
        o = hits.sort((p, q) => depth.get(q.id)! - depth.get(p.id)!)[0].id;
      }
      owner.set(e.id, o!);
    }
  }
  function membersOf(f: any, _taken: Set<string>): any[] {
    return [...owner].filter(([, o]) => o === f.id).map(([id]) => gfx.getElementById(id)).filter(Boolean);
  }
  function measureTree(f: any, taken: Set<string>): T {
    const ms = membersOf(f, taken);
    const subFrames = ms.filter(e => e.flavour === 'affine:frame').sort((p, q) => p.elementBound.y - q.elementBound.y || p.elementBound.x - q.elementBound.x);
    // small marks (badges, dots, stamps) ride along with the thing they sit on
    const small = (e: any) => !e.flavour || e.flavour === 'affine:image' ? e.elementBound.w <= 32 && e.elementBound.h <= 32 : false;
    const big = ms.filter(e => e.flavour !== 'affine:frame' && !small(e));
    for (const m of ms.filter(small)) {
      const mb = m.elementBound, cx = mb.x + mb.w / 2, cy = mb.y + mb.h / 2;
      const host = big.map(h0 => ({ h0, d: Math.max(0, h0.elementBound.x - cx, cx - h0.elementBound.x - h0.elementBound.w) + Math.max(0, h0.elementBound.y - cy, cy - h0.elementBound.y - h0.elementBound.h) })).sort((p, q) => p.d - q.d)[0];
      if (host && host.d <= 24) { const hb = host.h0.elementBound; riders.push({ id: m.id, host: host.h0.id, dx: mb.x - hb.x, dy: mb.y - hb.y, w: mb.w, h: mb.h }); }
    }
    const riding = new Set(riders.map(r0 => r0.id));
    const kids: T[] = subFrames.map(sf => measureTree(sf, taken));
    // texts at the top of the frame are its heading (largest first); other members keep their reading order
    const texts = ms.filter(isText).sort((p, q) => (q.fontSize ?? 0) - (p.fontSize ?? 0));
    const head: T[] = [];
    if (texts[0] && (texts[0].fontSize ?? 0) >= 18) head.push({ id: texts[0].id, el: texts[0], kind: 'title', w: texts[0].elementBound.w, h: texts[0].elementBound.h });
    for (const t of texts.slice(head.length)) if ((t.fontSize ?? 0) <= 16 && t.elementBound.w > 0 && head.length < 2 && t.elementBound.y < (texts[0]?.elementBound.y ?? 0) + 120) head.push({ id: t.id, el: t, kind: 'sub', w: t.elementBound.w, h: t.elementBound.h });
    const rest = ms.filter(e => e.flavour !== 'affine:frame' && !small(e) && !head.some(h0 => h0.id === e.id))   // a stray mark with no host stays where it is
      .sort((p, q) => p.elementBound.y - q.elementBound.y || p.elementBound.x - q.elementBound.x)
      .map(e => ({ id: e.id, el: e, kind: 'item' as const, w: e.elementBound.w, h: e.elementBound.h }));
    // a card much wider than the others is a full-width row (a summary)
    const widths = rest.map(r0 => r0.w).sort((p, q) => p - q); const median = widths[widths.length >> 1] ?? 0;
    for (const r0 of rest) if (rest.length > 2 && r0.w > median * 1.6) (r0 as any).kind = 'full';
    const node: T = { id: f.id, el: f, kind: 'frame', w: 0, h: 0, kids: [...head, ...rest, ...kids] };
    sizeT(node);
    return node;
  }
  const ROWS = new Map<T, { cols: number; colW: number; rowH: number[]; inner: number }>();
  function sizeT(n: T) {
    const kids = n.kids!; const head = kids.filter(k => k.kind === 'title' || k.kind === 'sub');
    const full = kids.filter(k => k.kind === 'full'), items = kids.filter(k => k.kind === 'item'), frames = kids.filter(k => k.kind === 'frame');
    const headH = head.reduce((s0, k) => s0 + k.h, 0) + (head.length > 1 ? 8 : 0);
    const cnt = items.length, cols = Math.max(1, Math.min(cnt, cnt <= 4 ? cnt : cnt <= 6 ? 3 : 4));
    const colW = items.length ? Math.max(...items.map(k => k.w)) : 0;
    const rows: number[] = []; for (let i = 0; i < cnt; i += cols) rows.push(Math.max(...items.slice(i, i + cols).map(k => k.h)));
    const gridW = cnt ? cols * colW + (cols - 1) * GAP : 0, gridH = rows.reduce((s0, h) => s0 + h, 0) + Math.max(0, rows.length - 1) * GAP;
    const frameW = frames.length ? Math.max(...frames.map(k => k.w)) : 0;
    const inner = Math.max(gridW, frameW, ...full.map(k => k.w), ...head.map(k => k.w), 200);
    frames.forEach(k => { k.w = inner; });                           // sections down a column share one width
    const blocks = [headH, ...full.map(k => k.h), cnt ? gridH : 0, ...frames.map(k => k.h)].filter(v => v > 0);
    n.w = inner + PAD * 2; n.h = PAD * 2 + blocks.reduce((s0, v) => s0 + v, 0) + Math.max(0, blocks.length - 1) * (frames.length ? GAP + 8 : GAP);
    ROWS.set(n, { cols, colW, rowH: rows, inner });
  }
  function placeT(n: T, x: number, y: number) {
    const L = ROWS.get(n)!; const kids = n.kids!;
    setBox(n.id, { x, y, w: snap(n.w), h: snap(n.h) });
    let cy = y + PAD; const blockGap = kids.some(k => k.kind === 'frame') ? GAP + 8 : GAP;
    const head = kids.filter(k => k.kind === 'title' || k.kind === 'sub');
    head.forEach((k, i) => { setBox(k.id, { x: x + PAD, y: cy, w: k.w, h: k.h }); cy += k.h + (i < head.length - 1 ? 8 : 0); });
    if (head.length) cy += blockGap;
    for (const k of kids.filter(k0 => k0.kind === 'full')) { setBox(k.id, { x: x + PAD, y: cy, w: k.w, h: k.h }); cy += k.h + blockGap; }
    const items = kids.filter(k => k.kind === 'item');
    items.forEach((k, i) => { const c = i % L.cols, r0 = Math.floor(i / L.cols); const ry = cy + L.rowH.slice(0, r0).reduce((s0, h) => s0 + h + GAP, 0); setBox(k.id, { x: x + PAD + c * (L.colW + GAP), y: ry, w: k.w, h: k.h }); });
    if (items.length) cy += L.rowH.reduce((s0, h) => s0 + h, 0) + Math.max(0, L.rowH.length - 1) * GAP + blockGap;
    for (const k of kids.filter(k0 => k0.kind === 'frame')) {
      // the sub-section was sized for its own content; widen its box to the shared column width
      placeT(k, x + PAD, cy); cy += k.h + blockGap;
    }
  }
  function tidyFrame(f: any) {
    assign(f); riders = [];
    const root = measureTree(f, new Set([f.id]));
    const b = f.elementBound;
    placeT(root, b.x, b.y);
    for (const r0 of riders) { const h0: any = gfx.getElementById(r0.host); if (h0) { const hb = h0.elementBound; setBox(r0.id, { x: hb.x + r0.dx, y: hb.y + r0.dy, w: r0.w, h: r0.h }); } }
  }

  // the same small number on a new thing and the user's thing it answers: a link without a line
  function pair(a: Action) {
    (a.pairs ?? []).slice(0, 5).forEach((pr: string[], i: number) => {
      for (const ref of pr) {
        const b = boxOfRef(ref); if (!b) { errors.push(`pair: unknown ${ref}`); continue; }
        badge(b.x + b.w - 10, b.y - 10, 20, String((a.start ?? 1) + i), '#ffffff', LINE.color, LINE.color);
      }
    });
  }
  // place things by value on a chart / 2×2: x 0→1 left→right, y 0→1 bottom→top
  function plot(a: Action) {
    const st = reading.structures.find(x => x.ref === a.chart); if (!st) { errors.push(`plot: unknown ${a.chart}`); return; }
    const b = st.box, pad = 24;
    for (const p of a.items ?? []) {
      const fx = Math.max(0, Math.min(1, +p.x)), fy = Math.max(0, Math.min(1, +p.y));
      const cx = b.x + pad + fx * (b.w - pad * 2), cy = b.y + b.h - pad - fy * (b.h - pad * 2);
      if (p.ref) { const id = idOf(p.ref), bb = boxOfRef(p.ref); if (id && bb) { const s0 = Math.min(bb.w, 140) / bb.w; setBox(id, { x: cx - bb.w * s0 / 2, y: cy - bb.h * s0 / 2, w: bb.w * s0, h: bb.h * s0 }); } continue; }
      const size = 120, fill = fillOf(p.colour) ?? STICKY.yellow;
      const t = new Y.Text(); t.insert(0, String(p.text ?? ''));
      const id = addEl({ type: 'shape', shapeType: 'rect', xywh: xywh({ x: cx - size / 2, y: cy - size / 2, w: size, h: size }), radius: 0.04, filled: true, fillColor: fill, strokeColor: 'transparent', strokeWidth: 0,
        color: TEXT.ink, fontSize: fitSize(size, String(p.text ?? '')), fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [12, 12], shadow: SHADOW.sticky, text: t });
      created.push(id); newBoxes.push({ x: cx - size / 2, y: cy - size / 2, w: size, h: size });
    }
  }
  // a new point on a timeline: a dot on the line, its label under it, an optional callout above
  function milestone(a: Action) {
    const ln = item(a.line); const el: any = ln && gfx.getElementById(ln.id);
    if (!el) { errors.push(`milestone: unknown line ${a.line}`); return; }
    const p = el.absolutePath ?? []; if (p.length < 2) return;
    const [A, Z] = [p[0], p[p.length - 1]];
    let t = typeof a.at === 'number' ? a.at : 0.5;
    if (a.after || a.before) {   // halfway to the neighbour
      const ref = a.after ?? a.before; const bb = boxOfRef(ref);
      const along = (bx: Box) => Math.abs(Z[0] - A[0]) > Math.abs(Z[1] - A[1]) ? (bx.x + bx.w / 2 - A[0]) / (Z[0] - A[0]) : (bx.y + bx.h / 2 - A[1]) / (Z[1] - A[1]);
      if (bb) { const t0 = along(bb); const others = reading.items.filter(i => i.kind === 'dot' || i.kind === 'badge').map(i => along(i.box)).filter(v => v > 0 && v < 1).sort((x, y) => x - y);
        const nb = a.after ? others.find(v => v > t0 + 0.01) ?? Math.min(1, t0 + 0.15) : [...others].reverse().find(v => v < t0 - 0.01) ?? Math.max(0, t0 - 0.15); t = (t0 + nb) / 2; }
    }
    const x = A[0] + (Z[0] - A[0]) * t, y = A[1] + (Z[1] - A[1]) * t;
    const like = reading.items.find(i => i.kind === 'dot' && Math.abs(i.box.y + i.box.h / 2 - y) < 20);
    const d = like?.box.w ?? 12;
    const ids = [addEl({ type: 'shape', shapeType: 'ellipse', xywh: xywh({ x: x - d / 2, y: y - d / 2, w: d, h: d }), filled: true, fillColor: like?.hex ?? SYS.ink, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() })];
    const lab = (txt: string, yy: number, weight: string, colour: string) => { const m = new Y.Text(); m.insert(0, txt); const w = textWidth(txt, 13) + 4; return addEl({ type: 'text', xywh: xywh({ x: x - w / 2, y: yy, w, h: 18 }), text: m, fontSize: 13, fontWeight: weight, color: colour, fontFamily: 'blocksuite:surface:Inter', textAlign: 'center' }); };
    if (a.label) ids.push(lab(String(a.label), y + d / 2 + 10, '400', '#3a3a3c'));
    if (a.callout) ids.push(lab(String(a.callout), y - d / 2 - 30, '600', SYS.ink));
    created.push(...ids);
  }
  // mind map: new child ideas under a node
  function branch(a: Action) {
    const nodeId = idOf(a.on);
    const mm: any = reading.items.filter(i => i.kind === 'mindmap').map(i => gfx.getElementById(i.id)).find((m: any) => m?.childIds?.includes?.(nodeId) || m?.tree?.id === nodeId);
    if (!mm || !nodeId) { errors.push(`branch: ${a.on} is not in a mind map`); return; }
    for (const t of a.items ?? []) { const id = mm.addNode(nodeId, undefined, 'after', { text: String(t) }); if (id) created.push(id); }
    try { mm.layout(); } catch { /* layout runs on next render */ }
  }
  // a smooth curve: through refs' centres, or through points on a chart (x,y in 0–1, y up)
  function curve(a: Action) {
    let pts: number[][] = [];
    if (a.through) pts = a.through.map((r: string) => boxOfRef(r)).filter(Boolean).map((b: Box) => [b.x + b.w / 2, b.y + b.h / 2]);
    else if (a.chart && a.points) { const st = reading.structures.find(x => x.ref === a.chart); if (st) { const b = st.box, pad = 24; pts = a.points.map((p: number[]) => [b.x + pad + p[0] * (b.w - pad * 2), b.y + b.h - pad - p[1] * (b.h - pad * 2)]); } }
    if (pts.length < 2) { errors.push('curve: needs two points'); return; }
    const out: number[][] = [];   // Catmull–Rom, 12 steps per span
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < 12; k++) { const t = k / 12, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
    }
    out.push(pts[pts.length - 1]);
    created.push(addEl({ type: 'brush', points: out, color: sysOf(a.colour), lineWidth: 4 }));
  }
  // a loose hand-drawn loop around things to say "look here"
  function circle(a: Action) {
    const boxes = (a.refs ?? []).map(boxOfRef).filter(Boolean) as Box[]; if (!boxes.length) return;
    const u = union(boxes), cx = u.x + u.w / 2, cy = u.y + u.h / 2, rx = u.w / 2 + 22, ry = u.h / 2 + 22;
    const pts: number[][] = [];
    for (let t = -0.15; t <= Math.PI * 2 + 0.25; t += 0.08) { const wob = 1 + 0.025 * Math.sin(t * 3.1); pts.push([cx + Math.cos(t) * rx * wob, cy + Math.sin(t) * ry * wob]); }
    created.push(addEl({ type: 'brush', points: pts, color: sysOf(a.colour ?? 'orange'), lineWidth: 3 }));
  }
  // funnel: stages as centred bars, narrowing by value, with the drop between stages
  function funnel(a: Action) {
    const st: { label: string; value: number }[] = a.stages ?? []; if (!st.length) return;
    const max = Math.max(...st.map(s => +s.value || 0)) || 1, W = 560, H = 48, G = 6;
    const box = place(a.place, W + 140, st.length * (H + G) - G + (a.title ? 48 : 0), anchorOf(a) ?? reading.selection[0]);
    const ids: string[] = []; let y = box.y;
    const ramp = [FILL.blue, '#c4e5ff', TINTH.blue, '#ecf7ff', '#f5fbff'];
    if (a.title) { const t = new Y.Text(); t.insert(0, String(a.title)); ids.push(addEl({ type: 'text', xywh: xywh({ x: box.x, y, w: textWidth(String(a.title), 20) + 8, h: 28 }), text: t, fontSize: 20, fontWeight: '700', color: SYS.ink, fontFamily: 'blocksuite:surface:Inter' })); y += 48; }
    st.forEach((s, i) => {
      const w = Math.max(200, W * Math.sqrt((+s.value || 0) / max)), x = box.x + (W - w) / 2;
      const t = new Y.Text(); t.insert(0, `${s.label}  ${s.value}`);
      ids.push(addEl({ type: 'shape', shapeType: 'rect', radius: 0.22, xywh: xywh({ x, y, w, h: H }), filled: true, fillColor: ramp[Math.min(i, ramp.length - 1)], strokeColor: 'transparent', strokeWidth: 0,
        color: SYS.ink, fontSize: 14, fontWeight: '500', fontFamily: 'blocksuite:surface:Inter', textAlign: 'center', textHorizontalAlign: 'center', textVerticalAlign: 'center', text: t }));
      if (i > 0 && +st[i - 1].value) { const pct = Math.round((1 - (+s.value) / (+st[i - 1].value)) * 100); const m = new Y.Text(); m.insert(0, `−${pct}%`);
        ids.push(addEl({ type: 'text', xywh: xywh({ x: x + w + 12, y: y + H / 2 - 9, w: 64, h: 18 }), text: m, fontSize: TYPE.caption, color: SYS.gray, fontFamily: 'blocksuite:surface:Inter' })); }
      y += H + G;
    });
    created.push(...ids); groupIds(ids, String(a.title ?? 'Funnel')); newBoxes.push(box);
  }
  // scores: a quiet card of labelled bars (rating, confidence, effort …)
  function bars(a: Action) {
    const rows: { label: string; value: number; max?: number }[] = a.items ?? []; if (!rows.length) return;
    const W = 360, rowH = 34, padX = 20, top = a.title ? 56 : 20;
    const H = top + rows.length * rowH + 14;
    const box = place(a.place, W, H, anchorOf(a) ?? reading.selection[0]);
    const ids = [addEl({ type: 'shape', shapeType: 'rect', radius: 0.06, xywh: xywh({ ...box }), filled: true, fillColor: '#ffffff', strokeColor: 'transparent', strokeWidth: 0, shadow: { blur: 7, offsetX: 0, offsetY: 4, color: 'rgba(0,0,0,0.12)' }, text: new Y.Text() })];
    const txt = (s: string, x: number, y: number, w: number, size: number, weight: string, colour: string, align = 'left') => { const t = new Y.Text(); t.insert(0, s); return addEl({ type: 'text', xywh: xywh({ x, y, w, h: Math.round(size * 1.4) }), text: t, fontSize: size, fontWeight: weight, color: colour, fontFamily: 'blocksuite:surface:Inter', textAlign: align }); };
    if (a.title) ids.push(txt(String(a.title), box.x + padX, box.y + 18, W - padX * 2, 15, '600', SYS.ink));
    const labelW = 110, trackX = box.x + padX + labelW, trackW = W - padX * 2 - labelW - 40;
    rows.forEach((r, i) => {
      const y = box.y + top + i * rowH, v = Math.max(0, Math.min(1, (+r.value || 0) / (r.max ?? a.max ?? 5)));
      ids.push(txt(String(r.label), box.x + padX, y + 2, labelW - 8, 13, '400', '#3a3a3c'));
      ids.push(addEl({ type: 'shape', shapeType: 'rect', radius: 0.5, xywh: xywh({ x: trackX, y: y + 8, w: trackW, h: 6 }), filled: true, fillColor: SYS.fill, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() }));
      if (v > 0) ids.push(addEl({ type: 'shape', shapeType: 'rect', radius: 0.5, xywh: xywh({ x: trackX, y: y + 8, w: Math.max(6, trackW * v), h: 6 }), filled: true, fillColor: sysOf(a.colour), strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() }));
      ids.push(txt(String(r.value), trackX + trackW + 10, y + 2, 30, 12, '500', SYS.gray));
    });
    created.push(...ids); groupIds(ids, String(a.title ?? 'Scores')); newBoxes.push(box);
  }


  // Journey map: one designed table. Stages run across the top as numbered headers; each row is a layer with
  // its name in a quiet column on the left and hairlines between rows. A row has a kind, and each kind has its
  // own look: plain text, a short list, small pills (touchpoints), notes in one hue (pains, wins, opportunities),
  // and a feeling curve drawn across the stages with a dot and a word at each one.
  function journey(a: Action) {
    const stages: string[] = (a.stages ?? []).map((x: any) => String(x?.label ?? x)); if (stages.length < 2) return;
    const rows: any[] = (a.rows ?? []).filter((r0: any) => r0 && Array.isArray(r0.cells));
    const n = stages.length, COL = n <= 4 ? 232 : 208, GAP = 20, LABEL = 132, PAD = 40, ROWPAD = 20;
    const gridW = n * COL + (n - 1) * GAP, W = PAD + LABEL + GAP + gridW + PAD;
    const F = 'blocksuite:surface:Inter';
    const ids: string[] = [];
    type Draw = (x: number, y: number) => void;
    const draws: Draw[] = [];
    const txtH = (t: string, size: number, weight: number, w: number) => wrapLines(t, size, weight, w).length * Math.round(size * 1.4);
    const txt = (t: string, x: number, y: number, w: number, size: number, weight: string, colour: string, align = 'left') => {
      const lines = wrapLines(t, size, Number(weight), w); const y0 = new Y.Text(); y0.insert(0, lines.join('\n'));
      ids.push(addEl({ type: 'text', xywh: xywh({ x, y, w, h: lines.length * Math.round(size * 1.4) }), text: y0, fontSize: size, fontWeight: weight, color: colour, fontFamily: F, textAlign: align }));
    };
    const rect = (b: Box, fill: string, radius = 0.06, stroke?: string) => { const id = addEl({ type: 'shape', shapeType: 'rect', radius, xywh: xywh(b), filled: true, fillColor: fill, strokeColor: stroke ?? 'transparent', strokeWidth: stroke ? 1 : 0, text: new Y.Text() }); ids.push(id); return id; };
    const hair = (x: number, y: number, w: number) => ids.push(addEl({ type: 'connector', mode: 0, source: { position: [x, y] }, target: { position: [x + w, y] }, stroke: '#ececec', strokeWidth: 1, strokeStyle: 'solid', frontEndpointStyle: 'None', rearEndpointStyle: 'None' }));
    const colX = (i: number) => PAD + LABEL + GAP + i * (COL + GAP);
    const listOf = (c: any): string[] => (Array.isArray(c) ? c : String(c ?? '').split(/\n|;\s+/)).map((x: any) => String(x).replace(/^[-•*]\s*/, '').trim()).filter(Boolean);

    // title block
    let y = PAD;
    if (a.title) { const t = clean(String(a.title)); const h = txtH(t, 24, 700, W - PAD * 2); draws.push((X, Y0) => txt(t, X + PAD, Y0 + PAD, W - PAD * 2, 24, '700', TEXT.ink)); y += h + 6; }
    if (a.subtitle) { const t = clean(String(a.subtitle)); const y1 = y, h = txtH(t, 14, 400, W - PAD * 2); draws.push((X, Y0) => txt(t, X + PAD, Y0 + y1, W - PAD * 2, 14, '400', TEXT.muted)); y += h; }
    y += a.title || a.subtitle ? 28 : 0;
    // stage headers: a soft bar with a small dark number and the stage name
    { const y1 = y, hh = Math.max(44, ...stages.map(st => txtH(st, 15, 600, COL - 60) + 24));
      draws.push((X, Y0) => stages.forEach((st, i) => {
        const bx = X + colX(i);
        rect({ x: bx, y: Y0 + y1, w: COL, h: hh }, '#f3f3f5', Math.min(0.5, 12 / hh));
        const d = addEl({ type: 'shape', shapeType: 'ellipse', xywh: xywh({ x: bx + 12, y: Y0 + y1 + (hh - 22) / 2, w: 22, h: 22 }), filled: true, fillColor: '#1d1d1f', strokeColor: 'transparent', strokeWidth: 0, text: (() => { const t = new Y.Text(); t.insert(0, String(i + 1)); return t; })(), color: '#ffffff', fontSize: 12, fontWeight: '600', fontFamily: F, textAlign: 'center', textHorizontalAlign: 'center', textVerticalAlign: 'center', padding: [0, 0] });
        ids.push(d);
        const th = txtH(st, 15, 600, COL - 60);
        txt(st, bx + 44, Y0 + y1 + (hh - th) / 2, COL - 60, 15, '600', TEXT.ink);
      }));
      y += hh + 8; }

    for (const row of rows) {
      const kind = String(row.kind ?? 'text'), cells: any[] = row.cells.slice(0, n), hue = base(String(row.colour ?? (kind === 'sticky' ? 'yellow' : 'blue'))).replace('purple', 'blue').replace('violet', 'blue');
      const label = clean(String(row.label ?? ''));
      let h = 0; const cellDraw: Draw[] = [];
      if (kind === 'emotion') {
        // a feeling curve: higher = better; a dot per stage, the word under it
        const BAND = 96, pts = cells.map((c: any) => ({ s: Math.max(1, Math.min(5, Number(c?.score ?? c ?? 3))), t: clean(String(c?.text ?? '')) }));
        const wordH = Math.max(0, ...pts.map(p2 => p2.t ? txtH(p2.t, 13, 400, COL - 8) : 0));
        h = BAND + (wordH ? 10 + wordH : 0);
        cellDraw.push((X, Y0) => {
          const P = pts.map((p2, i) => ({ x: X + colX(i) + COL / 2, y: Y0 + 10 + (BAND - 20) * (1 - (p2.s - 1) / 4) }));
          ids.push(addEl({ type: 'connector', mode: 0, source: { position: [X + colX(0), Y0 + BAND / 2] }, target: { position: [X + colX(n - 1) + COL, Y0 + BAND / 2] }, stroke: '#e3e3e6', strokeWidth: 1, strokeStyle: 'dash', frontEndpointStyle: 'None', rearEndpointStyle: 'None' }));
          for (let i = 0; i + 1 < P.length; i++) ids.push(addEl({ type: 'connector', mode: 2, source: { position: [P[i].x, P[i].y] }, target: { position: [P[i + 1].x, P[i + 1].y] }, stroke: '#3dadff', strokeWidth: 2.5, strokeStyle: 'solid', frontEndpointStyle: 'None', rearEndpointStyle: 'None' }));
          P.forEach((q, i) => {
            const low = pts[i].s <= 2, high = pts[i].s >= 4;
            ids.push(addEl({ type: 'shape', shapeType: 'ellipse', xywh: xywh({ x: q.x - 8, y: q.y - 8, w: 16, h: 16 }), filled: true, fillColor: low ? '#f24822' : high ? '#34c759' : '#ffffff', strokeColor: low ? '#f24822' : high ? '#34c759' : '#3dadff', strokeWidth: 2.5, text: new Y.Text() }));
            if (pts[i].t) txt(pts[i].t, X + colX(i) + 4, Y0 + BAND + 10, COL - 8, 13, '400', TEXT.body, 'center');
          });
        });
      } else if (kind === 'tags') {
        const lay = cells.map((c: any) => { const tags = listOf(c).slice(0, 6); let x = 0, yy = 0; const out: { t: string; x: number; y: number; w: number }[] = [];
          for (const t of tags) { const w = Math.min(COL, Math.ceil(textWidth(t, 12)) + 22); if (x + w > COL && x > 0) { x = 0; yy += 30; } out.push({ t, x, y: yy, w }); x += w + 6; }
          return { out, h: tags.length ? yy + 24 : 0 }; });
        h = Math.max(24, ...lay.map(l => l.h));
        cellDraw.push((X, Y0) => lay.forEach((l, i) => l.out.forEach(pl => {
          rect({ x: X + colX(i) + pl.x, y: Y0 + pl.y, w: pl.w, h: 24 }, '#ffffff', 0.5, '#e3e3e6');
          txt(pl.t, X + colX(i) + pl.x + 11, Y0 + pl.y + 4, pl.w - 20, 12, '500', TEXT.body);
        })));
      } else if (kind === 'sticky') {
        // notes in the row's hue: as wide as the column, as tall as their words; several in a cell stack
        const fill = STICKY[hue] ?? STICKY.yellow;
        const lay = cells.map((c: any) => { let yy = 0; const out = listOf(Array.isArray(c) ? c : [c]).slice(0, 3).map(t0 => { const t = clean(t0), hh = Math.max(64, txtH(t, 14, 400, COL - 28) + 28); const o = { t, y: yy, h: hh }; yy += hh + 8; return o; }); return { out, h: Math.max(0, yy - 8) }; });
        { const one = Math.max(64, ...lay.flatMap(l => l.out.map(o => o.h))); for (const l of lay) { let yy = 0; for (const o of l.out) { o.h = one; o.y = yy; yy += one + 8; } l.h = Math.max(0, yy - 8); } }
        h = Math.max(64, ...lay.map(l => l.h));
        cellDraw.push((X, Y0) => lay.forEach((l, i) => l.out.forEach(o => {
          const t = new Y.Text(); t.insert(0, wrapLines(o.t, 14, 400, COL - 28).join('\n'));
          ids.push(addEl({ type: 'shape', shapeType: 'rect', radius: 0.05, xywh: xywh({ x: X + colX(i), y: Y0 + o.y, w: COL, h: o.h }), filled: true, fillColor: fill, strokeColor: 'transparent', strokeWidth: 0, color: TEXT.ink, fontSize: 14, fontFamily: F,
            textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [14, 14], shadow: SHADOW.sticky, text: t }));
        })));
      } else {
        // text, or a short list: a bold first line when the cell has "Title — detail"
        const lay = cells.map((c: any) => {
          if (kind === 'list' || Array.isArray(c)) { const items = listOf(c).slice(0, 5).map(clean); let yy = 0; const out = items.map(t => { const hh = txtH(t, 14, 400, COL - 16); const o = { t, y: yy, h: hh }; yy += hh + 6; return o; }); return { list: out, h: Math.max(0, yy - 6) }; }
          const raw = clean(String(c ?? '')); const k = raw.indexOf(' — '); const head = k > 0 ? raw.slice(0, k) : raw, body0 = k > 0 ? raw.slice(k + 3) : '', body = body0 ? body0[0].toUpperCase() + body0.slice(1) : '';
          const hh = txtH(head, 14, k > 0 || row.strong ? 600 : 400, COL), bh = body ? txtH(body, 13, 400, COL) : 0;
          return { head, body, strong: k > 0 || !!row.strong, hh, h: hh + (body ? 4 + bh : 0) };
        });
        h = Math.max(20, ...lay.map(l => l.h));
        cellDraw.push((X, Y0) => lay.forEach((l: any, i) => {
          if (l.list) l.list.forEach((o: any) => { ids.push(addEl({ type: 'shape', shapeType: 'ellipse', xywh: xywh({ x: X + colX(i) + 2, y: Y0 + o.y + 8, w: 4, h: 4 }), filled: true, fillColor: '#aeaeb2', strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() })); txt(o.t, X + colX(i) + 16, Y0 + o.y, COL - 16, 14, '400', TEXT.body); });
          else if (l.head) { txt(l.head, X + colX(i), Y0, COL, 14, l.strong ? '600' : '400', l.strong ? TEXT.ink : TEXT.body); if (l.body) txt(l.body, X + colX(i), Y0 + l.hh + 4, COL, 13, '400', TEXT.muted); }
        }));
      }
      const y1 = y, lh = txtH(label, 13, 600, LABEL);
      const rh = Math.max(h, lh);
      draws.push((X, Y0) => { hair(X + PAD, Y0 + y1, W - PAD * 2); txt(label, X + PAD, Y0 + y1 + ROWPAD, LABEL, 13, '600', '#6e6e73'); cellDraw.forEach(d => d(X, Y0 + y1 + ROWPAD)); });
      y += ROWPAD + rh + ROWPAD;
    }
    const H = y + PAD - ROWPAD;
    const box = place(a.place, W, H, anchorOf(a) ?? reading.selection[0]);
    const card = addEl({ type: 'shape', shapeType: 'rect', radius: 0.012, xywh: xywh(box), filled: true, fillColor: '#ffffff', strokeColor: 'transparent', strokeWidth: 0, shadow: { blur: 10, offsetX: 0, offsetY: 3, color: 'rgba(0,0,0,0.07)' }, text: new Y.Text() });
    draws.forEach(d => d(box.x, box.y));
    ids.unshift(card);
    created.push(...ids); groupIds(ids, String(a.title ?? 'Journey map')); newBoxes.push(box);
    if (a.name) named.set(a.name, { id: card, box });
  }

  // Tags: small quiet pills inside a thing's bottom edge. On a coloured thing the pill is white (one
  // accent is enough); on a white thing it is soft gray. The tag's own colour is only a small dot.
  // Pills keep a 12px inset from every edge and wrap upward into a new row when a row is full.
  const DOT: Record<string, string> = INK;
  // One pill for tags and legends alike: white, hairline border, a small dot for the hue, caption text.
  const PILL_H = 24;
  const pillW = (label: string, dot: boolean) => Math.ceil(textWidth(label, TYPE.caption)) + (dot ? 28 : 20);
  function pill(x: number, y: number, label: string, dot?: string): string[] {
    const w = pillW(label, !!dot);
    const ids = [addEl({ type: 'shape', shapeType: 'rect', radius: RADIUS.pill, xywh: xywh({ x, y, w, h: PILL_H }), filled: true,
      fillColor: '#ffffff', strokeColor: TEXT.line, strokeWidth: 1, text: new Y.Text() })];
    if (dot) ids.push(addEl({ type: 'shape', shapeType: 'ellipse', xywh: xywh({ x: x + 10, y: y + 9, w: 6, h: 6 }), filled: true, fillColor: dot, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() }));
    const t = new Y.Text(); t.insert(0, label);
    ids.push(addEl({ type: 'text', xywh: xywh({ x: x + (dot ? 21 : 10), y: y + 5, w: w - (dot ? 28 : 20), h: 15 }), text: t, color: TEXT.body, fontSize: TYPE.caption, fontWeight: '500', fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' }));
    return ids;
  }
  // Marks, not pills: a colour dot straddling the top-right corner of the thing (a second one steps left),
  // and the meaning of each colour said once, in a key beside the marked things.
  const marksOn = new Map<string, number>();
  const keyEntries = new Map<string, string>();   // colour → meaning
  const keyBoxes: Box[] = [];
  let legendDrawn = false;
  function tag(a: Action) {
    const refs: string[] = a.refs ?? (a.ref ? [a.ref] : a.on ? [a.on] : []);
    const label = String(a.text ?? a.label ?? '').trim();
    const c = DOT[base(a.colour ?? 'blue')] ?? DOT.blue;
    for (const ref of refs) {
      const b = boxOfRef(ref);
      if (!b) { errors.push(`tag: unknown ${ref}`); continue; }
      const n = marksOn.get(ref) ?? 0; marksOn.set(ref, n + 1);
      const s0 = 14, x = b.x + b.w - s0 / 2 - n * (s0 + 4), y = b.y - s0 / 2;
      created.push(addEl({ type: 'shape', shapeType: 'ellipse', index: nextTop(), xywh: xywh({ x, y, w: s0, h: s0 }), filled: true, fillColor: c, strokeColor: '#ffffff', strokeWidth: 2, text: new Y.Text() }));
      keyBoxes.push(b);
    }
    if (label && !keyEntries.has(c)) keyEntries.set(c, label);
  }
  // the key: a small white card, one row per colour (dot + meaning), placed beside the marked things
  function key(entries: { colour: string; label: string }[], near?: Box, at?: Box) {
    if (!entries.length) return;
    const rowH = 22, pad = 14, title = 'Key';
    const w = Math.max(...entries.map(e => textWidth(e.label, TYPE.caption))) + pad * 2 + 22, h = pad * 2 + 18 + entries.length * rowH;
    let box0: Box;
    if (at) box0 = { ...at, w, h };
    else if (near) {
      const cands = [{ x: near.x + near.w + 32, y: near.y, w, h }, { x: near.x, y: near.y - h - 24, w, h }, { x: near.x, y: near.y + near.h + 24, w, h }];
      box0 = cands.find(c0 => free(c0)) ?? cands[0];
    } else box0 = place(undefined, w, h, reading.selection[0]);
    const ids = [addEl({ type: 'shape', shapeType: 'rect', radius: 0.12, index: nextTop(), xywh: xywh(box0), filled: true, fillColor: '#ffffff', strokeColor: TEXT.line, strokeWidth: 1, text: new Y.Text() })];
    const tt = new Y.Text(); tt.insert(0, title);
    ids.push(addEl({ type: 'text', index: nextTop(), xywh: xywh({ x: box0.x + pad, y: box0.y + pad - 2, w: 60, h: 16 }), text: tt, color: TEXT.muted, fontSize: 11, fontWeight: '600', fontFamily: 'blocksuite:surface:Inter' }));
    entries.forEach((e, i) => {
      const y = box0.y + pad + 18 + i * rowH;
      ids.push(addEl({ type: 'shape', shapeType: 'ellipse', index: nextTop(), xywh: xywh({ x: box0.x + pad, y: y + 4, w: 10, h: 10 }), filled: true, fillColor: e.colour, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() }));
      const t = new Y.Text(); t.insert(0, e.label);
      ids.push(addEl({ type: 'text', index: nextTop(), xywh: xywh({ x: box0.x + pad + 18, y: y + 1, w: textWidth(e.label, TYPE.caption) + 4, h: 16 }), text: t, color: TEXT.body, fontSize: TYPE.caption, fontFamily: 'blocksuite:surface:Inter' }));
    });
    created.push(...ids); newBoxes.push(box0);
    return { id: ids[0], box: box0 };
  }

  function legend(a: Action) {
    const entries = (a.entries ?? []).map((e: any) => {
      const c = base(e.colour ?? 'gray');
      const hl = getComputedStyle(document.documentElement).getPropertyValue(`--affine-text-highlight-${HL.includes(c) ? c : 'yellow'}`).trim();
      const isMark = reading.items.some(i => i.marks?.some(m => base(m.colour) === c));
      return { colour: (isMark && hl && /^#|rgb/.test(hl) ? hl : undefined) ?? userHex.get(c) ?? fillOf(e.colour)!, label: String(e.label ?? '') };
    }).filter((e: any) => e.label);
    const at = Object.keys(a.place ?? {}).length ? place(a.place, 160, 40 + entries.length * 22) : undefined;
    legendDrawn = true;
    const k = key(entries, at ? undefined : (reading.selection[0] ? boxOfRef(reading.selection[0]) : undefined), at);
    if (k && a.name) named.set(a.name, k);
  }

  // ── Sections: a titled container holding cards, link cards, stickies, text or more sections ──
  // Built like a FigJam board: size from content outward, white cards inside tinted containers,
  // one grid per container with even gaps, a real heading. Words are measured after they render.
  // One quiet palette for everything the AI makes (Apple-like: white cards on soft system tints)
  const TINT: Record<string, string> = alias(TINTH as any);
  const SEC = { padX: 40, padTop: 40, padBottom: 40, headGap: 24, gap: 32, subGap: 8, title: TYPE.heading, sub: TYPE.small };
  type N = { kind: string; id?: string; parts?: { id: string; dx: number; dy: number }[]; w: number; h: number; spec: any; kids?: N[]; head?: { title?: string; sub?: string; tw: number; th: number } };
  const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  // surface text (canvas) renders with the blocksuite font name, DOM notes with Inter: measure each the way it is drawn
  const measure = (text: string, size: number, weight = 400, maxW = 1e9, surface = false) => {
    const c = document.createElement('canvas').getContext('2d')!; c.font = surface ? `${weight} ${size}px "blocksuite:surface:Inter"` : `${weight} ${size}px Inter, "PingFang SC", "Noto Sans SC", sans-serif`;
    let lines = 0, widest = 0;
    for (const para of String(text).split('\n')) {
      let line = '', n = 1;
      for (const ch of para.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+\s*|\s+/g) ?? ['']) {
        const t = line + ch;
        if (c.measureText(t).width > maxW && line) { widest = Math.max(widest, c.measureText(line).width); line = ch.trimStart(); n++; } else line = t;
      }
      widest = Math.max(widest, c.measureText(line).width); lines += n;
    }
    return { w: Math.ceil(widest * 1.08) + 4, h: Math.ceil(lines * size * 1.35) };
  };
  // break lines ourselves (measured with Inter, a little wider than the canvas draws) so the height is exact
  const wrapLines = (text: string, size: number, weight: number, maxW: number) => {
    const c = document.createElement('canvas').getContext('2d')!; c.font = `${weight} ${size}px Inter, sans-serif`;
    const out: string[] = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const ch of para.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+\s*|\s+/g) ?? ['']) {
        if (c.measureText(line + ch).width > maxW && line.trim()) { out.push(line.trimEnd()); line = ch.trimStart(); } else line += ch;
      }
      out.push(line.trimEnd());
    }
    return out;
  };
  const stickySize = (() => { const st = reading.items.filter(i => i.kind === 'sticky').map(i => i.box.w).sort((a, b) => a - b); return st.length ? st[st.length >> 1] : 184; })();
  const P = (text: string, attrs?: any) => new Text(attrs ? [{ insert: text, attributes: attrs }] as any : text);

  // Build where the user is looking: AFFiNE only renders notes inside the viewport, and a note that is not
  // rendered keeps its placeholder height, so cards built off-screen were laid out too short (they then
  // overflowed their sections). Everything is moved to its real place right after.
  const STAGE = (() => { const vb = gfx.viewport.viewportBounds; return { x: Math.round(vb.x + vb.w * 0.3), y: Math.round(vb.y + vb.h * 0.3) }; })();
  // items inside a section can be named, so a later line or badge can point at them
  async function buildItem(it: any, links: Map<string, any>): Promise<N | null> {
    const n = await buildItem0(it, links);
    if (n?.id && it?.name) named.set(String(it.name), { id: n.id, box: { x: 0, y: 0, w: n.w, h: n.h } });
    return n;
  }
  async function buildItem0(it: any, links: Map<string, any>): Promise<N | null> {
    const k = it.kind ?? (it.url ? 'link' : it.items ? 'section' : it.title ? 'card' : 'sticky');
    if (k === 'section') return buildSection(it, links);
    if (k === 'sticky') {
      const t = new Y.Text(); t.insert(0, String(it.text ?? it.title ?? ''));
      const id = addEl({ type: 'shape', shapeType: 'rect', xywh: xywh({ x: 0, y: 0, w: stickySize, h: stickySize }), radius: 0.04, filled: true,
        fillColor: fillOf(it.colour) ?? STICKY.yellow, strokeColor: 'transparent', strokeWidth: 0, color: TEXT.ink, fontSize: fitSize(stickySize, String(it.text ?? it.title ?? '')), fontFamily: 'blocksuite:surface:Inter',
        textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [16, 16], shadow: SHADOW.sticky, text: t });
      created.push(id); return { kind: k, id, w: stickySize, h: stickySize, spec: it };
    }
    if (k === 'summary') { it = { ...it, title: it.title ?? '', body: it.body ?? it.text }; }
    if (k === 'text') {
      // on the shared type scale: caption 12 · small 14 · body 16 · title 20 · heading 28
      const size = it.px ?? (it.size === 'large' ? TYPE.title : it.size === 'small' ? TYPE.small : TYPE.body);
      const weight = it.bold || size >= TYPE.title ? 700 : 400;
      const m = measure(it.text ?? '', size, weight, it.width ?? 440);
      const t = new Y.Text(); t.insert(0, String(it.text ?? ''));
      const id = addEl({ type: 'text', xywh: xywh({ x: 0, y: 0, w: m.w, h: m.h }), text: t, color: it.muted ? TEXT.muted : TEXT.ink, fontSize: size, fontWeight: String(weight), fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', hasMaxWidth: true });
      created.push(id); return { kind: k, id, w: m.w, h: m.h, spec: it };
    }
    if (k === 'image' && it.url) {
      try {
        const blob = await (await fetch(it.url)).blob(); if (!blob.type.startsWith('image/')) throw 0;
        const sourceId = await store.blobSync.set(blob);
        const bmp = await createImageBitmap(blob); const w = 300, h = Math.round(300 * bmp.height / bmp.width);
        const id = store.addBlock('affine:image', { sourceId, xywh: xywh({ ...STAGE, w, h }), width: bmp.width, height: bmp.height, caption: it.caption ?? null, index: nextTop() } as any, surf.id);
        created.push(id); return { kind: k, id, w, h, spec: it };
      } catch { errors.push(`image: could not load ${it.url}`); return null; }
    }
    if (k === 'link' && it.url && links.get(it.url)?.image) {
      const pv = links.get(it.url);
      const desc = [it.meta ?? it.source, it.note ?? it.description ?? pv.description].filter(Boolean).join('\n') || null;
      rememberLink(it.url, { title: it.title ?? pv.title, description: desc });
      const id = store.addBlock('affine:bookmark', { url: it.url, style: 'vertical', title: it.title ?? pv.title ?? null, description: desc,
        image: pv.image, icon: pv.icon ?? null, xywh: xywh({ ...STAGE, w: 300, h: 330 }), index: nextTop() } as any, surf.id);
      created.push(id); return { kind: k, id, w: 300, h: 330, spec: it };
    }
    if (k === 'panel') return buildPanel(it);
    // an existing thing of the user's, moved into this section (regrouping, sorting, clustering)
    if (k === 'ref') {
      const id = idOf(it.ref); const el: any = id && gfx.getElementById(id);
      if (!el) { errors.push(`section: unknown ${it.ref}`); return null; }
      containers.add(it.ref);
      return { kind: 'ref', id, w: el.elementBound.w, h: el.elementBound.h, spec: it };
    }
    const noteCard = (w: number) => store.addBlock('affine:note', { xywh: xywh({ ...STAGE, w, h: 80 }), background: '#ffffff', index: nextTop(),
      edgeless: { style: CARD_STYLE } } as any, store.root.id);
    const gray = { color: 'var(--affine-text-secondary-color)' };
    if (k === 'metric') {      // a number that matters: label, big value, change, one line of context
      const mw = it._unit ?? (it.wide ? 300 : 220);
      const id = noteCard(mw);
      if (it.label) store.addBlock('affine:paragraph', { text: P(String(it.label), gray) }, id);
      store.addBlock('affine:paragraph', { type: 'h1', text: P(String(it.value ?? '')) }, id);
      if (it.delta) store.addBlock('affine:paragraph', { text: P(String(it.delta), { color: /^[-−↓]/.test(String(it.delta)) ? 'var(--affine-text-highlight-foreground-red)' : 'var(--affine-text-highlight-foreground-green)' }) }, id);
      if (it.note ?? it.body) store.addBlock('affine:paragraph', { text: P(String(it.note ?? it.body), gray) }, id);
      created.push(id); return { kind: 'card', id, w: mw, h: 80, spec: it };
    }
    if (k === 'quote') {       // a voice: the words, then who said it
      const id = noteCard(it.wide ? 420 : 300);
      store.addBlock('affine:paragraph', { type: 'quote', text: P(String(it.text ?? it.body ?? '')) }, id);
      if (it.who ?? it.meta) store.addBlock('affine:paragraph', { text: P(String(it.who ?? it.meta), gray) }, id);
      created.push(id); return { kind: 'card', id, w: it.wide ? 420 : 300, h: 80, spec: it };
    }
    if (k === 'persona') {     // a person: name, role, what matters to them
      const id = noteCard(300);
      store.addBlock('affine:paragraph', { type: 'h5', text: P(String(it.name ?? it.title ?? '')) }, id);
      if (it.role ?? it.meta) store.addBlock('affine:paragraph', { text: P(String(it.role ?? it.meta), gray) }, id);
      for (const line of String(it.body ?? '').split('\n').filter(Boolean)) {
        const li = line.match(/^[-•]\s+(.*)$/);
        store.addBlock(li ? 'affine:list' : 'affine:paragraph', li ? { type: 'bulleted', text: P(li[1]) } : { text: P(line) }, id);
      }
      if (Array.isArray(it.tags) && it.tags.length) store.addBlock('affine:paragraph', { text: P(it.tags.map((t: string) => '#' + t).join('   '), gray) }, id);
      created.push(id); return { kind: 'card', id, w: 300, h: 80, spec: it };
    }
    if (k === 'checklist') {   // next steps people can tick
      const id = noteCard(it.wide ? 420 : 300);
      if (it.title) store.addBlock('affine:paragraph', { type: 'h6', text: P(String(it.title)) }, id);
      for (const t of (it.items ?? String(it.body ?? '').split('\n')).filter(Boolean)) store.addBlock('affine:list', { type: 'todo', checked: false, text: P(String(t).replace(/^[-•]\s+/, '')) }, id);
      created.push(id); return { kind: 'card', id, w: it.wide ? 420 : 300, h: 80, spec: it };
    }
    // card (also a link card without a picture): a white note with meta, title, body
    const w = it.kind === 'summary' || it.span === 'full' ? (it._fullW ?? 632) : it.wide ? 420 : 300;
    const id = store.addBlock('affine:note', { xywh: xywh({ ...STAGE, w, h: 80 }), background: '#ffffff', index: nextTop(),
      edgeless: { style: CARD_STYLE } } as any, store.root.id);
    const meta = it.meta ?? it.source ?? (it.url ? domain(it.url) : '');
    if (meta) store.addBlock('affine:paragraph', { text: P(String(meta), { color: 'var(--affine-text-secondary-color)' }) }, id);
    const title = it.title ?? it.text ?? '';
    if (title) store.addBlock('affine:paragraph', { type: 'h6', text: P(String(title), it.url ? { link: it.url } : undefined) }, id);
    const body = it.body ?? it.note ?? it.description;
    if (body) for (const line of String(body).split('\n')) {
      const li = line.match(/^[-•]\s+(.*)$/);
      store.addBlock(li ? 'affine:list' : 'affine:paragraph', li ? { type: 'bulleted', text: P(li[1]) } : { text: P(line) }, id);
    }
    const tags = [...(Array.isArray(it.tags) ? it.tags : []), ...(it.tag ? [it.tag] : [])];
    if (tags.length) store.addBlock('affine:paragraph', { text: P(tags.map((t: string) => '#' + String(t).replace(/^#/, '')).join('   '), { color: 'var(--affine-text-secondary-color)' }) }, id);
    created.push(id); return { kind: it.kind === 'summary' || it.span === 'full' ? 'full' : 'card', id, w, h: 80, spec: it };
  }

  // Panel: the FigJam card that holds a topic. tint = soft fill + hue border; outline = white + hue
  // border; dashed = an open column to fill in. Title 20 semibold, text 15 gray at 1.5 line height.
  function buildPanel(it: any): N {
    const hue = base(it.colour ?? 'blue'), style = it.style ?? 'tint';
    const fill = style === 'dashed' ? 'transparent' : style === 'outline' ? '#ffffff' : (TINT[hue] ?? TINT.blue);
    const stroke = style === 'dashed' ? '#c7c7cc' : (STICKY[hue] ?? STICKY.blue);
    const W = it.wide ? 440 : it.width ?? 320, pad = 32, inner = W - pad * 2;
    const parts: { id: string; dx: number; dy: number }[] = [];
    const txt = (s0: string, size: number, weight: number, colour: string, dy: number, lh = 1.5) => {
      const ls = wrapLines(s0, size, weight, inner - 4); const h = Math.ceil(ls.length * size * 1.25);
      const t = new Y.Text(); t.insert(0, ls.join('\n'));
      const id = addEl({ type: 'text', xywh: xywh({ x: 0, y: 0, w: inner, h }), text: t, color: colour, fontSize: size, fontWeight: String(weight), fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' });
      parts.push({ id, dx: pad, dy }); created.push(id); return h;
    };
    const box = addEl({ type: 'shape', shapeType: 'rect', radius: 0.05, xywh: xywh({ x: 0, y: 0, w: W, h: 100 }), filled: style !== 'dashed', fillColor: fill,
      strokeColor: stroke, strokeWidth: style === 'dashed' ? 2 : 1, strokeStyle: style === 'dashed' ? 'dash' : 'solid', text: new Y.Text() });
    created.push(box); parts.unshift({ id: box, dx: 0, dy: 0 });
    let y = pad;
    if (it.title) y += txt(String(it.title), TYPE.title, 600, TEXT.ink, y, 1.3) + (it.subtitle ? 4 : 14);
    if (it.subtitle) y += txt(String(it.subtitle), TYPE.caption + 1, 400, TEXT.muted, y, 1.4) + 14;
    if (Array.isArray(it.items) && it.items.length && typeof it.items[0] === 'object') {
      it.items.forEach((p: any, i: number) => {
        y += txt(String(p.title ?? ''), TYPE.body, 600, TEXT.ink, y, 1.35) + 4;
        if (p.text) y += txt(String(p.text), TYPE.small + 1, 400, '#6e6e73', y, 1.5);
        if (i < it.items.length - 1) y += 20;
      });
    } else {
      // bullets: one line each, with a hanging indent so wrapped lines sit under the words, not the dot
      const raw: string[] = Array.isArray(it.items) ? it.items.map(String) : String(it.body ?? it.text ?? '').split('\n').filter((l: string) => l.trim());
      const bulleted = Array.isArray(it.items) || raw.every(l => /^[-•]\s+/.test(l));
      raw.forEach((l, i) => {
        const line = l.replace(/^[-•]\s+/, '');
        if (bulleted) {
          const dot = new Y.Text(); dot.insert(0, '•');
          const did = addEl({ type: 'text', xywh: xywh({ x: 0, y: 0, w: 10, h: 22 }), text: dot, color: '#aeaeb2', fontSize: TYPE.small + 1, fontFamily: 'blocksuite:surface:Inter' });
          parts.push({ id: did, dx: pad, dy: y }); created.push(did);
          const ls = wrapLines(line, TYPE.small + 1, 400, inner - 20); const h = Math.ceil(ls.length * (TYPE.small + 1) * 1.25);
          const t = new Y.Text(); t.insert(0, ls.join('\n'));
          const id = addEl({ type: 'text', xywh: xywh({ x: 0, y: 0, w: inner - 16, h }), text: t, color: '#6e6e73', fontSize: TYPE.small + 1, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' });
          parts.push({ id, dx: pad + 16, dy: y }); created.push(id); y += h + (i < raw.length - 1 ? 8 : 0);
        } else y += txt(line, TYPE.small + 1, 400, '#6e6e73', y, 1.5) + (i < raw.length - 1 ? 8 : 0);
      });
    }
    const H = y + pad;
    const el: any = gfx.getElementById(box); if (el) surf.updateElement(box, { xywh: xywh({ x: 0, y: 0, w: W, h: H }) });
    return { kind: 'panel', id: box, parts, w: W, h: H, spec: it };
  }

  async function buildSection(spec: any, links: Map<string, any>): Promise<N> {
    const kids: N[] = [];
    const regular = (spec.items ?? []).filter((it: any) => it.kind !== 'summary' && it.span !== 'full');
    const cols = spec.layout === 'column' ? 1 : spec.layout === 'row' ? Math.max(1, regular.length) : Math.max(1, Math.min(regular.length, spec.cols ?? (regular.length <= 4 ? regular.length : regular.length <= 6 ? 3 : 4)));
    const unit = regular.some((it: any) => it.kind === 'section') ? 0 : regular.some((it: any) => it.kind === 'sticky') ? stickySize : 300;
    const fullW = unit ? cols * unit + (cols - 1) * SEC.gap : 632;
    const allMetrics = regular.length > 0 && regular.every((it: any) => it.kind === 'metric');
    for (const it of spec.items ?? []) {
      const spec2 = it.kind === 'summary' || it.span === 'full' ? { ...it, _fullW: fullW } : it.kind === 'metric' && !allMetrics ? { ...it, _unit: 300 } : it;
      const n = await buildItem(spec2, links); if (n) kids.push(n);
    }
    const title = spec.title ? String(spec.title) : undefined, sub = spec.subtitle ? String(spec.subtitle) : undefined;
    const ts = spec.hero ? 48 : SEC.title, ss = spec.hero ? TYPE.title : SEC.sub;
    const tm = title ? measure(title, ts, 600) : { w: 0, h: 0 }, sm = sub ? measure(sub, ss, 400, 720) : { w: 0, h: 0 };
    return { kind: 'section', w: 0, h: 0, spec, kids, head: { title, sub, tw: Math.max(tm.w, sm.w), th: tm.h + (sub ? SEC.subGap + sm.h : 0) } };
  }

  // real sizes, after the words have rendered
  function sizeOf(n: N) {
    if (n.kind === 'section') { layoutSection(n); return; }
    if (n.parts) return;   // panels know their size
    const el: any = n.id && gfx.getElementById(n.id); if (el) { n.w = el.elementBound.w; n.h = el.elementBound.h; }
  }
  type Pos = Map<N, { x: number; y: number }>;
  const pos: Pos = new Map();
  function layoutSection(n: N) {
    const kids = n.kids!; kids.forEach(sizeOf);
    const sp = n.spec;
    const regular = kids.filter(k => k.kind !== 'full'), cnt = regular.length;
    const cols = sp.layout === 'column' ? 1 : sp.layout === 'row' ? Math.max(1, cnt) : Math.max(1, Math.min(cnt, sp.cols ?? (cnt <= 4 ? cnt : cnt <= 6 ? 3 : 4)));
    // bare: no box, no padding, a tight stack (a card with the notes stuck under it)
    const S = sp.bare ? { ...SEC, padX: 0, padTop: 0, padBottom: 0 } : SEC;
    // A column of rows that share their columns (a journey map, a blueprint, swim lanes) is one table: the row
    // names sit in a narrow column on the left, every row uses the same column widths, rows sit close together.
    const laneKids = (k: N) => (k.kids ?? []).filter(c => c.kind !== 'full');
    const lanes = !sp.bare && kids.length >= 2 && kids.every(k => k.kind === 'section' && !k.spec.bare && laneKids(k).length >= 2 && laneKids(k).length <= 6 && laneKids(k).length === (k.kids ?? []).length && !(k.kids ?? []).some(c => c.kind === 'section'))
      && new Set(kids.map(k => laneKids(k).length)).size <= 2 && sp.layout !== 'row' && (sp.cols ?? 1) === 1 || false;
    if (lanes) {
      const LP = 16, n2 = Math.max(...kids.map(k => laneKids(k).length));
      const cw: number[] = []; for (const k of kids) laneKids(k).forEach((c, i) => (cw[i] = Math.max(cw[i] ?? 0, c.w)));
      const labelW = Math.min(168, Math.max(96, ...kids.map(k => measure(k.head?.title ?? '', 14, 600, 150).w + 8)));
      const gw = cw.slice(0, n2).reduce((a2, b2) => a2 + b2, 0) + 16 * (n2 - 1);
      for (const k of kids) {
        const hh = Math.max(...laneKids(k).map(c => c.h), measure(k.head?.title ?? '', 14, 600, labelW).h);
        let x = LP + labelW + 16;
        laneKids(k).forEach((c, i) => { pos.set(c, { x, y: LP }); x += cw[i] + 16; });
        k.w = LP + labelW + 16 + gw + LP; k.h = LP + hh + LP; k.spec._lane = { labelW };
      }
    }
    const gap = lanes ? 8 : sp.bare ? (sp.gap ?? 12) : kids.some(k => k.kind === 'section') ? SEC.gap + 16 : SEC.gap;
    // rows: a full-width item is its own row; regular items fill rows of `cols`
    const rows: N[][] = []; let cur: N[] = [];
    for (const k of kids) {
      if (k.kind === 'full') { if (cur.length) rows.push(cur); rows.push([k]); cur = []; continue; }
      cur.push(k); if (cur.length === cols) { rows.push(cur); cur = []; }
    }
    if (cur.length) rows.push(cur);
    const colW: number[] = [];
    rows.forEach(r => { if (r[0].kind !== 'full') r.forEach((k, c) => (colW[c] = Math.max(colW[c] ?? 0, k.w))); });
    const gridW = colW.reduce((a, b) => a + b, 0) + gap * Math.max(0, colW.length - 1);
    const rowH = rows.map(r => Math.max(...r.map(k => k.h)));
    // equal card heights within a row (FigJam reflow rule)
    rows.forEach((r, ri) => r.forEach(k => { if (k.kind === 'panel') { k.h = rowH[ri]; return; } if ((k.kind === 'card') && k.id) { const el: any = gfx.getElementById(k.id); if (el && el.elementBound.h < rowH[ri] - 1) { const b = el.elementBound; store.updateBlock(el, { xywh: xywh({ x: b.x, y: b.y, w: b.w, h: rowH[ri] }), edgeless: { ...el.props.edgeless, collapse: true, collapsedHeight: rowH[ri] } }); k.h = rowH[ri]; } } }));
    rows.forEach((r, ri) => r.forEach((k, c) => {
      if (k.kind !== 'section') return;
      k.h = rowH[ri];                                   // same height across a row
      if (cols === 1) k.w = Math.max(colW[0] ?? k.w, gridW);   // same width down a column
      else k.w = colW[c];
    }));
    const contentW = Math.max(gridW, ...kids.filter(k => k.kind === 'full').map(k => k.w));
    const headH = n.head!.th ? n.head!.th + SEC.headGap : 0;
    const top = S.padTop + headH;
    let y = top;
    rows.forEach((r, ri) => {
      let x = S.padX;
      r.forEach((k, c) => { pos.set(k, { x, y }); x += (k.kind === 'full' ? k.w : colW[c]) + gap; });
      y += rowH[ri] + gap;
    });
    const contentH = rowH.reduce((a, b) => a + b, 0) + gap * Math.max(0, rowH.length - 1);
    n.w = Math.max(contentW, n.head!.tw) + S.padX * 2;
    n.h = top + contentH + S.padBottom;
  }
  // absolute positions; frames and headings are made last so they sit behind / above correctly
  const tintOf = (n: N, depth: number) => TINT[base(n.spec.colour ?? (depth ? 'gray' : 'white'))] ?? TINT.white;
  function commit(n: N, x: number, y: number, depth: number, parentTint = '#f5f5f5'): string[] {
    const ids: string[] = [];
    for (const k of n.kids!) {
      const p = pos.get(k)!; const ax = x + p.x, ay = y + p.y;
      if (k.kind === 'section') ids.push(...commit(k, ax, ay, depth + 1, tintOf(n, depth)));
      else if (k.parts) {
        for (const pt of k.parts) { const el: any = gfx.getElementById(pt.id); if (!el) continue; const b = el.elementBound;
          const w = pt.id === k.id ? k.w : b.w, h = pt.id === k.id ? k.h : b.h;   // the panel's box follows its row height
          setBox(pt.id, { x: ax + pt.dx, y: ay + pt.dy, w, h }); ids.push(pt.id); }
      }
      else if (k.id) { const el: any = gfx.getElementById(k.id); if (el) setBox(k.id, { x: ax, y: ay, w: el.elementBound.w, h: el.elementBound.h }); ids.push(k.id); }
    }
    if (n.spec.bare) return ids;       // no frame, no heading: its things sit directly in the parent
    const hd = n.head!;
    if (n.spec._lane && hd.title) {
      const lw = n.spec._lane.labelW, m = measure(hd.title, 14, 600, lw); const t = new Y.Text(); t.insert(0, hd.title);
      const tid = addEl({ type: 'text', xywh: xywh({ x: x + 16, y: y + 16, w: lw, h: m.h }), text: t, color: '#3a3a3c', fontSize: 14, fontWeight: '600', fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', hasMaxWidth: true });
      created.push(tid); ids.push(tid);
    } else
    if (hd.title) {
      const t = new Y.Text(); t.insert(0, hd.title);
      const ts = n.spec.hero ? 48 : depth ? 22 : SEC.title;
      const tid = addEl({ type: 'text', xywh: xywh({ x: x + SEC.padX, y: y + SEC.padTop, w: measure(hd.title, ts, 700).w, h: Math.ceil(ts * 1.35) }),
        text: t, color: '#1e1e1e', fontSize: ts, fontWeight: n.spec.hero ? '600' : '700', fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' });
      created.push(tid); ids.push(tid);
    }
    if (hd.sub && !n.spec._lane) {
      const avail = Math.max(240, n.w - SEC.padX * 2);
      const m = measure(hd.sub, n.spec.hero ? TYPE.title : SEC.sub, 400, avail); const t = new Y.Text(); t.insert(0, hd.sub);
      const sid = addEl({ type: 'text', xywh: xywh({ x: x + SEC.padX, y: y + SEC.padTop + Math.ceil((n.spec.hero ? 48 : SEC.title) * 1.35) + SEC.subGap, w: Math.min(avail, Math.max(m.w, 120)), h: m.h }),
        text: t, color: n.spec.hero ? TEXT.body : '#8a8984', fontSize: n.spec.hero ? TYPE.title : SEC.sub, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', hasMaxWidth: true });
      created.push(sid); ids.push(sid);
    }
    if (/purple|violet/i.test(String(n.spec.colour ?? ''))) n.spec.colour = 'gray';
    let tint = TINT[base(n.spec.colour ?? (depth ? 'gray' : 'white'))] ?? (n.spec.colour?.startsWith?.('#') ? n.spec.colour : TINT.white);
    if (tint === parentTint) tint = parentTint === TINT.white ? TINT.gray : TINT.white;
    const fid = store.addBlock('affine:frame', { xywh: xywh({ x, y, w: snap(n.w), h: snap(n.h) }), title: new Text(''), background: tint,
      childElementIds: Object.fromEntries(ids.map(i => [i, true])), index: gfx.layer.generateIndex(true) } as any, surf.id);
    created.push(fid);
    return [fid, ...ids];
  }

  async function section(a: Action) {
    // pictures for links first (in parallel, a few seconds at most)
    const urls: string[] = [];
    const walk = (s: any) => (s.items ?? []).forEach((it: any) => { if (it.url && (it.kind ?? 'link') === 'link') urls.push(it.url); if (it.items) walk(it); });
    walk(a);
    const links = new Map<string, any>();
    await Promise.all(urls.map(async u => {
      const given = findSpec(a, u);
      const pv = given?.image ? { image: given.image } : await Promise.race([lookup(u), new Promise<any>(r => setTimeout(() => r({}), 4000))]);
      links.set(u, pv); rememberLink(u, { title: given?.title, description: given?.note ?? given?.description, image: pv.image ?? null, icon: pv.icon ?? null });
    }));
    // all link cards in one section look the same: with pictures only if every one has one
    const allPics = urls.length > 0 && urls.every(u => links.get(u)?.image);
    if (!allPics) for (const u of urls) links.set(u, { ...links.get(u), image: null });
    const root = await buildSection(a, links);
    // notes take a few frames to reach their real height (lists, tags, long words): wait until they stop changing
    { const noteIds: string[] = []; const walkN = (n: N) => { if (n.id) noteIds.push(n.id); n.parts?.forEach(pt => noteIds.push(pt.id)); n.kids?.forEach(walkN); }; walkN(root);
      let last = '', same = 0;
      for (let k = 0; k < 60 && same < 4; k++) { await frame2(); const sig = noteIds.map(id => Math.round((gfx.getElementById(id) as any)?.elementBound?.h ?? 0)).join(','); same = sig === last ? same + 1 : 0; last = sig; } }
    layoutSection(root);
    // into an existing frame: grow it to hold the new section
    const inFrame = a.place?.in && item(a.place.in);
    const box = place(a.place, root.w, root.h, anchorOf(a) ?? reading.selection[0]);
    const ids = commit(root, box.x, box.y, 0);
    newBoxes.push(box);
    if (inFrame) {
      const fe: any = gfx.getElementById(inFrame.id);
      if (fe) {
        const b = fe.elementBound; const u = union([b, { x: box.x - 40, y: box.y - 40, w: box.w + 80, h: box.h + 80 }]);
        store.updateBlock(fe, { xywh: xywh(u), childElementIds: { ...(fe.props.childElementIds ?? {}), [ids[0]]: true } });
        changed.add(fe.id);
      }
    }
    if (a.name) named.set(a.name, { id: ids[0], box });
  }
  const findSpec = (s: any, url: string): any => { for (const it of s.items ?? []) { if (it.url === url) return it; if (it.items) { const f = findSpec(it, url); if (f) return f; } } return null; };

  // Diagram (architecture, flow, system map): FigJam gives each role a shape and a hue and keeps lines
  // thin and gray with their labels on the line. Layers run in the direction of the arrows.
  const ROLE: Record<string, { shape: string; radius: number; hue: string; outline?: boolean; w: number; h: number }> = {
    client: { shape: 'rect', radius: 0.35, hue: 'green', w: 200, h: 96 },
    service: { shape: 'rect', radius: 0.04, hue: 'violet', w: 200, h: 96 },
    database: { shape: 'rect', radius: 0.3, hue: 'blue', w: 200, h: 112 },
    queue: { shape: 'rect', radius: 0.3, hue: 'teal', w: 200, h: 96 },
    external: { shape: 'rect', radius: 0.04, hue: 'gray', outline: true, w: 200, h: 96 },
    decision: { shape: 'diamond', radius: 0, hue: 'yellow', outline: true, w: 168, h: 168 },
    actor: { shape: 'ellipse', radius: 0, hue: 'orange', w: 144, h: 144 },
    step: { shape: 'rect', radius: 0.12, hue: 'white', outline: true, w: 200, h: 96 },
    start: { shape: 'rect', radius: 0.5, hue: 'green', w: 168, h: 72 },
    end: { shape: 'rect', radius: 0.5, hue: 'red', w: 168, h: 72 },
  };
  async function diagram(a: Action) {
    const nodes: any[] = a.nodes ?? [], edges: any[] = a.edges ?? [];
    if (!nodes.length) return;
    const down = a.direction === 'down';
    // layers: longest path from the sources (back edges ignored)
    const layer = new Map<string, number>(); nodes.forEach(n => layer.set(n.id, 0));
    const order = new Map(nodes.map((n, i) => [n.id, i]));
    for (let pass = 0; pass < nodes.length; pass++) for (const e of edges) {
      if ((order.get(e.to) ?? 0) <= (order.get(e.from) ?? 0)) continue;   // a loop back (e.g. "no → try again") does not push layers
      const lf = layer.get(e.from), lt = layer.get(e.to); if (lf == null || lt == null) continue;
      if (lt < lf + 1 && lf + 1 < nodes.length) layer.set(e.to, lf + 1);
    }
    const layers: any[][] = []; for (const n of nodes) (layers[layer.get(n.id)!] ??= []).push(n);
    for (let i = layers.length - 1; i >= 0; i--) if (!layers[i]) layers.splice(i, 1);
    // keep zones together inside a layer
    layers.forEach(l => l.sort((p, q) => String(p.zone ?? '').localeCompare(String(q.zone ?? ''))));
    const GAPL = 168, GAPN = 48;
    const sizeOfN = (n: any) => ROLE[n.role ?? n.kind ?? 'step'] ?? ROLE.step;
    const layerSpan = layers.map(l => Math.max(...l.map(n => down ? sizeOfN(n).h : sizeOfN(n).w)));
    const layerLen = layers.map(l => l.reduce((s0, n) => s0 + (down ? sizeOfN(n).w : sizeOfN(n).h), 0) + GAPN * (l.length - 1));
    const maxLen = Math.max(...layerLen);
    const titleH = a.title ? 72 : 0, pad = 48;
    const W = down ? maxLen : layerSpan.reduce((s0, v) => s0 + v, 0) + GAPL * (layers.length - 1);
    const H = down ? layerSpan.reduce((s0, v) => s0 + v, 0) + GAPL * (layers.length - 1) : maxLen;
    const keyH = a.key ? 56 : 0;
    const box = place(a.place, W + pad * 2, H + pad * 2 + titleH + keyH, anchorOf(a) ?? reading.selection[0]);
    const origin = { x: box.x + pad, y: box.y + pad + titleH };
    const pos = new Map<string, Box>();
    let along = 0;
    layers.forEach((l, li) => {
      let off = (maxLen - layerLen[li]) / 2;
      for (const n of l) {
        const r = sizeOfN(n);
        const x = down ? origin.x + off : origin.x + along + (layerSpan[li] - r.w) / 2;
        const y = down ? origin.y + along + (layerSpan[li] - r.h) / 2 : origin.y + off;
        pos.set(n.id, { x: snap(x), y: snap(y), w: r.w, h: r.h });
        off += (down ? r.w : r.h) + GAPN;
      }
      along += layerSpan[li] + GAPL;
    });
    const ids: string[] = [];
    // zones first, underneath
    for (const z of a.zones ?? []) {
      const members = nodes.filter(n => n.zone === z.id).map(n => pos.get(n.id)!).filter(Boolean);
      if (!members.length) continue;
      const u = union(members), zp = 32;
      const zb = { x: u.x - zp, y: u.y - zp - 32, w: u.w + zp * 2, h: u.h + zp * 2 + 32 };
      const zid = addEl({ type: 'shape', shapeType: 'rect', radius: 0.04, xywh: xywh(zb), filled: true, fillColor: TINT[base(z.colour ?? 'gray')] ?? TINT.gray, strokeWidth: 0, strokeColor: 'transparent', text: new Y.Text() });
      created.push(zid); ids.push(zid);
      if (z.title) { const t = new Y.Text(); t.insert(0, String(z.title)); const tid = addEl({ type: 'text', xywh: xywh({ x: zb.x + 16, y: zb.y + 12, w: textWidth(String(z.title), TYPE.small) + 8, h: 20 }), text: t, color: TEXT.muted, fontSize: TYPE.small, fontWeight: '600', fontFamily: 'blocksuite:surface:Inter' }); created.push(tid); ids.push(tid); }
    }
    const idOfNode = new Map<string, string>();
    for (const n of nodes) {
      const r = sizeOfN(n), b = pos.get(n.id)!;
      const hue = base(n.colour ?? r.hue);
      const t = new Y.Text(); t.insert(0, String(n.label ?? n.id));
      const id = addEl({ type: 'shape', shapeType: r.shape, radius: r.radius, xywh: xywh(b), filled: true,
        fillColor: r.outline ? '#ffffff' : (STICKY[hue] ? mixHex(STICKY[hue], 0.45) : '#ffffff'), strokeColor: r.outline ? (hue === 'white' || hue === 'gray' ? '#3a3a3c' : INK[hue]) : (INK[hue] ?? '#3a3a3c'), strokeWidth: r.outline ? 2 : 1,
        color: TEXT.ink, fontSize: r.shape === 'diamond' ? TYPE.small : TYPE.body, fontWeight: '500', fontFamily: 'blocksuite:surface:Inter',
        textAlign: 'center', textHorizontalAlign: 'center', textVerticalAlign: 'center', padding: [10, 14], text: t });
      created.push(id); ids.push(id); idOfNode.set(n.id, id); named.set(n.id, { id, box: b });
    }
    await frame2();
    for (const e of edges) {
      if (!idOfNode.has(e.from) || !idOfNode.has(e.to)) continue;
      const back = (order.get(e.to) ?? 0) <= (order.get(e.from) ?? 0);   // loops back arc away instead of running over the forward line
      const cid = connect({ do: 'connect', from: e.from, to: e.to, label: e.label, dashed: e.dashed || e.style === 'dashed', both: e.both, curve: back });
      if (cid) ids.push(cid);
    }
    if (a.title) { const t = new Y.Text(); t.insert(0, String(a.title)); const tid = addEl({ type: 'text', xywh: xywh({ x: box.x + pad, y: box.y + pad - 8, w: textWidth(String(a.title), TYPE.heading) * 1.1 + 8, h: 40 }), text: t, color: TEXT.ink, fontSize: TYPE.heading, fontWeight: '700', fontFamily: 'blocksuite:surface:Inter' }); created.push(tid); ids.push(tid); }
    if (a.key) { const t = new Y.Text(); t.insert(0, String(a.key)); const tid = addEl({ type: 'text', xywh: xywh({ x: box.x + pad, y: box.y + box.h - pad - 20, w: Math.min(box.w - pad * 2, textWidth(String(a.key), TYPE.small) + 8), h: 20 }), text: t, color: TEXT.muted, fontSize: TYPE.small, fontFamily: 'blocksuite:surface:Inter', hasMaxWidth: true }); created.push(tid); ids.push(tid); }
    const fid = store.addBlock('affine:frame', { xywh: xywh(box), title: new Text(''), background: '#ffffff', childElementIds: Object.fromEntries(ids.map(i => [i, true])), index: gfx.layer.generateIndex(true) } as any, surf.id);
    created.push(fid); newBoxes.push(box);
    if (a.name) named.set(a.name, { id: fid, box });
  }
  const mixHex = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16); return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join(''); };

  // Matrix: four panels on two axes, axis names outside the grid (FigJam's quadrant board)
  async function matrix(a: Action) {
    const cells: any[] = a.cells ?? []; if (!cells.length) return;
    const hues = ['blue', 'violet', 'green', 'orange'];
    await section({ do: 'section', name: a.name, title: a.title, subtitle: a.subtitle ?? (a.x && a.y ? `Across: ${a.x[0]} → ${a.x[1]}   ·   Down: ${a.y[1]} → ${a.y[0]}` : undefined), hero: a.hero, colour: 'white', cols: 2, place: a.place,
      items: cells.map((c, i) => ({ kind: 'panel', title: c.title, subtitle: c.subtitle, items: c.items, body: c.body, colour: c.colour ?? hues[i % 4], width: 400 })) });
  }

  // ── Run ───────────────────────────────────────────────────────────────────────────────
  for (const a of answer.actions ?? []) {
    try {
      switch (a.do) {
        case 'add':
          if (a.kind === 'sticky') addSticky(a);
          else if (a.kind === 'text') addText(a);
          else if (a.kind === 'doc') addDoc(a);
          else if (a.kind === 'shape') addShape(a);
          else if (a.kind === 'frame') addFrame(a, a.contains ?? [], a.text ?? a.title ?? '');
          else addSticky(a);
          break;
        case 'write': write(a); break;
        case 'fill': fill(a); break;
        case 'highlight': highlight(a); break;
        case 'recolour': case 'recolor': recolour(a); break;
        case 'move': move(a); break;
        case 'arrange': arrange(a); break;
        case 'tidy': await tidy(a); break;
        case 'connect': connect(a); break;
        case 'ref': connect({ ...a, dashed: a.dashed ?? true, curve: a.curve ?? true }); break;
        case 'pair': pair(a); break;
        case 'frame': addFrame(a, a.refs ?? [], a.title ?? ''); break;
        case 'note': note(a); break;
        case 'legend': legend(a); break;
        case 'section': await section(a); break;
        case 'tag': tag(a); break;
        case 'diagram': await diagram(a); break;
        case 'matrix': await matrix(a); break;
        case 'vote': vote(a); break;
        case 'number': number(a); break;
        case 'plot': plot(a); break;
        case 'milestone': milestone(a); break;
        case 'branch': branch(a); break;
        case 'curve': curve(a); break;
        case 'circle': circle(a); break;
        case 'funnel': funnel(a); break;
        case 'bars': bars(a); break;
        case 'journey': journey(a); break;
        case 'cluster': {
          // the clusters take the place the loose notes occupied (they are moving anyway)
          const all = (a.groups ?? []).flatMap((g: any) => g.refs ?? []).map((r: string) => boxOfRef(r)).filter(Boolean) as Box[];
          const u = all.length ? union(all) : null;
          await section({ do: 'section', name: a.name, title: a.title, subtitle: a.subtitle, colour: 'white', layout: 'row', place: a.place ?? (u ? { at: [u.x, u.y] } : undefined),
          items: (a.groups ?? []).map((g: any, i: number) => ({ kind: 'section', title: g.title, colour: g.colour ?? ['yellow', 'blue', 'green', 'purple', 'orange', 'teal'][i % 6], layout: 'grid', cols: g.cols ?? 2, items: (g.refs ?? []).map((r: string) => ({ kind: 'ref', ref: r })) })) });
          break;
        }
        default: errors.push(`unknown part "${a.do}"`);
      }
    } catch (e: any) { errors.push(`${a.do}: ${e?.message ?? e}`); }
  }
  markAi(store, created);
  const touched = [...created, ...changed].map(id => gfx.getElementById(id)).filter(Boolean).map((e: any) => ({ ...e.elementBound }));
  // one key for every colour the answer used as a mark (unless the answer drew its own legend)
  if (keyEntries.size && !legendDrawn && keyBoxes.length) { try { key([...keyEntries].map(([colour, label]) => ({ colour, label })), union(keyBoxes)); } catch (e: any) { errors.push('key: ' + e?.message); } }
  return { created, changed: [...changed].filter(id => !created.includes(id)), errors, box: touched.length ? union(touched) : null };
}
