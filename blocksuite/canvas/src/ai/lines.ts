// Drawn structures: tables, lanes, axes and charts that people draw with lines instead of
// building with a table block. A few straight lines (connectors, line tool, straight pen strokes)
// that run across each other split the space into columns, rows and cells — the reading layer
// names them so the model can say "put this in row 1, column 2" and code can put it there.

import type { Box, Item } from './reading';

export type Seg = { ref: string; id: string; a: [number, number]; b: [number, number]; dir: 'h' | 'v' | 'd'; arrow: 'none' | 'end' | 'start' | 'both'; dashed: boolean; len: number };
export type Cell = { row: number; col: number; box: Box; holds: string[] };
export type Structure = {
  ref: string;               // L1 …
  kind: 'chart' | 'table' | 'lanes' | 'columns' | 'rows' | 'lines';
  box: Box;
  segs: string[];            // refs of the lines it is made of
  cols: [number, number][];  // x ranges
  rows: [number, number][];  // y ranges
  axes?: { x?: { y: number; toward: 'right' | 'left' }; y?: { x: number; toward: 'up' | 'down' }; origin?: [number, number] };
  cells: Cell[];
  notes: string[];           // plain-language reading
};

/** Straight segments from free lines and straight pen strokes. */
export function segmentsOf(gfx: any, items: Item[]): Seg[] {
  const out: Seg[] = [];
  for (const it of items) {
    const e: any = gfx.getElementById(it.id); if (!e) continue;
    let pts: [number, number][] = [];
    let arrow: Seg['arrow'] = 'none', dashed = false;
    if (it.kind === 'connector') {
      if (e.source?.id && e.target?.id) continue;        // links between things are relations, not drawn structure
      const p = (e.absolutePath ?? []).map((q: any) => [q[0], q[1]]);
      if (p.length < 2) continue;
      pts = p;
      const front = e.frontEndpointStyle && e.frontEndpointStyle !== 'None', rear = e.rearEndpointStyle && e.rearEndpointStyle !== 'None';
      arrow = front && rear ? 'both' : rear ? 'end' : front ? 'start' : 'none';
      dashed = e.strokeStyle === 'dash';
    } else if (it.kind === 'drawing') {
      const b = e.elementBound; const raw = (e.points ?? []) as number[][];
      if (raw.length < 2) continue;
      pts = raw.map(q => [b.x + q[0], b.y + q[1]] as [number, number]);
      // straight enough?
      const [a, z] = [pts[0], pts[pts.length - 1]]; const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
      if (L < 40) continue;
      const dev = Math.max(...pts.map(p => Math.abs((z[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (z[1] - a[1])) / L));
      if (dev > Math.max(6, L * 0.04)) continue;
    } else continue;
    // an elbow connector can have several straight legs; read each long leg
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1]; const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy);
      if (len < 40) continue;
      const dir = Math.abs(dx) < len * 0.12 ? 'v' : Math.abs(dy) < len * 0.12 ? 'h' : 'd';
      const legArrow = pts.length === 2 ? arrow : (i === pts.length - 2 && (arrow === 'end' || arrow === 'both')) ? 'end' : (i === 0 && (arrow === 'start' || arrow === 'both')) ? 'start' : 'none';
      out.push({ ref: it.ref, id: it.id, a, b, dir, arrow: legArrow, dashed, len });
    }
  }
  return out;
}

const segBox = (s: Seg): Box => ({ x: Math.min(s.a[0], s.b[0]), y: Math.min(s.a[1], s.b[1]), w: Math.abs(s.b[0] - s.a[0]), h: Math.abs(s.b[1] - s.a[1]) });
const near = (a: Box, b: Box, m: number) => a.x <= b.x + b.w + m && b.x <= a.x + a.w + m && a.y <= b.y + b.h + m && b.y <= a.y + a.h + m;

export function structuresOf(segs: Seg[], items: Item[]): Structure[] {
  const hv = segs.filter(s => s.dir !== 'd');
  // lines that touch or cross belong to one structure
  const parent = hv.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < hv.length; i++) for (let j = i + 1; j < hv.length; j++) if (near(segBox(hv[i]), segBox(hv[j]), 24)) parent[find(i)] = find(j);
  // parallel lines side by side (lanes / columns) also belong together when they overlap along their length
  for (let i = 0; i < hv.length; i++) for (let j = i + 1; j < hv.length; j++) {
    const A = hv[i], B = hv[j]; if (A.dir !== B.dir) continue;
    const a = segBox(A), b = segBox(B);
    const overlap = A.dir === 'v' ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const dist = A.dir === 'v' ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
    // drawn as a set: nearly the same start and end (lanes, column rules), not just any two lines
    const [as, ae] = A.dir === 'v' ? [a.y, a.y + a.h] : [a.x, a.x + a.w], [bs, be] = B.dir === 'v' ? [b.y, b.y + b.h] : [b.x, b.x + b.w];
    const L = Math.max(A.len, B.len);
    if (overlap > Math.min(A.len, B.len) * 0.6 && Math.abs(as - bs) < L * 0.06 && Math.abs(ae - be) < L * 0.06 && dist < L * 1.2) parent[find(i)] = find(j);
  }
  const groups = new Map<number, Seg[]>();
  hv.forEach((s, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(s); });

  const out: Structure[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const bs = g.map(segBox);
    let x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
    const W = x1 - x0, H = y1 - y0;
    if (W < 80 && H < 80) continue;
    const V = g.filter(s => s.dir === 'v' && s.len >= H * 0.45), Hh = g.filter(s => s.dir === 'h' && s.len >= W * 0.45);
    // axes: an arrow pointing up/right (or down/left) from a shared corner
    const axes: Structure['axes'] = {};
    for (const s of V) if (s.arrow !== 'none') { const tip = s.arrow === 'end' ? s.b : s.a; const tail = s.arrow === 'end' ? s.a : s.b; axes.y = { x: Math.round(s.a[0]), toward: tip[1] < tail[1] ? 'up' : 'down' }; }
    for (const s of Hh) if (s.arrow !== 'none') { const tip = s.arrow === 'end' ? s.b : s.a; const tail = s.arrow === 'end' ? s.a : s.b; axes.x = { y: Math.round(s.a[1]), toward: tip[0] > tail[0] ? 'right' : 'left' }; }
    if (axes.x && axes.y) axes.origin = [axes.y.x, axes.x.y];
    const uniq = (xs: number[], tol: number) => xs.sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > tol);
    const xs = uniq([x0, x1, ...V.map(s => (s.a[0] + s.b[0]) / 2)], 24);
    const ys = uniq([y0, y1, ...Hh.map(s => (s.a[1] + s.b[1]) / 2)], 24);
    const cols = xs.slice(1).map((x, i) => [Math.round(xs[i]), Math.round(x)] as [number, number]).filter(([a, b]) => b - a > 40);
    const rows = ys.slice(1).map((y, i) => [Math.round(ys[i]), Math.round(y)] as [number, number]).filter(([a, b]) => b - a > 40);
    const cells: Cell[] = [];
    rows.forEach((r, ri) => cols.forEach((c, ci) => cells.push({ row: ri + 1, col: ci + 1, box: { x: c[0], y: r[0], w: c[1] - c[0], h: r[1] - r[0] }, holds: [] })));
    // what already sits in each cell (by centre)
    const segRefs = new Set(g.map(s => s.ref));
    for (const it of items) {
      if (segRefs.has(it.ref) || it.kind === 'connector' || it.kind === 'frame') continue;
      const cx = it.box.x + it.box.w / 2, cy = it.box.y + it.box.h / 2;
      const cell = cells.find(c => cx >= c.box.x && cx <= c.box.x + c.box.w && cy >= c.box.y && cy <= c.box.y + c.box.h);
      if (cell) cell.holds.push(it.ref);
    }
    const kind: Structure['kind'] = axes.x || axes.y ? 'chart' : cols.length > 1 && rows.length > 1 ? 'table' : cols.length > 1 ? 'columns' : rows.length > 1 ? 'rows' : 'lines';
    const notes: string[] = [];
    if (axes.y) notes.push(`vertical axis at x=${axes.y.x} pointing ${axes.y.toward}`);
    if (axes.x) notes.push(`horizontal axis at y=${axes.x.y} pointing ${axes.x.toward}`);
    const dividers = g.filter(s => s.dir === 'v' && s.arrow === 'none');
    if (dividers.length) notes.push(`${dividers.length} ${dividers.some(d => d.dashed) ? 'dashed ' : ''}vertical divider${dividers.length > 1 ? 's' : ''}`);
    const hdiv = g.filter(s => s.dir === 'h' && s.arrow === 'none');
    if (hdiv.length) notes.push(`${hdiv.length} ${hdiv.some(d => d.dashed) ? 'dashed ' : ''}horizontal divider${hdiv.length > 1 ? 's' : ''}`);
    if (axes.x && rows.length === 2) notes.push('the horizontal axis splits it into above (row 1) and below (row 2)');
    notes.push(...labelsOf(items, segRefs, { x: x0, y: y0, w: W, h: H }, cols, rows, g, axes));
    out.push({ ref: '', kind, box: { x: Math.round(x0), y: Math.round(y0), w: Math.round(W), h: Math.round(H) }, segs: [...segRefs], cols, rows, axes: Object.keys(axes).length ? axes : undefined, cells, notes });
  }
  out.push(...tiledTables(items));
  out.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x).forEach((s, i) => (s.ref = 'L' + (i + 1)));
  return out;
}

const words = (it: Item) => `${it.ref}${it.text ? ' "' + it.text.slice(0, 40).replace(/\n/g, ' ') + '"' : ''}`;
const isLabel = (it: Item) => ['text', 'sticky', 'shape', 'sticker'].includes(it.kind);

/** Column headers above, row labels to the left, axis labels at the arrow tips. */
function labelsOf(items: Item[], segRefs: Set<string>, b: Box, cols: [number, number][], rows: [number, number][], g: Seg[], axes: Structure['axes']): string[] {
  const out: string[] = [];
  const cands = items.filter(it => !segRefs.has(it.ref) && isLabel(it) && it.box.w < b.w * 0.6);
  const cx = (it: Item) => it.box.x + it.box.w / 2, cy = (it: Item) => it.box.y + it.box.h / 2;
  cols.forEach(([a, z], i) => {
    const h = cands.filter(it => cx(it) > a && cx(it) < z && it.box.y + it.box.h <= b.y + 8 && it.box.y + it.box.h >= b.y - 140);
    if (h.length) out.push(`col ${i + 1} headed by ${h.map(words).join(', ')}`);
  });
  rows.forEach(([a, z], i) => {
    const h = cands.filter(it => cy(it) > a && cy(it) < z && it.box.x + it.box.w <= b.x + 8 && it.box.x + it.box.w >= b.x - 200);
    if (h.length) out.push(`row ${i + 1} labelled by ${h.map(words).join(', ')}`);
  });
  const used = new Set(out.join(' ').match(/\b[a-z]+\d+\b/g) ?? []);
  for (const s of g) if (s.arrow !== 'none') {
    const tip = s.arrow === 'end' ? s.b : s.a;
    const near = cands.filter(it => !used.has(it.ref) && Math.hypot(cx(it) - tip[0], cy(it) - tip[1]) < 110 + Math.max(it.box.w, it.box.h) / 2);
    if (near.length) out.push(`${s.dir === 'v' ? 'vertical' : 'horizontal'} axis labelled by ${near.map(words).join(', ')}`);
  }
  void axes;
  return out;
}

/** Tables built from touching rectangles (a header row of boxes, a grid of cells). */
function tiledTables(items: Item[]): Structure[] {
  const rects = items.filter(it => it.kind === 'shape' && (it.shape === 'rect' || it.shape === 'rounded rect'));
  const touch = (a: Box, b: Box) => {
    const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    return (gx <= 8 && gx >= -4 && gy < -Math.min(a.h, b.h) * 0.6) || (gy <= 8 && gy >= -4 && gx < -Math.min(a.w, b.w) * 0.6);
  };
  const parent = rects.map((_, i) => i); const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (touch(rects[i].box, rects[j].box)) parent[find(i)] = find(j);
  const groups = new Map<number, Item[]>(); rects.forEach((r, i) => { const k = find(i); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); });
  const out: Structure[] = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    const xs = [...new Set(g.map(r => Math.round(r.box.x / 6)))].sort((a, b) => a - b).map(v => v * 6);
    const ys = [...new Set(g.map(r => Math.round(r.box.y / 6)))].sort((a, b) => a - b).map(v => v * 6);
    const colOf = (r: Item) => xs.findIndex(x => Math.abs(x - r.box.x) <= 6) + 1, rowOf = (r: Item) => ys.findIndex(y => Math.abs(y - r.box.y) <= 6) + 1;
    const x0 = Math.min(...g.map(r => r.box.x)), y0 = Math.min(...g.map(r => r.box.y));
    const x1 = Math.max(...g.map(r => r.box.x + r.box.w)), y1 = Math.max(...g.map(r => r.box.y + r.box.h));
    const cells: Cell[] = g.map(r => ({ row: rowOf(r), col: colOf(r), box: r.box, holds: [] as string[] }));
    for (const it of items) {
      if (g.includes(it) || it.kind === 'connector' || it.kind === 'frame') continue;
      const cx = it.box.x + it.box.w / 2, cy = it.box.y + it.box.h / 2;
      const c = cells.find(c => cx >= c.box.x && cx <= c.box.x + c.box.w && cy >= c.box.y && cy <= c.box.y + c.box.h);
      if (c) c.holds.push(it.ref);
    }
    const texts = g.filter(r => r.text).map(r => `row ${rowOf(r)} col ${colOf(r)} reads "${r.text.slice(0, 30)}"`);
    out.push({ ref: '', kind: 'table', box: { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }, segs: g.map(r => r.ref),
      cols: xs.map(x => [x, x] as [number, number]), rows: ys.map(y => [y, y] as [number, number]), cells,
      notes: ['built from touching boxes; each box is a cell', ...texts.slice(0, 24)] });
  }
  return out;
}

export function structuresPrompt(ss: Structure[]): string[] {
  if (!ss.length) return [];
  const L = ['', 'DRAWN STRUCTURES (tables, lanes, axes and charts drawn with lines; cells are places to put things)'];
  for (const s of ss) {
    L.push(`${s.ref} ${s.kind} @${s.box.x},${s.box.y} ${s.box.w}×${s.box.h} · made of ${s.segs.join(' ')}${s.notes.length ? '\n    ' + s.notes.join('\n    ') : ''}`);
    if (s.cols.every(c => c[0] === c[1])) L.push(`    ${s.rows.length} rows × ${s.cols.length} columns of boxes: ${s.cells.map(c => `r${c.row}c${c.col} @${Math.round(c.box.x)},${Math.round(c.box.y)} ${Math.round(c.box.w)}×${Math.round(c.box.h)}`).join(', ')}`);
    else {
      L.push(`    ${s.cols.length} column${s.cols.length > 1 ? 's' : ''} (left→right): ${s.cols.map((c, i) => `col ${i + 1} x${c[0]}–${c[1]}`).join(', ')}`);
      L.push(`    ${s.rows.length} row${s.rows.length > 1 ? 's' : ''} (top→bottom): ${s.rows.map((r, i) => `row ${i + 1} y${r[0]}–${r[1]}`).join(', ')}`);
    }
    const full = s.cells.filter(c => c.holds.length);
    L.push(`    cells: ${full.length ? full.map(c => `row ${c.row} col ${c.col} holds ${c.holds.join(' ')}`).join('; ') + '; others empty' : 'all empty'}`);
  }
  return L;
}
