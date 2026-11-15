// Small transient messages from the AI (errors, nothing to change). AI work itself carries no mark.

type El = HTMLElement;
const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

/** A short line near a point, for errors; fades by itself. */
export function toast(msg: string, at?: { x: number; y: number }) {
  const t = h('div', 'cx-toast'); t.textContent = msg; document.body.append(t);
  const w = t.offsetWidth;
  t.style.left = `${Math.max(12, Math.min((at?.x ?? innerWidth / 2) - w / 2, innerWidth - w - 12))}px`;
  t.style.top = `${at?.y ?? 80}px`;
  requestAnimationFrame(() => t.classList.add('on'));
  setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, 3200);
}
