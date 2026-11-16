// Demo boards for checking the look of everything at once (hidden shortcuts, not part of the UI):
//   Alt+Shift+S  style sheet: every component the AI can make, on the shared design system
//   Alt+Shift+B  a brainstorm: a hand-made board, then the AI organises it in place
// Both run through the same code paths as a real answer (reading → execute).

import * as Y from 'yjs';
import { Text } from '@blocksuite/affine/store';
import { CARD_STYLE, FILL, HUES, stickyProps } from '../design';
import { execute, type Answer } from './actions';
import { readBoard } from './reading';

const free = (gfx: any) => { const b = gfx.elementsBound; return b && b.w ? { x: b.x, y: b.y + b.h + 240 } : { x: 0, y: 0 }; };
const fit = (gfx: any) => { try { gfx.viewport.setViewportByBound(gfx.elementsBound, [80, 80, 160, 80], true); } catch { /* keep view */ } };

export async function styleSheet(rootEl: any) {
  const gfx = rootEl.gfx;
  const at = free(gfx);
  const hue = (h: string) => h[0].toUpperCase() + h.slice(1);
  const answer: Answer = { actions: [
    { do: 'section', title: 'Canvas style sheet', subtitle: 'Everything the AI makes, drawn from one design system: one hue set, one type scale, one radius, one shadow, an 8px grid.', colour: 'white', layout: 'column', place: { at: [at.x, at.y] }, items: [
      { kind: 'section', title: 'Stickies · one hue set', colour: 'gray', layout: 'row', items: HUES.map(h => ({ kind: 'sticky', text: hue(h), colour: h })) },
      { kind: 'section', title: 'Section tints · same hues, mostly white', colour: 'gray', layout: 'row', items: HUES.filter(h => h !== 'white').map(h => ({ kind: 'section', title: hue(h), colour: h, items: [{ kind: 'text', text: 'tint', size: 'small', muted: true }] })) },
      { kind: 'section', title: 'Type scale', colour: 'gray', layout: 'column', items: [
        { kind: 'text', text: 'Heading 28 · Why it feels slow', px: 28 },
        { kind: 'text', text: 'Title 20 · Cold start downloads everything', px: 20 },
        { kind: 'text', text: 'Body 16 · Most of the slowness is felt, not measured.', px: 16 },
        { kind: 'text', text: 'Small 14 · Three causes behind the pain points', px: 14, muted: true },
        { kind: 'text', text: 'Caption 12 · CHI 2006 · Hornecker, Buur', px: 12, muted: true } ] },
      { kind: 'section', title: 'Cards', colour: 'blue', cols: 3, items: [
        { kind: 'summary', text: 'Summary card: one or two sentences with the takeaway, full width, first in a section.' },
        { kind: 'card', meta: 'Cause 1 · First load', title: 'Cold start downloads everything', body: '- 4.2 MB before first paint\n- No skeleton while loading', tags: ['Performance', 'P1'] },
        { kind: 'quote', text: 'Just read the board the way my team reads it.', who: 'P07 · Product designer' },
        { kind: 'persona', name: 'Lin', role: 'PM · 32 · mobile first', body: '- Plans sprints on a whiteboard\n- Hates retyping the board for AI', tags: ['Planner'] },
        { kind: 'metric', label: 'Weekly active teams', value: '412', delta: '+18% vs May', note: 'Most growth from design teams' },
        { kind: 'checklist', title: 'Next steps', items: ['Ship offline queue', 'Add progress state on save', 'Re-test with 5 PMs'] },
        { kind: 'link', title: 'Getting a Grip on Tangible Interaction', url: 'https://dl.acm.org/doi/10.1145/1124772.1124838', meta: 'CHI 2006 · Hornecker, Buur', note: 'Framework moving from manipulation to social interaction.' },
        { kind: 'card', meta: 'Option B', title: 'Offline-first sync', body: 'Queue writes locally and sync in the background; show a quiet status.', tags: ['Reliability'] },
        { kind: 'card', meta: 'Open question', title: 'Who owns templates?', body: 'Design ops or each team? Decide before the pilot.' } ] },
    ] },
  ] };
  const r1 = await execute(rootEl, readBoard(gfx), answer);
  // marks and charts beside the sheet, on a fresh reading so refs exist
  const b = gfx.elementsBound;
  const s = gfx.surface;
  const ids = ['Idea', 'Question', 'Risk'].map((t, i) => s.addElement({ type: 'shape', ...stickyProps([FILL.yellow, FILL.blue, FILL.red][i], b.x + b.w + 160 + i * 224, at.y), text: (() => { const y = new Y.Text(); y.insert(0, t); return y; })() }));
  const rd = readBoard(gfx);
  const ref = (id: string) => rd.byId.get(id)?.ref ?? '';
  await execute(rootEl, rd, { actions: [
    { do: 'tag', refs: [ref(ids[0])], text: 'Performance', colour: 'blue' }, { do: 'tag', refs: [ref(ids[0])], text: 'P1', colour: 'orange' },
    { do: 'tag', refs: [ref(ids[1])], text: 'Research' }, { do: 'vote', refs: [ref(ids[0]), ref(ids[0]), ref(ids[2])] },
    { do: 'number', refs: [ref(ids[0]), ref(ids[1]), ref(ids[2])] }, { do: 'circle', refs: [ref(ids[2])], colour: 'orange' },
    { do: 'legend', entries: [{ colour: 'yellow', label: 'Idea' }, { colour: 'blue', label: 'Question' }, { colour: 'red', label: 'Risk' }], place: { at: [b.x + b.w + 160, at.y + 300] } },
    { do: 'funnel', title: 'Activation', stages: [{ label: 'Visit', value: 1200 }, { label: 'Sign up', value: 420 }, { label: 'First board', value: 260 }, { label: 'Invite', value: 90 }], place: { at: [b.x + b.w + 160, at.y + 420] } },
    { do: 'bars', title: 'Confidence', items: [{ label: 'Trust', value: 2 }, { label: 'Speed', value: 4 }, { label: 'Control', value: 3 }], place: { at: [b.x + b.w + 160, at.y + 760] } },
  ] });
  fit(gfx);
  return r1;
}

export async function brainstorm(rootEl: any) {
  const gfx = rootEl.gfx, s = gfx.surface;
  const at = free(gfx);
  const yt = (t: string) => { const y = new Y.Text(); y.insert(0, t); return y; };
  // the hand-made board: a question, ideas in three colours dropped loosely, a few votes
  s.addElement({ type: 'text', xywh: `[${at.x},${at.y},900,40]`, text: yt('How might we make the first five minutes feel effortless?'), fontSize: 28, fontWeight: '700', color: '#1e1e1e' });
  const ideas: [string, keyof typeof FILL][] = [
    ['Skip sign-up, ask later', 'yellow'], ['Start from a sample board', 'yellow'], ['Import from FigJam', 'yellow'],
    ['What do people do first?', 'blue'], ['AI reads the board on open', 'yellow'], ['Show progress while loading', 'yellow'],
    ['Do teams invite before trying?', 'blue'], ['Templates feel generic', 'red'], ['Too many tools on screen', 'red'],
    ['One-click invite link', 'yellow'], ['Offline first run', 'yellow'], ['Privacy worries on import', 'red'],
  ];
  const ids = ideas.map(([t, c], i) => s.addElement({ type: 'shape', ...stickyProps(FILL[c], at.x + (i % 4) * 210 + ((i * 37) % 23), at.y + 80 + Math.floor(i / 4) * 210 + ((i * 53) % 31)), text: yt(t) }));
  await new Promise(r => setTimeout(r, 50));
  const rd = readBoard(gfx);
  const ref = (i: number) => rd.byId.get(ids[i])?.ref ?? '';
  // what the AI does with it (a fixed answer for the visual check; the live app asks Claude)
  await execute(rootEl, rd, { read: 'Brainstorm: yellow ideas, blue questions, red worries.', say: 'Grouped into themes, picked three to try first.', actions: [
    { do: 'cluster', name: 'themes', title: 'Themes', subtitle: 'Your 12 notes, grouped. Nothing rewritten.', groups: [
      { title: 'Get in fast', refs: [ref(0), ref(1), ref(9)] },
      { title: 'Feel progress', refs: [ref(4), ref(5), ref(10)] },
      { title: 'Bring your work', refs: [ref(2), ref(11)] },
      { title: 'Open questions', refs: [ref(3), ref(6)], colour: 'blue' },
      { title: 'Friction', refs: [ref(7), ref(8)], colour: 'red' } ] },
    { do: 'vote', refs: [ref(0), ref(0), ref(0), ref(4), ref(4), ref(1)] },
    { do: 'tag', refs: [ref(0)], text: 'Quick win', colour: 'green' }, { do: 'tag', refs: [ref(4)], text: 'Differentiator', colour: 'violet' },
    { do: 'tag', refs: [ref(11)], text: 'Risk', colour: 'red' },
    { do: 'number', refs: [ref(0), ref(4), ref(1)] },
    { do: 'section', title: 'Try first', subtitle: 'Three bets ranked by votes and effort', colour: 'white', place: { right: 'themes' }, items: [
      { kind: 'summary', text: 'Let people start before they commit: no sign-up wall, a sample board, and an AI that already understands what they put down.' },
      { kind: 'card', meta: '1 · Get in fast', title: 'Skip sign-up, ask later', body: '- Account only when sharing\n- Keep the board locally until then', tags: ['Quick win'] },
      { kind: 'card', meta: '2 · Feel progress', title: 'AI reads the board on open', body: '- Show its reading as a quiet overlay\n- First answer within 10 s', tags: ['Differentiator'] },
      { kind: 'card', meta: '3 · Get in fast', title: 'Start from a sample board', body: '- One board per use case\n- Delete in one click', tags: ['Onboarding'] },
      { kind: 'checklist', title: 'Next steps', items: ['Prototype the no-sign-up path', 'Test the reading overlay with 5 people', 'Pick two sample boards'] } ] },
  ] });
  fit(gfx);
}

// Templates drawn from FigJam's own replies: a persona board (hero title, tinted panels), a system
// diagram (roles as shapes, zones, labelled thin lines) and a 2×2 matrix. Fixed answers, for the visual check.
export async function templates(rootEl: any) {
  const gfx = rootEl.gfx;
  const at = free(gfx);
  const rd = readBoard(gfx);
  await execute(rootEl, rd, { read: '', say: '', actions: [
    { do: 'section', name: 'persona', hero: true, title: 'Maya Chen  ｜  Product designer', subtitle: 'Leads a three-person design team at a 40-person startup. Lives in FigJam and Figma all day.', colour: 'gray', cols: 3, place: { at: [at.x, at.y] }, items: [
      { kind: 'panel', colour: 'blue', title: 'Goals', items: ['Ship research-backed ideas faster', 'Keep the team aligned without meetings', 'Show impact to leadership'] },
      { kind: 'panel', colour: 'red', title: 'Frustrations', items: ['Boards get messy after one workshop', 'Synthesis takes a whole afternoon', 'AI tools answer in a chat, far from the work'] },
      { kind: 'panel', colour: 'green', title: 'A typical day', items: ['Standup on a shared board', 'Two hours of deep design', 'Critique and async review'] },
      { kind: 'panel', colour: 'violet', title: 'Tools', subtitle: 'Daily', items: [{ title: 'FigJam', text: 'Workshops, research walls, retros' }, { title: 'Figma', text: 'Screens and the design system' }] },
      { kind: 'panel', colour: 'orange', title: 'What would help', items: ['An assistant that tidies a board in place', 'Templates that match the team’s style'] },
      { kind: 'quote', text: '“I don’t want another chat window. I want the board to finish my thought.”', by: 'Maya, interview 3' },
    ] },
    { do: 'diagram', name: 'arch', title: 'How the canvas answers', place: { below: 'persona' }, key: 'Solid lines are requests; dashed lines run in the background.',
      zones: [{ id: 'c', title: 'On the device', colour: 'green' }, { id: 's', title: 'Cloud', colour: 'violet' }],
      nodes: [
        { id: 'u', label: 'Designer', role: 'actor' },
        { id: 'board', label: 'Board', role: 'client', zone: 'c' },
        { id: 'read', label: 'Reading layer', role: 'service', zone: 'c' },
        { id: 'model', label: 'Claude', role: 'external', zone: 's' },
        { id: 'act', label: 'Action executor', role: 'service' },
        { id: 'store', label: 'Board store', role: 'database' },
        { id: 'web', label: 'Web search', role: 'external', zone: 's' } ],
      edges: [
        { from: 'u', to: 'board', label: 'asks' },
        { from: 'board', to: 'read', label: 'selection' },
        { from: 'read', to: 'model', label: 'grammar + picture' },
        { from: 'model', to: 'web', label: 'look up', dashed: true },
        { from: 'model', to: 'act', label: 'actions' },
        { from: 'act', to: 'store', label: 'writes', dashed: true } ] },
    { do: 'matrix', title: 'Where AI help lands', hero: false, place: { right: 'persona' }, x: ['Low effort', 'High effort'], y: ['Low value', 'High value'], cells: [
      { title: 'Do now', subtitle: 'High value · low effort', items: [{ title: 'Tidy in place', text: 'Align, group and tag what is there' }, { title: 'Summaries', text: 'One card beside a cluster' }] },
      { title: 'Plan', subtitle: 'High value · high effort', items: [{ title: 'Diagrams', text: 'Draw a system from notes' }, { title: 'Research walls', text: 'Cluster 100 quotes' }] },
      { title: 'Maybe', subtitle: 'Low value · low effort', items: [{ title: 'Stickers', text: 'Reactions on notes' }] },
      { title: 'Skip', subtitle: 'Low value · high effort', items: [{ title: 'Full redesign', text: 'Rebuilding a board from scratch' }] } ] },
  ] });
  fit(gfx);
}

// A research pile for trying spatial sorting: papers, links and the user's own notes, heaped loosely,
// with open space beside it for a section, an anchor sticky or a few marks.
export async function sortingBoard(rootEl: any) {
  const gfx = rootEl.gfx, s = gfx.surface, store = rootEl.std.store;
  const b = gfx.elementsBound; const ox = b && b.w ? b.x + b.w + 600 : 0, oy = b && b.w ? b.y : 0;
  const yt = (t: string) => { const y = new Y.Text(); y.insert(0, t); return y; };
  const gray = { color: 'var(--affine-text-secondary-color)' };
  const P = (t: string, a?: any) => new Text(a ? [{ insert: t, attributes: a }] as any : t);
  const card = (x: number, y: number, w: number, lines: [string, any?][]) => {
    const id = store.addBlock('affine:note', { xywh: `[${ox + x},${oy + y},${w},80]`, background: '#ffffff', edgeless: { style: CARD_STYLE } } as any, store.root.id);
    for (const [t, a] of lines) store.addBlock('affine:paragraph', { text: P(t, a) }, id);
  };
  const paper = (x: number, y: number, kind: string, title: string, by: string, sum: string) => card(x, y, 260, [[kind, gray], [title, { bold: true }], [by, gray], [sum]]);
  const link = (x: number, y: number, title: string, site: string) => card(x, y, 260, [[title, { bold: true }], [site, gray]]);
  const note = (x: number, y: number, c: keyof typeof FILL, t: string) => s.addElement({ type: 'shape', ...stickyProps(FILL[c], ox + x, oy + y, 160), text: yt(t) });
  s.addElement({ type: 'text', xywh: `[${ox},${oy - 80},700,40]`, text: yt('Research pile · AI on the canvas'), fontSize: 28, fontWeight: '700', color: '#1e1e1e' });
  // columns 300 apart; links are ~100 tall, papers ~240, stickies 160, with 32+ between
  note(0, 0, 'orange', 'Answer in my colours');
  note(0, 200, 'yellow', 'Leave my notes where I put them');
  note(0, 400, 'orange', 'Arrows are ignored as structure');
  note(0, 600, 'red', 'Clusters, but in its own colours');
  note(0, 800, 'orange', 'Show what the AI read before it acts');
  link(200, 0, 'ChatGPT Canvas edits a doc beside the chat', 'openai.com');
  paper(200, 140, 'PAPER · 1995', 'Spatial Hypertext', 'Marshall & Shipman · ACM Hypertext', 'Layout itself carries meaning; structure emerges from where things are placed.');
  paper(200, 420, 'PAPER · 1980', 'Put-That-There', 'Richard A. Bolt · SIGGRAPH', 'Voice plus pointing commands a wall-sized display: “this”, “there”.');
  link(200, 700, 'Stickies pasted as a prompt', 'forum thread');
  paper(200, 840, 'PDF · 1963', 'Sketchpad', 'Ivan E. Sutherland', 'Drawing with constraints the computer understands.');
  link(500, 0, 'Miro AI clusters by topic', 'miro.com');
  note(500, 140, 'red', 'Answers land in a side panel');
  link(500, 340, 'Figma Make: prompt → app', 'figma.com');
  link(500, 480, 'Gemini Live sees through the camera', 'video · google.com');
  note(500, 620, 'red', 'Reads the photo, not the board');
  link(500, 820, 'Notion AI rewrites in place', 'notion.so');
  link(500, 960, 'Screenshot Q&A', 'blog post');
  link(800, 0, 'Project Astra', 'video · deepmind.google');
  (window as any).cxSense?.rebase?.();   // the pile is the starting point, not something the user just did
  try { gfx.viewport.setViewportByBound({ x: ox - 80, y: oy - 140, w: 2000, h: 1240 }, [40, 40, 120, 40], true); } catch { /* keep view */ }
}

export function mountDemos(rootEl: any) {
  addEventListener('keydown', e => {
    if (!(e.altKey && e.shiftKey)) return;
    if (e.code === 'KeyS') { e.preventDefault(); void styleSheet(rootEl); }
    if (e.code === 'KeyF') { e.preventDefault(); void templates(rootEl); }
    if (e.code === 'KeyP') { e.preventDefault(); void sortingBoard(rootEl); }
    if (e.code === 'KeyB') { e.preventDefault(); void brainstorm(rootEl); }
  });
  (window as any).cxDemo = { styleSheet: () => styleSheet(rootEl), brainstorm: () => brainstorm(rootEl), templates: () => templates(rootEl), sorting: () => sortingBoard(rootEl) };
  // first run of this build: put the research pile beside whatever is on the board, once per browser
  try { if (!localStorage.getItem('cx:seed-sorting-1')) { localStorage.setItem('cx:seed-sorting-1', '1'); setTimeout(() => void sortingBoard(rootEl), 800); } } catch { /* storage blocked */ }
}
