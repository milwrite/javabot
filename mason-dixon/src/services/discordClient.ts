/**
 * Discord Client Service
 * Handles Discord bot setup, message handling, and output formatting
 */

import {
    Client,
    GatewayIntentBits,
    TextChannel,
    Message,
    EmbedBuilder,
    Events
} from 'discord.js';
import type { FindingSeverity, CalibrationPriority } from '../types/index.js';

export interface DiscordConfig {
    token: string;
    clientId: string;
    sportelloChannelId: string;
    diagnosticsChannelId: string;
}

export class DiscordClient {
    private client: Client;
    private config: DiscordConfig;
    private sportelloChannel: TextChannel | null = null;
    private diagnosticsChannel: TextChannel | null = null;
    private mentionHandler: ((message: Message) => Promise<void>) | null = null;

    constructor(config: DiscordConfig) {
        this.config = config;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ]
        });
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.once(Events.ClientReady, async (readyClient) => {
                console.log(`[DISCORD] Logged in as ${readyClient.user.tag}`);

                // Fetch channels
                try {
                    const sportello = await this.client.channels.fetch(this.config.sportelloChannelId);
                    if (sportello?.isTextBased()) {
                        this.sportelloChannel = sportello as TextChannel;
                        console.log(`[DISCORD] Monitoring Sportello channel: #${this.sportelloChannel.name}`);
                    }

                    const diagnostics = await this.client.channels.fetch(this.config.diagnosticsChannelId);
                    if (diagnostics?.isTextBased()) {
                        this.diagnosticsChannel = diagnostics as TextChannel;
                        console.log(`[DISCORD] Diagnostics output channel: #${this.diagnosticsChannel.name}`);
                    }
                } catch (error) {
                    console.error('[DISCORD] Failed to fetch channels:', error);
                }

                // Set up message handler for mentions
                this.client.on(Events.MessageCreate, async (message) => {
                    if (message.author.bot) return;
                    if (!this.client.user) return;

                    if (message.mentions.has(this.client.user.id)) {
                        if (this.mentionHandler) {
                            await this.mentionHandler(message);
                        }
                    }
                });

                resolve();
            });

            this.client.once(Events.Error, (error) => {
                console.error('[DISCORD] Client error:', error);
                reject(error);
            });

            this.client.login(this.config.token).catch(reject);
        });
    }

    async disconnect(): Promise<void> {
        this.client.destroy();
        console.log('[DISCORD] Disconnected');
    }

    /**
     * Set handler for @mentions
     */
    onMention(handler: (message: Message) => Promise<void>): void {
        this.mentionHandler = handler;
    }

    /**
     * Send observation to diagnostics channel
     */
    async sendObservation(content: string, severity: FindingSeverity = 'info'): Promise<Message | null> {
        if (!this.diagnosticsChannel) {
            console.warn('[DISCORD] Diagnostics channel not available');
            return null;
        }

        const emoji = this.getSeverityEmoji(severity);
        const color = this.getSeverityColor(severity);

        // For simple messages
        if (content.length < 1800 && !content.includes('**Mr. Mason')) {
            return this.diagnosticsChannel.send(`${emoji} ${content}`);
        }

        // For structured Mason & Dixon observations, use embed
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emoji} Observation`)
            .setDescription(content.slice(0, 4000))
            .setTimestamp()
            .setFooter({ text: 'Mason & Dixon Diagnostics' });

        return this.diagnosticsChannel.send({ embeds: [embed] });
    }

    /**
     * Send calibration proposal to diagnostics channel
     */
    async sendCalibrationProposal(
        instrument: string,
        currentValue: string,
        recommendedValue: string,
        masonRationale: string,
        dixonRationale: string,
        confidence: number,
        priority: CalibrationPriority
    ): Promise<Message | null> {
        if (!this.diagnosticsChannel) return null;

        const priorityEmoji = {
            urgent: '🚨',
            high: '🔴',
            medium: '🟡',
            low: '🟢'
        }[priority];

        const embed = new EmbedBuilder()
            .setColor(this.getPriorityColor(priority))
            .setTitle(`${priorityEmoji} CALIBRATION PROPOSAL`)
            .addFields(
                { name: 'Instrument', value: instrument, inline: true },
                { name: 'Priority', value: priority.toUpperCase(), inline: true },
                { name: 'Confidence', value: `${(confidence * 100).toFixed(0)}%`, inline: true },
                { name: 'Current Setting', value: `\`${currentValue}\``, inline: false },
                { name: 'Proposed Adjustment', value: `\`${recommendedValue}\``, inline: false },
                { name: "Mr. Mason's Assessment", value: masonRationale.slice(0, 1000), inline: false },
                { name: "Mr. Dixon's Assessment", value: dixonRationale.slice(0, 1000), inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Mason & Dixon Calibration System' });

        return this.diagnosticsChannel.send({ embeds: [embed] });
    }

    /**
     * Query Bot Sportello via mention
     */
    async querySportello(question: string): Promise<{ messageId: string; response?: string }> {
        if (!this.sportelloChannel) {
            throw new Error('Sportello channel not available');
        }

        // Find Sportello bot user (assuming it's the other bot in the channel)
        const members = await this.sportelloChannel.guild.members.fetch();
        const sportelloBot = members.find(m =>
            m.user.bot &&
            m.user.id !== this.client.user?.id &&
            m.user.username.toLowerCase().includes('sportello')
        );

        let mentionText = question;
        if (sportelloBot) {
            mentionText = `<@${sportelloBot.id}> ${question}`;
        }

        const sentMessage = await this.sportelloChannel.send(mentionText);

        // Wait for response (with timeout)
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ messageId: sentMessage.id });
            }, 30000); // 30 second timeout

            const responseHandler = (msg: Message) => {
                // Check if this is a reply from Sportello
                if (
                    msg.author.bot &&
                    msg.author.id !== this.client.user?.id &&
                    msg.reference?.messageId === sentMessage.id
                ) {
                    clearTimeout(timeout);
                    this.client.off(Events.MessageCreate, responseHandler);
                    resolve({
                        messageId: sentMessage.id,
                        response: msg.content
                    });
                }
            };

            this.client.on(Events.MessageCreate, responseHandler);
        });
    }

    /**
     * Reply to a specific message
     */
    async replyToMessage(channelId: string, messageId: string, content: string): Promise<Message | null> {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (!channel?.isTextBased()) return null;

            const textChannel = channel as TextChannel;
            const originalMessage = await textChannel.messages.fetch(messageId);

            // Split long messages
            if (content.length > 2000) {
                const chunks = content.match(/.{1,1900}/gs) || [];
                let firstReply: Message | null = null;

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    if (chunk) {
                        if (i === 0) {
                            firstReply = await originalMessage.reply(chunk);
                        } else {
                            await textChannel.send(chunk);
                        }
                    }
                }
                return firstReply;
            }

            return originalMessage.reply(content);
        } catch (error) {
            console.error('[DISCORD] Reply error:', error);
            return null;
        }
    }

    /**
     * Send a message to diagnostics channel
     */
    async sendToDiagnostics(content: string): Promise<Message | null> {
        if (!this.diagnosticsChannel) return null;

        if (content.length > 2000) {
            const chunks = content.match(/.{1,1900}/gs) || [];
            let firstMessage: Message | null = null;

            for (const chunk of chunks) {
                if (chunk) {
                    const msg = await this.diagnosticsChannel.send(chunk);
                    if (!firstMessage) firstMessage = msg;
                }
            }
            return firstMessage;
        }

        return this.diagnosticsChannel.send(content);
    }

    private getSeverityEmoji(severity: FindingSeverity): string {
        return {
            info: '📐',
            warning: '⚠️',
            critical: '🚨',
            catastrophic: '💀'
        }[severity];
    }

    private getSeverityColor(severity: FindingSeverity): number {
        return {
            info: 0x3498db,      // Blue
            warning: 0xf1c40f,   // Yellow
            critical: 0xe74c3c, // Red
            catastrophic: 0x8e44ad // Purple
        }[severity];
    }

    private getPriorityColor(priority: CalibrationPriority): number {
        return {
            low: 0x2ecc71,      // Green
            medium: 0xf1c40f,   // Yellow
            high: 0xe67e22,     // Orange
            urgent: 0xe74c3c   // Red
        }[priority];
    }

    get isReady(): boolean {
        return this.client.isReady();
    }

    get botUser() {
        return this.client.user;
    }
}
