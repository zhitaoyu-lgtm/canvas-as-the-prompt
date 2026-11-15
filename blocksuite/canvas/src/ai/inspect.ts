// Hidden developer view of the reading: Alt+Shift+R toggles it.
// Thin outlines for each group found, a small reading-order number on each thing, and the text the
// model would get in the console (also on window.cxRead()). Nothing of this is in the normal UI.

import { readBoard, toPrompt, type Reading } from './reading';
import { snapshot } from './snapshot';

export function mountInspector(rootEl: any) {
  const gfx = rootEl.gfx;
  const layer = document.createElement('div');
  layer.className = 'cx-inspect';
  document.body.append(layer);
  let on = false, raf = 0, last: Reading | null = null;

  (window as any).cxRead = (selection?: string[]) => { last = readBoard(gfx, { selection }); return toPrompt(last); };
  (window as any).cxSnap = async (box: any) => { const b = await snapshot(rootEl, box ?? gfx.elementsBound); return b ? URL.createObjectURL(b) : null; };
  (window as any).cxReading = (selection?: string[]) => readBoard(gfx, { selection });

  const draw = () => {
    if (!on) return;
    const r = (last = readBoard(gfx));
    const rr = rootEl.getBoundingClientRect();
    const v = (x: number, y: number) => { const [a, b] = gfx.viewport.toViewCoord(x, y); return [rr.left + a, rr.top + b]; };
    let html = '';
    for (const g of r.groups) {
      if (g.members.length < 2) continue;
      const [x0, y0] = v(g.box.x, g.box.y), [x1, y1] = v(g.box.x + g.box.w, g.box.y + g.box.h);
      html += `<div class="cx-ig" style="left:${x0 - 6}px;top:${y0 - 6}px;width:${x1 - x0 + 12}px;height:${y1 - y0 + 12}px"><span>${g.ref} ${g.layout}${g.rows ? ` ${g.rows}×${g.cols}` : ''}</span></div>`;
      for (const s of g.slots ?? []) {
        const [a, b] = v(s.box.x, s.box.y), [c, d] = v(s.box.x + s.box.w, s.box.y + s.box.h);
        html += `<div class="cx-is" style="left:${a}px;top:${b}px;width:${c - a}px;height:${d - b}px"></div>`;
      }
    }
    for (const it of r.items) {
      if (it.kind === 'connector') continue;
      const [x, y] = v(it.box.x, it.box.y);
      html += `<div class="cx-in" style="left:${x - 9}px;top:${y - 9}px">${it.order}</div>`;
    }
    layer.innerHTML = html;
    raf = requestAnimationFrame(() => setTimeout(draw, 120));
  };
  window.addEventListener('keydown', e => {
    if (!(e.altKey && e.shiftKey && e.code === 'KeyR')) return;
    e.preventDefault();
    on = !on;
    if (on) { draw(); console.log(toPrompt(last!)); } else { cancelAnimationFrame(raf); layer.innerHTML = ''; }
  });
}
