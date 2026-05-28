import { colors, spacing } from '../theme.mjs';
import { Slide, Label, Heading, Body, Row, Stack, Card, Space, Handle, el } from '../components.mjs';

export const meta = { title: 'Throttle Benut — per tenant size' };

function InsightCard(number, text) {
    return el('div', {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
        backgroundColor: '#0a1929',
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: '#1e3a5a',
        padding: 28,
        gap: 16,
    }, [
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 28,
            color: colors.accent,
            lineHeight: 1.3,
            minWidth: 28,
        }, number),
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: 18,
            color: colors.mutedDark,
            lineHeight: 1.5,
        }, text),
    ]);
}

function StatCard({ tenantLabel, userRange, ruLimit, percentage, percentageColor }) {
    return Card([
        // Tenant label
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: colors.primary,
            marginBottom: 36,
        }, tenantLabel),
        // Big percentage
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 82,
            lineHeight: 1,
            color: percentageColor || colors.textDark,
            marginBottom: 36,
        }, percentage),
        // Spacer to push RU info to bottom
        el('div', { flex: 1 }, null),
        // RU limit
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: 28,
            color: '#ffffff',
            marginBottom: 12,
        }, ruLimit),
        // User range
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: 20,
            color: colors.mutedDark,
        }, userRange),
    ], {
        flex: 1,
        marginLeft: 0,
        marginRight: 0,
        padding: 48,
        minHeight: 340,
    });
}

export default function slide() {
    return Slide([
        // Header label
        Label('Throttle Benut'),

        // Title
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 52,
            lineHeight: 1.15,
            color: '#ffffff',
            marginBottom: 8,
        }, 'Hoeveel RU-budget gebruiken\nwe met serieel ophalen?'),

        Space(20),

        // Subtitle
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: 24,
            color: colors.mutedDark,
            marginBottom: 72,
        }, '1.144 calls x 300ms serieel = 33,4 RU/10s'),

        // Three stat cards
        Row([
            StatCard({
                tenantLabel: 'Small',
                userRange: '< 50 gebruikers',
                ruLimit: '3.500 RU/10s',
                percentage: '0,95%',
                percentageColor: colors.accent,
            }),
            el('div', { width: 20 }, null),
            StatCard({
                tenantLabel: 'Medium',
                userRange: '50 - 500 gebruikers',
                ruLimit: '5.000 RU/10s',
                percentage: '0,67%',
                percentageColor: colors.primary,
            }),
            el('div', { width: 20 }, null),
            StatCard({
                tenantLabel: 'Large',
                userRange: '> 500 gebruikers',
                ruLimit: '8.000 RU/10s',
                percentage: '0,42%',
                percentageColor: colors.success,
            }),
        ], { marginBottom: 72 }),

        // Bottom note
        el('div', {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#0a1929',
            borderRadius: 12,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#1e3a5a',
            padding: 28,
            gap: 16,
        }, [
            el('div', {
                fontFamily: 'Inter',
                fontWeight: 700,
                fontSize: 28,
                color: colors.success,
                marginRight: 16,
            }, '99%+'),
            el('div', {
                fontFamily: 'Inter',
                fontWeight: 400,
                fontSize: 20,
                color: colors.mutedDark,
                lineHeight: 1.5,
            }, 'throttle headroom onbenut, pas vrij te benutten als je parallel gaat'),
        ]),

        Space(16),

        // Three numbered insights
        el('div', {
            display: 'flex',
            flexDirection: 'row',
            gap: 20,
            marginBottom: 0,
        }, [
            InsightCard('1', '300ms per call is de echte heen-en-terug latency, geen kunstmatige vertraging.'),
            InsightCard('2', 'Serieel = elke call wacht op de vorige. Geen overlap mogelijk.'),
            InsightCard('3', 'Die 99%+ headroom benut je alleen als je parallel gaat ophalen.'),
        ]),

        // Push source note to bottom
        el('div', { flex: 1 }, null),

        // Source note
        el('div', {
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: 16,
            color: '#475569',
            fontStyle: 'italic',
            marginBottom: 48,
        }, 'Bron: Microsoft Graph throttling limits. learn.microsoft.com/graph/throttling-limits'),

        Handle(),
    ]);
}
