// A record of what really happened on the user's own board: each time Claude was asked, what it was shown as
// open, what it decided, what code removed, how long it took, and any failure. Kept in the artifact's own
// database (visible to the owner only), so a "nothing appeared" can be traced to its layer afterwards.
// Outside the artifact (no database) it only stays in memory.

const W = window as any;
const session = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
const rows: any[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function save() {
  timer = null;
  try { const db = W.claude?.use ? await W.claude.use('db') : null; if (!db) return; await db.doc(`diag/${session}`).set({ session, updatedAt: new Date().toISOString(), look: document.documentElement.dataset.cxLook ?? 'light', rows: rows.slice(0, 30) }); } catch { /* not kept */ }
}

export function diag(row: { path: string; result: string; ms?: number; [k: string]: any }) {
  const clip = (v: any) => (typeof v === 'string' ? v.slice(0, 900) : v);
  rows.unshift(Object.fromEntries(Object.entries({ at: new Date().toISOString(), ...row }).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 8).map(clip) : clip(v)])));
  rows.length = Math.min(rows.length, 30);
  W.cxDiag = rows;
  if (!timer) timer = setTimeout(save, 2500);
}
