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
        css: cs ? [cs.display, cs.height, cs.minHeight, cs.fontSize, cs.lineHeight, cs.zoom as any] : null, kids: box ? box.querySelectorAll('affine-paragraph').length : -1, text: (box?.textContent ?? '').length,
        model: JSON.stringify((e.children ?? []).map((c: any) => [c.flavour, String(c.text?.toString?.() ?? '').slice(0, 120), c.text?.length])).slice(0, 800), html: (box?.innerHTML ?? '').replace(/<!--[^>]*-->/g, '').replace(/ style="[^"]*"/g, '').slice(0, 880), tail: (box?.innerHTML ?? '').replace(/<!--[^>]*-->/g, '').replace(/ style="[^"]*"/g, '').slice(-600), lang: document.documentElement.lang, cls: document.documentElement.className });
    }
  }, 500);
}

// A paragraph that is far taller than the words in it is the same fault seen from the other side (a card with
// its lines spread far apart). What every box inside such a paragraph measures is written to the record, once.
export function watchParagraphs() {
  let told = false;
  const look = () => {
    if (told) return;
    for (const p of Array.from(document.querySelectorAll('affine-paragraph')) as HTMLElement[]) {
      const rt = p.querySelector('rich-text') as HTMLElement | null; if (!rt) continue;
      const ph = p.offsetHeight, rh = rt.offsetHeight; if (!(rh > 0) || ph < rh * 3 || ph < 90) continue;
      const row = (e: Element) => { const c = getComputedStyle(e), h = e as HTMLElement; return [e.tagName.toLowerCase() + '.' + String((e as any).className ?? '').trim().replace(/\s+/g, '.').slice(0, 60), h.offsetHeight, c.height, c.minHeight, c.display, c.position, c.marginTop + '/' + c.marginBottom, c.paddingTop + '/' + c.paddingBottom, c.lineHeight, c.fontSize, c.flex, c.alignSelf, c.gridTemplateRows].join(' | '); };
      const chain: string[] = []; let up: Element | null = p; for (let i = 0; i < 5 && up; i++, up = up.parentElement) chain.push('^ ' + row(up));
      const inner = [p, ...Array.from(p.querySelectorAll('*')).slice(0, 14)].map(row);
      const sheets = Array.from(document.styleSheets).map(s => { try { return (s.ownerNode as any)?.id || (s.ownerNode as any)?.dataset?.cx || (s.href ?? '').slice(-40) || 'inline:' + (s.cssRules?.length ?? '?'); } catch { return 'blocked'; } }).slice(0, 40).join(',');
      told = true;
      diag({ path: 'paragraph-tall', result: 'seen', ua: navigator.userAgent.slice(0, 160), dpr: devicePixelRatio, ph, rh, text: (rt.textContent ?? '').slice(0, 60), inner: inner.join('\n').slice(0, 880), inner2: inner.join('\n').slice(880, 1760), inner3: inner.join('\n').slice(1760, 2640), chain: chain.join('\n').slice(0, 880), sheets: sheets.slice(0, 880), extra: Array.from(document.querySelectorAll('html > *:not(head):not(body), body > *')).map(e => e.tagName.toLowerCase() + '#' + e.id).slice(0, 30).join(',') });
      return;
    }
  };
  setInterval(look, 1500);
}

// The page must run in standards mode. In the other ("quirks") mode a height of 100% reaches up to the nearest box
// with a fixed height, which is what stretched text lines to the height of their card. If that ever happens again
// it is said, small, in a corner, instead of showing up as broken cards.
export function watchMode() {
  if (document.compatMode === 'CSS1Compat') return;
  diag({ path: 'mode', result: 'quirks' });
  const d = document.createElement('div'); d.textContent = 'layout: quirks mode'; d.style.cssText = 'position:fixed;right:8px;bottom:6px;font:400 10px Inter,sans-serif;color:#b0b0b5;z-index:5;pointer-events:none';
  document.body.append(d);
}
