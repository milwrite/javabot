#!/bin/bash

# Bot Sportello Launcher with Log Preservation
# 
# This script starts Bot Sportello with comprehensive logging and monitoring.
# All activity is preserved, including successful operations and broken processes.
#
# Usage:
#   ./run-bot.sh                    # Start with default GUI port
#   ./run-bot.sh --gui-port 3001    # Start with custom GUI port
#   ./run-bot.sh --no-gui           # Start without GUI dashboard
#

echo "🤖 Bot Sportello Launcher with Log Preservation"
echo "================================================"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if required files exist
if [[ ! -f "index.js" ]]; then
    echo "❌ index.js not found. Please run this script from the javabot directory."
    exit 1
fi

if [[ ! -f "package.json" ]]; then
    echo "❌ package.json not found. Please run this script from the javabot directory."
    exit 1
fi

# Check if dependencies are installed
if [[ ! -d "node_modules" ]]; then
    echo "📦 Installing dependencies..."
    npm install
    if [[ $? -ne 0 ]]; then
        echo "❌ Failed to install dependencies."
        exit 1
    fi
fi

# Check for .env file
if [[ ! -f ".env" ]]; then
    echo "⚠️  .env file not found. Please copy .env.example to .env and configure it."
    echo "   Required variables: DISCORD_TOKEN, GITHUB_TOKEN, OPENROUTER_API_KEY"
    exit 1
fi

# Parse arguments
GUI_ARGS=""
for arg in "$@"; do
    case $arg in
        --no-gui)
            export NO_GUI=true
            ;;
        --gui-port)
            shift
            GUI_ARGS="--gui-port $1"
            ;;
        *)
            ;;
    esac
done

# Check if log preservation script exists
if [[ -f "log-preserv.js" ]]; then
    echo "📊 Starting with comprehensive log preservation..."
    echo "   Activity will be tracked in session-logs/ directory"
    echo "   Press Ctrl+C to stop and generate session report"
    echo ""
    
    # Use log preservation wrapper
    node log-preserv.js $GUI_ARGS
else
    echo "ℹ️  Log preservation not available (log-preserv.js not found)"
    echo "   Starting bot directly..."
    echo ""
    
    # Start bot directly
    node index.js
fi

echo ""
echo "👋 Bot Sportello session ended"