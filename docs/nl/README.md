# PIM Manager Documentatie

Welkom bij de technische documentatie van PIM Manager. Deze handleiding is bedoeld voor **M365 Engineers** die willen begrijpen hoe de applicatie werkt.

## Inhoudsopgave

| Document | Beschrijving |
|----------|--------------|
| [Introductie](./01-introductie.md) | Wat is PIM Configurator en welke problemen lost het op? |
| [Mappenstructuur](./02-mappenstructuur.md) | Overzicht van de code-organisatie |
| [Dataflow](./03-dataflow.md) | Hoe data wordt opgehaald en verwerkt |
| [Graph API Calls](./04-graph-api-calls.md) | Welke Microsoft Graph APIs worden gebruikt |
| [Belangrijke Concepten](./05-belangrijke-concepten.md) | Uitleg van technische concepten |
| [Rapportpagina](./06-rapportpagina.md) | Functies van de Rapportpagina |
| [Configuratiepagina](./07-configuratiepagina.md) | Functies van de Configuratiepagina (In Ontwikkeling) |
| [Deployment](./08-deployment.md) | Hosting op Cloudflare Pages |
| [Instellingen](./09-settings.md) | Workloads en Consent Framework |

---

## Snel Starten

1. Clone de repository
2. Voer `npm install` uit
3. Configureer de Azure AD app-registratie (zie [Introductie](./01-introductie.md))
4. Voer `npm run dev` uit voor ontwikkeling

---

## Hulp Nodig?

- Bekijk [Belangrijke Concepten](./05-belangrijke-concepten.md) voor uitleg van technische termen
- Lees [Dataflow](./03-dataflow.md) om te begrijpen hoe de app data ophaalt
