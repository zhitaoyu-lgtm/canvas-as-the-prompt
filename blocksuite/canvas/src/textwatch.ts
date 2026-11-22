// A text box that keeps growing with nothing typed in it is a fault. If one is seen, what the page looked like
// at that moment is written to the record (see ai/diag.ts), so the cause can be read afterwards.
import { diag } from './ai/diag';

export function watchText(rootEl: any) {
  const gfx = rootEl.gfx, seen = new Map<string, number>(); let told = false;
  setInterval(() => {
    if (told) return;
    for (const e of gfx.gfxElements as any[]) {
      if (e.flavour !== 'affine:edgeless-text') continue;
      const h = e.elementBound.h, before = seen.get(e.id); seen.set(e.id, h);
      if (before == null || h <= before + 2 || h < 120) continue;
      const host = document.querySelector(`affine-edgeless-text[data-block-id="${e.id}"]`) as HTMLElement | null, box = host?.querySelector('.edgeless-text-block-container') as HTMLElement | null;
      const cs = box ? getComputedStyle(box) : null, r = box?.getBoundingClientRect();
      told = true;
      diag({ path: 'text-grows', result: 'seen', zoom: gfx.viewport.zoom, viewScale: gfx.viewport.viewScale, dpr: devicePixelRatio, xywh: e.xywh, scale: e.props?.scale, before, h,
        rect: r ? [r.width, r.height] : null, offset: box ? [box.offsetWidth, box.offsetHeight] : null, hostStyle: host?.getAttribute('style') ?? '', boxStyle: box?.getAttribute('style') ?? '',
        css: cs ? [cs.display, cs.height, cs.minHeight, cs.fontSize, cs.lineHeight, cs.zoom as any] : null, kids: box ? box.querySelectorAll('affine-paragraph').length : -1, text: (box?.textContent ?? '').length });
    }
  }, 500);
}
