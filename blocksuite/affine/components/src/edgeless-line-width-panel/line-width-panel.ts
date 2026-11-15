import { BRUSH_LINE_WIDTHS, LineWidth } from '@blocksuite/affine-model';
import { WithDisposable } from '@blocksuite/global/lit';
import { css, html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

export class EdgelessLineWidthPanel extends WithDisposable(LitElement) {
  private _onSelect(lineWidth: number) {
    this.dispatchEvent(
      new CustomEvent('select', {
        detail: lineWidth,
        bubbles: true,
        composed: true,
        cancelable: true,
      })
    );
  }

  // Canvas: Apple-style segmented thickness picker. One dot per width, growing with it;
  // the chosen one sits on the same light-gray rounded square the tool trays use.
  static override styles = css`
    :host { display: inline-flex; }
    .widths { display: flex; align-items: center; gap: 2px; padding: 0 2px; }
    button {
      all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: 8px;
      display: grid; place-items: center; cursor: pointer; transition: background 0.12s ease;
    }
    button:hover { background: #f5f5f5; }
    button[aria-pressed='true'] { background: #f2f2f2; }
    button:focus-visible { outline: 2px solid #0c8ce9; outline-offset: 1px; }
    i {
      display: block; border-radius: 50%; background: #a1a1a1;
      transition: background 0.12s ease, transform 0.12s ease;
    }
    button:hover i { background: #757575; }
    button[aria-pressed='true'] i { background: #1e1e1e; }
    :host([disabled]) .widths { opacity: 0.3; pointer-events: none; }
  `;

  override render() {
    const n = this.lineWidths.length;
    return html`<div class="widths" role="radiogroup" aria-label="Thickness">
      ${repeat(
        this.lineWidths,
        w => w,
        (w, i) => {
          const d = Math.round(3 + (n > 1 ? i / (n - 1) : 0) * 11);
          return html`<button
            role="radio"
            aria-label=${`${w}px`}
            aria-pressed=${String(w === this.selectedSize)}
            aria-checked=${String(w === this.selectedSize)}
            ?disabled=${this.disabled}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._onSelect(w);
            }}
          >
            <i style=${`width:${d}px;height:${d}px`}></i>
          </button>`;
        }
      )}
    </div>`;
  }

  @property({ attribute: false })
  accessor disabled = false;

  @property({ attribute: false })
  accessor hasTooltip = true;

  @property({ attribute: false })
  accessor lineWidths: number[] = BRUSH_LINE_WIDTHS;

  @property({ attribute: false })
  accessor selectedSize: number = LineWidth.Two;
}

declare global {
  interface HTMLElementTagNameMap {
    'edgeless-line-width-panel': EdgelessLineWidthPanel;
  }
}
