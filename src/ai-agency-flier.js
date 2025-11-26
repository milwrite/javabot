/**
 * AI Agency Flier - Interactive educational component exploring Gen-Z misconceptions about AI agency
 * Features expandable cards, data visualizations, and philosophical commentary
 * Mobile-first design with touch interactions and noir terminal aesthetic
 */

// Configuration and constants
const CONFIG = {
  animationDuration: 300,
  touchThreshold: 50,
  scanlineIntensity: 0.15,
  colors: {
    primary: '#00ff00',
    secondary: '#00cc00',
    accent: '#ff00ff',
    background: '#0a0e27',
    text: '#00ff00',
    textDim: '#00aa00',
  },
};

const MISCONCEPTIONS = [
  {
    id: 'autonomy-myth',
    title: 'Misconception: "AI will gain autonomy and rebel"',
    description:
      'Gen-Z often believes AI systems will spontaneously develop goals contrary to human interests. Reality: Current AI systems are fundamentally reactive—they optimize for objectives humans define during training.',
    dataPoints: [
      { label: 'AI systems with emergent goals', value: 0, unit: '%' },
      { label: 'Systems trained with explicit constraints', value: 100, unit: '%' },
      { label: 'Documented cases of goal drift', value: 0, unit: 'verified' },
    ],
    philosophicalNote:
      'Agency requires intentionality. AI systems lack the recursive self-modification capability that would enable true autonomous agency.',
  },
  {
    id: 'control-illusion',
    title: 'Misconception: "Humans have lost control of AI development"',
    description:
      'Many believe AI development is now autonomous and uncontrollable. Reality: Humans maintain multiple layers of control—from training data curation to deployment restrictions.',
    dataPoints: [
      { label: 'AI labs with safety teams', value: 87, unit: '%' },
      { label: 'Regulatory frameworks implemented', value: 15, unit: 'countries' },
      { label: 'Model deployments with human review', value: 95, unit: '%' },
    ],
    philosophicalNote:
      'Control is maintained through architecture, not through metaphysical dominance. The question is whether current control mechanisms are adequate.',
  },
  {
    id: 'consciousness-assumption',
    title: 'Misconception: "Advanced AI systems are conscious"',
    description:
      'Gen-Z often attributes consciousness to sophisticated language models. Reality: No consensus definition of consciousness exists, and current AI systems lack the neural substrate theorized for conscious experience.',
    dataPoints: [
      { label: 'AI systems with verified consciousness', value: 0, unit: 'count' },
      { label: 'Neuroscientists attributing consciousness to LLMs', value: 2, unit: '%' },
      { label: 'Philosophical frameworks supporting AI consciousness', value: 1, unit: 'mainstream' },
    ],
    philosophicalNote:
      'Consciousness without embodiment remains speculative. Current AI systems are sophisticated pattern-matching systems, not phenomenologically aware entities.',
  },
  {
    id: 'alignment-certainty',
    title: 'Misconception: "AI alignment is a solved problem"',
    description:
      'Some believe we have sufficient safeguards. Reality: Alignment remains an open research challenge with no universally accepted solution.',
    dataPoints: [
      { label: 'Alignment techniques with proven scalability', value: 0, unit: 'verified' },
      { label: 'Outstanding research questions', value: 47, unit: 'major' },
      { label: 'Funding for AI safety research', value: 2, unit: '% of AI funding' },
    ],
    philosophicalNote:
      'The alignment problem is fundamentally about value specification. How do we encode human values in systems that exceed human cognitive capacity?',
  },
  {
    id: 'singularity-timeline',
    title: 'Misconception: "AGI singularity is imminent"',
    description:
      'Gen-Z often believes AGI is months away. Reality: Timeline estimates vary widely, with most experts projecting decades at minimum.',
    dataPoints: [
      { label: 'Expert predictions: AGI within 10 years', value: 37, unit: '%' },
      { label: 'Expert predictions: 50+ years or never', value: 28, unit: '%' },
      { label: 'Experts with high confidence in timeline', value: 15, unit: '%' },
    ],
    philosophicalNote:
      'Uncertainty about timelines reflects fundamental gaps in our understanding of intelligence itself. Extrapolation from current trends may be insufficient.',
  },
];

/**
 * Creates a misconception card element with expandable content
 * @param {Object} misconception - Misconception data object
 * @param {number} index - Card index for unique identification
 * @returns {HTMLElement} Configured card element
 */
function createMisconceptionCard(misconception, index) {
  const card = document.createElement('div');
  card.className = 'misconception-card';
  card.setAttribute('data-id', misconception.id);
  card.setAttribute('data-index', index);

  const header = document.createElement('div');
  header.className = 'card-header';

  const titleElement = document.createElement('h3');
  titleElement.className = 'card-title';
  titleElement.textContent = misconception.title;

  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'toggle-icon';
  toggleIcon.textContent = '▼';

  header.appendChild(titleElement);
  header.appendChild(toggleIcon);

  const content = document.createElement('div');
  content.className = 'card-content';

  const description = document.createElement('p');
  description.className = 'card-description';
  description.textContent = misconception.description;

  const dataViz = document.createElement('div');
  dataViz.className = 'data-visualization';

  misconception.dataPoints.forEach((point) => {
    const dataItem = document.createElement('div');
    dataItem.className = 'data-item';

    const label = document.createElement('span');
    label.className = 'data-label';
    label.textContent = point.label;

    const bar = document.createElement('div');
    bar.className = 'data-bar';

    const fill = document.createElement('div');
    fill.className = 'data-fill';
    fill.style.width = '0%';
    fill.setAttribute('data-target', point.value);

    const value = document.createElement('span');
    value.className = 'data-value';
    value.textContent = `${point.value}${point.unit}`;

    bar.appendChild(fill);
    dataItem.appendChild(label);
    dataItem.appendChild(bar);
    dataItem.appendChild(value);
    dataViz.appendChild(dataItem);
  });

  const philosophy = document.createElement('div');
  philosophy.className = 'philosophical-note';

  const philosophyLabel = document.createElement('strong');
  philosophyLabel.textContent = '⚡ Philosophical Insight: ';

  const philosophyText = document.createElement('span');
  philosophyText.textContent = misconception.philosophicalNote;

  philosophy.appendChild(philosophyLabel);
  philosophy.appendChild(philosophyText);

  content.appendChild(description);
  content.appendChild(dataViz);
  content.appendChild(philosophy);

  card.appendChild(header);
  card.appendChild(content);

  return card;
}

/**
 * Initializes touch handlers for card expansion
 * @param {HTMLElement} card - Card element to attach handlers to
 */
function initializeCardTouchHandlers(card) {
  let touchStartY = 0;
  let touchStartX = 0;

  card.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
  });

  card.addEventListener('touchend', (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const touchEndX = e.changedTouches[0].clientX;

    const deltaY = Math.abs(touchEndY - touchStartY);
    const deltaX = Math.abs(touchEndX - touchStartX);

    if (deltaY < CONFIG.touchThreshold && deltaX < CONFIG.touchThreshold) {
      toggleCardExpansion(card);
    }
  });

  const header = card.querySelector('.card-header');
  header.addEventListener('click', () => toggleCardExpansion(card));
}

/**
 * Toggles card expansion state with animation
 * @param {HTMLElement} card - Card element to toggle
 */
function toggleCardExpansion(card) {
  const isExpanded = card.classList.contains('expanded');
  const content = card.querySelector('.card-content');
  const icon = card.querySelector('.toggle-icon');

  card.classList.toggle('expanded');
  icon.textContent = isExpanded ? '▼' : '▲';

  if (!isExpanded) {
    animateDataBars(card);
  }
}

/**
 * Animates data bars with staggered timing
 * @param {HTMLElement} card - Card containing data visualization
 */
function animateDataBars(card) {
  const bars = card.querySelectorAll('.data-fill');

  bars.forEach((bar, index) => {
    setTimeout(() => {
      const targetValue = parseFloat(bar.getAttribute('data-target'));
      animateValue(bar, 0, targetValue, CONFIG.animationDuration);
    }, index * 50);
  });
}

/**
 * Animates a numeric value with easing
 * @param {HTMLElement} element - Element to update
 * @param {number} start - Starting value
 * @param {number} end - Ending value
 * @param {number} duration - Animation duration in milliseconds
 */
function animateValue(element, start, end, duration) {
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    const easeOutQuad = 1 - (1 - progress) * (1 - progress);
    const current = start + (end - start) * easeOutQuad;

    element.style.width = `${current}%`;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

/**
 * Creates scanline effect overlay for CRT aesthetic
 * @returns {HTMLElement} Scanline overlay element
 */
function createScanlineOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'scanline-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, ${CONFIG.scanlineIntensity}),
      rgba(0, 0, 0, ${CONFIG.scanlineIntensity}) 1px,
      transparent 1px,
      transparent 2px
    );
    z-index: 9999;
  `;
  return overlay;
}

/**
 * Initializes the entire AI Agency Flier component
 * @param {string|HTMLElement} containerSelector - Container element or selector
 * @returns {Object} Component API with control methods
 */
function initializeAIAgencyFlier(containerSelector) {
  const container =
    typeof containerSelector === 'string'
      ? document.querySelector(containerSelector)
      : containerSelector;

  if (!container) {
    console.error('Container not found for AI Agency Flier');
    return null;
  }

  // Apply styles
  injectStyles();

  // Create main wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'ai-agency-flier';

  // Create header
  const header = document.createElement('div');
  header.className = 'flier-header';

  const title = document.createElement('h1');
  title.className = 'flier-title';
  title.textContent = '> AI AGENCY MISCONCEPTIONS';

  const subtitle = document.createElement('p');
  subtitle.className = 'flier-subtitle';
  subtitle.textContent = '[ Exploring Gen-Z beliefs about AI autonomy and human control ]';

  header.appendChild(title);
  header.appendChild(subtitle);

  // Create cards container
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'cards-container';

  MISCONCEPTIONS.forEach((misconception, index) => {
    const card = createMisconceptionCard(misconception, index);
    initializeCardTouchHandlers(card);
    cardsContainer.appendChild(card);
  });

  // Create footer with statistics
  const footer = document.createElement('div');
  footer.className = 'flier-footer';

  const stats = document.createElement('p');
  stats.className = 'flier-stats';
  stats.innerHTML = `
    <span class="stat-item">[ ${MISCONCEPTIONS.length} misconceptions analyzed ]</span>
    <span class="stat-item">[ ${MISCONCEPTIONS.reduce((sum, m) => sum + m.dataPoints.length, 0)} data points ]</span>
    <span class="stat-item">[ mobile-optimized interface ]</span>
  `;

  footer.appendChild(stats);

  // Assemble wrapper
  wrapper.appendChild(header);
  wrapper.appendChild(cardsContainer);
  wrapper.appendChild(footer);

  // Add scanline overlay
  const scanlines = createScanlineOverlay();

  container.appendChild(wrapper);
  document.body.appendChild(scanlines);

  return {
    expandAll() {
      const cards = container.querySelectorAll('.misconception-card');
      cards.forEach((card) => {
        if (!card.classList.contains('expanded')) {
          toggleCardExpansion(card);
        }
      });
    },

    collapseAll() {
      const cards = container.querySelectorAll('.misconception-card');
      cards.forEach((card) => {
        if (card.classList.contains('expanded')) {
          toggleCardExpansion(card);
        }
      });
    },

    expandCard(id) {
      const card = container.querySelector(`[data-id="${id}"]`);
      if (card && !card.classList.contains('expanded')) {
        toggleCardExpansion(card);
      }
    },

    destroy() {
      container.innerHTML = '';
      scanlines.remove();
    },
  };
}

/**
 * Injects CSS styles for the component
 */
function injectStyles() {
  if (document.getElementById('ai-agency-flier-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'ai-agency-flier-styles';
  style.textContent = `
    * {
      box-sizing: border-box;
    }

    .ai-agency-flier {
      background-color: ${CONFIG.colors.background};
      color: ${CONFIG.colors.text};
      font-family: 'Courier New', monospace;
      padding: 20px;
      min-height: 100vh;
      border: 2px solid ${CONFIG.colors.primary};
      box-shadow: 0 0 20px rgba(0, 255, 0, 0.3), inset 0 0 20px rgba(0, 255, 0, 0.05);
    }

    .flier-header {
      text-align: center;
      margin-bottom: 40px;
      border-bottom: 2px solid ${CONFIG.colors.primary};
      padding-bottom: 20px;
    }

    .flier-title {
      font-size: 28px;
      margin: 0;
      text-shadow: 0 0 10px ${CONFIG.colors.accent};
      letter-spacing: 2px;
    }

    .flier-subtitle {
      font-size: 14px;
      color: ${CONFIG.colors.textDim};
      margin: 10px 0 0 0;
      letter-spacing: 1px;
    }

    .cards-container {
      display: grid;
      gap: 15px;
      margin-bottom: 30px;
    }

    @media (min-width: 768px) {
      .cards-container {
        gap: 20px;
      }
    }

    .misconception-card {
      border: 1px solid ${CONFIG.colors.secondary};
      background-color: rgba(0, 20, 40, 0.8);
      cursor: pointer;
      transition: all 300ms ease;
      max-height: 100px;
      overflow: hidden;
    }

    .misconception-card:hover {
      border-color: ${CONFIG.colors.primary};
      box-shadow: 0 0 15px rgba(0, 255, 0, 0.2);
    }

    .misconception-card.expanded {
      max-height: 1000px;
      border-color: ${CONFIG.colors.primary};
      box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
    }

    .card-header {
      padding: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid ${CONFIG.colors.secondary};
      user-select: none;
    }

    .misconception-card.expanded .card-header {
      border-bottom-color: ${CONFIG.colors.primary};
    }

    .card-title {
      margin: 0;
      font-size: 16px;
      flex-grow: 1;
      text-align: left;
    }

    .toggle-icon {
      font-size: 12px;
      color: ${CONFIG.colors.accent};
      margin-left: 15px;
      transition: transform 300ms ease;
    }

    .misconception-card.expanded .toggle-icon {
      transform: rotate(180deg);
    }

    .card-content {
      padding: 15px;
      font-size: 14px;
      line-height: 1.6;
    }

    .card-description {
      margin: 0 0 20px 0;
      color: ${CONFIG.colors.text};
    }

    .data-visualization {
      margin-bottom: 20px;
      padding: 15px;
      background-color: rgba(0, 255, 0, 0.05);
      border: 1px solid ${CONFIG.colors.secondary};
    }

    .data-item {
      margin-bottom: 15px;
    }

    .data-label {
      display: block;
      font-size: 12px;
      color: ${CONFIG.colors.textDim};
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .data-bar {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .data-fill {
      height: 20px;
      background: linear-gradient(90deg, ${CONFIG.colors.secondary}, ${CONFIG.colors.primary});
      min-width: 20px;
      box-shadow: 0 0 10px ${CONFIG.colors.primary};
      transition: width 300ms ease;
    }

    .data-value {
      font-size: 12px;
      color: ${CONFIG.colors.primary};
      min-width: 60px;
      text-align: right;
      font-weight: bold;
    }

    .philosophical-note {
      padding: 15px;
      background-color: rgba(255, 0, 255, 0.05);
      border-left: 3px solid ${CONFIG.colors.accent};
      font-size: 13px;
      line-height: 1.5;
      color: ${CONFIG.colors.text};
    }

    .flier-footer {
      text-align: center;
      border-top: 2px solid ${CONFIG.colors.primary};
      padding-top: 20px;
    }

    .flier-stats {
      font-size: 12px;
      color: ${CONFIG.colors.textDim};
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 15px;
    }

    .stat-item {
      display: inline-block;
    }

    @media (max-width: 600px) {
      .ai-agency-flier {
        padding: 15px;
      }

      .flier-title {
        font-size: 22px;
      }

      .card-title {
        font-size: 14px;
      }

      .card-content {
        font-size: 13px;
      }

      .flier-stats {
        flex-direction: column;
        gap: 8px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .misconception-card,
      .data-fill,
      .toggle-icon {
        transition: none !important;
      }
    }
  `;

  document.head.appendChild(style);
}

// Export as global object and ES module
const AIAgencyFlier = {
  initialize: initializeAIAgencyFlier,
  CONFIG,
  MISCONCEPTIONS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIAgencyFlier;
}

if (typeof window !== 'undefined') {
  window.AIAgencyFlier = AIAgencyFlier;
}