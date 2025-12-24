/**
 * Sportello Ambient - Reusable ambient sound mixer for Bot Sportello pages
 * Location: src/audio/sportello-ambient.js
 *
 * Usage (from src/*.html):
 *   <script src="audio/sportello-ambient.js"></script>
 *   <script>
 *     SportelloAmbient.init({
 *       container: '#ambient-controls',  // Where to inject controls (optional)
 *       sounds: ['rain', 'ocean', 'wind', 'fire', 'whitenoise', 'heartbeat', 'chimes'],
 *       timer: true,                      // Show sleep timer (default: true)
 *       theme: 'sleep'                    // 'sleep' (lavender) or 'noir' (cyan/red)
 *     });
 *   </script>
 */

const SportelloAmbient = (function() {
    let audioContext = null;
    let masterGain = null;
    let sounds = {};
    let isPlaying = false;
    let timerInterval = null;
    let timerEndTime = null;
    let initialized = false;

    // Sound presets with better synthesis parameters
    const SOUND_PRESETS = {
        rain: {
            label: 'Rain',
            type: 'filtered-noise',
            filterType: 'lowpass',
            filterFreq: 400,
            filterQ: 0.5,
            modulation: { type: 'lfo', freq: 0.1, depth: 100 }
        },
        ocean: {
            label: 'Ocean Waves',
            type: 'filtered-noise',
            filterType: 'bandpass',
            filterFreq: 150,
            filterQ: 0.7,
            modulation: { type: 'lfo', freq: 0.08, depth: 80 }
        },
        wind: {
            label: 'Wind',
            type: 'filtered-noise',
            filterType: 'bandpass',
            filterFreq: 800,
            filterQ: 2,
            modulation: { type: 'lfo', freq: 0.15, depth: 400 }
        },
        fire: {
            label: 'Crackling Fire',
            type: 'crackle',
            baseFreq: 200,
            crackleRate: 8
        },
        whitenoise: {
            label: 'White Noise',
            type: 'noise'
        },
        pinknoise: {
            label: 'Pink Noise',
            type: 'filtered-noise',
            filterType: 'lowpass',
            filterFreq: 1000,
            filterQ: 0.5
        },
        heartbeat: {
            label: 'Heartbeat',
            type: 'heartbeat',
            bpm: 60
        },
        chimes: {
            label: 'Wind Chimes',
            type: 'chimes',
            interval: 3000
        },
        drone: {
            label: 'Deep Drone',
            type: 'drone',
            baseFreq: 55
        }
    };

    // Create noise buffer
    function createNoiseBuffer(duration = 2) {
        const bufferSize = audioContext.sampleRate * duration;
        const buffer = audioContext.createBuffer(2, bufferSize, audioContext.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const output = buffer.getChannelData(channel);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
        }
        return buffer;
    }

    // Create a sound layer
    function createSound(name, preset) {
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        gain.connect(masterGain);

        const soundObj = {
            name,
            preset,
            gain,
            volume: 0.5,
            active: false,
            nodes: [],
            intervals: []
        };

        return soundObj;
    }

    // Start a sound
    function startSound(soundObj) {
        const preset = soundObj.preset;
        stopSound(soundObj); // Clean up any existing nodes

        if (preset.type === 'noise') {
            const source = audioContext.createBufferSource();
            source.buffer = createNoiseBuffer();
            source.loop = true;
            source.connect(soundObj.gain);
            source.start();
            soundObj.nodes.push(source);
        }
        else if (preset.type === 'filtered-noise') {
            const source = audioContext.createBufferSource();
            source.buffer = createNoiseBuffer();
            source.loop = true;

            const filter = audioContext.createBiquadFilter();
            filter.type = preset.filterType;
            filter.frequency.value = preset.filterFreq;
            filter.Q.value = preset.filterQ || 1;

            source.connect(filter);
            filter.connect(soundObj.gain);
            source.start();
            soundObj.nodes.push(source, filter);

            // Add modulation for organic movement
            if (preset.modulation) {
                const lfo = audioContext.createOscillator();
                const lfoGain = audioContext.createGain();
                lfo.frequency.value = preset.modulation.freq;
                lfoGain.gain.value = preset.modulation.depth;
                lfo.connect(lfoGain);
                lfoGain.connect(filter.frequency);
                lfo.start();
                soundObj.nodes.push(lfo, lfoGain);
            }
        }
        else if (preset.type === 'heartbeat') {
            const osc = audioContext.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 50;

            const pulseGain = audioContext.createGain();
            pulseGain.gain.value = 0;

            osc.connect(pulseGain);
            pulseGain.connect(soundObj.gain);
            osc.start();
            soundObj.nodes.push(osc, pulseGain);

            const beatInterval = 60000 / (preset.bpm || 60);
            const interval = setInterval(() => {
                if (soundObj.active && audioContext.state === 'running') {
                    const now = audioContext.currentTime;
                    // Lub
                    pulseGain.gain.setValueAtTime(0, now);
                    pulseGain.gain.linearRampToValueAtTime(1, now + 0.05);
                    pulseGain.gain.linearRampToValueAtTime(0, now + 0.15);
                    // Dub
                    pulseGain.gain.setValueAtTime(0, now + 0.2);
                    pulseGain.gain.linearRampToValueAtTime(0.7, now + 0.25);
                    pulseGain.gain.linearRampToValueAtTime(0, now + 0.4);
                }
            }, beatInterval);
            soundObj.intervals.push(interval);
        }
        else if (preset.type === 'crackle') {
            const source = audioContext.createBufferSource();
            source.buffer = createNoiseBuffer();
            source.loop = true;

            const filter = audioContext.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = preset.baseFreq || 200;

            const crackleGain = audioContext.createGain();
            crackleGain.gain.value = 0;

            source.connect(filter);
            filter.connect(crackleGain);
            crackleGain.connect(soundObj.gain);
            source.start();
            soundObj.nodes.push(source, filter, crackleGain);

            // Random crackles
            const crackle = () => {
                if (soundObj.active && audioContext.state === 'running') {
                    const now = audioContext.currentTime;
                    const intensity = Math.random() * 0.8 + 0.2;
                    crackleGain.gain.setValueAtTime(intensity, now);
                    crackleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05 + Math.random() * 0.1);
                }
                if (soundObj.active) {
                    const delay = 50 + Math.random() * (1000 / (preset.crackleRate || 5));
                    setTimeout(crackle, delay);
                }
            };
            crackle();
        }
        else if (preset.type === 'chimes') {
            const chimeNotes = [523, 659, 784, 880, 1047]; // C5, E5, G5, A5, C6

            const chime = () => {
                if (soundObj.active && audioContext.state === 'running') {
                    const freq = chimeNotes[Math.floor(Math.random() * chimeNotes.length)];
                    const osc = audioContext.createOscillator();
                    const chimeGain = audioContext.createGain();

                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    chimeGain.gain.value = 0.3;

                    osc.connect(chimeGain);
                    chimeGain.connect(soundObj.gain);
                    osc.start();

                    const now = audioContext.currentTime;
                    chimeGain.gain.exponentialRampToValueAtTime(0.01, now + 2);
                    osc.stop(now + 2);
                }
                if (soundObj.active) {
                    const delay = (preset.interval || 3000) + Math.random() * 2000;
                    setTimeout(chime, delay);
                }
            };
            setTimeout(chime, 1000);
        }
        else if (preset.type === 'drone') {
            const baseFreq = preset.baseFreq || 55;

            [1, 1.5, 2].forEach((mult, i) => {
                const osc = audioContext.createOscillator();
                osc.type = 'sine';
                osc.frequency.value = baseFreq * mult;

                const droneGain = audioContext.createGain();
                droneGain.gain.value = 0.3 / (i + 1);

                osc.connect(droneGain);
                droneGain.connect(soundObj.gain);
                osc.start();
                soundObj.nodes.push(osc, droneGain);
            });
        }
    }

    // Stop a sound
    function stopSound(soundObj) {
        soundObj.nodes.forEach(node => {
            try {
                if (node.stop) node.stop();
                node.disconnect();
            } catch (e) {}
        });
        soundObj.nodes = [];

        soundObj.intervals.forEach(interval => clearInterval(interval));
        soundObj.intervals = [];
    }

    // Initialize audio context (must be called from user interaction)
    function initAudio() {
        if (audioContext) return;

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 1;
        masterGain.connect(audioContext.destination);
    }

    // Public API
    return {
        init: function(options = {}) {
            if (initialized) return;
            initialized = true;

            const soundList = options.sounds || ['rain', 'ocean', 'whitenoise'];
            const container = options.container ? document.querySelector(options.container) : null;
            const showTimer = options.timer !== false;
            const theme = options.theme || 'sleep';

            // Create sound objects (without audio nodes yet)
            soundList.forEach(name => {
                if (SOUND_PRESETS[name]) {
                    sounds[name] = createSound(name, SOUND_PRESETS[name]);
                }
            });

            // Inject controls if container specified
            if (container) {
                this.injectControls(container, soundList, showTimer, theme);
            }
        },

        injectControls: function(container, soundList, showTimer, theme) {
            const colors = theme === 'sleep'
                ? { accent: '#8b7ea8', soft: '#6a6a7a', text: '#9a9aaa', bg: '#0a0a0f' }
                : { accent: '#00ffff', soft: '#7ec8e3', text: '#7ec8e3', bg: '#0a0a0a' };

            let html = `
                <style>
                    .sa-controls { font-family: 'Courier Prime', monospace; }
                    .sa-section { background: rgba(${theme === 'sleep' ? '139,126,168' : '0,255,255'},0.03); border: 1px solid rgba(${theme === 'sleep' ? '106,106,122' : '126,200,227'},0.3); border-radius: 6px; padding: 18px; margin-bottom: 16px; }
                    .sa-title { color: ${colors.soft}; font-size: 0.9em; margin-bottom: 14px; text-align: center; font-weight: normal; text-transform: uppercase; letter-spacing: 0.1em; }
                    .sa-sound { margin-bottom: 16px; }
                    .sa-sound:last-child { margin-bottom: 0; }
                    .sa-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
                    .sa-label { color: ${colors.text}; font-size: 0.85em; }
                    .sa-toggle { background: transparent; border: 1px solid ${colors.soft}; color: ${colors.soft}; padding: 4px 10px; border-radius: 3px; font-family: inherit; font-size: 0.75em; cursor: pointer; min-width: 50px; transition: all 0.3s; }
                    .sa-toggle.active { background: ${colors.accent}; color: ${colors.bg}; border-color: ${colors.accent}; }
                    .sa-slider { width: 100%; height: 4px; border-radius: 2px; background: rgba(106,106,122,0.2); outline: none; -webkit-appearance: none; }
                    .sa-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: ${colors.accent}; cursor: pointer; }
                    .sa-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: ${colors.accent}; cursor: pointer; border: none; }
                    .sa-timer-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
                    .sa-timer-btn { background: transparent; border: 1px solid rgba(106,106,122,0.4); color: ${colors.soft}; padding: 10px 6px; border-radius: 3px; font-family: inherit; font-size: 0.8em; cursor: pointer; transition: all 0.3s; }
                    .sa-timer-btn.active { background: ${colors.accent}; color: ${colors.bg}; border-color: ${colors.accent}; }
                    .sa-timer-display { text-align: center; color: ${colors.accent}; font-size: 1.3em; min-height: 32px; opacity: 0.9; }
                    .sa-play { width: 100%; background: ${colors.accent}; border: 1px solid ${colors.accent}; color: ${colors.bg}; padding: 14px; border-radius: 4px; font-family: inherit; font-size: 0.95em; cursor: pointer; min-height: 48px; transition: all 0.3s; }
                    .sa-play.playing { background: transparent; color: ${colors.accent}; }
                    .sa-status { text-align: center; color: ${colors.soft}; font-size: 0.8em; margin-top: 14px; min-height: 18px; opacity: 0.7; }
                    @media (max-width: 480px) { .sa-timer-grid { grid-template-columns: repeat(2, 1fr); } }
                </style>
                <div class="sa-controls">
                    <div class="sa-section">
                        <div class="sa-title">Sound Layers</div>
            `;

            soundList.forEach(name => {
                const preset = SOUND_PRESETS[name];
                if (!preset) return;
                html += `
                    <div class="sa-sound">
                        <div class="sa-header">
                            <span class="sa-label">${preset.label}</span>
                            <button class="sa-toggle" data-sound="${name}">OFF</button>
                        </div>
                        <input type="range" class="sa-slider" data-sound="${name}" min="0" max="100" value="50" aria-label="${preset.label} volume">
                    </div>
                `;
            });

            html += '</div>';

            if (showTimer) {
                html += `
                    <div class="sa-section">
                        <div class="sa-title">Sleep Timer</div>
                        <div class="sa-timer-grid">
                            <button class="sa-timer-btn" data-minutes="15">15 min</button>
                            <button class="sa-timer-btn" data-minutes="30">30 min</button>
                            <button class="sa-timer-btn" data-minutes="60">60 min</button>
                            <button class="sa-timer-btn" data-minutes="0">Off</button>
                        </div>
                        <div class="sa-timer-display" id="saTimerDisplay"></div>
                    </div>
                `;
            }

            html += `
                    <button class="sa-play" id="saPlayBtn">Start Sounds</button>
                    <div class="sa-status" id="saStatus">Select sounds and press Start</div>
                </div>
            `;

            container.innerHTML = html;
            this.bindEvents();
        },

        bindEvents: function() {
            const self = this;

            // Toggle buttons
            document.querySelectorAll('.sa-toggle').forEach(btn => {
                btn.addEventListener('click', function() {
                    const name = this.dataset.sound;
                    const sound = sounds[name];
                    if (!sound) return;

                    sound.active = !sound.active;
                    this.textContent = sound.active ? 'ON' : 'OFF';
                    this.classList.toggle('active', sound.active);

                    if (isPlaying) {
                        if (sound.active) {
                            startSound(sound);
                            sound.gain.gain.linearRampToValueAtTime(sound.volume, audioContext.currentTime + 0.5);
                        } else {
                            sound.gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.5);
                            setTimeout(() => stopSound(sound), 600);
                        }
                    }
                    self.updateStatus();
                });
            });

            // Volume sliders
            document.querySelectorAll('.sa-slider').forEach(slider => {
                slider.addEventListener('input', function() {
                    const name = this.dataset.sound;
                    const sound = sounds[name];
                    if (!sound) return;

                    sound.volume = this.value / 100;
                    if (isPlaying && sound.active) {
                        sound.gain.gain.linearRampToValueAtTime(sound.volume, audioContext.currentTime + 0.1);
                    }
                });
            });

            // Timer buttons
            document.querySelectorAll('.sa-timer-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    document.querySelectorAll('.sa-timer-btn').forEach(b => b.classList.remove('active'));
                    this.classList.add('active');

                    const minutes = parseInt(this.dataset.minutes);
                    if (timerInterval) {
                        clearInterval(timerInterval);
                        timerInterval = null;
                    }

                    const display = document.getElementById('saTimerDisplay');
                    if (minutes > 0 && isPlaying) {
                        timerEndTime = Date.now() + (minutes * 60 * 1000);
                        self.startTimer();
                    } else {
                        timerEndTime = null;
                        if (display) display.textContent = '';
                    }
                });
            });

            // Play button
            const playBtn = document.getElementById('saPlayBtn');
            if (playBtn) {
                playBtn.addEventListener('click', function() {
                    initAudio();

                    if (audioContext.state === 'suspended') {
                        audioContext.resume();
                    }

                    if (!isPlaying) {
                        self.startAll();
                        this.textContent = 'Stop Sounds';
                        this.classList.add('playing');
                        isPlaying = true;

                        const activeTimer = document.querySelector('.sa-timer-btn.active');
                        if (activeTimer) {
                            const minutes = parseInt(activeTimer.dataset.minutes);
                            if (minutes > 0) {
                                timerEndTime = Date.now() + (minutes * 60 * 1000);
                                self.startTimer();
                            }
                        }
                    } else {
                        self.stopAll();
                        this.textContent = 'Start Sounds';
                        this.classList.remove('playing');
                        isPlaying = false;

                        if (timerInterval) {
                            clearInterval(timerInterval);
                            timerInterval = null;
                        }
                        const display = document.getElementById('saTimerDisplay');
                        if (display) display.textContent = '';
                    }
                    self.updateStatus();
                });
            }
        },

        startAll: function() {
            Object.values(sounds).forEach(sound => {
                if (sound.active) {
                    startSound(sound);
                    sound.gain.gain.linearRampToValueAtTime(sound.volume, audioContext.currentTime + 2);
                }
            });
        },

        stopAll: function() {
            Object.values(sounds).forEach(sound => {
                sound.gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 1);
                setTimeout(() => stopSound(sound), 1100);
            });
        },

        startTimer: function() {
            const self = this;
            const display = document.getElementById('saTimerDisplay');

            const updateDisplay = () => {
                if (!timerEndTime || !display) return;
                const remaining = Math.max(0, timerEndTime - Date.now());
                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                display.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                if (remaining <= 0) {
                    clearInterval(timerInterval);
                    self.fadeOut();
                }
            };

            updateDisplay();
            timerInterval = setInterval(updateDisplay, 1000);
        },

        fadeOut: function() {
            const self = this;
            const status = document.getElementById('saStatus');
            if (status) status.textContent = 'Fading out...';

            Object.values(sounds).forEach(sound => {
                if (sound.active) {
                    sound.gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 30);
                }
            });

            setTimeout(() => {
                self.stopAll();
                isPlaying = false;
                const playBtn = document.getElementById('saPlayBtn');
                if (playBtn) {
                    playBtn.textContent = 'Start Sounds';
                    playBtn.classList.remove('playing');
                }
                self.updateStatus();
            }, 31000);
        },

        updateStatus: function() {
            const status = document.getElementById('saStatus');
            if (!status) return;

            const active = Object.values(sounds).filter(s => s.active).map(s => s.preset.label);
            if (active.length === 0) {
                status.textContent = 'No sounds selected';
            } else if (isPlaying) {
                status.textContent = `Playing: ${active.join(', ')}`;
            } else {
                status.textContent = `Ready: ${active.join(', ')}`;
            }
        },

        // Programmatic API
        toggle: function(name) {
            const btn = document.querySelector(`.sa-toggle[data-sound="${name}"]`);
            if (btn) btn.click();
        },

        setVolume: function(name, vol) {
            const sound = sounds[name];
            if (sound) {
                sound.volume = Math.max(0, Math.min(1, vol));
                const slider = document.querySelector(`.sa-slider[data-sound="${name}"]`);
                if (slider) slider.value = sound.volume * 100;
                if (isPlaying && sound.active && audioContext) {
                    sound.gain.gain.linearRampToValueAtTime(sound.volume, audioContext.currentTime + 0.1);
                }
            }
        },

        play: function() {
            const btn = document.getElementById('saPlayBtn');
            if (btn && !isPlaying) btn.click();
        },

        stop: function() {
            const btn = document.getElementById('saPlayBtn');
            if (btn && isPlaying) btn.click();
        }
    };
})();
