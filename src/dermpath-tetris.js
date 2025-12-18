// DermaPath Tetris - Complete Game Logic
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('nextCanvas');
const nextCtx = nextCanvas.getContext('2d');

// Game constants
const COLS = 10;
const ROWS = 20;
const BLOCK_SIZE = 30;
const COLORS = {
    I: '#9b59b6',
    O: '#8e44ad',
    T: '#7d3c98',
    S: '#6c3483',
    Z: '#5b2c6f',
    J: '#4a235a',
    L: '#512e5f'
};

// Tetromino shapes
const SHAPES = {
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]]
};

// Game state
let board = [];
let currentPiece = null;
let nextPiece = null;
let score = 0;
let lines = 0;
let level = 1;
let gameOver = false;
let isPaused = false;
let dropInterval = 1000;
let lastDropTime = 0;
let gameLoopId = null;

// Input state
let keys = {};

// Initialize board
function initBoard() {
    board = Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
}

// Create H&E staining texture pattern
function createHETexture(color) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = BLOCK_SIZE;
    tempCanvas.height = BLOCK_SIZE;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Base color
    tempCtx.fillStyle = color;
    tempCtx.fillRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
    
    // Add cellular texture
    for (let i = 0; i < 15; i++) {
        const x = Math.random() * BLOCK_SIZE;
        const y = Math.random() * BLOCK_SIZE;
        const radius = Math.random() * 3 + 1;
        
        tempCtx.fillStyle = `rgba(139, 69, 169, ${Math.random() * 0.3})`;
        tempCtx.beginPath();
        tempCtx.arc(x, y, radius, 0, Math.PI * 2);
        tempCtx.fill();
    }
    
    // Add border
    tempCtx.strokeStyle = '#2c003e';
    tempCtx.lineWidth = 2;
    tempCtx.strokeRect(0, 0, BLOCK_SIZE, BLOCK_SIZE);
    
    return tempCanvas;
}

// Get random piece
function randomPiece() {
    const types = Object.keys(SHAPES);
    const type = types[Math.floor(Math.random() * types.length)];
    return {
        type: type,
        shape: SHAPES[type],
        color: COLORS[type],
        x: Math.floor(COLS / 2) - Math.floor(SHAPES[type][0].length / 2),
        y: 0,
        texture: createHETexture(COLORS[type])
    };
}

// Draw block with texture
function drawBlock(x, y, texture) {
    ctx.drawImage(texture, x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
}

// Draw board
function drawBoard() {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            ctx.strokeRect(col * BLOCK_SIZE, row * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        }
    }
    
    // Draw placed blocks
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            if (board[row][col]) {
                drawBlock(col, row, board[row][col]);
            }
        }
    }
}

// Draw current piece
function drawPiece(piece) {
    if (!piece) return;
    
    for (let row = 0; row < piece.shape.length; row++) {
        for (let col = 0; col < piece.shape[row].length; col++) {
            if (piece.shape[row][col]) {
                drawBlock(piece.x + col, piece.y + row, piece.texture);
            }
        }
    }
}

// Draw next piece
function drawNextPiece() {
    nextCtx.fillStyle = '#0a0a0a';
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
    
    if (!nextPiece) return;
    
    const offsetX = (4 - nextPiece.shape[0].length) / 2;
    const offsetY = (4 - nextPiece.shape.length) / 2;
    
    for (let row = 0; row < nextPiece.shape.length; row++) {
        for (let col = 0; col < nextPiece.shape[row].length; col++) {
            if (nextPiece.shape[row][col]) {
                nextCtx.drawImage(
                    nextPiece.texture,
                    (offsetX + col) * BLOCK_SIZE,
                    (offsetY + row) * BLOCK_SIZE,
                    BLOCK_SIZE,
                    BLOCK_SIZE
                );
            }
        }
    }
}

// Check collision
function checkCollision(piece, offsetX = 0, offsetY = 0) {
    for (let row = 0; row < piece.shape.length; row++) {
        for (let col = 0; col < piece.shape[row].length; col++) {
            if (piece.shape[row][col]) {
                const newX = piece.x + col + offsetX;
                const newY = piece.y + row + offsetY;
                
                if (newX < 0 || newX >= COLS || newY >= ROWS) {
                    return true;
                }
                
                if (newY >= 0 && board[newY][newX]) {
                    return true;
                }
            }
        }
    }
    return false;
}

// Rotate piece
function rotate(piece) {
    const newShape = piece.shape[0].map((_, i) =>
        piece.shape.map(row => row[i]).reverse()
    );
    
    const rotated = { ...piece, shape: newShape };
    
    if (!checkCollision(rotated)) {
        return rotated;
    }
    
    // Wall kick
    for (let offset of [-1, 1, -2, 2]) {
        rotated.x = piece.x + offset;
        if (!checkCollision(rotated)) {
            return rotated;
        }
    }
    
    return piece;
}

// Merge piece to board
function mergePiece(piece) {
    for (let row = 0; row < piece.shape.length; row++) {
        for (let col = 0; col < piece.shape[row].length; col++) {
            if (piece.shape[row][col]) {
                const y = piece.y + row;
                const x = piece.x + col;
                if (y >= 0) {
                    board[y][x] = piece.texture;
                }
            }
        }
    }
}

// Clear lines
function clearLines() {
    let linesCleared = 0;
    
    for (let row = ROWS - 1; row >= 0; row--) {
        if (board[row].every(cell => cell !== 0)) {
            board.splice(row, 1);
            board.unshift(Array(COLS).fill(0));
            linesCleared++;
            row++;
        }
    }
    
    if (linesCleared > 0) {
        lines += linesCleared;
        
        // Score based on lines cleared
        const points = [0, 100, 300, 500, 800];
        score += points[linesCleared];
        
        // Level up every 10 lines
        level = Math.floor(lines / 10) + 1;
        dropInterval = Math.max(100, 1000 - (level - 1) * 100);
        
        updateStats();
    }
}

// Update stats display
function updateStats() {
    document.getElementById('score').textContent = score;
    document.getElementById('lines').textContent = lines;
    document.getElementById('level').textContent = level;
}

// Move piece
function movePiece(dx, dy) {
    if (!currentPiece || gameOver || isPaused) return;
    
    if (!checkCollision(currentPiece, dx, dy)) {
        currentPiece.x += dx;
        currentPiece.y += dy;
        return true;
    }
    return false;
}

// Hard drop
function hardDrop() {
    if (!currentPiece || gameOver || isPaused) return;
    
    while (movePiece(0, 1)) {
        score += 2;
    }
    
    lockPiece();
    updateStats();
}

// Lock piece and spawn new one
function lockPiece() {
    if (!currentPiece) return;
    
    mergePiece(currentPiece);
    clearLines();
    
    currentPiece = nextPiece;
    nextPiece = randomPiece();
    
    if (checkCollision(currentPiece)) {
        gameOver = true;
        showGameOver();
    }
}

// Show game over
function showGameOver() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#ff0000';
    ctx.font = 'bold 30px "Courier Prime"';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
    
    ctx.fillStyle = '#7ec8e3';
    ctx.font = '20px "Courier Prime"';
    ctx.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2 + 20);
    ctx.fillText('Press R to restart', canvas.width / 2, canvas.height / 2 + 50);
}

// Game loop
function gameLoop(timestamp) {
    if (gameOver) {
        cancelAnimationFrame(gameLoopId);
        return;
    }
    
    if (!isPaused && timestamp - lastDropTime > dropInterval) {
        if (!movePiece(0, 1)) {
            lockPiece();
        }
        lastDropTime = timestamp;
    }
    
    drawBoard();
    drawPiece(currentPiece);
    drawNextPiece();
    
    gameLoopId = requestAnimationFrame(gameLoop);
}

// Start game
function startGame() {
    initBoard();
    score = 0;
    lines = 0;
    level = 1;
    gameOver = false;
    isPaused = false;
    dropInterval = 1000;
    lastDropTime = 0;
    
    currentPiece = randomPiece();
    nextPiece = randomPiece();
    
    updateStats();
    
    if (gameLoopId) {
        cancelAnimationFrame(gameLoopId);
    }
    
    gameLoopId = requestAnimationFrame(gameLoop);
}

// Keyboard controls
document.addEventListener('keydown', (e) => {
    if (gameOver && e.key.toLowerCase() === 'r') {
        startGame();
        return;
    }
    
    if (gameOver || isPaused) return;
    
    switch(e.key) {
        case 'ArrowLeft':
            e.preventDefault();
            movePiece(-1, 0);
            break;
        case 'ArrowRight':
            e.preventDefault();
            movePiece(1, 0);
            break;
        case 'ArrowDown':
            e.preventDefault();
            if (movePiece(0, 1)) {
                score += 1;
                updateStats();
            }
            break;
        case 'ArrowUp':
            e.preventDefault();
            currentPiece = rotate(currentPiece);
            break;
        case ' ':
            e.preventDefault();
            hardDrop();
            break;
    }
});

// Mobile controls
const mobileControls = document.getElementById('mobileControls');
if (mobileControls) {
    const buttons = mobileControls.querySelectorAll('.dpad-btn');
    
    buttons.forEach(btn => {
        const direction = btn.dataset.direction;
        
        const handleInput = (e) => {
            if (gameOver || isPaused || !direction) return;
            
            switch(direction) {
                case 'left':
                    movePiece(-1, 0);
                    break;
                case 'right':
                    movePiece(1, 0);
                    break;
                case 'down':
                    if (movePiece(0, 1)) {
                        score += 1;
                        updateStats();
                    }
                    break;
                case 'up':
                    currentPiece = rotate(currentPiece);
                    break;
            }
        };
        
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleInput(e);
        }, { passive: false });
        
        btn.addEventListener('click', handleInput);
    });
}

// Action buttons
const rotateBtn = document.getElementById('rotateBtn');
const dropBtn = document.getElementById('dropBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');

if (rotateBtn) {
    rotateBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!gameOver && !isPaused) {
            currentPiece = rotate(currentPiece);
        }
    }, { passive: false });
    
    rotateBtn.addEventListener('click', () => {
        if (!gameOver && !isPaused) {
            currentPiece = rotate(currentPiece);
        }
    });
}

if (dropBtn) {
    dropBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        hardDrop();
    }, { passive: false });
    
    dropBtn.addEventListener('click', hardDrop);
}

if (pauseBtn) {
    pauseBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!gameOver) {
            isPaused = !isPaused;
            pauseBtn.textContent = isPaused ? 'RESUME' : 'PAUSE';
        }
    }, { passive: false });
    
    pauseBtn.addEventListener('click', () => {
        if (!gameOver) {
            isPaused = !isPaused;
            pauseBtn.textContent = isPaused ? 'RESUME' : 'PAUSE';
        }
    });
}

if (restartBtn) {
    restartBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startGame();
        if (pauseBtn) pauseBtn.textContent = 'PAUSE';
    }, { passive: false });
    
    restartBtn.addEventListener('click', () => {
        startGame();
        if (pauseBtn) pauseBtn.textContent = 'PAUSE';
    });
}

// Start game on load
startGame();