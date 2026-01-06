/**
 * Mason & Dixon - Maintenance & Diagnostics Bot
 *
 * "Mason & Dixon repeatedly returns to surveyors, assistants, instrument handlers,
 * cooks, and camp staff. These figures maintain the measurement apparatus and the
 * daily functioning of the expedition. The line itself depends on constant upkeep,
 * recalibration, and correction."
 *
 * This bot monitors Bot Sportello's logs, diagnoses issues, and proposes calibrations
 * in the authentic voice of Mason & Dixon from Pynchon's novel.
 */

import 'dotenv/config';
import { PostgresListener } from './services/postgresListener.js';
import { MySQLStorage } from './services/mysqlStorage.js';
import { DiscordClient } from './services/discordClient.js';
import { MasonDixonAgent } from './agent/index.js';
import { AnalysisLoop } from './agent/analysisLoop.js';
import type { MasonDixonConfig } from './types/index.js';

// ============ CONFIGURATION ============

function loadConfig(): MasonDixonConfig {
    const required = [
        'MASON_DIXON_DISCORD_TOKEN',
        'MASON_DIXON_CLIENT_ID',
        'SPORTELLO_CHANNEL_ID',
        'DIAGNOSTICS_CHANNEL_ID',
        'MYSQL_URL',
        'SPORTELLO_DATABASE_URL',
        'OPENROUTER_API_KEY'
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error('Missing required environment variables:', missing.join(', '));
        process.exit(1);
    }

    return {
        discord: {
            token: process.env.MASON_DIXON_DISCORD_TOKEN!,
            clientId: process.env.MASON_DIXON_CLIENT_ID!,
            sportelloChannelId: process.env.SPORTELLO_CHANNEL_ID!,
            diagnosticsChannelId: process.env.DIAGNOSTICS_CHANNEL_ID!
        },
        mysql: {
            url: process.env.MYSQL_URL!
        },
        postgres: {
            url: process.env.SPORTELLO_DATABASE_URL!
        },
        openrouter: {
            apiKey: process.env.OPENROUTER_API_KEY!,
            model: process.env.MASON_DIXON_MODEL ?? 'anthropic/claude-haiku'
        },
        analysis: {
            intervalMs: parseInt(process.env.ANALYSIS_INTERVAL_MS ?? '5000', 10),
            maxEventBuffer: parseInt(process.env.MAX_EVENT_BUFFER ?? '100', 10)
        },
        logLevel: (process.env.LOG_LEVEL ?? 'info') as MasonDixonConfig['logLevel']
    };
}

// ============ MAIN ============

async function main(): Promise<void> {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  MASON & DIXON - Maintenance & Diagnostics Bot');
    console.log('  "The bodily labour that makes abstraction possible"');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    const config = loadConfig();

    // Initialize services
    const pgListener = new PostgresListener(config.postgres.url);
    const mysql = new MySQLStorage(config.mysql.url);
    const discord = new DiscordClient(config.discord);

    // Connect to databases
    console.log('[INIT] Connecting to databases...');
    await mysql.connect();
    await pgListener.connect();

    // Connect to Discord
    console.log('[INIT] Connecting to Discord...');
    await discord.connect();

    // Start observation session
    const sportelloSessionId = await pgListener.getCurrentSportelloSession();
    const sessionId = await mysql.startSession(sportelloSessionId ?? undefined);
    console.log(`[INIT] Session started: ${sessionId}`);

    // Initialize agent with OpenRouter
    const agent = new MasonDixonAgent(
        {
            apiKey: config.openrouter.apiKey,
            model: config.openrouter.model
        },
        mysql,
        discord
    );

    // Initialize analysis loop
    const analysisLoop = new AnalysisLoop(
        pgListener,
        mysql,
        agent,
        config.analysis
    );

    // Set up Discord mention handler
    discord.onMention(async (message) => {
        console.log(`[DISCORD] Mention received from ${message.author.username}`);

        const content = message.content.replace(/<@!?\d+>/g, '').trim();
        const response = await agent.handleMention(content, sessionId);

        // Reply to the message
        await discord.replyToMessage(
            message.channel.id,
            message.id,
            response
        );

        // Log discourse
        await mysql.logDiscourse({
            session_id: sessionId,
            speaker: 'joint',
            content: response,
            intent: 'observation',
            channel_id: message.channel.id,
            message_id: message.id
        });
    });

    // Start analysis loop
    await analysisLoop.start(sessionId);

    // Send startup message
    await discord.sendObservation(
        `**Mr. Mason observes:** "The Instruments are now calibrated and ready for Observation. We shall monitor Bot Sportello's operations with utmost Diligence."\n\n**Mr. Dixon remarks:** "Aye, let us see what Maladies the Apparatus reveals. I've a feeling 'twill be an eventful Watch."`,
        'info'
    );

    console.log('');
    console.log('[READY] Mason & Dixon are now observing Bot Sportello');
    console.log('[READY] Analysis interval:', config.analysis.intervalMs, 'ms');
    console.log('[READY] Max event buffer:', config.analysis.maxEventBuffer);
    console.log('');

    // ============ GRACEFUL SHUTDOWN ============

    const shutdown = async (signal: string): Promise<void> => {
        console.log(`\n[SHUTDOWN] Received ${signal}, shutting down gracefully...`);

        // Stop analysis loop
        analysisLoop.stop();

        // Send shutdown message
        try {
            await discord.sendObservation(
                `**Jointly concluded:** "The Watch hath ended. We retire to review our Observations and prepare for the next Session. The Apparatus continues without our immediate Supervision - may it fare well."`,
                'info'
            );
        } catch {
            // Ignore errors during shutdown
        }

        // End session with summaries
        const recentFindings = await mysql.getRecentFindings({ sessionId, limit: 100 });
        const criticalCount = recentFindings.filter(f => f.severity === 'critical' || f.severity === 'catastrophic').length;
        const warningCount = recentFindings.filter(f => f.severity === 'warning').length;

        const masonSummary = `Session concluded with ${recentFindings.length} Findings recorded: ${criticalCount} Critical, ${warningCount} Warnings. The mathematical Analysis suggests overall stability with localized Anomalies.`;
        const dixonSummary = `A productive Watch, though I remain skeptical of the Machine's long-term Reliability. The Users do place considerable Burden upon it.`;

        await mysql.endSession(sessionId, masonSummary, dixonSummary);

        // Disconnect services
        await discord.disconnect();
        await pgListener.disconnect();
        await mysql.disconnect();

        console.log('[SHUTDOWN] Shutdown complete');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
        console.error('[ERROR] Uncaught exception:', error);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('[ERROR] Unhandled rejection:', reason);
    });
}

// Run
main().catch((error) => {
    console.error('[FATAL] Startup error:', error);
    process.exit(1);
});
