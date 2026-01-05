#!/bin/bash

# Bot Sportello Launcher with Agent Logging
#
# Session tracking and logging now handled by PostgreSQL (Railway).
# Dashboard available at http://localhost:3001/dashboard
#
# Usage:
#   ./run-bot.sh                    # Start with default GUI port
#   ./run-bot.sh --gui-port 3001    # Start with custom GUI port
#   ./run-bot.sh --no-gui           # Start without dashboard server
#

echo "Bot Sportello - Agent Logging Edition"
echo "====================================="

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if required files exist
if [[ ! -f "index.js" ]]; then
    echo "index.js not found. Please run this script from the javabot directory."
    exit 1
fi

# Check if dependencies are installed
if [[ ! -d "node_modules" ]]; then
    echo "Installing dependencies..."
    npm install
    if [[ $? -ne 0 ]]; then
        echo "Failed to install dependencies."
        exit 1
    fi
fi

# Check for .env file
if [[ ! -f ".env" ]]; then
    echo ".env file not found. Please copy .env.example to .env and configure it."
    exit 1
fi

# Parse arguments
for arg in "$@"; do
    case $arg in
        --no-gui)
            export NO_GUI=true
            echo "Dashboard disabled (NO_GUI=true)"
            ;;
        --gui-port)
            shift
            export GUI_PORT=$1
            echo "Dashboard port: $GUI_PORT"
            ;;
    esac
done

echo ""
echo "Starting bot..."
echo "Dashboard: http://localhost:${GUI_PORT:-3001}/dashboard"
echo "Press Ctrl+C to stop"
echo ""

# Start bot directly (session tracking via PostgreSQL)
node index.js

echo ""
echo "Bot Sportello session ended"
