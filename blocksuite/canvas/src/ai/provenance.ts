// Who made what. Kept in the board's own document (a shared map beside the blocks), so it
// travels with the board, survives reloads, and undo/redo of an element leaves it alone.

const KEY = 'cx:author';
const mapOf = (store: any) => store?.spaceDoc?.getMap?.(KEY) ?? store?.doc?.spaceDoc?.getMap?.(KEY);

export function authorOf(store: any, id: string): 'user' | 'ai' {
  try { return mapOf(store)?.get(id) === 'ai' ? 'ai' : 'user'; } catch { return 'user'; }
}
export function markAi(store: any, ids: string[]) {
  const m = mapOf(store); if (!m) return;
  for (const id of ids) m.set(id, 'ai');
}
export function markUser(store: any, ids: string[]) {
  const m = mapOf(store); if (!m) return;
  for (const id of ids) m.delete(id);
}
export function aiIds(store: any): string[] {
  const m = mapOf(store); if (!m) return [];
  return [...m.entries()].filter(([, v]) => v === 'ai').map(([k]) => k as string);
}
