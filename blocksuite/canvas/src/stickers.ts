// Stickers and stamps.
// · AFFiNE's own sticker packs (Arrows, Cheeky Piggies, Contorted Stickers, Paper), loaded on demand.
// · "Reactions": Microsoft Fluent Emoji 3D (MIT), the closest open set to FigJam's stamps. Also used by the Stamp tool.

import { EdgelessTemplatePanel } from '@blocksuite/affine/gfx/template';

import { builtInTemplates } from '@affine/templates/edgeless';

const files = import.meta.glob('./assets/stamps/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const STAMPS: { name: string; url: string }[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => {
    const slug = path.split('/').pop()!.replace(/^\d+-/, '').replace(/\.webp$/, '');
    return { name: slug.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase()), url };
  });

function stickerTemplate(name: string, url: string, size = 120) {
  const hash = `stamp-${name.toLowerCase().replace(/\s+/g, '-')}`;
  return {
    name, preview: url, type: 'sticker', assets: { [hash]: url },
    content: {
      type: 'page',
      meta: { id: 'doc:home', title: 'Sticker', createDate: 1701765881935, tags: [] },
      blocks: {
        type: 'block', id: 'block:page', flavour: 'affine:page',
        props: { title: { '$blocksuite:internal:text$': true, delta: [{ insert: 'Sticker' }] } },
        children: [{
          type: 'block', id: 'block:surface', flavour: 'affine:surface', props: { elements: {} },
          children: [{
            type: 'block', id: 'block:image', flavour: 'affine:image',
            props: { caption: '', sourceId: hash, width: 0, height: 0, index: 'b0D', xywh: `[0,0,${size},${size}]`, rotate: 0 },
            children: [],
          }],
        }],
      },
    },
  };
}

const REACTIONS = 'Reactions';
const STICKER_PACKS = ['Arrows', 'Cheeky Piggies', 'Contorted Stickers', 'Paper'];
let stickerModule: Promise<any> | null = null;
const stickers = () => (stickerModule ??= import('@affine/templates/stickers').then(m => m.builtInTemplates));
const reactions = () => STAMPS.map(s => stickerTemplate(s.name, s.url));
const match = (q: string, name: string) => name.toLowerCase().includes(q.trim().toLowerCase());

// Template library order: templates first, then stickers.
EdgelessTemplatePanel.templates.extend(builtInTemplates as any);
EdgelessTemplatePanel.templates.extend({
  categories: async () => [REACTIONS, ...STICKER_PACKS],
  list: async (cate: string) => {
    if (cate === REACTIONS) return reactions() as any;
    if (STICKER_PACKS.includes(cate)) return (await stickers()).list(cate);
    return [];
  },
  search: async (q: string) => {
    if (!q.trim()) return [];
    const own = reactions().filter(t => match(q, t.name));
    return [...own, ...((await (await stickers()).search(q)) as any[])] as any;
  },
} as any);
