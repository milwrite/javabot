/**
 * CSS Classes Reference Module
 * page-theme.css class catalog for content creation
 * Extracted from systemPrompt.js lines 65-191
 */

module.exports = `PAGE STRUCTURE (use these classes in this order):
1. <body> with optional .story-page for text-heavy content
2. .container (max-width: 1200px, centered) - main wrapper
3. .content (max-width: 800px) OR .main-content (grid layout) - inner content
4. .section, .card, or .panel - content blocks with noir styling
5. Component-specific classes inside (buttons, forms, lists, etc.)

Available CSS Classes (COMPREHENSIVE):

LAYOUT CONTAINERS:
- .container - max-width 1200px, centered, z-index layering
- .content - max-width 800px for readable content
- .main-content - CSS grid for multi-column layouts
- .story-page (body class) - centers story content on all viewports
- .story-container - max-width 720px for story/narrative pages
- .header - hero section with gradient background
- .footer - bottom section with top border
- .sidebar - sidebar layout with min-width 250px
- .section - content section with fade-in animation
- .card, .panel - content blocks with shimmer effect

STORY PAGE COMPONENTS (for narratives):
- .chapter - story sections with bottom margin
- .chapter-title - colored section headings
- .paragraph - story paragraphs with proper spacing

TYPOGRAPHY (auto-styled):
- h1, h2, h3 - headers with color, shadow, letterspace
- p - paragraphs with max-width 70ch for readability
- .subtitle, .message - secondary text styles
- .date-display - time/date display styling

BUTTONS (use appropriate variant):
- .btn - base button style with red background
- .btn-primary - explicit red background
- .btn-secondary - transparent with border
- .btn-yes - green/blue positive action
- .btn-no - red negative action
- .btn-reset - cyan reset/clear action
- .btn-add - blue add action
- .btn-print, .clear-all-btn - utility actions
- .filter-btn - filter toggle with .active state
- .difficulty-btn - game difficulty selector
- .control-btn - game control buttons (60px touch targets)
- .mobile-btn - mobile-specific actions (50px min-height)
- .number-btn - number pad buttons (60x60px grid)

FORMS & INPUTS:
- input, textarea, select - auto-styled form controls
- .input-group - horizontal input + button layout
- .form-group - vertical label + input layout
- .slider-group - slider with label and value display
- .slider-header - slider label row
- .slider-value - slider value badge
- .priority-select - styled select dropdown
- .add-task-form - form container with border

INTERACTIVE LISTS:
- .todos-list, .task-list - list containers
- .todo-item, .task-item, .task - list items with hover effects
- .task-content, .todo-text, .task-text - item text content
- .task-title - bold item title
- .task-description - item description text
- .task-meta - metadata row (duration, badges)
- .task-actions - action button row
- .task-checkbox, .checkbox - checkboxes with accent color
- .ingredients-list, .steps-list - recipe/instruction lists
- .step-item - numbered step with .step-number and .step-content

STATS & DATA:
- .stats, .stats-grid - grid layout for stat boxes
- .stat-box, .stat-card, .stat - individual stat containers
- .stat-number, .stat-value - large stat numbers (2em, cyan glow)
- .stat-label, .label - stat labels (uppercase, small)
- .progress-bar - bar container with border
- .progress-fill - animated fill with gradient
- .timeline - vertical timeline container
- .timeline-item - timeline entries with hover effects
- .timeline-header - timeline section header
- .hour-slot, .time-slot - schedule time blocks
- .time-badge - time display badges

CARDS & PANELS:
- .card, .panel - content blocks with shimmer animation
- .input-section - input form section
- .todos-section - todos wrapper section
- .filter-section - filter button row
- .controls-card, .visualization-card - specialized cards
- .memory-card - interactive memory/content cards
- .summary-card - highlight summary with gradient bg

BADGES & INDICATORS:
- .priority-badge - priority indicator
- .priority-low, .priority-medium, .priority-high - priority colors
- .category-badge - category labels
- .category-work, .category-personal, .category-health - category variants
- .time-badge - time display badge

MODALS & OVERLAYS:
- .modal - full-screen modal overlay (display: none by default)
- .modal.active - shows modal (display: flex)
- .modal-content - modal inner box with border
- .modal-header - modal header with close button
- .close-btn - modal close button
- .notification - fixed notification toast
- .game-over-modal - game end modal variant
- .empty-state - empty state message with icon

INFO BOXES:
- .tips-box - tips/help box
- .success-message, .completion-message - success indicators (.show class reveals)
- .insight-box - insight/info with left border
- .warning-box - warning with red left border

GAME COMPONENTS:
- .game-wrapper - game container with flex column
- .game-container - game layout wrapper
- .difficulty-selector - difficulty button row
- .controls - game control button row
- .info-panel - game instructions panel
- canvas - auto-styled with border and shadow
- .sudoku-grid - 9x9 grid for sudoku
- .cell - grid cells with hover/selected states
- .cell.given - pre-filled puzzle cells
- .cell.selected - selected cell state
- .number-pad - 3x3 number input grid`;
