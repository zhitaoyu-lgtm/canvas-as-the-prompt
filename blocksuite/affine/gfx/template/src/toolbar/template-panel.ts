import { DefaultTool } from '@blocksuite/affine-block-surface';
import {
  darkToolbarStyles,
  lightToolbarStyles,
} from '@blocksuite/affine-components/toolbar';
import {
  EditPropsStore,
  ThemeProvider,
} from '@blocksuite/affine-shared/services';
import {
  requestConnectedFrame,
  stopPropagation,
} from '@blocksuite/affine-shared/utils';
import { EdgelessDraggableElementController } from '@blocksuite/affine-widget-edgeless-toolbar';
import type { Bound } from '@blocksuite/global/gfx';
import { WithDisposable } from '@blocksuite/global/lit';
import type { BlockComponent } from '@blocksuite/std';
import { GfxControllerIdentifier } from '@blocksuite/std/gfx';
import { baseTheme } from '@toeverything/theme';
import { css, html, LitElement, nothing, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import { createTemplateJob } from '../services/template.js';
import { builtInTemplates } from './builtin-templates.js';
import { defaultPreview, Triangle } from './cards.js';
import type { Template } from './template-type.js';
import { cloneDeep } from './utils.js';

function toSvgPreviewDataUrl(svg: string) {
  // Previews paint their ground with currentColor; as an <img> that resolves to black.
  // Give them the card's light ground instead.
  svg = svg.replace(/currentColor/g, '#f5f5f5');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class EdgelessTemplatePanel extends WithDisposable(LitElement) {
  static override styles = css`
    :host {
      position: absolute;
      font-family: ${unsafeCSS(baseTheme.fontSansFamily)};
      z-index: 1;
    }

    /* Canvas: restyled to the FigJam-style toolbar (white, Elevation 200, gray UI) */
    .edgeless-templates-panel {
      width: 472px;
      height: 520px;
      border-radius: 14px;
      background-color: #ffffff;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.08),
        0 0 0.5px rgba(0, 0, 0, 0.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
      color: #1e1e1e;
    }

    .search-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 48px;
      padding: 0 16px;
      border-bottom: 1px solid #e6e6e6;
      flex-shrink: 0;
      color: #a1a1a1;
    }

    .search-input {
      border: 0;
      color: #1e1e1e;
      font-size: 13px;
      font-family: inherit;
      background-color: transparent;
      outline: none;
      width: 100%;
    }

    .search-input::placeholder {
      color: #a1a1a1;
    }

    .template-categories {
      display: flex;
      flex-wrap: wrap;
      padding: 8px 12px;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
      flex-shrink: 0;
    }
    .template-categories::-webkit-scrollbar {
      display: none;
    }

    .category-entry {
      color: #757575;
      font-size: 12px;
      font-weight: 500;
      line-height: 20px;
      border-radius: 8px;
      flex-shrink: 0;
      flex-grow: 0;
      width: fit-content;
      padding: 4px 10px;
      cursor: pointer;
    }

    .category-entry:hover {
      color: #1e1e1e;
      background-color: #f5f5f5;
    }

    .category-entry.selected {
      color: #1e1e1e;
      background-color: #f2f2f2;
    }

    .template-viewport {
      position: relative;
      flex-grow: 1;
      min-height: 0;
    }

    .template-scrollcontent {
      overflow: hidden;
      height: 100%;
      width: 100%;
    }

    .template-list {
      padding: 4px 12px 12px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .template-item {
      position: relative;
      height: 84px;
      background-color: #f5f5f5;
      border: 1px solid #efefef;
      border-radius: 8px;
      cursor: pointer;
      overflow: hidden;
      color: #f5f5f5;
    }

    .template-item > svg {
      display: block;
      margin: 0 auto;
      width: 100%;
      height: 100%;
      color: #f5f5f5;
    }

    .template-item:hover {
      border-color: #d4d4d4;
    }

    .template-item:hover::after {
      content: '';
      position: absolute;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.03);
    }

    .template-item.loading::before {
      display: none;
    }

    .template-item.loading > affine-template-loading {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
    }

    .template-item img.template-preview {
      object-fit: contain;
      width: 100%;
      height: 100%;
      display: block;
      padding: 8px;
      box-sizing: border-box;
    }

    .arrow {
      display: none;
      bottom: 0;
      position: absolute;
      transform: translateY(20px);
      color: var(--affine-background-overlay-panel-color);
    }
  `;

  static templates = builtInTemplates;

  private _fetchJob: null | { cancel: () => void } = null;

  draggableController!: EdgelessDraggableElementController<Template>;

  private _closePanel() {
    if (this.isDragging) return;
    this.dispatchEvent(new CustomEvent('closepanel'));
  }

  private _fetch(fn: (state: { canceled: boolean }) => Promise<unknown>) {
    if (this._fetchJob) {
      this._fetchJob.cancel();
    }

    this._loading = true;

    const state = { canceled: false };
    const job = {
      cancel: () => {
        state.canceled = true;
      },
    };

    this._fetchJob = job;

    fn(state)
      .catch(() => {})
      .finally(() => {
        if (!state.canceled && job === this._fetchJob) {
          this._loading = false;
          this._fetchJob = null;
        }
      });
  }

  private _getLocalSelectedCategory() {
    return this.edgeless.std.get(EditPropsStore).getStorage('templateCache');
  }

  private async _initCategory() {
    try {
      this._categories = await EdgelessTemplatePanel.templates.categories();
      this._currentCategory =
        this._getLocalSelectedCategory() ?? this._categories[0];
      this._updateTemplates();
    } catch (e) {
      console.error('Failed to load categories', e);
    }
  }

  private _initDragController() {
    if (this.draggableController) return;
    this.draggableController = new EdgelessDraggableElementController(this, {
      edgeless: this.edgeless,
      clickToDrag: true,
      standardWidth: 560,
      onOverlayCreated: overlay => {
        this.isDragging = true;
        overlay.mask.style.color = 'transparent';
      },
      onDrop: (el, bound) => {
        this._insertTemplate(el.data, bound)
          .finally(() => {
            this.isDragging = false;
          })
          .catch(console.error);
      },
      onCanceled: () => {
        this.isDragging = false;
      },
    });
  }

  get gfx() {
    return this.edgeless.std.get(GfxControllerIdentifier);
  }

  private async _insertTemplate(template: Template, bound: Bound) {
    this._loadingTemplate = template;

    template = cloneDeep(template);

    const center = {
      x: bound.x + bound.w / 2,
      y: bound.y + bound.h / 2,
    };
    const templateJob = createTemplateJob(
      this.edgeless.std,
      template.type,
      center
    );

    try {
      const { assets } = template;

      if (assets) {
        await Promise.all(
          Object.entries(assets).map(([key, value]) =>
            fetch(value)
              .then(res => res.blob())
              .then(blob => templateJob.job.assets.set(key, blob))
          )
        );
      }

      const insertedBound = await templateJob.insertTemplate(template.content);

      if (insertedBound && template.type === 'template') {
        const padding = 20 / this.gfx.viewport.zoom;
        this.gfx.viewport.setViewportByBound(
          insertedBound,
          [padding, padding, padding, padding],
          true
        );
      }
    } finally {
      this._loadingTemplate = null;
      this.gfx.tool.setTool(DefaultTool);
    }
  }

  private _updateSearchKeyword(inputEvt: InputEvent) {
    this._searchKeyword = (inputEvt.target as HTMLInputElement).value;
    this._updateTemplates();
  }

  private _updateTemplates() {
    this._fetch(async state => {
      try {
        const templates = this._searchKeyword
          ? await EdgelessTemplatePanel.templates.search(this._searchKeyword)
          : await EdgelessTemplatePanel.templates.list(this._currentCategory);

        if (state.canceled) return;

        this._templates = templates;
      } catch (e) {
        if (state.canceled) return;

        console.error('Failed to load templates', e);
      }
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._initDragController();

    this.addEventListener('keydown', stopPropagation, false);
    this._disposables.add(() => {
      if (this._currentCategory) {
        this.edgeless.std
          .get(EditPropsStore)
          .setStorage('templateCache', this._currentCategory);
      }
    });
  }

  override firstUpdated() {
    requestConnectedFrame(() => {
      this._disposables.addFromEvent(document, 'click', evt => {
        if (this.contains(evt.target as HTMLElement)) {
          return;
        }

        this._closePanel();
      });
    }, this);
    this._disposables.addFromEvent(this, 'click', stopPropagation);
    this._disposables.addFromEvent(this, 'wheel', stopPropagation);

    this._initCategory().catch(() => {});
  }

  override render() {
    const { _categories, _currentCategory, _templates } = this;
    const { draggingElement } = this.draggableController?.states || {};
    const appTheme = this.edgeless.std.get(ThemeProvider).app$.value;

    return html`
      <div
        class="edgeless-templates-panel"
        data-app-theme=${appTheme}
        style=${styleMap({
          opacity: this.isDragging ? '0' : '1',
          transition: 'opacity 0.2s',
        })}
      >
        <div class="search-bar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M10.5 16a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM14.5 14.5 19 19" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <input
            class="search-input"
            type="text"
            placeholder="Search templates and stickers"
            @input=${this._updateSearchKeyword}
            @cut=${stopPropagation}
            @copy=${stopPropagation}
            @paste=${stopPropagation}
          />
        </div>
        <div class="template-categories">
          ${repeat(
            _categories,
            cate => cate,
            cate => {
              return html`<div
                class="category-entry ${
                  _currentCategory === cate ? 'selected' : ''
                }"
                @click=${() => {
                  this._currentCategory = cate;
                  this._updateTemplates();
                }}
              >
                ${cate}
              </div>`;
            }
          )}
        </div>
        <div class="template-viewport">
          <div class="template-scrollcontent" data-scrollable>
            <div class="template-list">
              ${
                this._loading
                  ? html`<affine-template-loading
                      style=${styleMap({
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                      })}
                    ></affine-template-loading>`
                  : repeat(
                      _templates,
                      template => template.name,
                      template => {
                        const preview = template.preview
                          ? template.preview.startsWith('<svg')
                            ? html`<img
                                src="${toSvgPreviewDataUrl(template.preview)}"
                                class="template-preview"
                                loading="lazy"
                              />`
                            : html`<img
                                src="${template.preview}"
                                class="template-preview"
                                loading="lazy"
                              />`
                          : defaultPreview;

                        const isBeingDragged =
                          draggingElement &&
                          draggingElement.data.name === template.name;
                        return html`
                          <div
                            class=${`template-item ${
                              template === this._loadingTemplate
                                ? 'loading'
                                : ''
                            }`}
                            style=${styleMap({
                              opacity: isBeingDragged ? '0' : '1',
                            })}
                            data-hover-text="Add"
                            @mousedown=${(e: MouseEvent) =>
                              this.draggableController.onMouseDown(e, {
                                data: template,
                                preview,
                              })}
                            @touchstart=${(e: TouchEvent) => {
                              this.draggableController.onTouchStart(e, {
                                data: template,
                                preview,
                              });
                            }}
                          >
                            ${preview}
                            ${
                              template === this._loadingTemplate
                                ? html`<affine-template-loading></affine-template-loading>`
                                : nothing
                            }
                            ${
                              template.name
                                ? html`<affine-tooltip
                                    .offset=${12}
                                    .autoHide=${true}
                                    tip-position="top"
                                  >
                                    ${template.name}
                                  </affine-tooltip>`
                                : nothing
                            }
                          </div>
                        `;
                      }
                    )
              }
            </div>
          </div>
          <overlay-scrollbar></overlay-scrollbar>
        </div>
        <div class="arrow">${Triangle}</div>
      </div>
    `;
  }

  @state()
  private accessor _categories: string[] = [];

  @state()
  private accessor _currentCategory = '';

  @state()
  private accessor _loading = false;

  @state()
  private accessor _loadingTemplate: Template | null = null;

  @state()
  private accessor _searchKeyword = '';

  @state()
  private accessor _templates: Template[] = [];

  @property({ attribute: false })
  accessor edgeless!: BlockComponent;

  @state()
  accessor isDragging = false;
}
