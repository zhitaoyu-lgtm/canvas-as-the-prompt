// Comment pins, like Figma's: a small round bubble with a square bottom-left corner, pinned to a thing on
// the board. Click it and it opens to say why the AI did something there. Kept in the board's own document,
// so it survives reloads; resolving a comment removes it. Pins follow their thing as it moves or zooms.

const KEY = 'cx:comments';
type C = { on: string; text: string; at: number };
const mapOf = (store: any) => store?.spaceDoc?.getMap?.(KEY) ?? store?.doc?.spaceDoc?.getMap?.(KEY);

export function addComment(store: any, on: string, text: string) {
  const m = mapOf(store); if (!m) return;
  const id = 'c' + Math.random().toString(36).slice(2, 9);
  m.set(id, { on, text, at: Date.now() } as C);
}

export function removeCommentsOn(store: any, ids: string[]) {
  const m = mapOf(store); if (!m) return; const set = new Set(ids);
  for (const [cid, c] of [...m.entries()] as [string, C][]) if (set.has(c.on)) m.delete(cid);
}

export function mountComments(rootEl: any) {
  const store = rootEl.std.store, gfx = rootEl.gfx;
  const layer = document.createElement('div'); layer.className = 'cx-pins'; document.body.append(layer);
  const pins = new Map<string, HTMLElement>();
  let open: string | null = null;

  const render = () => {
    const m = mapOf(store); if (!m) return;
    const rr = rootEl.getBoundingClientRect(), z = gfx.viewport.zoom;
    const seen = new Set<string>();
    for (const [cid, c] of m.entries() as Iterable<[string, C]>) {
      const el: any = gfx.getElementById(c.on);
      if (!el) { continue; }
      seen.add(cid);
      let pin = pins.get(cid);
      if (!pin) {
        pin = document.createElement('div'); pin.className = 'cx-pin';
        pin.innerHTML = `<button class="cx-pin-dot" aria-label="Comment"><span></span></button><div class="cx-pin-card" hidden><p></p><button class="cx-pin-done" aria-label="Resolve"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg></button></div>`;
        (pin.querySelector('p') as HTMLElement).textContent = c.text;
        (pin.querySelector('.cx-pin-dot') as HTMLElement).onclick = e => { e.stopPropagation(); open = open === cid ? null : cid; };
        (pin.querySelector('.cx-pin-done') as HTMLElement).onclick = e => { e.stopPropagation(); m.delete(cid); };
        layer.append(pin); pins.set(cid, pin);
      }
      const b = el.elementBound;
      const [vx, vy] = gfx.viewport.toViewCoord(b.x + b.w, b.y);
      const x = rr.left + vx + 4, y = rr.top + vy - 26;
      const visible = x > rr.left - 30 && x < rr.right && y > rr.top - 30 && y < rr.bottom && z > 0.15;
      pin.hidden = !visible;
      pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      (pin.querySelector('.cx-pin-card') as HTMLElement).hidden = open !== cid;
      pin.classList.toggle('open', open === cid);
    }
    for (const [cid, pin] of pins) if (!seen.has(cid)) { pin.remove(); pins.delete(cid); }
  };
  const loop = () => { render(); requestAnimationFrame(loop); };
  loop();
  addEventListener('pointerdown', e => { if (open && !(e.target as HTMLElement).closest?.('.cx-pin')) open = null; }, true);
  (window as any).cxComments = { add: (on: string, text: string) => addComment(store, on, text), all: () => [...(mapOf(store)?.entries() ?? [])] };
}
