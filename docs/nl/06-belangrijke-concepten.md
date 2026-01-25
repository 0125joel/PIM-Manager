# Belangrijke Concepten

Dit document legt belangrijke technische concepten uit die in PIM Manager worden gebruikt.

---

## Inhoudsopgave

1. [Uitgesteld Laden](#uitgesteld-laden)
2. [Priority Fetch](#priority-fetch)
3. [Context Pattern](#context-pattern)
4. [Caching Strategie](#caching-strategie)
5. [Gelijktijdige Workers](#gelijktijdige-workers)
6. [Policy vs Assignment (Assignment vs Policy)](#policy-vs-toewijzing)
7. [Unified Context & Workloads](#unified-context--workloads)
8. [Consent Framework](#consent-framework)

---

## Uitgesteld Laden

**Wat het is**: Niet-kritieke data op de achtergrond laden nadat de UI al zichtbaar is.

**Waarom we het gebruiken**: PIM-policies duren ~2 minuten om op te halen voor alle rollen. Gebruikers zouden niet zo lang moeten wachten om basisinformatie te zien.

```
┌─────────────────────────────────────────────────────────┐
│ Traditionele Aanpak                                      │
│                                                         │
│ [Alle data ophalen] ─────────────────────────> [Toon UI]│
│        └── 2+ minuten wachten ──┘                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Uitgesteld Laden (Onze Aanpak)                          │
│                                                         │
│ [Basis ophalen] ───> [Toon UI] ───> [Achtergrond...]    │
│        └── 10-15s ──┘    └── Werk terwijl het laadt! ──┘│
└─────────────────────────────────────────────────────────┘
```

> [!TIP]
> De UI toont "Rolconfiguratie ophalen op achtergrond... (15/130)" om voortgang van achtergrond laden aan te geven.

---

## Priority Fetch

**Wat het is**: Direct data ophalen voor een specifiek item wanneer de gebruiker ermee interacteert, de normale wachtrij omzeilend.

**Wanneer het gebeurt**: Wanneer je op een rolkaart klikt voordat de policy is geladen.

**Hoe het werkt**:
1. Gebruiker klikt rol → controleer of policy bestaat
2. Zo niet → haal direct op (prioriteit)
3. Markeer als opgehaald → achtergrond-loader slaat het later over

> [!NOTE]
> Priority fetch zorgt ervoor dat de rol waarin je geïnteresseerd bent eerst laadt, ongeacht de positie in de wachtrij.

---

## Context Pattern

**Wat het is**: Een React pattern voor het delen van state over meerdere componenten zonder "prop drilling".

**In PIM Manager**: `PimDataContext` biedt gedeelde toegang tot:
- Roldata
- Laadstatussen
- Ophaalfuncties
- Ophaalfuncties
- (Gepland) Schrijfoperaties

**Hoe te gebruiken**:
```typescript
// In elk component
const { rolesData, loading, fetchPolicyForRole } = usePimData();
```

---

## Caching Strategie

**Wat het is**: Opgehaalde data tijdelijk opslaan om het opnieuw ophalen bij elke pagina-navigatie te voorkomen.

### Session Storage Cache

| Aspect | Implementatie |
|--------|---------------|
| Opslaglocatie | Browser's session storage |
| Levensduur | Tot browser tab sluit |
| Versheidscheck | Data ouder dan 5 minuten wordt opnieuw opgehaald |
| Grootte | ~5-10 MB voor typische tenant |

> [!WARNING]
> Session storage wordt gewist wanneer je de browser tab sluit. Data blijft niet behouden tussen sessies.

---

## Gelijktijdige Workers

**Wat het is**: Meerdere parallelle processen die tegelijk data ophalen, met gecontroleerde rate limiting.

**Waarom we het gebruiken**: Het sequentieel ophalen van 130 policies zou ~5 minuten duren. Met 3 workers duurt het ~2 minuten.

### Configuratie

| Instelling | Waarde | Reden |
|------------|--------|-------|
| Workers | 8 (geoptimaliseerd) | Maximaal parallelle requests zonder throttling |
| Vertraging | 300ms (geoptimaliseerd) | Per-worker cooldown tussen requests |
| Totale doorvoer | ~26 policies/seconde | 70-80% sneller dan originele implementatie |

> [!CAUTION]
> De worker pool is geoptimaliseerd voor Microsoft Graph API rate limits. Het wijzigen van deze waarden kan throttling (429 errors) veroorzaken.

---

## Policy vs Toewijzing

Het begrijpen van het verschil tussen deze twee concepten is cruciaal.

### Toewijzing

**Wat het is**: Een verbinding tussen een gebruiker/groep en een rol.

**Types**:
| Type | Beschrijving | Activatie Nodig? |
|------|--------------|------------------|
| Permanent | Directe roltoewijzing | Nee |
| Eligible | Kan rol activeren via PIM | Ja |
| Actief | Momenteel geactiveerde PIM-toewijzing | N.v.t. (al actief) |

### Policy

**Wat het is**: Configuratieregels voor hoe een rol kan worden geactiveerd.

**Voorbeelden**:
- Maximale activatieduur (bijv. 8 uur)
- MFA vereisen voor activatie
- Goedkeuring vereisen voor activatie
- Wie kan goedkeuren

### Relatie

```
┌─────────────────────────────────────────┐
│                 Rol                     │
│          (bijv. Global Admin)           │
├────────────────────┬────────────────────┤
│    Toewijzingen    │      Policy        │
├────────────────────┼────────────────────┤
│ Alice (Permanent)  │ Max duur: 8h       │
│ Bob (Eligible)     │ MFA vereist: Ja    │
│ Carol (Actief)     │ Goedkeuring vereist│
│                    │   → Security Team  │
└────────────────────┴────────────────────┘
```

> [!IMPORTANT]
> Toewijzingen definiëren **wie** een rol kan gebruiken. Policies definiëren **hoe** ze het kunnen gebruiken.

---

## Unified Context & Workloads

**Wat het is**: Een architectuur die meerdere databronnen ("workloads") combineert in één centrale state manager.

**Workloads**:
- **Directory Roles**: De standaard Microsoft Entra ID rollen.
- **PIM for Groups**: PIM-instellingen voor M365 groepen.
- **Security Alerts**: Beveiligingsaanbevelingen.

**UnifiedPimContext**:
Deze context beheert de data van alle workloads en zorgt ervoor dat componenten (zoals de Export-functie) toegang hebben tot *alle* data via één hook: `useUnifiedPimData()`.

---

## Consent Framework

**Wat het is**: Een mechanisme om stapsgewijs machtigingen aan te vragen ("Incremental Consent").

**Hoe het werkt**:
1. De app start met minimale leesrechten (voor Directory Roles).
2. Als je een optionele workload aanzet (bijv. "PIM for Groups"), vraagt de app via een popup om de extra benodigde rechten.
3. Als je weigert, blijft de rest van de app werken; alleen die specifieke functie blijft uitgeschakeld.

> [!TIP]
> Dit zorgt ervoor dat gebruikers niet direct bij het inloggen worden overspoeld met consent-aanvragen voor functies die ze misschien niet gebruiken.

---

## Volgende Stappen

- [Rapportpagina](./06-rapportpagina.md) - Functie documentatie
- [Configuratiepagina](./07-configuratiepagina.md) - Configuratie functies
