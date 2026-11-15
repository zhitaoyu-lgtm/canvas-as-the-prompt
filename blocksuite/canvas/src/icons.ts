// Icons from the Figma "FigJam UI Kit" (file google-2026): 24px, stroke 1.25–1.4.
// Flat icons use currentColor so the toolbar can tint them (idle #86868B, active #1E1E1E).
// Only the pen and the sticky stack are dimensional, exactly as exported from Figma.

const s = (d: string, w = 1.25) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${d.replace(/STROKE/g, `stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`)}</svg>`;

export const ICON = {
  cursor: s('<path d="M6 5L19 10.4L12.9 12.7L10.5 19L6 5Z" STROKE/>', 1.4),
  hand: s('<path d="M8.50002 12V6.25C8.50002 5.91848 8.63172 5.60054 8.86614 5.36612C9.10056 5.1317 9.4185 5 9.75002 5C10.0815 5 10.3995 5.1317 10.6339 5.36612C10.8683 5.60054 11 5.91848 11 6.25V11V4.75C11 4.41848 11.1317 4.10054 11.3661 3.86612C11.6006 3.6317 11.9185 3.5 12.25 3.5C12.5815 3.5 12.8995 3.6317 13.1339 3.86612C13.3683 4.10054 13.5 4.41848 13.5 4.75V11V5.75C13.5 5.41848 13.6317 5.10054 13.8661 4.86612C14.1006 4.6317 14.4185 4.5 14.75 4.5C15.0815 4.5 15.3995 4.6317 15.6339 4.86612C15.8683 5.10054 16 5.41848 16 5.75V11.5V8.25C16 7.91848 16.1317 7.60054 16.3661 7.36612C16.6006 7.1317 16.9185 7 17.25 7C17.5815 7 17.8995 7.1317 18.1339 7.36612C18.3683 7.60054 18.5 7.91848 18.5 8.25V14.2C18.5 17.7 15.9 20.5 12.5 20.5H11.5C9.60002 20.5 8.20002 19.7 7.00002 18.3L4.60002 14.9C4.36133 14.648 4.2325 14.3116 4.24187 13.9646C4.25125 13.6177 4.39806 13.2887 4.65002 13.05C4.90198 12.8113 5.23843 12.6825 5.58538 12.6919C5.93232 12.7012 6.26133 12.848 6.50002 13.1L8.50002 15.2V12Z" STROKE/>'),
  text: s('<path d="M4 7V4.5H20V7M12 4.5V20M9 20H15" STROKE/>'),
  frame: s('<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2" STROKE/><path d="M3.2 9.2H10.2V3.2" STROKE/>'),
  section: s('<path d="M18.8 3.2H5.2a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h13.6a2 2 0 0 0 2-2V5.2a2 2 0 0 0-2-2Z" STROKE/><path d="M3.2 9.2H10.2V3.2" STROKE/>'),
  // Figma kit icon/doc
  doc: s('<path d="M17.5 3h-11a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z" STROKE/><path d="M8 8h8M8 11.5h8M8 15h5" STROKE/>'),
  table: s('<path d="M20 3.2H4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5.2a2 2 0 0 0-2-2Z" STROKE/><path d="M2 8.6H22M2 13.6H22M9.4 3.2V20.8" STROKE/>'),
  stamp: s('<path d="M12 9.3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" STROKE/><path d="M10.6 9.1v3.3M13.4 9.1v3.3M6.6 19.8h10.8M5.2 16.6c0-2.6 1.3-4.2 3.4-4.2h6.8c2.1 0 3.4 1.6 3.4 4.2H5.2Z" STROKE/>'),
  comment: s('<path d="M4.4 19.6V12a7.6 7.6 0 1 1 7.6 7.6H4.4Z" STROKE/>'),
  triangleDown: s('<path d="M12 20L21 5H3L12 20Z" STROKE/>', 1.4),
  cylinder: s('<path d="M12 9c3.87 0 7-1.12 7-2.5S15.87 4 12 4 5 5.12 5 6.5 8.13 9 12 9Z" STROKE/><path d="M5 6.5v11C5 19 8 20 12 20s7-1 7-2.5v-11" STROKE/>', 1.4),
  // Figma kit icon/shape-switch: square + circle
  shapes: s('<path d="M11.5 9h-6A1.5 1.5 0 0 0 4 10.5v6A1.5 1.5 0 0 0 5.5 18h6a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 9Z" STROKE/><path d="M14.5 14a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" STROKE/>'),
  // stroke presets: same squiggle (Figma icon/squiggle) at three weights
  squiggle: (i: number) => s('<path d="M4.5 15.5C6 9 8 7.5 9.5 9C11 10.5 10 16 12.5 16.5C15 17 15.5 11 17 9C18 7.8 19 8.5 19.5 9.5" STROKE/>', [1.25, 2.25, 3.5][i]),
  minus: s('<path d="M5.5 12H18.5" STROKE/>', 1.3),
  plusThin: s('<path d="M12 5.5V18.5M5.5 12H18.5" STROKE/>', 1.3),
  fit: s('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" STROKE/>'),
  templates: s('<path d="M7.2 3.6L11 7.4L7.2 11.2L3.4 7.4L7.2 3.6Z" STROKE/><circle cx="17" cy="7.4" r="3.4" STROKE/><rect x="3.6" y="13.8" width="7.2" height="7.2" rx="1.6" STROKE/><path d="M17 13.6V21M13.3 17.3H20.7" STROKE/>'),
  plus: s('<path d="M12 5.5V18.5M5.5 12H18.5" STROKE/>', 1.3),
  image: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2" STROKE/><circle cx="9" cy="9.5" r="1.6" STROKE/><path d="M20.5 15.5L15.5 10.5L6 19.5" STROKE/>'),
  // pen tray
  pen: s('<path d="M15.2 4.8l4 4L9 19l-5 1 1-5L15.2 4.8Z" STROKE/><path d="M13 7l4 4" STROKE/>'),
  highlighter: s('<path d="M9 14l-3 3v3h3l3-3" STROKE/><path d="M9 14l7.5-7.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L12 17l-3-3Z" STROKE/><path d="M4 21h7" STROKE/>'),
  eraser: s('<path d="M8.5 19.5L4 15a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l5 5a1.6 1.6 0 0 1 0 2.3l-7.6 7.7H8.5Z" STROKE/><path d="M9.5 8l6.5 6.5M12.5 19.5H20" STROKE/>'),
  // shape tray (from Figma "Tool tray / Shape")
  fill: s('<circle cx="12" cy="12" r="8" STROKE/>', 1.4),
  fillSolid: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" fill="currentColor" stroke="currentColor" stroke-width="1.4"/></svg>`,
  chevron: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 7L8 9L10 7" stroke="#1E1E1E" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  elbow: s('<path d="M6 19V12H17V6M14 8.5L17 5.5L20 8.5" STROKE/>', 1.4),
  curve: s('<path d="M5 19C5 9 18 15 18 6M15 8L18 5L21 8" STROKE/>', 1.4),
  arrow: s('<path d="M5 19L19 5M19 13V5H11" STROKE/>', 1.4),
  line: s('<path d="M5 19L19 5" STROKE/>', 1.4),
  rect: s('<rect x="4" y="4" width="16" height="16" rx="1.5" STROKE/>', 1.4),
  ellipse: s('<circle cx="12" cy="12" r="8.5" STROKE/>', 1.4),
  diamond: s('<path d="M12 3L21 12L12 21L3 12L12 3Z" STROKE/>', 1.4),
  triangle: s('<path d="M12 4L21 19H3L12 4Z" STROKE/>', 1.4),
  rounded: s('<rect x="3" y="7" width="18" height="10" rx="5" STROKE/>', 1.4),
  mindmap: s('<rect x="3" y="9" width="6" height="6" rx="1" STROKE/><rect x="15" y="3" width="6" height="6" rx="1" STROKE/><rect x="15" y="15" width="6" height="6" rx="1" STROKE/><path d="M9 12H12M12 12V6H15M12 12V18H15" STROKE/>', 1.4),
};

// Dimensional tools, as exported from Figma (Tool / Marker, Tool / Highlighter = sticky stack, Tool / Shapes & connector).
export const PEN_3D = `<svg width="39" height="48" viewBox="0 0 39 48" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#pf)"><path d="M24.1826 15L32.5 32.6123V64H6.5V32.6084L14.5215 15H24.1826Z" fill="url(#pg)" stroke="#BDBDBD"/><path d="M6 39.3008H33" stroke="#D0D0D0"/><path class="tip" d="M19.5 4L24.5 14.5H14.2L19.5 4Z" fill="#1E1E1E"/></g><defs><filter id="pf" x="-1.5" y="-1.5" width="42" height="74" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="B"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="A"/><feOffset dy="2"/><feGaussianBlur stdDeviation="3"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0"/><feBlend mode="normal" in2="B" result="E"/><feBlend mode="normal" in="SourceGraphic" in2="E" result="shape"/></filter><linearGradient id="pg" x1="5.5" y1="2.5" x2="33.5" y2="2.5" gradientUnits="userSpaceOnUse"><stop stop-color="#E4E4E4"/><stop offset="0.3" stop-color="white"/><stop offset="0.62" stop-color="#F4F4F4"/><stop offset="0.8" stop-color="#D2D2D2"/><stop offset="1" stop-color="#ECECEC"/></linearGradient></defs></svg>`;

export const STICKY_3D = `<svg width="75" height="50" viewBox="0 0 75 50" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#sf)"><g clip-path="url(#sc)"><path d="M8.37091 39.3008L15.3709 37.3008L18.3709 65.3008H10.3709L8.37091 39.3008Z" fill="#EDEDED" stroke="#D6D6D6" stroke-width="0.7"/><path d="M11.3709 23.3008L19.3709 22.3008L20.3709 65.3008H13.3709L11.3709 23.3008Z" fill="#F4F4F4" stroke="#D6D6D6" stroke-width="0.7"/><path class="face" d="M40.3709 6.30078H66.3709V65.3008H18.3709V26.3008C18.3709 22.9674 20.0376 21.1341 23.3709 20.8008L40.3709 6.30078Z" fill="url(#sg)" stroke="#E2E2E2" stroke-width="0.6"/><path d="M23.3709 20.5008H34.3709C35.7043 15.7008 37.8709 10.9674 39.8709 6.30078L23.3709 20.5008Z" fill="url(#sh)"/></g></g><defs><filter id="sf" x="-1.62909" y="-2.69922" width="78" height="78" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="B"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="A"/><feOffset dy="2"/><feGaussianBlur stdDeviation="4"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.18 0"/><feBlend mode="normal" in2="B" result="E"/><feBlend mode="normal" in="SourceGraphic" in2="E" result="shape"/></filter><linearGradient id="sg" x1="20.3709" y1="19.3008" x2="50.3709" y2="49.3008" gradientUnits="userSpaceOnUse"><stop class="s0" stop-color="#CFCFCF"/><stop class="s1" offset="0.4" stop-color="#F7F7F7"/><stop class="s2" offset="1" stop-color="white"/></linearGradient><linearGradient id="sh" x1="24.3709" y1="20.3008" x2="37.3709" y2="7.30078" gradientUnits="userSpaceOnUse"><stop stop-color="white"/><stop offset="0.6" stop-color="#F2F2F2"/><stop offset="1" stop-color="#D9D9D9"/></linearGradient><clipPath id="sc"><rect width="62" height="62" fill="white" transform="translate(6.37091 3.30078)"/></clipPath></defs></svg>`;

export const SHAPES_FLAT = `<svg width="67" height="46" viewBox="0 0 67 46" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M25.2 8.7H5.7a1 1 0 0 0-1 1v19.5a1 1 0 0 0 1 1h19.5a1 1 0 0 0 1-1V9.7a1 1 0 0 0-1-1Z" fill="white" stroke="currentColor" stroke-width="1.4"/><path d="M39 16.5C39 11.6 42.1 9 47.1 9H55.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M51.3 5.2L55.1 9L51.3 12.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="47.1" cy="36" r="11" fill="white" stroke="currentColor" stroke-width="1.3"/></svg>`;

// Figma kit "Tray & shape glyphs": small dimensional sub-tool glyphs for the marker tray.
export const GLYPH = {
  marker: `<svg width="24" height="25" viewBox="0 0 24 25" fill="none"><path d="M7 10.2852H17L19 15.428V23.9994H5V15.428L7 10.2852Z" fill="#FAFAFA" stroke="#BDBDBD"/><path d="M12 3.42969L16 10.2868H8L12 3.42969Z" fill="#1E1E1E"/></svg>`,
  highlighter: `<svg width="24" height="25" viewBox="0 0 24 25" fill="none"><path d="M5 13.7148H19V24.0006H5V13.7148Z" fill="#FAFAFA" stroke="#BDBDBD"/><path d="M7 9.42969H17L18 13.7154H6L7 9.42969Z" fill="#F2F2F2" stroke="#BDBDBD"/><path d="M9.5 4.28516L14.5 5.99944V9.42801H9.5V4.28516Z" fill="#FFE600"/></svg>`,
  eraser: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M17 6.85547H7C5.89543 6.85547 5 7.62298 5 8.56975V22.284C5 23.2308 5.89543 23.9983 7 23.9983H17C18.1046 23.9983 19 23.2308 19 22.284V8.56975C19 7.62298 18.1046 6.85547 17 6.85547Z" fill="#E88A8A"/><path d="M17 6.85547H7C5.89543 6.85547 5 7.62298 5 8.56975V10.284C5 11.2308 5.89543 11.9983 7 11.9983H17C18.1046 11.9983 19 11.2308 19 10.284V8.56975C19 7.62298 18.1046 6.85547 17 6.85547Z" fill="#F5B1B1"/></svg>`,
};
