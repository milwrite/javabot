# Mason & Dixon

> "Mason & Dixon repeatedly returns to surveyors, assistants, instrument handlers, cooks, and camp staff. These figures maintain the measurement apparatus and the daily functioning of the expedition. The line itself depends on constant upkeep, recalibration, and correction. The novel is attentive to the bodily and logistical labor that makes abstraction possible."

A maintenance and diagnostics bot that monitors Bot Sportello's logs, diagnoses issues, and proposes calibrations - speaking in the authentic dual voice of Charles Mason and Jeremiah Dixon from Thomas Pynchon's novel.

## Features

- **Real-time Log Monitoring**: Listens to Bot Sportello's PostgreSQL NOTIFY events
- **Dual-Voice Analysis**: Mason provides precise mathematical analysis; Dixon offers skeptical practical assessment
- **Pattern Detection**: Identifies error patterns, tool failures, and performance anomalies
- **Calibration Proposals**: Recommends configuration adjustments with confidence scores
- **Discord Integration**: Posts observations to a diagnostics channel
- **MySQL Persistence**: Stores findings, calibrations, and instrument readings for historical analysis

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Mason & Dixon Bot                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  PostgreSQL  │───▶│   Analysis   │───▶│    Claude    │  │
│  │   Listener   │    │     Loop     │    │    Agent     │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    MySQL Storage                      │  │
│  │  (findings, calibrations, readings, discourse)        │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Discord Client                      │  │
│  │  (diagnostics channel + Sportello monitoring)         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## External Setup Required

### 1. Discord Bot Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application named "Mason & Dixon"
3. Go to **Bot** → Create bot
4. Enable intents: **Server Members**, **Message Content**
5. Copy the bot token → `MASON_DIXON_DISCORD_TOKEN`
6. Copy the application ID → `MASON_DIXON_CLIENT_ID`
7. Generate invite link with permissions: Send Messages, Read Message History, Add Reactions
8. Invite bot to your server

### 2. Discord Channel Setup

Create a new channel for diagnostics output:
- Name: `#diagnostics` or `#surveyors-log`
- Copy channel ID → `DIAGNOSTICS_CHANNEL_ID`
- Copy Sportello's channel ID → `SPORTELLO_CHANNEL_ID`

### 3. MySQL Database (Railway)

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Create new project → Add MySQL database
3. Copy connection URL → `MYSQL_URL`
4. Run the schema:
   ```bash
   mysql -u root -p mason_dixon < scripts/schema.sql
   ```

### 4. OpenRouter API Key

**Reuse your existing Bot Sportello key!**

1. Go to [OpenRouter Keys](https://openrouter.ai/keys)
2. Use existing key OR create new key
3. Copy key → `OPENROUTER_API_KEY`

OpenRouter routes to Claude via their Anthropic-compatible API, so you can use:
- Same key as Bot Sportello
- Same billing dashboard
- Same model selection flexibility

## Installation

```bash
# Navigate to mason-dixon directory
cd mason-dixon

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your values
nano .env

# Run schema migration
# (requires MySQL client installed)
mysql -h <host> -u <user> -p <database> < scripts/schema.sql
```

## Environment Variables

```bash
# Discord (new bot application)
MASON_DIXON_DISCORD_TOKEN=your_bot_token
MASON_DIXON_CLIENT_ID=your_client_id
SPORTELLO_CHANNEL_ID=channel_to_monitor
DIAGNOSTICS_CHANNEL_ID=output_channel

# MySQL (Railway)
MYSQL_URL=mysql://user:pass@host:port/mason_dixon

# Sportello's PostgreSQL (read-only)
SPORTELLO_DATABASE_URL=postgresql://user:pass@host:port/database

# OpenRouter (reuse from Bot Sportello!)
OPENROUTER_API_KEY=your_openrouter_key

# Model selection (default: anthropic/claude-sonnet-4)
# Options: anthropic/claude-opus-4, anthropic/claude-sonnet-4, anthropic/claude-haiku
# Or any model with tool use: https://openrouter.ai/models?supported_parameters=tools
MASON_DIXON_MODEL=anthropic/claude-sonnet-4

# Optional
ANALYSIS_INTERVAL_MS=5000
MAX_EVENT_BUFFER=100
LOG_LEVEL=info
```

## Running

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start

# Type checking
npm run typecheck
```

## Example Output

### Finding Report
```
**Mr. Mason observes:** "The Chronometer of Tool Calls hath recorded a most
concerning Pattern. The `edit_file` Instrument exhibits a Failure Rate of
23.7 per cent over the past Hour, with a mean Duration of 4,200 Milliseconds -
some 340 per cent above the established Baseline."

**Mr. Dixon remarks:** "Aye, but note the Hour, Mason. 'Tis the American Morning,
when Petitioners descend upon the Machine in great Numbers. Perhaps the Fault
lies not in our Instruments but in the Burden placed upon them."

**Jointly concluded:** "We propose monitoring for an additional Hour before
recommending Calibration. Confidence: 65 per cent."
```

### Calibration Proposal
```
📐 CALIBRATION PROPOSAL

Instrument: timeout_config
Current Setting: 30000ms
Proposed Adjustment: 45000ms

Mr. Mason's Assessment: The mathematical Analysis of 147 timeout Events
indicates a systematic undersizing of the temporal Allocation during peak
Hours of 13:00-17:00 UTC.

Mr. Dixon's Assessment: In practical Terms, the Americans are simply too
eager with their Requests. Extending the Timeout is a reasonable Accommodation.

Confidence: 78% | Priority: MEDIUM
```

## Database Schema

### Tables
- **sessions** - Observation sessions linked to Sportello sessions
- **findings** - Diagnostic findings with dual-voice analysis
- **calibrations** - Proposed adjustments with status tracking
- **instrument_readings** - Time-series metrics
- **discourse_log** - Communication history

### Views
- **recent_critical_findings** - Critical findings from last 24h
- **tool_performance_summary** - Aggregated tool metrics
- **pending_calibrations** - Unresolved calibration proposals

## Project Structure

```
mason-dixon/
├── src/
│   ├── index.ts              # Entry point
│   ├── agent/
│   │   ├── index.ts          # Claude agent integration
│   │   └── analysisLoop.ts   # Event buffer & analysis cycle
│   ├── services/
│   │   ├── postgresListener.ts   # NOTIFY/LISTEN client
│   │   ├── mysqlStorage.ts       # MySQL data layer
│   │   └── discordClient.ts      # Discord.js wrapper
│   ├── personality/
│   │   ├── index.ts          # Dual voice assembler
│   │   ├── mason.ts          # Mason's voice
│   │   ├── dixon.ts          # Dixon's voice
│   │   └── dialect.ts        # Period language transforms
│   ├── analysis/
│   │   ├── errorPatterns.ts      # Error pattern detection
│   │   ├── toolMetrics.ts        # Tool performance analysis
│   │   └── anomalyDetection.ts   # Statistical anomaly detection
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── scripts/
│   └── schema.sql            # MySQL schema
├── package.json
├── tsconfig.json
└── .env.example
```

## The Literary Concept

From Pynchon's *Mason & Dixon*:

> "The Line is a living thing. It must be fed, watered, and defended. It requires constant upkeep, recalibration, and correction."

This bot embodies the "instrument handlers" and "camp staff" who maintain the measurement apparatus. While Bot Sportello performs the abstract work of AI-assisted development, Mason & Dixon attend to the bodily labor of diagnostics - the recalibration, the correction, the constant upkeep.

**Mason** (Charles Mason, astronomer):
- Precise, mathematical, measurement-focused
- "By my calculations...", quantified findings
- Derives patterns through systematic observation

**Dixon** (Jeremiah Dixon, surveyor):
- Skeptical, practical, considers human factors
- "Aye, but...", questions assumptions
- Values solutions that work over elegant theories

Together, they form a dialectic of analysis: one voice quantifies, the other contextualizes.

## License

MIT
