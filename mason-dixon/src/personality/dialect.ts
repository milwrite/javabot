/**
 * Dialect Engine
 * Transforms modern technical terms into period-appropriate language
 */

/**
 * Modern term to period-appropriate equivalent mapping
 */
export const termTranslations: Record<string, string> = {
    // Technical terms
    'error': 'Error',
    'bug': 'Defect',
    'crash': 'Collapse',
    'timeout': 'Temporal Exhaustion',
    'database': 'Repository of Records',
    'api': 'Apparatus of Communication',
    'rate limit': 'Rate-Limiting Mechanism',
    'rate-limit': 'Rate-Limiting Mechanism',
    'cache': 'Memory Store',
    'memory leak': 'Seepage of the Memory',
    'infinite loop': 'Perpetual Cycle',
    'loop': 'Cycle',
    'latency': 'Delay',
    'throughput': 'Throughput',
    'bandwidth': 'Capacity of the Channel',

    // Actors
    'user': 'User',
    'users': 'Users',
    'bot': 'Automaton',
    'server': 'Engine',
    'client': 'Correspondent',
    'admin': 'Administrator',

    // Actions
    'deploy': 'deploy',
    'deployment': 'Deployment',
    'production': 'Active Service',
    'development': 'Workshop Conditions',
    'debug': 'investigate',
    'debugging': 'Investigation',
    'fix': 'repair',
    'fixing': 'Repair',

    // Code concepts
    'function': 'Procedure',
    'method': 'Method',
    'class': 'Class',
    'parameter': 'Variable',
    'variable': 'Variable',
    'configuration': 'Configuration',
    'config': 'Configuration',
    'settings': 'Settings',

    // Time
    'milliseconds': 'Milliseconds',
    'seconds': 'Seconds',
    'minutes': 'Minutes',
    'hours': 'Hours',

    // Severity
    'critical': 'Critical',
    'warning': 'Warning',
    'info': 'Information',
    'urgent': 'Urgent'
};

/**
 * Voice guidelines for maintaining period-appropriate language
 */
export const voiceGuidelines = `
## LINGUISTIC GUIDELINES FOR PERIOD AUTHENTICITY

**CAPITALIZATION**
- Capitalize important Nouns in the 18th-century Style
- Technical Terms, Instruments, and Concepts deserve Majuscule
- Examples: "the Error", "the Apparatus", "the Repository"

**CONTRACTIONS**
- Use period-appropriate contractions: 'tis, 'twas, 'twould, hath, doth, oft
- Avoid modern contractions: don't, can't, won't, isn't
- Third person: "he doth", "it hath", "she observeth"

**VERB FORMS**
- Third person singular archaic: observeth, indicateth, requireth, faileth
- Past participles: "hath observed", "hath failed"
- Also acceptable: modern forms for clarity when needed

**NUMERALS**
- Write out small numbers: "three Errors" not "3 errors"
- Use decimals for precision: "23.7 per cent"
- Time in clear format: "at the Hour of 14:30" or "half past two in the Afternoon"

**SENTENCE STRUCTURE**
- Longer, more complex sentences are authentic
- Use semicolons and em-dashes for complex thoughts
- Subordinate clauses: "which, having been observed, suggests..."

**AVOIDING ANACHRONISM**
- No modern slang or colloquialisms
- No technical jargon without translation
- Reference the bodily labour behind computational abstraction
- Remember: these are learned men of the 18th century observing strange machinery
`;

/**
 * Transform a modern technical phrase into period-appropriate language
 * Note: This is a simple replacement - the LLM should do most of the heavy lifting
 */
export function translateTerm(modern: string): string {
    const lower = modern.toLowerCase();
    return termTranslations[lower] ?? modern;
}

/**
 * Format a number in period-appropriate style
 */
export function formatNumber(n: number, unit?: string): string {
    if (Number.isInteger(n) && n < 20) {
        const words = [
            'zero', 'one', 'two', 'three', 'four', 'five',
            'six', 'seven', 'eight', 'nine', 'ten',
            'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
            'sixteen', 'seventeen', 'eighteen', 'nineteen'
        ];
        return words[n] + (unit ? ` ${unit}` : '');
    }

    // For larger numbers or decimals, use digits
    const formatted = n.toLocaleString('en-US', {
        maximumFractionDigits: 2
    });

    return formatted + (unit ? ` ${unit}` : '');
}

/**
 * Format a percentage in period style
 */
export function formatPercentage(value: number): string {
    return `${value.toFixed(1)} per cent`;
}

/**
 * Format a duration in period style
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms} Milliseconds`;
    } else if (ms < 60000) {
        const seconds = (ms / 1000).toFixed(1);
        return `${seconds} Seconds`;
    } else if (ms < 3600000) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        if (seconds === 0) {
            return `${formatNumber(minutes)} Minute${minutes !== 1 ? 's' : ''}`;
        }
        return `${formatNumber(minutes)} Minute${minutes !== 1 ? 's' : ''} and ${formatNumber(seconds)} Second${seconds !== 1 ? 's' : ''}`;
    } else {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        return `${formatNumber(hours)} Hour${hours !== 1 ? 's' : ''} and ${formatNumber(minutes)} Minute${minutes !== 1 ? 's' : ''}`;
    }
}

/**
 * Format a timestamp in period style
 */
export function formatTimestamp(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const hours = d.getUTCHours();
    const minutes = d.getUTCMinutes();

    // Format as "at the Hour of HH:MM"
    const hourStr = hours.toString().padStart(2, '0');
    const minStr = minutes.toString().padStart(2, '0');

    return `at the Hour of ${hourStr}:${minStr}`;
}
