[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Русский](README.ru.md) | [Português](README.pt.md)

# DSH-BOOT

> **Una plataforma para construir sistemas de negocio con agentes de IA de nivel empresarial sobre el núcleo DSH.**
> Tú solo escribes la lógica de negocio. Aislamiento multiinquilino, auditoría de seguridad, aprobaciones, cuota y facturación, persistencia de sesiones, compatibilidad evolutiva — todo lo implementa la plataforma y queda fijado por tests de contrato; no necesitas escribirlo tú.

## Por qué existe este proyecto

Desde que DSH se hizo de código abierto, no he dejado de hacerme una pregunta: **¿cómo llevar las capacidades de DSH a las aplicaciones empresariales?**

Siempre he creído que no todas las empresas cuentan con la capacidad de desarrollar una plataforma completa de agentes de IA (AI Agent) propia; pero en la era de la IA, todas comparten la misma necesidad: combinar sus escenarios de negocio con la IA para construir servicios localizados y despliegues en la nube.

DeepSeek harness no se ocupa de estas cosas concretas. Basándonos en su filosofía de «todo es un plugin», podemos tomarlo como una plataforma base de tipo harness de libre disposición y sin riesgos de copyright, y esta plataforma base evoluciona sin parar en la vanguardia tecnológica — lo que ahorra a muchas empresas los múltiples costes de perseguir nuevas tecnologías.

DSH hace muy bien el runtime de un agente único — sandbox de herramientas, cascada de aprobaciones, presets y ecosistema de plugins, ideas avanzadas listas al abrir la caja. Pero las aplicaciones empresariales necesitan más: ¿cómo aislar a los inquilinos? ¿Cómo lograr que la auditoría sea imposible de negar? ¿Qué pasa cuando un usuario pide borrar sus datos? ¿Y si un inquilino deja a los demás sin recursos? ¿Cómo actualizar sin romper los datos de los clientes? — El núcleo DSH no tiene nada de esto, y cada empresa que lo construye por su cuenta vuelve a pisar las mismas minas.

La conclusión de esa exploración: **se necesita una plataforma harness con DSH como núcleo**. El núcleo DSH ya da dos de las tres fronteras (frontera de capacidades, frontera de invocación); solo falta la más externa (aislamiento de inquilinos/recursos) — por eso este proyecto no reescribe DSH: completa la capa externa sobre él y fija la interna y la media, convirtiendo lo «difícil pero correcto» del software empresarial en código de plataforma.

El objetivo: **que las empresas se centren en la implementación del negocio mientras disfrutan plenamente del dividendo de las ideas avanzadas que aporta DSH** — tú defines escenarios, herramientas, conectores y skills; el aislamiento, la auditoría, las aprobaciones, la cuota y facturación, la persistencia y recuperación, y la compatibilidad evolutiva los respalda la plataforma, y cada promesa queda fijada por tests de contrato. Si actualizar DSH y cuándo hacerlo también lo decides tú según el caso: la actualización se realiza sin problemas tras pasar la verificación de los cinco gates de la pipeline (tests de contrato, diff de snapshots, consistencia del tren, registros canary, reverificación de readiness), sin afectar al negocio.

## Lo que ya no tienes que resolver

| Problema empresarial | Lo que te da DSH-BOOT |
|---|---|
| Aislamiento multiinquilino | Un dominio de aislamiento por `(tenantId, isolationGroupId)`, los inquilinos nunca comparten; leases exclusivos de workspace (fencing epoch transferible); los límites de la no separación de lectura dentro del dominio se divulgan honestamente — los clientes need-to-know usan grupos de aislamiento a nivel de equipo/usuario |
| Quién puede hacer qué | JWT (OIDC contra el IdP empresarial) + RBAC controla por inquilino/rol escenarios, plugins, herramientas, MCP y los topes del modo sandbox; el alta vía SSO/SCIM es automática, y dentro de los 5 minutos tras desactivar una cuenta, sesiones y tokens quedan totalmente invalidados |
| Lo que se hizo es imposible de negar | El conjunto mínimo de auditoría, seis clases, **fail-closed** (si no se puede registrar, la acción se deniega); WORM + cadena de hashes; claves de auditoría de cinco campos; paquetes forenses exportables y verificables de forma independiente |
| El usuario pide borrar sus datos | Borrado DSR de lista completa (logs, adjuntos, FTS, snapshots, versiones del almacén de objetos, capas temporales de contenedores) + tombstones + informes de borrado + pruebas con cadena de hashes; efectivo en ≤ 24 h, ventana de revocación de 7 días |
| Alguien agota los recursos | Cuotas por niveles (blandas/duras) + programación justa: los inquilinos por encima de su cuota ven **su velocidad limitada proporcionalmente**, los demás no se ven afectados; los fallos de dependencias blandas nunca bloquean la ejecución |
| ¿Y si muere una dependencia? | Escalera de degradación L0/L1/L1b/L2/L3: umbrales de entrada/salida, histéresis y permanencia mínima, alertas agregadas por inquilino, presupuestos de error y listas de congelación |
| Las actualizaciones corrompen datos de clientes | Máquina de estados de migración de cinco estados + aserción `targetBaseSeq == sourceLastReplicatedSeq` contra colas rasgadas; fuente de verdad = log + marca de agua de subida confirmada; pipeline de actualización de cinco gates + reverificación uno a uno de los ítems de monitorización previos |
| El cumplimiento requiere prueba | Paquetes forenses + pruebas de borrado + cadenas de hashes, todo exportable y verificable de forma independiente |

## Inicio rápido

**Requisitos**: Node ≥ 22, pnpm; **un equipo Linux** (el multiinquilino de producción es solo Linux — Windows fue probado en la práctica y excluido, ver [Límites](#estado-actual-y-límites-versión-honesta)).

```bash
pnpm install

# Levanta la topología local mínima: stub de gateway inverso + attest en memoria + Profile semilla
pnpm dev:up          # Endpoint HTTP en http://127.0.0.1:7301 (API JSON)
pnpm dev:smoke       # Ejecuta una ronda completa
```

## Unos términos, definidos primero

Este repositorio y el diseño de DSH usan una y otra vez estos conceptos:

- **Dominio (isolation domain)**: un entorno de ejecución aislado que corre una instancia DSH sirviendo al grupo de aislamiento de un inquilino (en producción, dentro de su propio contenedor). Los dominios no pueden verse entre sí — esta es la unidad del aislamiento multiinquilino.
- **Dentro / fuera del dominio**: dentro = en el interior de la instancia DSH, donde se ejecutan el modelo y las herramientas, **no confiable** (vulnerable a inyección de prompts o manipulación); fuera = el plano de control y el gateway de dsh-boot, **confiable**. Por eso la autorización, la auditoría, la verificación de artefactos y la determinación de readiness se hacen fuera del dominio, y lo que se reporta desde dentro solo vale como referencia — esto es «la fuerza coercitiva solo viene de fuera del dominio».
- **Gate (GATE)**: punto de control obligatorio antes de pasar a la fase siguiente. Cada gate tiene verificaciones ejecutables (tests de contrato, drills, pruebas reales) y evidencia archivada; no pasar significa parar — nadie firma el pase.
- **Tests de contrato**: cada promesa de la plataforma («los inquilinos no pueden verse entre sí», «las aprobaciones fallidas no se reintentan automáticamente», «las colas rasgadas jamás se devuelven al usuario») se escribe como test automatizado. Cualquier cambio posterior que rompa una promesa pone un test en rojo al instante.

## Un sistema de negocio, tres niveles

Una sesión de tu sistema de negocio pasa por tres niveles, de arriba abajo:

```
Tus usuarios
   │
   ▼
┌──────────────────────────────────────────────┐
│ Sistema de negocio (lo escribes tú)          │
│ Tu UI (Web/App/CLI) + tus flujos de negocio  │
│ + escenarios, herramientas, conectores, skills│
└──────────────────┬───────────────────────────┘
                   │ Llama a la API de la plataforma para iniciar sesión/turno
                   ▼
┌──────────────────────────────────────────────┐
│ DSH-BOOT (este proyecto, capa de plataforma) │
│ Acceso · cuota y facturación · aprobaciones ·│
│ auditoría forense · borrado DSR · degradación│
└──────────────────┬───────────────────────────┘
                   │ Despacha el turno a un dominio de aislamiento
                   ▼
┌──────────────────────────────────────────────┐
│ Núcleo DSH (una instancia por dominio)       │
│ Llamadas al modelo · ejecución de            │
│ herramientas · sandbox · plugins             │
└──────────────────────────────────────────────┘
```

| Nivel | Quién lo proporciona | Qué haces tú |
|---|---|---|
| **Sistema de negocio** | **Lo escribes tú**: interfaz, flujos de negocio, y los escenarios/herramientas/conectores/skills que definas | Define los cuatro tipos de activos + llama a la API de la plataforma; la interfaz sigue la forma de tu negocio (Web/App/CLI, todo vale) |
| **DSH-BOOT** | **Este repositorio** (implementado, fijado por tests de contrato): multiinquilino, auditoría, cuota y facturación, DSR, degradación, gates de actualización | Al desplegar, conecta la infraestructura (runtime de contenedores Linux, IdP empresarial, almacenamiento de objetos) y configura |
| **Núcleo DSH** | **El núcleo de código abierto de DSH** (sin modificar): runtime de agente único | Nada — las versiones, el readiness y la deriva los gestiona DSH-BOOT por ti |

Desde la perspectiva de seguridad, estos tres niveles corresponden a **tres fronteras**: la frontera de capacidades interna y la frontera de invocación media las custodian conjuntamente el núcleo DSH y DSH-BOOT; el aislamiento de inquilinos/recursos externo lo proporciona DSH-BOOT — nivel por nivel, véase la tabla siguiente.

## La relación entre DSH-BOOT y DSH: tres fronteras, solo falta la más externa

El núcleo DSH da a un agente único un runtime completo: llamadas al modelo (`ctx.llm`), registro de herramientas (`ctx.tools`), cascada de aprobaciones (`ctx.approval`), sandbox (`dsh-sandbox*`), presets (`dsh-agent-preset`). Pero **de las tres fronteras solo da dos** — y falta justo la que el multiinquilino más necesita:

| Frontera | Naturaleza | Núcleo DSH | Qué hace DSH-BOOT |
|---|---|---|---|
| **Interna: capacidades** | Qué herramientas/plugins tiene este agente | ✅ `dsh-agent-preset` + scope | **Fijar + gobernar fuera del dominio**: el puente de registro de herramientas es la única entrada que intercepta (lo que no esté en toolAllowlist no se registra jamás); preset único + techo de privilegios; los cuatro catálogos Plugin/Connector/Skill/Scenario juzgan la legalidad de nivel fuera del dominio al generar el Profile — **los plugins definidos por el inquilino no entran en la capa bloqueada por la plataforma** |
| **Media: invocación** | Política de escritura de archivos por llamada + cascada de aprobaciones | ⚠️ Presente, pero el nivel Windows es partial | **Completar + probar**: respondedor de aprobaciones + canal de parámetros de diez campos (redacción/truncamiento/ordenación) + plazos de tres niveles (`T_a`/`T_m`/`T_turn`); tras la prueba real de ACL en contenedor Windows, **el veredicto honesto fue no apto → Windows queda excluido del aislamiento multiinquilino** |
| **Externa: aislamiento de inquilinos/recursos** | Multiinquilino a nivel de kernel | ❌ Ninguno | **Construido desde cero (el grueso de este proyecto)**: pool de dominios de aislamiento de tres estados (caliente/templado/frío), tokens de dominio ligados a `(tenantId, isolationGroupId)`, leases exclusivos de workspace, identidad/RBAC/cuota/programación justa/facturación, SessionPersistence L1/L2 + máquina de estados de migración, auditoría fail-closed + WORM con cadena de hashes, pruebas de borrado DSR, escalera de degradación |

**Solo con las tres fronteras completas se sostiene el multiinquilino.** Afirmar que se puede aislar basándose solo en la capa interna (qué herramientas tiene el agente) es disfrazar una «frontera de capacidades» de «frontera de seguridad» — ese es el punto de partida de todas las decisiones de arquitectura de este proyecto.

Entonces, ¿qué es exactamente DSH-BOOT? Es un **software de plataforma de agentes de IA multiinquilino**, formado por tres partes:

1. **Servicios del plano de control** (paquetes TypeScript): identidad y RBAC, cuota y programación justa, consolidación de facturación, auditoría y forense, borrado DSR, enrutamiento e indexación de sesiones — la lógica de back-office de una plataforma empresarial;
2. **Integración con DSH** (stub de gateway inverso + puente de dominio): conecta las llamadas al modelo, el registro de herramientas y la cascada de aprobaciones de DSH con el plano de control, y realiza la verificación de artefactos y la detección de deriva fuera del dominio — sin modificar el núcleo DSH;
3. **Gates de ingeniería** (conjunto de specs + herramientas de validación): 397 requisitos, seis gates, diff de snapshots — para que ninguna de las promesas anteriores pueda romperse en silencio con cambios posteriores.

No reescribe DSH: cada agente sigue corriendo sobre el núcleo DSH; DSH-BOOT gestiona muchos agentes así hasta convertirlos en la plataforma multiinquilino de una empresa. Forma de despliegue: servicios del plano de control + una instancia DSH por dominio de aislamiento (contenedores Linux) + gateway.

### La interacción entre DSH-BOOT y DSH

En cada dominio de aislamiento corre una instancia DSH, y entre ambas solo hay unos pocos canales bien definidos:

| Interacción | Dirección | Contenido |
|---|---|---|
| **Despacho del Profile** | Fuera → dentro | Los escenarios/herramientas/conectores/skills que defines pasan por el generador de Profiles (fuera) y producen `pluginSet`, `toolAllowlist`, `skillRoots`, montados en modo solo lectura dentro de la instancia DSH |
| **Registro de plugins/artefactos** | Fuera | Los plugins se registran en el Plugin Registry (versión, firma, hash de integridad); la legalidad se juzga fuera y solo entonces entra en el Profile — **dentro del dominio no existe la acción de «instalar un plugin»** |
| **Registro de herramientas** | Dentro | Tras arrancar DSH, la única entrada es `ctx.tools.register`, y solo dejan pasar los nombres de la lista `toolAllowlist`; en ejecución, el dominio reporta un hash del manifiesto de herramientas que fuera se compara — cualquier discrepancia y el dominio se retira |
| **Llamadas al modelo** | Dentro → fuera | Las llamadas `ctx.llm` salen del dominio por el gateway inverso: las credenciales las emite un proxy fuera del dominio, y el uso de tokens se mide y factura fuera |
| **Aprobaciones** | Dentro → fuera | Las acciones peligrosas levantan una aprobación; el respondedor de fuera contesta; los parámetros viajan por el canal (redactados/truncados/ordenados) y deben converger dentro del plazo de tres niveles |
| **Credenciales** | Fuera → dentro | Los conectores MCP solo reciben referencias de credenciales de TTL corto; dentro del dominio no hay credenciales de larga vida |
| **Persistencia de sesiones** | Dentro → fuera | Los logs de sesión se escriben en el volumen local del dominio y fuera se consumen según la «marca de agua de subida confirmada» — cuota, facturación y auditoría toman esto como fuente de verdad |

En una frase: **dentro del dominio solo se ejecuta; el juicio ocurre fuera**. Una instancia DSH no sabe que existen otros inquilinos; todas las decisiones entre inquilinos (quién entra, qué puede usar, qué hizo, cómo se borra) viven del lado de DSH-BOOT.

La analogía en una línea: **DSH es a DSH-BOOT aproximadamente lo que la JVM es a Spring Boot** — el kernel gestiona el runtime de instancias únicas; la plataforma gobierna la semántica empresarial multiinquilino.

## Construye tu sistema de negocio

Escribir un sistema de negocio sobre DSH-BOOT = definir cuatro tipos de activos; la plataforma se encarga de todo lo demás:

| Defines | Mediante | La plataforma garantiza |
|---|---|---|
| **Escenario** | `presetId + pluginSet + policies` | presetId es de solo adición (una superficie de compatibilidad permanente) |
| **Herramienta** | La única entrada del puente de registro; lo que no esté en toolAllowlist no se registra jamás | Ni un MCP malicioso empujando herramientas nuevas entra en el conjunto visible |
| **Conector** | Registro por catálogo, `untrusted` por defecto | Las credenciales se guardan solo por referencia; las excepciones requieren revisión de seguridad |
| **Skill** | Ámbitos platform / tenant / user | Se ensamblan por inquilino, sin cruzar niveles jamás |

Ejemplo mínimo (extraído de los tests de contrato, copiar y ejecutar):

```js
import { ScenarioCatalog, ConnectorRegistry } from "../../../../packages/control-plane/src/registry/registries.ts";

// Define un escenario: presetId + conjunto de plugins + políticas
const scenarios = new ScenarioCatalog();
scenarios.define({
  presetId: "preset-1",
  pluginSet: ["dsh-base"],
  policies: { requireApproval: ["shell"], toolAllowlist: ["fs"] },
});

// Registra un conector MCP: untrusted por defecto; las excepciones requieren revisión de seguridad
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

Los usuarios de negocio **no escriben nada de código de aislamiento, auditoría, cuotas ni persistencia** — definen los cuatro tipos de activos y esto lo proporciona la plataforma.

```bash
# 11 suites de contrato — cada promesa semántica de la plataforma queda fijada por un test
pnpm contract:llm && pnpm contract:tools && pnpm contract:approval
pnpm contract:ready && pnpm contract:persistence-l1 && pnpm contract:pool
pnpm contract:identity-quota && pnpm contract:registry
pnpm contract:session-ops && pnpm contract:lifecycle

# Validación de specs y documentación
node tools/lint-specs.mjs && node tools/check-gates.mjs
node tools/validate-contracts.mjs && node tools/lint-docs.mjs
```

## Principios de diseño

1. **La fuerza coercitiva solo viene de fuera del dominio** — la legalidad de nivel se juzga al generar el Profile; el dominio no se prueba a sí mismo (el cumplimiento auto-atestiguado dentro del dominio no pasa).
2. **Los gates solo aceptan hechos de fuera del dominio** — lo reportado desde dentro solo vale como verificación cruzada; cualquier discrepancia y el dominio se retira.
3. **Las dependencias blandas nunca bloquean la ejecución** — si mueren la facturación o la auditoría general, la ejecución continúa; descartes acotados + tombstones + re-subida.
4. **Di lo que no puedes hacer** — cada elemento sin terminar se registra honestamente; no se inventan números.

## Estado actual y límites (versión honesta)

- ✅ Los seis gates de fase (GATE-001…006) son alcanzables, cada uno con sus artefactos de evidencia; las 11 suites de contrato en verde.
- ❌ **Windows queda excluido del aislamiento multiinquilino**: las pruebas de ACL en contenedor no pasaron (condición 9 de GATE-002, marcado fail honestamente).
- 🔶 **3 de 6 drills**: DRL-03/04/06 requieren componentes del kernel y topología multinodo — honestamente blocked.
- 🔶 **Parámetros de pruebas de carga sin rellenar**: `PP-01…PP-35` son todos «valores derivados de ejemplo, pendientes de pruebas de carga» — no se inventan números.
- 🚫 **Sin UI**: este repositorio entrega librerías y una API HTTP (stub de gateway); no incluye interfaz de producto.
- 📦 **El despliegue en producción requiere traer tu propio entorno de ejecución**: el entorno de ejecución de contenedores/microVM de un dominio de aislamiento no lo implementa este repositorio — al desplegar, quien despliega proporciona la infraestructura (runtime de contenedores Linux, IdP empresarial, almacenamiento de objetos) y la conecta; los usuarios de negocio no se ven afectados.

Para la comparación de consistencia nivel por nivel contra el plan original (los seis ítems consistentes, incluida la rama «Windows no pasa» ejecutada honestamente), ver el [Manual de Ingeniería](docs/ENGINEERING-HANDBOOK.md#9-实现与规划的一致性对照).

## Documentación

- [Manual de Ingeniería](docs/ENGINEERING-HANDBOOK.md) — orden de autoridad, referencia rápida de gates, registro de brechas, registro de cambios (lectura obligatoria para contribuidores)
- [Spec maestro](spec/00-规格总纲.md) — entrada al conjunto de specs
- [Matriz de dominios de fallo](docs/reliability/failure-domain-matrix.md) / [Escalera de degradación](docs/reliability/degradation-ladder.md) / [Inventario DSR](docs/security/dsr-inventory-and-proof.md)

## Licencia

[MIT](LICENSE)
