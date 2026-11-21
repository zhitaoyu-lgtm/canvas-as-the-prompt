// Saving the board without touching the hand.
//
// The stock store (IndexedDBDocSource) rewrites the whole board on every change: it reads the one saved record,
// merges the new change into it and writes everything back. A pen stroke is dozens of changes a second, so on a
// board that has been lived in (megabytes of history) every pointer move paid for the whole board, on the main
// thread. That is invisible on a fresh test board and gets worse the longer a board is used.
//
// This store keeps the same database and the same records (nothing to migrate), and changes when and how much
// is written:
//   · changes are gathered and written in the pauses, never while the pointer is down (with a cap, so nothing
//     waits long);
//   · a write appends to a small "tail" record beside the main one, so its cost follows the size of the change,
//     not of the board;
//   · the tail is folded into the main record when the board is idle, when it has grown, and when the page is
//     hidden or closed. Loading reads both.
// Other open copies of the board still hear every change at once (the broadcast is not delayed).

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { diffUpdate, encodeStateVectorFromUpdate, mergeUpdates } from 'yjs';

type Row = { timestamp: number; update: Uint8Array };
type Rec = { id: string; updates: Row[] };
interface DB extends DBSchema { collection: { key: string; value: Rec } }
type Msg = { type: 'db-updated'; payload: { docId: string; update: Uint8Array } };

const TAIL = '::tail';
const QUIET_MS = 700;          // write this long after the last change…
const CAP_MS = 5000;           // …but never hold a change longer than this
const FOLD_IDLE_MS = 20_000;   // fold the tail into the main record after this much stillness
const FOLD_BYTES = 384 * 1024; // …or when the tail has grown past this

export class QuietDocSource {
  name = 'indexeddb';
  channel: BroadcastChannel;
  private dbPromise: Promise<IDBPDatabase<DB>> | null = null;
  private pending = new Map<string, Uint8Array[]>();
  private tailBytes = new Map<string, number>();
  private firstAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private foldTimer: ReturnType<typeof setTimeout> | null = null;
  private down = false;
  private work: Promise<void> = Promise.resolve();
  stats = { writes: 0, folds: 0, lastWriteMs: 0, lastFoldMs: 0, bytes: 0, docBytes: 0 };

  constructor(readonly dbName: string) {
    this.channel = new BroadcastChannel('indexeddb:' + dbName);
    addEventListener('pointerdown', () => { this.down = true; }, true);
    const up = () => { this.down = false; if (this.pending.size) this.schedule(); };
    addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    // leaving the page: write what is waiting, and leave one tidy record behind
    const leave = () => { void this.flush().then(() => this.foldAll()); };
    addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
    (window as any).cxSave = { stats: this.stats, flush: () => this.flush(), fold: () => this.foldAll() };
  }

  private db() {
    if (!this.dbPromise) this.dbPromise = openDB<DB>(this.dbName, 1, { upgrade: db => { db.createObjectStore('collection', { keyPath: 'id' }); } });
    return this.dbPromise;
  }

  async pull(docId: string, state: Uint8Array) {
    await this.work;                               // anything being written is part of the answer
    const db = await this.db();
    const tx = db.transaction('collection', 'readonly'), st = tx.objectStore('collection');
    const [main, tail] = await Promise.all([st.get(docId), st.get(docId + TAIL)]);
    // a tail left by a session that ended before it could fold: fold it in the next still moment
    if (tail?.updates.length && !this.tailBytes.has(docId)) { this.tailBytes.set(docId, tail.updates.reduce((n, r) => n + r.update.byteLength, 0)); if (this.foldTimer) clearTimeout(this.foldTimer); this.foldTimer = setTimeout(() => { if (!this.down && !this.pending.size) void this.foldAll(); }, 8000); }
    const waiting = this.pending.get(docId) ?? [];
    const all = [...(main?.updates ?? []), ...(tail?.updates ?? [])].map(u => u.update).concat(waiting);
    if (!all.length) return null;
    const update = all.length === 1 ? all[0] : mergeUpdates(all);
    this.stats.docBytes = Math.max(this.stats.docBytes, update.byteLength);
    return { data: state.length ? diffUpdate(update, state) : update, state: encodeStateVectorFromUpdate(update) };
  }

  push(docId: string, data: Uint8Array): void {
    const list = this.pending.get(docId); if (list) list.push(data); else this.pending.set(docId, [data]);
    if (!this.firstAt) this.firstAt = Date.now();
    this.channel.postMessage({ type: 'db-updated', payload: { docId, update: data } } satisfies Msg);
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    const held = Date.now() - this.firstAt;
    const wait = held >= CAP_MS ? 0 : Math.min(QUIET_MS, CAP_MS - held);
    this.timer = setTimeout(() => {
      this.timer = null;
      // mid-stroke: the hand comes first, unless the change has waited long enough
      if (this.down && Date.now() - this.firstAt < CAP_MS) { this.schedule(); return; }
      void this.flush();
    }, wait);
  }

  /** Write what is waiting: one small append per document. */
  flush(): Promise<void> {
    const batch = [...this.pending]; this.pending.clear(); this.firstAt = 0;
    if (!batch.length) return this.work;
    this.work = this.work.then(async () => {
      const t0 = performance.now();
      try {
        const db = await this.db();
        const tx = db.transaction('collection', 'readwrite'), st = tx.objectStore('collection');
        for (const [docId, ups] of batch) {
          const update = ups.length === 1 ? ups[0] : mergeUpdates(ups);
          const tail = (await st.get(docId + TAIL)) ?? { id: docId + TAIL, updates: [] as Row[] };
          tail.updates.push({ timestamp: Date.now(), update });
          await st.put(tail);
          this.tailBytes.set(docId, tail.updates.reduce((n, r) => n + r.update.byteLength, 0));
          this.stats.bytes += update.byteLength;
        }
        await tx.done;
        this.stats.writes++; this.stats.lastWriteMs = Math.round(performance.now() - t0);
      } catch (e) {
        // not written: keep it for the next try rather than lose it
        for (const [docId, ups] of batch) this.pending.set(docId, [...ups, ...(this.pending.get(docId) ?? [])]);
        if (!this.firstAt) this.firstAt = Date.now();
        console.warn('[save]', e); setTimeout(() => this.schedule(), 1500);
      }
    });
    void this.work.then(() => {
      const big = [...this.tailBytes].some(([, n]) => n > FOLD_BYTES);
      if (this.foldTimer) clearTimeout(this.foldTimer);
      this.foldTimer = setTimeout(() => { if (this.down || this.pending.size) return; void this.foldAll(); }, big ? 1500 : FOLD_IDLE_MS);
    });
    return this.work;
  }

  /** Fold every tail into its main record (one transaction per document: either both change or neither). */
  foldAll(): Promise<void> {
    this.work = this.work.then(async () => {
      const t0 = performance.now();
      try {
        const db = await this.db();
        for (const docId of [...this.tailBytes.keys()]) {
          const tx = db.transaction('collection', 'readwrite'), st = tx.objectStore('collection');
          const tail = await st.get(docId + TAIL);
          if (tail?.updates.length) {
            const main = await st.get(docId);
            const merged = mergeUpdates([...(main?.updates ?? []), ...tail.updates].map(u => u.update));
            this.stats.docBytes = Math.max(this.stats.docBytes, merged.byteLength);
            await st.put({ id: docId, updates: [{ timestamp: Date.now(), update: merged }] });
            await st.delete(docId + TAIL);
          }
          await tx.done; this.tailBytes.delete(docId);
        }
        this.stats.folds++; this.stats.lastFoldMs = Math.round(performance.now() - t0);
      } catch (e) { console.warn('[save] fold', e); }
    });
    return this.work;
  }

  subscribe(cb: (docId: string, data: Uint8Array) => void) {
    const on = (event: MessageEvent<Msg>) => { if (event.data?.type === 'db-updated') cb(event.data.payload.docId, event.data.payload.update); };
    this.channel.addEventListener('message', on);
    return () => this.channel.removeEventListener('message', on);
  }
}
