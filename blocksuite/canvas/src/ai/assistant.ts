// Ask → read the board → Claude → place the answer as a proposal.

import { execute, type Answer } from './actions';
import { systemPrompt, userPrompt } from './grammar';
import { ask, online, parseAnswer, ModelError } from './model';
import { toast } from './proposals';
import { readBoard, toPrompt, type Box } from './reading';
import { needsPicture, snapshot } from './snapshot';

export function createAssistant(rootEl: any) {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const log: any[] = [];
  (window as any).cxLog = log;    // last exchanges, for the developer view

  return async function onSubmit(request: string, ids: string[]) {
    const reading = readBoard(gfx, { selection: ids });
    const text = toPrompt(reading);
    let picture: Blob | null = null;
    if (needsPicture(reading, reading.focus)) {
      const boxes = reading.focus.map(r => reading.byRef.get(r)!.box);
      picture = await snapshot(rootEl, unionBox(boxes));
    }
    const entry: any = { at: new Date().toISOString(), request, reading: text, picture: !!picture };
    log.unshift(entry); log.length = Math.min(log.length, 10);
    try {
      const mock = (window as any).cxMockAnswer;   // tests only: a fixed answer instead of the model
      const raw = mock ? (typeof mock === 'function' ? await mock(text, request) : mock) : await ask(systemPrompt(), userPrompt(text, request, !!picture, online()), picture);
      entry.raw = raw;
      const answer: Answer = typeof raw === 'string' ? parseAnswer(raw) : raw;
      store.captureSync();
      const result = await execute(rootEl, reading, answer);
      store.captureSync();
      entry.result = result;
      if (result.errors.length) console.warn('[ai] some parts did not apply:', result.errors);
      if (!result.created.length && !result.changed.length) { toast(answer.say || 'Nothing to change here.', anchor(ids)); return true; }
      return false;
    } catch (e: any) {
      entry.error = String(e?.message ?? e);
      const code = e instanceof ModelError ? e.code : '';
      toast(code === 'no_model' ? 'Connect Claude in settings to use Ask.'
        : code === 'not_granted' ? 'Claude was not allowed for this page.'
        : code === 'rate_limited' ? 'Claude is busy. Try again in a moment.'
        : code === 'bad_answer' || e instanceof SyntaxError ? 'Claude’s answer could not be placed. Try again.'
        : 'Couldn’t reach Claude.', anchor(ids));
      console.warn('[ai]', e);
      return true;
    }
  };

  function anchor(ids: string[]) {
    const els = ids.map(id => gfx.getElementById(id)).filter(Boolean) as any[];
    if (!els.length) return undefined;
    const b = unionBox(els.map(e => e.elementBound));
    const rr = rootEl.getBoundingClientRect();
    const [x, y] = gfx.viewport.toViewCoord(b.x + b.w / 2, b.y + b.h);
    return { x: rr.left + x, y: rr.top + y + 16 };
  }
}

function unionBox(bs: Box[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
