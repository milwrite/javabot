// frogger - A JavaScript Game
// Created via Bot Sportello

class FroggerGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = 800;
        this.canvas.height = 600;
        
        this.gameState = 'playing';
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        
        this.gridSize = 50;
        this.rows = this.canvas.height / this.gridSize;
        this.cols = this.canvas.width / this.gridSize;
        
        this.frog = {
            x: Math.floor(this.cols / 2) * this.gridSize,
            y: (this.rows - 1) * this.gridSize,
            size: this.gridSize - 4
        };

        this.cars = [];
        this.logs = [];
        this.water = [];
        this.frogOnLog = false;
        this.showLevelUp = false;
        this.levelUpTimer = 0;
        
        this.init();
    }
    
    init() {
        this.setupLevel();
        this.bindEvents();
        this.gameLoop();
    }
    
    setupLevel() {
        this.cars = [];
        this.logs = [];
        this.water = [];
        this.frogOnLog = false;
        
        // Create water rows (rows 1-5)
        for (let row = 1; row <= 5; row++) {
            this.water.push({
                y: row * this.gridSize,
                height: this.gridSize
            });
        }
        
        // Create car lanes (rows 7-10)
        for (let lane = 7; lane <= 10; lane++) {
            for (let i = 0; i < 3; i++) {
                this.cars.push({
                    x: -this.gridSize + (i * this.gridSize * 3),
                    y: lane * this.gridSize,
                    width: this.gridSize * 2,
                    height: this.gridSize - 4,
                    speed: (lane % 2 === 0 ? 2 : -2) * this.level,
                    direction: lane % 2 === 0 ? 1 : -1
                });
            }
        }
        
        // Create logs in water (rows 1-5)
        for (let row of [1, 2, 3, 4, 5]) {
            const numLogs = row % 2 === 0 ? 2 : 3; // Alternate log density
            const logWidth = row % 2 === 0 ? this.gridSize * 3 : this.gridSize * 2;
            const spacing = this.canvas.width / numLogs;

            for (let i = 0; i < numLogs; i++) {
                this.logs.push({
                    x: i * spacing + (row * 30) % 100, // Offset for variety
                    y: row * this.gridSize,
                    width: logWidth,
                    height: this.gridSize - 4,
                    speed: (row % 2 === 0 ? 1.5 : -1.5) * this.level
                });
            }
        }
    }
    
    bindEvents() {
        document.addEventListener('keydown', (e) => this.handleInput(e));
        
        // Mobile controls - use touchstart to prevent zoom
        document.querySelectorAll('.mobile-btn').forEach(btn => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const key = btn.getAttribute('data-key');
                this.handleInput({ key });
            }, { passive: false });
            // Fallback for non-touch devices
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const key = btn.getAttribute('data-key');
                this.handleInput({ key });
            });
        });
    }
    
    handleInput(event) {
        if (this.gameState !== 'playing') return;
        
        const prevX = this.frog.x;
        const prevY = this.frog.y;
        
        switch(event.key) {
            case 'ArrowUp':
                if (this.frog.y > 0) this.frog.y -= this.gridSize;
                break;
            case 'ArrowDown':
                if (this.frog.y < (this.rows - 1) * this.gridSize) this.frog.y += this.gridSize;
                break;
            case 'ArrowLeft':
                if (this.frog.x > 0) this.frog.x -= this.gridSize;
                break;
            case 'ArrowRight':
                if (this.frog.x < (this.cols - 1) * this.gridSize) this.frog.x += this.gridSize;
                break;
        }
        
        // Check if frog reached the top
        if (this.frog.y === 0) {
            this.score += 100;

            // Check for level completion (every 500 points)
            if (this.score % 500 === 0) {
                this.level++;
                this.setupLevel();
                this.showLevelUp = true;
                this.levelUpTimer = 120; // Show for 2 seconds at 60fps
            }

            this.resetFrog();
        }
    }
    
    update() {
        if (this.gameState !== 'playing') return;

        // Update level up display timer
        if (this.showLevelUp && this.levelUpTimer > 0) {
            this.levelUpTimer--;
            if (this.levelUpTimer <= 0) {
                this.showLevelUp = false;
            }
        }

        // Update cars
        this.cars.forEach(car => {
            car.x += car.speed;
            
            // Wrap cars around screen
            if (car.direction === 1 && car.x > this.canvas.width) {
                car.x = -car.width;
            } else if (car.direction === -1 && car.x < -car.width) {
                car.x = this.canvas.width;
            }
        });
        
        // Update logs
        this.logs.forEach(log => {
            log.x += log.speed;
            
            // Wrap logs around screen
            if (log.speed > 0 && log.x > this.canvas.width) {
                log.x = -log.width;
            } else if (log.speed < 0 && log.x < -log.width) {
                log.x = this.canvas.width;
            }
        });
        
        // Check collisions
        this.checkCollisions();
    }
    
    checkCollisions() {
        // Check car collisions
        this.cars.forEach(car => {
            if (this.frog.x < car.x + car.width &&
                this.frog.x + this.frog.size > car.x &&
                this.frog.y < car.y + car.height &&
                this.frog.y + this.frog.size > car.y) {
                this.loseLife();
            }
        });
        
        // Check if frog is in water
        let onLog = false;
        const frogRow = Math.floor(this.frog.y / this.gridSize);
        
        if (frogRow >= 1 && frogRow <= 5) {
            // Check if on a log
            this.logs.forEach(log => {
                if (this.frog.x + this.frog.size > log.x &&
                    this.frog.x < log.x + log.width &&
                    this.frog.y + this.frog.size > log.y &&
                    this.frog.y < log.y + log.height) {
                    onLog = true;
                    // Move frog with log
                    this.frog.x += log.speed;
                    
                    // Keep frog on screen
                    if (this.frog.x < 0) this.frog.x = 0;
                    if (this.frog.x > this.canvas.width - this.frog.size) {
                        this.frog.x = this.canvas.width - this.frog.size;
                    }
                }
            });
            
            // If in water but not on log, lose life
            if (!onLog) {
                this.loseLife();
            }
        }
    }
    
    loseLife() {
        this.lives--;
        this.resetFrog();
        
        if (this.lives <= 0) {
            this.gameState = 'gameOver';
        }
    }
    
    resetFrog() {
        this.frog.x = Math.floor(this.cols / 2) * this.gridSize;
        this.frog.y = (this.rows - 1) * this.gridSize;
        this.frogOnLog = false;
    }
    
    render() {
        // Clear canvas - noir terminal background
        this.ctx.fillStyle = '#0a0a0a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw road
        this.ctx.fillStyle = '#1a0000';
        this.ctx.fillRect(0, 6 * this.gridSize, this.canvas.width, 5 * this.gridSize);

        // Draw water - dark cyan
        this.ctx.fillStyle = '#003333';
        this.water.forEach(water => {
            this.ctx.fillRect(0, water.y, this.canvas.width, water.height);
        });

        // Draw safe zones - terminal green
        this.ctx.fillStyle = 'rgba(0, 255, 65, 0.3)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.gridSize); // Top safe zone
        this.ctx.fillRect(0, 6 * this.gridSize - this.gridSize, this.canvas.width, this.gridSize); // Middle safe zone
        this.ctx.fillRect(0, 11 * this.gridSize, this.canvas.width, this.gridSize); // Bottom safe zone

        // Draw logs - brown with red tint
        this.ctx.fillStyle = '#663300';
        this.logs.forEach(log => {
            this.ctx.fillRect(log.x, log.y + 2, log.width, log.height);
        });

        // Draw cars - terminal red
        this.ctx.fillStyle = '#ff0000';
        this.cars.forEach(car => {
            this.ctx.fillRect(car.x, car.y + 2, car.width, car.height);
        });

        // Draw frog - terminal green
        this.ctx.fillStyle = '#7ec8e3';
        this.ctx.fillRect(this.frog.x + 2, this.frog.y + 2, this.frog.size, this.frog.size);

        // Draw UI - terminal green
        this.ctx.fillStyle = '#7ec8e3';
        this.ctx.font = '20px "Courier Prime", monospace';
        this.ctx.fillText(`Score: ${this.score}`, 10, 30);
        this.ctx.fillText(`Lives: ${this.lives}`, 10, 55);
        this.ctx.fillText(`Level: ${this.level}`, 10, 80);

        // Level up notification
        if (this.showLevelUp) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            this.ctx.fillRect(this.canvas.width / 2 - 150, this.canvas.height / 2 - 40, 300, 80);
            this.ctx.strokeStyle = '#00ff41';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(this.canvas.width / 2 - 150, this.canvas.height / 2 - 40, 300, 80);

            this.ctx.fillStyle = '#00ff41';
            this.ctx.font = '30px "Courier Prime", monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`LEVEL ${this.level}!`, this.canvas.width / 2, this.canvas.height / 2 + 10);
            this.ctx.textAlign = 'start';
        }

        // Game over screen
        if (this.gameState === 'gameOver') {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            this.ctx.fillStyle = '#ff0000';
            this.ctx.font = '30px "Courier Prime", monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('GAME OVER', this.canvas.width / 2, this.canvas.height / 2 - 50);
            this.ctx.fillStyle = '#7ec8e3';
            this.ctx.font = '16px "Courier Prime", monospace';
            this.ctx.fillText(`Final Score: ${this.score}`, this.canvas.width / 2, this.canvas.height / 2);
            this.ctx.fillText('Refresh to play again', this.canvas.width / 2, this.canvas.height / 2 + 30);
            this.ctx.textAlign = 'start';
        }
    }
    
    gameLoop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
}

// Initialize game when page loads
window.addEventListener('load', () => {
    new FroggerGame();
});