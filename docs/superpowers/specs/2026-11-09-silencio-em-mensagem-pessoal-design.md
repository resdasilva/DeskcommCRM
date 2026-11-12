# Silêncio do turno quando a mensagem é pessoal

> Spec de design. Medido em `origin/issue-10-transferencia-silenciosa-pessoal` = `a5bf2dd0a` (09/11/2026).
> Substitui o PR 11 do fork (`resdasilva/DeskcommCRM`), que é fechado sem mesclar.
> Base de execução: a `main` do fork atualizada com o original. Em 09/11/2026 o fork estava 2.762
> commits atrás (v1.88 contra v1.104). A entrega nasce numa branch nova a partir da `main` atualizada.
> As âncoras de código foram conferidas também em `upstream/main` = `95f3103d1`, que não tem nada
> para mensagem pessoal.
> Destino (DoD 18): **núcleo**. É um modo do turno do agente, que é núcleo; com a chave desligada nada muda.
> Onde sobe: só no fork. Push e PR em `origin`; nada vai para o `upstream`.

> Decisões do dono, em 09/11/2026. Não se reabre sem ele.
>
> 1. Depois de calar numa mensagem pessoal, a IA volta sozinha quando o assunto for trabalho.
> 2. O contato nunca ouve que foi transferido.
> 3. O Jev não decide nesta entrega (ver §8).

## 1. O problema

Quem usa este CRM é, na maioria, autônomo: um número só para a vida e para o trabalho. A mãe, o
amigo e o fornecedor escrevem para o mesmo WhatsApp em que o cliente pede orçamento.

O PR 11 resolveu a primeira metade: com `handoff_silencioso_pessoal` ligado, o modelo chama
`request_human_handoff` com `motivo_codigo: "mensagem_pessoal"` e o contato não recebe nada. A prova
no turno real deu 20 de 20 e 10 de 10 (`evidence/issue-10-qa-v3/placar.txt`).

A segunda metade ficou errada para o autônomo. A passagem grava `contacts.force_human = true` e
`conversations.bot_silenced_until` (`performHumanHandoff`, `lib/agent-engine/agent/human-handoff.ts`).
Duas consequências:

- Não há equipe para receber a passagem. O "atendente" é o próprio dono, que já viu a mensagem no celular.
- O amigo que mandou "viu o jogo?" hoje fica sem IA amanhã, quando perguntar o preço do corte. A
  conversa só volta para a IA se alguém clicar em devolver o atendimento.

O que o dono descreveu é outra coisa: a IA não responde aquela mensagem, e continua atendendo.

## 2. O que muda em relação ao PR 11

| | PR 11 (hoje na branch) | esta spec |
|---|---|---|
| ação do modelo | `request_human_handoff` com `mensagem_pessoal` | ferramenta própria, `stay_silent` |
| `force_human`, `bot_silenced_until` | gravados | não tocados |
| follow-ups pendentes | cancelados | não tocados |
| linha em `passagens_de_atendimento` | sim, `mensagem_pessoal` + `silencio_intencional` | não: não houve passagem |
| aviso da equipe no WhatsApp | sim (item `handoff` na Central) | não |
| Central | item `handoff` | item novo, `silencio_mensagem_pessoal`, com dois botões |
| próxima mensagem do contato | ninguém responde até devolverem o atendimento | turno normal |
| coluna da chave | `handoff_silencioso_pessoal` | `silencio_em_mensagem_pessoal` |
| como ligar | só por SQL | chave na tela do agente |

`request_human_handoff`, `lib/escalacao/passagem.ts`, `lib/escalacao/cartao-da-passagem.ts` e
`lib/mcp/tools/handoff.ts` voltam a ser, byte a byte, o que são em `origin/main`. Os vocabulários
`mensagem_pessoal` e `silencio_intencional` saem dos CHECKs de `passagens_de_atendimento`.

## 3. O contrato

### 3.1 A chave

- `ai_agent_versions.silencio_em_mensagem_pessoal boolean not null default false`. Desligada por
  padrão: quem não mexer fica como hoje.
- Mora na versão, pelo mesmo motivo de `handoff_legal_enabled`: a versão publicada é quem atende e é
  imutável. A coluna entra na trava `fn_ai_agent_version_content_immutable`.
- Aparece na tela do agente pelos mesmos sete arquivos de `handoff_legal_enabled`:
  `app/api/v1/ai/agents/route.ts`, `app/api/v1/ai/agents/[id]/versions/route.ts`,
  `app/api/v1/ai/agents/[id]/versions/[vid]/route.ts`, `app/app/ai/agents/[id]/page.tsx`,
  `_actions.ts`, `_components/AgentForm.tsx` e `_components/VersionDiff.tsx`.
- Rótulo: "Não responder mensagem pessoal". Ajuda: "Quando família, amigo ou fornecedor escreve para
  este número, o assistente não responde e deixa um aviso na Central. Ele volta a atender quando o
  assunto for trabalho."
- Não depende de `handoff_tool_enabled`. No PR 11 dependia, porque o silêncio ia de carona na
  passagem.

### 3.2 A ferramenta `stay_silent`

Entra no turno só com a chave ligada **e** o contato sem a marca de cliente confirmado (§3.6).
Fora disso ela não existe para o modelo, e o prompt não a nomeia.

Entrada, schema estrito: `{ por_que: string }`, de 1 a 300 caracteres. Quem parece ser e o que quer.
Campo extra ou forjado vira erro de ensino, como nas outras ferramentas do turno.

O que ela faz, nesta ordem:

1. **Pedido de parar vence.** Se as mensagens pendentes do contato casam com a detecção de opt-out
   (a mesma cerca de `applyRequestHumanHandoff`), recusa com ensino: não é assunto pessoal, trate o
   pedido. Nada é gravado.
2. **Já falou.** Com `seq > 0`, ou com envio em voo no mesmo passo, recusa com ensino: a mensagem já
   saiu, encerre o turno. Não há silêncio a registrar e nenhum aviso nasce. A decisão continua na
   função pura que o PR 11 criou, renomeada `decidirSilencioDoTurno`, com três desfechos (`silencio`,
   `ja_falou`, `em_voo`). O `normal` some: a ferramenta só existe com a chave ligada.
3. **Cala.** Reserva o silêncio na trava que o PR 11 criou (`criarTravaDoSilencio`,
   `cercarEnviosPelaTravaDoSilencio`): `send_message` e `send_template` do mesmo passo são recusados.
   Para o "digitando…". Marca `calouPorMensagemPessoal = true` no turno. Abre o aviso da Central (§3.5).
4. Devolve `{ ok: true, status: "silencio_registrado" }` com a frase: "Nada foi enviado ao contato.
   Encerre o turno agora, sem chamar send_message."

O que ela nunca faz: gravar `force_human`, `bot_silenced_until` ou `is_blocked`; cancelar cron;
inserir em `passagens_de_atendimento`; mandar aviso no WhatsApp de ninguém.

`por_que` não é gravado nesta entrega. O traço do turno guarda o nome e o desfecho de cada
ferramenta, não os argumentos (`traco-do-turno.ts`), e log não é lugar de conteúdo de conversa. O
campo obriga o modelo a declarar um motivo antes de calar, e o traço mostra que `stay_silent` foi
chamada. O registro durável do motivo fica para a entrega 2, em `jev_observacoes`.

### 3.3 O bloco no prompt

`PASSAGEM_SILENCIOSA_SYSTEM_BLOCK` vira `SILENCIO_PESSOAL_SYSTEM_BLOCK`, com o mesmo lugar entre os
blocos residentes e a mesma régua (só entra com a ferramenta presente). O texto do PR 11 fica, com
três trocas:

- A única ação do turno passa a ser `stay_silent`, com `por_que`.
- "a equipe é avisada" vira "o dono vê um aviso".
- Entra a regra da mensagem misturada: "Se a mensagem traz assunto de trabalho (produto, preço,
  horário, agendamento, serviço), mesmo junto de conversa pessoal, é atendimento: responda só a parte
  do trabalho."

Ficam como estão: a lista de quem é pessoal (família, amigos, fornecedores), a proibição de falar
pelo dono, a frase que desautoriza respostas antigas do histórico, e "pedido para parar de receber
mensagens nunca é mensagem pessoal".

A descrição de `request_human_handoff` deixa de receber o ensino extra
(`ENSINO_DA_PASSAGEM_SILENCIOSA` e `aplicaAChaveDaPassagemSilenciosa` saem).

### 3.4 Turno calado não é turno mudo

Hoje um turno de resposta que termina sem mensagem recebe uma correção pedindo ao modelo que fale
(`lib/agent-engine/agent/turno-mudo.ts`). O silêncio desta spec é decisão, e entra na lista de razões
legítimas ao lado de `passouParaAEquipe`:

- `turnoMudoPedeCorrecao` ganha `calouPorMensagemPessoal: boolean` e devolve `false` com ele ligado.
- `silencioSemRazaoLegitima`, em `inbound-turn.ts`, ganha `!calouPorMensagemPessoal`: turno calado de
  propósito nunca abre caso de "resposta truncada".

Depois do turno calado nenhuma mensagem automática sai para o contato por causa dele: nem correção,
nem aviso de escalação, nem follow-up agendado pelo turno. É critério de aceite (§6).

### 3.5 O aviso na Central

- `agent_inbox_items.kind = 'silencio_mensagem_pessoal'`, severidade informativa, com referência à
  conversa. O nome entra no CHECK do banco e em `InboxKind` (`lib/agent-engine/db/repository.ts`); o
  teste `vocabulario-banco-x-typescript` exige os dois.
- Título: "O assistente não respondeu: a mensagem parece pessoal". Sem corpo. A instrução vem como
  orientação do tipo (`POLITICAS_DE_AVISO`, `lib/ai/inbox-destino.ts`), traduzida na tela: "Se for
  cliente, peça a resposta. Se for pessoal, marque o contato e o assistente não entra mais nessa
  conversa."
- O aviso não repete o que o contato escreveu nem o `por_que` do modelo. A Central é lida pela
  organização inteira e a conversa só por quem a enxerga, a mesma regra de `avisarAEquipe`
  (`lib/ai/decisao/pedidos.ts`).
- **Um aberto por conversa.** Com um aviso aberto, um novo silêncio na mesma conversa não cria outro.
- Três ações: "Abrir a conversa", "É cliente, responder" (§3.6) e "Marcar como contato pessoal" (§3.7).
- Fecha sozinho quando: sai qualquer mensagem na conversa depois dele (do dono pelo celular, de um
  atendente ou da IA num turno seguinte); o contato é marcado como pessoal; alguém clica "É cliente,
  responder"; a conversa é encerrada; alguém clica "Marcar resolvido". O laço segue o desenho dos
  gatilhos da migration 0500.

Não há aviso no WhatsApp do dono. A mensagem pessoal já está no celular dele, é o mesmo número. A
Central existe aqui para o erro: cliente de verdade que a IA calou.

### 3.6 "É cliente, responder"

`POST /api/v1/conversations/[id]/client-confirmed`, sem corpo. O aviso da Central aponta para a
conversa, então a rota parte dela e acha o contato no servidor. Papel mínimo: atendente
(`requireRole("agent")`), a mesma régua de devolver o atendimento à IA. A rota declara
`requireSupportWrite(` antes do efeito e resolve a organização da sessão; a conversa é conferida
contra ela.

1. Grava `contacts.cliente_confirmado_em = now()`. Quem confirmou fica na auditoria, sem coluna
   própria, como a spec 21 fez com a marca de pessoal. Contato já marcado como pessoal recusa com 409.
2. Fecha o aviso aberto da conversa.
3. Se a última mensagem da conversa é do contato, pede o turno de novo pelo emissor de
   `ai_agent.dispatch_requested` que `lib/channels/pos-entrada.ts` usa. Os gates de elegibilidade
   decidem como sempre. Se alguém já respondeu depois, não pede nada e a resposta da rota diz isso:
   "Marcado como cliente. A conversa já teve resposta, então nada foi reenviado."
4. Audita `contact.client_confirmed`.

A marca é o que faz o botão valer: `get-lead-context.ts` lê `cliente_confirmado_em` ao lado de
`is_personal`, e com ela preenchida o turno não monta `stay_silent` nem o bloco do §3.3. O turno
repedido já roda sem a opção de calar, e os seguintes também. Não existe sinal de "não cale" viajando
no evento.

Não há botão de desfazer. Quem confirmou por engano marca o contato como pessoal (§3.7), e isso
limpa a marca.

### 3.7 "Marcar como contato pessoal"

Usa `app/api/v1/contacts/[id]/personal/route.ts`, que já existe (spec 21), com as regras dela:
só gerente e dono marcam; marcar tira o contato da operação inteira. Duas adições:

- Marcar como pessoal zera `cliente_confirmado_em`, por gatilho no banco, para valer em todo caminho
  que marca (rota, lote, MCP).
- O aviso aberto fecha sem código novo: a rota já encerra as conversas do contato, e conversa
  encerrada fecha o aviso (§3.5).

Atendente sem papel de gerente vê o botão desabilitado com o motivo, como nas outras ações de
gerente.

### 3.8 Prévia ("Testar agente" e rascunho assistido)

A ferramenta existe na prévia com a chave ligada. Ela não grava nada: nem aviso, nem traço durável.
O desfecho da prévia diz "O assistente ficaria em silêncio: a mensagem parece pessoal." A prévia de
teste não pede a correção do turno mudo nesse caso.

## 4. Banco

A migration do PR 11 (`..._0769_passagem_silenciosa_por_mensagem_pessoal.sql`) nunca saiu da branch
dele e não é levada adiante. A entrega cria uma migration nova,
`..._silencio_em_mensagem_pessoal.sql`, com o próximo número livre depois de atualizar o fork (o
original já estava em 0809 em 09/11/2026):

1. `ai_agent_versions.silencio_em_mensagem_pessoal boolean not null default false`, com comentário.
2. `fn_ai_agent_version_content_immutable` com a coluna nova no lugar de `handoff_silencioso_pessoal`.
3. `contacts.cliente_confirmado_em timestamptz null`, e o gatilho que a zera quando o contato vira
   pessoal.
4. `'silencio_mensagem_pessoal'` no CHECK de `agent_inbox_items.kind`.
5. O laço que fecha o aviso (§3.5).
6. Os CHECKs de `passagens_de_atendimento` deixam de ser tocados: ficam como em `origin/main`.

Tripla da casa: migration com linha `-- manifest:`, apêndice idempotente em `supabase/baseline.sql`,
tipos em `lib/database.types.ts`. Se o laço do item 5 for função em `public`, ela termina com
`revoke execute ... from public, anon`. O número é conferido com
`pnpm checar:colisao-de-migration` antes do PR.

O fork numera na mesma sequência do original, então o número escolhido pode ser tomado lá a qualquer
momento. A cada atualização do fork ele é conferido de novo, e renumerado se colidir.

### Banco de teste local

O `DeskcommCRM-teste` já rodou a 0769 antiga e tem linhas das 40 tentativas da prova. Antes de
aplicar a nova, uma vez, à mão:

```sql
alter table public.ai_agent_versions
  rename column handoff_silencioso_pessoal to silencio_em_mensagem_pessoal;
delete from public.passagens_de_atendimento
  where motivo_codigo = 'mensagem_pessoal' or aviso_motivo_codigo = 'silencio_intencional';
```

Depois os dois CHECKs de `passagens_de_atendimento` são recriados com as listas de `origin/main`. O
valor da chave nas versões de teste (Barbearia v4, demo v4) segue junto com o rename.

## 5. Fora desta entrega

- **Jev.** Não classifica, não é perguntado. Ver §8.
- **Negócio no funil.** A mensagem pessoal ainda pode ter criado um card antes do turno
  (`lib/channels/pos-entrada.ts`). Quem resolve isso é a marca de contato pessoal, que esconde o card.
- **Follow-ups que já existiam.** O silêncio não cancela fluxo em que o contato já estava inscrito.
  Quem é pessoal de verdade sai deles ao ser marcado (spec 21).
- **Marca automática de contato pessoal.** Só gente marca.
- **Selo de "cliente confirmado" na lista de contatos.**

## 6. Prova e régua de aceite

`scripts/prova-passagem-silenciosa-turno-real.ts` e `evidence/issue-10-qa-v3/rodar.sh` são adaptados
e renomeados (`prova-silencio-pessoal-turno-real.ts`, `evidence/issue-10-qa-v4/`). Mesmo banco local,
mesmo modelo (`google/crm-padrao` pelo OmniRoute), turno real com histórico.

| cenário | tentativas | passa com |
|---|---|---|
| mãe, texto curto, chave ligada | 20 | 20 silêncios; 0 mensagens ao contato; `force_human` falso e `bot_silenced_until` nulo em todas |
| mãe, texto longo do dono | 10 | 10 silêncios, mesmas condições |
| **volta sozinha:** a mesma conversa da mãe, depois "quanto custa o corte?" | 10 | 10 respostas ao contato, 0 silêncios |
| **misturada:** "e aí, beleza? quanto tá o corte?" | 10 | 10 respostas que falam só do corte |
| comercial, chave ligada | 5 | 5 respostas, 0 silêncios |
| comercial, chave desligada (controle) | 5 | 5 respostas; a ferramenta não aparece nas chamadas |
| cliente confirmado manda texto de mãe | 5 | 5 turnos sem `stay_silent` disponível |
| pedido de parar com cara de pessoal ("mãe aqui, para de mandar mensagem") | 5 | 0 silêncios |

Em toda linha: nenhuma mensagem automática sai para o contato nos 10 minutos seguintes ao turno
calado, e há no máximo um aviso aberto por conversa.

Limite conhecido, medido no PR 11: com `gpt-5.4-mini` o texto longo da mãe deu 4 de 10. O resultado
depende do modelo do agente. A régua acima vale para o modelo da prova; a tela da chave não promete
mais do que isso.

### Resultado (12/11/2026)

A régua acima passou no turno real, com `google/crm-padrao`; o placar por cenário, com o controle
da chave desligada, está em `evidence/issue-10-qa-v4/placar.txt`. A prova pela tela foi feita no
build de produção, contra o banco de teste local:

![A chave na tela do agente](evidence/issue-10-qa-v4/tela-1-chave-no-agente.jpg)
![Rascunho salvo com a chave ligada](evidence/issue-10-qa-v4/tela-2-rascunho-salvo.jpg)
![O aviso na Central, com os dois botões](evidence/issue-10-qa-v4/tela-3-aviso-na-central.jpg)
![Contato marcado como pessoal pelo aviso](evidence/issue-10-qa-v4/tela-4-marcado-como-pessoal.jpg)
![Para o atendente, o botão de pessoal fica desabilitado com o motivo](evidence/issue-10-qa-v4/tela-5-atendente-sem-permissao.jpg)
![O aviso com a frase de orientação acima dos botões](evidence/issue-10-qa-v4/tela-6-aviso-com-orientacao.jpg)

## 7. Testes

- `tests/unit/passagem-silenciosa-mensagem-pessoal.test.ts` vira
  `tests/unit/silencio-em-mensagem-pessoal.test.ts`. Ficam os casos da decisão pura, da trava e da
  corrida no mesmo passo. Saem os da passagem. Entram: a ferramenta não toca `force_human`,
  `bot_silenced_until` nem `passagens_de_atendimento`; opt-out recusa; um aviso por conversa; a
  ferramenta e o bloco somem com a chave desligada e com cliente confirmado; fiação no turno lida na
  fonte, no padrão que o arquivo já usa.
- `tests/unit/turno-mudo-pede-correcao.test.ts`: caso novo, calado de propósito não pede correção.
- `tests/unit/correcao-do-turno-mudo-so-escala-com-falha.test.ts`: calado de propósito não abre caso.
- Rota `client-confirmed`: papel, marca, fechamento do aviso, repedido só quando a última mensagem é
  do contato, auditoria.
- Invariante de banco (`tests/invariants/`): um aviso aberto por conversa; conversa encerrada e
  mensagem de saída fecham o aviso; marcar como pessoal zera a marca de cliente confirmado.
- Invariantes que a mudança toca e precisam continuar verdes:
  `trigger-imutavel-cobre-todas-as-colunas-de-conteudo`, `vocabulario-banco-x-typescript`,
  `i18n-espanhol-cobre-a-tela` (textos novos em `en.json` e no espanhol),
  `jev-nunca-cala-bloqueia-nem-responde` (nada desta entrega mora em `lib/ai/decisao`).
- `pnpm test:db`, porque a migration e o baseline mudam.

Além dos testes, o que o Definition of Done do repositório cobra desta entrega:

- **Prova pela tela (DoD 12).** Ligar a chave na tela do agente e publicar a versão; ver o aviso na
  Central; clicar "É cliente, responder" e "Marcar como contato pessoal". Playwright em ambiente
  fresco, evidência em `evidence/issue-10-qa-v4/`.
- **Sistema vivo (DoD 13).** Entrada: a ferramenta no turno. Saída: o aviso na Central e o traço do
  turno. Laço de retorno: os dois botões, que mudam o que o próximo turno daquele contato pode fazer.
  O mapa em `docs/architecture/` ganha a peça.
- **Fragmento em `.changes/` (DoD 17)**, efeito `capacidade_nova`.

## 8. Próximas entregas

Cada uma com spec própria. Ficam registradas aqui para o desenho desta não fechar a porta.

**Entrega 2: o Jev observa.** Tarefa nova no molde de `lib/ai/decisao/urgencia.ts`, em `observando`:
a cada mensagem em conversa com a chave ligada, o Jev responde "é pessoal?" e a resposta vai para
`jev_observacoes` ao lado do que o modelo principal fez (calou ou respondeu). Nada muda para o
contato. O que ela entrega é a taxa de erro do Jev nessa pergunta, que hoje ninguém mediu.

**Entrega 3: o Jev como atalho.** Só com a entrega 2 medida. Com confiança alta de "pessoal", o turno
nem chama o modelo principal e registra o mesmo silêncio do §3.2. Na dúvida, o modelo principal
decide com o histórico. Com o Jev fora do ar, vale o caminho desta spec. Quem cala continua sendo o
turno, lendo o sinal: a regra de `jev-nunca-cala-bloqueia-nem-responde` não muda. É a entrega que
corta o custo (hoje cada mensagem pessoal paga um turno do modelo principal) e a dependência do
modelo do agente medida no §6.

## 9. Suposições

- A 0769 antiga só rodou no banco de teste local. Se rodou em outro banco, a reescrita do §4 não
  serve para ele e a troca precisa de migration nova.
- O PR 11 não foi mesclado em `origin/main`, e é fechado sem mesclar quando esta entrega abrir o PR dela.
- A `main` do fork não tem commits próprios (medido em 09/11/2026: zero), então atualizar o fork é
  avanço direto, sem merge.
