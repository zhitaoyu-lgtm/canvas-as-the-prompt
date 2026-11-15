// Small-scale spatial language: what is attached to what, what titles what, what a legend says,
// what lies along a timeline. These are the marks people add on top of their main structure.

import type { Box, Group, Item } from './reading';

export type Relations = { lines: string[]; attached: Map<string, string>; titles: Map<string, string>; legend: { colour: string; hex?: string; label: string; ref: string; usedBy: string[] }[] };

const area = (b: Box) => b.w * b.h;
const inter = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)));
const q = (s: string) => JSON.stringify(s.length > 40 ? s.slice(0, 39) + '…' : s);
const SMALL = new Set(['tag', 'dot', 'badge', 'sticker', 'text', 'shape']);
const HOST = new Set(['sticky', 'card', 'doc', 'table', 'image', 'shape', 'embed', 'text']);

/** Small marks on or touching a bigger thing (tags, dots, badges, stickers, small notes). Keyed by id. */
export function attachmentsOf(items: Item[], ownerOf: Map<string, Item>): Map<string, string> {
  const out = new Map<string, string>();
  const owns = new Set([...ownerOf.values()].map(o => o.id));
  for (const a of items) {
    if (!SMALL.has(a.kind) || owns.has(a.id)) continue;
    if (a.kind === 'shape' && area(a.box) > 9000) continue;
    let best: Item | undefined, bestScore = 0;
    for (const b of items) {
      if (b === a || !HOST.has(b.kind) || owns.has(b.id) || ownerOf.get(a.id) === b) continue;
      if (area(a.box) > area(b.box) * (a.kind === 'text' ? 0.35 : 0.3)) continue;
      const ov = inter(a.box, b.box) / Math.max(1, area(a.box));
      const touch = gap(a.box, b.box);
      const score = ov >= 0.25 ? 1 + ov : touch <= (a.kind === 'text' ? 4 : 10) ? 0.5 - touch / 100 : 0;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    if (best && (a.kind !== 'text' || bestScore > 1)) out.set(a.id, best.id);
  }
  return out;
}

export function relationsOf(items: Item[], groups: Group[], byRef: Map<string, Item>, attachedRefs: Map<string, string>): Relations {
  const lines: string[] = [];
  const attached = attachedRefs;
  const byHost = new Map<string, Item[]>();
  for (const [a, b] of attached) (byHost.get(b) ?? byHost.set(b, []).get(b)!).push(byRef.get(a)!);
  for (const [host, list] of byHost) {
    const dots = list.filter(i => i.kind === 'dot');
    const parts: string[] = [];
    if (dots.length) {
      const byC = new Map<string, number>(); dots.forEach(d => byC.set(d.colour ?? 'dot', (byC.get(d.colour ?? 'dot') ?? 0) + 1));
      parts.push(`${dots.length} dot${dots.length > 1 ? 's' : ''} (${[...byC].map(([c, n]) => `${n} ${c}`).join(', ')}; dots on things usually mean votes) ${dots.map(d => d.ref).join(' ')}`);
    }
    for (const i of list.filter(i => i.kind !== 'dot')) {
      const how = inter(i.box, byRef.get(host)!.box) > 0 ? 'on' : 'beside';
      parts.push(`${i.kind} ${i.ref}${i.text ? ' ' + q(i.text) : ''}${i.colour ? ' ' + i.colour : ''} ${how} it`);
    }
    lines.push(`${host} carries: ${parts.join('; ')}`);
  }

  // ── titles: a text just above a group, or a large/bold text heading the group itself ──
  const titles = new Map<string, string>();
  const heavy = (t: Item) => t.kind === 'text' && (t.size === 'large' || /bold/.test(t.style ?? ''));
  for (const g of groups) {
    const ms = g.members.map(r => byRef.get(r)!).filter(Boolean);
    if (ms.length < 2 || g.box.w < 120) continue;
    const inside = ms.filter(t => heavy(t) && ms.every(o => o === t || o.box.y >= t.box.y + t.box.h - 4));
    const cand = inside.length ? inside : items.filter(t => t.kind === 'text' && !g.members.includes(t.ref) && !attached.has(t.ref)
      && t.box.y + t.box.h <= g.box.y + 6 && t.box.y + t.box.h >= g.box.y - 90
      && Math.min(t.box.x + t.box.w, g.box.x + g.box.w) - Math.max(t.box.x, g.box.x) > Math.min(t.box.w, g.box.w) * 0.5);
    cand.sort((a, b) => (b.box.y + b.box.h) - (a.box.y + a.box.h));
    if (cand[0]) { titles.set(g.ref, cand[0].ref); lines.push(`${g.ref} is titled ${q(cand[0].text)} (${cand[0].ref})`); }
  }

  // ── legend: a row (or column) of labelled colour chips whose colours are used elsewhere ──
  const legend: Relations['legend'] = [];
  const used = (colour: string, except: Set<string>) => items.filter(i => !except.has(i.ref) && (i.colour === colour || i.marks?.some(m => m.colour === colour)) && !['tag', 'dot', 'text', 'badge'].includes(i.kind)).map(i => i.ref);
  type Chip = { colour: string; hex?: string; label: string; ref: string; box: Box };
  const chips: Chip[] = [];
  for (const m of items) {
    if (attached.has(m.ref)) continue;
    if (m.kind === 'tag' && m.colour && m.colour !== 'white') chips.push({ colour: m.colour, hex: m.hex, label: m.text, ref: m.ref, box: m.box });
    else if (m.kind === 'tag') {   // a white pill holding a coloured dot
      const d = items.find(d => d.kind === 'dot' && d.colour && inter(d.box, m.box) > area(d.box) * 0.8);
      if (d) chips.push({ colour: d.colour!, hex: d.hex, label: m.text, ref: m.ref, box: m.box });
    } else if ((m.kind === 'dot' || ((m.kind === 'shape' || m.kind === 'sticky') && Math.max(m.box.w, m.box.h) <= 60)) && m.colour && !m.text) {
      const lbl = items.find(t => t.kind === 'text' && Math.abs((t.box.y + t.box.h / 2) - (m.box.y + m.box.h / 2)) < Math.max(14, m.box.h) && t.box.x >= m.box.x + m.box.w - 4 && t.box.x - (m.box.x + m.box.w) < 40);
      if (lbl) chips.push({ colour: m.colour, hex: m.hex, label: lbl.text, ref: m.ref, box: { x: m.box.x, y: Math.min(m.box.y, lbl.box.y), w: lbl.box.x + lbl.box.w - m.box.x, h: Math.max(m.box.h, lbl.box.h) } });
    }
  }
  const seen = new Set<string>();
  for (const c of chips) {
    if (seen.has(c.ref)) continue;
    // chips in one row or column, near each other
    const row = chips.filter(o => !seen.has(o.ref) && (Math.abs(o.box.y - c.box.y) < 8 || Math.abs(o.box.x - c.box.x) < 8)).sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
    const set: Chip[] = [];
    for (const o of row) { const last = set[set.length - 1]; if (!last || gap(last.box, o.box) < 80) set.push(o); }
    if (set.length < 2) continue;
    set.forEach(o => seen.add(o.ref));
    const except = new Set(set.map(o => o.ref));
    // a legend speaks for what is near it (or shares its container), not the whole board
    const lb = set.reduce((u, o) => ({ x: Math.min(u.x, o.box.x), y: Math.min(u.y, o.box.y), w: Math.max(u.x + u.w, o.box.x + o.box.w) - Math.min(u.x, o.box.x), h: Math.max(u.y + u.h, o.box.y + o.box.h) - Math.min(u.y, o.box.y) }), set[0].box);
    const parentOf = byRef.get(set[0].ref)?.parent;
    const close = (ref: string) => { const it = byRef.get(ref)!; return (parentOf && it.parent === parentOf) || gap(it.box, lb) < 220; };
    // …and for the whole group next to it (a row that starts near the legend belongs to it)
    const near = new Set<string>(); for (const g of groups) if (g.members.some(close)) g.members.forEach(m => near.add(m));
    const nearby = (ref: string) => close(ref) || near.has(ref);
    const withUse = set.map(o => ({ colour: o.colour, hex: o.hex, label: o.label, ref: o.ref, usedBy: used(o.colour, except).filter(nearby) }));
    if (!withUse.some(c => c.usedBy.length)) continue;
    legend.push(...withUse);
    lines.push(`LEGEND ${set.map(o => o.ref).join(' ')}: ${withUse.map(c => `${c.colour} = ${q(c.label)}${c.usedBy.length ? ` (so ${c.usedBy.slice(0, 8).join(' ')}${c.usedBy.length > 8 ? ' …' : ''} are ${q(c.label)})` : ''}`).join('; ')}`);
  }

  // ── timeline: one long free line with marks along it ──
  for (const ln of items.filter(i => i.kind === 'connector' && (!i.arrow?.from || !i.arrow?.to))) {
    const b = ln.box; const horiz = b.w > 200 && b.h < 24, vert = b.h > 200 && b.w < 24;
    if (!horiz && !vert) continue;
    const on = items.filter(i => i !== ln && i.kind !== 'connector' && (horiz
      ? Math.abs(i.box.y + i.box.h / 2 - (b.y + b.h / 2)) < Math.max(24, i.box.h / 2 + 6) && i.box.x + i.box.w / 2 >= b.x - 10 && i.box.x + i.box.w / 2 <= b.x + b.w + 10
      : Math.abs(i.box.x + i.box.w / 2 - (b.x + b.w / 2)) < Math.max(24, i.box.w / 2 + 6) && i.box.y + i.box.h / 2 >= b.y - 10 && i.box.y + i.box.h / 2 <= b.y + b.h + 10));
    if (on.length < 2) continue;
    on.sort((p, r) => horiz ? p.box.x - r.box.x : p.box.y - r.box.y);
    const cxm = (m: Item) => m.box.x + m.box.w / 2;
    const below = (m: Item) => items.find(t => t.kind === 'text' && !on.includes(t) && (horiz
      ? Math.abs(t.box.x + t.box.w / 2 - cxm(m)) < Math.max(40, t.box.w / 2) && t.box.y >= m.box.y + m.box.h - 2 && t.box.y - (m.box.y + m.box.h) < 50
      : Math.abs(t.box.y + t.box.h / 2 - (m.box.y + m.box.h / 2)) < 30 && t.box.x >= m.box.x + m.box.w - 2 && t.box.x - (m.box.x + m.box.w) < 60));
    const above = (m: Item) => horiz ? items.find(t => t.kind === 'text' && !on.includes(t) && Math.abs(t.box.x + t.box.w / 2 - cxm(m)) < Math.max(40, t.box.w / 2) + 10 && t.box.y + t.box.h <= m.box.y + 2 && m.box.y - (t.box.y + t.box.h) < 70) : undefined;
    lines.push(`TIMELINE along ${ln.ref} (${horiz ? 'left→right' : 'top→bottom'}): ${on.map(m => { const l = m.kind === 'text' ? null : below(m), a = m.kind === 'text' ? null : above(m); return `${m.ref}${m.text ? ' ' + q(m.text) : ''}${l ? ' labelled ' + q(l.text) + ' (' + l.ref + ')' : ''}${a ? ' with callout ' + q(a.text) + ' (' + a.ref + ')' : ''}`; }).join(' → ')}`);
  }
  // ── venn: big overlapping circles; what sits in each region ──
  const circles = items.filter(i => (i.kind === 'shape' || i.kind === 'card') && i.shape === 'ellipse' && i.box.w >= 140 && i.box.h >= 140);
  const inEllipse = (c: Item, x: number, y: number) => { const rx = c.box.w / 2, ry = c.box.h / 2; const dx = (x - c.box.x - rx) / rx, dy = (y - c.box.y - ry) / ry; return dx * dx + dy * dy <= 1; };
  const vseen = new Set<string>();
  for (const c of circles) {
    if (vseen.has(c.ref)) continue;
    const set = circles.filter(o => o === c || inter(o.box, c.box) > Math.min(area(o.box), area(c.box)) * 0.08);
    if (set.length < 2) continue;
    set.forEach(o => vseen.add(o.ref));
    const regions = new Map<string, string[]>();
    for (const it of items) {
      if (set.includes(it) || it.kind === 'connector' || it.kind === 'frame') continue;
      const cx = it.box.x + it.box.w / 2, cy = it.box.y + it.box.h / 2;
      const inside = set.filter(o => inEllipse(o, cx, cy)).map(o => o.ref);
      if (!inside.length) continue;
      const key = inside.join('+'); (regions.get(key) ?? regions.set(key, []).get(key)!).push(it.ref);
    }
    // a circle's name: its own words, or a text just above / inside its top
    const nameOf = (o: Item) => o.text || items.find(t => t.kind === 'text' && t.box.x + t.box.w / 2 > o.box.x && t.box.x + t.box.w / 2 < o.box.x + o.box.w && t.box.y + t.box.h > o.box.y - 70 && t.box.y < o.box.y + o.box.h * 0.25 && !set.some(c2 => c2 !== o && Math.abs(t.box.x + t.box.w / 2 - (c2.box.x + c2.box.w / 2)) < Math.abs(t.box.x + t.box.w / 2 - (o.box.x + o.box.w / 2))))?.text;
    const names = set.map(o => { const n = nameOf(o); return `${o.ref}${n ? ' ' + q(n) : ''}`; });
    lines.push(`VENN of ${names.join(', ')}: ${[...regions].map(([k, v]) => `${k.includes('+') ? 'overlap ' + k : 'only ' + k} holds ${v.join(' ')}`).join('; ') || 'regions empty'} (place into a region with {"venn":[refs]})`);
  }

  // ── funnel / pyramid: a centred stack of shapes whose widths shrink (or grow) step by step ──
  const fseen = new Set<string>();
  for (const a0 of items.filter(i => i.kind === 'shape' || i.kind === 'card')) {
    if (fseen.has(a0.ref)) continue;
    const cx = a0.box.x + a0.box.w / 2;
    const stack = items.filter(i => (i.kind === 'shape' || i.kind === 'card') && Math.abs(i.box.x + i.box.w / 2 - cx) < 12).sort((p, r) => p.box.y - r.box.y);
    const run: Item[] = [];
    for (const it of stack) { const last = run[run.length - 1]; if (!last || (it.box.y - (last.box.y + last.box.h) < 40 && it.box.y >= last.box.y + last.box.h - 4)) run.push(it); }
    if (run.length < 3) continue;
    const ws = run.map(i => i.box.w), down = ws.every((w, i) => i === 0 || w < ws[i - 1] - 8), up = ws.every((w, i) => i === 0 || w > ws[i - 1] + 8);
    if (!down && !up) continue;
    run.forEach(i => fseen.add(i.ref));
    lines.push(`${down ? 'FUNNEL' : 'PYRAMID'} top→bottom: ${run.map(i => `${i.ref}${i.text ? ' ' + q(i.text) : ''}`).join(' → ')}`);
  }
  return { lines, attached, titles, legend };
}
