// Sudoku Game - A JavaScript Implementation
// Created via Bot Sportello

class SudokuGame {
    constructor() {
        this.grid = Array(9).fill().map(() => Array(9).fill(0));
        this.solution = Array(9).fill().map(() => Array(9).fill(0));
        this.given = Array(9).fill().map(() => Array(9).fill(false));
        this.selectedCell = null;
        
        this.init();
    }
    
    init() {
        this.createGrid();
        this.generatePuzzle();
        this.renderGrid();
        this.bindEvents();
    }
    
    createGrid() {
        const gridContainer = document.getElementById('sudokuGrid');
        gridContainer.innerHTML = '';
        
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                cell.addEventListener('click', () => this.selectCell(row, col));
                gridContainer.appendChild(cell);
            }
        }
    }
    
    generatePuzzle() {
        // Generate a complete valid sudoku solution
        this.generateSolution();
        
        // Copy solution to grid
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                this.grid[row][col] = this.solution[row][col];
            }
        }
        
        // Remove numbers to create puzzle (keeping ~30-35 cells filled)
        const cellsToRemove = 81 - (30 + Math.floor(Math.random() * 6));
        const cells = [];
        
        // Create list of all cells
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                cells.push([row, col]);
            }
        }
        
        // Shuffle and remove cells
        for (let i = 0; i < cellsToRemove; i++) {
            const randomIndex = Math.floor(Math.random() * cells.length);
            const [row, col] = cells.splice(randomIndex, 1)[0];
            this.grid[row][col] = 0;
        }
        
        // Mark given numbers (the ones that remain)
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                this.given[row][col] = this.grid[row][col] !== 0;
            }
        }
    }
    
    generateSolution() {
        // Fill diagonal 3x3 boxes first (they don't interfere with each other)
        this.fillDiagonalBoxes();
        
        // Fill remaining cells
        this.solveSudoku(this.solution);
    }
    
    fillDiagonalBoxes() {
        for (let box = 0; box < 9; box += 3) {
            this.fillBox(this.solution, box, box);
        }
    }
    
    fillBox(grid, row, col) {
        const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        // Shuffle numbers
        for (let i = numbers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
        }
        
        let index = 0;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                grid[row + i][col + j] = numbers[index++];
            }
        }
    }
    
    solveSudoku(grid) {
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (grid[row][col] === 0) {
                    const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
                    // Shuffle for random solution
                    for (let i = numbers.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
                    }
                    
                    for (const num of numbers) {
                        if (this.isValidMove(grid, row, col, num)) {
                            grid[row][col] = num;
                            if (this.solveSudoku(grid)) {
                                return true;
                            }
                            grid[row][col] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }
    
    isValidMove(grid, row, col, num) {
        // Check row
        for (let x = 0; x < 9; x++) {
            if (grid[row][x] === num) return false;
        }
        
        // Check column
        for (let x = 0; x < 9; x++) {
            if (grid[x][col] === num) return false;
        }
        
        // Check 3x3 box
        const startRow = row - row % 3;
        const startCol = col - col % 3;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (grid[i + startRow][j + startCol] === num) return false;
            }
        }
        
        return true;
    }
    
    selectCell(row, col) {
        if (this.given[row][col]) return; // Cannot select given numbers
        
        // Remove previous selection
        document.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('selected');
        });
        
        // Select new cell
        this.selectedCell = { row, col };
        const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        cell.classList.add('selected');
    }
    
    placeNumber(num) {
        if (!this.selectedCell) return;
        
        const { row, col } = this.selectedCell;
        if (this.given[row][col]) return;
        
        this.grid[row][col] = num;
        this.renderGrid();
        this.checkConflicts();
        
        // Check if puzzle is solved
        if (this.isPuzzleSolved()) {
            setTimeout(() => {
                alert('Congratulations! You solved the puzzle!');
            }, 100);
        }
    }
    
    clearCell() {
        if (!this.selectedCell) return;
        
        const { row, col } = this.selectedCell;
        if (this.given[row][col]) return;
        
        this.grid[row][col] = 0;
        this.renderGrid();
        this.checkConflicts();
    }
    
    renderGrid() {
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
                const value = this.grid[row][col];
                
                cell.textContent = value === 0 ? '' : value;
                cell.className = 'cell';
                
                if (this.given[row][col]) {
                    cell.classList.add('given');
                }
                
                if (this.selectedCell && this.selectedCell.row === row && this.selectedCell.col === col) {
                    cell.classList.add('selected');
                }
                
                // Add visual separation for 3x3 boxes
                if (col % 3 === 2 && col < 8) {
                    cell.style.borderRight = '2px solid #7dd3a0';
                }
                if (row % 3 === 2 && row < 8) {
                    cell.style.borderBottom = '2px solid #7dd3a0';
                }
            }
        }
    }
    
    checkConflicts() {
        // Clear previous conflicts
        document.querySelectorAll('.cell').forEach(cell => {
            cell.classList.remove('conflict');
        });
        
        // Check for conflicts
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                const value = this.grid[row][col];
                if (value === 0) continue;
                
                // Check if this position has conflicts
                let hasConflict = false;
                
                // Check row conflicts
                for (let x = 0; x < 9; x++) {
                    if (x !== col && this.grid[row][x] === value) {
                        hasConflict = true;
                        break;
                    }
                }
                
                // Check column conflicts
                if (!hasConflict) {
                    for (let x = 0; x < 9; x++) {
                        if (x !== row && this.grid[x][col] === value) {
                            hasConflict = true;
                            break;
                        }
                    }
                }
                
                // Check 3x3 box conflicts
                if (!hasConflict) {
                    const startRow = row - row % 3;
                    const startCol = col - col % 3;
                    for (let i = 0; i < 3; i++) {
                        for (let j = 0; j < 3; j++) {
                            const r = i + startRow;
                            const c = j + startCol;
                            if ((r !== row || c !== col) && this.grid[r][c] === value) {
                                hasConflict = true;
                                break;
                            }
                        }
                        if (hasConflict) break;
                    }
                }
                
                if (hasConflict) {
                    const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
                    cell.classList.add('conflict');
                }
            }
        }
    }
    
    isPuzzleSolved() {
        // Check if grid is full
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                if (this.grid[row][col] === 0) return false;
            }
        }
        
        // Check if there are any conflicts
        const conflicts = document.querySelectorAll('.cell.conflict');
        return conflicts.length === 0;
    }
    
    checkSolution() {
        const isSolved = this.isPuzzleSolved();
        if (isSolved) {
            alert('Perfect! The puzzle is solved correctly!');
        } else {
            alert('Not quite right. Keep trying!');
        }
    }
    
    newGame() {
        this.grid = Array(9).fill().map(() => Array(9).fill(0));
        this.solution = Array(9).fill().map(() => Array(9).fill(0));
        this.given = Array(9).fill().map(() => Array(9).fill(false));
        this.selectedCell = null;
        
        this.generatePuzzle();
        this.renderGrid();
    }
    
    bindEvents() {
        // Number pad buttons
        document.querySelectorAll('.number-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const number = parseInt(btn.dataset.number);
                this.placeNumber(number);
            });
        });
        
        // Control buttons
        document.getElementById('newGame').addEventListener('click', () => this.newGame());
        document.getElementById('clearCell').addEventListener('click', () => this.clearCell());
        document.getElementById('checkSolution').addEventListener('click', () => this.checkSolution());
        
        // Keyboard input
        document.addEventListener('keydown', (e) => {
            if (e.key >= '1' && e.key <= '9') {
                this.placeNumber(parseInt(e.key));
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                this.clearCell();
            }
        });
    }
}

// Initialize game when page loads
window.addEventListener('load', () => {
    new SudokuGame();
});