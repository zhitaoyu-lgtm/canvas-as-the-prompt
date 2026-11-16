// Stickers and stamps.
// · AFFiNE's own sticker packs (Arrows, Cheeky Piggies, Contorted Stickers, Paper), loaded on demand.
// · "Reactions": Microsoft Fluent Emoji 3D (MIT), the closest open set to FigJam's stamps. Also used by the Stamp tool.

import { EdgelessTemplatePanel } from '@blocksuite/affine/gfx/template';

import { TEMPLATE_CATEGORIES, insertTemplate, panelEntries } from './templates';

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

// Template library order: our templates first (one family, one style), then stickers.
// AFFiNE's own templates are left out: their colours and type don't match the rest of the board.
let host: any = null;
export function setTemplateHost(rootEl: any) { host = rootEl; }
const proto: any = (EdgelessTemplatePanel as any).prototype;
const origInsert = proto._insertTemplate;
proto._insertTemplate = async function (template: any, bound: any) {
  if (!template?.cxTemplate || !host) return origInsert.call(this, template, bound);
  try { await insertTemplate(host, template.cxTemplate, { x: bound.x + bound.w / 2, y: bound.y + bound.h / 2 }); }
  finally { try { this.gfx.tool.setTool({ toolName: 'default' }); } catch { /* tool already reset */ } }
};
EdgelessTemplatePanel.templates.extend({
  categories: async () => [...TEMPLATE_CATEGORIES, REACTIONS, ...STICKER_PACKS],
  list: async (cate: string) => {
    if (TEMPLATE_CATEGORIES.includes(cate)) return panelEntries(cate) as any;
    if (cate === REACTIONS) return reactions() as any;
    if (STICKER_PACKS.includes(cate)) return (await stickers()).list(cate);
    return [];
  },
  search: async (q: string) => {
    if (!q.trim()) return [];
    const own = [...panelEntries().filter(t => match(q, t.name)), ...reactions().filter(t => match(q, t.name))];
    return [...own, ...((await (await stickers()).search(q)) as any[])] as any;
  },
} as any);
(window as any).cxTemplates = { insert: (id: string, x: number, y: number) => host && insertTemplate(host, id, { x, y }) };
