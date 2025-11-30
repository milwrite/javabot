/**
 * Arcade Joystick Component
 * A reusable 8-way arcade-style joystick for mobile touch controls
 * Inspired by classic Sanwa and Happ arcade joystick designs
 *
 * Usage:
 *   <div id="joystick-container"></div>
 *   <script>
 *     const joystick = new ArcadeJoystick('joystick-container', {
 *       onDirectionChange: (direction) => console.log(direction)
 *     });
 *   </script>
 */

class ArcadeJoystick {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container ${containerId} not found`);
            return;
        }

        // Configuration
        this.config = {
            size: options.size || 180,              // Base size in pixels
            ballSize: options.ballSize || 60,       // Ball top size
            ballColor: options.ballColor || '#ff0000', // Classic red ball
            baseColor: options.baseColor || '#1a1a1a', // Black base
            accentColor: options.accentColor || '#00ff41', // Noir green accent
            deadzone: options.deadzone || 0.2,      // Center deadzone (0-1)
            sensitivity: options.sensitivity || 1.0, // Movement sensitivity
            hapticFeedback: options.hapticFeedback !== false, // Vibration on direction change
            keyboardEmulation: options.keyboardEmulation !== false, // Emit keyboard events
            onDirectionChange: options.onDirectionChange || null,
            onMove: options.onMove || null,
            allowDiagonal: options.allowDiagonal !== false // Allow 8-way vs 4-way
        };

        // State
        this.currentDirection = null;
        this.isActive = false;
        this.centerX = 0;
        this.centerY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.maxRadius = (this.config.size / 2) - (this.config.ballSize / 2);

        // Active key states for keyboard emulation
        this.activeKeys = new Set();

        this.init();
    }

    init() {
        this.render();
        this.attachEventListeners();
        this.updateCenter();
    }

    render() {
        this.container.innerHTML = `
            <div class="arcade-joystick" style="
                width: ${this.config.size}px;
                height: ${this.config.size}px;
                position: relative;
                user-select: none;
                -webkit-user-select: none;
                touch-action: none;
            ">
                <!-- Joystick base plate -->
                <div class="joystick-base" style="
                    width: 100%;
                    height: 100%;
                    background: ${this.config.baseColor};
                    border-radius: 50%;
                    position: absolute;
                    box-shadow:
                        inset 0 -8px 16px rgba(0,0,0,0.5),
                        inset 0 8px 16px rgba(255,255,255,0.1),
                        0 8px 24px rgba(0,0,0,0.4);
                    border: 3px solid ${this.config.accentColor};
                ">
                    <!-- 8-way directional indicators -->
                    <div class="direction-indicators" style="
                        position: absolute;
                        width: 100%;
                        height: 100%;
                        top: 0;
                        left: 0;
                    ">
                        ${this.renderDirectionMarkers()}
                    </div>

                    <!-- Center deadzone indicator -->
                    <div class="deadzone-circle" style="
                        position: absolute;
                        width: ${this.config.size * this.config.deadzone}px;
                        height: ${this.config.size * this.config.deadzone}px;
                        border: 1px dashed ${this.config.accentColor}40;
                        border-radius: 50%;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        pointer-events: none;
                    "></div>
                </div>

                <!-- Joystick shaft (visible behind ball) -->
                <div class="joystick-shaft" style="
                    width: 12px;
                    height: 40px;
                    background: linear-gradient(to bottom, #666, #333);
                    position: absolute;
                    top: calc(50% - 20px);
                    left: calc(50% - 6px);
                    border-radius: 2px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
                    pointer-events: none;
                    z-index: 1;
                "></div>

                <!-- Joystick ball top (red ball) -->
                <div class="joystick-ball" style="
                    width: ${this.config.ballSize}px;
                    height: ${this.config.ballSize}px;
                    background: radial-gradient(circle at 30% 30%,
                        ${this.lightenColor(this.config.ballColor, 40)},
                        ${this.config.ballColor} 60%,
                        ${this.darkenColor(this.config.ballColor, 30)} 100%);
                    border-radius: 50%;
                    position: absolute;
                    top: calc(50% - ${this.config.ballSize / 2}px);
                    left: calc(50% - ${this.config.ballSize / 2}px);
                    cursor: grab;
                    box-shadow:
                        0 8px 16px rgba(0,0,0,0.4),
                        inset -4px -4px 8px rgba(0,0,0,0.3),
                        inset 4px 4px 8px rgba(255,255,255,0.3);
                    transition: transform 0.05s ease-out, box-shadow 0.1s;
                    z-index: 2;
                    border: 2px solid rgba(0,0,0,0.2);
                " data-joystick-ball>
                    <!-- Highlight reflection on ball -->
                    <div style="
                        position: absolute;
                        width: 20px;
                        height: 20px;
                        background: radial-gradient(circle, rgba(255,255,255,0.6), transparent);
                        border-radius: 50%;
                        top: 8px;
                        left: 12px;
                        pointer-events: none;
                    "></div>
                </div>

                <!-- Active direction label -->
                <div class="direction-label" style="
                    position: absolute;
                    bottom: -30px;
                    left: 50%;
                    transform: translateX(-50%);
                    color: ${this.config.accentColor};
                    font-family: 'Courier Prime', monospace;
                    font-size: 12px;
                    font-weight: bold;
                    text-align: center;
                    min-width: 60px;
                    opacity: 0.7;
                " data-direction-label></div>
            </div>
        `;

        this.ball = this.container.querySelector('[data-joystick-ball]');
        this.directionLabel = this.container.querySelector('[data-direction-label]');
    }

    renderDirectionMarkers() {
        const directions = [
            { angle: 0, label: 'N', key: 'UP' },
            { angle: 45, label: 'NE', key: 'UP-RIGHT' },
            { angle: 90, label: 'E', key: 'RIGHT' },
            { angle: 135, label: 'SE', key: 'DOWN-RIGHT' },
            { angle: 180, label: 'S', key: 'DOWN' },
            { angle: 225, label: 'SW', key: 'DOWN-LEFT' },
            { angle: 270, label: 'W', key: 'LEFT' },
            { angle: 315, label: 'NW', key: 'UP-LEFT' }
        ];

        return directions.map(dir => {
            const radians = (dir.angle - 90) * Math.PI / 180;
            const radius = (this.config.size / 2) - 20;
            const x = radius * Math.cos(radians);
            const y = radius * Math.sin(radians);

            return `
                <div style="
                    position: absolute;
                    top: calc(50% + ${y}px);
                    left: calc(50% + ${x}px);
                    transform: translate(-50%, -50%);
                    width: 8px;
                    height: 8px;
                    background: ${this.config.accentColor};
                    border-radius: 50%;
                    opacity: 0.4;
                    box-shadow: 0 0 8px ${this.config.accentColor}80;
                " data-direction="${dir.key}"></div>
            `;
        }).join('');
    }

    attachEventListeners() {
        // Touch events
        this.ball.addEventListener('touchstart', this.handleStart.bind(this), { passive: false });
        document.addEventListener('touchmove', this.handleMove.bind(this), { passive: false });
        document.addEventListener('touchend', this.handleEnd.bind(this));

        // Mouse events (desktop fallback)
        this.ball.addEventListener('mousedown', this.handleStart.bind(this));
        document.addEventListener('mousemove', this.handleMove.bind(this));
        document.addEventListener('mouseup', this.handleEnd.bind(this));

        // Window resize
        window.addEventListener('resize', () => this.updateCenter());
    }

    handleStart(e) {
        e.preventDefault();
        this.isActive = true;
        this.ball.style.cursor = 'grabbing';
        this.ball.style.transform = 'scale(0.95)';
        this.updateCenter();
    }

    handleMove(e) {
        if (!this.isActive) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        const rect = this.container.getBoundingClientRect();

        // Calculate position relative to joystick center
        const dx = touch.clientX - this.centerX;
        const dy = touch.clientY - this.centerY;

        // Calculate distance from center
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        // Limit to max radius
        const limitedDistance = Math.min(distance, this.maxRadius);

        // Calculate new position
        this.currentX = limitedDistance * Math.cos(angle);
        this.currentY = limitedDistance * Math.sin(angle);

        // Update ball position
        this.ball.style.transform = `translate(${this.currentX}px, ${this.currentY}px) scale(0.95)`;

        // Calculate direction
        const normalizedDistance = distance / this.maxRadius;

        if (normalizedDistance > this.config.deadzone) {
            const direction = this.calculateDirection(angle, normalizedDistance);
            this.updateDirection(direction);
        } else {
            this.updateDirection(null);
        }

        // Optional move callback
        if (this.config.onMove) {
            this.config.onMove({
                x: this.currentX / this.maxRadius,
                y: this.currentY / this.maxRadius,
                distance: normalizedDistance,
                angle: angle * 180 / Math.PI
            });
        }
    }

    handleEnd(e) {
        if (!this.isActive) return;

        this.isActive = false;
        this.ball.style.cursor = 'grab';

        // Spring back to center with animation
        this.ball.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        this.ball.style.transform = 'translate(0, 0) scale(1)';

        setTimeout(() => {
            this.ball.style.transition = 'transform 0.05s ease-out, box-shadow 0.1s';
        }, 200);

        this.currentX = 0;
        this.currentY = 0;
        this.updateDirection(null);
    }

    calculateDirection(angle, normalizedDistance) {
        // Convert angle to degrees (0-360)
        let degrees = (angle * 180 / Math.PI + 450) % 360;

        if (this.config.allowDiagonal) {
            // 8-way joystick
            if (degrees >= 337.5 || degrees < 22.5) return 'UP';
            if (degrees >= 22.5 && degrees < 67.5) return 'UP-RIGHT';
            if (degrees >= 67.5 && degrees < 112.5) return 'RIGHT';
            if (degrees >= 112.5 && degrees < 157.5) return 'DOWN-RIGHT';
            if (degrees >= 157.5 && degrees < 202.5) return 'DOWN';
            if (degrees >= 202.5 && degrees < 247.5) return 'DOWN-LEFT';
            if (degrees >= 247.5 && degrees < 292.5) return 'LEFT';
            if (degrees >= 292.5 && degrees < 337.5) return 'UP-LEFT';
        } else {
            // 4-way joystick (like Pac-Man)
            if (degrees >= 315 || degrees < 45) return 'UP';
            if (degrees >= 45 && degrees < 135) return 'RIGHT';
            if (degrees >= 135 && degrees < 225) return 'DOWN';
            if (degrees >= 225 && degrees < 315) return 'LEFT';
        }

        return null;
    }

    updateDirection(newDirection) {
        if (newDirection === this.currentDirection) return;

        // Release old keys
        if (this.config.keyboardEmulation) {
            this.releaseAllKeys();
        }

        this.currentDirection = newDirection;

        // Update visual feedback
        this.updateDirectionIndicators(newDirection);

        // Update label
        if (this.directionLabel) {
            this.directionLabel.textContent = newDirection || 'CENTER';
        }

        // Haptic feedback
        if (newDirection && this.config.hapticFeedback && navigator.vibrate) {
            navigator.vibrate(10);
        }

        // Emit keyboard events
        if (this.config.keyboardEmulation && newDirection) {
            this.emitKeyboardEvents(newDirection);
        }

        // Callback
        if (this.config.onDirectionChange) {
            this.config.onDirectionChange(newDirection);
        }
    }

    updateDirectionIndicators(direction) {
        // Reset all indicators
        const indicators = this.container.querySelectorAll('[data-direction]');
        indicators.forEach(ind => {
            ind.style.opacity = '0.4';
            ind.style.transform = 'translate(-50%, -50%) scale(1)';
        });

        // Highlight active direction(s)
        if (direction) {
            const activeIndicator = this.container.querySelector(`[data-direction="${direction}"]`);
            if (activeIndicator) {
                activeIndicator.style.opacity = '1';
                activeIndicator.style.transform = 'translate(-50%, -50%) scale(1.5)';
            }
        }
    }

    emitKeyboardEvents(direction) {
        const keyMap = {
            'UP': ['ArrowUp'],
            'DOWN': ['ArrowDown'],
            'LEFT': ['ArrowLeft'],
            'RIGHT': ['ArrowRight'],
            'UP-LEFT': ['ArrowUp', 'ArrowLeft'],
            'UP-RIGHT': ['ArrowUp', 'ArrowRight'],
            'DOWN-LEFT': ['ArrowDown', 'ArrowLeft'],
            'DOWN-RIGHT': ['ArrowDown', 'ArrowRight']
        };

        const keys = keyMap[direction] || [];

        keys.forEach(key => {
            if (!this.activeKeys.has(key)) {
                this.activeKeys.add(key);
                this.dispatchKeyEvent('keydown', key);
            }
        });
    }

    releaseAllKeys() {
        this.activeKeys.forEach(key => {
            this.dispatchKeyEvent('keyup', key);
        });
        this.activeKeys.clear();
    }

    dispatchKeyEvent(type, key) {
        const event = new KeyboardEvent(type, {
            key: key,
            code: key,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(event);
    }

    updateCenter() {
        const rect = this.container.getBoundingClientRect();
        this.centerX = rect.left + rect.width / 2;
        this.centerY = rect.top + rect.height / 2;
    }

    // Color utilities
    lightenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, (num >> 16) + amt);
        const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
        const B = Math.min(255, (num & 0x0000FF) + amt);
        return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
    }

    darkenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max(0, (num >> 16) - amt);
        const G = Math.max(0, (num >> 8 & 0x00FF) - amt);
        const B = Math.max(0, (num & 0x0000FF) - amt);
        return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
    }

    // Public API
    destroy() {
        this.releaseAllKeys();
        this.container.innerHTML = '';
    }

    reset() {
        this.handleEnd();
    }

    setSize(newSize) {
        this.config.size = newSize;
        this.maxRadius = (newSize / 2) - (this.config.ballSize / 2);
        this.render();
        this.attachEventListeners();
        this.updateCenter();
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ArcadeJoystick;
}
