// One design system for everything on the board — what the user makes with the toolbar and what
// the AI makes. FigJam looks unified because every object draws from the same few choices:
//   · one hue set: stickies, shapes, section tints, tags, ink all come from the same 9 hues
//   · fixed sizes: a sticky is always the same square; text uses a short type scale
//   · one corner radius per kind, one shadow, one stroke weight
//   · an 8px grid: positions and gaps snap, so neighbours line up even when placed by hand
//   · generated content is built from the same primitives as hand-made content
// Change a value here and both the toolbar and the AI follow.

export type Hue = 'white' | 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'pink';
export const HUES: Hue[] = ['white', 'gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'];

/** Sticky / shape fill (FigJam sticky colours). */
export const FILL: Record<Hue, string> = {
  white: '#ffffff', gray: '#e6e6e6', red: '#ffafa3', orange: '#ffd3a8', yellow: '#ffe299',
  green: '#b3efbd', teal: '#b3f4ef', blue: '#a8daff', violet: '#d3bdff', pink: '#ffa8db',
};
/** Strong version of each hue: pen ink, dots, curves, loops, bars. */
export const INK: Record<Hue, string> = {
  white: '#ffffff', gray: '#8a8984', red: '#f24822', orange: '#ff9e42', yellow: '#ffc943',
  green: '#66d575', teal: '#3dc3b8', blue: '#3dadff', violet: '#874fff', pink: '#ff7ad9',
};
/** Section / container tint: the same hue, mostly white. */
const mix = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * k));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
};
export const TINT: Record<Hue, string> = Object.fromEntries(HUES.map(h => [h, h === 'white' ? '#ffffff' : h === 'gray' ? '#f2f2f2' : mix(FILL[h], 0.72)])) as any;

export const TEXT = { ink: '#1e1e1e', body: '#3a3a3c', muted: '#8a8984', line: '#e6e6e6' };
export const TYPE = { caption: 12, small: 14, body: 16, title: 20, heading: 28 } as const;
export const FONT = 'blocksuite:surface:Inter';
export const RADIUS = { sticky: 0.04, card: 16, section: 12, pill: 0.5 } as const;
export const SHADOW = {
  sticky: { blur: 8, offsetX: 0, offsetY: 3, color: 'rgba(0,0,0,0.10)' },
  card: '--affine-note-shadow-box',
} as const;
export const SIZE = { sticky: 184, stickySmall: 120, gap: 40, grid: 8 } as const;
export const STROKE = { width: 2, color: '#1e1e1e' } as const;

export const snap = (v: number) => Math.round(v / SIZE.grid) * SIZE.grid;

/** Name or hex → a hue (nearest by name; hex passes through elsewhere). */
export function hueOf(c?: string): Hue | undefined {
  if (!c) return undefined;
  const s = c.toLowerCase().replace(/^light\s+/, '').replace('grey', 'gray').replace('purple', 'violet').trim();
  return (HUES as string[]).includes(s) ? (s as Hue) : undefined;
}

/** The one sticky everyone makes. */
export function stickyProps(fill: string, x: number, y: number, size: number = SIZE.sticky) {
  return {
    shapeType: 'rect', xywh: `[${snap(x)},${snap(y)},${size},${size}]`, radius: RADIUS.sticky, filled: true, fillColor: fill,
    strokeColor: 'transparent', strokeWidth: 0, color: TEXT.ink, fontSize: fitSize(size), fontFamily: FONT,
    textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [16, 16],
    shadow: SHADOW.sticky,
  };
}
/** Sticky text shrinks a step for small stickies (FigJam fits text to the note). */
export function fitSize(size: number, text = ''): number {
  const base = size >= 160 ? TYPE.body : TYPE.small;
  const area = (size - 32) * (size - 32), need = text.length * base * base * 0.62 * 1.35;
  return need > area ? Math.max(TYPE.caption, Math.floor(base * Math.sqrt(area / need))) : base;
}
/** Card (doc note) style shared by the toolbar's doc and AI cards. */
export const CARD_STYLE = { borderRadius: RADIUS.card, borderSize: 0, borderStyle: 'none', shadowType: SHADOW.card };
