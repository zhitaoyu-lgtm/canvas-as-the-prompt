import { css, unsafeCSS } from 'lit';

import { fontSMStyle } from './font';

export const panelBaseColorsStyle = (container: string) => css`
  ${unsafeCSS(container)} {
    color: var(--affine-icon-color);
    /* Canvas: one surface style for every floating panel (FigJam Elevation 200, white) */
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.08),
      0 1px 3px rgba(0, 0, 0, 0.08),
      0 0 0.5px rgba(0, 0, 0, 0.18);
    background: #ffffff;
  }
`;

export const panelBaseStyle = (container: string) => css`
  ${unsafeCSS(container)} {
    display: flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    padding: 0 6px;
    border-radius: 14px;
    border: none;
  }
  ${panelBaseColorsStyle(container)}
  ${fontSMStyle(container)}
`;
