# Configuratiepagina

Dit document beschrijft de Configure-pagina, waar je PIM-instellingen en toewijzingen van rollen en groepen wijzigt. Elke wijziging gaat door één mandje, één review en één apply.

---

## Overzicht

De startpagina toont je **schrijftoegang** (wat je mag wijzigen, per gebied), de **ingangskaarten**, het paneel **access model** en **Last applies**. Vier modi staan in de modusbalk en in de URL (`mode=edit|guided|import|model`):

1. **Edit**: een master-detail lijst van rollen en groepen. Kies een doel, wijzig instellingen op de tabs Activation, Assignment en Notification, bekijk en wijzig wie toegang heeft (Who has it, Add people). *Select several* wijzigt één waarde op meerdere doelen; *Copy settings to* kopieert de instellingen van een doel.
2. **Guided**: een route in stappen (Start, Targets, Settings, People) voor een wijziging op veel doelen, eventueel vanuit het PIM Monitor access model.
3. **Import**: sleep een CSV- of JSON-bestand (toewijzingen, rol- of groepsinstellingen, een access model-bestand, of een bestand met de keuzes van het access model dat je op de pagina Access model hebt opgeslagen; een back-up wordt herkend maar kan nog niet worden geïmporteerd). PIM Manager herkent het bestand, toont een naslag van de kolommen en een sjabloon, en vergelijkt elke rij met de tenant.
4. **Access model**: het bord van het Enterprise Access Model (vlakken en niveaus), de catalogus van rollen met verwachte instellingen en de plaatsing van je groepen. Exporteren slaat de aanbevolen rolinstellingen op als CSV die je kunt bewerken en weer importeren, en je keuzes van labels en groepsplaatsingen als JSON. Hier wordt niets naar de tenant geschreven.

Keep is overal de standaard: een waarde die je niet aanraakt en een lege cel in een bestand wijzigen niets.

---

## Het mandje

Elke modus voegt wijzigingen toe aan het **mandje** (balk onderaan). Het mandje wordt per tenant in het tabblad bewaard, zodat een herlaad of toestemmingspopup het behoudt. Wijzigingen worden naar betekenis vergeleken met wat de tenant nu heeft. Leave out haalt één wijziging weg, Discard leegt het mandje.

## Review

*Review* leest de tenant opnieuw, stuurt nieuwe toewijzingen één keer als dry run (alleen validatie, er wordt niets geschreven) en toont een oordeel, wat aandacht vraagt en elke controle met uitkomst. Een blokkerende controle houdt Apply uitgeschakeld. Verwijderingen bevestig je in de review.

## Apply, resultaat en Undo

Apply bewaart eerst een **snapshot** van de geraakte doelen (hun policyregels en toewijzingen) (bij een fout wordt niets geschreven) en schrijft daarna in volgorde met throttling, probeert 429 en 5xx opnieuw en herhaalt nooit een schrijfactie die mogelijk is gelukt zonder te controleren. Het resultaat toont elke wijziging (Done, Failed, Not written), leest de tenant opnieuw en toont waarden die afwijken van je bedoeling. *Try the failed ones again* gaat terug naar de review; het resultaat kan als CSV worden gedownload. De laatste tien applies staan in **Last applies** met hun snapshot, in deze browser tot je uitlogt; *Undo this apply* bouwt een mandje uit de snapshot, met waarschuwingen als iemand anders het doel sindsdien wijzigde of de apply jonger is dan vijf minuten.

---

## Custom Extensions (Preview)

Met PIM custom extensions roept een activatie een externe REST API aan die het verzoek goedkeurt, automatisch goedkeurt of weigert. PIM Manager koppelt een bestaande extensie aan een policy; het endpoint zelf bouw je in het Microsoft Entra admin center.

- **Edit en Guided**: het tabblad Activation eindigt met een sectie *Custom extension*. Kies een extensie voor de pre-approval of post-approval slot. Een slot dat aan staat zonder keuze wordt nooit geschreven.
- **Toegang tot de lijst**: de lijst vraagt `PrivilegedAccess-CustomExt.Read.All` (incrementele toestemming) en een Microsoft Entra ID Governance- of Entra Suite-licentie. Een policy die al een extensie koppelt toont de naam ook zonder die scope.
- **Import**: de bestanden met instellingen bevatten de kolommen voor extensie-id en Enabled. Een lege cel behoudt de koppeling; een bestand kan niet ontkoppelen.

---

## Activatie Instellingen

Instellingen die gelden wanneer gebruikers hun eligible rol **activeren**.

| Instelling | Beschrijving | Aanbevolen |
|------------|--------------|------------|
| **Max Duur** | Maximale activatietijd | 4-8 uur voor meeste rollen |
| **MFA Vereist** | Gebruikers moeten MFA voltooien | Altijd inschakelen |
| **Rechtvaardiging Vereist** | Gebruikers moeten uitleggen waarom | Inschakelen voor audit |
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

## Vereiste Machtigingen

Schrijven vraagt de schrijfscopes van de workload, aangevraagd wanneer je op de startpagina of in Settings op Grant permission drukt (Directory Roles: `RoleManagementPolicy.ReadWrite.Directory`, `RoleEligibilitySchedule.ReadWrite.Directory`, `RoleAssignmentSchedule.ReadWrite.Directory`; PIM for Groups: de drie `.AzureADGroup`-equivalenten). De **toegangsrij** op de startpagina toont per gebied of je nu mag schrijven (open), eerst een rol moet activeren, geen rol hebt die het toestaat, toestemming mist, of dat een groep vergrendeld is (dynamisch of gesynchroniseerd). De optionele Conditional Access-controle vraagt op verzoek `Policy.Read.All`.

---

## Probleemoplossing

- **Apply is uitgeschakeld**: open de review; een blokkerende controle noemt de oorzaak (ontbrekende rol, policy niet gelezen, geweigerde dry run).
- **Een groep is niet te wijzigen**: dynamische en gesynchroniseerde groepen zijn vergrendeld; een groep buiten PIM komt onder PIM wanneer je een wijziging toepast.
- **Import meldt "Need a fix"**: de rij heeft een cel die de bestandslezer weigerde; de rij zegt welke cel en waarom. Van die rij wordt niets toegevoegd.
- **Het mandje en Last applies zijn leeg na uitloggen**: beide worden bij uitloggen bewust gewist, zodat er geen namen of snapshots op het apparaat blijven. Maak een apply ongedaan voordat je uitlogt.

## Volgende Stappen

- [Rapportpagina](./08-rapport-pagina.md): waar een rol of groep een knop "Change in Configure" heeft
- [Settings](./11-settings.md): machtigingen en noodtoegangsaccounts
