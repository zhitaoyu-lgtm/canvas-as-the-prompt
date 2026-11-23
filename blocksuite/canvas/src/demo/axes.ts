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
type Card = { id: string; axis: string; from: number; to: number; title: string; lines: string[]; source: string; open: boolean; y: number; up: boolean };
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
  const textOf = (e: any): string => { if (e?.flavour === 'affine:note') return deep(e); try { const t = e.text ?? e.props?.text; if (!t) return ''; if (typeof t === 'string') return t; if (t.toString) return String(t.toString()); if (t.yText) return String(t.yText.toString()); } catch { /* none */ } return ''; };
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
    if (ms) setTimeout(() => { if (bar === b) { b.classList.add('out'); setTimeout(() => b.remove(), 300); bar = null; } }, ms);
    return b;
  }
  const hush = () => { if (bar) { const b = bar; b.classList.add('out'); setTimeout(() => b.remove(), 300); bar = null; } };

  // ── reading lines and their names ──
  type Drawn = { el: any; a: Pt; b: Pt; len: number; dir: 'h' | 'v'; label: string; ends: [string, string]; labels: string[] };
  /** a line drawn with the mouse (a connector) or a straight pen stroke, long enough to carry a scale */
  function asLine(e: any): Drawn | null {
    if (e.type !== 'connector' && e.type !== 'brush') return null;
    const p = ptsOf(e); if (p.length < 2) return null;
    let a = p[0], b = p[p.length - 1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (e.type === 'brush') { const L = p.reduce((v, q, i) => (i ? v + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0); if (!L || len / L < 0.9) return null; }
    if (len < 160) return null;
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), dir: 'h' | 'v' = dx >= dy ? 'h' : 'v';
    if (Math.min(dx, dy) / Math.max(dx, dy) > 0.36) return null;   // a slanted line is not an axis
    // a horizontal axis runs left to right, a vertical one bottom to top (its start is where the scale begins)
    if (dir === 'h' && a[0] > b[0]) [a, b] = [b, a];
    if (dir === 'v' && a[1] < b[1]) [a, b] = [b, a];
    // its names: the line's own label, words along it, words at its ends
    const own = textOf(e).trim(), reach = Math.max(70, len * 0.12);
    const named = els().filter(t => isText(t) && textOf(t).trim()).map(t => ({ t, c: mid(boxOf(t)), s: textOf(t).trim() }));
    const along = (c: Pt) => { const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, rx = c[0] - a[0], ry = c[1] - a[1], s = rx * ux + ry * uy, d = Math.abs(rx * uy - ry * ux); return { s, d }; };
    const labels: string[] = [];
    let startName = '', endName = '';
    for (const n of named) {
      const q = along(n.c);
      if (q.s > -reach && q.s < len + reach && q.d < reach) {
        labels.push(n.t.id);
        if (q.s < len * 0.15) startName = startName || n.s; else if (q.s > len * 0.85) endName = endName || n.s;
      }
    }
    const label = own || labels.map(id => textOf(byId(id)).trim()).find(Boolean) || '';
    return { el: e, a, b, len, dir, label, ends: [startName, endName], labels };
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
    for (const id of ax.user) { const e = byId(id); if (!e) continue; try { if (e.type === 'connector') surf.updateElement(id, { stroke: FAINT, strokeStyle: 'dash' }); else if (e.type === 'brush') surf.updateElement(id, { color: FAINT }); else if (isText(e) && e.type === 'text') surf.updateElement(id, { color: MUTED }); } catch { /* left as drawn */ } }
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
      if (ax.dir === 'v') { if (p1) made.push(words(`${p1}-led`, B[0] + 10 * u, B[1] + 14 * u, 12 * u, { color: '#6e6e73', align: 'left' })); if (p0) made.push(words(`${p0}-led`, A[0] + 10 * u, A[1] - 14 * u, 12 * u, { color: '#6e6e73', align: 'left' })); }
      else { if (p0) made.push(words(p0, A[0], A[1] + 20 * u, 12 * u, { color: '#6e6e73', align: 'left' })); if (p1) made.push(words(p1, B[0], B[1] + 20 * u, 12 * u, { color: '#6e6e73', align: 'right' })); }
    }
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
    const kind: 'time' | 'scale' = timeWord.test(d.label + ' ' + words2) ? 'time' : 'scale';
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
  async function secondAxis(d: Drawn, first: Axis) {
    const items = (P.items[first.id] ?? []).map(byId).filter(Boolean);
    if (!items.length) return false;
    const u = unitOf(first), x = (d.a[0] + d.b[0]) / 2;
    const [lowName, highName] = d.ends;   // bottom end, top end
    const stop = think([x + 14 * u, Math.min(d.a[1], d.b[1])]);
    await wait(1200); stop();
    const top = Math.min(d.a[1], d.b[1]), bot = Math.max(d.a[1], d.b[1]);
    const ax: Axis = { id: '', kind: 'scale', dir: 'v', a: [x, bot], b: [x, top], min: 0, max: 1, name: `${highName || 'up'}/${lowName || 'down'}`, poles: [lowName || 'down', highName || 'up'], user: [d.el.id, ...d.labels], made: [], of: first.id };
    // the year labels go up to the first axis' far side, so the lower half is free for things
    await drawAxis(ax);
    P.axes.push(ax); keep();
    const placed = await layOut(first, ax, items);
    store.captureSync?.();
    say(`No prompt · read as a 2nd axis: ${ax.poles[1]}-led ↑  ${ax.poles[0]}-led ↓`, placed, [{ label: 'Keep', dark: true, run: hush }], 0);
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
      card = { from: 1937, to: 1952, title: 'World War II era', lines: ['Why so few posters?', '• Paper and ink were rationed', '• The Bauhaus closed in 1933; its teachers emigrated', '• Posters became state propaganda, rarely kept as design', '→ The grid returns as Swiss style in the 1950s'], source: 'general knowledge' };
      events = [{ name: 'WWII 1939–45', from: 1939, to: 1945 }, { name: 'WWI 1914–18', from: 1914, to: 1918, weak: true }];
    } else {
      const ctx = items.slice(0, 40).map(e => `${Math.round(vals.get(e.id) ?? 0)}: ${(textOf(e) || posterOf(e.id)?.style || 'a picture').slice(0, 80)}`).join('\n');
      const sys = 'Answer a question asked about a stretch of a time axis on a whiteboard. JSON only: {"title":"short name of the period","from":year,"to":year,"lines":["at most five short lines"],"source":"general knowledge" or where it is from,"events":[{"name":"short","from":year,"to":year}]}. Never invent quotations.';
      try { const r = await ask(sys, `Axis "${first.name}", ${first.min}–${first.max}. The user circled ${from}–${to} (${inside.length} things there) and asked: "${question}". Things on the axis:\n${ctx}`); const j = JSON.parse(/\{[\s\S]*\}/.exec(r)?.[0] ?? '{}');
        card = { from: +j.from || from, to: +j.to || to, title: j.title || `${from}–${to}`, lines: j.lines ?? [], source: j.source || 'general knowledge' }; events = (j.events ?? []).slice(0, 3);
      } catch { card = { from, to, title: `${from}–${to}`, lines: ['Claude could not be reached to answer this.'], source: '' }; }
    }
    stop();
    // the ring has been answered: it fades
    try { if (ring.type === 'brush') surf.updateElement(ring.id, { color: FAINT }); else if (ring.type === 'shape') surf.updateElement(ring.id, { strokeColor: FAINT }); else surf.updateElement(ring.id, { stroke: FAINT }); } catch { /* left */ }
    // the card: its edges on the two years, standing where the ring was, tied to the axis by two fine lines
    const x0 = at(first, card.from)[0], x1 = at(first, card.to)[0], up = rb.y + rb.h / 2 < first.a[1];
    const y = up ? Math.min(rb.y + rb.h * 0.25, first.a[1] - 120 * u) : Math.max(rb.y + rb.h * 0.25, first.a[1] + 70 * u);
    const c: Card = { id: 'c' + Math.random().toString(36).slice(2, 8), axis: first.id, ...card, open: false, y, up };
    P.cards.push(c); keep();
    const ties = [x0, x1].map(x => line([x, up ? y + 34 * u : y], [x, first.a[1] + (up ? -2 : 2) * u], { color: MUTED, w: 0.8 * u, dash: true }));
    (c as any).ties = ties;
    renderCard(c, true);
    // the events, under the axis, from start to end
    for (const ev of events) {
      const a = at(first, ev.from)[0], b = at(first, ev.to)[0], yy = first.a[1] + (ev.weak ? 62 : 44) * u, col = ev.weak ? FAINT : MUTED;
      line([a, yy], [b, yy], { color: col, w: 1.1 * u, arrows: 'both' });
      words(ev.name, (a + b) / 2, yy + 13 * u, 11 * u, { color: ev.weak ? '#aeaeb2' : '#6e6e73' });
      await wait(160);
    }
    store.captureSync?.();
    lookAt({ x: x0 - 200 * u, y: Math.min(y, first.a[1]) - 60 * u, w: x1 - x0 + 400 * u, h: Math.abs(first.a[1] - y) + 200 * u });
    return true;
  }
  const cardEls = new Map<string, HTMLElement>();
  function renderCard(c: Card, fresh = false) {
    const ax = P.axes.find(a => a.id === c.axis); const L = layer(); if (!ax || !L) return;
    const u = unitOf(ax), x0 = at(ax, c.from)[0], x1 = at(ax, c.to)[0];
    let d = cardEls.get(c.id);
    if (!d) {
      d = document.createElement('div'); d.className = 'cx-axes-card'; cardEls.set(c.id, d); L.append(d);
      d.addEventListener('pointerdown', e => e.stopPropagation());
      d.addEventListener('click', e => { e.stopPropagation(); c.open = !c.open; keep(); d!.classList.toggle('open', c.open); });
    }
    d.innerHTML = '';
    const head = document.createElement('div'); head.className = 'cx-axes-card-head';
    head.innerHTML = '<b></b><span></span>'; (head.querySelector('b') as HTMLElement).textContent = c.title; (head.querySelector('span') as HTMLElement).textContent = `${c.from}–${c.to}`;
    const body = document.createElement('div'); body.className = 'cx-axes-card-body';
    for (const l of c.lines) { const p = document.createElement('p'); p.textContent = l; if (/^[•→]/.test(l)) p.className = l.startsWith('→') ? 'then' : 'dot'; else p.className = 'q'; body.append(p); }
    if (c.source) { const s = document.createElement('p'); s.className = 'src'; s.textContent = c.source; body.append(s); }
    d.append(head, body); d.classList.toggle('open', c.open);
    const fs = Math.max(6, Math.min(12.5 * u, (x1 - x0) / 15)), uu = fs / 12.5;
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
    // a named line and things to sort onto it
    const lines = sel.map(asLine).filter(Boolean) as Drawn[];
    const things = sel.filter(e => !lines.some(l => l.el === e || l.labels.includes(e.id)) && !mine.has(e.id) && e.type !== 'group' && e.flavour !== 'affine:frame' && e.type !== 'connector' && e.type !== 'brush' && (!isText(e) || textOf(e).trim().length > 2));
    if (lines.length && things.length >= 2 && (/sort|order|arrange|place|put|lay|timeline|onto|along|axis|排|分类|整理|放/i.test(w) || !w)) {
      const d = lines.sort((a, b) => b.len - a.len)[0];
      if (d.dir === 'h') return sortOnto(d, things, w);
    }
    return false;
  }

  // ── a line across a sorted axis is read by itself, once it is named at its ends ──
  let pointerDown = false, lastUp = 0; const seen = new Set<string>();
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
      if (!d.ends[0] && !d.ends[1]) continue;   // named at its ends first: then it is clear what the two halves are
      if (Date.now() - lastUp < 2600) return;   // a moment for the second name
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
