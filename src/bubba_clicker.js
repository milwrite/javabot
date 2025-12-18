/**
 * Bubba Clicker - A modular clicker game about Bubba the Horse
 * Features multiple game phases, upgrades, mysterious encounters, and noir aesthetics
 */

const BubbaClicker = (() => {
  // Game state
  let gameState = {
    clicks: 0,
    money: 0,
    fame: 0,
    sanity: 100,
    phase: 'humble', // humble, rising, peak, darkness, revelation
    upgrades: {},
    encounters: [],
    stats: {
      totalClicks: 0,
      totalMoney: 0,
      upgradesOwned: 0,
      encountersTriggered: 0,
    },
    lastClickTime: 0,
    clickMultiplier: 1,
  };

  // Game configuration
  const CONFIG = {
    phases: {
      humble: {
        name: 'Humble Beginnings',
        clickValue: 1,
        fameMultiplier: 0.1,
        description: 'A simple horse in a simple field...',
      },
      rising: {
        name: 'Rising Star',
        clickValue: 5,
        fameMultiplier: 0.5,
        description: 'The world begins to notice Bubba...',
        threshold: 1000,
      },
      peak: {
        name: 'Peak Fame',
        clickValue: 25,
        fameMultiplier: 2,
        description: 'Bubba is everywhere. Everyone knows Bubba.',
        threshold: 10000,
      },
      darkness: {
        name: 'Descent into Darkness',
        clickValue: 50,
        fameMultiplier: -1,
        description: 'The fame... it consumes everything...',
        threshold: 50000,
      },
      revelation: {
        name: 'The Truth Revealed',
        clickValue: 100,
        fameMultiplier: 0,
        description: 'Was Bubba ever real?',
        threshold: 100000,
      },
    },
    upgrades: {
      sugar_cubes: {
        name: 'Sugar Cubes',
        cost: 50,
        effect: 1.2,
        description: 'Bubba loves treats',
        phase: 'humble',
      },
      fancy_saddle: {
        name: 'Fancy Saddle',
        cost: 500,
        effect: 1.5,
        description: 'Style points matter',
        phase: 'rising',
      },
      agent: {
        name: 'Hollywood Agent',
        cost: 5000,
        effect: 2,
        description: 'Someone believes in Bubba',
        phase: 'rising',
      },
      pr_firm: {
        name: 'PR Firm',
        cost: 25000,
        effect: 3,
        description: 'Control the narrative',
        phase: 'peak',
      },
      dark_ritual: {
        name: 'Dark Ritual',
        cost: 75000,
        effect: 5,
        description: 'Some prices are too high...',
        phase: 'darkness',
      },
      existential_pill: {
        name: 'Existential Pill',
        cost: 150000,
        effect: 10,
        description: 'Embrace the void',
        phase: 'revelation',
      },
    },
    encounters: {
      paparazzi: {
        name: 'Paparazzi Encounter',
        phase: 'rising',
        threshold: 2000,
        effect: (state) => ({
          fame: state.fame + 500,
          sanity: state.sanity - 10,
        }),
        message: 'The cameras never stop flashing...',
      },
      fan_club: {
        name: 'Fan Club Formation',
        phase: 'peak',
        threshold: 20000,
        effect: (state) => ({
          money: state.money + 10000,
          sanity: state.sanity - 5,
        }),
        message: 'They worship you now. Is that what you wanted?',
      },
      shadow_figure: {
        name: 'Shadow Figure',
        phase: 'darkness',
        threshold: 60000,
        effect: (state) => ({
          sanity: state.sanity - 30,
          fame: state.fame + 5000,
        }),
        message: 'Something whispers in the dark... it knows your name...',
      },
      the_truth: {
        name: 'The Truth',
        phase: 'revelation',
        threshold: 120000,
        effect: (state) => ({
          sanity: state.sanity - 50,
          fame: 0,
          money: state.money * 0.5,
        }),
        message: 'Bubba was never real. You were always clicking at nothing.',
      },
    },
  };

  /**
   * Initialize the game
   * @returns {Object} Initial game state
   */
  const init = () => {
    gameState = {
      clicks: 0,
      money: 0,
      fame: 0,
      sanity: 100,
      phase: 'humble',
      upgrades: {},
      encounters: [],
      stats: {
        totalClicks: 0,
        totalMoney: 0,
        upgradesOwned: 0,
        encountersTriggered: 0,
      },
      lastClickTime: 0,
      clickMultiplier: 1,
    };

    // Initialize upgrades
    Object.keys(CONFIG.upgrades).forEach((key) => {
      gameState.upgrades[key] = 0;
    });

    render();
    return gameState;
  };

  /**
   * Handle a click on Bubba
   * @returns {Object} Updated game state
   */
  const click = () => {
    const phaseConfig = CONFIG.phases[gameState.phase];
    const clickValue = phaseConfig.clickValue * gameState.clickMultiplier;

    gameState.clicks += clickValue;
    gameState.money += clickValue;
    gameState.fame += phaseConfig.fameMultiplier;
    gameState.stats.totalClicks += 1;
    gameState.stats.totalMoney += clickValue;
    gameState.lastClickTime = Date.now();

    // Check for phase transitions
    checkPhaseTransition();

    // Check for encounters
    checkEncounters();

    // Sanity drain increases with fame
    if (gameState.fame > 0) {
      gameState.sanity = Math.max(0, gameState.sanity - 0.01);
    }

    render();
    return gameState;
  };

  /**
   * Check if game phase should transition
   */
  const checkPhaseTransition = () => {
    const phases = ['humble', 'rising', 'peak', 'darkness', 'revelation'];
    const currentPhaseIndex = phases.indexOf(gameState.phase);

    if (currentPhaseIndex < phases.length - 1) {
      const nextPhase = phases[currentPhaseIndex + 1];
      const threshold = CONFIG.phases[nextPhase].threshold;

      if (gameState.money >= threshold) {
        gameState.phase = nextPhase;
        addLog(`Phase transition: ${CONFIG.phases[nextPhase].name}`);
      }
    }
  };

  /**
   * Check for random encounters
   */
  const checkEncounters = () => {
    Object.values(CONFIG.encounters).forEach((encounter) => {
      if (
        encounter.phase === gameState.phase &&
        gameState.money >= encounter.threshold &&
        !gameState.encounters.includes(encounter.name)
      ) {
        // 5% chance per click once threshold is reached
        if (Math.random() < 0.05) {
          triggerEncounter(encounter);
        }
      }
    });
  };

  /**
   * Trigger an encounter
   * @param {Object} encounter - The encounter to trigger
   */
  const triggerEncounter = (encounter) => {
    const effects = encounter.effect(gameState);
    Object.assign(gameState, effects);
    gameState.encounters.push(encounter.name);
    gameState.stats.encountersTriggered += 1;
    addLog(`[ENCOUNTER] ${encounter.message}`);
  };

  /**
   * Purchase an upgrade
   * @param {string} upgradeKey - The upgrade key to purchase
   * @returns {boolean} Whether purchase was successful
   */
  const buyUpgrade = (upgradeKey) => {
    const upgrade = CONFIG.upgrades[upgradeKey];

    if (!upgrade) {
      addLog('ERROR: Upgrade not found');
      return false;
    }

    if (gameState.money < upgrade.cost) {
      addLog('Insufficient funds for ' + upgrade.name);
      return false;
    }

    if (upgrade.phase !== gameState.phase && upgrade.phase !== 'humble') {
      addLog(
        'This upgrade is not available in your current phase: ' +
          gameState.phase
      );
      return false;
    }

    gameState.money -= upgrade.cost;
    gameState.upgrades[upgradeKey] = (gameState.upgrades[upgradeKey] || 0) + 1;
    gameState.clickMultiplier *= upgrade.effect;
    gameState.stats.upgradesOwned += 1;

    addLog(`Purchased ${upgrade.name}`);
    render();
    return true;
  };

  /**
   * Get current game stats
   * @returns {Object} Current game statistics
   */
  const getStats = () => {
    return {
      ...gameState,
      phase: CONFIG.phases[gameState.phase].name,
      phaseDescription: CONFIG.phases[gameState.phase].description,
    };
  };

  /**
   * Get available upgrades for current phase
   * @returns {Array} Available upgrades
   */
  const getAvailableUpgrades = () => {
    return Object.entries(CONFIG.upgrades)
      .filter(([, upgrade]) => {
        return (
          upgrade.phase === gameState.phase || upgrade.phase === 'humble'
        );
      })
      .map(([key, upgrade]) => ({
        key,
        ...upgrade,
        owned: gameState.upgrades[key] || 0,
        affordable: gameState.money >= upgrade.cost,
      }));
  };

  /**
   * Game log for messages
   */
  let gameLog = [];

  /**
   * Add message to game log
   * @param {string} message - Message to add
   */
  const addLog = (message) => {
    gameLog.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
    if (gameLog.length > 20) {
      gameLog.pop();
    }
  };

  /**
   * Get game log
   * @returns {Array} Recent game messages
   */
  const getLog = () => gameLog;

  /**
   * Render the game UI
   */
  const render = () => {
    const container = document.getElementById('bubba-game');
    if (!container) return;

    const stats = getStats();
    const upgrades = getAvailableUpgrades();

    container.innerHTML = `
      <div class="bubba-container">
        <div class="bubba-header">
          <h1 class="bubba-title">BUBBA CLICKER</h1>
          <div class="phase-indicator">${stats.phaseDescription}</div>
        </div>

        <div class="bubba-main">
          <div class="bubba-stats">
            <div class="stat-row">
              <span class="stat-label">CLICKS:</span>
              <span class="stat-value">${Math.floor(stats.clicks)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">MONEY:</span>
              <span class="stat-value">$${Math.floor(stats.money)}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">FAME:</span>
              <span class="stat-value">${Math.floor(stats.fame)}</span>
            </div>
            <div class="stat-row sanity-low">
              <span class="stat-label">SANITY:</span>
              <span class="stat-value">${Math.floor(stats.sanity)}%</span>
            </div>
          </div>

          <button id="bubba-button" class="bubba-button">
            <div class="bubba-horse">🐴</div>
            <div class="click-text">CLICK BUBBA</div>
          </button>

          <div class="bubba-upgrades">
            <h2>UPGRADES</h2>
            ${upgrades
              .map(
                (upgrade) => `
              <button class="upgrade-btn ${upgrade.affordable ? '' : 'disabled'}" 
                      data-upgrade="${upgrade.key}">
                <div class="upgrade-name">${upgrade.name}</div>
                <div class="upgrade-cost">Cost: $${upgrade.cost}</div>
                <div class="upgrade-owned">Owned: ${upgrade.owned}</div>
              </button>
            `
              )
              .join('')}
          </div>

          <div class="bubba-log">
            <h3>TERMINAL LOG</h3>
            ${getLog()
              .map((msg) => `<div class="log-entry">${msg}</div>`)
              .join('')}
          </div>
        </div>
      </div>
    `;

    // Attach event listeners
    const bubbaButton = document.getElementById('bubba-button');
    if (bubbaButton) {
      bubbaButton.addEventListener('click', click);
      bubbaButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        click();
      });
    }

    const upgradeButtons = container.querySelectorAll('.upgrade-btn:not(.disabled)');
    upgradeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buyUpgrade(btn.dataset.upgrade);
      });
    });
  };

  /**
   * Initialize CSS styles for the game
   */
  const initStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
      }

      .bubba-container {
        background: #0a0e27;
        color: #00ff00;
        font-family: 'Courier New', monospace;
        min-height: 100vh;
        padding: 20px;
        overflow: hidden;
        position: relative;
      }

      .bubba-container::before {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: 
          repeating-linear-gradient(
            0deg,
            rgba(0, 255, 0, 0.03) 0px,
            rgba(0, 255, 0, 0.03) 1px,
            transparent 1px,
            transparent 2px
          );
        pointer-events: none;
        z-index: 1;
      }

      .bubba-header {
        text-align: center;
        margin-bottom: 30px;
        position: relative;
        z-index: 2;
      }

      .bubba-title {
        font-size: 3em;
        margin: 0;
        text-shadow: 0 0 10px #00ff00;
        letter-spacing: 3px;
        animation: flicker 0.15s infinite;
      }

      .phase-indicator {
        font-size: 1.2em;
        margin-top: 10px;
        color: #00aa00;
        text-shadow: 0 0 5px #00ff00;
      }

      .bubba-main {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 30px;
        max-width: 1200px;
        margin: 0 auto;
        position: relative;
        z-index: 2;
      }

      .bubba-stats {
        background: rgba(0, 20, 40, 0.8);
        border: 2px solid #00ff00;
        padding: 20px;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.2) inset;
      }

      .stat-row {
        display: flex;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid #003300;
        font-size: 1.1em;
      }

      .stat-row.sanity-low {
        color: #ff0000;
        text-shadow: 0 0 5px #ff0000;
      }

      .stat-label {
        font-weight: bold;
      }

      .stat-value {
        text-align: right;
      }

      .bubba-button {
        grid-column: 1;
        background: linear-gradient(135deg, #001a00 0%, #003300 100%);
        border: 3px solid #00ff00;
        color: #00ff00;
        font-size: 2em;
        padding: 40px;
        cursor: pointer;
        transition: all 0.1s;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        font-family: 'Courier New', monospace;
        font-weight: bold;
      }

      .bubba-button:hover {
        transform: scale(1.05);
        box-shadow: 0 0 30px rgba(0, 255, 0, 0.5);
      }

      .bubba-button:active {
        transform: scale(0.98);
        box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
      }

      .bubba-horse {
        font-size: 4em;
        animation: bounce 0.3s ease-in-out;
      }

      .bubba-button:active .bubba-horse {
        animation: bounce 0.1s ease-in-out;
      }

      .click-text {
        font-size: 1.2em;
      }

      .bubba-upgrades {
        grid-column: 2;
        background: rgba(0, 20, 40, 0.8);
        border: 2px solid #00ff00;
        padding: 20px;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.2) inset;
        overflow-y: auto;
        max-height: 500px;
      }

      .bubba-upgrades h2 {
        margin-top: 0;
        text-shadow: 0 0 5px #00ff00;
      }

      .upgrade-btn {
        width: 100%;
        background: rgba(0, 40, 20, 0.6);
        border: 1px solid #00aa00;
        color: #00ff00;
        padding: 10px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
        font-family: 'Courier New', monospace;
      }

      .upgrade-btn:hover:not(.disabled) {
        background: rgba(0, 80, 40, 0.8);
        box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
        transform: translateX(5px);
      }

      .upgrade-btn.disabled {
        opacity: 0.3;
        cursor: not-allowed;
        color: #666666;
      }

      .upgrade-name {
        font-weight: bold;
      }

      .upgrade-cost,
      .upgrade-owned {
        font-size: 0.9em;
        color: #00aa00;
      }

      .bubba-log {
        grid-column: 1 / -1;
        background: rgba(0, 20, 40, 0.8);
        border: 2px solid #00ff00;
        padding: 20px;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.2) inset;
        max-height: 200px;
        overflow-y: auto;
      }

      .bubba-log h3 {
        margin-top: 0;
        text-shadow: 0 0 5px #00ff00;
      }

      .log-entry {
        padding: 3px 0;
        font-size: 0.9em;
        color: #00ff00;
        border-bottom: 1px solid #003300;
      }

      @keyframes flicker {
        0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% {
          text-shadow: 0 0 10px #00ff00;
        }
        20%, 24%, 55% {
          text-shadow: 0 0 5px #00ff00;
        }
      }

      @keyframes bounce {
        0%, 100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-10px);
        }
      }

      @media (max-width: 768px) {
        .bubba-main {
          grid-template-columns: 1fr;
        }

        .bubba-upgrades {
          grid-column: 1;
        }

        .bubba-log {
          grid-column: 1;
        }

        .bubba-title {
          font-size: 2em;
        }

        .bubba-button {
          padding: 30px;
        }

        .bubba-horse {
          font-size: 3em;
        }
      }

      /* Scrollbar styling */
      .bubba-upgrades::-webkit-scrollbar,
      .bubba-log::-webkit-scrollbar {
        width: 8px;
      }

      .bubba-upgrades::-webkit-scrollbar-track,
      .bubba-log::-webkit-scrollbar-track {
        background: rgba(0, 20, 40, 0.5);
      }

      .bubba-upgrades::-webkit-scrollbar-thumb,
      .bubba-log::-webkit-scrollbar-thumb {
        background: #00ff00;
        border-radius: 4px;
      }

      .bubba-upgrades::-webkit-scrollbar-thumb:hover,
      .bubba-log::-webkit-scrollbar-thumb:hover {
        background: #00aa00;
      }
    `;

    document.head.appendChild(style);
  };

  /**
   * Mount the game to a DOM element
   * @param {string} elementId - ID of the container element
   */
  const mount = (elementId = 'bubba-game') => {
    let container = document.getElementById(elementId);

    if (!container) {
      container = document.createElement('div');
      container.id = elementId;
      document.body.appendChild(container);
    }

    initStyles();
    init();
  };

  // Public API
  return {
    init,
    click,
    buyUpgrade,
    getStats,
    getAvailableUpgrades,
    getLog,
    mount,
    render,
  };
})();

// Export for use in modules or globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BubbaClicker;
} else if (typeof window !== 'undefined') {
  window.BubbaClicker = BubbaClicker;
}