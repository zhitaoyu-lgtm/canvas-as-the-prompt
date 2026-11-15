// Link previews for link cards (AFFiNE bookmark blocks).
// AFFiNE normally asks its own server for a page's title, description and picture. This app has no
// server, so: what the AI already knows about a link is registered here first; anything else is
// looked up with a public preview service when the network allows it (desktop, plain browser).
// Inside the claude.ai preview the page cannot reach other sites, so cards show without a picture.

import { LinkPreviewServiceIdentifier } from '@blocksuite/affine/shared/services';

export type Preview = { title?: string | null; description?: string | null; image?: string | null; icon?: string | null };
const known = new Map<string, Preview>();
const looked = new Map<string, Promise<Preview>>();

export function remember(url: string, p: Preview) { known.set(url, { ...known.get(url), ...p }); }

const favicon = (url: string) => { try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; } catch { return null; } };

/** Best-effort lookup of a page's picture and words. Never throws; empty when offline. */
export function lookup(url: string, signal?: AbortSignal): Promise<Preview> {
  if (!looked.has(url)) {
    looked.set(url, (async () => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
        signal?.addEventListener('abort', () => ctl.abort());
        const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, { signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) return {};
        const d = (await r.json())?.data ?? {};
        return { title: d.title ?? null, description: d.description ?? null, image: d.image?.url ?? null, icon: d.logo?.url ?? favicon(url) };
      } catch { return {}; }
    })());
  }
  return looked.get(url)!;
}

export const linkPreviewExtension = {
  setup(di: any) {
    di.override(LinkPreviewServiceIdentifier, () => ({
      endpoint: 'local', setEndpoint() {},
      async query(url: string, signal?: AbortSignal) {
        const k = known.get(url) ?? {};
        const need = !k.image || !k.title;
        const l = need ? await lookup(url, signal) : {};
        return { title: k.title ?? l.title ?? null, description: k.description ?? l.description ?? null, image: k.image ?? l.image ?? null, icon: k.icon ?? l.icon ?? favicon(url) };
      },
    }));
  },
};
