/**
 * Line breaks for text in a PDF table cell (`@react-pdf/renderer`).
 *
 * `registerReportFonts` turns hyphenation off for the whole document, so a word wider than its cell (a long UPN, group
 * or resource name) had no break point and was drawn over the next cell. Textkit adds a `-` at every break inside a
 * word, also after a piece that already ends in `-`, so a break at an existing hyphen printed `--`. Measured on
 * react-pdf 4.9 (docs/Assets/lessons/general.md). A cell passes this as its `hyphenationCallback`, which wins over the
 * global one: a break only between two letters or digits, and short words stay whole.
 */

const LETTER_OR_DIGIT = /[A-Za-z0-9]/;

/** Words up to this length never break; a longer one may break between any two letters or digits */
const SHORT_WORD = 12;

/** The pieces a word may break between, for a `Text` in a PDF table cell */
export function pdfCellBreak(word: string): string[] {
    if (word.length <= SHORT_WORD) return [word];
    const parts: string[] = [];
    let current = "";
    for (let i = 0; i < word.length; i++) {
        current += word[i];
        const next = word[i + 1];
        if (next !== undefined && LETTER_OR_DIGIT.test(word[i]) && LETTER_OR_DIGIT.test(next)) {
            parts.push(current);
            current = "";
        }
    }
    if (current) parts.push(current);
    return parts;
}
