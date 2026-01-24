# PIM Manager Documentatie

Welkom bij de technische documentatie van PIM Manager. Deze handleiding is bedoeld voor **M365 Engineers** die willen begrijpen hoe de applicatie werkt.

## Inhoudsopgave

| Document | Beschrijving |
|----------|--------------|
| [Introductie](./01-introductie.md) | Wat is PIM Manager en welke problemen lost het op? |
| [Mappenstructuur](./02-mappenstructuur.md) | Overzicht van de code-organisatie |
| [Dataflow](./03-dataflow.md) | Hoe data wordt opgehaald en verwerkt |
| [Graph API Calls](./04-graph-api-calls.md) | Welke Microsoft Graph APIs worden gebruikt |
| [Belangrijke Concepten](./05-belangrijke-concepten.md) | Uitleg van technische concepten |
| [Dashboard Pagina](./06-dashboard-pagina.md) | Visueel overzicht en beveiligingsinzichten |
| [Rapport Pagina](./07-rapport-pagina.md) | Gedetailleerde rolconfiguratieweergave |
| [Configuratie Pagina](./08-configuratie-pagina.md) | Geplande schrijfcapaciteiten |
| [Deployment](./09-deployment.md) | Hosting op Cloudflare Pages |
| [Instellingen](./10-settings.md) | Workloads en consent framework |

---

## Snel Starten

1. Clone de repository
2. Voer `npm install` uit
3. Configureer de Microsoft Entra ID app-registratie (zie [Introductie](./01-introductie.md))
4. Voer `npm run dev` uit voor ontwikkeling

---

## Hulp Nodig?

- Bekijk [Belangrijke Concepten](./05-belangrijke-concepten.md) voor uitleg van technische termen
- Lees [Dataflow](./03-dataflow.md) om te begrijpen hoe de app data ophaalt
