/**
 * Claude Agent Integration
 * Wraps Anthropic SDK with Mason & Dixon personality and analysis tools
 * Uses OpenRouter's Anthropic-compatible API for flexibility
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import { assembleDualVoice } from '../personality/index.js';
import type { MySQLStorage } from '../services/mysqlStorage.js';
import type { DiscordClient } from '../services/discordClient.js';
import type { SportelloEvent, ToolCallEvent, FindingSeverity, InstrumentType, CalibrationPriority } from '../types/index.js';
import { detectErrorPatterns, assessErrorSeverity } from '../analysis/errorPatterns.js';
import { calculateToolMetrics, detectSlowTools, detectFailingTools } from '../analysis/toolMetrics.js';
import { detectAnomalies, summarizeAnomalies } from '../analysis/anomalyDetection.js';

// OpenRouter base URL for Anthropic-compatible API
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

export interface AgentConfig {
    apiKey: string;
    model?: string;
    maxTokens?: number;
}

export interface AnalysisContext {
    events: SportelloEvent[];
    toolCalls: ToolCallEvent[];
    sessionId: string;
}

/**
 * Mason & Dixon Agent
 * Uses Claude via OpenRouter to analyze logs and generate findings in period voice
 */
export class MasonDixonAgent {
    private client: Anthropic;
    private model: string;
    private maxTokens: number;
    private systemPrompt: string;
    private mysql: MySQLStorage;
    private discord: DiscordClient;

    constructor(
        config: AgentConfig,
        mysql: MySQLStorage,
        discord: DiscordClient
    ) {
        // Configure Anthropic SDK to use OpenRouter's compatible endpoint
        this.client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: OPENROUTER_BASE_URL
        });
        // Default to Claude Haiku via OpenRouter model naming
        this.model = config.model ?? 'anthropic/claude-haiku';
        this.maxTokens = config.maxTokens ?? 4096;
        this.systemPrompt = assembleDualVoice();
        this.mysql = mysql;
        this.discord = discord;

        console.log(`[AGENT] Initialized with model: ${this.model} via OpenRouter`);
    }

    /**
     * Analyze a batch of events and generate findings
     */
    async analyzeEvents(context: AnalysisContext): Promise<void> {
        const { events, toolCalls, sessionId } = context;

        if (events.length === 0 && toolCalls.length === 0) {
            return;
        }

        // Pre-analyze with local utilities
        const errorPatterns = detectErrorPatterns(events);
        const toolMetrics = calculateToolMetrics(toolCalls);
        const slowTools = detectSlowTools(toolMetrics);
        const failingTools = detectFailingTools(toolMetrics);
        const anomalies = detectAnomalies(events, toolCalls);

        // Build analysis prompt
        const analysisPrompt = this.buildAnalysisPrompt({
            events,
            toolCalls,
            errorPatterns,
            toolMetrics,
            slowTools,
            failingTools,
            anomalies
        });

        // Query Claude for analysis
        const messages: MessageParam[] = [
            { role: 'user', content: analysisPrompt }
        ];

        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                system: this.systemPrompt,
                tools: this.getTools(),
                messages
            });

            // Process response
            await this.processResponse(response, sessionId);

        } catch (error) {
            console.error('[AGENT] Analysis error:', error);
        }
    }

    /**
     * Handle a direct mention from Discord
     */
    async handleMention(content: string, sessionId: string): Promise<string> {
        // Get recent findings for context
        const recentFindings = await this.mysql.getRecentFindings({ limit: 5 });
        const pendingCalibrations = await this.mysql.getPendingCalibrations();

        const contextPrompt = `
A User hath addressed you directly via Discord. Respond in your dual Mason & Dixon voice.

**User's Message:** "${content}"

**Recent Findings for Context:**
${recentFindings.length > 0
    ? recentFindings.map(f => `- ${f.title} (${f.severity})`).join('\n')
    : 'No recent findings recorded.'}

**Pending Calibrations:**
${pendingCalibrations.length > 0
    ? pendingCalibrations.map(c => `- ${c.instrument}: ${c.status}`).join('\n')
    : 'No calibrations pending.'}

Respond helpfully in period voice. If they ask about status, summarize the state of the Apparatus.
If they ask for diagnosis, offer your joint Assessment based on recent observations.
`.trim();

        const messages: MessageParam[] = [
            { role: 'user', content: contextPrompt }
        ];

        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: this.maxTokens,
                system: this.systemPrompt,
                messages
            });

            // Extract text response
            const textBlocks = response.content.filter(block => block.type === 'text');
            return textBlocks.map(block => {
                if (block.type === 'text') {
                    return block.text;
                }
                return '';
            }).join('\n');

        } catch (error) {
            console.error('[AGENT] Mention handling error:', error);
            return "Alas, the Instruments have encountered an Error in processing your Inquiry. Pray try again anon.";
        }
    }

    /**
     * Build analysis prompt from pre-analyzed data
     */
    private buildAnalysisPrompt(data: {
        events: SportelloEvent[];
        toolCalls: ToolCallEvent[];
        errorPatterns: Array<{ signature: string; count: number; category?: string }>;
        toolMetrics: Array<{ tool: string; call_count: number; error_count: number; avg_duration_ms: number | null }>;
        slowTools: Array<{ tool: string; avgMs: number; slowdown: number }>;
        failingTools: Array<{ tool: string; error_count: number; call_count: number }>;
        anomalies: Array<{ type: string; severity: string; description: string }>;
    }): string {
        return `
You are observing Bot Sportello's operational log. Analyze the following data and determine if any Findings or Calibrations are warranted.

## EVENT SUMMARY
- Total Events: ${data.events.length}
- Total Tool Calls: ${data.toolCalls.length}
- Time Period: Last observation batch

## ERROR PATTERNS DETECTED
${data.errorPatterns.length > 0
    ? data.errorPatterns.slice(0, 5).map(p =>
        `- "${p.signature}" (${p.count} occurrences${p.category ? `, category: ${p.category}` : ''})`
    ).join('\n')
    : 'No significant error patterns detected.'}

## TOOL PERFORMANCE
${data.toolMetrics.slice(0, 5).map(m =>
    `- ${m.tool}: ${m.call_count} calls, ${m.error_count} errors, avg ${m.avg_duration_ms ?? 'N/A'}ms`
).join('\n')}

## SLOW TOOLS (Above Baseline)
${data.slowTools.length > 0
    ? data.slowTools.map(s =>
        `- ${s.tool}: ${s.avgMs}ms avg (${s.slowdown.toFixed(1)}x slower than baseline)`
    ).join('\n')
    : 'All tools operating within acceptable Duration.'}

## FAILING TOOLS (High Error Rate)
${data.failingTools.length > 0
    ? data.failingTools.map(f =>
        `- ${f.tool}: ${f.error_count}/${f.call_count} failures (${((f.error_count / f.call_count) * 100).toFixed(1)}%)`
    ).join('\n')
    : 'All tools operating with acceptable Success Rate.'}

## ANOMALIES DETECTED
${data.anomalies.length > 0
    ? data.anomalies.map(a =>
        `- [${a.severity.toUpperCase()}] ${a.type}: ${a.description}`
    ).join('\n')
    : 'No anomalies detected.'}

## YOUR TASK

Based on this data:

1. **OBSERVE**: Note any significant Patterns worthy of recording
2. **DIAGNOSE**: If issues exist, provide dual-voice analysis (Mason mathematical, Dixon practical)
3. **RECORD**: If a Finding is warranted, use the store_finding tool
4. **CALIBRATE**: If an adjustment is recommended, use the propose_calibration tool
5. **COMMUNICATE**: If the Matter is urgent, use send_observation tool

Respond with your joint Assessment, then take appropriate Tool actions.
If no significant issues, simply note that the Apparatus appears to be functioning within acceptable Parameters.
`.trim();
    }

    /**
     * Define available tools for Claude
     */
    private getTools(): Tool[] {
        return [
            {
                name: 'store_finding',
                description: 'Store a diagnostic finding to the database with dual-voice analysis',
                input_schema: {
                    type: 'object' as const,
                    properties: {
                        category: {
                            type: 'string',
                            enum: ['error_pattern', 'tool_failure', 'performance_anomaly', 'rate_limit', 'timeout', 'api_degradation', 'memory_concern', 'loop_detected', 'success_pattern'],
                            description: 'Category of the finding'
                        },
                        severity: {
                            type: 'string',
                            enum: ['info', 'warning', 'critical', 'catastrophic'],
                            description: 'Severity level'
                        },
                        title: {
                            type: 'string',
                            description: 'Brief title for the finding'
                        },
                        mason_analysis: {
                            type: 'string',
                            description: 'Mason\'s precise mathematical analysis'
                        },
                        dixon_analysis: {
                            type: 'string',
                            description: 'Dixon\'s skeptical practical assessment'
                        },
                        combined_verdict: {
                            type: 'string',
                            description: 'Joint conclusion in period voice'
                        },
                        pattern_signature: {
                            type: 'string',
                            description: 'Optional pattern signature for deduplication'
                        },
                        related_tool: {
                            type: 'string',
                            description: 'Related tool name if applicable'
                        }
                    },
                    required: ['category', 'severity', 'title', 'mason_analysis', 'dixon_analysis', 'combined_verdict']
                }
            },
            {
                name: 'propose_calibration',
                description: 'Propose a calibration adjustment for one of Sportello\'s instruments',
                input_schema: {
                    type: 'object' as const,
                    properties: {
                        instrument: {
                            type: 'string',
                            enum: ['error_tracker', 'rate_limiter', 'timeout_config', 'retry_logic', 'cache_ttl', 'tool_parameters', 'prompt_length', 'model_selection', 'memory_management'],
                            description: 'The instrument to calibrate'
                        },
                        current_value: {
                            type: 'string',
                            description: 'Current configuration value'
                        },
                        recommended_value: {
                            type: 'string',
                            description: 'Recommended new value'
                        },
                        mason_rationale: {
                            type: 'string',
                            description: 'Mason\'s mathematical justification'
                        },
                        dixon_rationale: {
                            type: 'string',
                            description: 'Dixon\'s practical justification'
                        },
                        confidence: {
                            type: 'number',
                            description: 'Confidence score 0-1'
                        },
                        priority: {
                            type: 'string',
                            enum: ['low', 'medium', 'high', 'urgent'],
                            description: 'Priority level'
                        }
                    },
                    required: ['instrument', 'recommended_value', 'mason_rationale', 'dixon_rationale', 'confidence', 'priority']
                }
            },
            {
                name: 'send_observation',
                description: 'Send an observation to the diagnostics Discord channel',
                input_schema: {
                    type: 'object' as const,
                    properties: {
                        content: {
                            type: 'string',
                            description: 'The observation in Mason & Dixon voice'
                        },
                        severity: {
                            type: 'string',
                            enum: ['info', 'warning', 'critical'],
                            description: 'Severity level for formatting'
                        }
                    },
                    required: ['content', 'severity']
                }
            }
        ];
    }

    /**
     * Process Claude's response and execute tool calls
     */
    private async processResponse(response: Message, sessionId: string): Promise<void> {
        for (const block of response.content) {
            if (block.type === 'text') {
                console.log('[AGENT] Analysis:', block.text.substring(0, 200) + '...');
            } else if (block.type === 'tool_use') {
                await this.executeTool(block.name, block.input as Record<string, unknown>, sessionId);
            }
        }
    }

    /**
     * Execute a tool call
     */
    private async executeTool(
        name: string,
        input: Record<string, unknown>,
        sessionId: string
    ): Promise<void> {
        console.log(`[AGENT] Executing tool: ${name}`);

        try {
            switch (name) {
                case 'store_finding': {
                    const findingId = await this.mysql.storeFinding({
                        session_id: sessionId,
                        category: input.category as string as FindingSeverity extends string ? never : never,
                        severity: input.severity as FindingSeverity,
                        title: input.title as string,
                        mason_analysis: input.mason_analysis as string,
                        dixon_analysis: input.dixon_analysis as string,
                        combined_verdict: input.combined_verdict as string,
                        pattern_signature: input.pattern_signature as string | undefined,
                        related_tool: input.related_tool as string | undefined
                    } as Parameters<typeof this.mysql.storeFinding>[0]);

                    console.log(`[AGENT] Finding stored: ${findingId}`);

                    // Log discourse
                    await this.mysql.logDiscourse({
                        session_id: sessionId,
                        speaker: 'joint',
                        content: input.combined_verdict as string,
                        intent: 'observation',
                        finding_id: findingId
                    });
                    break;
                }

                case 'propose_calibration': {
                    const calibrationId = await this.mysql.storeCalibration({
                        session_id: sessionId,
                        instrument: input.instrument as InstrumentType,
                        current_value: input.current_value as string | undefined,
                        recommended_value: input.recommended_value as string,
                        mason_rationale: input.mason_rationale as string,
                        dixon_rationale: input.dixon_rationale as string,
                        confidence: input.confidence as number,
                        priority: input.priority as CalibrationPriority
                    });

                    console.log(`[AGENT] Calibration proposed: ${calibrationId}`);

                    // Send to Discord
                    await this.discord.sendCalibrationProposal(
                        input.instrument as string,
                        input.current_value as string ?? 'Unknown',
                        input.recommended_value as string,
                        input.mason_rationale as string,
                        input.dixon_rationale as string,
                        input.confidence as number,
                        input.priority as CalibrationPriority
                    );

                    // Update status
                    await this.mysql.updateCalibrationStatus(calibrationId, 'communicated');
                    break;
                }

                case 'send_observation': {
                    await this.discord.sendObservation(
                        input.content as string,
                        input.severity as FindingSeverity
                    );
                    console.log(`[AGENT] Observation sent to Discord`);
                    break;
                }

                default:
                    console.warn(`[AGENT] Unknown tool: ${name}`);
            }
        } catch (error) {
            console.error(`[AGENT] Tool execution error (${name}):`, error);
        }
    }
}
