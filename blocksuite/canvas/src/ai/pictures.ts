// Pictures from the web, for answers that are better seen than read (a section, a plan, a detail, a photo).
// Only in the desktop app: its own server looks them up (Wikimedia Commons, with source and licence) and fetches
// them, so the page needs no other site's permission. In the claude.ai preview there is no way out to the web:
// a request for a picture then says plainly that there is none, rather than turning into a note.

const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const H = { 'x-canvas': 'picture' };

export type Found = { blob: Blob; w: number; h: number; title: string; page?: string; author?: string; licence?: string; source: string };

export const canFind = () => LOCAL;

/** The picture at a web address: directly if that site allows it, through the desktop app's server otherwise. */
export async function fetchPicture(url: string): Promise<Blob | null> {
  const ok = (b: Blob | null) => (b && b.type.startsWith('image/') && b.size > 200 ? b : null);
  try { const r = await fetch(url, { mode: 'cors' }); if (r.ok) { const b = ok(await r.blob()); if (b) return b; } } catch { /* the site does not allow it */ }
  if (!LOCAL) return null;
  try { const r = await fetch('/__picture?u=' + encodeURIComponent(url), { headers: H }); return r.ok ? ok(await r.blob()) : null; } catch { return null; }
}

/** The first good picture for these words, or null. */
export async function findPicture(words: string): Promise<Found | null> {
  if (!LOCAL || !words.trim()) return null;
  let list: any[] = [];
  try { const r = await fetch('/__pictures?q=' + encodeURIComponent(words), { headers: H }); if (r.ok) list = await r.json(); } catch { return null; }
  for (const c of list.slice(0, 5)) {
    const blob = await fetchPicture(c.url); if (!blob) continue;
    try { const bmp = await createImageBitmap(blob); const out = { blob, w: bmp.width, h: bmp.height, title: c.title, page: c.page, author: c.author, licence: c.licence, source: 'Wikimedia Commons' }; bmp.close?.(); return out; } catch { /* not a picture after all */ }
  }
  return null;
}
