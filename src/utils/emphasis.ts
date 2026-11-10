/** One part of a text: plain, a name of the UI (bold), or a value inside a block (italic) */
export interface TextPart {
    text: string;
    emphasis: "bold" | "italic" | null;
}

const MARK = /\*([^*]+)\*|_([^_]+)_/;

/**
 * Splits a text into its parts. A name of the UI, such as a heading, button or control, is written between asterisks
 * ("*Refresh*"); a value inside a block, such as a legend row or a tag, between underscores ("_Permanent_"). A mark
 * without a partner stays as it is.
 */
export function splitEmphasis(text: string): TextPart[] {
    const parts: TextPart[] = [];
    let rest = text;
    for (let match = MARK.exec(rest); match; match = MARK.exec(rest)) {
        if (match.index > 0) parts.push({ text: rest.slice(0, match.index), emphasis: null });
        parts.push(match[1] !== undefined ? { text: match[1], emphasis: "bold" } : { text: match[2], emphasis: "italic" });
        rest = rest.slice(match.index + match[0].length);
    }
    if (rest) parts.push({ text: rest, emphasis: null });
    return parts;
}
