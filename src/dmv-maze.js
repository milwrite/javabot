// DMV Maze of Despair - Game Logic
// Bot Sportello's Noir Arcade Collection

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const scoreDiv = document.getElementById('score');

// Game constants
const CELL_SIZE = 40;
const GRID_WIDTH = 15;
const GRID_HEIGHT = 11;
canvas.width = GRID_WIDTH * CELL_SIZE;
canvas.height = GRID_HEIGHT * CELL_SIZE;

// Colors
const COLORS = {
    wall: '#1a1a1a',
    floor: '#0a0a0a',
    player: '#7ec8e3',
    form: '#00ffff',
    npc: '#ff0000',
    exit: '#00ff00',
    grid: '#333333'
};

// Game state
let player = { x: 1, y: 1 };
let forms = [];
let npcs = [];
let maze = [];
let collectedForms = new Set();
let stats = {
    formsCollected: 0,
    npcsEncountered: 0,
    restarts: 0,
    mazeNumber: 1
};
let exitRevealed = false;
let exitPos = null;
let currentMessage = 'Navigate with arrow keys. Collect forms A-27, B-14, and C-9.';
let messageTimer = 0;

const FORM_TYPES = ['A-27', 'B-14', 'C-9'];
const FRUSTRATION_MESSAGES = [
    'Wrong form. Back to the start.',
    'That\'s not the right form. Try again.',
    'You need a different form. Starting over.',
    'Wrong documentation. Return to beginning.',
    'Invalid form submitted. Restart required.',
    'Not the form they wanted. Back to square one.',
    'Incorrect paperwork. Begin again.',
    'That form won\'t work here. Restart.',
    'Wrong form number. Return to entrance.',
    'They need a different form. Starting fresh.'
];

const EXIT_MESSAGES = [
    'You found the exit! But wait...',
    'Freedom at last! Or is it?',
    'The exit! Finally! But...',
    'You\'re free! Just kidding.',
    'Escape! ...to another maze.',
    'Exit found! Welcome to Maze #',
    'You made it! Time for more bureaucracy.',
    'Freedom! Psyche. New maze loading...'
];

// Maze generation using recursive backtracking
function generateMaze() {
    // Initialize grid with all walls
    maze = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH).fill(1));
    
    const stack = [];
    const startX = 1;
    const startY = 1;
    
    maze[startY][startX] = 0;
    stack.push([startX, startY]);
    
    const directions = [
        [0, -2], [2, 0], [0, 2], [-2, 0]
    ];
    
    while (stack.length > 0) {
        const [x, y] = stack[stack.length - 1];
        const neighbors = [];
        
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            
            if (nx > 0 && nx < GRID_WIDTH - 1 && ny > 0 && ny < GRID_HEIGHT - 1 && maze[ny][nx] === 1) {
                neighbors.push([nx, ny, x + dx/2, y + dy/2]);
            }
        }
        
        if (neighbors.length > 0) {
            const [nx, ny, wx, wy] = neighbors[Math.floor(Math.random() * neighbors.length)];
            maze[ny][nx] = 0;
            maze[wy][wx] = 0;
            stack.push([nx, ny]);
        } else {
            stack.pop();
        }
    }
    
    // Ensure start position is clear
    maze[1][1] = 0;
}

function placeFormsAndNPCs() {
    forms = [];
    npcs = [];
    collectedForms.clear();
    exitRevealed = false;
    exitPos = null;
    
    const positions = [];
    
    // Find all floor positions (excluding start)
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
        for (let x = 1; x < GRID_WIDTH - 1; x++) {
            if (maze[y][x] === 0 && !(x === 1 && y === 1)) {
                positions.push({ x, y });
            }
        }
    }
    
    // Shuffle positions
    for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    
    // Place forms (3 forms)
    for (let i = 0; i < 3 && i < positions.length; i++) {
        forms.push({
            ...positions[i],
            type: FORM_TYPES[i]
        });
    }
    
    // Place NPCs (4-6 NPCs)
    const npcCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 3; i < 3 + npcCount && i < positions.length; i++) {
        const requiredForm = FORM_TYPES[Math.floor(Math.random() * FORM_TYPES.length)];
        npcs.push({
            ...positions[i],
            requiredForm: requiredForm,
            message: `I need form ${requiredForm}.`
        });
    }
}

function resetGame(showMessage = true) {
    stats.restarts++;
    stats.mazeNumber++;
    player = { x: 1, y: 1 };
    generateMaze();
    placeFormsAndNPCs();
    
    if (showMessage) {
        const msg = FRUSTRATION_MESSAGES[Math.floor(Math.random() * FRUSTRATION_MESSAGES.length)];
        setMessage(msg, 3000);
    }
    
    updateScore();
}

function setMessage(msg, duration = 3000) {
    currentMessage = msg;
    messageTimer = duration;
}

function checkNPCCollision() {
    for (let npc of npcs) {
        if (player.x === npc.x && player.y === npc.y) {
            stats.npcsEncountered++;
            
            if (collectedForms.has(npc.requiredForm)) {
                setMessage(`Clerk: "Ah yes, form ${npc.requiredForm}. Proceed."`, 2000);
                // Remove this NPC
                npcs = npcs.filter(n => n !== npc);
                return true;
            } else {
                // Wrong form or no form - restart
                setMessage(`Clerk: "${npc.message}" You don't have it. Back to start!`, 3000);
                setTimeout(() => resetGame(false), 1000);
                return false;
            }
        }
    }
    return true;
}

function checkFormCollection() {
    for (let i = forms.length - 1; i >= 0; i--) {
        if (player.x === forms[i].x && player.y === forms[i].y) {
            const formType = forms[i].type;
            collectedForms.add(formType);
            stats.formsCollected++;
            forms.splice(i, 1);
            
            setMessage(`Collected form ${formType}!`, 2000);
            
            // Check if all forms collected
            if (collectedForms.size === 3) {
                revealExit();
            }
            
            updateScore();
            return;
        }
    }
}

function revealExit() {
    exitRevealed = true;
    
    // Find furthest floor position from player
    let maxDist = 0;
    let bestPos = null;
    
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
        for (let x = 1; x < GRID_WIDTH - 1; x++) {
            if (maze[y][x] === 0) {
                const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
                if (dist > maxDist) {
                    maxDist = dist;
                    bestPos = { x, y };
                }
            }
        }
    }
    
    exitPos = bestPos || { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2 };
    setMessage('All forms collected! The EXIT has appeared!', 4000);
}

function checkExit() {
    if (exitRevealed && exitPos && player.x === exitPos.x && player.y === exitPos.y) {
        const msg = EXIT_MESSAGES[Math.floor(Math.random() * EXIT_MESSAGES.length)];
        setMessage(msg + stats.mazeNumber, 3000);
        setTimeout(() => resetGame(false), 1500);
    }
}

function movePlayer(dx, dy) {
    const newX = player.x + dx;
    const newY = player.y + dy;
    
    // Check bounds and walls
    if (newX >= 0 && newX < GRID_WIDTH && newY >= 0 && newY < GRID_HEIGHT && maze[newY][newX] === 0) {
        player.x = newX;
        player.y = newY;
        
        checkFormCollection();
        checkNPCCollision();
        checkExit();
    }
}

function updateScore() {
    scoreDiv.innerHTML = `
        Forms: ${collectedForms.size}/3 (${Array.from(collectedForms).join(', ') || 'none'}) | 
        Total Collected: ${stats.formsCollected} | 
        NPCs: ${stats.npcsEncountered} | 
        Restarts: ${stats.restarts} | 
        Maze: #${stats.mazeNumber}
    `;
}

function update(deltaTime) {
    if (messageTimer > 0) {
        messageTimer -= deltaTime;
        if (messageTimer <= 0) {
            currentMessage = 'Collect forms. Avoid wrong forms. Find the exit... if you can.';
        }
    }
}

function draw() {
    // Clear canvas
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw maze
    ctx.fillStyle = COLORS.wall;
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (maze[y][x] === 1) {
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }
    
    // Draw grid lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_WIDTH; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL_SIZE, 0);
        ctx.lineTo(x * CELL_SIZE, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL_SIZE);
        ctx.lineTo(canvas.width, y * CELL_SIZE);
        ctx.stroke();
    }
    
    // Draw exit if revealed
    if (exitRevealed && exitPos) {
        ctx.fillStyle = COLORS.exit;
        ctx.fillRect(exitPos.x * CELL_SIZE + 5, exitPos.y * CELL_SIZE + 5, CELL_SIZE - 10, CELL_SIZE - 10);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px "Courier Prime"';
        ctx.textAlign = 'center';
        ctx.fillText('EXIT', exitPos.x * CELL_SIZE + CELL_SIZE/2, exitPos.y * CELL_SIZE + CELL_SIZE/2 + 4);
    }
    
    // Draw forms
    ctx.fillStyle = COLORS.form;
    ctx.font = '10px "Courier Prime"';
    ctx.textAlign = 'center';
    for (let form of forms) {
        ctx.fillRect(form.x * CELL_SIZE + 8, form.y * CELL_SIZE + 8, CELL_SIZE - 16, CELL_SIZE - 16);
        ctx.fillStyle = '#000000';
        ctx.fillText(form.type, form.x * CELL_SIZE + CELL_SIZE/2, form.y * CELL_SIZE + CELL_SIZE/2 + 3);
        ctx.fillStyle = COLORS.form;
    }
    
    // Draw NPCs
    ctx.fillStyle = COLORS.npc;
    for (let npc of npcs) {
        ctx.beginPath();
        ctx.arc(npc.x * CELL_SIZE + CELL_SIZE/2, npc.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE/3, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px "Courier Prime"';
        ctx.fillText('C', npc.x * CELL_SIZE + CELL_SIZE/2, npc.y * CELL_SIZE + CELL_SIZE/2 + 5);
        ctx.fillStyle = COLORS.npc;
    }
    
    // Draw player
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(player.x * CELL_SIZE + CELL_SIZE/2, player.y * CELL_SIZE + CELL_SIZE/2, CELL_SIZE/2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw player marker
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px "Courier Prime"';
    ctx.textAlign = 'center';
    ctx.fillText('P', player.x * CELL_SIZE + CELL_SIZE/2, player.y * CELL_SIZE + CELL_SIZE/2 + 6);
    
    // Draw status message
    statusDiv.textContent = currentMessage;
}

// Keyboard controls
const keys = {};
document.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        movePlayer(0, -1);
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        movePlayer(0, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        movePlayer(-1, 0);
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        movePlayer(1, 0);
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

// Mobile touch controls
const mobileControls = document.getElementById('mobileControls');
if (mobileControls) {
    const buttons = mobileControls.querySelectorAll('.dpad-btn');
    
    buttons.forEach(btn => {
        const direction = btn.dataset.direction;
        if (!direction) return;
        
        const handleInput = () => {
            switch(direction) {
                case 'up': movePlayer(0, -1); break;
                case 'down': movePlayer(0, 1); break;
                case 'left': movePlayer(-1, 0); break;
                case 'right': movePlayer(1, 0); break;
            }
        };
        
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            btn.style.opacity = '0.6';
            handleInput();
        }, { passive: false });
        
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            btn.style.opacity = '1';
        }, { passive: false });
        
        btn.addEventListener('click', handleInput);
    });
}

// Game loop
let lastTime = 0;
function gameLoop(timestamp) {
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;
    
    update(deltaTime);
    draw();
    
    requestAnimationFrame(gameLoop);
}

// Initialize game
resetGame(false);
setMessage('Welcome to the DMV. Navigate with arrow keys. Collect forms A-27, B-14, and C-9.', 5000);
updateScore();
requestAnimationFrame(gameLoop);