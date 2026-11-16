// The template library: one family of templates built from the same parts the AI uses (sections,
// panels, cards, stickies, matrix, diagram), so a template looks like the rest of the board. Each
// thumbnail is drawn by the same small set of shapes in the same palette: gray board, white sheets,
// soft tints, pastel stickies, gray text bars, one dark title bar.

import { FILL, TINT, type Hue } from './design';
import { execute, type Action } from './ai/actions';
import { readBoard } from './ai/reading';

// ── thumbnails ────────────────────────────────────────────────────────────────────────────────
const W = 280, H = 168;
type S = string;
const rect = (x: number, y: number, w: number, h: number, fill: string, r = 4, stroke = 'none', dash = false): S =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${stroke === 'none' ? 0 : 0.8}"${dash ? ' stroke-dasharray="3 2"' : ''}/>`;
const bar = (x: number, y: number, w: number, dark = false, h = dark ? 4 : 2.6): S => rect(x, y, w, h, dark ? '#1d1d1f' : '#c7c7cc', h / 2);
const sheet = (x: number, y: number, w: number, h: number): S => rect(x, y, w, h, '#ffffff', 6, '#e6e6e6');
const sticky = (x: number, y: number, s: number, hue: Hue): S => rect(x, y, s, s, FILL[hue], 1.5) + bar(x + 3, y + 4, s * 0.6);
const tintBox = (x: number, y: number, w: number, h: number, hue: Hue, border = true): S => rect(x, y, w, h, TINT[hue], 4, border ? FILL[hue] : 'none');
const card = (x: number, y: number, w: number, h: number): S => rect(x, y, w, h, '#ffffff', 3, '#e6e6e6') + bar(x + 4, y + 5, w * 0.5, true, 2.6) + bar(x + 4, y + 11, w - 8) + bar(x + 4, y + 16, w * 0.6);
const line = (x1: number, y1: number, x2: number, y2: number, dash = false): S => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#8e8e93" stroke-width="0.9" fill="none"${dash ? ' stroke-dasharray="3 2"' : ''}/>`;
const svg = (body: S) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 6 ${W - 16} ${H - 12}" width="${W - 16}" height="${H - 12}">${body}</svg>`;
// a titled sheet with n columns of tinted boxes, each holding a few stickies or cards
function columns(hues: Hue[], fillWith: 'sticky' | 'card' | 'dash', rows = 2): string {
  const x0 = 20, y0 = 18, sw = W - 40, sh = H - 36;
  let b = sheet(x0, y0, sw, sh) + bar(x0 + 10, y0 + 10, 60, true) + bar(x0 + 10, y0 + 18, 90);
  const n = hues.length, g = 6, cw = (sw - 20 - g * (n - 1)) / n, ch = sh - 38;
  hues.forEach((h, i) => {
    const x = x0 + 10 + i * (cw + g), y = y0 + 28;
    b += fillWith === 'dash' ? rect(x, y, cw, ch, 'none', 4, '#c7c7cc', true) : tintBox(x, y, cw, ch, h, false);
    b += bar(x + 5, y + 6, cw * 0.45, true, 3);
    for (let r = 0; r < rows; r++) {
      if (fillWith === 'card') b += card(x + 5, y + 14 + r * 30, cw - 10, 24);
      else { const s = Math.min(18, (cw - 15) / 2); b += sticky(x + 5, y + 14 + r * (s + 5), s, fillWith === 'dash' ? (['yellow', 'blue', 'green', 'pink'] as Hue[])[i % 4] : h); b += sticky(x + 10 + s, y + 14 + r * (s + 5), s, fillWith === 'dash' ? (['yellow', 'blue', 'green', 'pink'] as Hue[])[i % 4] : h); }
    }
  });
  return svg(b);
}
function quad(hues: Hue[], axes = true): string {
  const x0 = 34, y0 = 16, cw = 102, ch = 62, g = 6;
  let b = '';
  hues.forEach((h, i) => { const x = x0 + (i % 2) * (cw + g), y = y0 + Math.floor(i / 2) * (ch + g); b += tintBox(x, y, cw, ch, h); b += bar(x + 7, y + 8, 34, true, 3); b += bar(x + 7, y + 16, 50); b += bar(x + 7, y + 26, 40); b += bar(x + 7, y + 31, 56); });
  if (axes) { b += line(22, 150, 252, 150) + line(22, 150, 22, 12) + bar(110, 156, 50) + `<rect x="10" y="60" width="2.6" height="40" rx="1.3" fill="#c7c7cc"/>`; }
  return svg(b);
}
function panels(hues: Hue[], hero = true): string {
  const x0 = 16, y0 = 12;
  let b = sheet(x0, y0, W - 32, H - 24) + bar(x0 + 10, y0 + 10, 80, true, 6) + bar(x0 + 10, y0 + 21, 120);
  const cw = (W - 32 - 20 - 12) / 3, ch = 46;
  hues.forEach((h, i) => { const x = x0 + 10 + (i % 3) * (cw + 6), y = y0 + 32 + Math.floor(i / 3) * (ch + 6); b += tintBox(x, y, cw, ch, h); b += bar(x + 6, y + 7, cw * 0.4, true, 3); b += bar(x + 6, y + 15, cw * 0.7); b += bar(x + 6, y + 20, cw * 0.55); b += bar(x + 6, y + 25, cw * 0.65); });
  return svg(b);
}
function flow(nodes: { x: number; y: number; w: number; h: number; hue: Hue; r?: number; diamond?: boolean }[], edges: [number, number, boolean?][], zones: { x: number; y: number; w: number; h: number; hue: Hue }[] = []): string {
  let b = sheet(12, 10, W - 24, H - 20) + bar(22, 20, 70, true);
  for (const z of zones) b += rect(z.x, z.y, z.w, z.h, TINT[z.hue], 5);
  const c = (n: any) => [n.x + n.w / 2, n.y + n.h / 2];
  for (const [a, z, d] of edges) { const [x1, y1] = c(nodes[a]), [x2, y2] = c(nodes[z]); b += line(nodes[a].x + nodes[a].w, y1, x2 - nodes[z].w / 2, y2, d); }
  for (const n of nodes) {
    if (n.diamond) b += `<path d="M${n.x + n.w / 2} ${n.y} L${n.x + n.w} ${n.y + n.h / 2} L${n.x + n.w / 2} ${n.y + n.h} L${n.x} ${n.y + n.h / 2} Z" fill="#fff" stroke="${FILL[n.hue]}" stroke-width="1.2"/>`;
    else b += rect(n.x, n.y, n.w, n.h, TINT[n.hue], n.r ?? 3, FILL[n.hue]);
    b += bar(n.x + n.w * 0.2, n.y + n.h / 2 - 1.3, n.w * 0.6);
  }
  return svg(b);
}

// ── the templates ────────────────────────────────────────────────────────────────────────────
type T = { id: string; name: string; cat: string; preview: string; actions: (at: [number, number]) => Action[] };
const st = (text: string, colour: Hue = 'yellow') => ({ kind: 'sticky', text, colour });
const dashedCol = (title: string, notes: string[], colour: Hue) => ({ kind: 'section', title, colour: 'white', cols: 2, items: notes.map(n => st(n, colour)) });

export const TEMPLATES: T[] = [
  // Research
  { id: 'affinity', name: 'Affinity map', cat: 'Research', preview: columns(['blue', 'green', 'violet', 'orange'], 'sticky'),
    actions: at => [{ do: 'section', title: 'Affinity map', subtitle: 'Drop interview notes in, then group them into themes', colour: 'white', place: { at }, cols: 4, items: [
      { kind: 'section', title: 'Theme 1', colour: 'blue', cols: 2, items: [st('Observation', 'blue'), st('Quote', 'blue'), st('Insight', 'blue')] },
      { kind: 'section', title: 'Theme 2', colour: 'green', cols: 2, items: [st('Observation', 'green'), st('Quote', 'green'), st('Insight', 'green')] },
      { kind: 'section', title: 'Theme 3', colour: 'violet', cols: 2, items: [st('Observation', 'violet'), st('Quote', 'violet'), st('Insight', 'violet')] },
      { kind: 'section', title: 'Theme 4', colour: 'orange', cols: 2, items: [st('Observation', 'orange'), st('Quote', 'orange'), st('Insight', 'orange')] } ] }] },
  { id: 'persona', name: 'Persona', cat: 'Research', preview: panels(['blue', 'red', 'green', 'violet', 'orange', 'gray']),
    actions: at => [{ do: 'section', hero: true, title: 'Name  ｜  Role', subtitle: 'One line about who they are and where they work.', colour: 'gray', cols: 3, place: { at }, items: [
      { kind: 'panel', colour: 'blue', title: 'Goals', items: ['What they want to achieve', 'What success looks like'] },
      { kind: 'panel', colour: 'red', title: 'Frustrations', items: ['What slows them down', 'What they work around'] },
      { kind: 'panel', colour: 'green', title: 'A typical day', items: ['Morning', 'Afternoon', 'Evening'] },
      { kind: 'panel', colour: 'violet', title: 'Tools', items: [{ title: 'Tool', text: 'What they use it for' }, { title: 'Tool', text: 'What they use it for' }] },
      { kind: 'panel', colour: 'orange', title: 'What would help', items: ['An idea', 'Another idea'] },
      { kind: 'quote', text: '“A line in their own words.”', who: 'Interview 1' } ] }] },
  { id: 'empathy', name: 'Empathy map', cat: 'Research', preview: quad(['blue', 'violet', 'green', 'orange'], false),
    actions: at => [{ do: 'matrix', title: 'Empathy map', subtitle: 'What the person says, thinks, does and feels', place: { at }, cells: [
      { title: 'Says', subtitle: 'Their words', colour: 'blue', items: ['Quote', 'Quote'] }, { title: 'Thinks', subtitle: 'What they keep to themselves', colour: 'violet', items: ['Thought', 'Thought'] },
      { title: 'Does', subtitle: 'What we saw', colour: 'green', items: ['Action', 'Action'] }, { title: 'Feels', subtitle: 'Worries and hopes', colour: 'orange', items: ['Feeling', 'Feeling'] } ] }] },
  { id: 'literature', name: 'Literature map', cat: 'Research', preview: columns(['blue', 'yellow', 'violet'], 'card'),
    actions: at => [{ do: 'section', title: 'Literature map', subtitle: 'Sources grouped by the question they answer', colour: 'white', layout: 'column', place: { at }, items: [
      { kind: 'summary', title: 'Reading', text: 'One or two sentences on how these groups support the project.' },
      ...(['Foundations', 'Methods', 'Systems'] as const).map((t, i) => ({ kind: 'section', title: t, subtitle: 'What this group shows', colour: (['blue', 'yellow', 'violet'] as Hue[])[i], cols: 3, items: [1, 2, 3].map(n => ({ kind: 'card', meta: 'Venue · Year · Authors', title: `Paper ${n}`, body: 'Why it matters here.' })) })) ] }] },
  // Workshop
  { id: 'brainstorm', name: 'Brainstorm', cat: 'Workshop', preview: columns(['yellow', 'blue', 'red'], 'sticky', 3),
    actions: at => [{ do: 'section', title: 'How might we …?', subtitle: 'Ideas in yellow, questions in blue, worries in red', colour: 'white', cols: 3, place: { at }, items: [
      { kind: 'section', title: 'Ideas', colour: 'yellow', cols: 2, items: [st('Idea'), st('Idea'), st('Idea'), st('Idea')] },
      { kind: 'section', title: 'Questions', colour: 'blue', cols: 2, items: [st('Question', 'blue'), st('Question', 'blue')] },
      { kind: 'section', title: 'Worries', colour: 'red', cols: 2, items: [st('Worry', 'red'), st('Worry', 'red')] } ] }] },
  { id: 'crazy8', name: 'Crazy 8s', cat: 'Workshop', preview: (() => { let b = sheet(16, 12, W - 32, H - 24) + bar(26, 22, 60, true); for (let i = 0; i < 8; i++) b += rect(26 + (i % 4) * 58, 36 + Math.floor(i / 4) * 56, 52, 50, 'none', 4, '#c7c7cc', true) + bar(31 + (i % 4) * 58, 41 + Math.floor(i / 4) * 56, 10, true, 2.6); return svg(b); })(),
    actions: at => [{ do: 'section', title: 'Crazy 8s', subtitle: 'Eight sketches in eight minutes', colour: 'white', cols: 4, place: { at }, items: [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ kind: 'panel', style: 'dashed', title: String(n), body: 'Sketch here', width: 240 })) }] },
  { id: 'retro', name: 'Retrospective', cat: 'Workshop', preview: columns(['green', 'orange', 'blue'], 'dash'),
    actions: at => [{ do: 'section', title: 'Retrospective', subtitle: 'Sprint · date', colour: 'white', cols: 3, place: { at }, items: [
      dashedCol('Went well', ['Note', 'Note'], 'green'), dashedCol('To improve', ['Note', 'Note'], 'orange'), dashedCol('Actions', ['Owner · action', 'Owner · action'], 'blue')] }] },
  // Strategy
  { id: 'priority', name: 'Impact / effort', cat: 'Strategy', preview: quad(['green', 'blue', 'yellow', 'gray']),
    actions: at => [{ do: 'matrix', title: 'Impact / effort', place: { at }, x: ['Low effort', 'High effort'], y: ['Low impact', 'High impact'], cells: [
      { title: 'Quick wins', subtitle: 'High impact · low effort', colour: 'green', items: [{ title: 'Item', text: 'Why it fits' }] },
      { title: 'Big bets', subtitle: 'High impact · high effort', colour: 'blue', items: [{ title: 'Item', text: 'Why it fits' }] },
      { title: 'Fill-ins', subtitle: 'Low impact · low effort', colour: 'yellow', items: [{ title: 'Item', text: 'Why it fits' }] },
      { title: 'Not now', subtitle: 'Low impact · high effort', colour: 'gray', items: [{ title: 'Item', text: 'Why it fits' }] } ] }] },
  { id: 'swot', name: 'SWOT', cat: 'Strategy', preview: quad(['green', 'red', 'blue', 'orange'], false),
    actions: at => [{ do: 'matrix', title: 'SWOT', subtitle: 'Inside the team on top, outside below', place: { at }, cells: [
      { title: 'Strengths', colour: 'green', items: ['Strength', 'Strength'] }, { title: 'Weaknesses', colour: 'red', items: ['Weakness', 'Weakness'] },
      { title: 'Opportunities', colour: 'blue', items: ['Opportunity', 'Opportunity'] }, { title: 'Threats', colour: 'orange', items: ['Threat', 'Threat'] } ] }] },
  { id: 'compare', name: 'Comparison', cat: 'Strategy', preview: columns(['gray', 'gray', 'gray'], 'card', 3),
    actions: at => [{ do: 'section', title: 'Comparison', subtitle: 'One card per option, the same points on each', colour: 'gray', cols: 3, place: { at }, items: ['Option A', 'Option B', 'Option C'].map(t => ({ kind: 'panel', style: 'outline', colour: 'gray', title: t, items: [{ title: 'Strength', text: 'One line' }, { title: 'Cost', text: 'One line' }, { title: 'Risk', text: 'One line' }] })) }] },
  // Planning
  { id: 'journey', name: 'User journey', cat: 'Planning', preview: (() => { let b = sheet(12, 12, W - 24, H - 24) + bar(22, 22, 70, true); const hs: Hue[] = ['blue', 'teal', 'green', 'yellow', 'orange']; hs.forEach((h, i) => { const x = 22 + i * 47; b += tintBox(x, 36, 43, 110, h); b += bar(x + 5, 42, 22, true, 3); for (let r = 0; r < 3; r++) b += bar(x + 5, 56 + r * 26, 30) + bar(x + 5, 61 + r * 26, 22); }); return svg(b); })(),
    actions: at => [{ do: 'section', title: 'User journey', subtitle: 'Stages left to right; what they do, think and feel in each', colour: 'white', cols: 5, place: { at }, items: (['Discover', 'Sign up', 'First use', 'Invite', 'Return'] as const).map((t, i) => ({ kind: 'panel', colour: (['blue', 'teal', 'green', 'yellow', 'orange'] as Hue[])[i], title: t, width: 240, items: [{ title: 'Doing', text: '…' }, { title: 'Thinking', text: '…' }, { title: 'Feeling', text: '…' }, { title: 'Opportunity', text: '…' }] })) }] },
  { id: 'kanban', name: 'Kanban', cat: 'Planning', preview: columns(['gray', 'blue', 'green'], 'card'),
    actions: at => [{ do: 'section', title: 'Kanban', colour: 'white', cols: 3, place: { at }, items: [
      { kind: 'section', title: 'To do', colour: 'gray', layout: 'column', items: [{ kind: 'card', meta: 'Owner', title: 'Task', body: 'One line' }, { kind: 'card', meta: 'Owner', title: 'Task', body: 'One line' }] },
      { kind: 'section', title: 'Doing', colour: 'blue', layout: 'column', items: [{ kind: 'card', meta: 'Owner', title: 'Task', body: 'One line' }] },
      { kind: 'section', title: 'Done', colour: 'green', layout: 'column', items: [{ kind: 'card', meta: 'Owner', title: 'Task', body: 'One line' }] } ] }] },
  { id: 'roadmap', name: 'Now / next / later', cat: 'Planning', preview: columns(['green', 'blue', 'violet'], 'card'),
    actions: at => [{ do: 'section', title: 'Roadmap', subtitle: 'Now · Next · Later', colour: 'white', cols: 3, place: { at }, items: (['Now', 'Next', 'Later'] as const).map((t, i) => ({ kind: 'section', title: t, colour: (['green', 'blue', 'violet'] as Hue[])[i], layout: 'column', items: [{ kind: 'card', meta: 'Theme', title: 'Initiative', body: 'Outcome it should change', tags: ['Team'] }, { kind: 'card', meta: 'Theme', title: 'Initiative', body: 'Outcome it should change' }] })) }] },
  // Diagrams
  { id: 'flow', name: 'Flowchart', cat: 'Diagrams', preview: flow([{ x: 22, y: 74, w: 36, h: 18, hue: 'green', r: 9 }, { x: 74, y: 72, w: 44, h: 22, hue: 'gray' }, { x: 134, y: 64, w: 38, h: 38, hue: 'yellow', diamond: true }, { x: 190, y: 44, w: 44, h: 22, hue: 'gray' }, { x: 190, y: 100, w: 44, h: 22, hue: 'red', r: 9 }], [[0, 1], [1, 2], [2, 3], [3, 4]]),
    actions: at => [{ do: 'diagram', title: 'Flowchart', place: { at }, nodes: [{ id: 'a', label: 'Start', role: 'start' }, { id: 'b', label: 'Step', role: 'step' }, { id: 'c', label: 'Decision?', role: 'decision' }, { id: 'd', label: 'Step', role: 'step' }, { id: 'e', label: 'End', role: 'end' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: 'yes' }, { from: 'c', to: 'b', label: 'no', dashed: true }, { from: 'd', to: 'e' }] }] },
  { id: 'system', name: 'System map', cat: 'Diagrams', preview: flow([{ x: 24, y: 70, w: 40, h: 24, hue: 'green', r: 12 }, { x: 88, y: 50, w: 44, h: 24, hue: 'violet' }, { x: 88, y: 94, w: 44, h: 24, hue: 'violet' }, { x: 160, y: 70, w: 44, h: 26, hue: 'blue', r: 10 }, { x: 222, y: 70, w: 36, h: 24, hue: 'gray' }], [[0, 1], [0, 2], [1, 3], [2, 3, true], [3, 4, true]], [{ x: 80, y: 40, w: 60, h: 88, hue: 'violet' }]),
    actions: at => [{ do: 'diagram', title: 'System map', key: 'Solid lines are requests; dashed lines run in the background.', place: { at }, zones: [{ id: 's', title: 'Services', colour: 'violet' }],
      nodes: [{ id: 'u', label: 'App', role: 'client' }, { id: 'a', label: 'Service A', role: 'service', zone: 's' }, { id: 'b', label: 'Service B', role: 'service', zone: 's' }, { id: 'db', label: 'Database', role: 'database' }, { id: 'x', label: 'External API', role: 'external' }],
      edges: [{ from: 'u', to: 'a', label: 'request' }, { from: 'u', to: 'b', label: 'request' }, { from: 'a', to: 'db', label: 'reads' }, { from: 'b', to: 'db', label: 'writes', dashed: true }, { from: 'db', to: 'x', label: 'syncs', dashed: true }] }] },
];

export const TEMPLATE_CATEGORIES = [...new Set(TEMPLATES.map(t => t.cat))];

/** Entries for AFFiNE's template panel. The panel only shows them; inserting goes through `insertTemplate`. */
export const panelEntries = (cat?: string) => TEMPLATES.filter(t => !cat || t.cat === cat).map(t => ({ name: t.name, preview: t.preview, type: 'template', cxTemplate: t.id, content: null }));

export async function insertTemplate(rootEl: any, id: string, center: { x: number; y: number }) {
  const t = TEMPLATES.find(x => x.id === id); if (!t) return;
  const gfx = rootEl.gfx, store = rootEl.std.store;
  store.captureSync();
  const res = await execute(rootEl, readBoard(gfx), { actions: t.actions([Math.round(center.x - 480), Math.round(center.y - 300)]) });
  store.captureSync();
  if (res.box) try { gfx.viewport.setViewportByBound(res.box, [60, 60, 140, 60], true); } catch { /* keep view */ }
}
