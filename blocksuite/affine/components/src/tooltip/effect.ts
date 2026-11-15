// Canvas: no hover labels anywhere. `affine-tooltip` is registered as an inert element,
// so every toolbar and menu that renders one simply shows nothing on hover.
class SilentTooltip extends HTMLElement {
  connectedCallback() {
    this.style.display = 'none';
  }
}

export function effects() {
  if (!customElements.get('affine-tooltip')) {
    customElements.define('affine-tooltip', SilentTooltip);
  }
}
