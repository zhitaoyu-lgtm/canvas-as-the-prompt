// The general path: any settled spatial form → the model decides its function → an answer in the user's
// own spatial language. Runs beside the fast gestures in sense.ts and shares their watch loop.
//
//   forms.ts     what was drawn, and what surrounds it (geometry only)
//   gate         whether it is worth asking at all (cheap rules, never meaning)
//   prompt-v5    one call: functions with cues → strength → grammar → answer
//   validate.ts  invariants in code
//   render.ts    the answer in the board's own visual language, pending until ✓
//   keys.ts      what a kept (or dismissed) answer teaches, with its scope

import { diag } from './diag';
import { ask, parseAnswer, online } from './model';
import { readBoard, toPrompt, type Box, type Reading } from './reading';
import { detectForms, serialiseForms, serialiseQuestions, isBlank, type Form } from './forms';
import { addKey, dismissedRecently, serialiseKeys } from './keys';
import { SYSTEM_V6 } from './prompt-v6';
import { coerce, validate, type V5 } from './validate';
import { renderAnswer, type PendingSet } from './render';
import { pictures, lookOf, related } from './look';
import type { Trace } from './trace';
import { Habits } from './habits';
import { findOpenings, findArranged, serialiseOpenings, featuresOf, situationOf, type Opening, type Arranged } from './openings';

export type GeneralIntent = { type: 'general'; key: string; forms: Form[]; openings: Opening[]; arranged?: Arranged[]; area: Box; request?: string; reading?: Reading };

const union = (bs: Box[]): Box => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

export function mountIntent(rootEl: any, trace: Trace) {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const dev: any = (window as any).cxIntent = { debug: false, log: [] as any[], enabled: true, last: null as any };
  dev.trace = trace;
  const habits = new Habits(gfx, store); dev.habits = habits;
  const idsOf = (r: Reading) => (f: Form) => [f.hub, ...f.targets, ...f.lines].map(ref => (ref ? r.byRef.get(ref)?.id : undefined)).filter(Boolean) as string[];
  dev.refOf = (id: string) => readBoard(gfx).byId.get(id)?.ref;
  dev.forget = () => { trace.acts = []; trace.poll(); trace.acts = []; };
  const say = (...a: any[]) => { if (dev.debug) console.log('[intent]', ...a); };

  let lastArranged = 0;
  /** The gate. It never asks what a structure means, only: did the user just leave something open?
   *  Forms are descriptions (they give openings their context); the openings decide whether to speak. */
  function detect(r: Reading, touchedNow: Set<string>): GeneralIntent | null {
    if (!dev.enabled) return null;
    const recent = trace.touchedBy(30_000); for (const id of touchedNow) recent.add(id);
    let forms = detectForms(gfx, r, recent, trace);
    const now = (f: Form) => [f.hub, ...f.targets, ...f.lines, ...(f.kind === 'slot' ? f.context ?? [] : []).filter(ref => r.byRef.get(ref)?.kind !== 'image')].some(ref => { const it = ref ? r.byRef.get(ref) : undefined; return !!it && touchedNow.has(it.id); });
    forms = forms.filter(f => {
      if (!now(f)) return false;
      if (f.facts.authorAll === 'ai') return false;
      if (f.lines.length && f.lines.every(l => r.byRef.get(l)?.author === 'ai')) return false;
      // a short label pointed at a picture, or a line to a section: other gestures own these for now
      if (f.kind === 'link') {
        const a = f.hub ? r.byRef.get(f.hub) : undefined, b = r.byRef.get(f.targets[0]);
        if ([a, b].some(x => x?.kind === 'image') && [a, b].some(x => x && x.kind !== 'image' && x.text.trim().length <= 60)) return false;
        if ([a, b].some(x => x?.kind === 'frame' || x?.kind === 'group')) return false;
      }
      return true;
    });
    // what is open, among what the user just touched
    let openings = findOpenings(r, forms, touchedNow).filter(o => o.touched);
    // nothing empty, every line labelled, every end has words: the user already said it
    openings = openings.filter(o => {
      if (o.kind !== 'relation') return true;
      const f = forms.find(x => x.id === o.form); if (!f) return true;
      if (f.facts.labels.some(l => l.by === 'user') && f.facts.targetState === 'existing') return false;
      // no line was just drawn: the user is only writing in their own notes
      return f.lines.some(l => { const it = r.byRef.get(l); return !!it && touchedNow.has(it.id); });
    });
    // … or what they just rearranged: a thing dragged in with others, several things lined up
    const arranged = findArranged(r, trace).filter(a => a.refs.some(ref => { const it = r.byRef.get(ref); return !!it && touchedNow.has(it.id); }));
    const spoke = arranged.filter(a => a.strong);
    if (!openings.length) {
      if (!spoke.length || (!dev.dry && Date.now() - lastArranged < 45_000) || trace.phase() === 'collecting') return null;
      const feats = ['arranged', ...(spoke.some(a => /row|column/.test(a.line)) ? ['arranged:line'] : ['arranged:joined'])];
      if (dismissedRecently(store, feats.join(' '))) return null;
      const refs = [...new Set(spoke.flatMap(a => a.refs))];
      return { type: 'general', key: `general:arranged:${refs.sort().join(',')}`, forms: [], openings: [], arranged, area: union(refs.map(ref => r.byRef.get(ref)!.box)), reading: r };
    }
    forms = forms.filter(f => openings.some(o => o.form === f.id));
    const features = featuresOf(openings, forms, r);
    if (!dev.dry && dismissedRecently(store, features.join(' '))) { say('backing off', features.join(' ')); return null; }
    // weak openings (nothing literally empty) wait while the user is still gathering material
    if (!openings.some(o => o.strong) && trace.phase() === 'collecting') { say('collecting, quiet'); return null; }
    const ids = openings.flatMap(o => o.refs).sort().join(',');
    const key = `general:${features.join(' ')}:${ids}:${openings.map(o => o.kind).join(',')}`;
    const boxes = [...forms.map(f => f.box), ...openings.flatMap(o => o.refs.map(ref => r.byRef.get(ref)?.box).filter(Boolean) as Box[])];
    return { type: 'general', key, forms, openings, arranged, area: union(boxes), reading: r };
  }

  function message(r: Reading, forms: Form[], openings: Opening[], request?: string, arranged: Arranged[] = [], area?: Box): string {
    const L: string[] = [];
    L.push('TASK: unknown');
    L.push('BOARD', toPrompt(r, { near: area }));
    L.push('', 'OPENINGS (what the user left open; address your answer to these)', ...(openings.length ? serialiseOpenings(openings, r) : ['none found by code']));
    L.push('', 'ARRANGED (what they just moved or recoloured, and what it now sits with)', ...(arranged.length ? arranged.map(a => '- ' + a.line) : ['nothing']));
    L.push('', 'STRUCTURE AROUND THEM (described by code; meaning not decided)', ...(forms.length ? serialiseForms(forms, r) : ['see BOARD']));
    const qs = serialiseQuestions(r); L.push('', 'QUESTIONS', ...(qs.length ? qs : ['none']));
    const ks = dev.dry ? [] : serialiseKeys(store, r); L.push('', 'KEYS', ...(ks.length ? ks : ['none']));
    const hs = dev.dry ? [] : habits.serialise(featuresOf(openings, forms, r)); L.push('', 'CASES (moments like this one, with this person, on any board)', ...(hs.length ? hs : ['none']));
    const acts = trace.serialise(r); L.push('', 'ACT', ...(acts.length ? acts : ['none']));
    L.push('', `PHASE: ${trace.phase()}`, `SELECTED: ${r.selection.length ? r.selection.join(' ') : 'no'}`, `REQUEST: ${request ?? 'none'}`);
    return L.join('\n');
  }

  let lastLook = '';
  async function call(user: string, picture: Blob[] | null, signal: AbortSignal): Promise<any> {
    const mock = (window as any).cxMockIntent;
    if (mock) return typeof mock === 'function' ? await mock(user) : mock;
    const raw = await ask(SYSTEM_V6 + (online() ? '\nYou may search the web only when the function needs literature; at most 3 searches.' : ''), user, picture, signal);
    lastLook = lookOf(raw);
    try { return parseAnswer(raw); }
    catch {
      const again = await ask(SYSTEM_V6, user + '\n\nReturn only the JSON object.', null, signal);
      return parseAnswer(again);
    }
  }

  /** Ask, check, draw. Resolves with the pending set (or null if nothing was offered). */
  async function run(intent: GeneralIntent, done: () => void): Promise<PendingSet | null> {
    const t0 = Date.now();
    // refs belong to the reading the forms were found on
    const r = intent.reading ?? readBoard(gfx);
    const forms = intent.forms, openings = intent.openings ?? [];
    if (!openings.length) lastArranged = Date.now();          // an arrangement was read: do not ask about every further nudge
    const features = openings.length ? featuresOf(openings, forms, r) : ['arranged', ...((intent.arranged ?? []).some(a => /row|column/.test(a.line)) ? ['arranged:line'] : ['arranged:joined'])];
    const user = message(r, forms, openings, intent.request, intent.arranged ?? [], intent.area);
    const refs = [...new Set([...forms.flatMap(f => [f.hub, ...f.targets, ...(f.context ?? [])]), ...openings.flatMap(o => [o.ref, o.about, o.like?.ref, ...o.refs])].filter(Boolean) as string[])];
    // always look as well as read: the area, and a close-up of any photo in it
    const rel = related(r, refs);
    const seen = await pictures(rootEl, r, union([intent.area, ...forms.map(f => f.box), ...rel.map(i => i.box)]), [...refs, ...rel.map(i => i.ref)]).catch(() => ({ blobs: [] as Blob[], note: '' }));
    const picture = seen.blobs.length ? seen.blobs : null;
    const userFull = user + (seen.note ? `\n\nPICTURES: ${seen.note} The text cannot say what a photo shows or what a sticker sits on: the pictures can.` : '');
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 50_000);   // a reading with pictures has taken up to 30 s
    let raw: any;
    try { raw = await call(userFull, picture, ctl.signal); } finally { clearTimeout(timer); }
    const a0 = coerce(raw);
    const entry: any = { at: new Date().toLocaleTimeString(), openings: serialiseOpenings(openings, r), arranged: (intent.arranged ?? []).map(a => a.line), features, forms: serialiseForms(forms, r), user: userFull, raw, look: lastLook, pictures: seen.blobs, ms: Date.now() - t0 };
    dev.log.unshift(entry); dev.log.length = Math.min(dev.log.length, 20); dev.last = entry;
    const idOf = (ref?: string) => (ref ? r.byRef.get(ref)?.id : undefined);
    const situation = openings.length ? situationOf(openings, r) : (intent.arranged ?? []).filter(a => a.strong).map(a => a.line).join('; ').slice(0, 180);
    if (!dev.dry) habits.open({ features, situation, ids: [...new Set([...forms.flatMap(idsOf(r)), ...openings.flatMap(o => o.refs.map(idOf))].filter(Boolean) as string[])], blanks: openings.map(o => idOf(o.into)).filter(Boolean) as string[], box: intent.area, ends: openings.filter(o => o.tip).map(o => ({ x: o.tip!.x, y: o.tip!.y })) });
    const note = (result: string, more: any = {}) => { if (!dev.dry) diag({ path: 'general', result, ms: entry.ms, features, openings: entry.openings, arranged: entry.arranged, pictures: seen.blobs.length, look: lastLook, ...more }); };
    if (!a0) { entry.result = 'unusable answer'; note('unusable answer', { raw: typeof raw === 'string' ? raw : JSON.stringify(raw ?? null) }); habits.settle(features, 'not offered'); return null; }
    const { answer, edits } = validate(a0, r, forms, openings);
    entry.edits = edits; entry.answer = answer;
    say(answer.strength, answer.function, edits);
    if (answer.strength === 'silent' || (intent.request && answer.strength === 'ask')) { entry.result = 'silent'; note(a0.strength === 'silent' ? 'silent (the model chose it)' : 'silent (everything it offered was removed)', { edits, move: a0.move, built: (raw as any)?.built, lacks: (raw as any)?.lacks, could_be: (raw as any)?.could_be }); habits.settle(features, 'not offered'); return null; }
    note(answer.strength, { edits, move: answer.move, read: answer.read, cards: (answer.cards ?? []).length, fork: (answer.fork ?? []).length, actions: (answer.actions ?? []).length });
    const f0 = forms[0], a0b = intent.area;
    const scope = (): any => f0?.facts.container ? { kind: 'section', id: f0.facts.container.id, title: f0.facts.container.title } : { kind: 'region', box: { x: a0b.x - a0b.w / 2, y: a0b.y - a0b.h / 2, w: a0b.w * 2, h: a0b.h * 2 } };
    const sig = features.join(' '), sit = situation;
    const set = renderAnswer(rootEl, r, forms, answer, openings, {
      onKeep: (fn, other) => {
        if (dev.dry) return;
        if (fn) addKey(store, { scope: scope(), form: sit, sig, means: fn, source: other ? 'chosen' : 'accepted' });
        if (other) addKey(store, { scope: scope(), form: sit, sig, means: other, source: 'not-chosen' });
        trace.note('accept', [], fn); habits.settle(features, other ? 'chose' : 'accepted', fn);
      },
      onDrop: fn => { if (dev.dry) return; addKey(store, { scope: scope(), form: sit, sig, means: fn || 'this reading', source: 'dismissed' }); trace.note('dismiss', [], fn); habits.settle(features, 'dismissed', fn || answer.function || 'this reading'); },
      onAsk: option => {
        if (dev.dry) return;
        addKey(store, { scope: scope(), form: sit, sig, means: option, source: 'chosen' });
        habits.settle(features, 'chose', option);
        (dev.followUp as ((i: GeneralIntent) => void) | undefined)?.({ ...intent, key: intent.key + ':ask', request: option });
      },
      done,
    }, intent.area);
    habits.aiWrote([...(answer.cards ?? []), ...(answer.fork ?? []).flatMap((k: any) => k.cards ?? [])].map((c: any) => (c.slot ? r.byRef.get(c.slot)?.id : undefined)).filter(Boolean) as string[]);
    entry.result = answer.strength;
    return set;
  }

  // dev: the board as a replayable fixture, and the forms the gate would see right now
  dev.fixture = () => { const r = readBoard(gfx); const all = new Set((gfx.gfxElements as any[]).map(e => e.id)); const forms = detectForms(gfx, r, all, trace); const os = findOpenings(r, forms, all); return { text: message(r, forms, os), forms, openings: os }; };
  dev.openings = (ids?: string[]) => { const r = readBoard(gfx); const all = new Set(ids ?? (gfx.gfxElements as any[]).map(e => e.id)); return serialiseOpenings(findOpenings(r, detectForms(gfx, r, all, trace), all), r).join('\n'); };
  dev.forms = (ids?: string[]) => { const r = readBoard(gfx); return serialiseForms(detectForms(gfx, r, new Set(ids ?? (gfx.gfxElements as any[]).map(e => e.id)), trace), r).join('\n'); };
  dev.blank = (ref: string) => isBlank(readBoard(gfx).byRef.get(ref));
  // what a typed request should know as well: the forms around what the user just touched (or selected),
  // the meanings settled here, this person's habits, and their last acts
  dev.context = (r: Reading): string => {
    const recent = trace.touchedBy(120_000); for (const ref of r.selection) { const it = r.byRef.get(ref); if (it) recent.add(it.id); }
    const forms = recent.size ? detectForms(gfx, r, recent, trace).slice(0, 6) : [];
    const os = recent.size ? findOpenings(r, forms, recent).filter(o => o.touched).slice(0, 12) : [];
    const L: string[] = [];
    const arr = findArranged(r, trace, 120_000); if (arr.length) L.push('ARRANGED (what they just moved or recoloured, and what it now sits with)', ...arr.map(a => '- ' + a.line), '');
    if (os.length) L.push('OPENINGS AROUND WHAT THE USER JUST TOUCHED (what they left open; put answers there)', ...serialiseOpenings(os, r));
    if (forms.length) L.push('', 'STRUCTURE AROUND THEM (described by code; meaning not decided)', ...serialiseForms(forms, r));
    const ks = dev.dry ? [] : serialiseKeys(store, r); if (ks.length) L.push('', 'KEYS (meanings settled on this board)', ...ks);
    const hs = habits.serialise(featuresOf(os, forms, r)); if (hs.length) L.push('', 'CASES (moments like this one, with this person)', ...hs);
    const acts = trace.serialise(r); if (acts.length) L.push('', 'ACT (what they just did, oldest first)', ...acts.slice(-14));
    return L.join('\n');
  };
  dev.dry = false;          // the check runner sets this: read nothing from memory, teach nothing
  dev.detect = detect; dev.run = run;
  return { detect, run, dev, tick: () => habits.tick(trace) };
}

export type { V5 };
