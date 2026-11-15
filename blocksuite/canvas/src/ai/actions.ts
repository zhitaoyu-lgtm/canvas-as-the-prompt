// Executes the model's answer on the board.
// The model says what and roughly where ("after s4", "in f1", "like s2"); this file decides exact
// positions, sizes and colours from the user's own layout, so additions sit in their structure.

import { TableDataManager } from '@blocksuite/affine/blocks/table';
import { Text } from '@blocksuite/affine/store';
import * as Y from 'yjs';

import { markAi } from './provenance';
import type { Box, Item, Reading } from './reading';

export type Place = {
  after?: string; before?: string; below?: string; above?: string; right?: string; left?: string;
  slot?: string; n?: number; in?: string; near?: string; at?: [number, number];
};
export type Action = { do: string; [k: string]: any };
export type Answer = { read?: string; say?: string; actions: Action[] };
export type Result = { created: string[]; changed: string[]; errors: string[]; box: Box | null };

// ── Colours ─────────────────────────────────────────────────────────────────────────────
const STICKY: Record<string, string> = {
  white: '#ffffff', gray: '#e6e6e6', grey: '#e6e6e6', red: '#ffafa3', orange: '#ffd3a8', yellow: '#ffe299',
  green: '#b3efbd', teal: '#b3f4ef', blue: '#a8daff', purple: '#d3bdff', violet: '#d3bdff', pink: '#ffa8db',
};
const INK: Record<string, string> = {
  black: '#1e1e1e', gray: '#8a8984', grey: '#8a8984', red: '#f24822', orange: '#ff9e42', yellow: '#ffc943',
  green: '#66d575', teal: '#3dc3b8', blue: '#3dadff', purple: '#874fff', violet: '#874fff', pink: '#ff7ad9', white: '#ffffff',
};
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

export function execute(rootEl: any, reading: Reading, answer: Answer): Result {
  const gfx = rootEl.gfx, std = rootEl.std, store = std.store, surf = gfx.surface;
  const created: string[] = [], changed = new Set<string>(), errors: string[] = [];
  const named = new Map<string, { id: string; box: Box; like?: Item }>();
  const newBoxes: Box[] = [];

  // what is used where: the user's own hex for a colour name wins over the default palette
  const userHex = new Map<string, string>();
  for (const c of reading.colours) if (c.hex?.length) userHex.set(base(c.colour), c.hex[0]);
  const fillOf = (c?: string) => !c ? undefined : c.startsWith('#') ? c : userHex.get(base(c)) ?? STICKY[base(c)] ?? STICKY.yellow;
  const inkOf = (c?: string) => !c ? undefined : c.startsWith('#') ? c : INK[base(c)] ?? INK.black;

  const item = (ref?: string): Item | undefined => (ref ? reading.byRef.get(ref) : undefined);
  const boxOfRef = (ref?: string): Box | undefined => {
    if (!ref) return;
    const n = named.get(ref); if (n) return n.box;
    const it = item(ref); if (it) { const el = gfx.getElementById(it.id); return el ? { ...el.elementBound } : it.box; }
    const g = reading.groups.find(g => g.ref === ref); if (g) return g.box;
    return undefined;
  };
  const idOf = (ref?: string) => (ref ? named.get(ref)?.id ?? item(ref)?.id : undefined);
  const groupOfRef = (ref: string) => reading.groups.find(g => g.ref === reading.groupOf.get(ref));

  // obstacles: everything except containers (frames, groups, loops) and lines
  const containers = new Set(reading.items.filter(i => i.children?.length || i.kind === 'frame' || i.kind === 'group').map(i => i.ref));
  const obstacles = () => [
    ...reading.items.filter(i => !containers.has(i.ref) && i.kind !== 'connector').map(i => boxOfRef(i.ref)!),
    ...newBoxes,
  ];
  const free = (b: Box, ignore?: Box) => !obstacles().some(o => o !== ignore && overlaps(b, o));

  function place(p: Place | undefined, w: number, h: number, fallbackRef?: string): Box {
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
        case 'right': return { x: from.x + from.w + gap, y: from.y + (from.h - h) / 2, w, h };
        case 'left': return { x: from.x - gap - w, y: from.y + (from.h - h) / 2, w, h };
        case 'below': return { x: from.x + (from.w - w) / 2, y: from.y + from.h + gap, w, h };
        default: return { x: from.x + (from.w - w) / 2, y: from.y - gap - h, w, h };
      }
    };
    const walk = (anchor: Box, dir: string, gap: number, strict = true) => {
      let b = step(anchor, dir, gap);
      for (let i = 0; i < 30 && !free(b); i++) {
        // beside something (not continuing a line): don't wander far; try the other sides first
        if (!strict && i === 1) for (const d of ['below', 'right', 'above', 'left']) { const c = step(anchor, d, gap); if (free(c)) return c; }
        b = step(b, dir, gap);
      }
      return b;
    };
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
        return walk({ x: f.x, y: f.y + f.h, w: f.w, h: 0 }, 'below', 24);
      }
    }
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
    const w = like?.kind === 'sticky' ? like.box.w : s, h = like?.kind === 'sticky' ? like.box.h : s;
    const box = place(a.place, w, h, anchorOf(a));
    const fill = fillOf(a.colour) ?? (likeEl?.fillColor && typeof likeEl.fillColor === 'string' ? likeEl.fillColor : STICKY.yellow);
    const t = new Y.Text(); t.insert(0, String(a.text ?? ''));
    const copy = (k: string, d: any) => (likeEl && likeEl[k] !== undefined ? likeEl[k] : d);
    const id = surf.addElement({
      type: 'shape', shapeType: 'rect', xywh: xywh(box), radius: copy('radius', 0.04), filled: true, fillColor: fill,
      strokeColor: 'transparent', strokeWidth: 0, color: copy('color', '#1e1e1e'), fontSize: copy('fontSize', 16),
      fontFamily: copy('fontFamily', 'blocksuite:surface:Inter'), fontWeight: copy('fontWeight', '400'),
      textAlign: copy('textAlign', 'left'), textHorizontalAlign: copy('textHorizontalAlign', 'left'), textVerticalAlign: copy('textVerticalAlign', 'top'),
      padding: copy('padding', [16, 16]), shadow: copy('shadow', { blur: 12, offsetX: 0, offsetY: 4, color: 'rgba(0,0,0,0.12)' }), text: t,
    });
    remember(a, id, box, like);
  }
  function addShape(a: Action) {
    const like = item(a.like); const likeEl = like && gfx.getElementById(like.id);
    const w = like ? like.box.w : 160, h = like ? like.box.h : 100;
    const box = place(a.place, w, h, anchorOf(a));
    const t = new Y.Text(); t.insert(0, String(a.text ?? ''));
    const id = surf.addElement({
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
    const id = surf.addElement({
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
    const noteId = store.addBlock('affine:note', { xywh: xywh(box), background: '#ffffff', index: gfx.layer.generateIndex(true) } as any, store.root.id);
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
      childElementIds: Object.fromEntries(ids.map(i => [i, true])), index: gfx.layer.generateIndex(false),
    } as any, surf.id);
    created.push(id); if (a.name) named.set(a.name, { id, box });
  }
  function connect(a: Action) {
    const from = idOf(a.from), to = idOf(a.to);
    if (!from || !to) { errors.push(`connect: unknown ${!from ? a.from : a.to}`); return; }
    // match an existing line's look if the user has one
    const sample = reading.items.find(i => i.kind === 'connector' && i.author === 'user');
    const sEl = sample && gfx.getElementById(sample.id);
    const props: any = {
      type: 'connector', source: { id: from }, target: { id: to },
      stroke: sEl?.stroke ?? '#1e1e1e', strokeWidth: sEl?.strokeWidth ?? 2, mode: sEl?.mode ?? 1,
      rearEndpointStyle: a.arrow === false ? 'None' : sEl?.rearEndpointStyle ?? 'Arrow', frontEndpointStyle: sEl?.frontEndpointStyle ?? 'None',
    };
    if (a.label) { const t = new Y.Text(); t.insert(0, String(a.label)); props.text = t; props.labelDisplay = true; }
    const id = surf.addElement(props);
    created.push(id);
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
    const u = union(boxes);
    // the moved things should not block their own new place
    const saved = reading.items.filter(i => refs.includes(i.ref));
    saved.forEach(i => containers.add(i.ref));
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
  function legend(a: Action) {
    const entries: { colour: string; label: string }[] = a.entries ?? [];
    if (!entries.length) return;
    const size = 13, chipH = 28, gap = 8;
    const widths = entries.map(e => textWidth(e.label, size) + 34);
    const total = widths.reduce((s, w) => s + w, 0) + gap * (entries.length - 1);
    const box = place(a.place, total, chipH, Object.keys(a.place ?? {}).length ? undefined : reading.selection[0]);
    const ids: string[] = [];
    let x = box.x;
    entries.forEach((e, i) => {
      const c = base(e.colour);
      const hl = getComputedStyle(document.documentElement).getPropertyValue(`--affine-text-highlight-${HL.includes(c) ? c : 'yellow'}`).trim();
      // a legend for highlights uses the highlight colour; for stickies, the user's sticky colour
      const isMark = reading.items.some(i => i.marks?.some(m => base(m.colour) === c));
      const dot = (isMark && hl && /^#|rgb/.test(hl) ? hl : undefined) ?? userHex.get(c) ?? fillOf(e.colour)!;
      const pill = surf.addElement({ type: 'shape', shapeType: 'rect', radius: 0.5, xywh: xywh({ x, y: box.y, w: widths[i], h: chipH }), filled: true, fillColor: '#ffffff', strokeColor: '#e3e2dd', strokeWidth: 1, text: new Y.Text() });
      const d = surf.addElement({ type: 'shape', shapeType: 'ellipse', xywh: xywh({ x: x + 12, y: box.y + 9, w: 10, h: 10 }), filled: true, fillColor: dot, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() });
      const t = new Y.Text(); t.insert(0, e.label);
      const lbl = surf.addElement({ type: 'text', xywh: xywh({ x: x + 28, y: box.y + 5, w: widths[i] - 34, h: 18 }), text: t, color: '#2a2926', fontSize: size, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' });
      ids.push(pill, d, lbl); x += widths[i] + gap;
    });
    const gid = surf.addElement({ type: 'group', children: Object.fromEntries(ids.map(i => [i, true])), title: new Y.Text('Legend') });
    created.push(...ids, gid); newBoxes.push(box);
    if (a.name) named.set(a.name, { id: gid, box });
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
        case 'connect': connect(a); break;
        case 'frame': addFrame(a, a.refs ?? [], a.title ?? ''); break;
        case 'note': note(a); break;
        case 'legend': legend(a); break;
        default: errors.push(`unknown part "${a.do}"`);
      }
    } catch (e: any) { errors.push(`${a.do}: ${e?.message ?? e}`); }
  }
  markAi(store, created);
  const touched = [...created, ...changed].map(id => gfx.getElementById(id)).filter(Boolean).map((e: any) => ({ ...e.elementBound }));
  return { created, changed: [...changed].filter(id => !created.includes(id)), errors, box: touched.length ? union(touched) : null };
}
