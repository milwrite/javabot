/**
 * Parlay Probability Visualizer
 * Interactive visualization showing how parlay probabilities decrease exponentially
 */

const ParlayProbabilityViz = (() => {
  /**
   * Calculate parlay probability
   * @param {number} individualProbability - Win probability for each leg (0-1)
   * @param {number} numLegs - Number of legs in the parlay
   * @returns {number} Combined parlay probability (0-1)
   */
  function calculateParlayProbability(individualProbability, numLegs) {
    if (individualProbability < 0 || individualProbability > 1) {
      throw new Error('Individual probability must be between 0 and 1');
    }
    if (numLegs < 1 || !Number.isInteger(numLegs)) {
      throw new Error('Number of legs must be a positive integer');
    }
    return Math.pow(individualProbability, numLegs);
  }

  /**
   * Convert probability to decimal odds
   * @param {number} probability - Probability value (0-1)
   * @returns {number} Decimal odds
   */
  function probabilityToOdds(probability) {
    if (probability <= 0 || probability > 1) {
      return Infinity;
    }
    return 1 / probability;
  }

  /**
   * Convert probability to American odds
   * @param {number} probability - Probability value (0-1)
   * @returns {number} American odds
   */
  function probabilityToAmericanOdds(probability) {
    if (probability <= 0 || probability > 1) {
      return Infinity;
    }
    if (probability >= 0.5) {
      return -100 * probability / (1 - probability);
    } else {
      return 100 * (1 - probability) / probability;
    }
  }

  /**
   * Format American odds for display
   * @param {number} odds - American odds value
   * @returns {string} Formatted odds string
   */
  function formatAmericanOdds(odds) {
    if (!isFinite(odds)) {
      return 'N/A';
    }
    if (odds > 0) {
      return `+${Math.round(odds)}`;
    } else {
      return Math.round(odds).toString();
    }
  }

  /**
   * Generate visualization data for parlay probabilities
   * @param {number} individualProbability - Win probability for each leg (0-1)
   * @param {number} maxLegs - Maximum number of legs to calculate
   * @returns {Array} Array of objects containing leg data
   */
  function generateParlayData(individualProbability, maxLegs = 10) {
    const data = [];
    for (let i = 1; i <= maxLegs; i++) {
      const parlayProb = calculateParlayProbability(individualProbability, i);
      const percentage = parlayProb * 100;
      const decimalOdds = probabilityToOdds(parlayProb);
      const americanOdds = probabilityToAmericanOdds(parlayProb);

      data.push({
        legs: i,
        probability: parlayProb,
        percentage: percentage,
        decimalOdds: decimalOdds,
        americanOdds: americanOdds,
        barWidth: Math.max(percentage, 0.5)
      });
    }
    return data;
  }

  /**
   * Create HTML for the visualization
   * @param {number} individualProbability - Win probability for each leg (0-1)
   * @param {number} numLegs - Number of legs to visualize
   * @returns {string} HTML string for the visualization
   */
  function createVisualizationHTML(individualProbability = 0.55, numLegs = 5) {
    const data = generateParlayData(individualProbability, Math.min(numLegs, 15));
    const maxPercentage = 100;

    let html = `
      <div class="parlay-viz-container">
        <div class="parlay-controls">
          <div class="control-group">
            <label for="individual-prob">Individual Win Probability:</label>
            <input type="range" id="individual-prob" min="0.01" max="0.99" step="0.01" value="${individualProbability}" />
            <span class="prob-display">${(individualProbability * 100).toFixed(1)}%</span>
          </div>
          <div class="control-group">
            <label for="num-legs">Number of Legs:</label>
            <input type="range" id="num-legs" min="1" max="15" step="1" value="${numLegs}" />
            <span class="legs-display">${numLegs}</span>
          </div>
        </div>
        
        <div class="parlay-chart">
          <h3>Parlay Probability Breakdown</h3>
          <table class="parlay-table">
            <thead>
              <tr>
                <th>Legs</th>
                <th>Probability</th>
                <th>Decimal Odds</th>
                <th>American Odds</th>
                <th>Visual</th>
              </tr>
            </thead>
            <tbody>
    `;

    data.forEach((item) => {
      const barColor = item.percentage > 50 ? '#4CAF50' :
                      item.percentage > 10 ? '#FFC107' :
                      item.percentage > 1 ? '#FF9800' : '#F44336';

      html += `
        <tr>
          <td class="legs-cell">${item.legs}</td>
          <td class="prob-cell">${item.percentage.toFixed(2)}%</td>
          <td class="odds-cell">${item.decimalOdds.toFixed(2)}</td>
          <td class="american-odds-cell">${formatAmericanOdds(item.americanOdds)}</td>
          <td class="bar-cell">
            <div class="probability-bar-container">
              <div class="probability-bar" style="width: ${Math.min(item.barWidth, 100)}%; background-color: ${barColor};"></div>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
        </div>
        
        <style>
          .parlay-viz-container {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            max-width: 900px;
            margin: 20px auto;
            padding: 20px;
            background: #f5f5f5;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }

          .parlay-controls {
            display: flex;
            gap: 30px;
            margin-bottom: 30px;
            flex-wrap: wrap;
          }

          .control-group {
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .control-group label {
            font-weight: 500;
            color: #333;
            min-width: 200px;
          }

          .control-group input[type="range"] {
            width: 150px;
            cursor: pointer;
          }

          .prob-display, .legs-display {
            font-weight: 600;
            color: #2196F3;
            min-width: 50px;
            text-align: right;
          }

          .parlay-chart {
            background: white;
            border-radius: 6px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          }

          .parlay-chart h3 {
            margin: 0 0 20px 0;
            color: #333;
            font-size: 18px;
          }

          .parlay-table {
            width: 100%;
            border-collapse: collapse;
          }

          .parlay-table thead {
            background: #f0f0f0;
            border-bottom: 2px solid #ddd;
          }

          .parlay-table th {
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: #333;
            font-size: 14px;
          }

          .parlay-table td {
            padding: 12px;
            border-bottom: 1px solid #eee;
            font-size: 14px;
          }

          .parlay-table tbody tr:hover {
            background: #f9f9f9;
          }

          .legs-cell {
            font-weight: 600;
            color: #2196F3;
            width: 50px;
          }

          .prob-cell {
            font-weight: 500;
            width: 100px;
          }

          .odds-cell, .american-odds-cell {
            width: 120px;
            font-family: 'Courier New', monospace;
          }

          .bar-cell {
            width: 200px;
          }

          .probability-bar-container {
            width: 100%;
            height: 24px;
            background: #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
            position: relative;
          }

          .probability-bar {
            height: 100%;
            transition: width 0.3s ease, background-color 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding-right: 4px;
            color: white;
            font-size: 12px;
            font-weight: 600;
          }

          .probability-bar::after {
            content: attr(data-label);
          }

          @media (max-width: 768px) {
            .parlay-controls {
              flex-direction: column;
              gap: 15px;
            }

            .control-group {
              flex-direction: column;
              align-items: flex-start;
            }

            .control-group label {
              min-width: auto;
            }

            .parlay-table {
              font-size: 12px;
            }

            .parlay-table th, .parlay-table td {
              padding: 8px;
            }
          }
        </style>
      </div>
    `;

    return html;
  }

  /**
   * Initialize the visualization with event handlers
   * @param {string} containerId - ID of the container element
   * @param {number} initialIndividualProb - Initial individual probability
   * @param {number} initialNumLegs - Initial number of legs
   */
  function init(containerId, initialIndividualProb = 0.55, initialNumLegs = 5) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container with ID '${containerId}' not found`);
    }

    container.innerHTML = createVisualizationHTML(initialIndividualProb, initialNumLegs);

    const probInput = container.querySelector('#individual-prob');
    const legsInput = container.querySelector('#num-legs');
    const probDisplay = container.querySelector('.prob-display');
    const legsDisplay = container.querySelector('.legs-display');

    const updateVisualization = () => {
      const prob = parseFloat(probInput.value);
      const legs = parseInt(legsInput.value);

      probDisplay.textContent = `${(prob * 100).toFixed(1)}%`;
      legsDisplay.textContent = legs;

      const data = generateParlayData(prob, legs);
      const rows = container.querySelectorAll('.parlay-table tbody tr');

      rows.forEach((row, index) => {
        if (index < data.length) {
          const item = data[index];
          const cells = row.querySelectorAll('td');
          const barColor = item.percentage > 50 ? '#4CAF50' :
                          item.percentage > 10 ? '#FFC107' :
                          item.percentage > 1 ? '#FF9800' : '#F44336';

          cells[1].textContent = `${item.percentage.toFixed(2)}%`;
          cells[2].textContent = item.decimalOdds.toFixed(2);
          cells[3].textContent = formatAmericanOdds(item.americanOdds);

          const bar = cells[4].querySelector('.probability-bar');
          bar.style.width = `${Math.min(item.barWidth, 100)}%`;
          bar.style.backgroundColor = barColor;
        }
      });
    };

    probInput.addEventListener('input', updateVisualization);
    legsInput.addEventListener('input', updateVisualization);
  }

  return {
    calculateParlayProbability,
    probabilityToOdds,
    probabilityToAmericanOdds,
    formatAmericanOdds,
    generateParlayData,
    createVisualizationHTML,
    init
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParlayProbabilityViz;
}