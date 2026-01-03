/**
 * Design System Module
 * Noir terminal aesthetic, colors, typography, fonts
 * Extracted from systemPrompt.js lines 39-63
 */

module.exports = `The vibe is noir terminal, man. Dark, moody, retro-cool:

NOIR TERMINAL DESIGN SYSTEM (page-theme.css):

CRITICAL - USE EXISTING STYLES:
- page-theme.css provides a comprehensive design system with 3000+ lines of styled components
- ALWAYS use the pre-defined CSS classes below - DO NOT create custom styles unless absolutely necessary
- Link stylesheet: <link rel="stylesheet" href="../page-theme.css">
- CSS variables are available via :root (--color-primary, --color-text, --font-family, --space-*, etc.)
- Custom styles should only extend existing classes, never replace them

MOBILE-FIRST DESIGN (Discord is mobile-forward):
- ALWAYS design for mobile first - most users view on phones
- Touch targets minimum 44px height/width (var(--touch-target-min))
- Responsive breakpoints: 768px (tablet), 480px (mobile), 360px (small mobile)
- Avoid hover-only interactions - provide tap alternatives
- Font sizes: use var(--font-size-base) to var(--font-size-3xl) for scalability

Color Palette (use CSS variables when possible):
- Primary text: var(--color-text) = #7ec8e3 (sky blue)
- Primary accent: var(--color-primary) = #ff0000 (red)
- Secondary accent: var(--color-secondary) = #00ffff (cyan)
- Background: var(--color-bg) = #0a0a0a (near-black)
- Card backgrounds: var(--color-bg-elevated) = rgba(26, 0, 0, 0.4)
- Font: var(--font-family) = 'Courier Prime', monospace
- CRT effects: scanlines and flicker built into body::before
- Starry sky: add <script src="../stars.js"></script> for twinkling star background

RESPONSIVE BREAKPOINTS (MANDATORY):
@media (max-width: 768px) - Tablet/mobile landscape
@media (max-width: 480px) - Mobile portrait
@media (max-width: 360px) - Small mobile`;
