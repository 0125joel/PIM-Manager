/**
 * The one date format of the app: the reader's locale, day and short month and year ("1 Oct 2026").
 * Formatters are built once; an invalid or missing date gives an empty string, never "Invalid Date".
 */
const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function toDate(value: Date | string | number | null | undefined): Date | null {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: Date | string | number | null | undefined): string {
    const date = toDate(value);
    return date ? DATE.format(date) : "";
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
    const date = toDate(value);
    return date ? `${DATE.format(date)}, ${TIME.format(date)}` : "";
}
