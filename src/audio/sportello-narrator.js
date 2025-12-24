/**
 * Bot Sportello Narrator - TTS Component
 * Reusable text-to-speech narration for Bot Sportello pages
 * Location: src/audio/sportello-narrator.js
 *
 * Usage (from src/*.html):
 * 1. Include this script: <script src="audio/sportello-narrator.js"></script>
 * 2. Add container: <div id="narrator-controls"></div>
 * 3. Call: SportelloNarrator.init({ voice: 'Ralph', selector: '.paragraph' });
 */

const SportelloNarrator = (function() {
    const synth = window.speechSynthesis;
    let voices = [];
    let currentUtterance = null;
    let isPlaying = false;
    let isPaused = false;
    let paragraphs = [];
    let currentIndex = 0;
    let config = {
        voice: 'Ralph',
        selector: '.paragraph',
        titleSelector: '.chapter-title',
        rate: 0.85,
        pitch: 0.9,
        highlightClass: 'reading',
        narratorName: 'Bot Sportello'
    };

    // Noir-styled control panel CSS
    const styles = `
        .narrator-controls {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(10, 10, 10, 0.95);
            border: 1px solid #00ffff;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 0 20px rgba(0, 255, 255, 0.2);
            z-index: 1000;
            font-family: 'Courier Prime', monospace;
            min-width: 200px;
        }
        .narrator-controls h4 {
            font-size: 11px;
            color: #00ffff;
            margin: 0 0 8px 0;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .narrator-name {
            color: #ff0000;
            font-size: 13px;
            margin-bottom: 10px;
            text-shadow: 0 0 10px rgba(255, 0, 0, 0.3);
        }
        .narrator-btn {
            padding: 8px 14px;
            margin: 3px;
            border: 1px solid;
            border-radius: 4px;
            cursor: pointer;
            font-family: 'Courier Prime', monospace;
            font-size: 12px;
            transition: all 0.2s;
            background: transparent;
        }
        .narrator-btn.play {
            border-color: #00ff41;
            color: #00ff41;
        }
        .narrator-btn.play:hover {
            background: rgba(0, 255, 65, 0.2);
            box-shadow: 0 0 10px rgba(0, 255, 65, 0.3);
        }
        .narrator-btn.pause {
            border-color: #ffaa00;
            color: #ffaa00;
        }
        .narrator-btn.pause:hover {
            background: rgba(255, 170, 0, 0.2);
        }
        .narrator-btn.stop {
            border-color: #ff0000;
            color: #ff0000;
        }
        .narrator-btn.stop:hover {
            background: rgba(255, 0, 0, 0.2);
        }
        .narrator-status {
            font-size: 11px;
            color: #5a9fb0;
            margin-top: 8px;
        }
        .narrator-select {
            width: 100%;
            padding: 6px;
            margin-top: 8px;
            border: 1px solid #00ffff;
            border-radius: 4px;
            font-size: 11px;
            background: #0a0a0a;
            color: #7ec8e3;
            font-family: 'Courier Prime', monospace;
        }
        .narrator-select option {
            background: #0a0a0a;
            color: #7ec8e3;
        }
        .reading {
            background: rgba(255, 0, 0, 0.1);
            border-left: 2px solid #ff0000;
            padding-left: 15px;
            margin-left: -17px;
            transition: all 0.3s;
        }
        @media (max-width: 768px) {
            .narrator-controls {
                bottom: 10px;
                right: 10px;
                left: 10px;
                min-width: auto;
            }
        }
    `;

    function injectStyles() {
        if (document.getElementById('narrator-styles')) return;
        const style = document.createElement('style');
        style.id = 'narrator-styles';
        style.textContent = styles;
        document.head.appendChild(style);
    }

    function createControls(container) {
        container.innerHTML = `
            <div class="narrator-controls">
                <h4>Narration</h4>
                <div class="narrator-name">${config.narratorName}</div>
                <div>
                    <button class="narrator-btn play" id="narratorPlayBtn">Play</button>
                    <button class="narrator-btn stop" id="narratorStopBtn">Stop</button>
                </div>
                <select class="narrator-select" id="narratorVoiceSelect">
                    <option value="">Loading...</option>
                </select>
                <div class="narrator-status" id="narratorStatus">Ready</div>
            </div>
        `;

        document.getElementById('narratorPlayBtn').addEventListener('click', toggle);
        document.getElementById('narratorStopBtn').addEventListener('click', stop);
    }

    function findVoice(voiceList) {
        const match = voiceList.find(v =>
            v.name.includes(config.voice) && v.lang.startsWith('en')
        );
        return match || null;
    }

    function loadVoices() {
        voices = synth.getVoices();
        const select = document.getElementById('narratorVoiceSelect');
        if (!select) return;

        select.innerHTML = '';
        const voice = findVoice(voices);

        if (!voice) {
            select.innerHTML = `<option value="">${config.voice} not available</option>`;
            updateStatus(`${config.voice} voice not found`);
            return;
        }

        const option = document.createElement('option');
        option.value = '0';
        option.textContent = `${config.voice} (${voice.lang})`;
        option.selected = true;
        select.appendChild(option);

        updateStatus(`Voice: ${config.voice}`);
    }

    function getStoryText() {
        const texts = [];

        // Get titles if selector provided
        if (config.titleSelector) {
            document.querySelectorAll(config.titleSelector).forEach(el => {
                texts.push({ element: el, text: el.textContent });
            });
        }

        // Get paragraphs
        document.querySelectorAll(config.selector).forEach(el => {
            texts.push({ element: el, text: el.textContent });
        });

        return texts;
    }

    function highlight(element) {
        document.querySelectorAll('.' + config.highlightClass).forEach(el =>
            el.classList.remove(config.highlightClass)
        );
        if (element) {
            element.classList.add(config.highlightClass);
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function speak(index) {
        if (index >= paragraphs.length) {
            stop();
            updateStatus('Finished');
            return;
        }

        const { element, text } = paragraphs[index];
        highlight(element);

        currentUtterance = new SpeechSynthesisUtterance(text);
        currentUtterance.voice = findVoice(voices);
        currentUtterance.rate = config.rate;
        currentUtterance.pitch = config.pitch;
        currentUtterance.volume = 1;

        currentUtterance.onend = () => {
            if (isPlaying && !isPaused) {
                currentIndex++;
                speak(currentIndex);
            }
        };

        currentUtterance.onerror = (e) => {
            console.error('Speech error:', e);
            updateStatus('Error');
        };

        synth.speak(currentUtterance);
        updateStatus('Reading...');
    }

    function toggle() {
        const btn = document.getElementById('narratorPlayBtn');

        if (!isPlaying) {
            isPlaying = true;
            isPaused = false;
            paragraphs = getStoryText();
            btn.textContent = 'Pause';
            btn.className = 'narrator-btn pause';
            speak(currentIndex);
        } else if (isPaused) {
            isPaused = false;
            synth.resume();
            btn.textContent = 'Pause';
            btn.className = 'narrator-btn pause';
            updateStatus('Resumed');
        } else {
            isPaused = true;
            synth.pause();
            btn.textContent = 'Resume';
            btn.className = 'narrator-btn play';
            updateStatus('Paused');
        }
    }

    function stop() {
        synth.cancel();
        isPlaying = false;
        isPaused = false;
        currentIndex = 0;

        const btn = document.getElementById('narratorPlayBtn');
        if (btn) {
            btn.textContent = 'Play';
            btn.className = 'narrator-btn play';
        }

        document.querySelectorAll('.' + config.highlightClass).forEach(el =>
            el.classList.remove(config.highlightClass)
        );
        updateStatus('Ready');
    }

    function updateStatus(msg) {
        const status = document.getElementById('narratorStatus');
        if (status) status.textContent = msg;
    }

    function init(options = {}) {
        // Merge options
        config = { ...config, ...options };

        // Check support
        if (!('speechSynthesis' in window)) {
            const container = document.getElementById('narrator-controls');
            if (container) {
                container.innerHTML = '<p style="color:#ff0000;font-size:11px;">TTS not supported</p>';
            }
            return;
        }

        injectStyles();

        // Create controls if container exists
        const container = document.getElementById('narrator-controls');
        if (container) {
            createControls(container);
        }

        // Load voices
        if (synth.onvoiceschanged !== undefined) {
            synth.onvoiceschanged = loadVoices;
        }
        loadVoices();
    }

    return {
        init,
        play: toggle,
        stop,
        setVoice: (voice) => { config.voice = voice; loadVoices(); },
        setRate: (rate) => { config.rate = rate; },
        setPitch: (pitch) => { config.pitch = pitch; }
    };
})();

// Auto-init if container exists on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('narrator-controls')) {
        SportelloNarrator.init();
    }
});
