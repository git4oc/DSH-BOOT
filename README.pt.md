[English](README.en.md) | [简体中文](README.md) | [日本語](README.ja.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md) | [Русский](README.ru.md) | [Português](README.pt.md)

# DSH-BOOT

> **Uma plataforma de agentes de IA de nível corporativo construída sobre o kernel do DSH.**
> Você só escreve a lógica de negócio. Isolamento multilocatário, auditoria de segurança, aprovações, quota e billing, persistência de sessão, compatibilidade de evolução — tudo isso é implementado pela plataforma e cravado por testes de contrato; você não precisa escrever por conta própria.

## Por que este projeto existe

Depois que o DSH se tornou open source, fiquei pensando numa pergunta: **como levar as capacidades do DSH para dentro de aplicações corporativas?**

Sempre acreditei que nem toda empresa tem capacidade de desenvolver uma plataforma completa de agentes de IA (AI Agent) própria; mas, na era da IA, todas as empresas têm o mesmo anseio — combinar seus cenários de negócio com IA, fazendo construção de serviços localizados e deployment em nuvem.

O harness do DeepSeek não faz essas coisas concretas. Com base na filosofia dele de que "tudo é plugin", podemos tratá-lo como uma plataforma base de harness de livre disposição e sem risco de copyright — e essa base está na fronteira da tecnologia, evoluindo constantemente —, o que poupa muitas empresas dos vários custos de correr atrás de tecnologia nova.

O DSH fez muito bem o runtime de Agent single — sandbox de ferramentas, cascata de aprovação, presets e ecossistema de plugins, essas ideias avançadas vêm prontas de fábrica. Mas aplicações corporativas precisam de mais: como isolar múltiplos locatários? Como fazer a auditoria ser impossível de negar? O que fazer quando o usuário quer deletar dados? E se alguém consumir todos os recursos? Como atualizar sem estragar os dados dos clientes? — disso o kernel do DSH não tem nada, e cada empresa que constrói tudo sozinha acaba pisando de novo nos mesmos buracos.

A conclusão da exploração: **é necessária uma plataforma harness tendo o DSH como kernel**. O kernel do DSH já entrega duas das três fronteiras (fronteira de capacidade, fronteira de invocação); falta apenas a mais externa (isolamento de locatário/recursos) — por isso este projeto não reescreve o DSH: ele completa a camada externa sobre ele e crava as camadas interna e intermediária, transformando o "difícil porém certo" do software corporativo em código de plataforma.

O objetivo é: **a empresa foca na implementação do negócio e, ao mesmo tempo, desfruta plenamente do dividendo das ideias avançadas que o DSH traz** — você define cenários, ferramentas, conectores e skills; isolamento, auditoria, aprovações, quota e billing, persistência e recuperação, compatibilidade de evolução ficam por conta da plataforma, e cada promessa está cravada por testes de contrato. Se atualizar o DSH, e quando atualizar, também é você quem julga conforme o caso: o upgrade passa pelo pipeline de cinco gates (testes de contrato, diff de snapshot, consistência do train, registros de canary, reverificação de prontidão) e acontece de forma suave, sem afetar o negócio.

## O que você não precisa mais resolver

| Desafio corporativo | O que o DSH-BOOT entrega |
|---|---|
| Isolamento multilocatário | Um `(tenantId, isolationGroupId)` por domínio, locatários nunca compartilham nada; leases exclusivos de workspace (fencing epoch transferível); os limites da não isolação de leitura dentro do domínio são divulgados honestamente — clientes need-to-know usam grupos de isolamento de nível de equipe/usuário |
| Quem pode fazer o quê | JWT (OIDC contra o IdP corporativo) + RBAC controlando cenários, plugins, ferramentas, MCP e teto de modo de sandbox por locatário/papel; onboarding automático via SSO/SCIM; após desativação da conta, sessões e tokens expiram totalmente em até 5 minutos |
| O que foi feito não se pode negar | Conjunto mínimo de auditoria, seis classes, **fail-closed** (se não consegue registrar, a ação é negada); WORM + cadeia de hashes; chave de auditoria de cinco campos; pacote forense exportável e verificável de forma independente |
| Usuário quer deletar dados | Exclusão DSR de lista completa (logs/anexos/FTS/snapshots/versões do object store/camadas temporárias de container) + tombstones + relatório de exclusão + prova por cadeia de hashes; efetiva em ≤ 24h, janela de revogação de 7 dias |
| Alguém devora os recursos | Quotas em níveis (soft/hard) + agendamento justo: locatário acima da quota sofre **throttle proporcional**, os demais não são afetados; falha de dependência soft nunca bloqueia a execução |
| E se uma dependência cair | Escada de degradação L0/L1/L1b/L2/L3: limiares de entrada/saída, histerese e permanência mínima, alertas agregados por locatário, orçamento de erro e listas de congelamento |
| Upgrade corrompendo dados de clientes | Máquina de estados de migração com cinco estados + asserção `targetBaseSeq == sourceLastReplicatedSeq` contra a cauda rasgada; fonte da verdade = log + watermark de confirmação de upload; pipeline de upgrade de cinco gates + reverificação item a item dos pré-requisitos de monitoramento |
| Compliance precisa de prova | Pacote forense + prova de exclusão + cadeia de hashes, tudo exportável e verificável de forma independente |

## Início rápido

**Requisitos**: Node ≥ 22, pnpm; **um host Linux** (multilocação de produção é só Linux — Windows foi testado e excluído, veja [Fronteiras](#estado-atual-e-fronteiras-a-versão-honesta)).

```bash
pnpm install

# Sobe a topologia local mínima: stub de gateway reverso + attest em memória + Profile semente
pnpm dev:up          # Endpoint HTTP em http://127.0.0.1:7301 (API JSON)
pnpm dev:smoke       # Roda um turno completo
```

## Alguns termos, definidos primeiro

Este repositório (e o design do DSH) usa estes conceitos repetidamente:

- **Domínio (isolation domain)**: um ambiente de execução isolado, rodando uma instância do DSH que serve o grupo de isolamento de um locatário (em produção, dentro do próprio container). Domínios não se enxergam mutuamente — esta é a unidade básica do isolamento multilocatário.
- **Dentro / fora do domínio**: dentro = no interior da instância DSH, onde o modelo e as ferramentas executam — **não confiável** (pode sofrer injeção de prompt ou adulteração); fora = do lado do plano de controle e do gateway do dsh-boot — **confiável**. Por isso autorização, auditoria, verificação de artefatos e julgamento de prontidão acontecem todos fora do domínio, e o que é reportado de dentro serve apenas como referência — isso é "o enforcement vem só de fora do domínio".
- **Gate (GATE)**: um checkpoint obrigatório antes de entrar na fase seguinte. Cada gate tem verificação executável (testes de contrato, drills, testes reais) e evidência arquivada; não passou, para — ninguém assina em cima.
- **Testes de contrato**: cada semântica prometida pela plataforma ("locatários não se enxergam mutuamente", "aprovação que falha não tenta de novo automaticamente", "a cauda rasgada nunca chega ao usuário") vira um teste automatizado. Qualquer mudança futura que quebre a promessa deixa o teste vermelho na hora.

## Um sistema de negócio, três camadas

Uma sessão do seu sistema de negócio passa por três camadas, de cima para baixo:

```
Seus usuários
   │
   ▼
┌──────────────────────────────────────────────┐
│ Sistema de negócio (seu)                     │
│ Sua UI (Web/App/CLI) + seus fluxos de negócio│
│ + cenários, ferramentas, conectores e skills │
└──────────────────┬───────────────────────────┘
                   │ Chama a API da plataforma para iniciar a sessão/turno
                   ▼
┌──────────────────────────────────────────────┐
│ DSH-BOOT (este projeto, camada de plataforma)│
│ Auth · quota e billing · aprovações ·        │
│ auditoria forense · exclusão DSR ·           │
│ degradação · gates de upgrade                │
└──────────────────┬───────────────────────────┘
                   │ Despacha o turno para um domínio de isolamento
                   ▼
┌──────────────────────────────────────────────┐
│ Kernel DSH (uma instância por domínio)       │
│ Chamadas de modelo · execução de ferramentas │
│ sandbox · plugins                            │
└──────────────────────────────────────────────┘
```

| Camada | Fornecida por | O que você faz |
|---|---|---|
| **Sistema de negócio** | **Você**: interface, fluxos de negócio, e os cenários/ferramentas/conectores/skills que você define | Definir os quatro tipos de ativo + chamar a API da plataforma; a interface segue a forma do seu negócio (Web/App/CLI, tudo funciona) |
| **DSH-BOOT** | **Este repositório** (implementado, cravado por testes de contrato): multilocação, auditoria, quota e billing, DSR, degradação, gates de upgrade | No deployment, conectar a infraestrutura (runtime de containers Linux, IdP corporativo, object storage) e fazer a configuração |
| **Kernel DSH** | **O kernel open-source do DSH** (sem modificação): runtime de Agent single | Nada — versão, prontidão e drift ficam a cargo do DSH-BOOT para você |

Na perspectiva de segurança, essas três camadas correspondem às **três fronteiras**: a fronteira de capacidade interna e a fronteira de invocação intermediária são guardadas em conjunto pelo kernel do DSH e pelo DSH-BOOT; o isolamento externo de locatário/recursos é fornecido pelo DSH-BOOT — camada a camada, veja na tabela abaixo.

## A relação entre DSH-BOOT e DSH: três fronteiras, falta só a mais externa

O kernel do DSH entrega a um Agent single o runtime completo: chamadas de modelo (`ctx.llm`), registro de ferramentas (`ctx.tools`), cascata de aprovação (`ctx.approval`), sandbox (`dsh-sandbox*`), presets (`dsh-agent-preset`). Mas das três fronteiras **ele entrega só duas** — e falta exatamente a camada externa, a que a multilocação mais precisa:

| Camada | Natureza da fronteira | Kernel DSH | O que o DSH-BOOT fez |
|---|---|---|---|
| **Interna: fronteira de capacidade** | Quais ferramentas/plugins este Agent tem | ✅ `dsh-agent-preset` + scope | **Cravada + governada de fora do domínio**: a ponte de registro de ferramentas intercepta como única entrada (o que não estiver no toolAllowlist não é registrado de jeito nenhum); preset único + teto de elevação de privilégio; os quatro catálogos Plugin/Connector/Skill/Scenario têm a legalidade de camada julgada na geração do Profile, fora do domínio — **plugin customizado do locatário não entra na camada travada pela plataforma** |
| **Intermediária: fronteira de invocação** | Política de escrita de arquivo por chamada + cascata de aprovação | ⚠️ Existe, mas o modo Windows é partial | **Completada + testada de verdade**: respondente de aprovações + canal de parâmetros de dez campos (mascaramento/truncamento/ordenação) + prazos de três camadas (`T_a`/`T_m`/`T_turn`); testes reais de ACL dentro de container Windows **julgados honestamente como reprovados → Windows fica excluído do isolamento multilocatário** |
| **Externa: isolamento de locatário/recursos** | Multilocação em nível de kernel | ❌ Nada | **Construída do zero (o corpo principal desta engenharia)**: pool de domínios de isolamento com três estados (quente/morno/frio), token de domínio vinculado a `(tenantId, isolationGroupId)`, lease exclusivo de workspace, identidade/RBAC/quota/agendamento justo/billing, SessionPersistence L1/L2 + máquina de estados de migração, auditoria fail-closed + WORM com cadeia de hashes, prova de exclusão DSR, escada de degradação |

**Com as três camadas completas é que a multilocação se sustenta.** Alegar isolamento tendo só a camada interna (quais ferramentas o Agent tem) é disfarçar a "fronteira de capacidade" de "fronteira de segurança" — este é o ponto de partida de todas as decisões de arquitetura deste projeto.

Então, o que exatamente é o DSH-BOOT? É um **software de plataforma multilocatária para agentes de IA**, composto de três partes:

1. **Serviços do plano de controle** (pacotes TypeScript): identidade e RBAC, quota e agendamento justo, consolidação de billing, auditoria e forense, exclusão DSR, roteamento e indexação de sessões — a lógica de bastidor de uma plataforma corporativa;
2. **Integração com o DSH** (stub de gateway reverso + ponte de domínio): leva as chamadas de modelo, o registro de ferramentas e a cascata de aprovação do DSH ao plano de controle, e faz a verificação de artefatos e a detecção de drift fora do domínio — sem modificar o kernel do DSH;
3. **Gates de engenharia** (conjunto de specs + ferramentas de validação): 397 requisitos, seis gates, diff de snapshot — garantindo que as promessas acima não sejam quebradas silenciosamente por mudanças futuras.

Ele não reescreve o DSH: cada Agent continua rodando no kernel do DSH; o DSH-BOOT gerencia muitos Agents assim como a plataforma multilocatária de uma empresa. Forma de deployment: serviços do plano de controle + uma instância DSH por domínio de isolamento (containers Linux) + gateway.

### A interação entre DSH-BOOT e DSH

Cada domínio de isolamento roda uma instância DSH, e entre os dois existem apenas alguns canais bem definidos:

| Interação | Direção | Conteúdo |
|---|---|---|
| **Despacho de Profile** | Fora → dentro | Os cenários/ferramentas/conectores/skills que você define passam pelo gerador de Profile (fora do domínio), que produz `pluginSet`, `toolAllowlist`, `skillRoots`, montados somente leitura na instância DSH |
| **Registro de plugin/artefato** | Fora | Plugins são registrados no Plugin Registry (versão, assinatura, hash de integridade); a legalidade é julgada fora do domínio e só então entra no Profile — **dentro do domínio não existe a ação "instalar plugin"** |
| **Registro de ferramentas** | Dentro | Depois que o DSH inicia, a única entrada é `ctx.tools.register`, e só passa o que estiver na allowlist do `toolAllowlist`; em runtime, o domínio reporta o hash da lista de ferramentas e o lado de fora compara — divergiu, o domínio é destacado |
| **Chamada de modelo** | Dentro → fora | A chamada `ctx.llm` sai do domínio pelo gateway reverso: a credencial é distribuída por proxy do lado de fora, e o uso de tokens é medido e faturado fora |
| **Aprovação** | Dentro → fora | Ação perigosa levanta aprovação, o respondente do lado de fora responde; os parâmetros chegam pelo canal (mascaramento/truncamento/ordenação) e precisam convergir dentro do prazo de três camadas |
| **Credenciais** | Fora → dentro | Conectores MCP recebem só referências de credencial de TTL curto; dentro do domínio não se armazenam credenciais de longa duração |
| **Persistência de sessão** | Dentro → fora | Os logs de sessão são gravados no volume local do domínio, e o lado de fora consome na "watermark de confirmação de upload" — quota, billing e auditoria tomam isso como fonte da verdade |

Em uma frase: **dentro do domínio só se executa; do lado de fora se julga**. A instância DSH não sabe que outros locatários existem; todas as decisões entre locatários (quem entra, o que pode usar, o que fez, como deletar) ficam do lado do DSH-BOOT.

A correspondência em uma frase: **o DSH está para o DSH-BOOT aproximadamente como a JVM está para o Spring Boot** — o kernel cuida do runtime de instância única; a plataforma cuida da semântica corporativa multilocatária.

## Construindo seu sistema de negócio

Escrever um sistema de negócio em cima do DSH-BOOT = definir quatro tipos de ativo; a plataforma cuida de todo o resto:

| Você define | Via | A plataforma garante |
|---|---|---|
| **Cenário (Scenario)** | `presetId + pluginSet + policies` | presetId é somente-append (superfície de compatibilidade permanente) |
| **Ferramenta (Tool)** | A ponte de registro como única entrada; o que não estiver no toolAllowlist não é registrado | Nem MCP malicioso empurrando ferramentas novas entra no conjunto visível |
| **Conector (Connector)** | Registro via catálogo, `untrusted` por padrão | Credencial só é armazenada como referência; exceções exigem revisão de segurança |
| **Skill** | Escopos de três níveis platform / tenant / user | Montado por locatário, cada um sem ultrapassar limites |

Exemplo mínimo (extraído dos testes de contrato, copie e execute):

```js
import { ScenarioCatalog, ConnectorRegistry } from "../../../../packages/control-plane/src/registry/registries.ts";

// Define um cenário: presetId + conjunto de plugins + políticas
const scenarios = new ScenarioCatalog();
scenarios.define({
  presetId: "preset-1",
  pluginSet: ["dsh-base"],
  policies: { requireApproval: ["shell"], toolAllowlist: ["fs"] },
});

// Registra um conector MCP: untrusted por padrão; exceções exigem revisão de segurança
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

Quem constrói o negócio **não escreve nenhum código de isolamento, auditoria, quota ou persistência** — define os quatro tipos de ativo, e isso é fornecido pela plataforma.

```bash
# 11 suítes de contrato — cada semântica prometida pela plataforma está cravada por um teste
pnpm contract:llm && pnpm contract:tools && pnpm contract:approval
pnpm contract:ready && pnpm contract:persistence-l1 && pnpm contract:pool
pnpm contract:identity-quota && pnpm contract:registry
pnpm contract:session-ops && pnpm contract:lifecycle

# Validação de specs e documentação
node tools/lint-specs.mjs && node tools/check-gates.mjs
node tools/validate-contracts.mjs && node tools/lint-docs.mjs
```

## Princípios de design

1. **O enforcement vem apenas de fora do domínio** — a legalidade de camada é julgada na geração do Profile; dentro do domínio não há autoprovação (autoatestado de compliance dentro do domínio reprova).
2. **Os gates só aceitam fatos de fora do domínio** — o que é reportado de dentro serve só como verificação cruzada; divergiu, o domínio é destacado.
3. **Dependência soft nunca bloqueia a execução** — billing/auditoria geral caíram, a execução continua; descarte limitado + tombstone + reenvio.
4. **Se não dá para fazer, diz que não dá** — cada item não concluído é registrado honestamente, sem inventar números.

## Estado atual e fronteiras (a versão honesta)

- ✅ Os seis gates de fase (GATE-001…006) são todos alcançáveis, cada um com artefatos de evidência; as 11 suítes de contrato estão todas verdes.
- ❌ **Windows fica excluído do isolamento multilocatário**: o teste real de ACL dentro de container não passou (GATE-002 condição 9, fail registrado honestamente).
- 🔶 **Drills 3/6**: DRL-03/04/06 exigem componentes do núcleo e topologia de múltiplos nós, honestamente blocked.
- 🔶 **Parâmetros de load test não preenchidos**: `PP-01…PP-35` são todos "valores derivados de exemplo + pendentes de preenchimento por load test" — sem inventar números.
- 🚫 **Sem UI**: este repositório entrega bibliotecas e API HTTP (stub de gateway), não inclui interface de produto.
- 📦 **Deployment de produção exige ambiente de execução próprio**: o ambiente de execução de container/microVM do domínio de isolamento não é implementado por este repositório — no deployment, quem faz o deploy fornece a infraestrutura (runtime de containers Linux, IdP corporativo, object storage) e faz a fiação; quem constrói o negócio não é afetado.

Para a comparação da consistência, camada a camada, entre a implementação e o planejamento original (seis itens todos consistentes, incluindo o ramo "Windows reprovado" executado honestamente), veja o [Manual de Engenharia](docs/ENGINEERING-HANDBOOK.md#9-实现与规划的一致性对照).

## Documentação

- [Manual de Engenharia](docs/ENGINEERING-HANDBOOK.md) — ordem de autoridade, consulta rápida de gates, registro de lacunas, changelog (leitura obrigatória para quem contribui)
- [Especificação mestra](spec/00-规格总纲.md) — entrada do conjunto de specs
- [Matriz de domínios de falha](docs/reliability/failure-domain-matrix.md) / [Escada de degradação](docs/reliability/degradation-ladder.md) / [Inventário DSR](docs/security/dsr-inventory-and-proof.md)

## Licença

[MIT](LICENSE)
