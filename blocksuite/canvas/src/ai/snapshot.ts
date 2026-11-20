// Visual channel: a picture of the part of the board being asked about, made off-screen (nothing
// on screen changes, nothing is shown). It goes to the model next to the reading, so what code
// cannot name — a hand drawing, an image, an unusual layout — is still seen.
//
// Canvas-drawn things (shapes, stickies, strokes, lines, text) come from the surface renderer
// itself; images from their files; docs, frames and link cards are drawn simply with their words.

import type { Box, Reading } from './reading';

/** Kept for callers that want to know whether a picture is essential (drawings, images, free lines). */
export function needsPicture(r: Reading, refs: string[]): boolean {
  return refs.some(ref => { const it = r.byRef.get(ref); return !!it && (['drawing', 'highlight', 'image', 'sticker'].includes(it.kind) || (it.kind === 'shape' && !it.text) || (it.kind === 'connector' && (!it.arrow?.from || !it.arrow?.to))); });
}

const str = (t: any) => { try { return t?.toString?.() ?? ''; } catch { return ''; } };
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxY: number) {
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+\s*|\s+/g) ?? []) {
      if (ctx.measureText(line + ch).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = ch.trimStart(); if (y > maxY) return y; }
      else line += ch;
    }
    ctx.fillText(line, x, y); y += lh; if (y > maxY) return y;
  }
  return y;
}
function noteText(m: any): string {
  const out: string[] = [];
  const walk = (b: any) => {
    if (b.flavour === 'affine:table') {
      const p = b.props; const rows = Object.values(p.rows ?? {}).sort((a: any, c: any) => (a.order > c.order ? 1 : -1)) as any[]; const cols = Object.values(p.columns ?? {}).sort((a: any, c: any) => (a.order > c.order ? 1 : -1)) as any[];
      rows.forEach(r => out.push(cols.map(c => str(p.cells?.[`${r.rowId}:${c.columnId}`]?.text) || '·').join(' | ')));
    } else if (b.props?.text) out.push(str(b.props.text));
    (b.children ?? []).forEach(walk);
  };
  (m.children ?? []).forEach(walk);
  return out.filter(Boolean).join('\n');
}

export async function snapshot(rootEl: any, box: Box, maxSide = 1024, pad = 32): Promise<Blob | null> {
  try {
    const gfx = rootEl.gfx, store = rootEl.std.store;
    const B: any = gfx.elementsBound.constructor;
    const bound = B.fromXYWH([box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2]);
    const k = Math.min(3, maxSide / Math.max(bound.w, bound.h));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(bound.w * k)); out.height = Math.max(1, Math.round(bound.h * k));
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, out.width, out.height);
    const X = (x: number) => (x - bound.x) * k, Y = (y: number) => (y - bound.y) * k;
    const font = (px: number, w = 400) => `${w} ${Math.max(6, px * k)}px Inter, "PingFang SC", "Noto Sans SC", sans-serif`;
    const rr = (x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.roundRect(X(x), Y(y), w * k, h * k, r * k); };

    const blocks: any[] = gfx.getElementsByBound(bound, { type: 'block' });
    // frames first, then everything in the board's own stacking order: a sticker on a photo must stay on top of it
    const zi = (b: any) => String(b.index ?? b.props?.index ?? '');
    const sorted = [...blocks].sort((a, b) => ((a.flavour === 'affine:frame' ? 0 : 1) - (b.flavour === 'affine:frame' ? 0 : 1)) || (zi(a) < zi(b) ? -1 : zi(a) > zi(b) ? 1 : 0));
    for (const b of sorted) {
      const e = b.elementBound, f = b.flavour, p = b.props ?? {};
      if (f === 'affine:frame') {
        const bg = typeof p.background === 'string' ? p.background : p.background?.normal ?? '#ffffff';
        ctx.fillStyle = bg?.startsWith('--') ? '#ffffff' : bg; rr(e.x, e.y, e.w, e.h, 12); ctx.fill();
        const t = str(p.title); if (t) { ctx.fillStyle = '#1e1e1e'; ctx.font = font(14, 500); ctx.fillText(t, X(e.x), Y(e.y) - 6 * k); }
      }
    }
    for (const b of sorted) {
      const e = b.elementBound, f = b.flavour, p = b.props ?? {};
      if (f === 'affine:note' || f === 'affine:edgeless-text' || f === 'affine:bookmark') {
        if (f !== 'affine:edgeless-text') { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 8 * k; ctx.shadowOffsetY = 3 * k; ctx.fillStyle = '#ffffff'; rr(e.x, e.y, e.w, e.h, 14); ctx.fill(); ctx.restore(); }
        const text = f === 'affine:bookmark' ? [p.title, p.description, p.url].filter(Boolean).join('\n') : noteText(b);
        ctx.fillStyle = '#2a2926'; ctx.font = font(14); ctx.textBaseline = 'top';
        wrapText(ctx, text, X(e.x + 16), Y(e.y + 14), (e.w - 32) * k, 20 * k, Y(e.y + e.h - 10));
      } else if (f === 'affine:image' && p.sourceId) {
        const blob = await store.blobSync.get(p.sourceId); if (!blob) continue;
        const img = await new Promise<HTMLImageElement | null>(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = URL.createObjectURL(blob); });
        if (img) ctx.drawImage(img, X(e.x), Y(e.y), e.w * k, e.h * k);
      }
    }
    const elements = gfx.getElementsByBound(bound, { type: 'canvas' });
    const surf = gfx.surfaceComponent?.renderer?.getCanvasByBound?.(bound, elements);
    if (surf && surf.width && surf.height) ctx.drawImage(surf, 0, 0, out.width, out.height);
    return await new Promise(res => out.toBlob(b => res(b), 'image/png'));
  } catch (e) { console.warn('snapshot failed', e); return null; }
}
