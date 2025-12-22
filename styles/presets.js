/**
 * Style Presets for Bot Sportello Arcade
 * CSS templates for website styling via /update-style command
 */

const stylePresets = {
    'soft-arcade': `/* Bot Sportello Arcade - Softer Retro Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Press Start 2P', cursive, monospace;
    background: linear-gradient(to bottom, #1a1d23 0%, #0f1419 100%);
    background-image:
        repeating-linear-gradient(
            0deg,
            transparent,
            transparent 49px,
            rgba(100, 200, 150, 0.08) 49px,
            rgba(100, 200, 150, 0.08) 50px
        ),
        repeating-linear-gradient(
            90deg,
            transparent,
            transparent 49px,
            rgba(100, 200, 150, 0.08) 49px,
            rgba(100, 200, 150, 0.08) 50px
        );
    background-size: 50px 50px;
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
    overflow-x: hidden;
}

@keyframes gridMove {
    0% { background-position: 0 0; }
    100% { background-position: 0 50px; }
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
}

header {
    text-align: center;
    color: #7dd3a0;
    margin-bottom: 50px;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

h1 {
    font-size: 2em;
    margin-bottom: 20px;
    line-height: 1.4;
}

.tagline {
    font-size: 0.6em;
    color: #95c9ad;
    margin-top: 10px;
    opacity: 0.85;
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 25px;
    margin-top: 30px;
}

.project-card {
    background: linear-gradient(135deg, #252a32 0%, #1d2228 100%);
    border: 2px solid #5a9d7a;
    border-radius: 8px;
    padding: 25px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    transition: all 0.3s ease;
    cursor: pointer;
    text-decoration: none;
    color: #7dd3a0;
    display: block;
    position: relative;
    overflow: hidden;
}

.project-card::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: linear-gradient(45deg, #5a9d7a, #7dd3a0, #5a9d7a);
    z-index: -1;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.project-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 20px rgba(93, 157, 122, 0.3);
    border-color: #7dd3a0;
}

.project-card:hover::before {
    opacity: 0.15;
}

.project-icon {
    font-size: 2.5em;
    margin-bottom: 15px;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.project-title {
    font-size: 0.9em;
    margin-bottom: 15px;
    color: #a8e6c1;
    line-height: 1.4;
}

.project-description {
    color: #95c9ad;
    line-height: 1.6;
    font-size: 0.5em;
    opacity: 0.9;
}

.add-project {
    background: linear-gradient(135deg, #2a4035 0%, #1f3028 100%);
    border-color: #6bb88f;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}

.add-project:hover {
    background: linear-gradient(135deg, #325442 0%, #2a4035 100%);
    box-shadow: 0 8px 20px rgba(107, 184, 143, 0.25);
}

footer {
    text-align: center;
    color: #95c9ad;
    margin-top: 60px;
    font-size: 0.5em;
    line-height: 1.8;
    opacity: 0.8;
}

footer a {
    color: #7dd3a0;
    text-decoration: none;
    transition: all 0.3s ease;
}

footer a:hover {
    color: #a8e6c1;
}

footer code {
    background: #252a32;
    padding: 3px 8px;
    border: 1px solid #5a9d7a;
    border-radius: 3px;
    color: #7dd3a0;
}

.refresh-btn {
    background: #252a32;
    color: #7dd3a0;
    border: 2px solid #5a9d7a;
    padding: 10px 20px;
    cursor: pointer;
    font-size: 0.6em;
    font-family: 'Press Start 2P', cursive;
    margin-top: 20px;
    transition: all 0.3s ease;
}

.refresh-btn:hover {
    background: #5a9d7a;
    color: #1a1d23;
    border-color: #7dd3a0;
    transform: translateY(-2px);
}

.refresh-btn:active {
    transform: translateY(0);
}

body::after {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.05) 0px,
        transparent 1px,
        transparent 2px,
        rgba(0, 0, 0, 0.05) 3px
    );
    pointer-events: none;
    z-index: 999;
}
`,

    'neon-arcade': `/* Bot Sportello Arcade - Intense Neon Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Press Start 2P', cursive, monospace;
    background: #0a0e0f;
    background-image:
        repeating-linear-gradient(
            0deg,
            transparent,
            transparent 49px,
            rgba(0, 255, 100, 0.15) 49px,
            rgba(0, 255, 100, 0.15) 50px
        );
    background-size: 50px 50px;
    animation: gridMove 2s linear infinite;
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
    overflow-x: hidden;
}

@keyframes gridMove {
    0% { background-position: 0 0; }
    100% { background-position: 0 50px; }
}

@keyframes glow {
    0%, 100% { text-shadow: 0 0 5px #00ff64, 0 0 10px #00ff64; }
    50% { text-shadow: 0 0 10px #00ff64, 0 0 20px #00ff64, 0 0 30px #00ff64; }
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
}

header {
    text-align: center;
    color: #00ff64;
    margin-bottom: 50px;
    animation: glow 2s ease-in-out infinite;
}

h1 {
    font-size: 2em;
    margin-bottom: 20px;
    line-height: 1.4;
}

.tagline {
    font-size: 0.6em;
    color: #00cc50;
    margin-top: 10px;
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 25px;
    margin-top: 30px;
}

.project-card {
    background: linear-gradient(135deg, #1a1d23 0%, #0f1419 100%);
    border: 3px solid #00ff64;
    border-radius: 8px;
    padding: 25px;
    box-shadow: 0 4px 20px rgba(0, 255, 100, 0.3);
    transition: all 0.3s ease;
    cursor: pointer;
    text-decoration: none;
    color: #00ff64;
    display: block;
}

.project-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 30px rgba(0, 255, 100, 0.5);
    border-color: #00ff88;
}

.project-icon {
    font-size: 2.5em;
    margin-bottom: 15px;
    filter: drop-shadow(0 0 10px #00ff64);
}

.project-title {
    font-size: 0.9em;
    margin-bottom: 15px;
    color: #00ff88;
    line-height: 1.4;
}

.project-description {
    color: #00cc50;
    line-height: 1.6;
    font-size: 0.5em;
}

footer {
    text-align: center;
    color: #00cc50;
    margin-top: 60px;
    font-size: 0.5em;
    line-height: 1.8;
}

footer a {
    color: #00ff64;
    text-decoration: none;
}

.refresh-btn {
    background: transparent;
    color: #00ff64;
    border: 2px solid #00ff64;
    padding: 10px 20px;
    cursor: pointer;
    font-size: 0.6em;
    font-family: 'Press Start 2P', cursive;
    margin-top: 20px;
    transition: all 0.3s ease;
}

.refresh-btn:hover {
    background: #00ff64;
    color: #0a0e0f;
}

body::after {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.15) 0px,
        transparent 2px
    );
    pointer-events: none;
    z-index: 999;
}
`,

    'dark-minimal': `/* Dark Minimal Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #0d0d0d;
    color: #e0e0e0;
    min-height: 100vh;
    padding: 40px 20px;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
}

header {
    text-align: center;
    color: #ffffff;
    margin-bottom: 60px;
}

h1 {
    font-size: 2.5em;
    margin-bottom: 20px;
    font-weight: 700;
    letter-spacing: -1px;
}

.tagline {
    font-size: 1em;
    color: #888;
    font-weight: 400;
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
    margin-top: 30px;
}

.project-card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    padding: 30px;
    transition: all 0.2s ease;
    cursor: pointer;
    text-decoration: none;
    color: #e0e0e0;
    display: block;
}

.project-card:hover {
    background: #222;
    border-color: #444;
    transform: translateY(-2px);
}

.project-icon {
    font-size: 2.5em;
    margin-bottom: 15px;
}

.project-title {
    font-size: 1.2em;
    margin-bottom: 10px;
    color: #fff;
    font-weight: 600;
}

.project-description {
    color: #999;
    line-height: 1.6;
    font-size: 0.9em;
}

footer {
    text-align: center;
    color: #666;
    margin-top: 80px;
    font-size: 0.9em;
}

footer a {
    color: #888;
    text-decoration: none;
}

footer a:hover {
    color: #aaa;
}

.refresh-btn {
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
    padding: 12px 24px;
    cursor: pointer;
    font-size: 0.9em;
    border-radius: 6px;
    margin-top: 20px;
    transition: all 0.2s ease;
}

.refresh-btn:hover {
    background: #222;
    border-color: #444;
}
`,

    'retro-terminal': `/* Retro Terminal Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Courier New', monospace;
    background: #000;
    color: #0f0;
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
}

body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 255, 0, 0.03) 0px,
        transparent 2px
    );
    pointer-events: none;
    z-index: 999;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
}

header {
    text-align: center;
    color: #0f0;
    margin-bottom: 50px;
    text-shadow: 0 0 5px #0f0;
}

h1 {
    font-size: 2em;
    margin-bottom: 20px;
}

h1::before {
    content: '> ';
}

.tagline {
    font-size: 0.9em;
    opacity: 0.8;
}

.tagline::before {
    content: '$ ';
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
    margin-top: 30px;
}

.project-card {
    background: #001100;
    border: 1px solid #0f0;
    padding: 20px;
    transition: all 0.2s ease;
    cursor: pointer;
    text-decoration: none;
    color: #0f0;
    display: block;
}

.project-card:hover {
    background: #002200;
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
}

.project-card::before {
    content: '[';
    margin-right: 5px;
}

.project-card::after {
    content: ']';
    margin-left: 5px;
}

.project-icon {
    font-size: 2em;
    margin-bottom: 10px;
}

.project-title {
    font-size: 1em;
    margin-bottom: 10px;
}

.project-title::before {
    content: '// ';
    opacity: 0.6;
}

.project-description {
    opacity: 0.8;
    line-height: 1.5;
    font-size: 0.85em;
}

footer {
    text-align: center;
    margin-top: 60px;
    font-size: 0.85em;
    opacity: 0.7;
}

footer a {
    color: #0f0;
    text-decoration: none;
}

.refresh-btn {
    background: transparent;
    color: #0f0;
    border: 1px solid #0f0;
    padding: 10px 20px;
    cursor: pointer;
    font-family: 'Courier New', monospace;
    margin-top: 20px;
    transition: all 0.2s ease;
}

.refresh-btn:hover {
    background: #0f0;
    color: #000;
}
`
};

/**
 * Get a style preset by name
 * @param {string} presetName - Name of the preset (soft-arcade, neon-arcade, dark-minimal, retro-terminal)
 * @returns {string|undefined} - CSS string or undefined if not found
 */
function getStylePreset(presetName) {
    return stylePresets[presetName];
}

/**
 * Get all available preset names
 * @returns {string[]} - Array of preset names
 */
function getPresetNames() {
    return Object.keys(stylePresets);
}

module.exports = {
    stylePresets,
    getStylePreset,
    getPresetNames
};
