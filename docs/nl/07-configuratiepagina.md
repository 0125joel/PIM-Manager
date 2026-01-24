# Configuratiepagina

Dit document legt de functies en functionaliteit van de Configuratiepagina uit, waar je PIM-instellingen in bulk kunt wijzigen.

---

## Overzicht

> [!IMPORTANT]
> **Status: In Ontwikkeling**
> De Configuratiepagina is momenteel nog niet beschikbaar in de applicatie. Deze functionaliteit staat op de roadmap voor een toekomstige release. Onderstaande documentatie beschrijft de geplande functionaliteit.

De Configuratiepagina zal je in staat stellen om:
- Meerdere rollen te selecteren
- Consistente PIM-instellingen toe te passen
- Roltoewijzingen te maken

```
┌─────────────────────────────────────────────────────────┐
│                   Configuratiepagina                    │
├───────────────────────┬─────────────────────────────────┤
│    Rolselectie        │    Configuratieformulier        │
├───────────────────────┼─────────────────────────────────┤
│ ☐ Global Admin        │  ┌─────────────────────────┐   │
│ ☑ User Admin          │  │ Activatie Instellingen  │   │
│ ☑ Groups Admin        │  │ ─────────────────────── │   │
│ ☐ Exchange Admin      │  │ Max Duur: [4 uur]       │   │
│ ☑ SharePoint Admin    │  │ ☑ MFA Vereist          │   │
│ ...                   │  │ ☑ Reden Vereist        │   │
│                       │  │ ☐ Goedkeuring Vereist  │   │
│ 3 rollen geselecteerd │  └─────────────────────────┘   │
│                       │                                 │
│                       │  [Instellingen Toepassen]       │
│                       │  [Toewijzingen Maken]           │
└───────────────────────┴─────────────────────────────────┘
```

---

## Functies

### Rolselectie

Het linker paneel toont alle beschikbare rollen.

**Functies**:
- Zoeken om rollen te filteren
- Klik om te selecteren/deselecteren
- Toont toewijzingsaantallen
- Tags geven roltype aan

> [!TIP]
> Selecteer rollen met vergelijkbare doelen (bijv. alle Exchange-gerelateerde rollen) om consistente instellingen toe te passen.

---

### Configuratieformulier

Het rechter paneel toont configuratie-opties wanneer rollen zijn geselecteerd.

#### Laden Vanaf Geselecteerde Rol

Als precies één rol is geselecteerd:
- Laadt de huidige instellingen van die rol
- Vult het formulier vooraf in
- Handig als sjabloon

---

## Activatie Instellingen

Instellingen die gelden wanneer gebruikers hun eligible rol **activeren**.

| Instelling | Beschrijving | Aanbevolen |
|------------|--------------|------------|
| **Max Duur** | Maximale activatietijd | 4-8 uur voor meeste rollen |
| **MFA Vereist** | Gebruikers moeten MFA voltooien | ✅ Altijd inschakelen |
| **Reden Vereist** | Gebruikers moeten uitleggen waarom | ✅ Inschakelen voor audit |
| **Ticketinfo Vereist** | Link naar ticketsysteem | Optioneel |
| **Goedkeuring Vereist** | Moet eerst worden goedgekeurd | Voor gevoelige rollen |
| **Goedkeurders** | Wie kan goedkeuren | Security team of managers |

### Max Duur Opties

| Duur | Gebruiksscenario |
|------|------------------|
| 1 uur | Zeer gevoelig, korte taken |
| 4 uur | Standaard werkdag ondersteuning |
| 8 uur | Volledige werkdag dekking |
| 12+ uur | Wacht of uitgebreide operaties |

> [!WARNING]
> Langere duren verhogen risico. Gebruikers blijven geprivilegieerd voor de gehele duur.

---

## Toewijzingsinstellingen

Instellingen die gelden voor eligible/actieve **toewijzingen**.

| Instelling | Beschrijving |
|------------|--------------|
| **Permanent Eligible Toestaan** | Eligible toewijzingen verlopen nooit |
| **Max Eligible Duur** | Indien niet permanent, hoe lang |
| **Permanent Actief Toestaan** | Actieve toewijzingen verlopen nooit |
| **Max Actieve Duur** | Indien niet permanent, hoe lang |

> [!CAUTION]
> Permanente actieve toewijzingen omzeilen PIM volledig. Vermijd tenzij absoluut noodzakelijk.

---

## Goedkeuringsconfiguratie

Wanneer "Goedkeuring Vereist" is ingeschakeld:

### Goedkeurdersselectie

Je kunt selecteren:
- **Gebruikers**: Individuele goedkeurders
- **Groepen**: Alle groepsleden kunnen goedkeuren

> [!TIP]
> Gebruik groepen voor goedkeurders om dekking te garanderen wanneer individuen niet beschikbaar zijn.

---

## Instellingen Toepassen

Klik "Instellingen Toepassen" om de geselecteerde rollen bij te werken.

### Wat Gebeurt Er

1. **Validatie**: Formulierinvoer wordt gevalideerd
2. **Bevestiging**: Bekijk wat er zal veranderen
3. **Verwerking**: Elke rol wordt sequentieel bijgewerkt
4. **Verificatie**: Instellingen worden geverifieerd na toepassing
5. **Resultaten**: Succes/falen getoond voor elke rol

### Voortgangsmodal

```
┌──────────────────────────────────────────┐
│        Configuratie Toepassen            │
├──────────────────────────────────────────┤
│ ✅ PIM Instellingen Toepassen            │
│    Toegepast op 3 rollen. Mislukt: 0     │
│                                          │
│ ⏳ Configuratie Verifiëren               │
│    Toegepaste instellingen verifiëren... │
└──────────────────────────────────────────┘
```

> [!NOTE]
> Verificatie zorgt ervoor dat instellingen daadwerkelijk zijn toegepast. Graph API kan soms stilletjes falen.

---

## Toewijzingen Maken

Klik "Toewijzingen Maken" om gebruikers/groepen toe te voegen aan de geselecteerde rollen.

### Toewijzingsformulier

| Veld | Beschrijving |
|------|--------------|
| **Type** | Eligible of Actief |
| **Principals** | Gebruikers of groepen om toe te wijzen |
| **Duur** | Hoe lang de toewijzing duurt |
| **Rechtvaardiging** | Waarom de toewijzing wordt gemaakt |

### Bulk Creatie

Toewijzingen worden gemaakt voor:
- Elke geselecteerde rol × Elke geselecteerde principal

Voorbeeld: 3 rollen × 2 gebruikers = 6 toewijzingsverzoeken

---

## Vereiste Machtigingen

> [!IMPORTANT]
> De Configuratiepagina vereist de `RoleManagement.ReadWrite.Directory` machtiging.

Zonder deze machtiging:
- Instellingenformulier werkt maar toepassen zal falen
- Foutmelding indica ontbrekende machtigingen

> [!NOTE]
> Omdat deze functionaliteit nog niet actief is, zijn deze schrijfrechten momenteel **niet vereist** voor het gebruik van PIM Manager.

---

## Best Practices

### Standaardiseer Instellingen

1. Definieer organisatiebrede standaarden
2. Selecteer alle vergelijkbare rollen
3. Pas consistente instellingen toe

Voorbeeld standaarden:
- Alle geprivilegieerde rollen: 4u max, MFA vereist, goedkeuring vereist
- Alle standaard rollen: 8u max, MFA vereist

### Test Eerst

1. Selecteer één niet-kritieke rol
2. Pas instellingen toe
3. Verifieer in Azure Portal
4. Pas dan toe op andere rollen

### Documenteer Wijzigingen

1. Exporteer huidige instellingen (Rapportpagina)
2. Maak wijzigingen
3. Exporteer nieuwe instellingen
4. Vergelijk voor audit trail

---

## Probleemoplossing

### "Instellingen toepassen mislukt"

**Oorzaak**: Machtigingsproblemen of API-fouten

**Oplossing**:
1. Verifieer dat je `RoleManagement.ReadWrite.Directory` hebt
2. Controleer of rol beschermd is (bijv. Global Admin vereist Global Admin)
3. Controleer browserconsole voor gedetailleerde fout

### Verificatie mislukt

**Oorzaak**: Instellingen zijn nog niet doorgevoerd

**Oplossing**:
1. Wacht 30 seconden
2. Controleer handmatig in Azure Portal
3. Instellingen kunnen toch zijn toegepast ondanks verificatiefout

---

## Volgende Stappen

- [Rapportpagina](./06-rapportpagina.md) - Bekijk je configuraties
- [Belangrijke Concepten](./05-belangrijke-concepten.md) - Begrijp terminologie
