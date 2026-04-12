import { Logger } from '@/utils/logger';

/**
 * Duration Utility Functions
 *
 * Centralized utilities for parsing, formatting, and normalizing
 * ISO 8601 duration strings used in PIM policies.
 *
 * ISO 8601 Duration Format:
 * - P = Period designator (required)
 * - nY = Years, nM = Months, nD = Days
 * - T = Time designator (for hours/minutes)
 * - nH = Hours, nM = Minutes
 *
 * Examples: P1Y, P6M, P15D, PT8H, PT30M
 */

/**
 * Normalize duration values from Graph API to standard format.
 * Graph API sometimes returns P365D instead of P1Y.
 */
export function normalizeDuration(duration: string | undefined, defaultValue: string = 'P1Y'): string {
    if (!duration) return defaultValue;
    // Convert P365D to P1Y for consistency with dropdown options
    if (duration === 'P365D') return 'P1Y';
    return duration;
}

/**
 * Convert human-readable duration string to ISO 8601 format.
 * Supports flexible input like "1 Year", "6 Months", "15 Days".
 *
 * @example toIsoDuration("1 Year") => "P1Y"
 * @example toIsoDuration("6 Months") => "P6M"
 * @example toIsoDuration("15 Days") => "P15D"
 */
export function toIsoDuration(humanReadable: string | undefined): string {
    if (!humanReadable) return 'P1Y';

    const normalized = humanReadable.toLowerCase().trim();

    // Handle already-ISO format
    if (normalized.startsWith('p')) return humanReadable.toUpperCase();

    // Parse "X Unit" format
    if (normalized.includes('year')) {
        const num = parseInt(normalized.split(' ')[0]) || 1;
        return `P${num}Y`;
    }
    if (normalized.includes('month')) {
        const num = parseInt(normalized.split(' ')[0]) || 1;
        return `P${num}M`;
    }
    if (normalized.includes('day')) {
        const num = parseInt(normalized.split(' ')[0]) || 15;
        return `P${num}D`;
    }
    if (normalized.includes('hour')) {
        const num = parseInt(normalized.split(' ')[0]) || 8;
        return `PT${num}H`;
    }

    return 'P1Y'; // Default fallback
}

/**
 * Format ISO 8601 duration to human-readable string.
 *
 * @example formatDuration("P1Y") => "1 Year"
 * @example formatDuration("P6M") => "6 Months"
 * @example formatDuration("PT8H") => "8 Hours"
 */
export function formatDuration(iso: string | undefined): string {
    if (!iso) return 'Unknown';

    // Handle common patterns
    const yearMatch = iso.match(/^P(\d+)Y$/);
    if (yearMatch) {
        const years = parseInt(yearMatch[1]);
        return years === 1 ? '1 Year' : `${years} Years`;
    }

    const monthMatch = iso.match(/^P(\d+)M$/);
    if (monthMatch) {
        const months = parseInt(monthMatch[1]);
        return months === 1 ? '1 Month' : `${months} Months`;
    }

    const dayMatch = iso.match(/^P(\d+)D$/);
    if (dayMatch) {
        const days = parseInt(dayMatch[1]);
        return days === 1 ? '1 Day' : `${days} Days`;
    }

    const hourMatch = iso.match(/^PT(\d+)H$/);
    if (hourMatch) {
        const hours = parseInt(hourMatch[1]);
        return hours === 1 ? '1 Hour' : `${hours} Hours`;
    }

    const minuteMatch = iso.match(/^PT(\d+)M$/);
    if (minuteMatch) {
        const minutes = parseInt(minuteMatch[1]);
        return minutes === 1 ? '1 Minute' : `${minutes} Minutes`;
    }

    // P365D special case - display as 1 Year
    if (iso === 'P365D') return '1 Year';

    return iso; // Return as-is if no pattern matches
}

/**
 * Parse ISO 8601 duration to hours (for activation duration slider).
 *
 * @example parseHours("PT8H") => 8
 * @example parseHours("PT30M") => 0.5
 */
export function parseHours(iso: string | undefined): number {
    if (!iso) return 8; // Default

    const hourMatch = iso.match(/^PT(\d+)H$/);
    if (hourMatch) return parseInt(hourMatch[1]);

    const minuteMatch = iso.match(/^PT(\d+)M$/);
    if (minuteMatch) return parseInt(minuteMatch[1]) / 60;

    // Combined format PT8H30M
    const combinedMatch = iso.match(/^PT(\d+)H(\d+)M$/);
    if (combinedMatch) {
        return parseInt(combinedMatch[1]) + parseInt(combinedMatch[2]) / 60;
    }

    return 8; // Default
}

/**
 * Convert hours to ISO 8601 duration string.
 * Handles fractional hours by converting to combined format (PT1H30M).
 *
 * @example hoursToIso(8) => "PT8H"
 * @example hoursToIso(0.5) => "PT30M"
 * @example hoursToIso(1.5) => "PT1H30M"
 */
export function hoursToIso(hours: number): string {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);

    if (wholeHours === 0) {
        return `PT${minutes}M`;
    } else if (minutes === 0) {
        return `PT${wholeHours}H`;
    } else {
        return `PT${wholeHours}H${minutes}M`;
    }
}

/**
 * Activation duration options — matches the DurationSlider range (30min–24h).
 * Single source of truth for CSV templates, dropdowns, and validation.
 */
export const ACTIVATION_DURATION_OPTIONS = [
    { value: 'PT30M', label: '30 Minutes' },
    { value: 'PT1H',  label: '1 Hour' },
    { value: 'PT2H',  label: '2 Hours' },
    { value: 'PT4H',  label: '4 Hours' },
    { value: 'PT8H',  label: '8 Hours' },
    { value: 'PT12H', label: '12 Hours' },
    { value: 'PT24H', label: '24 Hours' },
] as const;

/**
 * Get standardized expiration options for dropdowns.
 * These match the Azure Portal options exactly.
 */
export const EXPIRATION_OPTIONS = [
    { value: 'P15D', label: '15 Days' },
    { value: 'P1M', label: '1 Month' },
    { value: 'P3M', label: '3 Months' },
    { value: 'P6M', label: '6 Months' },
    { value: 'P1Y', label: '1 Year' },
] as const;

/**
 * Microsoft PIM Default Durations (verified against official documentation)
 *
 * Source: Microsoft Learn - Configure Microsoft Entra role settings in PIM
 * - Eligible expiration: 1 year max by default policy
 * - Active expiration: 6 months (common, configurable per role)
 * - Activation duration: 8 hours (common default)
 * - Assignment eligible: 6 months for new assignments
 */
export const DEFAULT_DURATIONS = {
    /** Default expiration for eligible assignments (P1Y = 1 Year) */
    eligibleExpiration: 'P1Y',
    /** Default expiration for active assignments (P6M = 6 Months) */
    activeExpiration: 'P6M',
    /** Default activation duration when user activates (PT8H = 8 Hours) */
    activationDuration: 'PT8H',
    /** Default duration for new eligible assignments (P180D = 180 days — matches Microsoft's P6M default) */
    newAssignmentEligible: 'P180D',
    /** Default duration for new active assignments (P15D = 15 Days) */
    newAssignmentActive: 'P15D',
} as const;

/**
 * Validate and normalize an expiration value against known options.
 * If the value is not recognized, logs a warning and returns a fallback.
 *
 * @param value - The ISO duration value to validate
 * @param fallback - Fallback value if validation fails (defaults to eligibleExpiration)
 * @returns The validated value or fallback
 */
export function validateExpirationValue(
    value: string | undefined,
    fallback: string = DEFAULT_DURATIONS.eligibleExpiration
): string {
    if (!value) return fallback;

    // Normalize P365D to P1Y
    const normalized = normalizeDuration(value);

    // Check if value exists in options
    const isValidOption = EXPIRATION_OPTIONS.some(opt => opt.value === normalized);

    if (!isValidOption) {
        Logger.warn("durationUtils", `Unknown expiration value: "${value}" (normalized: "${normalized}"). Using fallback: "${fallback}"`);
        return fallback;
    }

    return normalized;
}

/**
 * Convert ISO duration to Graph API format (days-only: PnD).
 * Microsoft Graph API for PIM policies only accepts days, not months or years.
 *
 * @example toGraphDuration("P1Y") => "P365D"
 * @example toGraphDuration("P6M") => "P180D"
 * @example toGraphDuration("P1M") => "P30D"
 * @example toGraphDuration("P15D") => "P15D"
 */
export function toGraphDuration(iso: string | undefined): string {
    if (!iso) return 'P365D'; // Default to 1 year

    // Already in days format
    if (iso.match(/^P\d+D$/)) return iso;

    // Convert common expiration durations to days
    const conversions: Record<string, string> = {
        'P1Y': 'P365D',   // 1 Year = 365 days
        'P6M': 'P180D',   // 6 Months = 180 days
        'P3M': 'P90D',    // 3 Months = 90 days
        'P1M': 'P30D',    // 1 Month = 30 days
    };

    if (conversions[iso]) {
        return conversions[iso];
    }

    // Generic conversion for PnM (months) -> approximate days
    const monthMatch = iso.match(/^P(\d+)M$/);
    if (monthMatch) {
        const months = parseInt(monthMatch[1]);
        return `P${months * 30}D`;
    }

    // Generic conversion for PnY (years) -> days
    const yearMatch = iso.match(/^P(\d+)Y$/);
    if (yearMatch) {
        const years = parseInt(yearMatch[1]);
        return `P${years * 365}D`;
    }

    Logger.warn("durationUtils", `Could not convert "${iso}" to Graph format. Using as-is.`);
    return iso;
}

/**
 * Approximate an ISO 8601 duration (P1Y, P6M, P365D, PT8H, etc.) as days for comparison.
 * Used to determine which of two durations is more restrictive (shorter).
 */
export function isoToApproxDays(iso: string | undefined): number {
    if (!iso) return Infinity;
    const m = iso.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
    if (!m) return Infinity;
    return (parseInt(m[1] || '0') * 365)
        + (parseInt(m[2] || '0') * 30)
        + (parseInt(m[3] || '0') * 7)
        + parseInt(m[4] || '0')
        + (parseInt(m[5] || '0') / 24);
}

/**
 * Return the shorter (more restrictive) of two ISO 8601 durations.
 * Undefined values are treated as "no constraint" (returns the other value).
 */
export function minIsoDuration(a: string | undefined, b: string | undefined): string | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return isoToApproxDays(a) <= isoToApproxDays(b) ? a : b;
}

/**
 * Convert ISO 8601 duration string to a human-readable label.
 * Alias for formatDuration with null/undefined safety.
 * e.g. P1Y → "1 Year", P6M → "6 Months", P365D → "1 Year"
 */
export function isoDurationToLabel(duration: string | null | undefined): string {
    if (!duration) return "1 Year";
    return formatDuration(duration);
}
