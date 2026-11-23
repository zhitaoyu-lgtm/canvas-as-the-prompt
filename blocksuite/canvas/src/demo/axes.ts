// Sorting onto drawn axes (web). A line drawn with the mouse and named is read as an axis; what was selected
// with it is laid out along it. A second line across the first is a second dimension, read without words, because
// the board is now being sorted. A ring drawn round a stretch of an axis with a question gets an answer the width of
// that stretch, tied to it.
//
//   find …            (Ask AI at a spot, nothing selected)  → pictures gathered there as a loose pile
//   sort onto …       (a named line + things selected)      → the line made a clean axis with its scale, then the
//                                                              things moved onto it (each faded out and in again)
//   a line across it  (named at its ends, no words)         → a second clean axis; the things move up or down
//   a ring + "why …"  (on a stretch of the axis)            → a folded card as wide as the stretch, events marked
//   click on the card                                       → it opens in place; again, it folds
//
// What a thing's place is comes from, in order: what the scene knows of it (the filmed posters' years and how much
// they are type or image), a year or number in its own words, then Claude, asked with the axis' names. So the same
// works for sticky notes sorted by "effort", or quotes on "positive ↔ negative".
//
// The filmed part: the 33 posters, their years and type/image values, and the answer about 1937–1952 are written
// below; they are not the model's output. Everything else is computed from the board.

import POSTERS from '../assets/demo/posters/posters.json';
import { ask } from '../ai/model';

type Box = { x: number; y: number; w: number; h: number };
type Pt = [number, number];
const W = window as any;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const POSTER_SRC: Record<string, string> = Object.fromEntries(Object.entries((import.meta as any).glob('../assets/demo/posters/*.webp', { eager: true, import: 'default' })).map(([p, u]) => [p.split('/').pop()!.replace('.webp', ''), u as string]));
type Poster = { key: string; style: string; year: number; type: number; w: number; h: number; pile: { x: number; y: number; w: number; h: number; rot: number } };
const PDATA = POSTERS as Poster[];

type Axis = {
  id: string;                  // the clean line's id
  kind: 'time' | 'scale';
  dir: 'h' | 'v';
  a: Pt; b: Pt;                // where the scale starts and ends on the board (first and last tick)
  min: number; max: number;    // what those mean
  name: string; poles: [string, string];
  user: string[];              // what the user drew for it (kept, faded)
  made: string[];              // what the scene drew for it
  of?: string;                 // a second axis: the first one it crosses
  step?: number;               // a time axis' tick step
};
type Card = { parts?: string[]; id: string; axis: string; from: number; to: number; title: string; lines: string[]; source: string; open: boolean; y: number; up: boolean };
type State = { posters: Record<string, string>; axes: Axis[]; values: Record<string, Record<string, number>>; labels: Record<string, string>; cards: Card[]; items: Record<string, string[]> };

export function mountAxes(rootEl: any) {
  const gfx = rootEl.gfx, std = rootEl.std, store = std.store, surf = gfx.surface;
  const YText = () => W.cxDev?.Y;
  const els = () => gfx.gfxElements as any[];
  const byId = (id?: string | null) => (id ? (gfx.getElementById(id) as any) : null);
  const boxOf = (e: any): Box => { const b = e.elementBound; return { x: b.x, y: b.y, w: b.w, h: b.h }; };
  const mid = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];
  const near = (p: Pt, b: Box, pad = 0) => p[0] > b.x - pad && p[0] < b.x + b.w + pad && p[1] > b.y - pad && p[1] < b.y + b.h + pad;
  const unionBox = (bs: Box[]): Box => { const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  const deep = (m: any): string => { try { const own = m?.text?.toString?.() ?? m?.props?.text?.toString?.() ?? ''; return [own, ...((m?.children ?? []) as any[]).map(deep)].filter(Boolean).join(' '); } catch { return ''; } };
  const textOf = (e: any): string => { if (e?.flavour && e.flavour !== 'affine:image') { const t = deep(e).trim(); if (t) return t; } try { const t = e.text ?? e.props?.text; if (!t) return ''; if (typeof t === 'string') return t; if (t.toString) return String(t.toString()); if (t.yText) return String(t.yText.toString()); } catch { /* none */ } return ''; };
  const ptsOf = (e: any): Pt[] => {
    const b = boxOf(e);
    if (e.type === 'connector') { const p = (e.absolutePath ?? e.path ?? []) as any[]; if (p.length >= 2) return p.map((q: any) => [q[0] ?? q.x, q[1] ?? q.y] as Pt); return [[b.x, b.y], [b.x + b.w, b.y + b.h]]; }
    return ((e.points ?? []) as number[][]).map(q => [b.x + q[0], b.y + q[1]] as Pt);
  };
  const isText = (e: any) => e.type === 'text' || e.flavour === 'affine:edgeless-text';
  const remove = (id: string) => { try { const m = store.getBlock(id)?.model; if (m) { store.deleteBlock(m); return; } } catch { /* not a block */ } try { surf.deleteElement(id); } catch { /* gone */ } };

  const P: State = (() => { try { return { posters: {}, axes: [], values: {}, labels: {}, cards: [], items: {}, ...JSON.parse(localStorage.getItem('cx:axes') || '{}') }; } catch { return { posters: {}, axes: [], values: {}, labels: {}, cards: [], items: {} }; } })();
  const keep = () => { try { localStorage.setItem('cx:axes', JSON.stringify(P)); } catch { /* not kept */ } };
  const live = () => { P.axes = P.axes.filter(a => byId(a.id)); return P.axes; };
  const mine = new Set<string>();
  for (const a of P.axes) for (const i of a.made) mine.add(i);
  for (const i of Object.values(P.labels)) mine.add(i);

  // ── the world layer (board units), shared with the other scenes ──
  const layer = () => document.querySelector('.cx-rome') as HTMLElement | null;
  const lookAt = (b: Box) => W.cxRome?.lookAt?.(b);

  // ── drawing in the board's own quiet style ──
  const INK = '#3a3a3c', MUTED = '#8e8e93', FAINT = '#c7c7cc';
  const measure = document.createElement('canvas').getContext('2d')!;
  function line(a: Pt, b: Pt, o: { color?: string; w?: number; dash?: boolean; arrows?: 'none' | 'end' | 'both' } = {}) {
    const id = surf.addElement({ type: 'connector', mode: 0, source: { position: a }, target: { position: b }, stroke: o.color ?? INK, strokeWidth: o.w ?? 1.5, strokeStyle: o.dash ? 'dash' : 'solid', frontEndpointStyle: o.arrows === 'both' ? 'Arrow' : 'None', rearEndpointStyle: o.arrows === 'both' || o.arrows === 'end' ? 'Arrow' : 'None' }) as string;
    mine.add(id); return id;
  }
  function words(text: string, x: number, y: number, size: number, o: { color?: string; weight?: string; align?: 'left' | 'center' | 'right' } = {}) {
    const Y = YText(); if (!Y) return '';
    const weight = o.weight ?? '400', align = o.align ?? 'center';
    measure.font = `${weight} ${size}px Inter, sans-serif`; const w = Math.ceil(measure.measureText(text).width) + 6, h = Math.ceil(size * 1.4), t = new Y(); t.insert(0, text);
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const id = surf.addElement({ type: 'text', xywh: `[${x0},${y - h / 2},${w},${h}]`, text: t, fontSize: size, fontWeight: weight, color: o.color ?? MUTED, fontFamily: 'blocksuite:surface:Inter', textAlign: align }) as string;
    mine.add(id); return id;
  }
  const domOf = (id: string) => (document.querySelector(`[data-block-id="${id}"]`) as HTMLElement | null);
  async function fadeEl(id: string, from: number, to: number, ms: number) {
    const t0 = performance.now(); let el: HTMLElement | null = null;
    await new Promise<void>(done => { const step = (now: number) => { el = el ?? domOf(id); const t = Math.min(1, (now - t0) / ms), e = t * t * (3 - 2 * t); if (el) el.style.opacity = String(from + (to - from) * e); if (t < 1) requestAnimationFrame(step); else { if (el && to >= 1) el.style.opacity = ''; done(); } }; requestAnimationFrame(step); });
  }

  // one working mark (the prompt's own, when asked through it); one quiet bar for what was read
  function think(at: Pt) {
    if (document.querySelector('.cx-pend-dots.on')) return () => {};
    const d = document.createElement('div'); d.className = 'cx-sense-think cx-rome-think cx-char-think'; d.innerHTML = '<i></i><i></i><i></i><i></i>';
    d.style.left = `${at[0]}px`; d.style.top = `${at[1]}px`; d.style.transform = `scale(${Math.max(0.8, 1 / Math.max(0.2, gfx.viewport.zoom))})`; layer()?.append(d);
    return () => { d.classList.add('out'); setTimeout(() => d.remove(), 300); };
  }
  let bar: HTMLElement | null = null, barFor: Box | null = null, barRaf = 0;
  function say(text: string, at: Box, actions: { label: string; dark?: boolean; run: () => void }[] = [], ms = 0) {
    bar?.remove(); cancelAnimationFrame(barRaf);
    const b = document.createElement('div'); b.className = 'cx-sense-bar cx-axes-bar';
    b.innerHTML = '<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span><span class="cx-sense-label"></span>';
    (b.querySelector('.cx-sense-label') as HTMLElement).textContent = text;
    for (const a of actions) { const btn = document.createElement('button'); btn.className = 'cx-axes-btn' + (a.dark ? ' ok' : ''); btn.textContent = a.label; btn.onclick = e => { e.stopPropagation(); a.run(); }; b.append(btn); }
    if (!actions.length) b.classList.add('quiet');
    document.body.append(b); bar = b; barFor = at;
    const place = () => { if (!barFor || !bar) return; const rr = rootEl.getBoundingClientRect(), [x, y] = gfx.viewport.toViewCoord(barFor.x + barFor.w / 2, barFor.y + barFor.h); const w = bar.offsetWidth; bar.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, rr.left + x - w / 2))}px`; bar.style.top = `${Math.min(innerHeight - 50, rr.top + y + 36)}px`; barRaf = requestAnimationFrame(place); };
    place();
    ms = ms || 9000;
    if (ms) setTimeout(() => { if (bar === b) { b.classList.add('out'); setTimeout(() => b.remove(), 300); bar = null; } }, ms);
    return b;
  }
  const hush = () => { if (bar) { const b = bar; b.classList.add('out'); setTimeout(() => b.remove(), 300); bar = null; } };

  // ── reading lines and their names ──
  type Drawn = { el: any; a: Pt; b: Pt; len: number; dir: 'h' | 'v'; label: string; ends: [string, string]; labels: string[]; ink: [any[], any[]] };
  /** a line drawn with the mouse (a connector) or a straight pen stroke, long enough to carry a scale */
  function asLine(e: any): Drawn | null {
    if (e.type !== 'connector' && e.type !== 'brush') return null;
    const p = ptsOf(e); if (p.length < 2) return null;
    let a = p[0], b = p[p.length - 1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (e.type === 'brush') { const L = p.reduce((v, q, i) => (i ? v + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0); if (!L || len / L < 0.8) return null; }   // a line drawn by hand wavers a little
    if (len < 160) return null;
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), dir: 'h' | 'v' = dx >= dy ? 'h' : 'v';
    if (Math.min(dx, dy) / Math.max(dx, dy) > 0.36) return null;   // a slanted line is not an axis
    // a horizontal axis runs left to right, a vertical one bottom to top (its start is where the scale begins)
    if (dir === 'h' && a[0] > b[0]) [a, b] = [b, a];
    if (dir === 'v' && a[1] < b[1]) [a, b] = [b, a];
    // its names: the line's own label, words along it, words at its ends
    const own = textOf(e).trim(), reach = Math.max(70, len * 0.12);
    const named = els().filter(t => isText(t) && !mine.has(t.id) && textOf(t).trim()).map(t => ({ t, c: mid(boxOf(t)), b: boxOf(t), s: textOf(t).trim() }));
    const along = (c: Pt) => { const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, rx = c[0] - a[0], ry = c[1] - a[1], s = rx * ux + ry * uy, d = Math.abs(rx * uy - ry * ux); return { s, d }; };
    const labels: string[] = [];
    // the words nearest each end name that end (anywhere round it, within about a fifth of the line)
    const R = Math.max(110, len * 0.22), distTo = (n: { b: Box }, p: Pt) => Math.hypot(Math.max(n.b.x - p[0], 0, p[0] - n.b.x - n.b.w), Math.max(n.b.y - p[1], 0, p[1] - n.b.y - n.b.h));
    const endName = (p: Pt, other: Pt) => named.filter(n => distTo(n, p) < R && distTo(n, p) < distTo(n, other)).sort((m, n) => distTo(m, p) - distTo(n, p))[0];
    const sN = endName(a, b), eN = endName(b, a);
    const startName = sN?.s ?? '', endNameS = eN?.s ?? '';
    if (sN) labels.push(sN.t.id); if (eN) labels.push(eN.t.id);
    for (const n of named) { const q = along(n.c); if (q.s > -reach && q.s < len + reach && q.d < reach && !labels.includes(n.t.id)) labels.push(n.t.id); }
    const label = own || labels.map(id => textOf(byId(id)).trim()).find(Boolean) || '';
    // names written by hand: pen strokes gathered at an end (read later, by Claude, from a picture of them)
    const inkAt = (p: Pt, other: Pt) => els().filter(k => k !== e && k.type === 'brush' && !mine.has(k.id)).filter(k => { const kb = boxOf(k), c = mid(kb); return Math.max(kb.w, kb.h) < len * 0.35 && Math.hypot(c[0] - p[0], c[1] - p[1]) < R * 1.2 && Math.hypot(c[0] - p[0], c[1] - p[1]) < Math.hypot(c[0] - other[0], c[1] - other[1]); });
    // (an arrowhead drawn on the end touches it; writing stands beside it)
    const tip = Math.max(16, len * 0.02), touches = (k: any, p: Pt) => ptsOf(k).some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < tip);
    const rawA = inkAt(a, b), rawB = inkAt(b, a);
    const ink: [any[], any[]] = [sN ? [] : rawA.filter(k => !touches(k, a)), eN ? [] : rawB.filter(k => !touches(k, b))];
    for (const k of [...rawA, ...rawB]) labels.push(k.id);
    return { el: e, a, b, len, dir, label, ends: [startName, endNameS], labels, ink };
  }
  /** words written with the pen, read from a picture of the strokes ('' when they cannot be read) */
  async function readInk(strokes: any[]): Promise<string> {
    if (!strokes.length) return '';
    try {
      const b = unionBox(strokes.map(boxOf)), pad = 24, k = Math.min(4, 520 / Math.max(b.w, b.h, 1)), c = document.createElement('canvas'); c.width = Math.round((b.w + pad * 2) * k); c.height = Math.round((b.h + pad * 2) * k);
      const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.strokeStyle = '#111'; x.lineWidth = Math.max(2.5, 3 * k); x.lineCap = 'round'; x.lineJoin = 'round';
      for (const st of strokes) { const p = ptsOf(st); x.beginPath(); p.forEach((q, i) => { const X = (q[0] - b.x + pad) * k, Y = (q[1] - b.y + pad) * k; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke(); }
      const blob: Blob = await new Promise(ok => c.toBlob(v => ok(v!), 'image/png'));
      const r = await ask('You read handwriting from a whiteboard. Answer with the written word or short phrase only, nothing else. Ignore arrowheads and stray marks. If nothing is written, answer with an empty line.', 'What is written here?', blob);
      return r.trim().replace(/^["“']|["”'.]$/g, '').split('\n')[0].slice(0, 40);
    } catch { return ''; }
  }
  const timeWord = /time|timeline|year|date|decade|era|history|chronolog|时间|年代|年份|历史/i;

  // ── where a thing sits on an axis ──
  const posterOf = (id: string): Poster | undefined => { const k = P.posters[id]; return k ? PDATA.find(p => p.key === k) : undefined; };
  async function valuesFor(items: any[], ax: { kind: 'time' | 'scale'; name: string; poles: [string, string] }, ord: 'x' | 'y'): Promise<Map<string, number>> {
    const out = new Map<string, number>(), rest: any[] = [];
    for (const e of items) {
      const p = posterOf(e.id);
      if (p) { out.set(e.id, ax.kind === 'time' ? p.year : p.type); continue; }
      const known = P.values[e.id]?.[`${ord}:${ax.name}`]; if (known !== undefined) { out.set(e.id, known); continue; }
      const t = textOf(e) || (e.props?.caption ?? '');
      const yr = ax.kind === 'time' ? /\b(1[5-9]\d\d|20\d\d)\b/.exec(t) : null;
      if (yr) { out.set(e.id, +yr[1]); continue; }
      rest.push(e);
    }
    if (rest.length) {
      // Claude places what the board cannot: each thing's words, the axis and its two ends
      const list = rest.map((e, i) => `${i + 1}. ${(textOf(e) || e.props?.caption || '(a picture)').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
      const sys = 'You place things on an axis the user drew on a whiteboard. Answer with JSON only: {"values":[number,...]} in the order given.';
      const user = ax.kind === 'time'
        ? `Axis: time ("${ax.name}"). For each thing give the year it belongs to (a number). Things:\n${list}`
        : `Axis "${ax.name}" from "${ax.poles[0] || 'low'}" (0) to "${ax.poles[1] || 'high'}" (1). For each thing give where it sits, a number from 0 to 1. Things:\n${list}`;
      try { const r = await ask(sys, user); const j = JSON.parse(/\{[\s\S]*\}/.exec(r)?.[0] ?? '{}'); (j.values ?? []).forEach((v: number, i: number) => { if (rest[i] && Number.isFinite(+v)) out.set(rest[i].id, +v); }); } catch { /* left where they are */ }
    }
    for (const [id, v] of out) { (P.values[id] ??= {})[`${ord}:${ax.name}`] = v; }
    keep();
    return out;
  }

  // ── an axis, made clean ──
  const niceStep = (span: number) => { const raw = span / 8, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; };
  function formalTime(d: Drawn, years: number[]): Axis {
    // a step a person would read (years, then 2, 5, 10), the scale from just before the first to just after the last
    const y0 = Math.min(...years), y1 = Math.max(...years), sp = y1 - y0, step = sp <= 12 ? 1 : sp <= 30 ? 2 : sp <= 70 ? 5 : 10;
    const lo = Math.floor(y0 / step) * step - (step === 1 ? 1 : 0), hi = Math.ceil((y1 + (step === 1 ? 1 : 0)) / step) * step;
    const pad = d.len * 0.04, y = (d.a[1] + d.b[1]) / 2, a: Pt = [d.a[0] + pad, y], b: Pt = [d.b[0] - pad * 1.6, y];
    return { id: '', kind: 'time', dir: 'h', a, b, min: lo, max: hi, step, name: d.label || 'time', poles: ['', ''], user: [d.el.id, ...d.labels], made: [] } as Axis;
  }
  const unitOf = (ax: Axis) => Math.max(0.6, Math.hypot(ax.b[0] - ax.a[0], ax.b[1] - ax.a[1]) / 1300);
  const at = (ax: Axis, v: number): Pt => { const t = (v - ax.min) / (ax.max - ax.min || 1); return [ax.a[0] + (ax.b[0] - ax.a[0]) * t, ax.a[1] + (ax.b[1] - ax.a[1]) * t]; };
  async function drawAxis(ax: Axis, ticksSide: 1 | -1 = 1) {
    const u = unitOf(ax), made: string[] = [];
    // the user's own line stays, faint, under the clean one: what was read can be checked against what was drawn
    for (const id of ax.user) { const el = domOf(id); if (el) el.style.opacity = '0.35'; }
    const ext = ax.dir === 'h' ? [ax.a[0] - 30 * u, ax.b[0] + 46 * u] : [ax.a[1] + 30 * u, ax.b[1] - 46 * u];
    const A: Pt = ax.dir === 'h' ? [ext[0], ax.a[1]] : [ax.a[0], ext[0]], B: Pt = ax.dir === 'h' ? [ext[1], ax.a[1]] : [ax.a[0], ext[1]];
    // drawn out from its start, the ticks following
    const steps = 14; let last = '';
    for (let k = 1; k <= steps; k++) { const t = k / steps, p: Pt = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; if (last) remove(last); last = line(A, p, { color: INK, w: 1.6 * u, arrows: k === steps ? (ax.kind === 'time' ? 'end' : 'both') : 'none' }); await wait(22); }
    ax.id = last; made.push(last);
    if (ax.kind === 'time') {
      const step = ax.step ?? (niceStep(ax.max - ax.min) < 10 ? niceStep(ax.max - ax.min) : 10), n = Math.round((ax.max - ax.min) / step);
      for (let v = ax.min; v <= ax.max + 1e-6; v += step) {
        const p = at(ax, v), major = n <= 16 || v % (step * 5) === 0;
        made.push(line([p[0], p[1] - 6 * u], [p[0], p[1] + 6 * u], { color: MUTED, w: 1 * u }));
        made.push(words(String(Math.round(v)), p[0], p[1] + ticksSide * 20 * u, 12 * u, { color: major ? '#6e6e73' : MUTED }));
        await wait(16);
      }
    } else {
      // a scale between two poles: a mark in the middle, the poles named at the ends
      const m = at(ax, (ax.min + ax.max) / 2); made.push(line(ax.dir === 'v' ? [m[0] - 6 * u, m[1]] : [m[0], m[1] - 6 * u], ax.dir === 'v' ? [m[0] + 6 * u, m[1]] : [m[0], m[1] + 6 * u], { color: MUTED, w: u }));
      const [p0, p1] = ax.poles;
      if (ax.dir === 'v') { if (p1) made.push(words(p1, B[0] + 10 * u, B[1] + 14 * u, 12 * u, { color: '#6e6e73', align: 'left' })); if (p0) made.push(words(p0, A[0] + 10 * u, A[1] - 14 * u, 12 * u, { color: '#6e6e73', align: 'left' })); }
      else { if (p0) made.push(words(p0, A[0], A[1] + 20 * u, 12 * u, { color: '#6e6e73', align: 'left' })); if (p1) made.push(words(p1, B[0], B[1] + 20 * u, 12 * u, { color: '#6e6e73', align: 'right' })); }
    }
    // the axis' own name, where the user had written it
    if (ax.kind === 'time' && ax.name && !/^time$/i.test(ax.name)) made.push(words(ax.name, B[0], B[1] - 18 * u, 12 * u, { color: '#6e6e73', align: 'right' }));
    // the draft it was read from is cleared: the clean axis has taken its place
    for (const id of ax.user) remove(id);
    ax.made = made; return ax;
  }

  // ── laying things out on the axes ──
  /** move things to their places: each fades where it was and fades in where it goes, one after another in order */
  async function moveAll(moves: { id: string; to: Box; label?: string; labelAt?: Pt; size?: number }[], order: (a: string) => number) {
    const sorted = [...moves].sort((p, q) => order(p.id) - order(q.id));
    const jobs: Promise<void>[] = [];
    for (const m of sorted) {
      const e = byId(m.id); if (!e) continue;
      jobs.push((async () => {
        await fadeEl(m.id, 1, 0, 260);
        try { if (e.flavour) store.updateBlock(e, { xywh: `[${m.to.x},${m.to.y},${m.to.w},${m.to.h}]`, rotate: 0 } as any); else surf.updateElement(m.id, { xywh: `[${m.to.x},${m.to.y},${m.to.w},${m.to.h}]` }); } catch { /* stays */ }
        if (m.label && m.labelAt) {
          const old = P.labels[m.id] && byId(P.labels[m.id]);
          if (old) surf.updateElement(P.labels[m.id], { xywh: (() => { const b = boxOf(old); return `[${m.labelAt![0] - b.w / 2},${m.labelAt![1] - b.h / 2},${b.w},${b.h}]`; })() });
          else P.labels[m.id] = words(m.label, m.labelAt[0], m.labelAt[1], m.size ?? 11, { color: MUTED });
        }
        const lab = P.labels[m.id]; if (lab) { const le = domOf(lab); if (le) le.style.opacity = '0'; }
        await fadeEl(m.id, 0, 1, 380);
      })());
      await wait(55);
    }
    await Promise.all(jobs);
    for (const m of moves) { const lab = P.labels[m.id]; if (lab) { const le = domOf(lab); if (le) le.style.opacity = ''; } }
    keep();
  }

  /** neat rows along the axis: everything one height, standing in rows parallel to it, at most a few rows deep.
   *  Each thing stands at its value; when its spot in a row is taken it goes to the next row out, and only when all
   *  rows are taken there does it move sideways, as little as it can. */
  function rows(things: { id: string; x: number; w: number; row: number; side: 1 | -1 }[], axisY: number, rowH: number, gap: number, band: [number, number], maxRows: number) {
    const taken: { side: number; row: number; x0: number; x1: number }[] = [], out = new Map<string, { x: number; y: number; row: number }>();
    const free = (side: number, row: number, x0: number, x1: number) => !taken.some(t => t.side === side && t.row === row && x0 < t.x1 + gap && x1 + gap > t.x0);
    for (const t of [...things].sort((p, q) => p.row - q.row || p.x - q.x)) {
      let pick: { row: number; x: number } | null = null;
      // its own row, then the rows further out, then the rows nearer in
      const order = [...Array(maxRows).keys()].map(r => (t.row + r) % maxRows);
      for (const r of order) if (free(t.side, r, t.x - t.w / 2, t.x + t.w / 2)) { pick = { row: r, x: t.x }; break; }
      if (!pick) {
        let best = Infinity;
        for (let r = 0; r < maxRows; r++) for (const dir of [1, -1]) for (let dx = 0; dx < 4000; dx += 4) {
          const x = t.x + dir * dx; if (free(t.side, r, x - t.w / 2, x + t.w / 2)) { const cost = dx + Math.abs(r - t.row) * 10; if (cost < best) { best = cost; pick = { row: r, x }; } break; }
        }
      }
      const p = pick!; taken.push({ side: t.side, row: p.row, x0: p.x - t.w / 2, x1: p.x + t.w / 2 });
      const y = t.side < 0 ? axisY - band[0] - (p.row + 1) * rowH : axisY + band[1] + p.row * rowH;
      out.set(t.id, { x: p.x, y, row: p.row });
    }
    return out;
  }
  async function layOut(first: Axis, second: Axis | null, items: any[]) {
    const u = unitOf(first), axisY = first.a[1];
    const xs = await valuesFor(items, first, 'x');
    const ys = second ? await valuesFor(items, second, 'y') : null;
    // one height for all, small enough that a crowded decade stands in a few tidy rows
    const span = first.b[0] - first.a[0], perStep = span / Math.max(1, Math.min(14, (first.max - first.min) / (first.step ?? 10)));
    const H = Math.max(64 * u, Math.min(perStep * 0.62, 200 * u)), lab = 18 * u, gap = 10 * u, rowH = H + lab + gap;
    const band: [number, number] = second ? [14 * u, 86 * u] : [14 * u, 40 * u], maxRows = second ? 4 : 4;
    const things = items.filter(e => xs.has(e.id)).map(e => {
      const b = boxOf(e), img = e.flavour === 'affine:image', k = img ? H / b.h : Math.min(1, H / Math.max(b.w, b.h)), w = b.w * k;
      let side: 1 | -1 = -1, row = 0;
      if (second && ys) { const v = (ys.get(e.id) ?? 0.5) - (second.min + second.max) / 2, s2 = (second.max - second.min) || 1; side = v >= 0 ? -1 : 1; row = Math.min(maxRows - 1, Math.floor(Math.abs(v / s2) * 2 * maxRows)); }
      return { id: e.id, x: at(first, xs.get(e.id)!)[0], w, h: b.h * k, row, side };
    });
    const spots = rows(things, axisY, rowH, gap, band, maxRows);
    const boxes: Box[] = [];
    const moves = things.map(t => { const s2 = spots.get(t.id)!, inner = { x: s2.x - t.w / 2, y: s2.y + (H - t.h), w: t.w, h: t.h };
      boxes.push({ x: inner.x, y: s2.y, w: t.w, h: rowH });
      const yearOf = posterOf(t.id)?.year ?? Math.round(xs.get(t.id)!);
      return { id: t.id, to: inner, label: first.kind === 'time' ? String(yearOf) : undefined, labelAt: [s2.x, s2.y + H + lab / 2 + 2 * u] as Pt, size: 11 * u }; });
    await moveAll(moves, id => xs.get(id) ?? 0);
    P.items[first.id] = items.map(e => e.id); keep();
    return unionBox([...boxes, { x: first.a[0], y: axisY - 10, w: span, h: 20 }]);
  }

  // ── R0 · find pictures (the filmed posters) and pile them where asked ──
  async function gatherPosters(atPt: Pt) {
    const stop = think([atPt[0] + 12, atPt[1] - 12]);
    // all the pictures are fetched first, so they arrive together; the pile is laid out as in the Figma storyboard
    // (S3-R1): five sizes, each a degree or two off straight, packed into one loose block round the spot
    const blobs = await Promise.all(PDATA.map(p => fetch(POSTER_SRC[p.key]).then(r => r.blob()).catch(() => null)));
    await wait(1200 + Math.random() * 500);
    const k = 3.4, xs = PDATA.map(p => p.pile.x), ys = PDATA.map(p => p.pile.y), xe = PDATA.map(p => p.pile.x + p.pile.w), ye = PDATA.map(p => p.pile.y + p.pile.h);
    const cx = (Math.min(...xs) + Math.max(...xe)) / 2, cy = (Math.min(...ys) + Math.max(...ye)) / 2;
    const spots = PDATA.map((p, i) => ({ p, blob: blobs[i], b: { x: atPt[0] + (p.pile.x - cx) * k, y: atPt[1] + (p.pile.y - cy) * k, w: p.pile.w * k, h: p.pile.h * k } as Box, rot: p.pile.rot })).filter(s2 => s2.blob);
    stop();
    const all = unionBox(spots.map(s2 => s2.b)); lookAt(all);
    const ids: string[] = [];
    for (const s2 of spots) {
      const sourceId = await store.blobSync.set(s2.blob!);
      const id = store.addBlock('affine:image', { sourceId, xywh: `[${s2.b.x},${s2.b.y},${s2.b.w},${s2.b.h}]`, width: s2.p.w, height: s2.p.h, rotate: s2.rot } as any, surf.id) as string;
      P.posters[id] = s2.p.key; ids.push(id);
      const el = domOf(id); if (el) el.style.opacity = '0';
      void fadeEl(id, 0, 1, 420); await wait(26);
    }
    keep(); store.captureSync?.();
    const yrs = spots.map(s2 => s2.p.year);
    say(`${spots.length} posters added from Pinterest · ${Math.min(...yrs)} → ${Math.max(...yrs)}`, all, [], 3800);
    return true;
  }

  // ── R2–R4 · a named line and things: the first axis ──
  async function sortOnto(d: Drawn, items: any[], words2: string) {
    const region = unionBox([...items.map(boxOf), boxOf(d.el)]);
    const stop = think([region.x + region.w + 8, region.y]);
    const dated = items.filter(e => posterOf(e.id) || /\b(1[5-9]\d\d|20\d\d)\b/.test(textOf(e))).length;
    const kind: 'time' | 'scale' = timeWord.test(d.label + ' ' + words2) || (!d.ends[0] && !d.ends[1] && dated >= items.length * 0.6) ? 'time' : 'scale';
    let ax: Axis;
    if (kind === 'time') {
      const vals = await valuesFor(items, { kind, name: d.label || 'time', poles: ['', ''] }, 'x');
      const years = [...vals.values()]; if (!years.length) { stop(); say('No years found for these', region, [], 3000); return true; }
      ax = formalTime(d, years);
    } else {
      const pad = d.len * 0.04, y = (d.a[1] + d.b[1]) / 2;
      ax = { id: '', kind: 'scale', dir: 'h', a: [d.a[0] + pad, y], b: [d.b[0] - pad * 1.6, y], min: 0, max: 1, name: d.label || 'scale', poles: [d.ends[0] || 'low', d.ends[1] || 'high'], user: [d.el.id, ...d.labels], made: [] };
    }
    await wait(900); stop();
    lookAt(unionBox([region, { x: ax.a[0], y: ax.a[1] - 300, w: ax.b[0] - ax.a[0], h: 400 }]));
    // first it is read: the clean axis, and a line saying how; then the things go onto it
    await drawAxis(ax);
    P.axes.push(ax); keep();
    const readAs = ax.kind === 'time' ? `Read your line as a time axis · ${ax.min} → ${ax.max}` : `Read your line as "${ax.name}" · ${ax.poles[0]} → ${ax.poles[1]}`;
    const b0 = unionBox([{ x: ax.a[0], y: ax.a[1], w: ax.b[0] - ax.a[0], h: 30 }]);
    say(readAs, b0, [{ label: 'Keep', dark: true, run: hush }, ...(ax.kind === 'time' ? [{ label: 'Adjust range', run: () => adjust(ax, items) }] : [])]);
    await wait(1300);
    const placed = await layOut(ax, null, items);
    store.captureSync?.();
    say(`${items.length} ${items.every(e => posterOf(e.id)) ? 'posters' : 'things'} placed by ${ax.kind === 'time' ? 'year' : ax.name}`, placed, [{ label: 'Keep', dark: true, run: hush }, ...(ax.kind === 'time' ? [{ label: 'Adjust range', run: () => adjust(ax, items) }] : [])]);
    lookAt(placed);
    return true;
  }
  /** a different range for the scale, typed into the bar itself */
  function adjust(ax: Axis, items: any[]) {
    if (!bar) return; const lab = bar.querySelector('.cx-sense-label') as HTMLElement; bar.querySelectorAll('button').forEach(b => b.remove());
    const inp = document.createElement('input'); inp.className = 'cx-axes-range'; inp.value = `${ax.min}–${ax.max}`; lab.replaceWith(inp); inp.focus(); inp.select();
    inp.addEventListener('keydown', async e => {
      e.stopPropagation(); if (e.key === 'Escape') { hush(); return; } if (e.key !== 'Enter') return;
      const m = /(\d{3,4})\D+(\d{3,4})/.exec(inp.value); if (!m) return; hush();
      for (const id of ax.made) remove(id);
      ax.min = Math.min(+m[1], +m[2]); ax.max = Math.max(+m[1], +m[2]); await drawAxis(ax); keep();
      await layOut(ax, live().find(a => a.of === ax.id) ?? null, items.filter(i => byId(i.id)));
    });
  }

  // ── R5 · a line across the axis, named at its ends: a second dimension, no words needed ──
  async function secondAxis(d: Drawn, first: Axis, words2 = '') {
    const items = (P.items[first.id] ?? []).map(byId).filter(Boolean);
    if (!items.length) return false;
    seen.add(d.el.id);
    const u = unitOf(first), x = (d.a[0] + d.b[0]) / 2;
    // its two ends: the words written there; failing that, two things named in the request ("A vs B", "A 和 B":
    // the first is the top); failing that, the request itself names the scale
    const clean = (t: string) => t.replace(/[-\s]*led$/i, '').trim();
    let [lowName, highName] = d.ends.map(clean);   // bottom end, top end
    if (d.ink[0].length || d.ink[1].length) { const [l2, h2] = await Promise.all([lowName ? '' : readInk(d.ink[0]), highName ? '' : readInk(d.ink[1])]); lowName = lowName || clean(l2); highName = highName || clean(h2); }
    if (!lowName && !highName) { const m = /([\w\u4e00-\u9fa5]+)\s*(?:vs\.?|↔|<->|→|和|与|到|\/|,|，)\s*([\w\u4e00-\u9fa5]+)/i.exec(words2.replace(/纵轴|横轴|axis|vertical|按照|排列|sort|by/gi, ' ')); if (m) { highName = m[1]; lowName = m[2]; } }
    const filmed = items.every(e => posterOf(e.id));
    if (!lowName && !highName && !filmed && !words2.trim()) return false;   // nothing says what the line measures
    const stop = think([x + 14 * u, Math.min(d.a[1], d.b[1])]);
    await wait(1200); stop();
    const top = Math.min(d.a[1], d.b[1]), bot = Math.max(d.a[1], d.b[1]);
    const ax: Axis = { id: '', kind: 'scale', dir: 'v', a: [x, bot], b: [x, top], min: 0, max: 1, name: lowName || highName ? `${highName || 'more'} / ${lowName || 'less'}` : (filmed ? 'type / image' : words2.trim()), poles: [lowName || (filmed ? 'image' : 'less'), highName || (filmed ? 'type' : 'more')], user: [d.el.id, ...d.labels], made: [], of: first.id };
    // the year labels go up to the first axis' far side, so the lower half is free for things
    await drawAxis(ax);
    P.axes.push(ax); keep();
    const placed = await layOut(first, ax, items);
    store.captureSync?.();
    say(`${words2.trim() ? 'Read' : 'No prompt · read'} as a 2nd axis: ${ax.poles[1]} ↑  ${ax.poles[0]} ↓`, placed, [{ label: 'Keep', dark: true, run: hush }], 0);
    lookAt(placed);
    return true;
  }

  // ── R6–R8 · a ring round a stretch of the axis, and a question: a card as wide as the stretch ──
  async function explainStretch(ring: any, question: string, first: Axis) {
    const rb = boxOf(ring), u = unitOf(first);
    const toV = (x: number) => first.min + ((x - first.a[0]) / (first.b[0] - first.a[0])) * (first.max - first.min);
    let from = Math.round(toV(rb.x)), to = Math.round(toV(rb.x + rb.w));
    const stop = think([rb.x + rb.w + 8, rb.y]);
    // what lies in and around the stretch, for the answer
    const items = (P.items[first.id] ?? []).map(byId).filter(Boolean) as any[];
    const vals = await valuesFor(items, first, 'x');
    const inside = items.filter(e => { const v = vals.get(e.id) ?? -1e9; return v >= from && v <= to; });
    let card: Omit<Card, 'id' | 'axis' | 'open' | 'y' | 'up'>;
    const filmed = items.length && items.every(e => posterOf(e.id)) && from < 1950 && to > 1940;
    let events: { name: string; from: number; to: number; weak?: boolean }[] = [];
    if (filmed) {
      // (written for the film: the answer about the war years, general knowledge)
      from = Math.max(from, 1937); to = Math.min(Math.max(to, 1952), 1954);
      card = { from: 1937, to: 1952, title: 'World War II era', lines: ['Paper and ink rationed', 'Bauhaus closed, designers left', 'Posters became propaganda'], source: '' };
      events = [{ name: 'WWII 1939–45', from: 1939, to: 1945 }, { name: 'WWI 1914–18', from: 1914, to: 1918, weak: true }];
    } else {
      const ctx = items.slice(0, 40).map(e => `${Math.round(vals.get(e.id) ?? 0)}: ${(textOf(e) || posterOf(e.id)?.style || 'a picture').slice(0, 80)}`).join('\n');
      const sys = 'Answer a question asked about a stretch of a time axis on a whiteboard. JSON only: {"title":"name of the period, at most four words","from":year,"to":year,"lines":["at most three reasons, each at most five words"],"events":[{"name":"at most three words","from":year,"to":year}]}. At most three events. Never invent quotations. Answer in the language of the question.';
      try { const r = await ask(sys, `Axis "${first.name}", ${first.min}–${first.max}. The user circled ${from}–${to} (${inside.length} things there) and asked: "${question}". Things on the axis:\n${ctx}`); const j = JSON.parse(/\{[\s\S]*\}/.exec(r)?.[0] ?? '{}');
        card = { from: +j.from || from, to: +j.to || to, title: j.title || `${from}–${to}`, lines: (j.lines ?? []).slice(0, 3), source: '' }; events = (j.events ?? []).slice(0, 3);
      } catch { card = { from, to, title: `${from}–${to}`, lines: ['Claude could not be reached to answer this.'], source: '' }; }
    }
    stop();
    // the ring has been answered: it fades
    try { if (ring.type === 'brush') surf.updateElement(ring.id, { color: FAINT }); else if (ring.type === 'shape') surf.updateElement(ring.id, { strokeColor: FAINT }); else surf.updateElement(ring.id, { stroke: FAINT }); } catch { /* left */ }
    // the card: its edges on the two years, standing where the ring was, tied to the axis by two fine lines
    const x0 = at(first, card.from)[0], x1 = at(first, card.to)[0], up = rb.y + rb.h / 2 < first.a[1];
    const y = up ? Math.min(rb.y + rb.h * 0.25, first.a[1] - 120 * u) : Math.max(rb.y + rb.h * 0.25, first.a[1] + 70 * u);
    const c: Card = { parts: [], id: 'c' + Math.random().toString(36).slice(2, 8), axis: first.id, ...card, open: false, y, up };
    P.cards.push(c); keep();
    const ties = [x0, x1].map(x => line([x, up ? y + 34 * u : y], [x, first.a[1] + (up ? -2 : 2) * u], { color: MUTED, w: 0.8 * u, dash: true }));
    c.parts = [...ties];
    renderCard(c, true);
    // the events, under the axis, from start to end
    // each on its own level when they would run into one another: arrow and name together, the levels stepping down
    const taken: { row: number; x0: number; x1: number }[] = [];
    for (const ev of [...events].sort((p, q) => (p.weak ? 1 : 0) - (q.weak ? 1 : 0) || p.from - q.from)) {
      const a = at(first, ev.from)[0], b = at(first, ev.to)[0], col = ev.weak ? FAINT : MUTED;
      measure.font = `400 ${11 * u}px Inter, sans-serif`; const tw = measure.measureText(ev.name).width + 10 * u, cxm = (a + b) / 2, e0 = Math.min(a, cxm - tw / 2) - 8 * u, e1 = Math.max(b, cxm + tw / 2) + 8 * u;
      let row = 0; while (taken.some(t => t.row === row && e0 < t.x1 && e1 > t.x0)) row++;
      taken.push({ row, x0: e0, x1: e1 });
      const yy = first.a[1] + (44 + row * 34) * u;
      c.parts!.push(line([a, yy], [b, yy], { color: col, w: 1.1 * u, arrows: 'both' }));
      c.parts!.push(words(ev.name, cxm, yy + 13 * u, 11 * u, { color: ev.weak ? '#aeaeb2' : '#6e6e73' }));
      // a lower level is tied back to its years by fine dashed lines (these may cross what is above)
      if (row > 0) { c.parts!.push(line([a, first.a[1] + 30 * u], [a, yy], { color: FAINT, w: 0.7 * u, dash: true }), line([b, first.a[1] + 30 * u], [b, yy], { color: FAINT, w: 0.7 * u, dash: true })); }
      await wait(160);
    }
    store.captureSync?.();
    lookAt({ x: x0 - 200 * u, y: Math.min(y, first.a[1]) - 60 * u, w: x1 - x0 + 400 * u, h: Math.abs(first.a[1] - y) + 200 * u });
    return true;
  }
  const cardEls = new Map<string, HTMLElement>();
  function removeCard(c: Card) {
    cardEls.get(c.id)?.remove(); cardEls.delete(c.id);
    for (const i of c.parts ?? []) remove(i);
    P.cards = P.cards.filter(k => k.id !== c.id); keep(); store.captureSync?.();
  }
  function renderCard(c: Card, fresh = false) {
    const ax = P.axes.find(a => a.id === c.axis); const L = layer(); if (!ax || !L) return;
    const u = unitOf(ax), x0 = at(ax, c.from)[0], x1 = at(ax, c.to)[0];
    let d = cardEls.get(c.id);
    if (!d) {
      d = document.createElement('div'); d.className = 'cx-axes-card'; cardEls.set(c.id, d); L.append(d);
      d.addEventListener('pointerdown', e => e.stopPropagation());
      d.tabIndex = 0;
      // a click opens or folds it and selects it (blue outline); Delete or Backspace, or right click → Delete, removes
      // it with its ties and event marks
      d.addEventListener('click', e => { e.stopPropagation(); c.open = !c.open; keep(); d!.classList.toggle('open', c.open); d!.focus(); try { gfx.selection.set({ elements: [] }); } catch { /* none */ } });
      d.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); removeCard(c); } else if (e.key === 'Escape') d!.blur(); });
      d.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); d!.focus();
        document.querySelector('.cx-axes-menu')?.remove();
        const m = document.createElement('div'); m.className = 'cx-spot-menu cx-axes-menu'; m.style.left = `${e.clientX}px`; m.style.top = `${e.clientY}px`;
        const b = document.createElement('button'); b.className = 'cx-spot-item'; b.innerHTML = '<span>Delete</span><i>⌫</i>'; b.onclick = ev => { ev.stopPropagation(); m.remove(); removeCard(c); }; m.append(b); document.body.append(m);
        const off = (ev: Event) => { if (!(ev.target as HTMLElement).closest?.('.cx-axes-menu')) { m.remove(); removeEventListener('pointerdown', off, true); } }; addEventListener('pointerdown', off, true); });
    }
    d.innerHTML = '';
    const head = document.createElement('div'); head.className = 'cx-axes-card-head';
    head.innerHTML = '<b></b>'; (head.querySelector('b') as HTMLElement).textContent = c.title;
    const body = document.createElement('div'); body.className = 'cx-axes-card-body';
    for (const l of c.lines.filter(l2 => !/^why|\?$|^→/i.test(l2.trim())).slice(0, 3)) { const p = document.createElement('p'); p.textContent = l.replace(/^[•\-–]\s*/, ''); body.append(p); }
    d.append(head, body); d.classList.toggle('open', c.open);
    const fs = Math.max(6, Math.min(12.5 * u, (x1 - x0) / 13)), uu = fs / 12.5;
    Object.assign(d.style, { left: `${x0}px`, top: `${c.y}px`, width: `${x1 - x0}px`, fontSize: `${fs}px`, '--u': String(uu) } as any);
    if (fresh) { d.classList.add('enter'); requestAnimationFrame(() => requestAnimationFrame(() => d!.classList.remove('enter'))); }
  }
  setTimeout(() => { for (const c of P.cards) renderCard(c); }, 1500);
  setInterval(() => { for (const c of P.cards) { if (!P.axes.find(a => a.id === c.axis && byId(a.id))) { cardEls.get(c.id)?.remove(); cardEls.delete(c.id); } } }, 1500);

  // ── reading a request ──
  const isRing = (e: any) => { if (e.type !== 'brush') return false; const p = ptsOf(e), b = boxOf(e); if (p.length < 8 || Math.min(b.w, b.h) < 40) return false; const gap = Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]); return gap < Math.max(b.w, b.h) * 0.45; };
  async function run(words2: string, ids: string[] = []): Promise<boolean> {
    const w = words2.trim();
    const sel = ids.map(byId).filter(Boolean) as any[];
    // pictures to be found, nowhere in particular selected: the filmed poster pile
    if (!sel.length && /poster|海报|招贴/i.test(w)) {
      const pt = W.cxAskAt as Pt | undefined, c: Pt = pt ?? [gfx.viewport.centerX, gfx.viewport.centerY];
      return gatherPosters(c);
    }
    if (!sel.length) return false;
    // a ring round a stretch of an axis, and a question
    const ring = sel.find(isRing);
    const firstAx = live().find(a => !a.of && a.dir === 'h');
    if (ring && firstAx && /\?|why|what|how|when|为什么|什么|怎么/i.test(w)) {
      const rb = boxOf(ring); if (rb.x < firstAx.b[0] && rb.x + rb.w > firstAx.a[0] && Math.abs(mid(rb)[1] - firstAx.a[1]) < Math.max(rb.h, 600)) return explainStretch(ring, w, firstAx);
    }
    // lines the user drew (never the scene's own clean axes)
    const lines = sel.filter(e => !mine.has(e.id)).map(asLine).filter(Boolean) as Drawn[];
    const crosses = (l: Drawn, ax: Axis) => { const top = Math.min(l.a[1], l.b[1]), bot = Math.max(l.a[1], l.b[1]), x = (l.a[0] + l.b[0]) / 2; return l.dir === 'v' && top < ax.a[1] && bot > ax.a[1] && x > ax.a[0] - 600 && x < ax.b[0] + 600; };
    // a line across an axis that is already sorted: a second dimension — whether it was selected, or the request
    // speaks of an axis and such a line is on the board
    if (firstAx && (P.items[firstAx.id] ?? []).length && !live().some(a => a.of === firstAx.id)) {
      let cross = lines.find(l => crosses(l, firstAx));
      if (!cross && /axis|vertical|dimension|纵轴|竖轴|y\s*轴|轴|维度/i.test(w)) cross = els().filter(e => !mine.has(e.id) && !firstAx.user.includes(e.id)).map(asLine).find(l => l && crosses(l, firstAx)) ?? undefined;
      if (cross) return secondAxis(cross, firstAx, w);
    }
    // a line and things to sort onto it
    const things = sel.filter(e => !lines.some(l => l.el === e || l.labels.includes(e.id)) && !mine.has(e.id) && e.type !== 'group' && e.flavour !== 'affine:frame' && e.type !== 'connector' && e.type !== 'brush' && (!isText(e) || textOf(e).trim().length > 2));
    const flat = lines.filter(l => l.dir === 'h').sort((a2, b2) => b2.len - a2.len)[0];
    if (flat && things.length >= 2) return sortOnto(flat, things, w);
    return false;
  }

  // ── a line across a sorted axis is read by itself, once it is named at its ends ──
  let pointerDown = false, lastUp = 0, lastKey = 0; const seen = new Set<string>();
  addEventListener('keydown', () => { lastKey = Date.now(); }, true);
  addEventListener('pointerdown', () => { pointerDown = true; }, true);
  addEventListener('pointerup', () => { pointerDown = false; lastUp = Date.now(); }, true);
  let working = false;
  setInterval(async () => {
    if (working || pointerDown || Date.now() - lastUp < 1600 || gfx.selection.editing) return;
    const first = live().find(a => !a.of && a.dir === 'h' && (P.items[a.id] ?? []).length); if (!first) return;
    if (live().some(a => a.of === first.id)) return;
    for (const e of els()) {
      if (seen.has(e.id) || mine.has(e.id) || first.user.includes(e.id)) continue;
      const d = asLine(e); if (!d || d.dir !== 'v') continue;
      const top = Math.min(d.a[1], d.b[1]), bot = Math.max(d.a[1], d.b[1]), x = (d.a[0] + d.b[0]) / 2;
      if (!(top < first.a[1] && bot > first.a[1] && x > first.a[0] - 400 && x < first.b[0] + 400)) continue;
      // only when BOTH ends are named (typed or written by hand): one name alone may be half-way through writing.
      // With one name or none, it waits to be asked.
      const named2 = (i: 0 | 1) => !!d.ends[i] || d.ink[i].length > 0;
      if (!named2(0) || !named2(1)) continue;
      if (Date.now() - lastUp < (d.ink[0].length || d.ink[1].length ? 3200 : 2400) || Date.now() - lastKey < 2400) return;   // a moment after the last stroke or key
      seen.add(e.id); working = true;
      try { await secondAxis(d, first); } finally { working = false; }
      return;
    }
  }, 500);

  // what this scene answers: its own drawings, the posters, and — once a board is being sorted — whatever is drawn
  // about its axes (a line across one, the names at its ends, a ring on a stretch of it)
  const owns = (ids: Iterable<string>) => {
    const list = [...ids]; if (!list.length) return false;
    const axes = live(), zone = axes.length ? unionBox(axes.map(a => ({ x: Math.min(a.a[0], a.b[0]) - 500, y: Math.min(a.a[1], a.b[1]) - 1400, w: Math.abs(a.b[0] - a.a[0]) + 1000, h: Math.abs(a.b[1] - a.a[1]) + 2800 }))) : null;
    return list.every(i => { if (mine.has(i) || P.posters[i] || P.axes.some(a => a.user.includes(i))) return true; const e = byId(i); return !!(e && zone && (e.type === 'connector' || e.type === 'brush' || isText(e)) && near(mid(boxOf(e)), zone)); });
  };
  const claims = (id: string) => !!P.posters[id] || mine.has(id);
  W.cxAxes = { run, state: P, owns, claims };
  return run;
}
