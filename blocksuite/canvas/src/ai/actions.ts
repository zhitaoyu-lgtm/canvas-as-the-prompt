// Executes the model's answer on the board.
// The model says what and roughly where ("after s4", "in f1", "like s2"); this file decides exact
// positions, sizes and colours from the user's own layout, so additions sit in their structure.

import { TableDataManager } from '@blocksuite/affine/blocks/table';
import { Text } from '@blocksuite/affine/store';
import * as Y from 'yjs';

import { lookup, remember as rememberLink } from './links';
import { markAi } from './provenance';
import type { Box, Item, Reading } from './reading';

export type Place = {
  after?: string; before?: string; below?: string; above?: string; right?: string; left?: string;
  slot?: string; n?: number; in?: string; near?: string; at?: [number, number];
  cell?: string; row?: number; col?: number;
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

export async function execute(rootEl: any, reading: Reading, answer: Answer): Promise<Result> {
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
    const st = reading.structures.find(x => x.ref === ref); if (st) return st.box;
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
        case 'right': return { x: from.x + from.w + gap, y: h <= from.h ? from.y + (from.h - h) / 2 : from.y, w, h };
        case 'left': return { x: from.x - gap - w, y: h <= from.h ? from.y + (from.h - h) / 2 : from.y, w, h };
        case 'below': return { x: w <= from.w ? from.x + (from.w - w) / 2 : from.x, y: from.y + from.h + gap, w, h };
        default: return { x: w <= from.w ? from.x + (from.w - w) / 2 : from.x, y: from.y - gap - h, w, h };
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
    let w = like?.kind === 'sticky' ? like.box.w : s, h = like?.kind === 'sticky' ? like.box.h : s;
    if (a.place?.cell) { const c = cellOf(a.place); if (c) { const fit = Math.min(184, Math.floor((c.w - 32 - 12) / 2), c.h - 32); if (fit >= 96) { w = h = fit; } } [w, h] = fitCell(a.place, w, h); }
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
    const noteId = store.addBlock('affine:note', { xywh: xywh(box), background: '#ffffff', index: gfx.layer.generateIndex(false) } as any, store.root.id);
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
  // Tags: small quiet pills inside a thing's bottom edge. On a coloured thing the pill is white (one
  // accent is enough); on a white thing it is soft gray. The tag's own colour is only a small dot.
  // Pills keep a 12px inset from every edge and wrap upward into a new row when a row is full.
  const DOT: Record<string, string> = { red: '#ff3b30', orange: '#ff9500', yellow: '#ffcc00', green: '#34c759', teal: '#30b0c7', blue: '#007aff', purple: '#af52de', violet: '#af52de', pink: '#ff2d55', gray: '#8e8e93', grey: '#8e8e93' };
  const tagRows = new Map<string, { x: number; row: number }>();
  function tag(a: Action) {
    const refs: string[] = a.refs ?? (a.ref ? [a.ref] : a.on ? [a.on] : []);
    for (const ref of refs) {
      const b = boxOfRef(ref); const host = item(ref) ?? named.get(ref)?.like;
      if (!b) { errors.push(`tag: unknown ${ref}`); continue; }
      const hostEl: any = idOf(ref) && gfx.getElementById(idOf(ref)!);
      const hostFill = String(hostEl?.fillColor ?? hostEl?.props?.background ?? '#ffffff').toLowerCase();
      const onWhite = hostFill === '#ffffff' || hostFill === 'white' || hostFill.startsWith('--') || host?.kind === 'doc' || host?.kind === 'card';
      const label = String(a.text ?? a.label ?? '').trim(); if (!label) continue;
      const size = 11, h = 22, inset = 12, gapX = 6, gapY = 6;
      const c = a.colour ? base(a.colour) : '';
      const dot = DOT[c];
      const w = Math.ceil(textWidth(label, size)) + (dot ? 28 : 20);
      const st = tagRows.get(ref) ?? { x: 0, row: 0 };
      if (st.x && st.x + w > b.w - inset * 2) { st.x = 0; st.row++; }
      if (w > b.w - inset * 2) { errors.push(`tag: "${label}" is wider than ${ref}`); continue; }
      const x = b.x + inset + st.x, y = b.y + b.h - inset - h - st.row * (h + gapY);
      st.x += w + gapX; tagRows.set(ref, st);
      const pill = surf.addElement({ type: 'shape', shapeType: 'rect', radius: 0.5, xywh: xywh({ x, y, w, h }), filled: true,
        fillColor: onWhite ? '#f2f2f7' : '#ffffff', strokeColor: 'transparent', strokeWidth: 0,
        shadow: onWhite ? undefined : { blur: 2, offsetX: 0, offsetY: 1, color: 'rgba(0,0,0,0.06)' }, text: new Y.Text() });
      const ids = [pill];
      if (dot) ids.push(surf.addElement({ type: 'shape', shapeType: 'ellipse', xywh: xywh({ x: x + 9, y: y + 8, w: 6, h: 6 }), filled: true, fillColor: dot, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() }));
      const t = new Y.Text(); t.insert(0, label);
      ids.push(surf.addElement({ type: 'text', xywh: xywh({ x: x + (dot ? 20 : 10), y: y + 4, w: w - (dot ? 28 : 20), h: 14 }), text: t, color: '#3a3a3c', fontSize: size, fontWeight: '500', fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' }));
      const gid = surf.addElement({ type: 'group', children: Object.fromEntries(ids.map(i => [i, true])), title: new Y.Text(label) });
      created.push(...ids, gid);
    }
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
      const lbl = surf.addElement({ type: 'text', xywh: xywh({ x: x + 28, y: box.y + 5, w: widths[i] - 34, h: 18 }), text: t, color: '#3a3a3c', fontSize: size, fontWeight: '500', fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' });
      ids.push(pill, d, lbl); x += widths[i] + gap;
    });
    const gid = surf.addElement({ type: 'group', children: Object.fromEntries(ids.map(i => [i, true])), title: new Y.Text('Legend') });
    created.push(...ids, gid); newBoxes.push(box);
    if (a.name) named.set(a.name, { id: gid, box });
  }


  // ── Sections: a titled container holding cards, link cards, stickies, text or more sections ──
  // Built like a FigJam board: size from content outward, white cards inside tinted containers,
  // one grid per container with even gaps, a real heading. Words are measured after they render.
  // One quiet palette for everything the AI makes (Apple-like: white cards on soft system tints)
  const TINT: Record<string, string> = {
    white: '#ffffff', gray: '#f2f2f7', grey: '#f2f2f7', blue: '#eaf2ff', teal: '#e6f6f5', green: '#e8f7ec',
    yellow: '#fff6dc', orange: '#fff0e0', red: '#ffecea', pink: '#fdebf4', purple: '#f1edfd', violet: '#f1edfd',
  };
  const SEC = { padX: 40, padTop: 36, padBottom: 44, headGap: 24, gap: 32, subGap: 6, title: 28, sub: 15 };
  type N = { kind: string; id?: string; w: number; h: number; spec: any; kids?: N[]; head?: { title?: string; sub?: string; tw: number; th: number } };
  const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const measure = (text: string, size: number, weight = 400, maxW = 1e9) => {
    const c = document.createElement('canvas').getContext('2d')!; c.font = `${weight} ${size}px Inter, "PingFang SC", "Noto Sans SC", sans-serif`;
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
  const stickySize = (() => { const st = reading.items.filter(i => i.kind === 'sticky').map(i => i.box.w).sort((a, b) => a - b); return st.length ? st[st.length >> 1] : 184; })();
  const P = (text: string, attrs?: any) => new Text(attrs ? [{ insert: text, attributes: attrs }] as any : text);

  async function buildItem(it: any, links: Map<string, any>): Promise<N | null> {
    const k = it.kind ?? (it.url ? 'link' : it.items ? 'section' : it.title ? 'card' : 'sticky');
    if (k === 'section') return buildSection(it, links);
    if (k === 'sticky') {
      const t = new Y.Text(); t.insert(0, String(it.text ?? it.title ?? ''));
      const id = surf.addElement({ type: 'shape', shapeType: 'rect', xywh: xywh({ x: 0, y: 0, w: stickySize, h: stickySize }), radius: 0.04, filled: true,
        fillColor: fillOf(it.colour) ?? STICKY.yellow, strokeColor: 'transparent', strokeWidth: 0, color: '#1e1e1e', fontSize: 16, fontFamily: 'blocksuite:surface:Inter',
        textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [16, 16], shadow: { blur: 12, offsetX: 0, offsetY: 4, color: 'rgba(0,0,0,0.12)' }, text: t });
      created.push(id); return { kind: k, id, w: stickySize, h: stickySize, spec: it };
    }
    if (k === 'summary') { it = { ...it, title: it.title ?? '', body: it.body ?? it.text }; }
    if (k === 'text') {
      const size = it.size === 'large' ? 22 : 15; const m = measure(it.text ?? '', size, 400, 440);
      const t = new Y.Text(); t.insert(0, String(it.text ?? ''));
      const id = surf.addElement({ type: 'text', xywh: xywh({ x: 0, y: 0, w: m.w, h: m.h }), text: t, color: '#2a2926', fontSize: size, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', hasMaxWidth: true });
      created.push(id); return { kind: k, id, w: m.w, h: m.h, spec: it };
    }
    if (k === 'image' && it.url) {
      try {
        const blob = await (await fetch(it.url)).blob(); if (!blob.type.startsWith('image/')) throw 0;
        const sourceId = await store.blobSync.set(blob);
        const bmp = await createImageBitmap(blob); const w = 300, h = Math.round(300 * bmp.height / bmp.width);
        const id = store.addBlock('affine:image', { sourceId, xywh: xywh({ x: 0, y: 0, w, h }), width: bmp.width, height: bmp.height, caption: it.caption ?? null, index: gfx.layer.generateIndex(false) } as any, surf.id);
        created.push(id); return { kind: k, id, w, h, spec: it };
      } catch { errors.push(`image: could not load ${it.url}`); return null; }
    }
    if (k === 'link' && it.url && links.get(it.url)?.image) {
      const pv = links.get(it.url);
      const desc = [it.meta ?? it.source, it.note ?? it.description ?? pv.description].filter(Boolean).join('\n') || null;
      rememberLink(it.url, { title: it.title ?? pv.title, description: desc });
      const id = store.addBlock('affine:bookmark', { url: it.url, style: 'vertical', title: it.title ?? pv.title ?? null, description: desc,
        image: pv.image, icon: pv.icon ?? null, xywh: xywh({ x: 0, y: 0, w: 300, h: 330 }), index: gfx.layer.generateIndex(false) } as any, surf.id);
      created.push(id); return { kind: k, id, w: 300, h: 330, spec: it };
    }
    // card (also a link card without a picture): a white note with meta, title, body
    const w = it.kind === 'summary' || it.span === 'full' ? (it._fullW ?? 632) : it.wide ? 420 : 300;
    const id = store.addBlock('affine:note', { xywh: xywh({ x: 0, y: 0, w, h: 80 }), background: '#ffffff', index: gfx.layer.generateIndex(false),
      edgeless: { style: { borderRadius: 16, borderSize: 0, borderStyle: 'none', shadowType: '--affine-note-shadow-box' } } } as any, store.root.id);
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

  async function buildSection(spec: any, links: Map<string, any>): Promise<N> {
    const kids: N[] = [];
    const regular = (spec.items ?? []).filter((it: any) => it.kind !== 'summary' && it.span !== 'full');
    const cols = spec.layout === 'column' ? 1 : spec.layout === 'row' ? Math.max(1, regular.length) : Math.max(1, Math.min(regular.length, spec.cols ?? (regular.length <= 4 ? regular.length : regular.length <= 6 ? 3 : 4)));
    const unit = regular.some((it: any) => it.kind === 'section') ? 0 : regular.some((it: any) => it.kind === 'sticky') ? stickySize : 300;
    const fullW = unit ? cols * unit + (cols - 1) * SEC.gap : 632;
    for (const it of spec.items ?? []) { const n = await buildItem(it.kind === 'summary' || it.span === 'full' ? { ...it, _fullW: fullW } : it, links); if (n) kids.push(n); }
    const title = spec.title ? String(spec.title) : undefined, sub = spec.subtitle ? String(spec.subtitle) : undefined;
    const tm = title ? measure(title, SEC.title, 700) : { w: 0, h: 0 }, sm = sub ? measure(sub, SEC.sub, 400, 640) : { w: 0, h: 0 };
    return { kind: 'section', w: 0, h: 0, spec, kids, head: { title, sub, tw: Math.max(tm.w, sm.w), th: tm.h + (sub ? SEC.subGap + sm.h : 0) } };
  }

  // real sizes, after the words have rendered
  function sizeOf(n: N) {
    if (n.kind === 'section') { layoutSection(n); return; }
    const el: any = n.id && gfx.getElementById(n.id); if (el) { n.w = el.elementBound.w; n.h = el.elementBound.h; }
  }
  type Pos = Map<N, { x: number; y: number }>;
  const pos: Pos = new Map();
  function layoutSection(n: N) {
    const kids = n.kids!; kids.forEach(sizeOf);
    const sp = n.spec;
    const regular = kids.filter(k => k.kind !== 'full'), cnt = regular.length;
    const cols = sp.layout === 'column' ? 1 : sp.layout === 'row' ? Math.max(1, cnt) : Math.max(1, Math.min(cnt, sp.cols ?? (cnt <= 4 ? cnt : cnt <= 6 ? 3 : 4)));
    const gap = kids.some(k => k.kind === 'section') ? SEC.gap + 16 : SEC.gap;
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
    rows.forEach((r, ri) => r.forEach(k => { if ((k.kind === 'card') && k.id) { const el: any = gfx.getElementById(k.id); if (el && el.elementBound.h < rowH[ri] - 1) { const b = el.elementBound; store.updateBlock(el, { xywh: xywh({ x: b.x, y: b.y, w: b.w, h: rowH[ri] }), edgeless: { ...el.props.edgeless, collapse: true, collapsedHeight: rowH[ri] } }); k.h = rowH[ri]; } } }));
    const contentW = Math.max(gridW, ...kids.filter(k => k.kind === 'full').map(k => k.w));
    const headH = n.head!.th ? n.head!.th + SEC.headGap : 0;
    const top = SEC.padTop + headH;
    let y = top;
    rows.forEach((r, ri) => {
      let x = SEC.padX;
      r.forEach((k, c) => { pos.set(k, { x, y }); x += (k.kind === 'full' ? k.w : colW[c]) + gap; });
      y += rowH[ri] + gap;
    });
    const contentH = rowH.reduce((a, b) => a + b, 0) + gap * Math.max(0, rowH.length - 1);
    n.w = Math.max(contentW, n.head!.tw) + SEC.padX * 2;
    n.h = top + contentH + SEC.padBottom;
  }
  // absolute positions; frames and headings are made last so they sit behind / above correctly
  function commit(n: N, x: number, y: number, depth: number): string[] {
    const ids: string[] = [];
    for (const k of n.kids!) {
      const p = pos.get(k)!; const ax = x + p.x, ay = y + p.y;
      if (k.kind === 'section') ids.push(...commit(k, ax, ay, depth + 1));
      else if (k.id) { const el: any = gfx.getElementById(k.id); if (el) setBox(k.id, { x: ax, y: ay, w: el.elementBound.w, h: el.elementBound.h }); ids.push(k.id); }
    }
    const hd = n.head!;
    if (hd.title) {
      const t = new Y.Text(); t.insert(0, hd.title);
      const tid = surf.addElement({ type: 'text', xywh: xywh({ x: x + SEC.padX, y: y + SEC.padTop, w: measure(hd.title, SEC.title, 700).w, h: Math.ceil(SEC.title * 1.35) }),
        text: t, color: '#1e1e1e', fontSize: depth ? 22 : SEC.title, fontWeight: '700', fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' });
      created.push(tid); ids.push(tid);
    }
    if (hd.sub) {
      const m = measure(hd.sub, SEC.sub, 400, 640); const t = new Y.Text(); t.insert(0, hd.sub);
      const sid = surf.addElement({ type: 'text', xywh: xywh({ x: x + SEC.padX, y: y + SEC.padTop + Math.ceil(SEC.title * 1.35) + SEC.subGap, w: m.w, h: m.h }),
        text: t, color: '#8a8984', fontSize: SEC.sub, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', hasMaxWidth: true });
      created.push(sid); ids.push(sid);
    }
    const tint = TINT[base(n.spec.colour ?? (depth ? 'gray' : 'white'))] ?? (n.spec.colour?.startsWith?.('#') ? n.spec.colour : TINT.white);
    const fid = store.addBlock('affine:frame', { xywh: xywh({ x, y, w: n.w, h: n.h }), title: new Text(''), background: tint,
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
    await frame2(); await frame2();
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
        case 'section': await section(a); break;
        case 'tag': tag(a); break;
        default: errors.push(`unknown part "${a.do}"`);
      }
    } catch (e: any) { errors.push(`${a.do}: ${e?.message ?? e}`); }
  }
  markAi(store, created);
  const touched = [...created, ...changed].map(id => gfx.getElementById(id)).filter(Boolean).map((e: any) => ({ ...e.elementBound }));
  return { created, changed: [...changed].filter(id => !created.includes(id)), errors, box: touched.length ? union(touched) : null };
}
