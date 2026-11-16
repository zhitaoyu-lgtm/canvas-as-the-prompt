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

// The commenter's avatar: an illustrated face (drawn here, not a real person's photo)
const AVATAR = `<svg class="cx-pin-av" width="22" height="22" viewBox="0 0 44 44" aria-hidden="true">
  <defs><linearGradient id="cxav" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe3ff"/><stop offset="1" stop-color="#e9d9ff"/></linearGradient>
  <clipPath id="cxavc"><circle cx="22" cy="22" r="22"/></clipPath></defs>
  <g clip-path="url(#cxavc)"><rect width="44" height="44" fill="url(#cxav)"/>
  <path d="M8 46c1-9 7-13 14-13s13 4 14 13z" fill="#5b6b8c"/>
  <rect x="18.5" y="25" width="7" height="8" rx="3" fill="#f2c6a5"/>
  <ellipse cx="22" cy="20" rx="8.2" ry="9.2" fill="#f6d2b6"/>
  <path d="M13.2 19.5c-.6-7 4-11.2 9.6-11.2 5.3 0 9.6 3.6 8.8 10.6-1.6-3.6-4.4-5.4-8.6-5.6-3 2.4-6.4 4-9.8 6.2z" fill="#2b2420"/>
  <circle cx="19" cy="21" r="0.9" fill="#3a2a22"/><circle cx="25" cy="21" r="0.9" fill="#3a2a22"/>
  <path d="M19.8 25.2c1.3.9 3.1.9 4.4 0" stroke="#c9826a" stroke-width="1" fill="none" stroke-linecap="round"/></g></svg>`;

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
        pin.innerHTML = `<button class="cx-pin-dot" aria-label="Comment">${AVATAR}</button><div class="cx-pin-card" hidden><p></p><button class="cx-pin-done" aria-label="Resolve"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg></button></div>`;
        (pin.querySelector('p') as HTMLElement).textContent = c.text;
        (pin.querySelector('.cx-pin-dot') as HTMLElement).onclick = e => { e.stopPropagation(); open = open === cid ? null : cid; };
        (pin.querySelector('.cx-pin-done') as HTMLElement).onclick = e => { e.stopPropagation(); m.delete(cid); };
        layer.append(pin); pins.set(cid, pin);
      }
      // on a line, the pin sits at the end of its label; elsewhere at the top-right corner
      const l = el.labelDisplay && el.labelXYWH; const b = l ? { x: l[0], y: l[1] + 4, w: l[2] + 30, h: l[3] } : el.elementBound;
      const [vx, vy] = gfx.viewport.toViewCoord(b.x + b.w, b.y);
      const x = rr.left + vx + 2, y = rr.top + vy - 30;   // the square corner points at the thing
      const visible = x > rr.left - 30 && x < rr.right && y > rr.top - 30 && y < rr.bottom;   // same size at every zoom, like Figma
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
