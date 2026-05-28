import { colors, spacing, canvas } from './theme.mjs';

export function el(type, style, children) {
    return { type, props: { style, children } };
}

export function Slide(children, bg = colors.bgDark) {
    return el('div', {
        display: 'flex',
        flexDirection: 'column',
        width: canvas.width,
        height: canvas.height,
        backgroundColor: bg,
        padding: spacing.pagePad,
        position: 'relative',
    }, children);
}

export function Label(text, style = {}) {
    return el('div', {
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize: 18,
        letterSpacing: 3,
        textTransform: 'uppercase',
        color: colors.primary,
        marginBottom: 12,
        ...style,
    }, text);
}

export function Heading(text, style = {}) {
    return el('div', {
        fontFamily: 'Inter',
        fontWeight: 800,
        fontSize: 64,
        lineHeight: 1.1,
        color: colors.textDark,
        ...style,
    }, text);
}

export function Body(text, style = {}) {
    return el('div', {
        fontFamily: 'Inter',
        fontWeight: 400,
        fontSize: 28,
        lineHeight: 1.5,
        color: colors.mutedDark,
        ...style,
    }, text);
}

export function Row(children, style = {}) {
    return el('div', {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'stretch',
        ...style,
    }, children);
}

export function Stack(children, style = {}) {
    return el('div', {
        display: 'flex',
        flexDirection: 'column',
        ...style,
    }, children);
}

export function Space(px) {
    return el('div', { height: px, flexShrink: 0 }, null);
}

export function Card(children, style = {}) {
    return el('div', {
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: colors.bgDarkAlt,
        borderRadius: 16,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: '#1e3a5a',
        padding: 40,
        ...style,
    }, children);
}

export function Handle() {
    return el('div', {
        position: 'absolute',
        bottom: spacing.pagePad,
        right: spacing.pagePad,
        fontFamily: 'Inter',
        fontWeight: 400,
        fontSize: 22,
        color: colors.mutedDark,
        opacity: 0.6,
    }, '@0125joel');
}
