import { BRUSH_LINE_WIDTHS, LineWidth } from '@blocksuite/affine-model';
import { WithDisposable } from '@blocksuite/global/lit';
import { css, html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';

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

  // Canvas: Apple-style slider. A live dot shows the stroke; the knob snaps to the allowed widths.
  static override styles = css`
    :host { display: inline-flex; }
    .wrap { display: flex; align-items: center; gap: 10px; padding: 0 8px; height: 36px; }
    .preview { width: 16px; height: 16px; display: grid; place-items: center; flex: none; }
    .preview i { display: block; border-radius: 50%; background: #1e1e1e; transition: width .12s ease, height .12s ease; }
    .track { position: relative; width: 112px; height: 24px; cursor: pointer; touch-action: none; outline: none; }
    .rail, .fill { position: absolute; left: 0; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px; }
    .rail { right: 0; background: #e6e6e6; }
    .fill { background: #1e1e1e; }
    .knob {
      position: absolute; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.22), 0 0 0 .5px rgba(0,0,0,.12);
      transition: transform .12s ease;
    }
    .track.dragging .knob, .track:active .knob { transform: scale(1.1); }
    .track:focus-visible .knob { box-shadow: 0 0 0 2px #0c8ce9; }
    .fill, .knob { transition: left .14s cubic-bezier(.2,.8,.2,1), width .14s cubic-bezier(.2,.8,.2,1), transform .12s ease; }
    .track.dragging .fill, .track.dragging .knob { transition: transform .12s ease; }
    :host([disabled]) .wrap { opacity: .3; pointer-events: none; }
  `;

  private _dragging = false;

  private _indexAt(e: PointerEvent, track: HTMLElement) {
    const r = track.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    return Math.round(t * (this.lineWidths.length - 1));
  }

  private _pick(i: number) {
    const w = this.lineWidths[i];
    if (w !== undefined && w !== this.selectedSize) {
      this.selectedSize = w;
      this._onSelect(w);
    }
  }

  override render() {
    const n = this.lineWidths.length;
    const idx = Math.max(0, this.lineWidths.indexOf(this.selectedSize));
    const pct = n > 1 ? (idx / (n - 1)) * 100 : 0;
    const d = Math.round(3 + (n > 1 ? idx / (n - 1) : 0) * 11);
    return html`<div class="wrap">
      <span class="preview"><i style=${`width:${d}px;height:${d}px`}></i></span>
      <div
        class="track ${this._dragging ? 'dragging' : ''}"
        role="slider"
        tabindex="0"
        aria-label="Thickness"
        aria-valuemin=${this.lineWidths[0]}
        aria-valuemax=${this.lineWidths[n - 1]}
        aria-valuenow=${this.selectedSize}
        @pointerdown=${(e: PointerEvent) => {
          e.stopPropagation();
          const track = e.currentTarget as HTMLElement;
          track.setPointerCapture(e.pointerId);
          this._dragging = true;
          this.requestUpdate();
          this._pick(this._indexAt(e, track));
        }}
        @pointermove=${(e: PointerEvent) => {
          if (!this._dragging) return;
          this._pick(this._indexAt(e, e.currentTarget as HTMLElement));
        }}
        @pointerup=${() => {
          this._dragging = false;
          this.requestUpdate();
        }}
        @pointercancel=${() => {
          this._dragging = false;
          this.requestUpdate();
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this._pick(Math.min(n - 1, idx + 1));
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this._pick(Math.max(0, idx - 1));
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span class="rail"></span>
        <span class="fill" style=${`width:${pct}%`}></span>
        <span class="knob" style=${`left:${pct}%`}></span>
      </div>
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
