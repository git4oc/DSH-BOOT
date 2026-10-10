[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Русский](README.ru.md) | [Português](README.pt.md)

# DSH-BOOT

> **Eine Enterprise-grade-Plattform für AI-Agenten, aufgebaut auf dem DSH-Kernel.**
> Sie schreiben nur Geschäftslogik. Multi-Tenant-Isolation, Security-Audit, Genehmigungen, Quoten & Abrechnung, Sitzungspersistenz, Evolutions-Kompatibilität — all das implementiert die Plattform, festgenagelt durch Contract Tests. Sie müssen es nie selbst schreiben.

## Warum es dieses Projekt gibt

Nach der Open-Sourcing von DSH habe ich mir immer wieder dieselbe Frage gestellt: **Wie bringen wir die Fähigkeiten von DSH in Enterprise-Anwendungen?**

Ich bin stets der Meinung gewesen, dass nicht jedes Unternehmen in der Lage ist, eine komplette AI-Agent-Plattform selbst zu entwickeln — doch im AI-Zeitalter haben alle Unternehmen dieselbe Anforderung: die eigenen Geschäftsszenarien mit AI zu verbinden und darauf lokalisierte Dienste und Cloud-Deployments aufzubauen.

DeepSeek Harness tut diese konkreten Dinge nicht. Auf Basis seiner Philosophie „Alles ist ein Plugin" können wir ihn als Harness-Basisplattform behandeln, die frei einsetzbar ist, kein Urheberrechtsrisiko birgt und sich an der technischen Front ständig weiterentwickelt — das erspart Unternehmen die vielen Kosten der Jagd nach neuen Technologien.

DSH macht das Single-Agent-Runtime sehr gut — Tool-Sandboxing, Approval-Waterfall, Presets und das Plugin-Ökosystem bekommt man out of the box. Aber Enterprise-Anwendungen brauchen mehr: Wie isoliert man Tenants? Wie macht man Audits manipulationssicher? Was passiert, wenn ein Nutzer die Löschung seiner Daten verlangt? Was, wenn ein Tenant die Ressourcen der anderen auffrisst? Wie aktualisiert man, ohne Kundendaten zu beschädigen? — nichts davon hat der DSH-Kernel, und jedes Unternehmen, das alles selbst baut, tritt dieselben Landminen erneut.

Das Fazit dieser Erkundung: **eine Harness-Plattform mit DSH als Kernel**. Der DSH-Kernel liefert bereits zwei der drei Grenzen (Capability-Grenze, Aufrufgrenze); nur die äußerste (Tenant-/Ressourcen-Isolation) fehlt — deshalb schreibt dieses Projekt DSH nicht neu, sondern vervollständigt auf ihm aufbauend die äußere Schicht und nagelt die innere und mittlere fest, indem es die „harten, aber richtigen" Teile von Enterprise-Software in Plattformcode verwandelt.

Das Ziel: **Unternehmen sollen sich auf die Geschäftsimplementierung konzentrieren und dabei die Dividende aus DSHs fortschrittlichen Ideen voll auschöpfen** — Sie definieren Szenarien, Tools, Connector und Skills; Isolation, Audit, Genehmigungen, Quoten & Abrechnung, Persistenz & Recovery und Evolutions-Kompatibilität fängt die Plattform ab, und jedes Versprechen ist durch Contract Tests festgenagelt. Ob und wann DSH aktualisiert wird, beurteilen ebenfalls Sie: Upgrades laufen nach der Validierung durch die fünf Gates der Pipeline (Contract Tests, Snapshot-Diff, Train-Konsistenz, Canary-Aufzeichnungen, erneute Readiness-Prüfung) reibungslos ab, ohne das Geschäft zu beeinträchtigen.

## Das müssen Sie nicht mehr selbst lösen

| Enterprise-Problem | Was DSH-BOOT Ihnen gibt |
|---|---|
| Multi-Tenant-Isolation | Eine `(tenantId, isolationGroupId)` pro Isolationsdomäne, tenantübergreifend wird nie geteilt; exklusive Workspace-Leases (fencing epoch, übertragbar); die Grenzen der fehlenden Lese-Isolation innerhalb der Domäne werden ehrlich offengelegt, Need-to-know-Kunden nutzen Isolationsgruppen auf Team-/Nutzer-Ebene |
| Wer was darf | JWT (OIDC gegen Ihren Enterprise-IdP) + RBAC steuert Szenarien, Plugins, Tools, MCP und Sandbox-Modus-Obergrenzen pro Tenant/Rolle; SSO/SCIM automatisiertes Onboarding, binnen 5 Minuten nach Kontodeaktivierung laufen Sitzungen und Tokens vollständig ab |
| Manipulationssicheres Auditing | Minimaler Audit-Satz in sechs Klassen, **fail-closed** (was sich nicht aufzeichnen lässt, wird als Aktion verweigert); WORM + Hash-Kette; Audit-Keys mit fünf Feldern; Forensik-Pakete exportierbar und unabhängig verifizierbar |
| Nutzer verlangen Datenlöschung | Vollständige DSR-Löschung (Logs/Anhänge/FTS/Snapshots/Objektspeicher-Versionen/Container-Temp-Layer) + Tombstones + Löschbericht + Hash-Ketten-Nachweis; wirksam ≤ 24 h, Widerrufsfenster 7 Tage |
| Ressourcenfresser | Gestufte Quoten (soft/hard) + Fair Scheduling: das Kontingent überschreitende Tenants werden **proportional gedrosselt**, alle anderen bleiben unberührt; Ausfälle weicher Abhängigkeiten blockieren die Ausführung nie |
| Was, wenn eine Abhängigkeit ausfällt | Degradationsleiter L0/L1/L1b/L2/L3: Eintritts-/Austrittsschwellen, Hysterese und Mindestverweildauer, aggregierte Alerts pro Tenant, Error-Budgets und Freeze-Listen |
| Upgrades, die Kundendaten beschädigen | Migrations-State-Machine mit fünf Zuständen + `targetBaseSeq == sourceLastReplicatedSeq`-Assertion gegen torn tails; Source of Truth = Logs + upload-bestätigte Watermark; Upgrade-Pipeline mit fünf Gates + erneuter Prüfung jeder Voraussetzung |
| Compliance braucht Nachweise | Forensik-Pakete + Löschnachweise + Hash-Ketten, alle exportierbar und unabhängig verifizierbar |

## Schnellstart

**Voraussetzungen**: Node ≥ 22, pnpm; **ein Linux-Host** (produktive Multi-Tenancy gibt es nur unter Linux — Windows wurde getestet und ausgeschlossen, siehe [Grenzen](#aktueller-stand-und-grenzen-die-ehrliche-version)).

```bash
pnpm install

# Minimale lokale Topologie starten: Reverse-Gateway-Stub + In-Memory-Attest + Seed-Profil
pnpm dev:up          # HTTP-Endpunkt unter http://127.0.0.1:7301 (JSON-API)
pnpm dev:smoke       # Einen vollständigen Turn ausführen
```

## Ein paar Begriffe, vorab geklärt

Dieses Repo und der DSH-Entwurf verwenden diese Konzepte immer wieder:

- **Domäne (isolation domain)**: eine isolierte Laufzeitumgebung, die eine DSH-Instanz für die Isolationsgruppe eines Tenants betreibt (produktiv im eigenen Container). Domänen sehen einander nie — das ist die Grundeinheit der Multi-Tenant-Isolation.
- **Innerhalb / außerhalb der Domäne**: innerhalb = innerhalb der DSH-Instanz, wo Modelle und Tools ausgeführt werden — **nicht vertrauenswürdig** (anfällig für Prompt-Injection oder Manipulation); außerhalb = Control-Plane und Gateway von dsh-boot — **vertrauenswürdig**. Deshalb finden Autorisierung, Audit, Artefakt-Verifizierung und Readiness-Entscheidungen alle außerhalb der Domäne statt; Meldungen aus der Domäne dienen nur als Referenz — das nennt sich „Enforcement kommt nur von außerhalb der Domäne".
- **Gate (GATE)**: ein verpflichtender Checkpoint vor dem Eintritt in die nächste Phase. Jedes Gate hat ausführbare Verifikationen (Contract Tests, Drills, Live-Tests) und archivierte Nachweise; Scheitern heißt Stopp — nichts wird durchgewinkt.
- **Contract Tests**: jede semantische Zusicherung der Plattform („Tenants sehen einander nie", „fehlgeschlagene Genehmigungen werden nie automatisch wiederholt", „torn tails erreichen den Nutzer nie") ist als automatisierter Test geschrieben. Jede spätere Änderung, die ein Versprechen bricht, färbt sofort einen Test rot.

## Ein Geschäftssystem, drei Schichten

Eine Sitzung Ihres Geschäftssystems durchläuft von oben nach unten drei Schichten:

```
Ihre Benutzer
   │
   ▼
┌──────────────────────────────────────────────┐
│ Geschäftssystem (von Ihnen entwickelt)       │
│ Ihre UI (Web/App/CLI) + Geschäftsabläufe     │
│ + Szenarien, Tools, Connector, Skills        │
└──────────────────┬──────────────────────────┘
                   │ Plattform-API aufrufen, um Sitzung/Turn zu starten
                   ▼
┌──────────────────────────────────────────────┐
│ DSH-BOOT (dieses Projekt, Plattform-Schicht)  │
│ Auth · Quoten & Abrechnung · Genehmigungen ·  │
│ Audit & Forensik · DSR-Löschung ·             │
│ Degradation · Upgrade-Gates                   │
└──────────────────┬────────────────────────┘
                   │ Turn an eine Isolationsdomäne dispatchen
                   ▼
┌──────────────────────────────────────────────┐
│ DSH-Kernel (eine Instanz pro Domäne)          │
│ Modellaufrufe · Tool-Ausführung · Sandbox ·   │
│ Plugins                                       │
└──────────────────────────────────────────────┘
```

| Schicht | Bereitgestellt von | Was Sie tun |
|---|---|---|
| **Geschäftssystem** | **Sie schreiben**: UI, Geschäftsabläufe sowie die von Ihnen definierten Szenarien/Tools/Connector/Skills | Die vier Asset-Typen definieren + die Plattform-API aufrufen; die UI folgt Ihrer Geschäftsform (Web/App/CLI, alles geht) |
| **DSH-BOOT** | **Dieses Repo** (implementiert, durch Contract Tests festgenagelt): Multi-Tenancy, Audit, Quoten & Abrechnung, DSR, Degradation, Upgrade-Gates | Beim Deployment Infrastruktur anbinden (Linux-Container-Runtime, Enterprise-IdP, Objektspeicher) und konfigurieren |
| **DSH-Kernel** | **Der DSH-Open-Source-Kernel** (unverändert): Single-Agent-Runtime | Nichts — Versionen, Readiness und Drift verwaltet DSH-BOOT für Sie |

Aus Sicherheitssicht entsprechen diese drei Schichten **drei Grenzen**: die innere Capability-Grenze und die mittlere Aufrufgrenze bewachen gemeinsam DSH-Kernel und DSH-BOOT; die äußere Tenant-/Ressourcen-Isolation stellt DSH-BOOT bereit — Schicht für Schicht in der Tabelle unten.

## Das Verhältnis von DSH-BOOT zu DSH: drei Grenzen, nur die äußerste fehlt

Der DSH-Kernel gibt einem einzelnen Agenten ein komplettes Runtime: Modellaufrufe (`ctx.llm`), Tool-Registrierung (`ctx.tools`), Approval-Waterfall (`ctx.approval`), Sandbox (`dsh-sandbox*`), Presets (`dsh-agent-preset`). Aber von den drei Grenzen **liefert er nur zwei** — es fehlt genau die äußerste, die Multi-Tenancy am dringendsten braucht:

| Schicht | Natur der Grenze | DSH-Kernel | Was DSH-BOOT tut |
|---|---|---|---|
| **Innen: Capability-Grenze** | Welche Tools/Plugins dieser Agent hat | ✅ `dsh-agent-preset` + scope | **Festgenagelt + Governance außerhalb der Domäne**: die Tool-Registrierungsbrücke ist der einzige Eingang (alles außerhalb von `toolAllowlist` wird nie registriert); ein einzelnes Preset + Privilegien-Obergrenze; die vier Kataloge Plugin/Connector/Skill/Scenario bewerten die Ebenen-Zulässigkeit außerhalb der Domäne bei der Profilgenerierung — **tenant-eigene Plugins kommen nie in die plattformgesperrte Schicht** |
| **Mitte: Aufrufgrenze** | File-Write-Policy pro Aufruf + Approval-Waterfall | ⚠️ Vorhanden, aber Windows-Schicht partial | **Vervollständigt + live getestet**: Approval-Responder + zehnfeldriger Parameterkanal (Schwärzung/Kürzung/Sequenzierung) + dreistufige Deadlines (`T_a`/`T_m`/`T_turn`); der ACL-Livetest im Windows-Container fiel **ehrlich durch → Windows bleibt von der Multi-Tenant-Isolation ausgeschlossen** |
| **Außen: Tenant-/Ressourcen-Isolation** | Multi-Tenancy auf Kernel-Ebene | ❌ Keine | **Selbst gebaut (der Kern dieses Projekts)**: Domänen-Pool mit drei Zuständen (hot/warm/cold), an `(tenantId, isolationGroupId)` gebundene Domänen-Tokens, exklusive Workspace-Leases, Identität/RBAC/Quoten/Fair Scheduling/Abrechnung, SessionPersistence L1/L2 + Migrations-State-Machine, fail-closed-Audit + WORM-Hash-Kette, DSR-Löschnachweise, Degradationsleiter |

**Erst wenn alle drei Schichten komplett sind, steht die Multi-Tenancy.** Wer allein aus der inneren Schicht (welche Tools ein Agent hat) Isolation verspricht, verkleidet eine Capability-Grenze als Sicherheitsgrenze — das ist der Ausgangspunkt jeder Architekturentscheidung dieses Projekts.

Was also ist DSH-BOOT genau? Es ist eine **Multi-Tenant-Plattformsoftware für AI-Agenten**, bestehend aus drei Teilen:

1. **Control-Plane-Dienste** (TypeScript-Pakete): Identität & RBAC, Quoten & Fair Scheduling, Billing-Erfassung, Audit & Forensik, DSR-Löschung, Sitzungs-Routing & -Indexierung — die Back-Office-Logik einer Enterprise-Plattform;
2. **DSH-Integration** (Reverse-Gateway-Stub + Domänenbrücke): verbindet DSHs Modellaufrufe, Tool-Registrierung und Approval-Waterfall mit der Control Plane und führt Artefakt-Verifizierung und Drift-Erkennung außerhalb der Domäne durch — ohne den DSH-Kernel zu verändern;
3. **Engineering-Gates** (Spec-Set + Validierungswerkzeuge): 397 Anforderungen, sechs Gates, Snapshot-Diffs — damit keine spätere Änderung die obigen Versprechen still beschädigt.

Es schreibt DSH nicht neu: Jeder Agent läuft weiterhin auf dem DSH-Kernel; DSH-BOOT verwaltet viele solcher Agenten zur Multi-Tenant-Plattform eines Unternehmens. Deployment-Form: Control-Plane-Dienste + eine DSH-Instanz pro Isolationsdomäne (Linux-Container) + Gateway.

### Was zwischen DSH-BOOT und DSH ausgetauscht wird

In jeder Isolationsdomäne läuft eine DSH-Instanz, und nur wenige klar definierte Kanäle verbinden die beiden:

| Interaktion | Richtung | Inhalt |
|---|---|---|
| **Profil-Verteilung** | Außen → Innen | Die von Ihnen definierten Szenarien/Tools/Connector/Skills werden vom Profil-Generator (außen) zu `pluginSet`, `toolAllowlist`, `skillRoots` verarbeitet und read-only in die DSH-Instanz eingehängt |
| **Plugin-/Artefakt-Registrierung** | Außen | Plugins werden im Plugin Registry registriert (Version, Signatur, Integritäts-Hash); die Zulässigkeit wird außen bewertet und erst dann ins Profil aufgenommen — **innerhalb der Domäne gibt es keine Aktion „Plugin installieren"** |
| **Tool-Registrierung** | Innen | Nach dem Start von DSH ist `ctx.tools.register` der einzige Eingang, und nur Namen auf der `toolAllowlist` passieren; zur Laufzeit meldet die Domäne einen Tool-Manifest-Hash, der außen verglichen wird — bei jeder Abweichung wird die Domäne abgekoppelt |
| **Modellaufrufe** | Innen → Außen | `ctx.llm`-Aufrufe verlassen die Domäne durch das Reverse-Gateway: Credentials werden außen vermittelt, der Token-Verbrauch wird außen gemessen und abgerechnet |
| **Genehmigungen** | Innen → Außen | Gefährliche Aktionen lösen eine Genehmigung aus; der äußere Responder antwortet; Parameter reisen durch den Kanal (Schwärzung/Kürzung/Sequenzierung) und müssen innerhalb der dreistufigen Deadline konvergieren |
| **Credentials** | Außen → Innen | MCP-Connector erhalten nur Credential-Referenzen mit kurzer TTL; innerhalb der Domäne liegen keine langlebigen Credentials |
| **Sitzungspersistenz** | Innen → Außen | Sitzungs-Logs werden auf das lokale Volumen der Domäne geschrieben und außen auf Basis des „upload-bestätigten Wasserstands" konsumiert — Quoten, Abrechnung und Audit nehmen genau das als Source of Truth |

In einem Satz: **innen wird nur ausgeführt, geurteilt wird außen**. Eine DSH-Instanz weiß nicht, dass es andere Tenants gibt; alle tenantübergreifenden Entscheidungen (wer hineinkommt, was benutzt werden darf, was getan wurde, wie gelöscht wird) leben auf der DSH-BOOT-Seite.

Analogie in einem Satz: **DSH verhält sich zu DSH-BOOT ungefähr wie die JVM zu Spring Boot** — der Kernel betreibt die Runtime der Einzelinstanz, die Plattform regelt die Multi-Tenant-Enterprise-Semantik.

## Ihr Geschäftssystem bauen

Ein Geschäftssystem auf DSH-BOOT schreiben = die vier Asset-Typen definieren; die Plattform kümmert sich um alles andere:

| Sie definieren | Womit | Die Plattform garantiert |
|---|---|---|
| **Szenario** | `presetId + pluginSet + policies` | presetId ist append-only (eine permanente Kompatibilitätsfläche) |
| **Tool** | Der einzige Eingang über die Registrierungsbrücke; alles außerhalb von toolAllowlist wird nie registriert | Selbst ein bösartiges MCP, das neue Tools durchdrückt, kommt nie in das sichtbare Set |
| **Connector** | Katalog-Registrierung, standardmäßig `untrusted` | Credentials werden nur als Referenzen gespeichert; Ausnahmen brauchen ein Security-Review |
| **Skill** | Scopes auf platform-/tenant-/user-Ebene | Pro Tenant montiert, greift nie über die Schichtgrenzen hinweg |

Minimales Beispiel (aus den Contract Tests entnommen, kopierbar und lauffähig):

```js
import { ScenarioCatalog, ConnectorRegistry } from "../../../../packages/control-plane/src/registry/registries.ts";

// Ein Szenario definieren: presetId + Plugin-Set + Policies
const scenarios = new ScenarioCatalog();
scenarios.define({
  presetId: "preset-1",
  pluginSet: ["dsh-base"],
  policies: { requireApproval: ["shell"], toolAllowlist: ["fs"] },
});

// Einen MCP-Connector registrieren: standardmäßig untrusted; Ausnahmen brauchen ein Security-Review
const registry = new ConnectorRegistry(2);
registry.register({
  serverName: "github-mcp",
  transport: "stdio",
  hosting: "domain",
  credentialRef: "credref-1",
  trust: "untrusted",
  securityReviewPassed: false,
});
```

Business-Entwickler **schreiben keinerlei Isolations-, Audit-, Quota- oder Persistenz-Code** — die vier Asset-Typen definieren, und die Plattform liefert alles davon.

```bash
# 11 Contract-Suites — jede semantische Zusicherung der Plattform ist von einem Test festgenagelt
pnpm contract:llm && pnpm contract:tools && pnpm contract:approval
pnpm contract:ready && pnpm contract:persistence-l1 && pnpm contract:pool
pnpm contract:identity-quota && pnpm contract:registry
pnpm contract:session-ops && pnpm contract:lifecycle

# Spec- und Dokumenten-Validierung
node tools/lint-specs.mjs && node tools/check-gates.mjs
node tools/validate-contracts.mjs && node tools/lint-docs.mjs
```

## Design-Prinzipien

1. **Enforcement kommt nur von außerhalb der Domäne** — die Ebenen-Zulässigkeit wird bei der Profilerstellung bewertet; die Domäne bezeugt nie sich selbst (selbst attestierte Compliance gilt als durchgefallen).
2. **Gates akzeptieren nur Fakten von außerhalb der Domäne** — Meldungen aus der Domäne dienen nur der Gegenprobe; bei Abweichung wird die Domäne abgekoppelt.
3. **Weiche Abhängigkeiten blockieren die Ausführung nie** — fällt Billing oder allgemeines Audit aus, läuft die Ausführung weiter; begrenzte Drops + Tombstones + Re-Upload.
4. **Sagen, was nicht geht** — jeder unfertige Punkt wird ehrlich registriert; keine erfundenen Zahlen.

## Aktueller Stand und Grenzen (die ehrliche Version)

- ✅ Alle sechs Phasen-Gates (GATE-001…006) sind erreichbar, jedes mit Evidence-Artefakten; alle 11 Contract-Suites grün.
- ❌ **Windows bleibt von der Multi-Tenant-Isolation ausgeschlossen**: der ACL-Test im Container ist nicht bestanden (GATE-002 Bedingung 9, ehrlich als Fail markiert).
- 🔶 **Drills 3/6**: DRL-03/04/06 brauchen Kernel-Komponenten und Multi-Node-Topologie — ehrlich blocked.
- 🔶 **Lasttest-Parameter nicht zurückgefüllt**: `PP-01…PP-35` sind durchgehend „beispielabgeleitete Werte + ausstehender Lasttest" — keine erfundenen Zahlen.
- 🚫 **Keine UI**: dieses Repo liefert Bibliotheken und eine HTTP-API (Gateway-Stub), keine Produkt-Oberfläche.
- 📦 **Produktions-Deployment bringt die eigene Ausführungsumgebung mit**: die Container-/microVM-Ausführungsumgebung einer Isolationsdomäne wird von diesem Repo nicht implementiert — beim Deployment stellt der Deployer die Infrastruktur (Linux-Container-Runtime, Enterprise-IdP, Objektspeicher) und verkabelt sie; Business-Entwickler bleiben unberührt.

Für den schichtweisen Konsistenzvergleich zwischen Implementierung und ursprünglichem Plan (alle sechs Punkte konsistent, einschließlich des ehrlich ausgeführten „Windows fällt durch"-Zweigs) siehe das [Engineering Handbook](docs/ENGINEERING-HANDBOOK.md#9-实现与规划的一致性对照).

## Dokumentation

- [Engineering Handbook](docs/ENGINEERING-HANDBOOK.md) — Autoritätsreihenfolge, Gate-Kurzreferenz, Lücken-Register, Änderungsprotokoll (Pflichtlektüre für Contributor)
- [Spec-Master](spec/00-规格总纲.md) — Einstieg in das Spec-Set
- [Failure-Domain-Matrix](docs/reliability/failure-domain-matrix.md) / [Degradationsleiter](docs/reliability/degradation-ladder.md) / [DSR-Inventar](docs/security/dsr-inventory-and-proof.md)

## License

[MIT](LICENSE)
