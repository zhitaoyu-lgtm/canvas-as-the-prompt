// Resizing a selection scales everything in it the same way: lines, outlines and pen strokes get thinner or
// thicker with the drawing, as text already does. (The engine keeps stroke widths fixed, so a drawing made
// smaller came out with heavy lines and big arrowheads.) Applied once, when the resize ends.

type Snap = { id: string; key: 'strokeWidth' | 'lineWidth'; v: number };

export function mountScaleStrokes(rootEl: any) {
  const gfx = rootEl.gfx;
  let before: { w: number; h: number; x: number; y: number; snaps: Snap[] } | null = null;
  const all = (els: any[]): any[] => els.flatMap(e => (e.type === 'group' || e.childElements ? [e, ...all(Array.from(e.childElements ?? []))] : [e]));
  const boundOf = (els: any[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const e of els) { const b = e.elementBound; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  addEventListener('pointerdown', ev => {
    before = null;
    const t = ev.target as HTMLElement | null;
    // only a drag on the selection's own frame (its handles), never a pen stroke or a click elsewhere
    if (!t?.closest?.('edgeless-selected-rect')) return;
    const sel = gfx.selection.selectedElements as any[]; if (!sel?.length) return;
    const els = all(sel), b = boundOf(sel), snaps: Snap[] = [];
    for (const e of els) {
      if (e.type === 'connector' || e.type === 'shape') snaps.push({ id: e.id, key: 'strokeWidth', v: e.strokeWidth });
      else if (e.type === 'brush' || e.type === 'highlighter') snaps.push({ id: e.id, key: 'lineWidth', v: e.lineWidth });
    }
    if (snaps.length) before = { ...b, snaps };
  }, true);
  addEventListener('pointerup', () => {
    const was = before; before = null; if (!was) return;
    setTimeout(() => {
      const sel = gfx.selection.selectedElements as any[]; if (!sel?.length) return;
      const now = boundOf(sel), k = was.w > 1 ? now.w / was.w : now.h / Math.max(1, was.h), k2 = was.h > 1 ? now.h / was.h : k;
      if (!(k > 0) || Math.abs(k - 1) < 0.01) return;               // moved, not resized
      const f = Math.sqrt(k * k2);                                   // a stretch in one direction counts half
      for (const s of was.snaps) {
        const e = gfx.getElementById(s.id) as any; if (!e || !(s.v > 0)) continue;
        const v = Math.max(0.25, Math.round(s.v * f * 100) / 100);
        try { gfx.surface.updateElement(s.id, { [s.key]: v }); } catch { /* left as it was */ }
      }
    }, 60);
  }, true);
}
