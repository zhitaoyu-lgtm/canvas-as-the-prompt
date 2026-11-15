// Visual channel: a picture of part of the board, for what structure cannot say —
// hand drawings, images, stickers, the look of a layout. Sent next to the reading, never instead of it.
//
// Canvas-drawn things (shapes, stickies, strokes, lines, text) come from the surface renderer itself;
// images are drawn from their blobs; docs and frames are drawn as plain outlines (their words are
// already in the reading).

import type { Box, Reading } from './reading';

const VISUAL = new Set(['drawing', 'highlight', 'image', 'sticker']);

/** Whether a picture adds anything for these refs (drawings, images, wordless shapes). */
export function needsPicture(r: Reading, refs: string[]): boolean {
  return refs.some(ref => { const it = r.byRef.get(ref); return !!it && (VISUAL.has(it.kind) || (it.kind === 'shape' && !it.text) || (it.kind === 'connector' && (!it.arrow?.from || !it.arrow?.to))); });
}

export async function snapshot(rootEl: any, box: Box, maxSide = 1024): Promise<Blob | null> {
  try {
    const gfx = rootEl.gfx, store = rootEl.std.store;
    const pad = 24;
    const B: any = gfx.elementsBound.constructor;
    const bound = B.fromXYWH([box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2]);
    const k = Math.min(2, maxSide / Math.max(bound.w, bound.h));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(bound.w * k)); out.height = Math.max(1, Math.round(bound.h * k));
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    const X = (x: number) => (x - bound.x) * k, Y = (y: number) => (y - bound.y) * k;

    const blocks: any[] = gfx.getElementsByBound(bound, { type: 'block' });
    // frames and docs: outlines under everything
    for (const b of blocks) {
      const f = b.flavour; const e = b.elementBound;
      if (f === 'affine:frame' || f === 'affine:note' || f === 'affine:edgeless-text') {
        ctx.strokeStyle = f === 'affine:frame' ? '#9a9994' : '#d6d6d6'; ctx.lineWidth = 1;
        ctx.strokeRect(X(e.x), Y(e.y), e.w * k, e.h * k);
      }
    }
    for (const b of blocks) {
      if (b.flavour !== 'affine:image' || !b.props.sourceId) continue;
      const blob = await store.blobSync.get(b.props.sourceId); if (!blob) continue;
      const img = await new Promise<HTMLImageElement | null>(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = URL.createObjectURL(blob); });
      if (img) { const e = b.elementBound; ctx.drawImage(img, X(e.x), Y(e.y), e.w * k, e.h * k); }
    }
    const elements = gfx.getElementsByBound(bound, { type: 'canvas' });
    const surf = gfx.surfaceComponent?.renderer?.getCanvasByBound?.(bound, elements);
    if (surf && surf.width && surf.height) ctx.drawImage(surf, 0, 0, out.width, out.height);
    return await new Promise(res => out.toBlob(b => res(b), 'image/png'));
  } catch (e) { console.warn('snapshot failed', e); return null; }
}
