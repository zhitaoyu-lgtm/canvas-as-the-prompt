// The character scene (web only, for filming): a small figure is changed step by step by what is drawn around it.
//
//   look      a thing drawn near it (an apple) + "look at the apple"       → its eyes turn to the thing
//   hair      an outline sketched over its head                            → that hair, filled in
//   material  a picture of a material, with an arrow to the figure         → the figure in that material
//   eyes      a picture of a material, with an arrow to an eye             → the eyes in that material
//   light     a lamp drawn with a beam toward it (+ words the first time)  → its cast shadow, away from the lamp
//
// For the filmed figure (the black blob from the Figma frame) every step uses the drawn pictures from Figma, so
// it looks the same at every take. For any other picture the same steps are computed from the picture itself:
// its outline, its body and its eyes are found and changed directly (which works best for flat figures; a
// photograph gets a shadow and a material, but its eyes may not be found).
//
// Which step runs is read from what was drawn and where; words are only needed where the drawing alone could mean
// several things (an apple near the figure; the first lamp).

import s1Src from '../assets/demo/char/s1.png';
import s2Src from '../assets/demo/char/s2.png';
import s3Src from '../assets/demo/char/s3.png';
import s4Src from '../assets/demo/char/s4.webp';
import s5Src from '../assets/demo/char/s5.webp';
import sh6Src from '../assets/demo/char/shadow6.webp';
import sh7Src from '../assets/demo/char/shadow7.webp';
import fleeceSrc from '../assets/demo/char/tex-fleece.jpg';
import glassSrc from '../assets/demo/char/tex-glass.jpg';

type Box = { x: number; y: number; w: number; h: number };
type Pt = [number, number];
type Op = 'look' | 'hair' | 'material' | 'eyes' | 'light';
const W = window as any;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const FILM = [s1Src, s1Src, s2Src, s3Src, s4Src, s5Src];   // index = step (1..5)
const FRAME = { w: 448, h: 460 };
// where the figure sits in each filmed frame (frame units): every step shares the Figma frame, so frames line up
const BODY = [[94, 140, 260.5, 235.5], [94, 140, 260.5, 235.5], [94, 140, 260.5, 235.5], [37, 73, 374, 313], [17.5, 53, 412, 341.5], [17.5, 53, 412, 341.5]];                           // every filmed step is a picture of this shape
// the filmed shadows, in the frame's units, against the frame's top-left
// (rendered bounds of the Figma shadows against their frames: the shadow starts under the figure, so they touch)
const SHADOW = { right: { src: sh6Src, x: 85.9, y: 274.5, w: 725.6, h: 123.3 }, left: { src: sh7Src, x: -418.5, y: 274.5, w: 744.3, h: 123.3 } };

// ── looking at pictures ──────────────────────────────────────────────────────────────────────────────────────────
type Look = { w: number; h: number; cv: HTMLCanvasElement; mask: Uint8Array; box: Box; eyes: { mask: Uint8Array; box: Box; cx: number; cy: number }[]; body: [number, number, number] };
const loaded = new Map<string, Promise<HTMLImageElement>>();
const imageOf = (src: string) => { let p = loaded.get(src); if (!p) { p = new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; }); loaded.set(src, p); } return p; };
function canvasOf(w: number, h: number) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

/** a picture, read: where the figure is (against a clear or plain ground), its eyes (light shapes inside it), its colour */
function read(img: HTMLImageElement | HTMLCanvasElement, max = 900): Look {
  const iw = (img as any).naturalWidth ?? img.width, ih = (img as any).naturalHeight ?? img.height, k = Math.min(1, max / Math.max(iw, ih));
  const w = Math.round(iw * k), h = Math.round(ih * k), cv = canvasOf(w, h), x = cv.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, n = w * h, mask = new Uint8Array(n);
  let clear = 0; for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 20) clear++;
  if (clear > n * 0.04) { for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3] > 110 ? 1 : 0; }
  else {
    // a plain ground: what can be reached from the edges through colours like the corners' is ground
    const cs = [0, w - 1, n - w, n - 1].map(i => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]), bg = [0, 1, 2].map(c => cs.reduce((s, q) => s + q[c], 0) / 4);
    const near = (i: number) => Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]) < 70;
    const seen = new Uint8Array(n), st: number[] = [];
    for (let i = 0; i < w; i++) { st.push(i, n - w + i); } for (let j = 0; j < h; j++) { st.push(j * w, j * w + w - 1); }
    while (st.length) { const i = st.pop()!; if (seen[i] || !near(i)) continue; seen[i] = 1; const px = i % w, py = (i / w) | 0; if (px > 0) st.push(i - 1); if (px < w - 1) st.push(i + 1); if (py > 0) st.push(i - w); if (py < h - 1) st.push(i + w); }
    for (let i = 0; i < n; i++) mask[i] = seen[i] ? 0 : 1;
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (mask[j * w + i]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  const box: Box = x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  // eyes: light patches wholly inside the figure
  const L = (i: number) => 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  let area = 0; for (let i = 0; i < n; i++) area += mask[i];
  const lab = new Int32Array(n), eyes: Look['eyes'] = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (lab[s] || !mask[s] || L(s) < 175) continue;
    id++; const st = [s], pix: number[] = []; let touches = false; lab[s] = id;
    while (st.length) { const i = st.pop()!; pix.push(i); const px = i % w, py = (i / w) | 0;
      for (const q of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1]) { if (q < 0) { touches = true; continue; } if (!mask[q]) { touches = true; continue; } if (!lab[q] && L(q) >= 175) { lab[q] = id; st.push(q); } } }
    if (touches || pix.length < area * 0.0015 || pix.length > area * 0.09) continue;
    const em = new Uint8Array(n); let ex0 = w, ey0 = h, ex1 = 0, ey1 = 0, sx = 0, sy = 0;
    for (const i of pix) { em[i] = 1; const px = i % w, py = (i / w) | 0; sx += px; sy += py; if (px < ex0) ex0 = px; if (px > ex1) ex1 = px; if (py < ey0) ey0 = py; if (py > ey1) ey1 = py; }
    eyes.push({ mask: em, box: { x: ex0, y: ey0, w: ex1 - ex0 + 1, h: ey1 - ey0 + 1 }, cx: sx / pix.length, cy: sy / pix.length });
  }
  eyes.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h); eyes.length = Math.min(eyes.length, 4);
  // the figure's own colour: the middle of what is neither ground nor eye
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0; i < n; i += 7) if (mask[i] && !eyes.some(e => e.mask[i])) { rs.push(d[i * 4]); gs.push(d[i * 4 + 1]); bs.push(d[i * 4 + 2]); }
  const med = (a: number[]) => (a.sort((p, q) => p - q)[a.length >> 1] ?? 0);
  return { w, h, cv, mask, box, eyes, body: [med(rs), med(gs), med(bs)] };
}
/** a mask as a picture (white where set), for clipping */
function maskCanvas(m: Uint8Array, w: number, h: number, dilate = 0) {
  const c = canvasOf(w, h), x = c.getContext('2d')!, im = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) if (m[i]) { im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
  if (dilate > 0) { const c2 = canvasOf(w, h), y = c2.getContext('2d')!; y.filter = `blur(${dilate}px)`; y.drawImage(c, 0, 0); y.filter = 'none'; const id2 = y.getImageData(0, 0, w, h); for (let i = 3; i < id2.data.length; i += 4) id2.data[i] = id2.data[i] > 20 ? 255 : 0; y.putImageData(id2, 0, 0); return c2; }
  return c;
}
/** the figure's own surface, as a fill: a patch of its body repeated (plain colour for a flat figure) */
function bodyFill(a: Look, x: CanvasRenderingContext2D): string | CanvasPattern {
  const [r, g, b] = a.body, d = a.cv.getContext('2d')!.getImageData(a.box.x, a.box.y, a.box.w, a.box.h).data;
  let v = 0, n = 0; for (let i = 0; i < d.length; i += 28) if (d[i + 3] > 200) { v += Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b); n++; }
  if (n && v / n < 24) return `rgb(${r},${g},${b})`;
  const s = Math.round(Math.min(a.box.w, a.box.h) * 0.22), cx = Math.round(a.box.x + a.box.w * 0.5 - s / 2), cy = Math.round(a.box.y + a.box.h * 0.72 - s / 2);
  const p = canvasOf(s, s); p.getContext('2d')!.drawImage(a.cv, cx, cy, s, s, 0, 0, s, s);
  return x.createPattern(p, 'repeat') ?? `rgb(${r},${g},${b})`;
}

// ── the changes, for any picture ────────────────────────────────────────────────────────────────────────────────
/** eyes turned toward a point (picture units): each eye moves within the face toward it, a little larger */
function turnEyes(a: Look, to: Pt): HTMLCanvasElement | null {
  if (!a.eyes.length) return null;
  const c = canvasOf(a.w, a.h), x = c.getContext('2d')!; x.drawImage(a.cv, 0, 0);
  const ex = a.eyes.reduce((s, e) => s + e.cx, 0) / a.eyes.length, ey = a.eyes.reduce((s, e) => s + e.cy, 0) / a.eyes.length;
  const dx = to[0] - ex, dy = to[1] - ey, len = Math.hypot(dx, dy) || 1, eh = a.eyes.reduce((s, e) => s + e.box.h, 0) / a.eyes.length;
  const shift = Math.min(eh * 0.55, a.box.w * 0.08), mx = (dx / len) * shift, my = (dy / len) * shift;
  // the old eyes are covered by the face, then drawn again where they now look
  x.save(); x.drawImage(maskCanvas(a.eyes.map(e => e.mask).reduce((m, q) => { for (let i = 0; i < m.length; i++) m[i] |= q[i]; return m; }, new Uint8Array(a.w * a.h)), a.w, a.h, 2), 0, 0);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = bodyFill(a, x); x.fillRect(0, 0, a.w, a.h); x.restore();
  const under = canvasOf(a.w, a.h), u = under.getContext('2d')!; u.drawImage(a.cv, 0, 0);   // the base again, the face where the eyes were
  u.save(); u.globalCompositeOperation = 'source-over'; u.drawImage(c, 0, 0); u.restore();
  for (const e of a.eyes) {
    const sprite = canvasOf(a.w, a.h), s = sprite.getContext('2d')!; s.drawImage(maskCanvas(e.mask, a.w, a.h, 0.6), 0, 0); s.globalCompositeOperation = 'source-in'; s.drawImage(a.cv, 0, 0);
    const k = 1.12, ox = e.cx + mx, oy = e.cy + my;
    u.save(); u.translate(ox, oy); u.scale(k, k); u.translate(-e.cx, -e.cy); u.drawImage(sprite, 0, 0); u.restore();
  }
  // nothing may spill outside the figure
  const out = canvasOf(a.w, a.h), o = out.getContext('2d')!; o.drawImage(under, 0, 0); o.globalCompositeOperation = 'destination-in'; o.drawImage(maskCanvas(a.mask, a.w, a.h), 0, 0);
  return out;
}
/** an outline drawn over the head (picture units) filled in as part of the figure, behind its face */
function addHair(a: Look, line: Pt[]): { cv: HTMLCanvasElement; dx: number; dy: number } {
  let x0 = 0, y0 = 0, x1 = a.w, y1 = a.h; for (const [px, py] of line) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  const pad = 4, dx = Math.ceil(-x0) + pad, dy = Math.ceil(-y0) + pad, c = canvasOf(x1 - x0 + pad * 2, y1 - y0 + pad * 2), x = c.getContext('2d')!;
  x.drawImage(a.cv, dx, dy);
  x.save(); x.globalCompositeOperation = 'destination-over'; x.translate(dx, dy);
  x.beginPath(); line.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
  // closed through the head: from the last point back to the first, below the outline
  x.closePath(); const f = bodyFill(a, x); x.fillStyle = f; x.fill(); x.lineJoin = 'round'; x.lineWidth = Math.max(2, a.box.w * 0.012); x.strokeStyle = f; x.stroke();
  x.restore();
  return { cv: c, dx, dy };
}
/** the figure's body in a material (a picture of it), with some roundness and a soft, uneven outline */
function inMaterial(a: Look, tex: HTMLImageElement): HTMLCanvasElement {
  const pad = Math.round(a.box.w * 0.04), c = canvasOf(a.w + pad * 2, a.h + pad * 2), x = c.getContext('2d')!;
  const body = maskCanvas(a.mask, a.w, a.h), fuzz = canvasOf(c.width, c.height), f = fuzz.getContext('2d')!;
  // an outline that follows the material: the edge grows a little where the material is light
  f.drawImage(body, pad, pad); f.filter = `blur(${Math.max(1, pad * 0.45)}px)`; f.drawImage(fuzz, 0, 0); f.filter = 'none';
  const t = canvasOf(c.width, c.height), tx = t.getContext('2d')!, tile = Math.max(60, a.box.w / 2.2);
  const pat = tx.createPattern((() => { const p = canvasOf(tile, tile); p.getContext('2d')!.drawImage(tex, 0, 0, tile, tile); return p; })(), 'repeat')!;
  tx.fillStyle = pat; tx.fillRect(0, 0, t.width, t.height);
  const fd = f.getImageData(0, 0, c.width, c.height), td = tx.getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < fd.data.length; i += 4) { const lum = (td[i] + td[i + 1] + td[i + 2]) / 765, a0 = fd.data[i + 3] / 255; fd.data[i + 3] = a0 > 0.92 ? 255 : Math.max(0, Math.min(255, (a0 + (lum - 0.45) * 0.9) * 255 * (a0 > 0.15 ? 1 : 0))); }
  f.putImageData(fd, 0, 0);
  x.drawImage(t, 0, 0); x.globalCompositeOperation = 'destination-in'; x.drawImage(fuzz, 0, 0);
  // roundness: lighter toward the upper middle, darker toward the rim
  x.globalCompositeOperation = 'source-atop';
  const g = x.createRadialGradient(pad + a.box.x + a.box.w * 0.45, pad + a.box.y + a.box.h * 0.38, a.box.w * 0.05, pad + a.box.x + a.box.w * 0.5, pad + a.box.y + a.box.h * 0.5, a.box.w * 0.62);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
  // the face stays as it was
  x.globalCompositeOperation = 'source-over';
  for (const e of a.eyes) { const sp = canvasOf(a.w, a.h), s = sp.getContext('2d')!; s.drawImage(maskCanvas(e.mask, a.w, a.h, 0.6), 0, 0); s.globalCompositeOperation = 'source-in'; s.drawImage(a.cv, 0, 0); x.drawImage(sp, pad, pad); }
  return c;
}
/** the eyes in a material: filled with it, with a soft rim and a highlight, as glass or stone would look */
function eyesIn(a: Look, tex: HTMLImageElement): HTMLCanvasElement | null {
  if (!a.eyes.length) return null;
  const c = canvasOf(a.w, a.h), x = c.getContext('2d')!; x.drawImage(a.cv, 0, 0);
  for (const e of a.eyes) {
    const sp = canvasOf(a.w, a.h), s = sp.getContext('2d')!, b = e.box;
    s.drawImage(maskCanvas(e.mask, a.w, a.h, 0.6), 0, 0); s.globalCompositeOperation = 'source-in';
    const k = Math.max(b.w, b.h) * 1.25; s.drawImage(tex, tex.naturalWidth * 0.2, tex.naturalHeight * 0.2, tex.naturalWidth * 0.6, tex.naturalHeight * 0.6, e.cx - k / 2, e.cy - k / 2, k, k);
    const g = s.createLinearGradient(0, b.y, 0, b.y + b.h); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(60,60,70,0.28)');
    s.globalCompositeOperation = 'source-atop'; s.fillStyle = g; s.fillRect(b.x, b.y, b.w, b.h);
    const hl = s.createRadialGradient(b.x + b.w * 0.36, b.y + b.h * 0.28, 0, b.x + b.w * 0.36, b.y + b.h * 0.28, b.w * 0.32); hl.addColorStop(0, 'rgba(255,255,255,0.95)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    s.fillStyle = hl; s.fillRect(b.x, b.y, b.w, b.h);
    x.drawImage(sp, 0, 0);
  }
  return c;
}
/** the shadow a lamp at `light` (picture units) casts on the ground the figure stands on, and where it goes */
function castShadow(a: Look, light: Pt): { cv: HTMLCanvasElement; x: number; y: number } {
  const base = a.box.y + a.box.h, cx = a.box.x + a.box.w / 2, H = a.box.h;
  const ly = Math.min(light[1], base - H * 0.25), K = Math.max(-3.2, Math.min(3.2, ((cx - light[0]) / (base - ly)) * 1.35)), S = 0.16;
  const len = Math.abs(K) * H, blur = Math.max(4, a.box.w * 0.035), pad = blur * 3;
  const w = a.w + len + pad * 2, h = H * S + pad * 2 + a.box.h * 0.12, ox = (K < 0 ? len : 0) + pad, oy = pad - (base - H * S);
  const c = canvasOf(w, h), x = c.getContext('2d')!;
  x.filter = `blur(${blur}px)`;
  // each point of the figure, a height above the ground, falls that far times K along the ground, flattened by S
  x.setTransform(1, 0, -K, S, ox + K * base, oy + base * (1 - S));
  x.drawImage(maskCanvas(a.mask, a.w, a.h), 0, 0);
  x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
  x.globalCompositeOperation = 'source-in';
  // darkest where it touches the figure, fading with distance
  const g = x.createLinearGradient(ox + cx, 0, ox + cx + K * H, 0); g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0.08)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  return { cv: c, x: -ox, y: -oy };
}

// ── the scene on the board ──────────────────────────────────────────────────────────────────────────────────────
export function mountChar(rootEl: any) {
  const gfx = rootEl.gfx, std = rootEl.std, store = std.store, surf = gfx.surface;
  const els = () => gfx.gfxElements as any[];
  const boxOf = (e: any): Box => { const b = e.elementBound; return { x: b.x, y: b.y, w: b.w, h: b.h }; };
  const byId = (id?: string | null) => (id ? (gfx.getElementById(id) as any) : null);
  const mid = (b: Box): Pt => [b.x + b.w / 2, b.y + b.h / 2];
  const near = (p: Pt, b: Box, pad = 0) => p[0] > b.x - pad && p[0] < b.x + b.w + pad && p[1] > b.y - pad && p[1] < b.y + b.h + pad;
  const isMark = (e: any) => e.type === 'brush' || e.type === 'highlighter' || e.type === 'shape' || e.type === 'connector';
  const images = () => els().filter(e => e.flavour === 'affine:image');
  const ptsOf = (e: any): Pt[] => {
    const b = boxOf(e);
    if (e.type === 'connector') { const p = (e.absolutePath ?? e.path ?? []) as any[]; if (p.length >= 2) return p.map((q: any) => [q[0] ?? q.x, q[1] ?? q.y] as Pt); return [[b.x, b.y], [b.x + b.w, b.y + b.h]]; }
    if (e.type === 'shape') return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    return ((e.points ?? []) as number[][]).map(q => [b.x + q[0], b.y + q[1]] as Pt);
  };

  // what the scene has made, kept across reloads; a piece counts only while it is still on the board
  type Info = { film?: number; lit?: boolean; from?: string; lamp?: string[] };
  const P: { chain: Record<string, Info>; tex: Record<string, 'fleece' | 'glass' | 'other'> } = (() => { try { return { chain: {}, tex: {}, ...JSON.parse(localStorage.getItem('cx:char') || '{}') }; } catch { return { chain: {}, tex: {} }; } })();
  const keep = () => { try { localStorage.setItem('cx:char', JSON.stringify(P)); } catch { /* not kept */ } };
  const chainOf = (id: string) => { const c = P.chain[id]; if (c && !byId(id)) { delete P.chain[id]; keep(); return undefined; } return c; };
  const used = new Set<string>(), mine = new Set<string>();
  const old = new Set<string>(); let oldTaken = false;
  const takeOld = () => { if (oldTaken) return; oldTaken = true; for (const e of els()) old.add(e.id); };
  setTimeout(takeOld, 5000);
  const fresh = (e: any) => isMark(e) && !used.has(e.id) && !old.has(e.id) && !mine.has(e.id);

  // pictures: their content, read once
  const blobOfImage = async (e: any): Promise<Blob | null> => { try { return (await store.blobSync.get(e.props?.sourceId ?? e.sourceId)) ?? null; } catch { return null; } };
  const reads = new Map<string, Promise<{ img: HTMLImageElement; look: Look } | null>>();
  const readImage = (e: any) => {
    const key = String(e.props?.sourceId ?? e.sourceId ?? e.id); let p = reads.get(key);
    if (!p) { p = (async () => { const b = await blobOfImage(e); if (!b) return null; const url = URL.createObjectURL(b); const img = await imageOf(url); return { img, look: read(img) }; })().catch(() => null); reads.set(key, p); }
    return p;
  };
  // is this the filmed figure (its first look), or one of the filmed materials? compared by shape, not by file
  const shapeSig = (a: Look) => { const s = 20, out = new Uint8Array(s * s); for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const px = Math.floor(a.box.x + ((i + 0.5) / s) * a.box.w), py = Math.floor(a.box.y + ((j + 0.5) / s) * a.box.h); out[j * s + i] = a.mask[py * a.w + px] ? 1 : 0; } return { out, eyes: a.eyes.length }; };
  const colourSig = (img: HTMLImageElement) => { const c = canvasOf(12, 12), x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, 12, 12); return x.getImageData(0, 0, 12, 12).data; };
  // every filmed picture, so the scene can be entered at any of them: a picture dragged in, or one brought back
  // by undo, is recognised by its outline, where its eyes are and what they look like
  const filmTex = Promise.all([imageOf(fleeceSrc), imageOf(glassSrc)]).then(([f, g]) => ({ fleece: colourSig(f), glass: colourSig(g) }));
  type Sig = { out: Uint8Array; eyes: Pt[]; eyeLum: number; body: number };
  const sigOf = (a: Look): Sig => {
    const d = a.cv.getContext('2d')!.getImageData(0, 0, a.w, a.h).data; let lum = 0, n = 0;
    for (const e of a.eyes) for (let i = 0; i < e.mask.length; i += 3) if (e.mask[i]) { lum += d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]; n++; }
    return { out: shapeSig(a).out, eyes: a.eyes.map(e => [(e.cx - a.box.x) / a.box.w, (e.cy - a.box.y) / a.box.h] as Pt).sort((p, q) => p[0] - q[0]), eyeLum: n ? lum / n / 3 : 0, body: (a.body[0] + a.body[1] + a.body[2]) / 3 };
  };
  const filmSigs = Promise.all(FILM.slice(1).map(src => imageOf(src).then(i => sigOf(read(i)))));
  /** which filmed step a picture is (1–5), or 0 */
  async function filmStageOf(e: any): Promise<number> {
    const r = await readImage(e); if (!r || r.look.eyes.length < 2) return 0;
    const a = sigOf(r.look), all = await filmSigs; let best = 0, bestScore = 0;
    all.forEach((b, k) => {
      let both = 0, any = 0; for (let i = 0; i < a.out.length; i++) { if (a.out[i] && b.out[i]) both++; if (a.out[i] || b.out[i]) any++; }
      const iou = any ? both / any : 0; if (iou < 0.86 || Math.abs(a.body - b.body) > 40) return;
      const eyeD = a.eyes.length === b.eyes.length ? a.eyes.reduce((v, p, i) => v + Math.hypot(p[0] - b.eyes[i][0], p[1] - b.eyes[i][1]), 0) / a.eyes.length : 1;
      const score = iou - eyeD * 1.5 - Math.abs(a.eyeLum - b.eyeLum) / 255;
      if (score > bestScore) { bestScore = score; best = k + 1; }
    });
    return best;
  }
  const isFilmStart = async (e: any) => (await filmStageOf(e)) > 0;
  async function texKind(e: any): Promise<'fleece' | 'glass' | 'other'> {
    if (P.tex[e.id]) return P.tex[e.id];
    const r = await readImage(e); if (!r) return 'other';
    const s = colourSig(r.img), t = await filmTex, diff = (q: Uint8ClampedArray) => { let v = 0; for (let i = 0; i < s.length; i += 4) v += Math.abs(s[i] - q[i]) + Math.abs(s[i + 1] - q[i + 1]) + Math.abs(s[i + 2] - q[i + 2]); return v / (s.length / 4) / 3; };
    const f = diff(t.fleece), g = diff(t.glass); return f < 18 && f < g ? 'fleece' : g < 18 ? 'glass' : 'other';
  }

  // ── reading what was drawn ──
  /** the figure an act is about: a picture of this scene's chain near the marks, else the picture nearest them */
  function subjectNear(at: Box): any | null {
    const c = mid(at), list = images().filter(i => !P.tex[i.id]);
    const d = (i: any) => { const b = boxOf(i); const dx = Math.max(b.x - c[0], 0, c[0] - b.x - b.w), dy = Math.max(b.y - c[1], 0, c[1] - b.y - b.h); return Math.hypot(dx, dy) / Math.max(1, Math.min(b.w, b.h)); };
    const ranked = list.map(i => ({ i, d: d(i) - (chainOf(i.id) ? 0.6 : 0) })).filter(q => q.d < 1.6).sort((p, q) => p.d - q.d);
    return ranked[0]?.i ?? null;
  }
  const unionBox = (bs: Box[]): Box => { const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  /** where in the picture a board point falls (picture units of its reading) */
  const toPic = (e: any, a: Look, p: Pt): Pt => { const b = boxOf(e); return [((p[0] - b.x) / b.w) * a.w, ((p[1] - b.y) / b.h) * a.h]; };
  /** the figure's outline on the board */
  const figureBox = (e: any, a: Look): Box => { const b = boxOf(e), k = b.w / a.w; return { x: b.x + a.box.x * k, y: b.y + a.box.y * k, w: a.box.w * k, h: a.box.h * k }; };

  type Plan = { op: Op; subject: any; marks: any[]; tex?: any; to?: Pt; light?: Pt; line?: Pt[] };
  /** what the newest marks ask for, read from the drawing (and the words, where given) */
  async function planFor(words: string): Promise<Plan | null> {
    const marks = els().filter(fresh); if (!marks.length && !/light|shadow|影|光/i.test(words)) return null;
    const all = marks.length ? unionBox(marks.map(boxOf)) : null;
    // a picture with an arrow to the figure: a material (for an eye, if the arrow ends on one). Either end of the
    // line may be its start; the material is the smaller picture, the figure is one of the scene's if there is one
    const at = (p: Pt) => images().filter(i => near(p, boxOf(i), Math.max(16, Math.min(boxOf(i).w, boxOf(i).h) * 0.1)))
      .sort((i, j) => { const bi = boxOf(i), bj = boxOf(j); return (near(p, bi) ? 0 : 1) - (near(p, bj) ? 0 : 1) || bi.w * bi.h - bj.w * bj.h; });
    for (const m of marks) {
      const p = ptsOf(m); if (p.length < 2) continue;
      const a = p[0], z = p[p.length - 1], A = at(a), Z = at(z);
      let best: { tex: any; subject: any; to: Pt; score: number } | null = null;
      for (const [T, S, to] of [[A, Z, z], [Z, A, a]] as [any[], any[], Pt][]) for (const tex of T) for (const subject of S) {
        if (tex.id === subject.id || (claims(tex.id) && !P.tex[tex.id])) continue;   // a figure of the scene is never the material
        const bt = boxOf(tex), bs = boxOf(subject), score = (claims(subject.id) ? 4 : 0) + (claims(tex.id) && !P.tex[tex.id] ? -4 : 0) + (bt.w * bt.h < bs.w * bs.h ? 2 : 0) + (to === z ? 0.5 : 0);
        if (!best || score > best.score) best = { tex, subject, to, score };
      }
      if (!best) continue;
      const { tex, subject, to } = best, r = await readImage(subject); if (!r) continue;
      const tp = toPic(subject, r.look, to), onEye = r.look.eyes.some(e => near(tp, e.box, Math.max(e.box.w, e.box.h) * 0.12));
      return { op: onEye || /eye|眼/i.test(words) ? 'eyes' : 'material', subject, marks: [m], tex };
    }
    if (!all) { const s = images().filter(i => chainOf(i.id)).pop(); return s ? null : null; }
    // the figure the drawing points into (the ends of its lines inside it), else the nearest; of a strip, the newest
    const leaf = (i: any) => !Object.values(P.chain).some(c => (c as any).from === i.id);
    const pointed = images().filter(i => !P.tex[i.id]).map(i => { const b = boxOf(i); let n = 0; for (const m of marks) { const p = ptsOf(m); if (p.length > 1 && [p[0], p[p.length - 1]].some(q => near(q, b, b.w * 0.04))) n++; } return { i, n: n + (n && leaf(i) ? 0.5 : 0) }; })
      .filter(q => q.n > 0).sort((a, b) => b.n - a.n);
    const subject = pointed[0]?.i ?? subjectNear(all); if (!subject) return null;
    const r = await readImage(subject); if (!r) return null;
    const fig = figureBox(subject, r.look);
    // hair: a line that stays over the head (most of it within the figure's width, around its top)
    const over = marks.filter(m => { const b = boxOf(m), p = ptsOf(m); if (Math.max(b.w, b.h) < fig.w * 0.3 || !p.length) return false;
      const inn = p.filter(q => q[0] > fig.x - fig.w * 0.12 && q[0] < fig.x + fig.w * 1.12 && q[1] > fig.y - fig.h * 0.7 && q[1] < fig.y + fig.h * 0.45).length;
      return inn / p.length > 0.85 && b.y < fig.y + fig.h * 0.2; });
    const outside = marks.filter(m => { const b = boxOf(m); return !(b.x < fig.x + fig.w && b.x + b.w > fig.x && b.y < fig.y + fig.h && b.y + b.h > fig.y); });
    const lightWords = /light|lamp|torch|flashlight|shadow|影|光|灯|手电/i.test(words), lookWords = /look|gaze|stare|watch|toward|看|望|盯|注视/i.test(words), hairWords = /hair|头发|发/i.test(words);
    // a lamp: marks outside the figure, above its ground, the far ends giving where the light is
    const lamp = (): Pt | null => {
      const parts = marks.filter(m => !over.includes(m)); if (!parts.length) return null;
      const c = mid(fig); let sx = 0, sy = 0, n = 0;
      for (const m of parts) { const far = ptsOf(m).sort((p, q) => Math.hypot(q[0] - c[0], q[1] - c[1]) - Math.hypot(p[0] - c[0], p[1] - c[1]))[0]; if (far) { sx += far[0]; sy += far[1]; n++; } }
      if (!n) return null; const L: Pt = [sx / n, sy / n]; return L[1] < fig.y + fig.h * 0.9 ? L : null;
    };
    if (lookWords && outside.length) return { op: 'look', subject, marks: outside, to: mid(unionBox(outside.map(boxOf))) };
    if ((hairWords || (!lightWords && !lookWords)) && over.length) return { op: 'hair', subject, marks: over, line: over.flatMap(ptsOf) };
    const L = lamp();
    if (L && (lightWords || chainOf(subject.id)?.lit)) return { op: 'light', subject, marks: marks.filter(m => !over.includes(m)), light: L };
    if (lightWords) { const c = mid(fig); return { op: 'light', subject, marks, light: [c[0] - fig.w, fig.y - fig.h] }; }
    if (lookWords) return outside.length ? { op: 'look', subject, marks: outside, to: mid(unionBox(outside.map(boxOf))) } : null;
    return null;
  }

  // ── showing the answer ──
  const world = document.querySelector('.cx-rome') as HTMLElement | null;
  const layer = () => (document.querySelector('.cx-rome') as HTMLElement | null) ?? world;
  function think(at: Pt, u: number) {
    const d = document.createElement('div'); d.className = 'cx-sense-think cx-rome-think'; d.innerHTML = '<i></i><i></i><i></i><i></i>';
    d.style.left = `${at[0]}px`; d.style.top = `${at[1]}px`; d.style.transform = `scale(${Math.max(0.6, u)})`; layer()?.append(d);
    return () => { d.classList.add('out'); setTimeout(() => d.remove(), 300); };
  }
  const blobFrom = async (src: string | HTMLCanvasElement): Promise<Blob> => {
    if (typeof src !== 'string') return new Promise(ok => src.toBlob(b => ok(b!), 'image/png'));
    if (!src.startsWith('data:')) return (await fetch(src)).blob();
    const [head, b64] = src.split(','); const bin = atob(b64), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/png' });
  };
  type Reveal = { mode: 'develop' | 'radial' | 'rise' | 'ground'; fx?: number; fy?: number };
  /** a new picture on the board, shown the way it came about: developed (a new look), spreading from where the
   *  arrow touched (a material), growing up from the head (hair), or spreading along the ground (a shadow) */
  async function reveal(src: string | HTMLCanvasElement, b: Box, ms = 1100, how: Reveal = { mode: 'develop' }, midway?: () => void): Promise<string> {
    const blob = await blobFrom(src), url = URL.createObjectURL(blob), im = await imageOf(url);
    const ov = document.createElement('img'); ov.src = url; ov.className = `cx-char-dev ${how.mode}`;
    const fx = `${((how.fx ?? 0.5) * 100).toFixed(1)}%`, fy = `${((how.fy ?? 0.5) * 100).toFixed(1)}%`;
    Object.assign(ov.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, transitionDuration: `${ms}ms`, transformOrigin: `${fx} ${fy}` });
    if (how.mode === 'radial') ov.style.clipPath = `circle(0% at ${fx} ${fy})`;
    layer()?.append(ov);
    void ov.getBoundingClientRect(); ov.classList.add('on');
    if (how.mode === 'radial') ov.style.clipPath = `circle(150% at ${fx} ${fy})`;
    if (midway) setTimeout(midway, ms * 0.35);
    await wait(ms);
    const sourceId = await store.blobSync.set(blob);
    const id = store.addBlock('affine:image', { sourceId, xywh: `[${b.x},${b.y},${b.w},${b.h}]`, width: im.naturalWidth, height: im.naturalHeight } as any, surf.id) as string;
    mine.add(id); setTimeout(() => ov.remove(), 450);
    return id;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  /** an SVG sheet in board units over a box, for lines that are shown only while something happens */
  function sheet(b: Box) {
    const sv = document.createElementNS(svgNS, 'svg'); sv.setAttribute('class', 'cx-char-svg');
    sv.setAttribute('width', String(b.w)); sv.setAttribute('height', String(b.h)); sv.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
    Object.assign(sv.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, overflow: 'visible' }); layer()?.append(sv);
    return { sv, gone: (ms = 350) => { sv.classList.add('out'); setTimeout(() => sv.remove(), ms); } };
  }
  /** a line drawn from a to z over ms (the link to the next picture is drawn first, then becomes the board's arrow) */
  async function drawLine(a: Pt, z: Pt, u: number, ms: number, dashed = false, colour = '#1d1d1f') {
    const box = unionBox([{ x: a[0], y: a[1], w: 1, h: 1 }, { x: z[0], y: z[1], w: 1, h: 1 }]), s2 = sheet(box);
    const l = document.createElementNS(svgNS, 'line'), len = Math.hypot(z[0] - a[0], z[1] - a[1]);
    for (const [k, v] of Object.entries({ x1: a[0], y1: a[1], x2: z[0], y2: z[1], stroke: colour, 'stroke-width': Math.max(1, 1.6 * u), 'stroke-linecap': 'round' })) l.setAttribute(k, String(v));
    if (dashed) l.setAttribute('stroke-dasharray', `${4 * u} ${5 * u}`);
    const m = document.createElementNS(svgNS, 'mask'), mid2 = `cxm${Math.random().toString(36).slice(2)}`; m.setAttribute('id', mid2); m.setAttribute('maskUnits', 'userSpaceOnUse');
    const ml = l.cloneNode() as SVGLineElement; ml.setAttribute('stroke', '#fff'); ml.removeAttribute('stroke-dasharray'); ml.setAttribute('stroke-width', String(Math.max(4, 6 * u)));
    ml.style.strokeDasharray = `${len}`; ml.style.strokeDashoffset = `${len}`; ml.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.3,.6,.2,1)`;
    m.append(ml); s2.sv.append(m); l.setAttribute('mask', `url(#${mid2})`); s2.sv.append(l);
    void s2.sv.getBoundingClientRect(); ml.style.strokeDashoffset = '0';
    await wait(ms); return s2;
  }
  /** a small copy of the material carried along the arrow into the figure */
  async function carry(src: string, from: Box, to: Pt, ms: number) {
    const ov = document.createElement('img'); ov.src = src; ov.className = 'cx-char-carry';
    Object.assign(ov.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.w}px`, height: `${from.h}px`, transitionDuration: `${ms}ms` }); layer()?.append(ov);
    void ov.getBoundingClientRect();
    const k = 0.18; ov.style.transform = `translate(${to[0] - from.x - (from.w * k) / 2}px, ${to[1] - from.y - (from.h * k) / 2}px) scale(${k})`; ov.style.opacity = '0.2';
    await wait(ms); ov.remove();
  }
  /** the lamp's light, a soft wedge from the lamp across the figure, shown while its shadow is cast */
  function beam(light: Pt, fig: Box) {
    const far = light[0] < fig.x + fig.w / 2 ? fig.x + fig.w * 1.6 : fig.x - fig.w * 0.6;
    const top: Pt = [far, fig.y - fig.h * 0.1], bot: Pt = [far, fig.y + fig.h * 1.05];
    const s2 = sheet(unionBox([{ x: light[0], y: light[1], w: 1, h: 1 }, { x: top[0], y: top[1], w: 1, h: 1 }, { x: bot[0], y: bot[1], w: 1, h: 1 }]));
    const g = document.createElementNS(svgNS, 'linearGradient'), id2 = `cxb${Math.random().toString(36).slice(2)}`; g.setAttribute('id', id2); g.setAttribute('gradientUnits', 'userSpaceOnUse');
    g.setAttribute('x1', String(light[0])); g.setAttribute('y1', String(light[1])); g.setAttribute('x2', String(far)); g.setAttribute('y2', String((top[1] + bot[1]) / 2));
    g.innerHTML = '<stop offset="0" stop-color="#ffe9a8" stop-opacity=".6"/><stop offset=".55" stop-color="#fff3cf" stop-opacity=".22"/><stop offset="1" stop-color="#fff8e6" stop-opacity="0"/>';
    const poly = document.createElementNS(svgNS, 'polygon'); poly.setAttribute('points', [light, top, bot].map(q => q.join(',')).join(' ')); poly.setAttribute('fill', `url(#${id2})`);
    s2.sv.append(g, poly); s2.sv.classList.add('cx-char-beam'); void s2.sv.getBoundingClientRect(); s2.sv.classList.add('on');
    return s2;
  }
  /** hand-drawn marks fade out, then go */
  async function fadeAway(ids: string[]) {
    const items = ids.map(byId).filter(Boolean).map((e: any) => ({ e, key: e.type === 'connector' || e.type === 'shape' ? 'stroke' : 'color', c0: String((e.type === 'connector' || e.type === 'shape' ? e.stroke : e.color) ?? '#1d1d1f') }));
    const rgb = (c: string) => { const m = /^#?([0-9a-f]{6})/i.exec(c); const n = m ? parseInt(m[1], 16) : 0x1d1d1f; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    await wait(250);
    for (let k = 1; k <= 8; k++) {
      for (const it of items) { const [r2, g2, b2] = rgb(it.c0); try { surf.updateElement(it.e.id, { [it.key]: `rgba(${r2},${g2},${b2},${(1 - k / 8).toFixed(2)})` }); } catch { /* stays as it is */ } }
      await wait(45);
    }
    for (const it of items) { try { surf.deleteElement(it.e.id); } catch { /* gone */ } }
  }

  let busy = false;
  async function perform(plan: Plan): Promise<boolean> {
    const { subject } = plan, r = await readImage(subject); if (!r) return false;
    for (const m of plan.marks) used.add(m.id);
    const info: Info = chainOf(subject.id) ?? await (async () => { const n = await filmStageOf(subject); return n ? { film: n } : {}; })();
    const sb = boxOf(subject), fig = figureBox(subject, r.look), u = sb.w / FRAME.w;
    const marksBox = plan.marks.length ? unionBox(plan.marks.map(boxOf)) : fig;
    const stop = think([marksBox.x - 22 * u, marksBox.y], u);
    const t0 = Date.now();
    // the filmed figure, at the step this act belongs to: the drawn picture
    const film = info.film, tex = plan.tex ? await texKind(plan.tex) : undefined;
    if (film && film < 5 && tex === 'glass' && plan.op === 'material') plan.op = 'eyes';   // in the film, glass is for the eyes
    if (film && film < 4 && tex === 'fleece' && plan.op === 'eyes') plan.op = 'material';   // and fleece for the body
    // steps need not come in order: an act goes to the filmed picture of its step when that step is ahead of the
    // figure (the filmed pictures build on each other); an act the figure is already past is done on it directly
    const stepOf: Record<string, number> = { look: 2, hair: 3, material: tex === 'fleece' ? 4 : 0, eyes: tex === 'glass' ? 5 : 0 };
    const want = stepOf[plan.op] ?? 0, filmNext = film && want > film ? want : 0;
    let out: { src: string | HTMLCanvasElement; w: number; h: number; film?: number } | null = null;
    let shadow: { src: string | HTMLCanvasElement; x: number; y: number; w: number; h: number } | null = null;   // against the new picture's box
    // the frame the filmed pictures share, sized from this figure (its body is 260.5 of 448 at step 1)
    const frameScale = film ? fig.w / BODY[film][2] : 0, frameTop = film ? fig.y - BODY[film][1] * frameScale : 0, frameLeft = film ? fig.x - BODY[film][0] * frameScale : 0;
    if (filmNext) out = { src: FILM[filmNext], w: FRAME.w * frameScale, h: FRAME.h * frameScale, film: filmNext };
    else if (plan.op === 'light' && film && film >= 3) {
      const right = plan.light![0] < mid(fig)[0], s = right ? SHADOW.right : SHADOW.left, k = frameScale;
      out = { src: FILM[Math.min(5, film)], w: FRAME.w * k, h: FRAME.h * k, film };   // the same picture: only the light changes
      shadow = { src: s.src, x: s.x * k, y: s.y * k, w: s.w * k, h: s.h * k };
    } else {
      const a = r.look, img = r.img, k = sb.w / a.w;
      if (plan.op === 'look') { const c = turnEyes(a, toPic(subject, a, plan.to!)); if (c) out = { src: c, w: sb.w, h: sb.h }; }
      else if (plan.op === 'hair') { const h = addHair(a, plan.line!.map(p => toPic(subject, a, p))); out = { src: h.cv, w: h.cv.width * k, h: h.cv.height * k }; (out as any).dy = h.dy * k; (out as any).dx = h.dx * k; }
      else if (plan.op === 'material' && plan.tex) { const t = (await readImage(plan.tex))?.img; if (t) { const c = inMaterial(a, t); out = { src: c, w: c.width * k, h: c.height * k }; (out as any).dy = (out as any).dx = Math.round(a.box.w * 0.04) * k; } }
      else if (plan.op === 'eyes' && plan.tex) { const t = (await readImage(plan.tex))?.img; if (t) { const c = eyesIn(a, t); if (c) out = { src: c, w: sb.w, h: sb.h }; } }
      else if (plan.op === 'light') { const s = castShadow(a, toPic(subject, a, plan.light!)); out = { src: img.src, w: sb.w, h: sb.h }; shadow = { src: s.cv, x: s.x * k, y: s.y * k, w: s.cv.width * k, h: s.cv.height * k }; }
    }
    const left = Math.max(0, (filmNext || shadow && film ? 1500 : 900) - (Date.now() - t0)); await wait(left); stop();
    if (!out) { say(plan.op === 'look' || plan.op === 'eyes' ? 'I could not find the eyes in this picture.' : 'Nothing to change here.', fig, u); return true; }
    // the change happens in place: the figure stays where it is and becomes the next picture
    const dx = (out as any).dx ?? 0, dy = (out as any).dy ?? 0;
    const place: Box = film ? { x: frameLeft, y: frameTop, w: out.w, h: out.h } : { x: sb.x - dx, y: sb.y - dy, w: out.w, h: out.h };
    W.cxRome?.lookAt?.(unionBox([fig, ...(plan.tex ? [boxOf(plan.tex)] : []), ...(plan.light ? [{ x: plan.light[0], y: plan.light[1], w: 1, h: 1 }] : []), ...(plan.op === 'look' && plan.to ? [{ x: plan.to[0], y: plan.to[1], w: 1, h: 1 }] : [])]));
    await wait(450);
    const remove = (id: string) => { try { const m = store.getBlock(id)?.model; if (m) { store.deleteBlock(m); return; } } catch { /* not a block */ } try { surf.deleteElement(id); } catch { /* gone */ } };
    // what was understood, shown on the figure first: where it looks, what flows in, where the light comes from
    const touched = plan.tex && plan.marks[0] ? (() => { const p = ptsOf(plan.marks[0]); const a2 = p[0], z2 = p[p.length - 1]; return near(a2, boxOf(subject), 4) ? a2 : z2; })() : null;
    if (plan.op === 'look' && plan.to && r.look.eyes.length) {
      const k = sb.w / r.look.w, e = r.look.eyes.reduce((q, x) => [q[0] + x.cx / r.look.eyes.length, q[1] + x.cy / r.look.eyes.length], [0, 0]);
      const s2 = await drawLine([sb.x + e[0] * k, sb.y + e[1] * k], plan.to, u, 650, true, '#8e8e93'); await wait(200); s2.gone();
    }
    if (plan.tex && touched) { await carry(URL.createObjectURL((await blobOfImage(plan.tex)) ?? new Blob()), boxOf(plan.tex), touched, 750); }
    let lit: ReturnType<typeof beam> | null = null;
    if (plan.op === 'light' && plan.light) { lit = beam(plan.light, fig); await wait(450); }
    // the old shadow and the old lamp go when a new lamp lights the figure
    const oldGroup = subject.group, oldShadow = oldGroup ? [...(oldGroup.childIds ?? Object.keys(oldGroup.children?.toJSON?.() ?? {}))].filter((i: string) => i !== subject.id) : [];
    const oldLamp = plan.op === 'light' ? (info as any).lamp as string[] | undefined : undefined;
    const rel = (p: Pt | null): Reveal => (p ? { mode: 'radial', fx: Math.min(1, Math.max(0, (p[0] - place.x) / place.w)), fy: Math.min(1, Math.max(0, (p[1] - place.y) / place.h)) } : { mode: 'develop' });
    const how: Reveal = plan.op === 'hair' ? { mode: 'rise' } : plan.tex ? rel(touched) : { mode: 'develop' };
    let id: string, shId: string | undefined;
    if (shadow) {
      for (const m of oldLamp ?? []) remove(m);
      if (oldGroup) { try { surf.removeElement?.(oldGroup.id) ?? surf.deleteElement(oldGroup.id); } catch { /* kept */ } }
      // the new shadow spreads from the feet, away from the lamp, while the old one goes
      const away = plan.light![0] < mid(fig)[0], fx = away ? 0 : 1;
      shId = await reveal(shadow.src, { x: place.x + shadow.x, y: place.y + shadow.y, w: shadow.w, h: shadow.h }, 1200, { mode: 'ground', fx, fy: 0.3 }, () => { for (const i of oldShadow) remove(i); });
      // the figure itself does not change: it is put back in front of its shadow
      id = await reveal(out.src, place, 0, { mode: 'develop' });
      lit?.gone(600);
      try { const g = surf.addElement({ type: 'group', children: { [shId]: true, [id]: true }, title: new (W.cxDev?.Y)('') }); mine.add(g); } catch { /* two things */ }
    } else {
      id = await reveal(out.src, place, filmNext ? 1300 : 1100, how);
      // a shadow it had stays with it
      if (oldShadow.length) { try { surf.removeElement?.(oldGroup.id) ?? surf.deleteElement(oldGroup.id); } catch { /* kept */ } try { const g = surf.addElement({ type: 'group', children: Object.fromEntries([...oldShadow, id].map(i => [i, true])), title: new (W.cxDev?.Y)('') }); mine.add(g); } catch { /* apart */ } }
    }
    remove(subject.id);
    // what was drawn to ask for the change has done its work: it fades away (pictures brought in stay)
    void fadeAway(plan.marks.map(m => m.id));
    P.chain[id] = { from: subject.id, film: out.film ?? (film && !filmNext && plan.op === 'light' ? film : undefined), lit: plan.op === 'light' || info.lit, ...(plan.op === 'light' ? { lamp: plan.marks.map(m => m.id) } : (info as any).lamp ? { lamp: (info as any).lamp } : {}) } as Info;
    delete P.chain[subject.id]; if (plan.tex) P.tex[plan.tex.id] = tex ?? 'other'; keep();
    store.captureSync?.();
    return true;
  }
  function say(text: string, fig: Box, u: number) {
    const Y = W.cxDev?.Y; if (!Y) return; const t = new Y(); t.insert(0, text);
    const id = surf.addElement({ type: 'text', xywh: `[${fig.x},${fig.y + fig.h + 14 * u},${260 * u},${20 * u}]`, text: t, fontSize: 12 * u, color: '#8e8e93', fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' }) as string; mine.add(id);
  }

  async function run(words: string): Promise<boolean> {
    if (busy) return true;
    const plan = await planFor(words || ''); if (!plan) return false;
    // without words the drawing alone must be plain: a material arrow, hair over a figure of this scene, a second lamp
    busy = true; try { return await perform(plan); } finally { busy = false; }
  }

  // drawing alone (no words): after a pause, a plain act on a figure of this scene runs by itself; an unclear one
  // opens the prompt on the marks, so a word can be added
  let pointerDown = false, lastUp = 0, offered = '';
  addEventListener('pointerdown', () => { takeOld(); pointerDown = true; }, true);
  addEventListener('pointerup', ev => { pointerDown = false; lastUp = Date.now(); if ((ev.target as HTMLElement)?.closest?.('.cx-dock, .cx-ai-layer')) lastUp = 0; }, true);
  setInterval(async () => {
    if (busy || pointerDown || !lastUp || Date.now() - lastUp < 1300 || gfx.selection.editing) return;
    const marks = els().filter(fresh); if (!marks.length) return;
    const sig = marks.map(m => m.id).join(',') + ':' + els().length; if (sig === offered) return; offered = sig;
    const plan = await planFor('');
    if (plan && (plan.op === 'material' || plan.op === 'eyes' || plan.op === 'hair' || plan.op === 'light') && (chainOf(plan.subject.id) || plan.op === 'material' || plan.op === 'eyes' || await isFilmStart(plan.subject))) {
      busy = true; try { await perform(plan); } finally { busy = false; }
      return;
    }
    // marks beside a figure of this scene that need a word: the prompt opens on them
    const all = unionBox(marks.map(boxOf)), s = subjectNear(all);
    if (s && (chainOf(s.id) || await isFilmStart(s))) {
      try { gfx.tool.setTool('default'); } catch { /* stays */ }
      gfx.selection.set({ elements: marks.map(m => m.id), editing: false });
      setTimeout(() => dispatchEvent(new Event('cx-ai-open')), 200);
    }
  }, 350);

  // the filmed figure is recognised as soon as it is on the board, so other readings leave it alone
  const starts = new Set<string>(), checked = new Set<string>();
  setInterval(async () => { for (const i of images()) { if (checked.has(i.id)) continue; checked.add(i.id); if (await isFilmStart(i)) starts.add(i.id); } }, 700);
  const claims = (id: string) => !!chainOf(id) || !!P.tex[id] || mine.has(id) || starts.has(id);
  const scene = (i: any) => !!i && (claims(i.id));
  /** marks and pictures the scene answers: its own, and fresh marks at a figure of the scene */
  const owns = (ids: Iterable<string>) => {
    if (busy) return true; const list = [...ids]; if (!list.length) return false;
    return list.every(id => {
      if (used.has(id) || mine.has(id) || claims(id)) return true;
      const e = byId(id); if (!e) return true;
      if (isMark(e)) return scene(subjectNear(boxOf(e))) || images().some(i => scene(i) && (() => { const p = ptsOf(e); return p.length > 1 && [p[0], p[p.length - 1]].some(q => near(q, boxOf(i), 10)); })());
      if (e.flavour === 'affine:image') return images().some(i => scene(i) && near(mid(boxOf(e)), boxOf(i), boxOf(i).w * 2));   // a material brought beside it
      return false;
    });
  };
  const eyesOf = async (id: string) => { const e = byId(id), r = e && (await readImage(e)); if (!r) return []; const b = boxOf(e), k = b.w / r.look.w; return r.look.eyes.map((q: any) => ({ x: b.x + q.box.x * k, y: b.y + q.box.y * k, w: q.box.w * k, h: q.box.h * k })); };
  W.cxChar = { run, owns, claims, state: P, perform, planFor, eyesOf };
  return run;
}
