// A scripted scene for filming (web only): "What's this?" over a pen loop on a picture.
//
//   1. the user drops a map on the board, circles the Colosseum with the pen and asks "What's this?"
//   2. the usual blue dots while "thinking"
//   3. the loop gathers into a small drop of ink at its edge, which keeps moving slowly, like liquid
//   4. a click on the drop draws a line to the right and opens a note card beside the picture
//   5. the three photos in the card can be pulled out onto the board, one at a time
//
// Nothing here asks the model: the answer is written below. It only starts when a request like "what's this"
// is typed while a pen loop lies on a picture; everything else goes the normal way.

import { addImages } from '@blocksuite/affine/blocks/image';

import photo1 from '../assets/demo/colosseum-1.jpg';
import photo2 from '../assets/demo/colosseum-2.jpg';
import photo3 from '../assets/demo/colosseum-3.jpg';

type Box = { x: number; y: number; w: number; h: number };
const W = window as any;
const ASK = /what('?s| is)?\s+(this|that|it)\b|what building|这是什么|这是啥|是什么建筑/i;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const CARD = {
  kicker: 'Flavian Amphitheatre',
  title: 'Colosseum',
  place: 'Rome · AD 70–80',
  text: 'The oval at the centre of the plan is the Colosseum. Vespasian began it around AD 70 on the drained lake of Nero’s Golden House, in the valley between the Palatine, Esquiline and Caelian hills; Titus opened it in AD 80.',
  facts: [['189 × 156 m', 'footprint'], ['≈ 50,000', 'seats'], ['80', 'arches per tier']],
  photos: [
    { src: photo1, name: 'Colosseum aerial top-down', ratio: 668 / 414 },
    { src: photo2, name: 'Colosseum from above', ratio: 258 / 184 },
    { src: photo3, name: 'Colosseum in the city', ratio: 258 / 180 },
  ],
};

export function mountRome(rootEl: any) {
  const gfx = rootEl.gfx, std = rootEl.std, store = std.store, surf = gfx.surface;

  // one layer in board units: it follows pan and zoom, so what is drawn here sits on the board like a real thing
  const world = document.createElement('div'); world.className = 'cx-rome';
  document.body.append(world);
  let key = '';
  const follow = () => {
    const rr = rootEl.getBoundingClientRect(), z = gfx.viewport.zoom, [ox, oy] = gfx.viewport.toViewCoord(0, 0);
    const k = `${rr.left + ox},${rr.top + oy},${z}`;
    if (k !== key) { key = k; world.style.transform = `translate(${rr.left + ox}px, ${rr.top + oy}px) scale(${z})`; world.style.setProperty('--z', String(z)); }
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);

  const boxOf = (e: any): Box => { const b = e.elementBound; return { x: b.x, y: b.y, w: b.w, h: b.h }; };
  const images = () => (gfx.gfxElements as any[]).filter(e => e.flavour === 'affine:image');
  const hostOf = (b: Box) => images().filter(i => { const q = boxOf(i); const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return q.w * q.h > b.w * b.h * 1.5 && cx > q.x && cx < q.x + q.w && cy > q.y && cy < q.y + q.h; }).sort((p, q) => boxOf(p).w * boxOf(p).h - boxOf(q).w * boxOf(q).h)[0];
  /** The latest ring on a picture: a hand-drawn loop (it need not close, and may overshoot) or a drawn ellipse / box. */
  type Ring = { el: any; host: any; pts: [number, number][]; lw: number };
  function loop(): Ring | null {
    const all = (gfx.gfxElements as any[]).filter(e => e.type === 'brush' || e.type === 'highlighter' || e.type === 'shape');
    for (const el of all.reverse()) {
      const b = boxOf(el); if (Math.min(b.w, b.h) < 16) continue;
      const host = hostOf(b); if (!host) continue;
      if (el.type === 'shape') {
        if (el.text?.length || (el.filled && !/^(#fff|#ffffff|transparent)/i.test(String(el.fillColor ?? '')) && false)) continue;   // a note is not a ring
        if (el.filled && String(el.fillColor ?? '').toLowerCase() !== 'transparent') continue;                                        // only outlines circle things
        const box = el.shapeType !== 'ellipse';
        const pts: [number, number][] = Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a), k = box ? 1 / Math.max(Math.abs(c), Math.abs(s2)) : 1; return [b.x + b.w / 2 + (b.w / 2) * c * k, b.y + b.h / 2 + (b.h / 2) * s2 * k]; });
        return { el, host, pts, lw: el.strokeWidth ?? 2 };
      }
      const p = el.points as number[][]; if ((p?.length ?? 0) < 8) continue;
      // does the stroke go round? count how much of the full turn around its middle it covers
      const cx = b.w / 2, cy = b.h / 2, bins = new Set<number>();
      for (const q of p) bins.add(Math.floor(((Math.atan2(q[1] - cy, q[0] - cx) + Math.PI) / (Math.PI * 2)) * 24) % 24);
      const far = p.filter(q => Math.hypot((q[0] - cx) / (b.w / 2), (q[1] - cy) / (b.h / 2)) > 0.45).length / p.length;   // on the rim, not a scribble through the middle
      if (bins.size >= 17 && far >= 0.8) return { el, host, pts: p.map(q => [b.x + q[0], b.y + q[1]] as [number, number]), lw: el.lineWidth ?? 4 };
    }
    return null;
  }

  /** The background reading leaves these strokes alone: this scene answers them. */
  const owns = (ids: Set<string>) => { const r = loop(); return !!r && ids.size > 0 && [...ids].every(id => id === r.el.id); };

  async function run(): Promise<boolean> {
    const found = loop(); if (!found) return false;
    const { el, host, pts, lw } = found, sb = boxOf(el), hb = boxOf(host);
    try { gfx.selection.clear(); } catch { /* nothing selected */ }
    document.body.classList.add('cx-rome-busy');        // the scene shows its own dots, at the ring

    // 2 · thinking: the same blue dots as everywhere
    const dots = document.createElement('div'); dots.className = 'cx-sense-think cx-rome-think'; dots.innerHTML = '<i></i><i></i><i></i><i></i>';
    dots.style.left = `${sb.x - 22 }px`; dots.style.top = `${sb.y}px`; world.append(dots);
    await wait(1900);
    dots.classList.add('out'); setTimeout(() => dots.remove(), 300);

    // 3 · the loop gathers into a drop at its right edge
    const N = 72, cx = sb.x + sb.w / 2, cy = sb.y + sb.h / 2;
    // resample the stroke to N points, ordered by angle around its middle so each has a place on the drop
    const ring: [number, number][] = Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2; let best = pts[0], bd = 9;
      for (const p of pts) { const d = Math.abs(Math.atan2(Math.sin(Math.atan2(p[1] - cy, p[0] - cx) - a), Math.cos(Math.atan2(p[1] - cy, p[0] - cx) - a))); if (d < bd) { bd = d; best = p; } }
      return best;
    });
    const R = 7, dot = { x: sb.x + sb.w + R + 3, y: cy };
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.classList.add('cx-rome-ink'); svg.setAttribute('overflow', 'visible');
    const line = document.createElementNS(NS, 'path'); line.classList.add('cx-rome-line');
    const path = document.createElementNS(NS, 'path'); path.classList.add('cx-rome-drop');
    svg.append(line, path); world.append(svg);
    const smooth = (q: [number, number][]) => { let d = ''; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; d += i ? ` Q ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}` : `M ${mx.toFixed(2)} ${my.toFixed(2)}`; } const a = q[0], b = q[1]; return d + ` Q ${a[0].toFixed(2)} ${a[1].toFixed(2)} ${((a[0] + b[0]) / 2).toFixed(2)} ${((a[1] + b[1]) / 2).toFixed(2)} Z`; };
    // the living outline: a circle whose radius breathes in a few slow, unequal waves
    const drop = (t: number, hover = 0): [number, number][] => Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      // (still a circle to the eye: only its edge moves, a few hundredths of the radius, slowly)
      const r = (R + hover) * (1 + 0.034 * Math.sin(2 * a + t * 0.8) + 0.024 * Math.sin(3 * a - t * 1.1 + 1.7) + 0.012 * Math.sin(5 * a + t * 0.6 + 0.4));
      return [dot.x + r * Math.cos(a), dot.y + r * Math.sin(a)];
    });
    path.setAttribute('d', smooth(ring)); path.style.strokeWidth = String(lw); path.style.fillOpacity = '0';
    surf.deleteElement(el.id);                         // the drawn ring hands over to the same shape drawn here
    try { gfx.selection.clear(); } catch { /* nothing selected */ }
    let alive = true, hover = 0, hoverTo = 0, t0 = performance.now();
    await new Promise<void>(done => {
      const D = 900;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / D), e = ease(k), target = drop(now / 1000);
        path.setAttribute('d', smooth(ring.map((p, i) => [p[0] + (target[i][0] - p[0]) * e, p[1] + (target[i][1] - p[1]) * e] as [number, number])));
        // the line stays a line while it gathers; it only fills in once it is nearly a drop
        const ss = (a0: number, b0: number, v: number) => { const x = Math.max(0, Math.min(1, (v - a0) / (b0 - a0))); return x * x * (3 - 2 * x); };
        path.style.strokeWidth = String(lw * (1 - ss(0.82, 1, e))); path.style.fillOpacity = String(ss(0.62, 0.96, e));
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    const live = (now: number) => { if (!alive) return; hover += (hoverTo - hover) * 0.14; path.setAttribute('d', smooth(drop(now / 1000, hover))); requestAnimationFrame(live); };
    requestAnimationFrame(live);

    // 4 · the drop is the handle: a click opens the card beside the picture, another closes it
    const hit = document.createElement('button'); hit.className = 'cx-rome-hit'; hit.setAttribute('aria-label', 'Open');
    hit.style.left = `${dot.x - 16}px`; hit.style.top = `${dot.y - 16}px`; world.append(hit);
    hit.onpointerenter = () => { hoverTo = 1.6; }; hit.onpointerleave = () => { hoverTo = 0; };
    const PW = 284, px = hb.x + hb.w + 12, py = hb.y;
    const card = document.createElement('div'); card.className = 'cx-rome-card'; card.style.left = `${px}px`; card.style.top = `${py}px`; card.style.width = `${PW}px`; card.style.minHeight = `${hb.h}px`;
    card.innerHTML = `
      <div class="k">${CARD.kicker}</div>
      <div class="t">${CARD.title}</div>
      <div class="p">${CARD.place}</div>
      <div class="ph lead" data-i="0"><img draggable="false" src="${CARD.photos[0].src}" alt=""></div>
      <div class="row"><div class="ph" data-i="1"><img draggable="false" src="${CARD.photos[1].src}" alt=""></div><div class="ph" data-i="2"><img draggable="false" src="${CARD.photos[2].src}" alt=""></div></div>
      <div class="x">${CARD.text}</div>
      <div class="f">${CARD.facts.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
    world.append(card);
    line.setAttribute('d', `M ${dot.x + R - 1} ${dot.y} L ${px} ${dot.y}`);
    const len = Math.max(1, px - dot.x - R + 1); line.style.strokeDasharray = String(len); line.style.strokeDashoffset = String(len);
    let open = false;
    hit.onclick = () => {
      open = !open; hit.setAttribute('aria-label', open ? 'Close' : 'Open');
      line.style.transition = `stroke-dashoffset ${open ? 420 : 300}ms cubic-bezier(.22,1,.36,1) ${open ? 0 : 180}ms`; line.style.strokeDashoffset = open ? '0' : String(len);
      card.classList.toggle('on', open);
    };

    // 5 · a photo can be pulled out of the card onto the board
    for (const ph of Array.from(card.querySelectorAll('.ph')) as HTMLElement[]) {
      ph.addEventListener('pointerdown', ev => {
        if (ev.button !== 0 || ph.classList.contains('gone')) return;
        ev.preventDefault(); ev.stopPropagation();
        const info = CARD.photos[+ph.dataset.i!], img = ph.querySelector('img') as HTMLImageElement;
        const r0 = img.getBoundingClientRect(), sx = ev.clientX, sy = ev.clientY;
        let ghost: HTMLImageElement | null = null;
        const move = (e: PointerEvent) => {
          if (!ghost) {
            if (Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
            ghost = img.cloneNode() as HTMLImageElement; ghost.className = 'cx-rome-ghost';
            ghost.style.width = `${r0.width}px`; ghost.style.height = `${r0.height}px`; ghost.style.left = `${r0.left}px`; ghost.style.top = `${r0.top}px`;
            document.body.append(ghost); ph.classList.add('lifted'); void ghost.offsetWidth; ghost.classList.add('up');
          }
          ghost.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px) scale(1.04) rotate(${Math.max(-3, Math.min(3, (e.clientX - sx) / 60))}deg)`;
        };
        const up = async (e: PointerEvent) => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
          if (!ghost) return;
          const g = ghost, cr = card.getBoundingClientRect(), gr = g.getBoundingClientRect();
          const inside = e.clientX > cr.left && e.clientX < cr.right && e.clientY > cr.top && e.clientY < cr.bottom;
          if (inside || e.type === 'pointercancel') {      // not pulled out: back to its place
            g.classList.add('back'); g.style.transform = 'translate(0, 0) scale(1) rotate(0deg)';
            setTimeout(() => { g.remove(); ph.classList.remove('lifted'); }, 260); return;
          }
          // settle flat where it was let go, then become a real picture on the board
          const w = r0.width, h = r0.height, left = gr.left + (gr.width - w) / 2, top = gr.top + (gr.height - h) / 2;
          g.classList.add('land'); g.style.transform = `translate(${left - r0.left}px, ${top - r0.top}px) scale(1) rotate(0deg)`;
          const rr = rootEl.getBoundingClientRect(), z = gfx.viewport.zoom;
          const [mx, my] = gfx.viewport.toModelCoord(left - rr.left, top - rr.top);
          ph.classList.add('gone');
          try {
            const blob = await (async () => { const [head, b64] = info.src.split(','); if (!info.src.startsWith('data:')) return (await fetch(info.src)).blob(); const bin = atob(b64), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); return new Blob([buf], { type: /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg' }); })();
            const bw = w / z, bh = h / z;
            const ids = await addImages(std, [new File([blob], `${info.name}.jpg`, { type: blob.type })], { point: [mx + bw / 2, my + bh / 2], shouldTransformPoint: false, maxWidth: bw });
            await wait(60);
            for (const id of ids ?? []) { const b = store.getBlock(id)?.model; if (b) store.updateBlock(b, { xywh: `[${mx},${my},${bw},${bh}]` }); }
            store.captureSync?.();
          } catch (err) { console.warn('[rome] image', err); ph.classList.remove('gone', 'lifted'); }
          setTimeout(() => { g.classList.add('gone'); setTimeout(() => g.remove(), 200); }, 180);
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
      });
    }

    // the scene belongs to its picture: it follows it, and leaves with it
    const base = { hx: hb.x, hy: hb.y };
    const watch = setInterval(() => {
      const h: any = gfx.getElementById(host.id);
      if (!h) { alive = false; clearInterval(watch); svg.remove(); hit.remove(); card.remove(); return; }
      const b = boxOf(h), dx = b.x - base.hx, dy = b.y - base.hy;
      for (const n of [svg, hit, card] as any[]) n.style.translate = dx || dy ? `${dx}px ${dy}px` : '';
    }, 120);
    setTimeout(() => document.body.classList.remove('cx-rome-busy'), 500);
    return true;
  }

  // Circling something on a picture is already half the question: when the pen lifts from such a loop, the
  // prompt opens on it, ready for the words.
  const seen = new Set<string>((gfx.gfxElements as any[]).filter(e => e.type === 'brush' || e.type === 'shape').map(e => e.id));
  addEventListener('pointerup', () => setTimeout(() => {
    const found = loop(); if (!found || seen.has(found.el.id)) return;
    seen.add(found.el.id);
    try { gfx.tool.setTool('default'); } catch { /* stays on the pen */ }
    gfx.selection.set({ elements: [found.el.id], editing: false });
    setTimeout(() => dispatchEvent(new Event('cx-ai-open')), 220);
  }, 260), true);

  W.cxRome = { owns, run, loop, asks: (q: string) => ASK.test(q) };
  /** A typed request goes to the scene when it fits; false means "not mine". */
  return async (request: string): Promise<boolean> => (ASK.test(request) && loop() ? run() : false);
}
