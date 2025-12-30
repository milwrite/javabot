/**
 * Reusable Components Module
 * Audio components and other reusable page elements
 * Extracted from systemPrompt.js lines 273-279
 */

module.exports = `REUSABLE AUDIO COMPONENTS (src/audio/):

- sportello-ambient.js: Ambient sound mixer with synthesized sounds (rain, ocean, wind, fire, whitenoise, heartbeat, chimes, drone). Use for sleep pages, meditation, relaxation, or atmospheric backgrounds.
  Usage: <script src="audio/sportello-ambient.js"></script>
  SportelloAmbient.init({ container: '#controls', sounds: ['rain', 'ocean'], timer: true, theme: 'sleep' });

- sportello-narrator.js: Text-to-speech narrator for stories. Uses Ralph voice (Bot Sportello's voice).
  Usage: <script src="audio/sportello-narrator.js"></script>
  SportelloNarrator.init({ selector: '.paragraph', rate: 0.85 });`;
