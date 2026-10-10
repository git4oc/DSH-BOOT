[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Русский](README.ru.md) | [Português](README.pt.md)

# DSH-BOOT

> **Une plateforme d'agents IA d'entreprise construite au-dessus du noyau DSH.**
> Vous n'écrivez que la logique métier. Isolation multi-locataire, audit de sécurité, approbations, quotas & facturation, persistance de session, compatibilité d'évolution — tout cela est implémenté par la plateforme et verrouillé par des tests de contrat ; vous n'avez pas à l'écrire vous-même.

## Pourquoi ce projet existe

Depuis l'ouverture en open source de DSH, je n'ai cessé de me poser une question : **comment introduire les capacités de DSH dans les applications d'entreprise ?**

J'ai toujours pensé que toutes les entreprises ne disposent pas de la capacité de développer une plateforme complète d'agents IA ; mais à l'ère de l'IA, toutes partagent la même aspiration — combiner leurs scénarios métier avec l'IA pour construire des services localisés et des déploiements sur cloud.

Le harness DeepSeek ne fait pas ces choses concrètes. En nous appuyant sur sa philosophie « tout est un plugin », nous pouvons le traiter comme une plateforme de base de type harness, librement exploitable et sans risque de copyright — et cette plateforme de base évolue sans cesse à la pointe de la technique — ce qui épargne aux entreprises les nombreux coûts de la course aux nouvelles technologies.

DSH fait remarquablement bien le runtime mono-Agent — sandboxing d'outils, cascades d'approbation, presets et écosystème de plugins : ces idées avancées sont disponibles immédiatement. Mais les applications d'entreprise ont besoin de davantage : comment isoler les locataires ? Comment rendre les audits inviolables ? Que faire quand un utilisateur demande la suppression de ses données ? Et si quelqu'un épuise les ressources ? Comment mettre à niveau sans casser les données clients ? — Rien de tout cela n'existe dans le noyau DSH, et chaque entreprise qui le reconstruit par elle-même retombe sur les mêmes pièges.

La conclusion de cette exploration : **il faut une plateforme de type harness avec DSH comme noyau**. Le noyau DSH a déjà fourni deux des trois frontières (frontière de capacités, frontière d'invocation) ; seule manque la plus externe (isolation locataires/ressources) — ce projet ne réécrit donc pas DSH : il complète la couche externe au-dessus de lui et verrouille les couches interne et médiane, transformant le « difficile mais juste » de l'entreprise en code de plateforme.

L'objectif : **permettre aux entreprises de se concentrer sur l'implémentation métier tout en profitant pleinement du dividende des idées avancées apportées par DSH** — vous définissez scénarios, outils, connecteurs et skills ; l'isolation, l'audit, les approbations, les quotas & facturation, la persistance & reprise et la compatibilité d'évolution sont garantis par la plateforme, chaque promesse étant verrouillée par un test de contrat. Savoir si et quand mettre DSH à niveau est également votre décision, selon le contexte : les mises à niveau passent par cinq gates (tests de contrat, diff de snapshot, cohérence des trains, enregistrements canari, re-vérification de disponibilité) et se déroulent en douceur, sans impacter le métier.

## Ce que vous n'avez plus à résoudre vous-même

| Problème d'entreprise | Ce que DSH-BOOT vous apporte |
|---|---|
| Isolation multi-locataire | Un `(tenantId, isolationGroupId)` par domaine d'isolation, jamais de partage entre locataires ; baux exclusifs de workspace (fencing epoch transférable) ; les limites de la non-isolation des lectures à l'intérieur du domaine sont divulguées honnêtement — les clients need-to-know passent par des groupes d'isolation de niveau équipe/utilisateur |
| Qui peut faire quoi | JWT (OIDC contre votre IdP d'entreprise) + RBAC contrôlant scénarios, plugins, outils, MCP et plafonds de mode sandbox par locataire/rôle ; ouverture automatisée SSO/SCIM, sessions et jetons totalement invalidés dans les 5 minutes après désactivation du compte |
| Audit inviolable | Ensemble d'audit minimal en six classes **fail-closed** (si l'enregistrement échoue, l'action est refusée) ; WORM + chaîne de hachage ; clés d'audit à cinq champs ; paquets forensiques exportables et vérifiables de manière indépendante |
| Suppression demandée par un utilisateur | Suppression DSR de la liste complète (journaux, pièces jointes, FTS, snapshots, versions du stockage d'objets, couches temporaires des conteneurs) + tombstones + rapport de suppression + preuves par chaîne de hachage ; effective ≤ 24 h, fenêtre de révocation de 7 jours |
| Accapareurs de ressources | Quotas par niveaux (soft/hard) + ordonnancement équitable : les locataires au-delà de leur quota sont **limités proportionnellement**, les autres ne sont pas affectés ; une défaillance de dépendance soft ne bloque jamais l'exécution |
| Quand une dépendance meurt | Échelle de dégradation L0/L1/L1b/L2/L3 : seuils d'entrée/sortie, hystérésis et durée minimale de séjour, alertes agrégées par locataire, budgets d'erreur et listes de gel |
| Mises à niveau qui corrompent les données clients | Machine à états de migration à cinq états + assertion `targetBaseSeq == sourceLastReplicatedSeq` contre les queues déchirées ; source de vérité = journal + watermark de confirmation d'upload ; pipeline de mise à niveau à cinq gates + re-vérification de chaque élément de monitoring prérequis |
| La conformité exige une preuve | Paquets forensiques + preuves de suppression + chaînes de hachage, le tout exportable et vérifiable de manière indépendante |

## Démarrage rapide

**Prérequis** : Node ≥ 22, pnpm ; **un hôte Linux** (le multi-locataire de production est Linux uniquement — Windows a été testé et écarté, voir [Limites](#état-actuel-et-limites-version-honnête)).

```bash
pnpm install

# Démarrer la topologie locale minimale : stub de passerelle inverse + attest en mémoire + Profile d'amorçage
pnpm dev:up          # Point de terminaison HTTP sur http://127.0.0.1:7301 (API JSON)
pnpm dev:smoke       # Exécuter un tour complet
```

## Quelques termes, définis d'abord

Ce dépôt et la conception DSH utilisent ces concepts à répétition :

- **Domaine (isolation domain)** : un environnement d'exécution isolé faisant tourner une instance DSH au service du groupe d'isolation d'un locataire (en production, dans son propre conteneur). Les domaines ne peuvent pas se voir entre eux — c'est l'unité de base de l'isolation multi-locataire.
- **Intérieur / extérieur du domaine** : intérieur = au sein de l'instance DSH, où s'exécutent modèles et outils — **non fiable** (vulnérable à l'injection de prompts ou à la falsification) ; extérieur = le plan de contrôle dsh-boot et le côté passerelle — **fiable**. C'est pourquoi l'autorisation, l'audit, la vérification des artefacts et le jugement de disponibilité se font tous à l'extérieur, et les rapports venant de l'intérieur ne servent que de référence — c'est ce qu'on appelle « la contrainte ne vient que de l'extérieur du domaine ».
- **Gate (GATE)** : un point de contrôle obligatoire avant de passer à l'étape suivante. Chaque gate dispose de vérifications exécutables (tests de contrat, exercices, tests réels) et de preuves archivées ; un échec signifie l'arrêt — aucune signature ne fait passer.
- **Tests de contrat** : chaque promesse sémantique de la plateforme (« les locataires ne peuvent pas se voir », « les approbations échouées ne sont jamais retentées automatiquement », « les queues déchirées n'atteignent jamais l'utilisateur ») est écrite sous forme de test automatisé. Toute modification ultérieure qui casse une promesse fait passer un test en rouge immédiatement.

## Un système métier, trois niveaux

Une session de votre système métier traverse trois niveaux, de haut en bas :

```
Vos utilisateurs
   │
   ▼
┌──────────────────────────────────────────────┐
│ Système métier (le vôtre)                    │
│ Votre UI (Web/App/CLI) + vos flux métier     │
│ + scénarios, outils, connecteurs, skills     │
└──────────────────┬──────────────────────────┘
                   │ Appel de l'API plateforme pour ouvrir une session/tour
                   ▼
┌──────────────────────────────────────────────┐
│ DSH-BOOT (ce projet, couche plateforme)      │
│ Auth · quotas & facturation · approbations · │
│ audit forensique · suppression DSR ·         │
│ dégradation · gates de mise à niveau         │
└──────────────────┬──────────────────────────┘
                   │ Envoi du tour vers un domaine d'isolation
                   ▼
┌──────────────────────────────────────────────┐
│ Noyau DSH (une instance par domaine)         │
│ Appels modèles · exécution d'outils ·        │
│ sandbox · plugins                            │
└──────────────────────────────────────────────┘
```

| Niveau | Fourni par | Ce que vous faites |
|---|---|---|
| **Système métier** | **Vous** : UI, flux métier, et les scénarios/outils/connecteurs/skills que vous définissez | Définir les quatre types d'actifs + appeler l'API plateforme ; l'UI suit votre forme métier (Web/App/CLI conviennent tous) |
| **DSH-BOOT** | **Ce dépôt** (implémenté, verrouillé par des tests de contrat) : multi-locataire, audit, quotas & facturation, DSR, dégradation, gates de mise à niveau | Au déploiement, raccorder l'infrastructure (runtime de conteneurs Linux, IdP d'entreprise, stockage d'objets) et configurer |
| **Noyau DSH** | **Le noyau open-source DSH** (non modifié) : runtime mono-Agent | Rien — versions, disponibilité et dérive sont gérées pour vous par DSH-BOOT |

Du point de vue sécurité, ces trois niveaux correspondent à **trois frontières** : la frontière de capacités interne et la frontière d'invocation médiane sont gardées conjointement par le noyau DSH et DSH-BOOT ; l'isolation locataires/ressources externe est fournie par DSH-BOOT — couche par couche dans le tableau ci-dessous.

## La relation entre DSH-BOOT et DSH : trois frontières, seule la plus externe manque

Le noyau DSH donne à un Agent unique un runtime complet : appels modèles (`ctx.llm`), enregistrement d'outils (`ctx.tools`), cascade d'approbations (`ctx.approval`), sandbox (`dsh-sandbox*`), presets (`dsh-agent-preset`). Mais des trois frontières **il n'en fournit que deux** — et il manque précisément la plus externe, celle dont le multi-locataire a le plus besoin :

| Frontière | Nature | Noyau DSH | Ce que fait DSH-BOOT |
|---|---|---|---|
| **Interne : capacités** | Quels outils/plugins cet Agent possède | ✅ `dsh-agent-preset` + scope | **Verrouiller + gouverner hors du domaine** : le pont d'enregistrement d'outils est le point d'entrée unique (tout ce qui est hors `toolAllowlist` n'est jamais enregistré) ; preset unique + plafond d'élévation de privilèges ; les quatre catalogues Plugin/Connector/Skill/Scenario jugent la légalité de niveau hors du domaine, à la génération du Profile — **les plugins définis par le locataire n'entrent pas dans la couche verrouillée par la plateforme** |
| **Médiane : invocation** | Politique d'écriture de fichiers par appel + cascade d'approbations | ⚠️ Présente, mais le mode Windows est partial | **Compléter + tester en réel** : répondeur d'approbation + canal de paramètres à dix champs (masquage/troncature/séquençage) + échéances à trois niveaux (`T_a`/`T_m`/`T_turn`) ; après tests ACL réels dans le conteneur Windows, **jugement honnête : échec → Windows est exclu de l'isolation multi-locataire** |
| **Externe : isolation locataires/ressources** | Multi-locataire au niveau du noyau | ❌ Aucun | **Construit de zéro (le corps de ce projet)** : pool de domaines à trois états (chaud/tiède/froid), jetons de domaine liés à `(tenantId, isolationGroupId)`, baux exclusifs de workspace, identité/RBAC/quotas/ordonnancement équitable/facturation, SessionPersistence L1/L2 + machine à états de migration, audit fail-closed + chaîne de hachage WORM, preuves de suppression DSR, échelle de dégradation |

**Ce n'est qu'avec les trois frontières réunies que le multi-locataire devient réel.** Revendiquer l'isolation à partir de la seule couche interne (quels outils possède un Agent), c'est déguiser une « frontière de capacités » en « frontière de sécurité » — de là partent toutes les décisions d'architecture de ce projet.

Alors, qu'est-ce que DSH-BOOT au juste ? C'est un **logiciel de plateforme d'agents IA multi-locataire**, composé de trois parties :

1. **Services du plan de contrôle** (paquets TypeScript) : identité & RBAC, quotas & ordonnancement équitable, ingestion de facturation, audit & forensique, suppression DSR, routage & indexation des sessions — la logique back-office d'une plateforme d'entreprise ;
2. **Intégration DSH** (stub de passerelle inverse + pont de domaine) : connecte au plan de contrôle les appels modèles, l'enregistrement d'outils et la cascade d'approbations de DSH, et effectue hors du domaine la vérification des artefacts et la détection de dérive — sans modifier le noyau DSH ;
3. **Gates d'ingénierie** (ensemble de specs + outils de validation) : 397 exigences, six gates, diffs de snapshot — pour qu'aucune des promesses ci-dessus ne soit discrètement cassée par des modifications ultérieures.

Il ne réécrit pas DSH : chaque Agent continue de tourner sur le noyau DSH ; DSH-BOOT gère un grand nombre de ces Agents pour en faire la plateforme multi-locataire d'une entreprise. Forme de déploiement : services du plan de contrôle + une instance DSH par domaine d'isolation (conteneurs Linux) + passerelle.

### Les échanges entre DSH-BOOT et DSH

Chaque domaine d'isolation fait tourner une instance DSH, et seuls quelques canaux bien définis relient les deux :

| Interaction | Direction | Contenu |
|---|---|---|
| **Diffusion du Profile** | Extérieur → intérieur | Les scénarios/outils/connecteurs/skills que vous définissez sont transformés par le générateur de Profile (à l'extérieur) en `pluginSet`, `toolAllowlist`, `skillRoots`, montés en lecture seule dans l'instance DSH |
| **Enregistrement des plugins/artefacts** | Extérieur | Les plugins sont enregistrés dans le Plugin Registry (version, signature, hachage d'intégrité) ; la légalité est jugée à l'extérieur et seulement ensuite entre dans le Profile — **il n'existe aucune action « installer un plugin » à l'intérieur du domaine** |
| **Enregistrement des outils** | Intérieur | Après le démarrage de DSH, le seul point d'entrée est `ctx.tools.register`, et seuls les noms figurant sur la liste blanche `toolAllowlist` passent ; à l'exécution, le domaine signale un hachage de manifeste d'outils que l'extérieur compare — toute divergence et le domaine est détaché |
| **Appels modèles** | Intérieur → extérieur | Les appels `ctx.llm` quittent le domaine via la passerelle inverse : les identifiants sont délivrés par un mandataire à l'extérieur, la consommation de jetons est comptabilisée et facturée à l'extérieur |
| **Approbations** | Intérieur → extérieur | Les actions dangereuses déclenchent une approbation ; le répondeur situé à l'extérieur répond ; les paramètres transitent par le canal (masqués/tronqués/séquencés) et doivent converger dans le délai à trois niveaux |
| **Identifiants** | Extérieur → intérieur | Les connecteurs MCP ne reçoivent que des références d'identifiants à TTL court ; aucun identifiant de longue durée n'existe à l'intérieur du domaine |
| **Persistance de session** | Intérieur → extérieur | Les journaux de session sont écrits sur le volume local du domaine et consommés à l'extérieur selon le « watermark de confirmation d'upload » — quotas, facturation et audit prennent tous cela comme source de vérité |

En une phrase : **l'intérieur ne fait qu'exécuter ; le jugement se fait à l'extérieur**. Une instance DSH ignore l'existence des autres locataires ; toutes les décisions inter-locataires (qui entre, ce qui peut être utilisé, ce qui a été fait, comment supprimer) vivent du côté de DSH-BOOT.

Une analogie en une ligne : **DSH est à DSH-BOOT à peu près ce que la JVM est à Spring Boot** — le noyau gère le runtime d'instances uniques ; la plateforme gouverne la sémantique d'entreprise multi-locataire.

## Construire votre système métier

Écrire un système métier sur DSH-BOOT = définir quatre types d'actifs ; la plateforme s'occupe de tout le reste :

| Vous définissez | Via | La plateforme garantit |
|---|---|---|
| **Scénario (Scenario)** | `presetId + pluginSet + policies` | presetId est append-only (une surface de compatibilité permanente) |
| **Outil (Tool)** | Le point d'entrée unique du pont d'enregistrement ; tout ce qui est hors toolAllowlist n'est jamais enregistré | Même un MCP malveillant qui pousse de nouveaux outils n'entre jamais dans l'ensemble visible |
| **Connecteur (Connector)** | Enregistrement dans le catalogue, `untrusted` par défaut | Les identifiants ne sont stockés que par référence ; les exceptions exigent une revue de sécurité |
| **Skill** | Portées platform / tenant / user à trois niveaux | Assemblé par locataire, jamais de franchissement de niveau |

Exemple minimal (extrait des tests de contrat, à copier et exécuter) :

```js
import { ScenarioCatalog, ConnectorRegistry } from "../../../../packages/control-plane/src/registry/registries.ts";

// Définir un scénario : presetId + ensemble de plugins + politiques
const scenarios = new ScenarioCatalog();
scenarios.define({
  presetId: "preset-1",
  pluginSet: ["dsh-base"],
  policies: { requireApproval: ["shell"], toolAllowlist: ["fs"] },
});

// Enregistrer un connecteur MCP : untrusted par défaut ; les exceptions exigent une revue de sécurité
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

Les utilisateurs métier **n'écrivent aucun code d'isolation, d'audit, de quotas ou de persistance** — définissez les quatre types d'actifs, et la plateforme fournit le reste.

```bash
# 11 suites de contrat — chaque promesse sémantique de la plateforme est verrouillée par un test
pnpm contract:llm && pnpm contract:tools && pnpm contract:approval
pnpm contract:ready && pnpm contract:persistence-l1 && pnpm contract:pool
pnpm contract:identity-quota && pnpm contract:registry
pnpm contract:session-ops && pnpm contract:lifecycle

# Validation des specs et des documents
node tools/lint-specs.mjs && node tools/check-gates.mjs
node tools/validate-contracts.mjs && node tools/lint-docs.mjs
```

## Principes de conception

1. **La contrainte ne vient que de l'extérieur du domaine** — la légalité de niveau est jugée à la génération du Profile ; le domaine ne se porte jamais garant de lui-même (une conformité auto-attestée depuis l'intérieur échoue).
2. **Les gates n'acceptent que des faits venus de l'extérieur du domaine** — les rapports intra-domaine ne servent que de contre-vérification ; toute divergence détache le domaine.
3. **Les dépendances soft ne bloquent jamais l'exécution** — si la facturation ou l'audit général tombe, l'exécution continue ; abandons bornés + tombstones + re-upload.
4. **Dire ce qu'on ne sait pas faire** — chaque élément non terminé est enregistré honnêtement ; aucun chiffre inventé.

## État actuel et limites (version honnête)

- ✅ Les six gates d'étape (GATE-001…006) sont toutes atteignables, chacune avec ses artefacts de preuve ; les 11 suites de contrat sont toutes au vert.
- ❌ **Windows est exclu de l'isolation multi-locataire** : les tests ACL dans le conteneur ont échoué (condition 9 du GATE-002, échec constaté honnêtement).
- 🔶 **3 exercices sur 6** : DRL-03/04/06 exigent des composants internes au noyau et une topologie multi-nœuds — honnêtement bloqués.
- 🔶 **Paramètres de test de charge non renseignés** : `PP-01…PP-35` sont tous des « valeurs dérivées d'exemple, en attente de tests de charge » — aucun chiffre inventé.
- 🚫 **Pas d'UI** : ce dépôt livre des bibliothèques et une API HTTP (stub de passerelle) ; aucune interface produit.
- 📦 **Le déploiement en production exige d'apporter son propre environnement d'exécution** : l'environnement d'exécution conteneur/microVM d'un domaine d'isolation n'est pas implémenté par ce dépôt — au déploiement, l'opérateur fournit l'infrastructure (runtime de conteneurs Linux, IdP d'entreprise, stockage d'objets) et la raccorde ; les développeurs métier ne sont pas affectés.

Pour la comparaison couche par couche entre l'implémentation et le plan initial (six points tous cohérents, y compris la branche « Windows échoue » honnêtement exécutée), voir le [Manuel d'ingénierie](docs/ENGINEERING-HANDBOOK.md#9-实现与规划的一致性对照).

## Documentation

- [Manuel d'ingénierie](docs/ENGINEERING-HANDBOOK.md) — ordre d'autorité, référence rapide des gates, registre des manques, journal des modifications (lecture obligatoire pour les contributeurs)
- [Plan directeur des specs](spec/00-规格总纲.md) — entrée de l'ensemble de specs
- [Matrice des domaines de défaillance](docs/reliability/failure-domain-matrix.md) / [Échelle de dégradation](docs/reliability/degradation-ladder.md) / [Inventaire DSR](docs/security/dsr-inventory-and-proof.md)

## Licence

[MIT](LICENSE)
