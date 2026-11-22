// A scripted sequence for filming (web only). Nothing here asks the model: every answer is written below.
//
//   1  a ring on a picture (a map) + any typed question      → blue dots → the ring gathers into a small drop
//   2  a click on the drop                                    → a line, then photos of the place beside the map, named
//   3  a ring (and a scribble) on the aerial photo + request  → its plan, drawn line by line
//   4  "length =" / "width =" written or typed near the plan  → the blank is filled, in the user's own hand or type
//   5  a line across the plan + request                       → the section, drawn
//   6  a ring on the section (+ an arrow out) + request       → the detail, drawn where the arrow points
//
// Which step runs is decided by the mark the user just made and what it lies on, not by the wording, so the
// same film works with a pen (rings need not close) or with shapes and lines dragged from the toolbar.
// Every size follows the picture the scene started on, so it looks the same on a small or a large map.

import { addImages } from '@blocksuite/affine/blocks/image';

import aerialSrc from '../assets/demo/aerial.jpg';
import detailSrc from '../assets/demo/detail.png';
import photo2Src from '../assets/demo/photo2.jpg';
import photo3Src from '../assets/demo/photo3.jpg';
import planSrc from '../assets/demo/plan.png';
import sectionSrc from '../assets/demo/section.png';

type Box = { x: number; y: number; w: number; h: number };
type Pt = [number, number];
const W = window as any;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const ss = (a: number, b: number, v: number) => { const x = Math.max(0, Math.min(1, (v - a) / (b - a))); return x * x * (3 - 2 * x); };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const PIC = {
  aerial: { src: aerialSrc, ratio: 979 / 600, name: 'The Colosseum in Ancient Rome', label: 'The Colosseum, Rome — seen from above' },
  photo2: { src: photo2Src, ratio: 368 / 246, name: 'Colosseum 1928 Mittelholzer', label: 'Colosseum, 1928 · W. Mittelholzer' },
  photo3: { src: photo3Src, ratio: 356 / 248, name: 'Colosseum and surroundings Mittelholzer', label: 'The Colosseum and its surroundings' },
  plan: { src: planSrc, ratio: 1242 / 999, name: 'Colosseum plan', label: 'Plan — ground floor and upper tiers' },
  section: { src: sectionSrc, ratio: 1010 / 380, name: 'Colosseum longitudinal section', label: 'Longitudinal section' },
  detail: { src: detailSrc, ratio: 413 / 470, name: 'Colosseum section detail', label: 'Detail — vaults and seating tiers' },
};
const VALUE = { length: '189 m', width: '156 m', height: '48 m' };
// What each drawing is annotated with once it is drawn: a point on it (as a fraction of its box), which side the
// note stands on, and the words. A few, not a legend.
type Note = { at: Pt; side: 'left' | 'right' | 'top' | 'bottom'; text: string };
const NOTES: Record<'plan' | 'section' | 'detail', Note[]> = {
  plan: [
    { at: [0.7, 0.2], side: 'right', text: 'Radial walls carrying the vaults' },
    { at: [0.8, 0.36], side: 'right', text: 'Cavea · seating in four tiers' },
    { at: [0.6, 0.5], side: 'right', text: 'Arena · 83 × 48 m, over the hypogeum' },
    { at: [0.9, 0.7], side: 'right', text: 'Outer arcade · 80 arches' },
  ],
  section: [
    { at: [0.045, 0.12], side: 'left', text: 'Attic storey, masts for the awning' },
    { at: [0.73, 0.47], side: 'top', text: 'Seating tiers on raking vaults' },
    { at: [0.5, 0.9], side: 'bottom', text: 'Arena floor over the hypogeum' },
    { at: [0.94, 0.78], side: 'bottom', text: 'Ring corridors, barrel-vaulted' },
  ],
  detail: [
    { at: [0.62, 0.07], side: 'right', text: 'Colonnade of the top gallery' },
    { at: [0.72, 0.5], side: 'right', text: 'Stepped seating (maenianum)' },
    { at: [0.5, 0.67], side: 'right', text: 'Stair rising inside the raking vault' },
    { at: [0.16, 0.9], side: 'bottom', text: 'Travertine piers, annular corridor' },
  ],
};

// a plain hand for the numbers the scene writes back in pen: each sign is one or two strokes in a 1-high box
const HAND: Record<string, { w: number; s: Pt[][] }> = {
  '1': { w: 0.42, s: [[[0.08, 0.3], [0.3, 0.03], [0.3, 1]]] },
  '4': { w: 0.6, s: [[[0.38, 0.02], [0.06, 0.68], [0.54, 0.68]], [[0.4, 0.38], [0.4, 1]]] },
  '5': { w: 0.58, s: [[[0.46, 0.04], [0.16, 0.04], [0.12, 0.42], [0.32, 0.36], [0.48, 0.62], [0.34, 0.96], [0.08, 0.9]]] },
  '6': { w: 0.58, s: [[[0.42, 0.03], [0.2, 0.3], [0.1, 0.68], [0.28, 0.98], [0.46, 0.76], [0.3, 0.52], [0.12, 0.68]]] },
  '8': { w: 0.58, s: [[[0.44, 0.2], [0.3, 0.03], [0.13, 0.2], [0.3, 0.46], [0.48, 0.73], [0.3, 0.98], [0.1, 0.75], [0.3, 0.46], [0.45, 0.2]]] },
  '9': { w: 0.58, s: [[[0.46, 0.24], [0.3, 0.03], [0.12, 0.22], [0.28, 0.46], [0.46, 0.26], [0.46, 0.1], [0.46, 0.62], [0.36, 1]]] },
  m: { w: 0.82, s: [[[0.06, 0.52], [0.06, 1], [0.06, 0.68], [0.22, 0.52], [0.37, 0.68], [0.37, 1], [0.37, 0.68], [0.53, 0.52], [0.68, 0.68], [0.68, 1]]] },
  ' ': { w: 0.3, s: [] },
};

export function mountRome(rootEl: any) {
  const gfx = rootEl.gfx, std = rootEl.std, store = std.store, surf = gfx.surface;
  const YText: any = () => W.cxDev?.Y;

  // one layer in board units: it follows pan and zoom, so what is drawn here sits on the board like a real thing
  const world = document.createElement('div'); world.className = 'cx-rome';
  document.body.append(world);
  let key = '';
  const follow = () => {
    const rr = rootEl.getBoundingClientRect(), z = gfx.viewport.zoom, [ox, oy] = gfx.viewport.toViewCoord(0, 0);
    const k = `${rr.left + ox},${rr.top + oy},${z}`;
    if (k !== key) { key = k; world.style.transform = `translate(${rr.left + ox}px, ${rr.top + oy}px) scale(${z})`; }
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);

  // ── what is on the board ──
  const els = () => gfx.gfxElements as any[];
  const boxOf = (e: any): Box => { const b = e.elementBound; return { x: b.x, y: b.y, w: b.w, h: b.h }; };
  const byId = (id?: string | null) => (id ? (gfx.getElementById(id) as any) : null);
  const mid = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];
  const inside = (p: Pt, b: Box, pad = 0) => p[0] > b.x - pad && p[0] < b.x + b.w + pad && p[1] > b.y - pad && p[1] < b.y + b.h + pad;
  const images = () => els().filter(e => e.flavour === 'affine:image');
  const hostOf = (b: Box) => images().filter(i => { const q = boxOf(i); return q.w * q.h > b.w * b.h * 1.3 && inside(mid(b), q); }).sort((p, q) => boxOf(p).w * boxOf(p).h - boxOf(q).w * boxOf(q).h)[0];
  const isMark = (e: any) => e.type === 'brush' || e.type === 'highlighter' || e.type === 'shape' || e.type === 'connector';
  /** the points of a drawn mark, on the board */
  const ptsOf = (e: any): Pt[] => {
    const b = boxOf(e);
    if (e.type === 'connector') { const p = (e.absolutePath ?? e.path ?? []) as any[]; if (p.length >= 2) return p.map((q: any) => [q[0] ?? q.x, q[1] ?? q.y] as Pt); return [[b.x, b.y], [b.x + b.w, b.y + b.h]]; }
    return ((e.points ?? []) as number[][]).map(q => [b.x + q[0], b.y + q[1]] as Pt);
  };
  const lengthOf = (p: Pt[]) => p.slice(1).reduce((n, q, i) => n + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
  /** a straight line, drawn by hand or with the line tool: its two ends, or null */
  const straight = (e: any): [Pt, Pt] | null => {
    if (e.type !== 'brush' && e.type !== 'connector' && e.type !== 'highlighter') return null;
    const p = ptsOf(e); if (p.length < 2) return null;
    const a = p[0], b = p[p.length - 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return d > 24 && lengthOf(p) <= d * 1.18 ? [a, b] : null;
  };
  type Ring = { el: any; host: any; pts: Pt[]; lw: number };
  /** a ring on a picture: a hand-drawn loop (it need not close, and may overshoot) or an outline ellipse / box */
  const ringOf = (el: any): Ring | null => {
    if (el.type !== 'brush' && el.type !== 'highlighter' && el.type !== 'shape') return null;
    const b = boxOf(el); if (Math.min(b.w, b.h) < 12) return null;
    const host = hostOf(b); if (!host) return null;
    if (el.type === 'shape') {
      if (el.text?.length || (el.filled && String(el.fillColor ?? '').toLowerCase() !== 'transparent')) return null;   // a note or a filled patch is not a ring
      const box = el.shapeType !== 'ellipse';
      const pts: Pt[] = Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a), k = box ? 1 / Math.max(Math.abs(c), Math.abs(s2)) : 1; return [b.x + b.w / 2 + (b.w / 2) * c * k, b.y + b.h / 2 + (b.h / 2) * s2 * k]; });
      return { el, host, pts, lw: el.strokeWidth ?? 2 };
    }
    const raw = (el.points ?? []) as number[][]; if (raw.length < 4) return null;
    // a fast hand leaves few points: walk the stroke in even steps so a four-corner box reads like a slow one
    const p: number[][] = []; { let total = 0; for (let i = 1; i < raw.length; i++) total += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]); const step = Math.max(1, total / 96);
      for (let i = 1; i < raw.length; i++) { const d = Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]), n = Math.max(1, Math.round(d / step)); for (let k = 0; k < n; k++) p.push([raw[i - 1][0] + ((raw[i][0] - raw[i - 1][0]) * k) / n, raw[i - 1][1] + ((raw[i][1] - raw[i - 1][1]) * k) / n]); } p.push(raw[raw.length - 1]); }
    // does the stroke go round? how much of the full turn around its middle it covers, staying on the rim
    const cx = b.w / 2, cy = b.h / 2, bins = new Set<number>();
    for (const q of p) bins.add(Math.floor(((Math.atan2(q[1] - cy, q[0] - cx) + Math.PI) / (Math.PI * 2)) * 24) % 24);
    const far = p.filter(q => Math.hypot((q[0] - cx) / (b.w / 2), (q[1] - cy) / (b.h / 2)) > 0.45).length / p.length;
    return bins.size >= 17 && far >= 0.8 ? { el, host, pts: p.map(q => [b.x + q[0], b.y + q[1]] as Pt), lw: el.lineWidth ?? 4 } : null;
  };

  // ── the state of the film ──
  const S: { map?: string; aerial?: string; plan?: string; section?: string; detail?: string; u: number; used: Set<string>; busy: boolean; filled: number } = { u: 1, used: new Set(), busy: false, filled: 0 };
  const scenePics = () => [S.map, S.aerial, S.plan, S.section, S.detail].filter(Boolean) as string[];
  /** the newest unused ring: on the given picture, or (with none given) on a picture that is not yet part of the film */
  const latestRing = (onId?: string): Ring | null => { for (const e of [...els()].reverse()) { if (S.used.has(e.id)) continue; const r = ringOf(e); if (r && (onId ? r.host.id === onId : !scenePics().includes(r.host.id))) return r; } return null; };
  /** a straight line that crosses the plan from side to side (the cut) */
  const cutLine = (): { el: any; a: Pt; b: Pt } | null => {
    const plan = byId(S.plan); if (!plan) return null; const pb = boxOf(plan);
    for (const e of [...els()].reverse()) { if (S.used.has(e.id)) continue; const s = straight(e); if (!s) continue; const [a, b] = s, m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (inside(m, { x: pb.x + pb.w * 0.15, y: pb.y + pb.h * 0.15, w: pb.w * 0.7, h: pb.h * 0.7 }) && Math.hypot(b[0] - a[0], b[1] - a[1]) > Math.min(pb.w, pb.h) * 0.55) return { el: e, a, b }; }
    return null;
  };

  // ── making things ──
  const blobOf = async (src: string) => { if (!src.startsWith('data:')) return (await fetch(src)).blob(); const [head, b64] = src.split(','); const bin = atob(b64), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); return new Blob([buf], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/png' }); };
  async function picture(p: { src: string; name: string }, b: Box): Promise<string | undefined> {
    const blob = await blobOf(p.src);
    const ids = await addImages(std, [new File([blob], `${p.name}.${blob.type.includes('png') ? 'png' : 'jpg'}`, { type: blob.type })], { point: [b.x + b.w / 2, b.y + b.h / 2], shouldTransformPoint: false, maxWidth: b.w });
    await wait(60);
    for (const id of ids ?? []) { const m = store.getBlock(id)?.model; if (m) store.updateBlock(m, { xywh: `[${b.x},${b.y},${b.w},${b.h}]` }); }
    try { gfx.selection.clear(); } catch { /* nothing selected */ }
    return ids?.[0];
  }
  const measure = document.createElement('canvas').getContext('2d')!;
  function label(text: string, x: number, y: number, size: number, color = '#8e8e93') {
    const Y = YText(); if (!Y) return;
    measure.font = `400 ${size}px Inter, sans-serif`; const w = Math.ceil(measure.measureText(text).width) + 4, h = Math.ceil(size * 1.4);
    const t = new Y(); t.insert(0, text);
    const id = surf.addElement({ type: 'text', xywh: `[${x},${y - h},${w},${h}]`, text: t, fontSize: size, fontWeight: '400', color, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' });
    S.used.add(id); return id;
  }
  function think(at: Pt, u: number) {
    const d = document.createElement('div'); d.className = 'cx-sense-think cx-rome-think'; d.innerHTML = '<i></i><i></i><i></i><i></i>';
    d.style.left = `${at[0]}px`; d.style.top = `${at[1]}px`; d.style.transform = `scale(${Math.max(0.6, u)})`; world.append(d);
    return () => { d.classList.add('out'); setTimeout(() => d.remove(), 300); };
  }
  /**
   * Notes on a drawing, one after another: a small dot on the part, a thin leader out to the side, a few words.
   * They are real things on the board, and are grouped with the drawing so they move and scale with it.
   */
  async function annotate(picId: string | undefined, b: Box, notes: Note[], u: number, extra: (string | undefined)[] = []) {
    const Y = YText(); if (!Y || !picId) return;
    const size = 10.5 * u, out = 20 * u, ids: string[] = [], NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.classList.add('cx-rome-ink'); svg.setAttribute('overflow', 'visible'); world.append(svg);
    const made: { from: Pt; to: Pt; text: string; tx: number; ty: number; w: number; h: number; align: string }[] = [];
    // notes on one side keep clear of each other
    const lastOn: Record<string, number> = {};
    for (const n of notes) {
      const from: Pt = [b.x + n.at[0] * b.w, b.y + n.at[1] * b.h];
      measure.font = `400 ${size}px Inter, sans-serif`; const w = Math.ceil(measure.measureText(n.text).width) + 4, h = Math.ceil(size * 1.4);
      let to: Pt, tx: number, ty: number, align = 'left';
      if (n.side === 'left' || n.side === 'right') {
        let y = from[1]; const k = n.side, min = lastOn[k] != null ? lastOn[k] + h * 1.5 : -Infinity; if (y < min) y = min; lastOn[k] = y;
        to = [n.side === 'left' ? b.x - out : b.x + b.w + out, y]; tx = n.side === 'left' ? to[0] - 5 * u - w : to[0] + 5 * u; ty = y - h / 2; align = n.side === 'left' ? 'right' : 'left';
      } else {
        let x = from[0]; const k = n.side, min = lastOn[k] != null ? lastOn[k] + 12 * u : -Infinity; if (x - w / 2 < min) x = min + w / 2; lastOn[k] = x + w / 2;
        x = Math.max(b.x + w / 2, Math.min(b.x + b.w - w / 2, x));
        to = [x, n.side === 'top' ? b.y - out * 1.6 : b.y + b.h + out]; tx = x - w / 2; ty = n.side === 'top' ? to[1] - h - 3 * u : to[1] + 3 * u;
      }
      made.push({ from, to, text: n.text, tx, ty, w, h, align });
    }
    for (const m of made) {
      const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', String(m.from[0])); dot.setAttribute('cy', String(m.from[1])); dot.setAttribute('r', String(2.2 * u)); dot.classList.add('cx-rome-notedot');
      const ln = document.createElementNS(NS, 'path'); ln.setAttribute('d', `M ${m.from[0]} ${m.from[1]} L ${m.to[0]} ${m.to[1]}`); ln.classList.add('cx-rome-leader'); ln.style.strokeWidth = String(Math.max(0.5, 0.8 * u));
      const len = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]); ln.style.strokeDasharray = String(len); ln.style.strokeDashoffset = String(len);
      svg.append(ln, dot); void (ln as any).getBoundingClientRect(); ln.style.strokeDashoffset = '0'; dot.classList.add('on');
      const tx = document.createElement('div'); tx.className = 'cx-rome-note'; tx.textContent = m.text;
      Object.assign(tx.style, { left: `${m.tx}px`, top: `${m.ty}px`, width: `${m.w}px`, height: `${m.h}px`, fontSize: `${size}px`, lineHeight: `${m.h}px`, textAlign: m.align });
      world.append(tx); setTimeout(() => tx.classList.add('on'), 150); (m as any).node = tx;
      await wait(170);
    }
    await wait(380);
    for (const m of made) {
      ids.push(surf.addElement({ type: 'connector', mode: 0, source: { position: m.from }, target: { position: m.to }, stroke: '#8e8e93', strokeWidth: Math.max(1, Math.round(u)), strokeStyle: 'solid', frontEndpointStyle: 'None', rearEndpointStyle: 'None' }));
      const t = new Y(); t.insert(0, m.text);
      ids.push(surf.addElement({ type: 'text', xywh: `[${m.tx},${m.ty},${m.w},${m.h}]`, text: t, fontSize: size, fontWeight: '400', color: '#6e6e73', fontFamily: 'blocksuite:surface:Inter', textAlign: m.align }));
    }
    for (const id of ids) S.used.add(id);
    // one thing from now on: the drawing, its name and its notes
    try { const all = [picId, ...extra.filter(Boolean) as string[], ...ids]; const g = surf.addElement({ type: 'group', children: Object.fromEntries(all.map(i => [i, true])), title: new Y('') }); S.used.add(g); } catch (e) { console.warn('[rome] group', e); }
    setTimeout(() => { svg.remove(); for (const m of made) (m as any).node?.remove(); }, 140);
  }

  /** a photo arrives: it slides out from the left edge of its place, then becomes a real picture on the board */
  async function arrive(p: typeof PIC.aerial, b: Box, delay: number, text: number) {
    const img = document.createElement('img'); img.className = 'cx-rome-pop'; img.src = p.src; img.draggable = false;
    Object.assign(img.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, transitionDelay: `${delay}ms` });
    world.append(img); void img.offsetWidth; img.classList.add('on');
    await wait(delay + 640);
    const id = await picture(p, b); label(p.label, b.x, b.y - text * 0.45, text);
    setTimeout(() => img.remove(), 160);
    return id;
  }

  /**
   * A line drawing appears as if drawn: pens travel along the structure (rings for a plan, courses for a section)
   * and the drawing shows only where a pen has passed; the strokes start thin and settle to the full drawing.
   */
  async function draw(p: typeof PIC.plan, b: Box, kind: 'rings' | 'courses', ms = 1500): Promise<string | undefined> {
    const im = new Image(); im.src = p.src; await im.decode().catch(() => {});
    const cw = Math.min(1400, im.naturalWidth || 1000), ch = Math.round(cw / p.ratio);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; cv.className = 'cx-rome-draw';
    Object.assign(cv.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }); world.append(cv);
    const ctx = cv.getContext('2d')!, mask = document.createElement('canvas'); mask.width = cw; mask.height = ch; const mx = mask.getContext('2d')!;
    const tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = ch; const tx = tmp.getContext('2d')!;
    // the paths of the pens, each a list of points; all are drawn at once, a little out of step
    const paths: Pt[][] = []; let band = 0;
    if (kind === 'rings') {
      const n = 9; band = (Math.min(cw, ch) / 2 / n) * 1.5;
      for (let k = 0; k < n; k++) { const f = 1.02 - (k / n) * 0.98, a0 = k * 2.1, dir = k % 2 ? -1 : 1; paths.push(Array.from({ length: 73 }, (_, i) => { const a = a0 + dir * (i / 72) * Math.PI * 2.04; return [cw / 2 + (cw / 2) * f * Math.cos(a), ch / 2 + (ch / 2) * f * Math.sin(a)] as Pt; })); }
      paths.push([[cw * 0.42, ch / 2], [cw * 0.58, ch / 2]]);
    } else {
      const n = 11; band = (ch / n) * 1.5;
      for (let k = 0; k < n; k++) { const y = ((k + 0.5) / n) * ch, l2r = k % 2 === 0; paths.push(Array.from({ length: 25 }, (_, i) => { const t = i / 24; return [(l2r ? t : 1 - t) * cw, y + Math.sin(t * 9 + k) * band * 0.06] as Pt; })); }
    }
    const lens = paths.map(lengthOf);
    const t0 = performance.now();
    await new Promise<void>(done => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        mx.clearRect(0, 0, cw, ch); mx.lineCap = 'round'; mx.lineJoin = 'round'; mx.strokeStyle = '#000';
        // thin at first (lines being drawn), opening to the whole drawing at the end
        mx.lineWidth = band * (0.16 + 0.95 * ss(0.5, 1, t));
        const tips: Pt[] = [];
        paths.forEach((path, k) => {
          const lag = (k / paths.length) * 0.34, prog = ease(Math.max(0, Math.min(1, (t - lag) / 0.6))), want = prog * lens[k];
          if (want <= 0) return;
          mx.beginPath(); mx.moveTo(path[0][0], path[0][1]); let acc = 0, tip = path[0];
          for (let i = 1; i < path.length; i++) { const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (acc + d <= want) { mx.lineTo(path[i][0], path[i][1]); acc += d; tip = path[i]; } else { const f = (want - acc) / d; tip = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f]; mx.lineTo(tip[0], tip[1]); break; } }
          mx.stroke(); if (prog < 1) tips.push(tip);
        });
        tx.globalCompositeOperation = 'source-over'; tx.clearRect(0, 0, cw, ch); tx.drawImage(im, 0, 0, cw, ch); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mask, 0, 0);
        ctx.clearRect(0, 0, cw, ch); ctx.globalAlpha = ss(0, 0.12, t); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; ctx.drawImage(tmp, 0, 0);
        ctx.fillStyle = '#111'; for (const tip of tips) { ctx.beginPath(); ctx.arc(tip[0], tip[1], Math.max(2, cw / 420), 0, Math.PI * 2); ctx.fill(); }
        if (t < 1) requestAnimationFrame(frame); else done();
      };
      requestAnimationFrame(frame);
    });
    ctx.clearRect(0, 0, cw, ch); ctx.drawImage(im, 0, 0, cw, ch);
    const id = await picture(p, b);
    setTimeout(() => cv.remove(), 180);
    return id;
  }

  // ── 1 · the ring on the map gathers into a drop; 2 · the drop opens the photos ──
  async function identify(ring: Ring) {
    const { el, host, pts, lw } = ring, sb = boxOf(el), hb = boxOf(host), u = (S.u = hb.h / 410);
    S.map = host.id; S.used.add(el.id);
    const stop = think([sb.x - 22 * u, sb.y], u); await wait(1700); stop();
    const N = 72, [cx, cy] = mid(sb);
    const ringN: Pt[] = Array.from({ length: N }, (_, i) => { const a = (i / N) * Math.PI * 2; let best = pts[0], bd = 9; for (const p of pts) { const pa = Math.atan2(p[1] - cy, p[0] - cx), d = Math.abs(Math.atan2(Math.sin(pa - a), Math.cos(pa - a))); if (d < bd) { bd = d; best = p; } } return best; });
    const R = 7 * u, dot = { x: sb.x + sb.w + R + 3 * u, y: cy };
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.classList.add('cx-rome-ink'); svg.setAttribute('overflow', 'visible');
    const line = document.createElementNS(NS, 'path'); line.classList.add('cx-rome-line');
    const path = document.createElementNS(NS, 'path'); path.classList.add('cx-rome-drop');
    svg.append(line, path); world.append(svg);
    const smooth = (q: Pt[]) => { let d = ''; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], mx2 = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2; d += i ? ` Q ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${mx2.toFixed(2)} ${my2.toFixed(2)}` : `M ${mx2.toFixed(2)} ${my2.toFixed(2)}`; } const a = q[0], b = q[1]; return d + ` Q ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${((a[0] + b[0]) / 2).toFixed(2)} ${((a[1] + b[1]) / 2).toFixed(2)} Z`; };
    // the drop: a circle to the eye; only its edge moves, a few hundredths of the radius, slowly
    const drop = (t: number, hover = 0): Pt[] => Array.from({ length: N }, (_, i) => { const a = (i / N) * Math.PI * 2; const r = (R + hover) * (1 + 0.034 * Math.sin(2 * a + t * 0.8) + 0.024 * Math.sin(3 * a - t * 1.1 + 1.7) + 0.012 * Math.sin(5 * a + t * 0.6 + 0.4)); return [dot.x + r * Math.cos(a), dot.y + r * Math.sin(a)]; });
    path.setAttribute('d', smooth(ringN)); path.style.strokeWidth = String(lw); path.style.fillOpacity = '0';
    surf.deleteElement(el.id); try { gfx.selection.clear(); } catch { /* nothing selected */ }
    let alive = true, hover = 0, hoverTo = 0; const t0 = performance.now();
    await new Promise<void>(done => {
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 900), e = ease(k), target = drop(now / 1000);
        path.setAttribute('d', smooth(ringN.map((p, i) => [p[0] + (target[i][0] - p[0]) * e, p[1] + (target[i][1] - p[1]) * e] as Pt)));
        path.style.strokeWidth = String(lw * (1 - ss(0.82, 1, e))); path.style.fillOpacity = String(ss(0.62, 0.96, e));
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    const live = (now: number) => { if (!alive) return; hover += (hoverTo - hover) * 0.14; path.setAttribute('d', smooth(drop(now / 1000, hover))); requestAnimationFrame(live); };
    requestAnimationFrame(live);

    const hit = document.createElement('button'); hit.className = 'cx-rome-hit'; hit.setAttribute('aria-label', 'Show');
    Object.assign(hit.style, { left: `${dot.x - 16 * u}px`, top: `${dot.y - 16 * u}px`, width: `${32 * u}px`, height: `${32 * u}px` }); world.append(hit);
    hit.onpointerenter = () => { hoverTo = 1.6 * u; }; hit.onpointerleave = () => { hoverTo = 0; };
    const gap = 14 * u, ax = hb.x + hb.w + gap;
    line.setAttribute('d', `M ${dot.x + R - u} ${dot.y} L ${ax} ${dot.y}`); line.style.strokeWidth = String(Math.max(0.6, u));
    const len = Math.max(1, ax - dot.x - R + u); line.style.strokeDasharray = String(len); line.style.strokeDashoffset = String(len);
    let opened = false;
    hit.onclick = async () => {
      if (opened) return; opened = true; hit.style.cursor = 'default'; hoverTo = 0;
      line.style.transition = 'stroke-dashoffset 460ms cubic-bezier(.22,1,.36,1)'; line.style.strokeDashoffset = '0';
      await wait(300);
      // the photos stand beside the map: the large one as tall as the map, the two smaller ones stacked beside it
      const text = 11.5 * u, A: Box = { x: ax, y: hb.y, w: hb.h * PIC.aerial.ratio, h: hb.h };
      const sh = (hb.h - gap - text * 1.9) / 2, bx = A.x + A.w + gap;
      const B: Box = { x: bx, y: hb.y, w: sh * PIC.photo2.ratio, h: sh }, C: Box = { x: bx, y: hb.y + hb.h - sh, w: sh * PIC.photo3.ratio, h: sh };
      const [a] = await Promise.all([arrive(PIC.aerial, A, 0, text), arrive(PIC.photo2, B, 140, text), arrive(PIC.photo3, C, 240, text)]);
      S.aerial = a; store.captureSync?.();
    };
    // the drop belongs to its map: it follows it, and leaves with it
    const base = { hx: hb.x, hy: hb.y };
    const watch = setInterval(() => { const h = byId(host.id); if (!h) { alive = false; clearInterval(watch); svg.remove(); hit.remove(); return; } const b = boxOf(h), dx = b.x - base.hx, dy = b.y - base.hy; for (const n of [svg, hit] as any[]) n.style.translate = dx || dy ? `${dx}px ${dy}px` : ''; }, 120);
  }

  /** a free place for a drawing of this size: tried below, then right, of the thing it comes from */
  function placeBy(from: Box, w: number, h: number, prefer: 'below' | 'right', gap: number): Box {
    const taken = els().filter(e => e.type !== 'group' && !(isMark(e) && S.used.has(e.id))).map(boxOf);   // their own lines and words count too
    const free = (b: Box) => !taken.some(o => b.x < o.x + o.w + gap / 3 && b.x + b.w > o.x - gap / 3 && b.y < o.y + o.h + gap / 3 && b.y + b.h > o.y - gap / 3);
    const below: Box = { x: from.x + (from.w - w) / 2, y: from.y + from.h + gap, w, h }, right: Box = { x: from.x + from.w + gap, y: from.y + (from.h - h) / 2, w, h };
    let b = prefer === 'below' ? below : right; for (let i = 0; i < 30 && !free(b); i++) b = prefer === 'below' ? { ...b, y: b.y + gap } : { ...b, x: b.x + gap };
    return b;
  }

  // ── 3 · the building on the photo → its plan ──
  async function plan(ring: Ring) {
    const hb = boxOf(ring.host), rb = boxOf(ring.el), u = S.u;
    S.used.add(ring.el.id); for (const e of els()) if (isMark(e) && inside(mid(boxOf(e)), rb, 4)) S.used.add(e.id);   // the scribble inside the ring
    const stop = think([rb.x - 22 * u, rb.y], u); await wait(1500); stop();
    const w = hb.w * 0.78, b = placeBy(hb, w, w / PIC.plan.ratio, 'below', 56 * u);
    S.plan = await draw(PIC.plan, b, 'rings', 1400); const l = label(PIC.plan.label, b.x, b.y - 5 * u, 11.5 * u); await annotate(S.plan, b, NOTES.plan, u, [l]); store.captureSync?.();
  }
  // ── 5 · a line across the plan → the section ──
  async function section(cut: { el: any; a: Pt; b: Pt } | null) {
    const pb = boxOf(byId(S.plan)), u = S.u; if (cut) S.used.add(cut.el.id);
    const stop = think(cut ? [Math.min(cut.a[0], cut.b[0]) - 22 * u, Math.min(cut.a[1], cut.b[1]) - 10 * u] : [pb.x - 22 * u, pb.y], u); await wait(1500); stop();
    const w = pb.w * 1.08, h = w / PIC.section.ratio;
    let b = placeBy(pb, w, h, 'right', 56 * u);
    if (cut && Math.abs(b.x - (pb.x + pb.w)) < 80 * u) b = { ...b, y: (cut.a[1] + cut.b[1]) / 2 - h / 2 };   // beside the plan: level with the cut
    S.section = await draw(PIC.section, b, 'courses', 1300); const l = label(PIC.section.label, b.x, b.y - 5 * u, 11.5 * u); await annotate(S.section, b, NOTES.section, u, [l]); store.captureSync?.();
  }
  // ── 6 · a ring on the section (and an arrow out of it) → the detail ──
  async function detail(ring: Ring) {
    const sb = boxOf(ring.host), rb = boxOf(ring.el), u = S.u; S.used.add(ring.el.id);
    // an arrow or line that leaves the ring says where the detail should go
    let tip: Pt | null = null;
    for (const e of [...els()].reverse()) { if (S.used.has(e.id) || e.id === ring.el.id) continue; const s = straight(e); if (!s) continue; const near = (p: Pt) => inside(p, rb, Math.max(rb.w, rb.h) * 0.2); if (near(s[0]) !== near(s[1])) { tip = near(s[0]) ? s[1] : s[0]; S.used.add(e.id); break; } }
    const stop = think([rb.x - 22 * u, rb.y], u); await wait(1500); stop();
    const h = Math.max(sb.h * 1.15, rb.h * 1.2), w = h * PIC.detail.ratio;
    let b: Box;
    if (tip) { const [rx, ry] = mid(rb), dx = tip[0] - rx, dy = tip[1] - ry, g = 18 * u; b = Math.abs(dx) >= Math.abs(dy) ? { x: dx > 0 ? tip[0] + g : tip[0] - g - w, y: tip[1] - h / 2, w, h } : { x: tip[0] - w / 2, y: dy > 0 ? tip[1] + g : tip[1] - g - h, w, h }; }
    else b = placeBy(sb, w, h, 'right', 56 * u);
    S.detail = await draw(PIC.detail, b, 'courses', 1200); const l = label(PIC.detail.label, b.x, b.y - 5 * u, 11.5 * u); await annotate(S.detail, b, NOTES.detail, u, [l]); store.captureSync?.();
  }

  // ── 4 · "length =" → the blank is filled, typed like theirs or written like theirs ──
  const whichOf = (word: string): keyof typeof VALUE | null => (/长|length|long|^l$/i.test(word) ? 'length' : /宽|width|wide|^w$/i.test(word) ? 'width' : /高|height|tall|^h$/i.test(word) ? 'height' : null);
  const OPEN = /^\s*([A-Za-z一-鿿]{1,10})\s*[=＝:：]\s*$/;
  /** typed: the same text simply goes on, letter by letter */
  async function fillTyped() {
    if (!S.plan || gfx.selection.editing) return;
    for (const e of els()) {
      if (S.used.has(e.id)) continue;
      const yt = e.type === 'text' ? e.text : e.flavour === 'affine:edgeless-text' ? e.children?.[0]?.text?.yText ?? e.children?.[0]?.text : null; if (!yt?.insert) continue;
      const m = OPEN.exec(String(yt.toString?.() ?? '')); if (!m) continue; const which = whichOf(m[1]); if (!which) continue;
      S.used.add(e.id);
      const add = (/\s$/.test(yt.toString()) ? '' : ' ') + VALUE[which];
      await wait(500);
      for (const ch of add) { yt.insert(yt.length, ch); if (e.type === 'text') { measure.font = `${e.fontWeight ?? 400} ${e.fontSize ?? 16}px Inter, sans-serif`; const b = boxOf(e), w = Math.ceil(measure.measureText(yt.toString()).width) + 6; if (w > b.w) surf.updateElement(e.id, { xywh: `[${b.x},${b.y},${w},${b.h}]` }); } await wait(55); }
      store.captureSync?.();
    }
  }
  /** written by hand: small strokes ending in an "=" (two short level strokes, one over the other) */
  let writing = false;
  async function fillWritten() {
    if (!S.plan || S.busy || writing) return;
    const pb = boxOf(byId(S.plan)), small = Math.max(pb.w, pb.h) * 0.22;
    const strokes = els().filter(e => e.type === 'brush' && !S.used.has(e.id)).map(e => ({ e, b: boxOf(e) })).filter(s => s.b.w < small && s.b.h < small);
    const bars = strokes.filter(s => s.b.w > 6 && s.b.w >= s.b.h * 2.2);
    for (let i = bars.length - 1; i > 0; i--) for (let j = i - 1; j >= 0; j--) {
      const p = bars[i], q = bars[j], w = Math.max(p.b.w, q.b.w);
      const overlap = Math.min(p.b.x + p.b.w, q.b.x + q.b.w) - Math.max(p.b.x, q.b.x), dy = Math.abs(mid(p.b)[1] - mid(q.b)[1]);
      if (overlap < w * 0.5 || dy < w * 0.12 || dy > w * 1.1) continue;
      // the word before it: other small strokes just to its left
      const eq: Box = { x: Math.min(p.b.x, q.b.x), y: Math.min(p.b.y, q.b.y), w, h: Math.max(p.b.y + p.b.h, q.b.y + q.b.h) - Math.min(p.b.y, q.b.y) };
      const word = strokes.filter(s => s !== p && s !== q && s.b.x + s.b.w <= eq.x + w * 0.3 && s.b.x > eq.x - w * 9 && Math.abs(mid(s.b)[1] - mid(eq)[1]) < w * 2.2);
      if (!word.length) continue;
      for (const s of [p, q, ...word]) S.used.add(s.e.id);
      // which measure: the long straight line nearest the writing says (level = length, upright = width); else in order
      const lines = els().map(e => ({ e, s: straight(e) })).filter(x => x.s && Math.hypot(x.s![1][0] - x.s![0][0], x.s![1][1] - x.s![0][1]) > Math.min(pb.w, pb.h) * 0.45 && !inside(mid(boxOf(x.e)), { x: pb.x + pb.w * 0.2, y: pb.y + pb.h * 0.2, w: pb.w * 0.6, h: pb.h * 0.6 }));
      const m0 = mid(eq), dist = (x: any) => Math.hypot(mid(boxOf(x.e))[0] - m0[0], mid(boxOf(x.e))[1] - m0[1]), nearest = lines.sort((a, b) => dist(a) - dist(b))[0];
      const which: keyof typeof VALUE = nearest ? (Math.abs(nearest.s![1][0] - nearest.s![0][0]) >= Math.abs(nearest.s![1][1] - nearest.s![0][1]) ? 'length' : 'width') : (['length', 'width', 'height'] as const)[S.filled % 3];
      S.filled++;
      const all = [...word, p, q].map(s => s.b), top = Math.min(...all.map(b => b.y)), bot = Math.max(...all.map(b => b.y + b.h));
      writing = true; await wait(450);
      try { await write(VALUE[which], eq.x + w * 1.55, top, Math.max(eq.h * 1.5, (bot - top) * 0.9), p.e.color, p.e.lineWidth ?? 4); } finally { writing = false; }
      return;
    }
  }
  /** write with the pen: each stroke is drawn, then left on the board as a real pen stroke in the user's colour and width */
  async function write(text: string, x: number, y: number, h: number, color: any, lw: number) {
    const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.classList.add('cx-rome-ink'); svg.setAttribute('overflow', 'visible'); world.append(svg);
    let cx = x; const made: { pts: Pt[]; node: SVGPathElement }[] = [];
    for (const ch of text) {
      const g = HAND[ch] ?? HAND[' '];
      for (const s of g.s) {
        // a hand is never exact: each point is a little off
        const pts = s.map(([px, py], i) => [cx + px * h + Math.sin(i * 12.9 + cx) * h * 0.012, y + py * h + Math.cos(i * 7.3 + cx) * h * 0.012] as Pt);
        // a rounded path through the points
        const dense: Pt[] = []; for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]; for (let k = 0; k < 8; k++) { const t = k / 8, t2 = t * t, t3 = t2 * t; dense.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); } } dense.push(pts[pts.length - 1]);
        const node = document.createElementNS(NS, 'path'); node.setAttribute('d', 'M ' + dense.map(q => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join(' L '));
        Object.assign(node.style, { fill: 'none', stroke: typeof color === 'string' ? color : '#1e1e1e', strokeWidth: String(lw), strokeLinecap: 'round', strokeLinejoin: 'round' });
        const len = lengthOf(dense); node.style.strokeDasharray = String(len); node.style.strokeDashoffset = String(len); svg.append(node);
        const ms = Math.max(90, Math.min(260, (len / h) * 90)); node.style.transition = `stroke-dashoffset ${ms}ms linear`; void (node as any).getBoundingClientRect(); node.style.strokeDashoffset = '0';
        made.push({ pts: dense, node }); await wait(ms + 30);
      }
      cx += g.w * h;
    }
    for (const m of made) { const x0 = Math.min(...m.pts.map(q => q[0])), y0 = Math.min(...m.pts.map(q => q[1])), x1 = Math.max(...m.pts.map(q => q[0])), y1 = Math.max(...m.pts.map(q => q[1])); const id = surf.addElement({ type: 'brush', points: m.pts.map(q => [q[0] - x0, q[1] - y0]), xywh: `[${x0},${y0},${Math.max(1, x1 - x0)},${Math.max(1, y1 - y0)}]`, color, lineWidth: lw }); S.used.add(id); }
    store.captureSync?.(); setTimeout(() => svg.remove(), 120);
  }

  // ── which step the user's last mark asks for ──
  type Step = { run: () => Promise<void>; select: string };
  function next(): Step | null {
    const onSection = S.section && !S.detail ? latestRing(S.section) : null; if (onSection) return { run: () => detail(onSection), select: onSection.el.id };
    const onAerial = S.aerial && !S.plan ? latestRing(S.aerial) : null; if (onAerial) return { run: () => plan(onAerial), select: onAerial.el.id };
    const cut = S.plan && !S.section ? cutLine() : null; if (cut) return { run: () => section(cut), select: cut.el.id };
    const first = !S.map ? latestRing() : null; if (first) return { run: () => identify(first), select: first.el.id };
    return null;
  }
  async function run(request = ''): Promise<boolean> {
    if (S.busy) return true;
    let step = next();
    if (!step && S.plan && !S.section && /section|剖/i.test(request)) step = { run: () => section(null), select: '' };   // asked in words, no line drawn
    if (!step) return false;
    S.busy = true; document.body.classList.add('cx-rome-busy'); try { gfx.selection.clear(); } catch { /* nothing selected */ }
    try { await step.run(); } catch (e) { console.warn('[rome]', e); } finally { S.busy = false; setTimeout(() => document.body.classList.remove('cx-rome-busy'), 500); }
    return true;
  }

  // The mark is already half the question: when the pen lifts from a ring on a picture, a scribble inside it, or
  // a line across the plan, the prompt opens on it, ready for the words.
  let pointerDown = false, lastUp = 0, offered = '';
  addEventListener('pointerdown', () => { pointerDown = true; }, true);
  addEventListener('pointerup', ev => {
    pointerDown = false; lastUp = Date.now();
    if ((ev.target as HTMLElement)?.closest?.('.cx-dock, .cx-ai-layer, .cx-rome-hit')) return;
    setTimeout(() => {
      if (pointerDown || S.busy || gfx.selection.editing) return;
      const step = next(); if (!step || !step.select) return;
      const sig = step.select + ':' + els().length; if (sig === offered) return; offered = sig;   // once per mark (again after a scribble is added)
      try { gfx.tool.setTool('default'); } catch { /* stays on the pen */ }
      gfx.selection.set({ elements: [step.select], editing: false });
      setTimeout(() => dispatchEvent(new Event('cx-ai-open')), 220);
    }, 420);
  }, true);
  setInterval(() => { if (!pointerDown && Date.now() - lastUp > 1100) { void fillTyped(); void fillWritten(); } }, 400);

  /** The background reading leaves the film's own marks and pictures alone. */
  const owns = (ids: Set<string>) => {
    if (S.busy) return true; if (!ids.size) return false;
    const pics = new Set(scenePics());
    return [...ids].every(id => {
      const e = byId(id); if (!e) return true; if (pics.has(id) || S.used.has(id)) return true;
      if (e.type === 'text' || e.flavour === 'affine:edgeless-text') return !!S.plan;
      if (!isMark(e)) return !!S.map && e.flavour === 'affine:image';
      const b = boxOf(e); if (hostOf(b) || ringOf(e)) return true;
      const plan = byId(S.plan); if (!plan) return false; const pb = boxOf(plan); return inside(mid(b), pb, Math.max(pb.w, pb.h) * 0.6);
    });
  };

  W.cxRome = { owns, run, next, state: S };
  /** A typed request goes to the film when the last mark fits one of its steps; false means "not mine". */
  return async (request: string): Promise<boolean> => run(request);
}
