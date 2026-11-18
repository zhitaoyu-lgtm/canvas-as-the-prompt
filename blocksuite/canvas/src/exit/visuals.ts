// Pictures the document draws for itself from what the board says: a clean map of the board,
// a table of its sources, a timeline, a composition chart, the user's notes as cards, and a
// diagram of a note placed on its source. All of it is drawn here (SVG / HTML), so it reads
// as part of the document rather than a screenshot pasted in.

export type Box = { x: number; y: number; w: number; h: number };
export type MapItem = { kind: 'sticky' | 'card' | 'frame' | 'text' | 'other'; box: Box; fill?: string; label?: string };
export type Note = { text: string; fill?: string };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ink = '#1d1d1f', line = '#e4e2dc', paper = '#ffffff', ground = '#f6f5f2';

/** a header bar on a figure, with "Show on board" when the picture comes from a place on the board */
export const figHead = (label: string, box?: Box) =>
  `<div class="cx-fig-head"><span>${esc(label)}</span>${box ? `<button class="cx-goto" data-goto="${[box.x, box.y, box.w, box.h].map(Math.round).join(',')}" contenteditable="false">Show on board<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h6.5V10M12.5 3.5L4 12"/></svg></button>` : ''}</div>`;

/** the board redrawn: every thing where it was, in its colour; sections outlined and named */
export function boardMap(items: MapItem[]): string {
  if (!items.length) return '';
  const x0 = Math.min(...items.map(i => i.box.x)), y0 = Math.min(...items.map(i => i.box.y));
  const x1 = Math.max(...items.map(i => i.box.x + i.box.w)), y1 = Math.max(...items.map(i => i.box.y + i.box.h));
  const pad = 28, W = 600, k = (W - 2 * pad) / Math.max(1, x1 - x0), H = Math.round((y1 - y0) * k + 2 * pad);
  const X = (v: number) => (pad + (v - x0) * k).toFixed(1), Y = (v: number) => (pad + (v - y0) * k).toFixed(1), S = (v: number) => Math.max(1, v * k).toFixed(1);
  const out: string[] = [`<svg class="cx-map" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">`, `<rect width="${W}" height="${H}" rx="12" fill="${ground}"/>`];
  // a faint dot grid, like the canvas
  out.push(`<defs><pattern id="cxdots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="0.9" fill="#d9d6ce"/></pattern></defs><rect width="${W}" height="${H}" rx="12" fill="url(#cxdots)"/>`);
  for (const i of items.filter(i => i.kind === 'frame')) {
    out.push(`<rect x="${X(i.box.x)}" y="${Y(i.box.y)}" width="${S(i.box.w)}" height="${S(i.box.h)}" rx="8" fill="#ffffff" fill-opacity=".55" stroke="#cfccc4" stroke-dasharray="4 3"/>`);
    if (i.label) out.push(`<text x="${X(i.box.x)}" y="${(+Y(i.box.y) - 6).toFixed(1)}" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="${ink}">${esc(i.label.slice(0, 48))}</text>`);
  }
  for (const i of items.filter(i => i.kind !== 'frame')) {
    const x = +X(i.box.x), y = +Y(i.box.y), w = +S(i.box.w), h = +S(i.box.h);
    if (i.kind === 'text') { out.push(`<text x="${x}" y="${(y + Math.min(h, 14) * 0.85).toFixed(1)}" font-family="Inter, system-ui, sans-serif" font-size="${Math.max(9, Math.min(14, h * 0.8)).toFixed(1)}" font-weight="600" fill="${ink}">${esc((i.label ?? '').slice(0, 60))}</text>`); continue; }
    if (i.kind === 'sticky') { out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${i.fill ?? '#ffe299'}"/>`); for (let l = 0; l < Math.min(3, Math.floor((h - 8) / 7)); l++) out.push(`<rect x="${(x + 5).toFixed(1)}" y="${(y + 6 + l * 7).toFixed(1)}" width="${((w - 10) * (l === 2 ? 0.45 : 0.8)).toFixed(1)}" height="2.6" rx="1.3" fill="#000" fill-opacity=".22"/>`); continue; }
    // a card: white, a dark title line and grey lines under it
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${paper}" stroke="${line}"/>`);
    const rows = Math.max(1, Math.min(5, Math.floor((h - 10) / 8)));
    for (let l = 0; l < rows; l++) out.push(`<rect x="${(x + 6).toFixed(1)}" y="${(y + 7 + l * 8).toFixed(1)}" width="${((w - 12) * (l === 0 ? 0.7 : l === rows - 1 ? 0.4 : 0.85)).toFixed(1)}" height="${l === 0 ? 3.2 : 2.4}" rx="1.2" fill="${l === 0 ? ink : '#c9c6bd'}"/>`);
  }
  out.push('</svg>');
  return out.join('');
}

export const mapLegend = (fills: string[]) => {
  const sw = (bg: string, b = '') => `<i style="background:${bg};${b}"></i>`;
  const uniq = [...new Set(fills)].slice(0, 5);
  return `<div class="cx-legend">${uniq.length ? `<span>${uniq.map(f => sw(f)).join('')}your notes</span>` : ''}<span>${sw('#fff', `box-shadow:inset 0 0 0 1px ${line}`)}cards and sources</span><span>${sw('transparent', 'border:1px dashed #cfccc4')}sections</span></div>`;
};

/** sources as a table: what it is, when, and what the board says about it */
export function sourceTable(rows: { n: number; title: string; kind: string; year?: string; says: string; notes: string[] }[]): string {
  const tr = rows.map(r => `<tr><td class="n">${r.n}</td><td><b>${esc(r.title)}</b><small>${esc([r.kind, r.year].filter(Boolean).join(' · '))}</small></td><td>${r.says ? esc(r.says) : r.notes.length ? '' : '<span class="m">—</span>'}${r.notes.map(t => `<span class="pin">${esc(t)}</span>`).join('')}</td></tr>`).join('');
  return `<div class="cx-table-wrap"><table class="cx-table"><thead><tr><th>#</th><th>Source</th><th>What the board says</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** dated sources on one axis; undated ones counted at the end */
export function timeline(points: { year: number; label: string; n: number }[], undated: { label: string; n: number }[]): string {
  const ys = points.map(p => p.year), lo = Math.floor(Math.min(...ys) / 10) * 10, hi = Math.max(new Date().getFullYear(), Math.max(...ys));
  const pct = (y: number) => ((y - lo) / Math.max(1, hi - lo)) * 100;
  const ticks: number[] = []; for (let t = lo; t <= hi; t += (hi - lo) > 50 ? 20 : 10) ticks.push(t);
  const dots = points.sort((a, b) => a.year - b.year).map((p, k) => `<div class="pt ${k % 2 ? 'dn' : 'up'}" style="left:${pct(p.year).toFixed(2)}%"><i></i><span><b>${p.year}</b>${esc(p.label)} <sup>[${p.n}]</sup></span></div>`).join('');
  const now = undated.length ? `<div class="pt now ${points.length % 2 ? 'dn' : 'up'}" style="left:100%"><i></i><span><b>Now</b>${undated.map(u => `${u.n} ${esc(u.label)}`).join(' · ')}</span></div>` : '';
  return `<div class="cx-time"><div class="axis"></div>${ticks.map(t => `<div class="tick" style="left:${pct(t).toFixed(2)}%"><span>${t}</span></div>`).join('')}${dots}${now}</div>`;
}

/** horizontal bars: how much of each kind of thing is on the board */
export function bars(rows: { label: string; value: number; color?: string }[]): string {
  const max = Math.max(...rows.map(r => r.value), 1);
  return `<div class="cx-bars">${rows.map(r => `<div class="row"><span class="l">${esc(r.label)}</span><span class="b"><i style="width:${(r.value / max * 100).toFixed(1)}%;${r.color ? `background:${r.color}` : ''}"></i></span><span class="v">${r.value}</span></div>`).join('')}</div>`;
}

/** the user's own notes, typeset as cards in their colours */
export const noteCards = (notes: Note[]) => `<div class="cx-notes">${notes.map(n => `<div class="cx-note" style="background:${n.fill ?? '#ffe299'}">${esc(n.text)}</div>`).join('')}</div>`;

/** a note placed on a source: the placement is the citation */
export function pinned(groups: { n: number; title: string; meta?: string; notes: Note[] }[]): string {
  return `<div class="cx-pinned">${groups.map(g => `<div class="cx-pin-g"><div class="cx-src"><small>${esc(g.meta ?? 'Source')}</small><b>${esc(g.title)}</b><span class="ref">[${g.n}]</span></div>${g.notes.map((n, k) => `<div class="cx-note sm" style="background:${n.fill ?? '#ffe299'};--r:${k % 2 ? 2 : -2}deg">${esc(n.text)}</div>`).join('')}<div class="cx-pin-arrow">placed on it → cited as [${g.n}]</div></div>`).join('')}</div>`;
}
