/**
 * Dot-grid spacing on screen, FigJam style: the world grid is 20 units at 100%,
 * and when zooming it halves or doubles by powers of two, so the dots on screen
 * always stay between 14 and 28 px apart (never a dense carpet when zoomed out,
 * never sparse when zoomed in). Each level is a multiple of the last, so dots
 * stay anchored to the same world positions as the spacing changes.
 */
const BASE = 20;
const MIN_SCREEN_GAP = 14;

export function getBgGridGap(zoom: number) {
  if (!(zoom > 0)) return BASE;
  let gap = BASE * zoom;
  while (gap < MIN_SCREEN_GAP) gap *= 2;
  while (gap >= MIN_SCREEN_GAP * 2) gap /= 2;
  return gap;
}
