// Minimal services the editor expects from its host app. Adapted from the BlockSuite playground (MIT).
import type { DocMode } from '@blocksuite/affine/model';
import { type DocModeProvider, type EditorSetting, GeneralSettingSchema, type ParseDocUrlService } from '@blocksuite/affine/shared/services';
import type { Workspace } from '@blocksuite/affine/store';
import { Signal } from '@preact/signals-core';
import { Subject } from 'rxjs';

/** This app only ever shows the whiteboard. */
export function whiteboardOnly(): DocModeProvider {
  const changed = new Subject<DocMode>();
  return {
    getPrimaryMode: () => 'edgeless',
    onPrimaryModeChange: (handler) => changed.subscribe(handler),
    getEditorMode: () => 'edgeless',
    setEditorMode: () => {},
    setPrimaryMode: () => {},
    togglePrimaryMode: () => 'edgeless',
  };
}

/** The document view only ever shows the page. */
export function pageOnly(): DocModeProvider {
  const changed = new Subject<DocMode>();
  return {
    getPrimaryMode: () => 'page',
    onPrimaryModeChange: (handler) => changed.subscribe(handler),
    getEditorMode: () => 'page',
    setEditorMode: () => {},
    setPrimaryMode: () => {},
    togglePrimaryMode: () => 'page',
  };
}

export function editorSetting() {
  const initial = Object.entries(GeneralSettingSchema.shape).reduce((pre: EditorSetting, [key, schema]) => {
    // @ts-expect-error key is an EditorSetting field
    pre[key as keyof EditorSetting] = (schema as any).parse(undefined);
    return pre;
  }, {} as EditorSetting);
  return new Signal<EditorSetting>(initial);
}

export function parseDocUrl(collection: Workspace): ParseDocUrlService {
  return {
    parseDocUrl: (url: string) => {
      if (!url || !URL.canParse(url)) return undefined;
      const path = decodeURIComponent(new URL(url).hash.slice(1));
      const doc = path ? Array.from(collection.docs.values()).find((d) => d.id === path) : null;
      return doc ? { docId: doc.id } : undefined;
    },
  };
}
