// The general path: any settled spatial form → the model decides its function → an answer in the user's
// own spatial language. Runs beside the fast gestures in sense.ts and shares their watch loop.
//
//   forms.ts     what was drawn, and what surrounds it (geometry only)
//   gate         whether it is worth asking at all (cheap rules, never meaning)
//   prompt-v5    one call: functions with cues → strength → grammar → answer
//   validate.ts  invariants in code
//   render.ts    the answer in the board's own visual language, pending until ✓
//   keys.ts      what a kept (or dismissed) answer teaches, with its scope

import { ask, parseAnswer, online } from './model';
import { readBoard, toPrompt, type Box, type Reading } from './reading';
import { detectForms, serialiseForms, serialiseQuestions, isBlank, type Form } from './forms';
import { addKey, dismissedRecently, serialiseKeys } from './keys';
import { SYSTEM_V5 } from './prompt-v5';
import { coerce, validate, type V5 } from './validate';
import { renderAnswer, type PendingSet } from './render';
import { needsPicture, snapshot as shot } from './snapshot';
import type { Trace } from './trace';

export type GeneralIntent = { type: 'general'; key: string; forms: Form[]; area: Box; request?: string; reading?: Reading };

const union = (bs: Box[]): Box => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

export function mountIntent(rootEl: any, trace: Trace) {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const dev: any = (window as any).cxIntent = { debug: false, log: [] as any[], enabled: true, last: null as any };
  dev.trace = trace;
  dev.refOf = (id: string) => readBoard(gfx).byId.get(id)?.ref;
  dev.forget = () => { trace.acts = []; trace.poll(); trace.acts = []; };
  const say = (...a: any[]) => { if (dev.debug) console.log('[intent]', ...a); };

  /** The gate: forms the user just settled, if any is worth a call. */
  function detect(r: Reading, touchedNow: Set<string>): GeneralIntent | null {
    if (!dev.enabled) return null;
    const recent = trace.touchedBy(30_000); for (const id of touchedNow) recent.add(id);
    let forms = detectForms(gfx, r, recent, trace);
    const now = (f: Form) => [f.hub, ...f.targets, ...f.lines].some(ref => { const it = ref ? r.byRef.get(ref) : undefined; return !!it && touchedNow.has(it.id); });
    forms = forms.filter(f => {
      if (!now(f)) return false;
      if (f.facts.authorAll === 'ai') return false;
      if (f.lines.length && f.lines.every(l => r.byRef.get(l)?.author === 'ai')) return false;
      // a label pointed at a picture is the fast path's (point)
      if (f.kind === 'link') {
        const a = f.hub ? r.byRef.get(f.hub) : undefined, b = r.byRef.get(f.targets[0]);
        if ([a, b].some(x => x?.kind === 'image') && [a, b].some(x => x && x.kind !== 'image' && x.text.trim().length <= 60)) return false;
        // the user named the line and both ends have words: they already said it
        if (f.facts.labels.some(l => l.by === 'user') && f.facts.targetState === 'existing') return false;
        if ([a, b].some(x => x?.kind === 'frame' || x?.kind === 'group')) return false;
      }
      if (dismissedRecently(store, f.signature)) { say('backing off', f.signature); return false; }
      return true;
    });
    if (!forms.length) return null;
    const blankNow = forms.some(f => f.facts.targetState === 'blank' || f.facts.targetState === 'mixed' || f.kind === 'slot');
    if (trace.phase() === 'collecting' && !blankNow) { say('collecting, quiet'); return null; }
    const ids = forms.flatMap(f => [f.hub, ...f.targets, ...f.lines]).filter(Boolean).sort().join(',');
    const key = `general:${forms.map(f => f.signature).join('|')}:${ids}:${forms.map(f => f.facts.targetState).join(',')}`;
    return { type: 'general', key, forms, area: union(forms.map(f => f.box)), reading: r };
  }

  function message(r: Reading, forms: Form[], request?: string): string {
    const L: string[] = [];
    L.push('TASK: unknown');
    L.push('BOARD', toPrompt(r));
    L.push('', 'FORMS (detected by code; meaning not decided)', ...serialiseForms(forms, r));
    const qs = serialiseQuestions(r); L.push('', 'QUESTIONS', ...(qs.length ? qs : ['none']));
    const ks = serialiseKeys(store, r); L.push('', 'KEYS', ...(ks.length ? ks : ['none']));
    const acts = trace.serialise(r); L.push('', 'ACT', ...(acts.length ? acts : ['none']));
    L.push('', `PHASE: ${trace.phase()}`, `SELECTED: ${r.selection.length ? r.selection.join(' ') : 'no'}`, `REQUEST: ${request ?? 'none'}`);
    return L.join('\n');
  }

  async function call(user: string, picture: Blob | null, signal: AbortSignal): Promise<any> {
    const mock = (window as any).cxMockIntent;
    if (mock) return typeof mock === 'function' ? await mock(user) : mock;
    const raw = await ask(SYSTEM_V5 + (online() ? '\nYou may search the web only when the function needs literature; at most 3 searches.' : ''), user, picture, signal);
    try { return parseAnswer(raw); }
    catch {
      const again = await ask(SYSTEM_V5, user + '\n\nReturn only the JSON object.', null, signal);
      return parseAnswer(again);
    }
  }

  /** Ask, check, draw. Resolves with the pending set (or null if nothing was offered). */
  async function run(intent: GeneralIntent, done: () => void): Promise<PendingSet | null> {
    const t0 = Date.now();
    // refs belong to the reading the forms were found on
    const r = intent.reading ?? readBoard(gfx);
    const forms = intent.forms;
    const user = message(r, forms, intent.request);
    const refs = forms.flatMap(f => [f.hub, ...f.targets].filter(Boolean) as string[]);
    let picture: Blob | null = null;
    if (needsPicture(r, refs)) { try { picture = await shot(rootEl, union(forms.map(f => f.box)), 1024, 32); } catch { picture = null; } }
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25_000);
    let raw: any;
    try { raw = await call(user, picture, ctl.signal); } finally { clearTimeout(timer); }
    const a0 = coerce(raw);
    const entry: any = { at: new Date().toLocaleTimeString(), forms: serialiseForms(forms, r), user, raw, ms: Date.now() - t0 };
    dev.log.unshift(entry); dev.log.length = Math.min(dev.log.length, 20); dev.last = entry;
    if (!a0) { entry.result = 'unusable answer'; return null; }
    const { answer, edits } = validate(a0, r, forms);
    entry.edits = edits; entry.answer = answer;
    say(answer.strength, answer.function, edits);
    if (answer.strength === 'silent' || (intent.request && answer.strength === 'ask')) { entry.result = 'silent'; return null; }
    const f0 = forms[0];
    const scope = (): any => f0.facts.container ? { kind: 'section', id: f0.facts.container.id, title: f0.facts.container.title } : { kind: 'region', box: { x: f0.box.x - f0.box.w / 2, y: f0.box.y - f0.box.h / 2, w: f0.box.w * 2, h: f0.box.h * 2 } };
    const sig = f0.signature;
    const set = renderAnswer(rootEl, r, forms, answer, {
      onKeep: (fn, other) => {
        if (fn) addKey(store, { scope: scope(), form: sig, means: fn, source: other ? 'chosen' : 'accepted' });
        if (other) addKey(store, { scope: scope(), form: sig, means: other, source: 'not-chosen' });
        trace.note('accept', [], fn);
      },
      onDrop: fn => { addKey(store, { scope: scope(), form: sig, means: fn || 'this reading', source: 'dismissed' }); trace.note('dismiss', [], fn); },
      onAsk: option => {
        addKey(store, { scope: scope(), form: sig, means: option, source: 'chosen' });
        (dev.followUp as ((i: GeneralIntent) => void) | undefined)?.({ ...intent, key: intent.key + ':ask', request: option });
      },
      done,
    });
    entry.result = answer.strength;
    return set;
  }

  // dev: the board as a replayable fixture, and the forms the gate would see right now
  dev.fixture = () => { const r = readBoard(gfx); const forms = detectForms(gfx, r, new Set((gfx.gfxElements as any[]).map(e => e.id)), trace); return { text: message(r, forms), forms }; };
  dev.forms = (ids?: string[]) => { const r = readBoard(gfx); return serialiseForms(detectForms(gfx, r, new Set(ids ?? (gfx.gfxElements as any[]).map(e => e.id)), trace), r).join('\n'); };
  dev.blank = (ref: string) => isBlank(readBoard(gfx).byRef.get(ref));
  return { detect, run, dev };
}

export type { V5 };
