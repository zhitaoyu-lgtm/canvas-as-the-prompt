// Demo boards for checking the look of everything at once (hidden shortcuts, not part of the UI):
//   Alt+Shift+S  style sheet: every component the AI can make, on the shared design system
//   Alt+Shift+B  a brainstorm: a hand-made board, then the AI organises it in place
// Both run through the same code paths as a real answer (reading → execute).

import * as Y from 'yjs';
import { FILL, HUES, stickyProps } from '../design';
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

export function mountDemos(rootEl: any) {
  addEventListener('keydown', e => {
    if (!(e.altKey && e.shiftKey)) return;
    if (e.code === 'KeyS') { e.preventDefault(); void styleSheet(rootEl); }
    if (e.code === 'KeyB') { e.preventDefault(); void brainstorm(rootEl); }
  });
  (window as any).cxDemo = { styleSheet: () => styleSheet(rootEl), brainstorm: () => brainstorm(rootEl) };
}
