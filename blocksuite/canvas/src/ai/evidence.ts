// Where an AI card's content came from. Kept beside the card in the board's own document; resting the
// pointer on the card for a moment shows a small card with the source and, when there is one, the exact
// words it rests on. Nothing is shown on the card itself, so the board stays clean.

type Ev = { source: string; quote: string };
const KEY = 'cx:evidence';
const mapOf = (store: any) => store?.spaceDoc?.getMap?.(KEY) ?? store?.doc?.spaceDoc?.getMap?.(KEY);

export function setEvidence(store: any, id: string, ev: Ev) { const m = mapOf(store); if (m && (ev.source || ev.quote)) m.set(id, ev); }
export function clearEvidence(store: any, ids: string[]) { const m = mapOf(store); if (!m) return; for (const id of ids) m.delete(id); }

export function mountEvidence(rootEl: any) {
  const store = rootEl.std.store, gfx = rootEl.gfx;
  const pop = document.createElement('div'); pop.className = 'cx-evidence'; pop.hidden = true; document.body.append(pop);
  let timer = 0, showing = '';
  const hide = () => { clearTimeout(timer); pop.hidden = true; showing = ''; };
  addEventListener('pointerdown', hide, true);
  addEventListener('pointermove', (e: PointerEvent) => {
    const m = mapOf(store); if (!m || !m.size) return;
    if ((e.buttons & 1) || !rootEl.contains(e.target as Node) && !(e.target as HTMLElement)?.closest?.('affine-edgeless-root')) { if (showing) hide(); return; }
    const rr = rootEl.getBoundingClientRect();
    let pt: number[];
    try { pt = gfx.viewport.toModelCoord(e.clientX - rr.left, e.clientY - rr.top); } catch { return; }
    let best: { id: string; area: number } | null = null;
    for (const id of m.keys() as Iterable<string>) {
      const el: any = gfx.getElementById(id); if (!el) continue;
      const b = el.elementBound;
      if (pt[0] >= b.x && pt[0] <= b.x + b.w && pt[1] >= b.y && pt[1] <= b.y + b.h && (!best || b.w * b.h < best.area)) best = { id, area: b.w * b.h };
    }
    if (!best) { if (showing) hide(); return; }
    if (best.id === showing) return;
    clearTimeout(timer); pop.hidden = true; showing = best.id;
    const id = best.id;
    timer = window.setTimeout(() => {
      const ev = m.get(id) as Ev | undefined; const el: any = gfx.getElementById(id); if (!ev || !el) return;
      pop.innerHTML = '';
      if (ev.source) { const s = document.createElement('div'); s.className = 'src'; s.textContent = /general knowledge/i.test(ev.source) ? 'General knowledge' : ev.source; pop.append(s); }
      if (ev.quote) { const q = document.createElement('div'); q.className = 'q'; q.textContent = `“${ev.quote}”`; pop.append(q); }
      const b = el.elementBound; const [vx, vy] = gfx.viewport.toViewCoord(b.x + b.w, b.y);
      pop.style.left = (rr.left + vx + 8) + 'px'; pop.style.top = (rr.top + vy) + 'px';
      pop.hidden = false;
    }, 450);
  }, { passive: true });
}
