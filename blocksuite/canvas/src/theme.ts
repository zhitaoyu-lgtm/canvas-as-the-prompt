// The look of the board: light (default) or dark. A test switch for now (behind "+").
//
// A dark board is not the light one inverted. Three things keep it calm:
//   · surfaces (notes, cards, shapes) all sit in one narrow band of dark, slightly tinted greys: a note keeps its
//     hue as a hint, never as a bright patch, so nothing jumps;
//   · sections are a step darker than what lies on them, and the board darker still;
//   · writing and lines turn light; coloured ink is softened to one band of lightness.
// Stored colours never change: the retuning happens where a colour is shown (theme-service in the engine), so
// switching back gives exactly the board that was there, and the AI keeps reading the stored colours.

type Role = 'ink' | 'fill' | 'sheet' | 'raw';
const W = window as any;
const KEY = 'cx:look';
let dark = false;

const hsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const rgb = (h: number, s: number, l: number): [number, number, number] => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A stored colour → the colour shown on the dark board, by what it is for. */
export function darkTone(role: Role, h: number, s: number, l: number): [number, number, number] {
  const neutral = s < 0.1 || l > 0.985 || l < 0.03;
  if (role === 'fill') return neutral ? [h, 0, 0.165 + 0.1 * (1 - l)] : [h, Math.min(s, 0.6) * 0.46, 0.215 + 0.05 * (1 - l)];
  if (role === 'sheet') return neutral ? [h, 0, 0.095 + 0.04 * (1 - l)] : [h, Math.min(s, 0.6) * 0.34, 0.12];
  // ink: greys swap ends (dark writing turns light, a faint rule stays faint); colours gather in one soft band
  return neutral ? [h, s * 0.4, 0.86 - 0.66 * l] : [h, Math.min(s * 0.8, 0.7), clamp(l, 0.6, 0.7)];
}

const cache = new Map<string, string>();
function tone(role: Role, v: string): string {
  if (!dark || W.__cxToneOff || role === 'raw' || typeof v !== 'string') return v;
  const key = role + v, hit = cache.get(key); if (hit) return hit;
  let r: number, g: number, b: number, a = 1, m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(v.trim()))) {
    let x = m[1]; if (x.length === 3 || x.length === 4) x = [...x].map(c => c + c).join('');
    if (x.length !== 6 && x.length !== 8) return v;
    r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16); if (x.length === 8) a = parseInt(x.slice(6, 8), 16) / 255;
  } else if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(v.trim()))) {
    r = +m[1]; g = +m[2]; b = +m[3]; if (m[4]) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  } else return v;                                      // a name, a variable, transparent: the engine's own business
  if (a === 0) return v;
  const [R, G, B] = rgb(...darkTone(role, ...hsl(r, g, b)));
  const out = a < 1 ? `rgba(${R},${G},${B},${+a.toFixed(3)})` : '#' + [R, G, B].map(n => n.toString(16).padStart(2, '0')).join('');
  cache.set(key, out); return out;
}

export const isDark = () => dark;

// The editor keeps its own theme mark on the board's viewport (its text colours are scoped there).
const scope = () => { for (const e of Array.from(document.querySelectorAll('.affine-edgeless-viewport[data-theme], editor-host [data-theme]')) as HTMLElement[]) if (e.dataset.theme !== (dark ? 'dark' : 'light')) e.dataset.theme = dark ? 'dark' : 'light'; };

export function setLook(next: 'light' | 'dark', rootEl?: any) {
  dark = next === 'dark';
  try { localStorage.setItem(KEY, next); } catch { /* not kept */ }
  const root = document.documentElement;
  root.dataset.theme = next;            // the engine's own parts (menus, the toolbar on a selection, text in cards)
  root.dataset.cxLook = next;           // ours
  root.style.colorScheme = next;
  scope();
  // repaint what is already on the board
  const el = rootEl ?? W.cxDev?.rootEl;
  try { el?.gfx?.surfaceComponent?.renderer?.refresh?.(); } catch { /* next change repaints */ }
  try { for (const n of Array.from(document.querySelectorAll('affine-frame, affine-edgeless-note, affine-frame-title, edgeless-note-background, affine-edgeless-text')) as any[]) n.requestUpdate?.(); } catch { /* same */ }
}

export function initLook() {
  W.__cxTone = tone; W.__cxToneOn = () => dark && !W.__cxToneOff;
  let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* light */ }
  dark = saved === 'dark';
  const root = document.documentElement, want = () => (dark ? 'dark' : 'light');
  // A host page may set data-theme itself (a dark-mode preview): the board keeps the look chosen here.
  const pin = () => { if (root.dataset.theme !== want()) root.dataset.theme = want(); if (root.dataset.cxLook !== want()) root.dataset.cxLook = want(); };
  pin(); root.style.colorScheme = want();
  new MutationObserver(pin).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (dark) { let n = 0; const t = setInterval(() => { scope(); if (++n > 20) clearInterval(t); }, 500); }   // the editor mounts after this
  W.cxLook = { set: setLook, get: () => want(), tone };
}
