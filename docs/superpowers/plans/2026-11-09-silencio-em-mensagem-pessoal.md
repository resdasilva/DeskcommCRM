# Silêncio do turno em mensagem pessoal — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Com a chave ligada na versão do agente, mensagem pessoal faz a IA calar só aquele turno, sem passar a conversa, e deixa na Central um aviso com dois botões que corrigem o erro.

**Architecture:** O fork é atualizado com o original e a entrega nasce numa branch nova a partir da `main` atualizada; o PR 11 é fechado sem mesclar. A regra mora num módulo próprio, `lib/agent-engine/agent/silencio-pessoal.ts`, que o turno só liga. A ferramenta `stay_silent` registra o silêncio e abre o aviso; não toca `force_human`, `bot_silenced_until` nem `passagens_de_atendimento`. O banco guarda a chave por versão, a marca de cliente confirmado no contato e o laço que fecha o aviso sozinho.

**Tech Stack:** Next.js 16 (Route Handlers), TypeScript estrito, Zod, Vercel AI SDK (`tool`), Postgres/Supabase (`pg` no motor, `supabase-js` nas rotas), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md`

## Global Constraints

- **Só o fork.** `git push origin <branch>`; PR com `gh pr create --repo resdasilva/DeskcommCRM`. Nada vai para `upstream` (`melgarafael/DeskcommCRM`).
- **Base:** a `main` do fork, atualizada com o original na Tarefa 0. Medido em 09/11/2026: o fork estava 2.762 commits atrás (v1.88 contra v1.104), sem commit próprio na `main`.
- **Branch:** `silencio-em-mensagem-pessoal`, criada da `main` atualizada. O PR final mira a `main` do fork. A branch antiga `issue-10-silencio-do-turno` só guarda a spec e este plano.
- **As âncoras deste plano são TEXTO, não número de linha.** Elas foram conferidas em `upstream/main` = `95f3103d1`. Se uma âncora não for achada depois da atualização, pare e localize com `grep`; não adivinhe.
- **Commits** no estilo do fork: `✨ [feat] agente: …`, `🧪 [test] agente: …`, `🔧 [chore] …`, `📝 [docs] …`. Um por tarefa.
- **Nomes exatos:** coluna `ai_agent_versions.silencio_em_mensagem_pessoal`; coluna `contacts.cliente_confirmado_em`; tipo de aviso `silencio_mensagem_pessoal`; ferramenta `stay_silent`; rota `POST /api/v1/conversations/[id]/client-confirmed`; auditoria `contact.client_confirmed`.
- **Número da migration:** `NNNN` é o próximo livre, escolhido na Tarefa 0 (o original estava em 0809). Onde este plano escreve `NNNN`, use o número escolhido.
- **Textos exatos:** rótulo da chave "Não responder mensagem pessoal"; título do aviso "O assistente não respondeu: a mensagem parece pessoal"; botões "É cliente, responder" e "Marcar como contato pessoal".
- **Chave desligada = byte a byte o comportamento de `origin/main`.** A ferramenta e o bloco do prompt não existem para o modelo.
- **A ferramenta nunca grava** `force_human`, `bot_silenced_until`, `is_blocked`, nem insere em `passagens_de_atendimento`, nem cancela cron.
- **Nada desta entrega mora em `lib/ai/decisao/`** (cerca `tests/unit/jev-nunca-cala-bloqueia-nem-responde.test.ts`).
- Rota mutante: `requireSupportWrite(` antes do efeito, organização da sessão, `ok()`/`fail()` de `lib/api/wrappers.ts`, auditoria na mutação. Sem `console.log`.
- **Windows:** `pnpm test:db` roda pelo Git Bash com `PATH=node_modules/.bin:$PATH` e `CONFERENCIA_KIT_RELEASE=<tag do upstream>`; reserve 1 h.
- O worktree precisa de `node_modules` real: `pnpm install` na Tarefa 0.

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `lib/agent-engine/agent/silencio-pessoal.ts` (novo) | Bloco do prompt, disponibilidade, decisão, trava de envios, schema e handler de `stay_silent` |
| `lib/agent-engine/agent/inbound-turn.ts` | Só liga: ferramenta, bloco, bandeira do turno calado |
| `lib/agent-engine/agent/turno-mudo.ts` | Silêncio de propósito não pede correção |
| `lib/agent-engine/agent/preview.ts` | Na prévia, `stay_silent` vira um impedimento legível |
| `lib/agent-engine/agent/agent-config.ts`, `lib/agent-engine/edge/crm/get-lead-context.ts` | Leem a chave e a marca de cliente confirmado |
| `lib/agent-engine/db/repository.ts`, `lib/ai/inbox-destino.ts`, `lib/ai/agent-inbox-copy.ts` | Vocabulário, política e rótulo do aviso |
| `lib/ai/silencio-na-central.ts` (novo) | Anexa ao aviso o contato e se o papel pode marcar como pessoal |
| `app/api/v1/conversations/[id]/client-confirmed/route.ts` (novo) | "É cliente, responder" |
| `app/app/ai/inbox/_components/AcoesDoSilencio.tsx` (novo), `AgentInboxList.tsx`, `hooks/ai/useAgentInbox.ts`, `hooks/ai/useConfirmClient.ts` (novo) | Os dois botões na Central |
| 12 arquivos do editor de agente (Tarefa 10) | A chave viaja pela tela |
| `supabase/migrations/<carimbo>_NNNN_silencio_em_mensagem_pessoal.sql` (novo), `supabase/baseline.sql`, `lib/database.types.ts` | Banco |
| `scripts/prova-silencio-pessoal-turno-real.ts`, `evidence/issue-10-qa-v4/` | Prova com o modelo real |

---

### Task 0: Atualizar o fork e abrir a branch

A `main` do fork não tem commit próprio, então atualizar é avanço direto. Nada aqui mexe na pasta `F:\Projetos Ativos\DeskcommCRM\DeskcommCRM`, que está noutra branch com arquivos soltos: os comandos atualizam referências e empurram, sem trocar o que está em disco lá.

**Files:** nenhum arquivo do produto. Só referências do git.

- [ ] **Step 1: Medir antes de mexer**

```bash
git fetch upstream --tags
git fetch origin
echo "atrás do original: $(git rev-list --count origin/main..upstream/main)"
echo "commits próprios na main do fork: $(git rev-list --count upstream/main..origin/main)"
```

Esperado: o primeiro número é maior que zero e o segundo é **0**. Se o segundo não for zero, pare: a `main` do fork divergiu e atualizar passa a ser um merge, que é decisão de quem pediu a entrega.

- [ ] **Step 2: Atualizar a `main` do fork**

```bash
git push origin upstream/main:refs/heads/main
git fetch origin
git rev-parse origin/main upstream/main
```

Esperado: o push é aceito como avanço direto (sem `--force`), e os dois hashes saem iguais. As tags do original não são empurradas aqui; se o fork as usa, `git push origin --tags` é ato separado.

- [ ] **Step 3: Abrir a branch nova neste worktree e trazer a spec e o plano**

```bash
git switch -c silencio-em-mensagem-pessoal origin/main
git checkout issue-10-silencio-do-turno -- docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md docs/superpowers/plans/2026-11-09-silencio-em-mensagem-pessoal.md
git commit -m "📝 [docs] agente: spec e plano do silêncio do turno em mensagem pessoal"
pnpm install
```

Esperado: branch criada da `main` atualizada, um commit com os dois documentos, `node_modules/` real.

- [ ] **Step 4: Escolher o número e o carimbo da migration**

```bash
git ls-tree -r --name-only origin/main supabase/migrations | sed 's#.*/##' | sed -nE 's#^([0-9]{14})_([0-9]{4})_.*#\2 \1#p' | awk '$1<9000' | sort -n | tail -1
```

Esperado: uma linha `NNNN-anterior carimbo-anterior` (em 09/11/2026, `0809 …`). O número desta entrega é o anterior mais um; o carimbo é a data e hora de agora (`date -u +%Y%m%d%H%M%S`), que tem de ser maior que o carimbo anterior. Crie o arquivo vazio e confira:

```bash
touch "supabase/migrations/$(date -u +%Y%m%d%H%M%S)_NNNN_silencio_em_mensagem_pessoal.sql"   # troque NNNN
pnpm checar:colisao-de-migration
```

Esperado: `OK`. O `checar` mede contra o repositório original e os PRs abertos lá; se acusar colisão, use o próximo número.

- [ ] **Step 5: Conferir que a suíte de partida roda**

```bash
pnpm vitest run tests/unit/turno-mudo-pede-correcao.test.ts tests/unit/chave-juridico-so-troca-a-descricao.test.ts
```

Esperado: os dois arquivos passam. Se falharem aqui, pare: o problema é do ambiente, não deste plano.

---

### Task 1: Trazer do PR 11 só o que se reaproveita

O código do PR 11 não vem: a `main` atualizada nunca o teve, e é dela que a entrega parte. Vem o roteiro da prova, que a Tarefa 11 adapta, e a evidência antiga, que é o registro do que foi medido.

**Files:**
- Create (trazido do PR 11): `scripts/prova-silencio-pessoal-turno-real.ts`, `evidence/issue-10-qa-v3/`

**Interfaces:**
- Produces: `scripts/prova-silencio-pessoal-turno-real.ts`, ainda com o conteúdo do PR 11, que a Tarefa 11 reescreve.

- [ ] **Step 1: Trazer e renomear**

```bash
git checkout origin/issue-10-transferencia-silenciosa-pessoal -- scripts/prova-passagem-silenciosa-turno-real.ts evidence/issue-10-qa-v3
git mv scripts/prova-passagem-silenciosa-turno-real.ts scripts/prova-silencio-pessoal-turno-real.ts
```

- [ ] **Step 2: Conferir que o código do PR 11 não veio junto**

```bash
git grep -n "handoff_silencioso_pessoal\|handoffSilenciosoPessoal\|silencio_intencional\|PASSAGEM_SILENCIOSA" -- lib app components hooks workers supabase
```

Esperado: nenhuma linha.

- [ ] **Step 3: Commit**

```bash
git add scripts evidence
git commit -m "🧪 [test] agente: roteiro e evidência da prova no turno real, trazidos do PR 11"
```

---

### Task 2: Banco

**Files:**
- Write: `supabase/migrations/<carimbo>_NNNN_silencio_em_mensagem_pessoal.sql` (criado vazio na Tarefa 0)
- Modify: `supabase/baseline.sql` (lista única de `agent_inbox_items_kind_check`; apêndice novo)
- Modify: `lib/database.types.ts`
- Test: `tests/invariants/silencio-pessoal-no-banco.test.ts` (novo)

**Interfaces:**
- Produces: colunas `ai_agent_versions.silencio_em_mensagem_pessoal boolean not null default false` e `contacts.cliente_confirmado_em timestamptz`; valor `'silencio_mensagem_pessoal'` em `agent_inbox_items.kind`; índice `agent_inbox_silencio_pessoal_aberto_unico`; gatilhos `trg_fechar_aviso_do_silencio_pessoal_da_conversa`, `trg_fechar_aviso_do_silencio_pessoal_ao_responder`, `trg_contato_pessoal_perde_cliente_confirmado`.

- [ ] **Step 1: Escrever o invariante que falha**

Crie `tests/invariants/silencio-pessoal-no-banco.test.ts`:

```ts
/**
 * O BANCO DO SILÊNCIO EM MENSAGEM PESSOAL (migration NNNN).
 *
 * Um aviso aberto por conversa; ele fecha sozinho quando a conversa é
 * encerrada ou quando sai qualquer mensagem nela; e marcar o contato como
 * pessoal zera a marca de cliente confirmado.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";

const KIND = "silencio_mensagem_pessoal";
const CONTATO = "cccccccc-0769-4000-8000-000000000001";
const CONVERSA = "cccccccc-0769-4000-8000-000000000011";

function abrir(): void {
  sql(`insert into public.agent_inbox_items (organization_id, kind, severity, title, ref_kind, ref_id)
       values ('${GOV_ORG}', '${KIND}', 'info', 'O assistente não respondeu', 'conversation', '${CONVERSA}')
       on conflict do nothing;`);
}

function avisos(): string[] {
  const saida = sql(`select status || case when resolved_at is not null then '+fim' else '' end
                       from public.agent_inbox_items
                      where organization_id = '${GOV_ORG}' and kind = '${KIND}' and ref_id = '${CONVERSA}'
                      order by created_at;`);
  return saida === "" ? [] : saida.split("\n");
}

beforeAll(() => {
  seedGov();
  sql(`insert into public.contacts (id, organization_id, display_name)
         values ('${CONTATO}', '${GOV_ORG}', 'Mãe do dono');
       insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
         values ('${CONVERSA}', '${GOV_ORG}', '${CONTATO}', '${GOV_SESSION}', 'open');`);
});

beforeEach(() => {
  sql(`delete from public.agent_inbox_items where organization_id = '${GOV_ORG}' and kind = '${KIND}';
       delete from public.messages where conversation_id = '${CONVERSA}';
       update public.conversations set status = 'open' where id = '${CONVERSA}';
       update public.contacts set is_personal = false, cliente_confirmado_em = null where id = '${CONTATO}';`);
});

describe("o aviso do silêncio em mensagem pessoal", () => {
  it("no máximo um aberto por conversa", () => {
    abrir();
    abrir();
    expect(avisos()).toEqual(["open"]);
  });

  it("depois de resolvido, um novo silêncio abre outro", () => {
    abrir();
    sql(`update public.agent_inbox_items set status = 'resolved', resolved_at = now()
          where kind = '${KIND}' and ref_id = '${CONVERSA}';`);
    abrir();
    expect(avisos()).toEqual(["resolved+fim", "open"]);
  });

  it("conversa encerrada fecha o aviso", () => {
    abrir();
    sql(`update public.conversations set status = 'closed' where id = '${CONVERSA}';`);
    expect(avisos()).toEqual(["resolved+fim"]);
  });

  it("mensagem de saída na conversa fecha o aviso", () => {
    abrir();
    sql(`insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via)
         values ('${GOV_ORG}', '${CONVERSA}', '${GOV_SESSION}', '${CONTATO}', 'text', 'outbound', 'sent', 'oi mãe', 'external_device');`);
    expect(avisos()).toEqual(["resolved+fim"]);
  });

  it("mensagem de entrada não fecha o aviso (controle)", () => {
    abrir();
    sql(`insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via)
         values ('${GOV_ORG}', '${CONVERSA}', '${GOV_SESSION}', '${CONTATO}', 'text', 'inbound', 'received', 'filho?', 'crm');`);
    expect(avisos()).toEqual(["open"]);
  });
});

describe("a marca de cliente confirmado", () => {
  it("some quando o contato vira pessoal", () => {
    sql(`update public.contacts set cliente_confirmado_em = now() where id = '${CONTATO}';`);
    expect(sql(`select cliente_confirmado_em is not null from public.contacts where id = '${CONTATO}';`)).toBe("t");
    sql(`update public.contacts set is_personal = true where id = '${CONTATO}';`);
    expect(sql(`select cliente_confirmado_em is null from public.contacts where id = '${CONTATO}';`)).toBe("t");
  });

  it("a chave da versão nasce desligada", () => {
    expect(
      sql(`select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'ai_agent_versions'
              and column_name = 'silencio_em_mensagem_pessoal';`),
    ).toBe("false");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
PATH=node_modules/.bin:$PATH CONFERENCIA_KIT_RELEASE=$(git describe --tags --abbrev=0) pnpm test:db tests/invariants/silencio-pessoal-no-banco.test.ts
```

Esperado: FAIL com `violates check constraint "agent_inbox_items_kind_check"` ou coluna inexistente.

- [ ] **Step 3: Gerar os dois trechos que dependem da base atual**

A trava de imutabilidade e o vocabulário da Central mudam no original com frequência (em 09/11/2026 a trava tinha 37 colunas e o vocabulário 46 valores). Copiar de memória encolhe os dois. Gere a partir do baseline da branch:

```bash
python3 - <<'PY' > /tmp/trava.sql
import re
s = open('supabase/baseline.sql', encoding='utf-8').read()
# rfind: o baseline é dump + apêndice, e quem vale é a ÚLTIMA definição.
i = max(s.rfind('create or replace function fn_ai_agent_version_content_immutable'),
        s.rfind('create or replace function public.fn_ai_agent_version_content_immutable'))
tag = re.search(r'as\s+(\$\w*\$)', s[i:]).group(1)
abre = s.index(tag, i)
fecha = s.index(tag, abre + len(tag)) + len(tag) + 1
corpo = s[i:fecha]
irma = re.search(r'^(\s*)or new\.handoff_legal_enabled\s+is distinct from old\.handoff_legal_enabled\s*$', corpo, re.M)
assert irma, 'linha irmã não achada na trava'
nova = f"{irma.group(1)}or new.silencio_em_mensagem_pessoal is distinct from old.silencio_em_mensagem_pessoal"
print(corpo[:irma.end()] + '\n' + nova + corpo[irma.end():])
PY
python3 - <<'PY' > /tmp/kinds.sql
import re
s = open('supabase/baseline.sql', encoding='utf-8').read()
sql = re.sub(r'--[^\n]*', '', s)
m = re.search(r'add\s+constraint\s+agent_inbox_items_kind_check\s+check\s*\([^)]*?\bin\s*\(', sql, re.I | re.S)
v = re.findall(r"'([^']+)'", sql[m.end():sql.index(')', m.end())])
assert v[-1] == 'other' and 'silencio_mensagem_pessoal' not in v
v.insert(len(v) - 1, 'silencio_mensagem_pessoal')
print("alter table public.agent_inbox_items\n  drop constraint if exists agent_inbox_items_kind_check;")
print("alter table public.agent_inbox_items\n  add constraint agent_inbox_items_kind_check check (kind in (")
print(",\n".join(f"    '{k}'" for k in v))
print("  ));")
PY
grep -c "is distinct from" /tmp/trava.sql; grep -c "^    '" /tmp/kinds.sql
```

Esperado: dois números, o primeiro uma unidade acima do que a trava tinha, o segundo uma unidade acima do vocabulário do baseline.

- [ ] **Step 3b: Escrever a migration**

O conteúdo de `supabase/migrations/<carimbo>_NNNN_silencio_em_mensagem_pessoal.sql` é o SQL abaixo, com `/tmp/trava.sql` colado no lugar da linha `-- [TRAVA]` e `/tmp/kinds.sql` no lugar da linha `-- [VOCABULARIO]`:

```sql
-- manifest: **Silêncio do turno quando a mensagem é pessoal (issue #10).** `ai_agent_versions.silencio_em_mensagem_pessoal boolean not null default false` (desligada por padrão, coberta pela trava de imutabilidade da versão publicada); `contacts.cliente_confirmado_em` (quem alguém confirmou como cliente não é calado de novo, e a marca some quando o contato vira pessoal); `'silencio_mensagem_pessoal'` em `agent_inbox_items_kind_check`, com no máximo um aviso aberto por conversa e dois gatilhos que o fecham sozinho. Par de `lib/agent-engine/agent/silencio-pessoal.ts`.
-- NNNN — O SILÊNCIO DO TURNO QUANDO A MENSAGEM É PESSOAL
--
-- Família, amigo ou fornecedor escreve para o número do negócio. Com a chave
-- ligada na versão, o agente não responde AQUELE turno e continua atendendo:
-- nada de `force_human`, nada de passagem. Quatro peças de banco:
--
--   1. A CHAVE, por versão do agente, desligada por padrão, na trava de
--      imutabilidade (mesmo motivo de `handoff_legal_enabled`, 0616).
--   2. A MARCA `cliente_confirmado_em` no contato: alguém olhou o aviso e disse
--      "é cliente". Com ela o turno não oferece o silêncio para esse contato.
--   3. O AVISO na Central, `silencio_mensagem_pessoal`, um aberto por conversa.
--   4. O LAÇO: o aviso fecha quando a conversa é encerrada ou quando sai
--      qualquer mensagem nela. Sem isso a Central acumularia um aviso por
--      conversa pessoal que o dono já respondeu pelo celular.
--
-- Idempotente. Só acrescenta coluna com default e alarga vocabulário.

alter table public.ai_agent_versions
  add column if not exists silencio_em_mensagem_pessoal boolean not null default false;

comment on column public.ai_agent_versions.silencio_em_mensagem_pessoal is
  'Quando a mensagem é pessoal para o dono ou a equipe (e não um atendimento), o agente fica em silêncio só naquele turno e deixa um aviso na Central? Padrão DESLIGADO; a mudança é publicar uma versão nova. Opt-out continua vencendo.';

-- [TRAVA]

drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();

alter table public.contacts
  add column if not exists cliente_confirmado_em timestamptz;

comment on column public.contacts.cliente_confirmado_em is
  'Quando alguém da equipe confirmou, pelo aviso da Central, que este contato é cliente. Preenchida, o agente não oferece o silêncio por mensagem pessoal a ele. Quem confirmou fica na auditoria (contact.client_confirmed). Zera quando o contato vira pessoal.';

create or replace function public.fn_contato_pessoal_perde_cliente_confirmado()
returns trigger language plpgsql set search_path = '' as $fn$
begin
  new.cliente_confirmado_em := null;
  return new;
end;
$fn$;
revoke execute on function public.fn_contato_pessoal_perde_cliente_confirmado() from public, anon;

drop trigger if exists trg_contato_pessoal_perde_cliente_confirmado on public.contacts;
create trigger trg_contato_pessoal_perde_cliente_confirmado
  before update of is_personal on public.contacts
  for each row when (new.is_personal and old.is_personal is distinct from true)
  execute function public.fn_contato_pessoal_perde_cliente_confirmado();

-- O vocabulário inteiro, igual ao bloco ÚNICO do baseline
-- (tests/unit/kind-check-migration-x-baseline.test.ts compara valor a valor).
-- [VOCABULARIO]

create unique index if not exists agent_inbox_silencio_pessoal_aberto_unico
  on public.agent_inbox_items (organization_id, ref_id)
  where kind = 'silencio_mensagem_pessoal' and status = 'open';

create or replace function public.fn_fechar_aviso_do_silencio_pessoal_da_conversa()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.status not in ('open', 'pending', 'claimed', 'ai_handling') then
    update public.agent_inbox_items
       set status = 'resolved', resolved_at = now()
     where organization_id = new.organization_id and kind = 'silencio_mensagem_pessoal'
       and ref_kind = 'conversation' and ref_id = new.id and status = 'open';
  end if;
  return new;
end;
$fn$;
revoke all on function public.fn_fechar_aviso_do_silencio_pessoal_da_conversa() from public, anon, authenticated;

drop trigger if exists trg_fechar_aviso_do_silencio_pessoal_da_conversa on public.conversations;
create trigger trg_fechar_aviso_do_silencio_pessoal_da_conversa
  after update of status on public.conversations
  for each row execute function public.fn_fechar_aviso_do_silencio_pessoal_da_conversa();

create or replace function public.fn_fechar_aviso_do_silencio_pessoal_ao_responder()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.agent_inbox_items
     set status = 'resolved', resolved_at = now()
   where organization_id = new.organization_id and kind = 'silencio_mensagem_pessoal'
     and ref_kind = 'conversation' and ref_id = new.conversation_id and status = 'open';
  return new;
end;
$fn$;
revoke all on function public.fn_fechar_aviso_do_silencio_pessoal_ao_responder() from public, anon, authenticated;

drop trigger if exists trg_fechar_aviso_do_silencio_pessoal_ao_responder on public.messages;
create trigger trg_fechar_aviso_do_silencio_pessoal_ao_responder
  after insert on public.messages
  for each row when (new.direction = 'outbound')
  execute function public.fn_fechar_aviso_do_silencio_pessoal_ao_responder();

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Espelhar no baseline**

Dois lugares em `supabase/baseline.sql`:

1. No bloco ÚNICO de `agent_inbox_items_kind_check` (ache com `grep -n "add constraint agent_inbox_items_kind_check" supabase/baseline.sql`), acrescente antes de `'other'`:

```sql
    -- (migration NNNN, issue #10) O agente ficou em silêncio de propósito porque
    -- a mensagem parece pessoal. `info`: nada quebrou; o aviso existe para alguém
    -- corrigir quando quem escreveu era cliente.
    'silencio_mensagem_pessoal',
```

2. No fim do arquivo, antes do bloco da VARREDURA anon (ela precisa enxergar as funções novas; ache com `grep -n "VARREDURA" supabase/baseline.sql | tail -3`), cole um bloco com o cabeçalho

```sql
-- ---- silêncio do turno quando a mensagem é pessoal (migration NNNN) ----
```

seguido de TODO o SQL da migration do Step 3b, **menos** o trecho do `-- [VOCABULARIO]` (a lista mora no bloco único; reconstruí-la aqui reprova `tests/unit/baseline-constraint-reconstruida.test.ts`) e menos o `notify pgrst`.

- [ ] **Step 5: Tipos**

Em `lib/database.types.ts`, na tabela `ai_agent_versions`, logo depois de cada uma das três linhas de `handoff_legal_enabled` (Row, Insert, Update), acrescente respectivamente:

```ts
          silencio_em_mensagem_pessoal: boolean
```
```ts
          silencio_em_mensagem_pessoal?: boolean
```
```ts
          silencio_em_mensagem_pessoal?: boolean
```

Na tabela `contacts`, logo depois de cada linha de `is_personal` (Row, Insert, Update):

```ts
          cliente_confirmado_em: string | null
```
```ts
          cliente_confirmado_em?: string | null
```
```ts
          cliente_confirmado_em?: string | null
```

- [ ] **Step 6: Rodar o invariante e as cercas de schema**

```bash
PATH=node_modules/.bin:$PATH CONFERENCIA_KIT_RELEASE=$(git describe --tags --abbrev=0) pnpm test:db tests/invariants/silencio-pessoal-no-banco.test.ts
pnpm vitest run tests/unit/kind-check-migration-x-baseline.test.ts tests/unit/baseline-constraint-reconstruida.test.ts tests/unit/manifest-x-migrations.test.ts tests/unit/trigger-imutavel-cobre-todas-as-colunas-de-conteudo.test.ts
```

Esperado: tudo PASS. Se a inserção em `messages` reprovar por coluna obrigatória que o teste não preenche, acrescente a coluna ao `insert` do teste com o valor que `scripts/prova-silencio-pessoal-turno-real.ts` usa.

- [ ] **Step 7: Commit**

```bash
git add supabase lib/database.types.ts tests/invariants/silencio-pessoal-no-banco.test.ts
git commit -m "✨ [feat] agente: banco do silêncio do turno em mensagem pessoal"
```

---

### Task 3: A chave e a marca chegam ao turno

**Files:**
- Modify: `lib/agent-engine/agent/agent-config.ts`
- Modify: `lib/agent-engine/edge/crm/get-lead-context.ts`
- Test: `tests/unit/silencio-pessoal-chega-ao-turno.test.ts` (novo)

**Interfaces:**
- Produces: `PublishedAgentConfig.silencioEmMensagemPessoal?: boolean`; `LeadContext['contact'].cliente_confirmado?: boolean`.

- [ ] **Step 1: Teste que falha**

Crie `tests/unit/silencio-pessoal-chega-ao-turno.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ler = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");

describe("a chave e a marca são lidas pelo turno", () => {
  it("agent-config lê a coluna da versão e a entrega como silencioEmMensagemPessoal", () => {
    const fonte = ler("lib/agent-engine/agent/agent-config.ts");
    expect(fonte).toContain("v.silencio_em_mensagem_pessoal,");
    expect(fonte).toContain("silencio_em_mensagem_pessoal: boolean;");
    expect(fonte).toContain("silencioEmMensagemPessoal: r.silencio_em_mensagem_pessoal,");
    expect(fonte).toContain("silencioEmMensagemPessoal?: boolean;");
  });

  it("get-lead-context lê a marca do contato no mesmo select do bloqueio", () => {
    const fonte = ler("lib/agent-engine/edge/crm/get-lead-context.ts");
    expect(fonte).toMatch(/is_personal, cliente_confirmado_em, source/);
    expect(fonte).toContain("cliente_confirmado: contact.cliente_confirmado_em !== null,");
    expect(fonte).toContain("cliente_confirmado?: boolean;");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run tests/unit/silencio-pessoal-chega-ao-turno.test.ts
```

Esperado: FAIL nos dois casos.

- [ ] **Step 3: `agent-config.ts`, quatro lugares, sempre logo depois da linha irmã de `handoff_legal_enabled`**

Na interface `PublishedAgentConfig`, depois de `handoffLegalEnabled?: boolean;`:

```ts
  /**
   * Mensagem PESSOAL para o dono ou a equipe cala só o turno (issue #10)?
   * Coluna `ai_agent_versions.silencio_em_mensagem_pessoal`, padrão DESLIGADO.
   * Opcional pelo mesmo motivo de `handoffLegalEnabled`; quem consome lê com
   * `=== true`. Consumidor: `silencio-pessoal.ts`, pelo turno.
   */
  silencioEmMensagemPessoal?: boolean;
```

Na interface `Row`, depois de `handoff_legal_enabled: boolean;`:

```ts
  silencio_em_mensagem_pessoal: boolean;
```

Em `SELECT_AGENT_CONFIG_COLUMNS`, depois de `v.handoff_legal_enabled,`:

```ts
            v.silencio_em_mensagem_pessoal,
```

Em `mapAgentConfigRow`, depois de `handoffLegalEnabled: r.handoff_legal_enabled,`:

```ts
    silencioEmMensagemPessoal: r.silencio_em_mensagem_pessoal,
```

- [ ] **Step 4: `get-lead-context.ts`, quatro lugares**

No tipo de `contact`, depois de `is_personal?: boolean;`:

```ts
    /**
     * `contacts.cliente_confirmado_em` preenchida: alguém confirmou pela Central
     * que este contato é cliente, e o turno não oferece o silêncio a ele.
     * Opcional pelo mesmo motivo de `is_personal`.
     */
    cliente_confirmado?: boolean;
```

Em `ContactRow`, depois de `is_personal: boolean;`:

```ts
  cliente_confirmado_em: string | null;
```

No `select`, troque `is_blocked, is_personal, source` por:

```ts
is_blocked, is_personal, cliente_confirmado_em, source
```

No objeto devolvido, depois de `is_personal: contact.is_personal,`:

```ts
        cliente_confirmado: contact.cliente_confirmado_em !== null,
```

- [ ] **Step 5: Rodar e ver passar**

```bash
pnpm vitest run tests/unit/silencio-pessoal-chega-ao-turno.test.ts lib/agent-engine/edge/crm
pnpm typecheck
```

Esperado: PASS e typecheck zerado. Se um teste de `get-lead-context` monta `ContactRow` à mão e reclama da coluna, acrescente `cliente_confirmado_em: null` à fixture dele.

- [ ] **Step 6: Commit**

```bash
git add lib/agent-engine tests/unit/silencio-pessoal-chega-ao-turno.test.ts
git commit -m "✨ [feat] agente: a chave do silêncio e a marca de cliente confirmado chegam ao turno"
```

---

### Task 4: O módulo `silencio-pessoal.ts`

**Files:**
- Create: `lib/agent-engine/agent/silencio-pessoal.ts`
- Test: `tests/unit/silencio-em-mensagem-pessoal.test.ts` (novo)

**Interfaces:**
- Consumes: `insertInboxItem(db, tenantId, input, dedupe)` de `lib/agent-engine/db/repository.ts`; `guardServiceEffect()` de `@/lib/atendimento/fronteira-server`; `ehOptOutProvavel(texto)` de `@/lib/opt-out/deteccao`.
- Produces:
  - `SILENCIO_PESSOAL_SYSTEM_BLOCK: string`
  - `TITULO_DO_AVISO_DE_SILENCIO: string`
  - `silencioPessoalDisponivel(agentConfig: { silencioEmMensagemPessoal?: boolean } | null, contato: { cliente_confirmado?: boolean } | null | undefined): boolean`
  - `blocoDoSilencioPessoal(disponivel: boolean): string | null`
  - `decidirSilencioDoTurno(e: { seq: number; enviosEmVoo: number }): 'silencio' | 'ja_falou' | 'em_voo'`
  - `criarTravaDoSilencio()`, `type TravaDoSilencio`, `cercarEnviosPelaTravaDoSilencio(rawTools: Record<string, unknown>, disponivel: boolean, trava: TravaDoSilencio): void`
  - `STAY_SILENT_TOOL_DEF: { description: string; inputSchema: z.ZodType }`
  - `applyStaySilent(db, ids: { tenantId: string; conversationId: string }, opts: { pendentesDoCliente: readonly string[]; seq: number; trava: TravaDoSilencio; log: Logger }, rawInput: unknown): Promise<StaySilentResult>`
  - `type StaySilentResult = { ok: true; status: 'silencio_registrado'; message: string } | { ok: false; error: { code: 'invalid_payload' | 'ja_falou' | 'em_voo'; message: string } }`

- [ ] **Step 1: Escrever o teste**

Crie `tests/unit/silencio-em-mensagem-pessoal.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O SILÊNCIO DO TURNO QUANDO A MENSAGEM É PESSOAL (issue #10; spec
 * docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md).
 *
 * A ferramenta cala SÓ o turno: abre um aviso na Central e não toca
 * `force_human`, `bot_silenced_until` nem `passagens_de_atendimento`.
 */
vi.mock("@/lib/atendimento/fronteira-server", () => ({ guardServiceEffect: vi.fn(async () => {}) }));

import {
  applyStaySilent,
  blocoDoSilencioPessoal,
  cercarEnviosPelaTravaDoSilencio,
  criarTravaDoSilencio,
  decidirSilencioDoTurno,
  silencioPessoalDisponivel,
  SILENCIO_PESSOAL_SYSTEM_BLOCK,
  STAY_SILENT_TOOL_DEF,
  TITULO_DO_AVISO_DE_SILENCIO,
} from "@/lib/agent-engine/agent/silencio-pessoal";

const consultas: Array<{ sql: string; params: unknown[] }> = [];
const db = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    if (/select locale from organizations/.test(sql)) return { rows: [{ locale: "pt-BR" }], rowCount: 1 };
    if (/insert into agent_inbox_items/.test(sql)) return { rows: [{ id: "aviso1" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }),
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => log };
const ids = { tenantId: "org1", conversationId: "conv1" };
const sql = (re: RegExp) => consultas.filter((c) => re.test(c.sql));

function calar(raw: unknown, opts: { pendentes?: string[]; seq?: number; trava?: ReturnType<typeof criarTravaDoSilencio> } = {}) {
  return applyStaySilent(
    db as never,
    ids,
    {
      pendentesDoCliente: opts.pendentes ?? ["oi filho, é a mãe"],
      seq: opts.seq ?? 0,
      trava: opts.trava ?? criarTravaDoSilencio(),
      log: log as never,
    },
    raw,
  );
}

beforeEach(() => {
  consultas.length = 0;
  db.query.mockClear();
  log.error.mockClear();
});

describe("quando a ferramenta existe", () => {
  it("só com a chave ligada", () => {
    expect(silencioPessoalDisponivel(null, {})).toBe(false);
    expect(silencioPessoalDisponivel({}, {})).toBe(false);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: false }, {})).toBe(false);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, {})).toBe(true);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, null)).toBe(true);
  });

  it("nunca para cliente confirmado", () => {
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, { cliente_confirmado: true })).toBe(false);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, { cliente_confirmado: false })).toBe(true);
  });

  it("o bloco do prompt acompanha a ferramenta", () => {
    expect(blocoDoSilencioPessoal(false)).toBeNull();
    expect(blocoDoSilencioPessoal(true)).toBe(SILENCIO_PESSOAL_SYSTEM_BLOCK);
  });
});

describe("o bloco do prompt", () => {
  it("manda chamar stay_silent e não fala mais em passagem", () => {
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("stay_silent");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).not.toContain("request_human_handoff");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).not.toContain("a equipe é avisada");
  });

  it("guarda as regras medidas no PR 11: histórico desautorizado e opt-out fora", () => {
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("elas foram um erro");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("nunca é mensagem pessoal");
  });

  it("mensagem misturada é atendimento, e responde só o trabalho", () => {
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("mesmo junto de conversa pessoal");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("responda só a parte do trabalho");
  });

  it("a descrição da ferramenta também barra opt-out e assunto de trabalho", () => {
    expect(STAY_SILENT_TOOL_DEF.description).toContain("parar de receber");
    expect(STAY_SILENT_TOOL_DEF.description).toContain("preço");
  });
});

describe("a decisão do turno", () => {
  it("nada enviado e nada em voo: silêncio", () => {
    expect(decidirSilencioDoTurno({ seq: 0, enviosEmVoo: 0 })).toBe("silencio");
  });
  it("já enviou mensagem neste turno", () => {
    expect(decidirSilencioDoTurno({ seq: 2, enviosEmVoo: 0 })).toBe("ja_falou");
    expect(decidirSilencioDoTurno({ seq: 1, enviosEmVoo: 1 })).toBe("ja_falou");
  });
  it("envio em voo no mesmo passo", () => {
    expect(decidirSilencioDoTurno({ seq: 0, enviosEmVoo: 1 })).toBe("em_voo");
  });
});

describe("stay_silent cala só o turno", () => {
  it("registra o silêncio e abre UM aviso na Central, por conversa", async () => {
    const r = await calar({ por_que: "mãe do dono chamando para almoçar" });
    expect(r).toMatchObject({ ok: true, status: "silencio_registrado" });
    const aviso = sql(/insert into agent_inbox_items/);
    expect(aviso).toHaveLength(1);
    expect(aviso[0]!.params).toEqual(
      expect.arrayContaining(["org1", "silencio_mensagem_pessoal", "info", TITULO_DO_AVISO_DE_SILENCIO, "conversation", "conv1"]),
    );
    // O dedup por conversa é o `where not exists` de insertInboxItem ('kind_e_ref').
    expect(aviso[0]!.sql).toMatch(/where not exists/);
  });

  it("o aviso não repete o que o contato escreveu nem o motivo do modelo", async () => {
    await calar({ por_que: "é a mãe, quer almoço domingo" }, { pendentes: ["oi filho, vem almoçar"] });
    const params = JSON.stringify(sql(/insert into agent_inbox_items/)[0]!.params);
    expect(params).not.toContain("almoço");
    expect(params).not.toContain("almoçar");
  });

  it("não toca force_human, bot_silenced_until, passagem nem cron", async () => {
    await calar({ por_que: "fornecedor cobrando boleto" });
    expect(sql(/force_human|bot_silenced_until|is_blocked/)).toHaveLength(0);
    expect(sql(/passagens_de_atendimento/)).toHaveLength(0);
    expect(sql(/cron_jobs/)).toHaveLength(0);
    expect(sql(/update\s+(contacts|conversations)/i)).toHaveLength(0);
  });

  it("reserva o silêncio: o send_message do mesmo passo é recusado", async () => {
    const trava = criarTravaDoSilencio();
    await calar({ por_que: "amigo do dono" }, { trava });
    expect(trava.comecarEnvio()).toBe(false);
  });

  it("a frase de retorno manda encerrar sem enviar", async () => {
    const r = await calar({ por_que: "amigo do dono" });
    expect(r.ok && r.message).toContain("Nada foi enviado ao contato");
    expect(r.ok && r.message).toContain("sem chamar send_message");
  });

  it("falha ao abrir o aviso não desfaz o silêncio, e fica no log", async () => {
    db.query.mockImplementationOnce(async () => ({ rows: [{ locale: "pt-BR" }], rowCount: 1 }));
    db.query.mockImplementationOnce(async () => {
      throw new Error("banco fora");
    });
    const trava = criarTravaDoSilencio();
    const r = await calar({ por_que: "mãe" }, { trava });
    expect(r.ok).toBe(true);
    expect(trava.comecarEnvio()).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });
});

describe("as recusas", () => {
  it("pedido de parar de receber nunca é pessoal", async () => {
    const trava = criarTravaDoSilencio();
    const r = await calar({ por_que: "mãe" }, { pendentes: ["para de me mandar mensagem"], trava });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("não receber mais mensagens");
    expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
    expect(trava.comecarEnvio()).toBe(true);
  });

  it("já falou neste turno: recusa, sem aviso", async () => {
    const r = await calar({ por_que: "mãe" }, { seq: 1 });
    expect(r).toMatchObject({ ok: false, error: { code: "ja_falou" } });
    expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
  });

  it("envio em voo no mesmo passo: recusa, sem aviso", async () => {
    const trava = criarTravaDoSilencio();
    trava.comecarEnvio();
    const r = await calar({ por_que: "mãe" }, { trava });
    expect(r).toMatchObject({ ok: false, error: { code: "em_voo" } });
    expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
  });

  it.each([[{}], [{ por_que: "" }], [{ por_que: "x".repeat(301) }], [{ por_que: "mãe", motivo_codigo: "mensagem_pessoal" }], [null]])(
    "payload fora do contrato vira erro de ensino: %j",
    async (raw) => {
      const r = await calar(raw);
      expect(r).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
      expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
    },
  );
});

describe("a corrida no mesmo passo: send_message e o silêncio", () => {
  function ferramentasComEnvioPreso() {
    let soltar: () => void = () => {};
    const preso = new Promise<void>((r) => {
      soltar = r;
    });
    const execute = vi.fn(async () => {
      await preso;
      return { ok: true };
    });
    const tools: Record<string, unknown> = {
      send_message: { description: "envia", execute },
      send_template: { description: "modelo", execute: vi.fn(async () => ({ ok: true })) },
    };
    return { tools, execute, soltar: () => soltar() };
  }

  it("envio começou antes: o silêncio vê o envio em voo", async () => {
    const trava = criarTravaDoSilencio();
    const { tools, soltar } = ferramentasComEnvioPreso();
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    const envio = (tools.send_message as { execute: () => Promise<unknown> }).execute();
    expect(decidirSilencioDoTurno({ seq: 0, enviosEmVoo: trava.enviosEmVoo() })).toBe("em_voo");
    soltar();
    await envio;
    expect(trava.enviosEmVoo()).toBe(0);
  });

  it("silêncio reservado antes: o envio do mesmo passo é recusado e nada sai", async () => {
    const trava = criarTravaDoSilencio();
    const { tools, execute } = ferramentasComEnvioPreso();
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    trava.reservarSilencio();
    const r = await (tools.send_message as { execute: () => Promise<unknown> }).execute();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).toContain("silencio_do_turno");
    const t = await (tools.send_template as { execute: () => Promise<unknown> }).execute();
    expect(JSON.stringify(t)).toContain("silencio_do_turno");
  });

  it("envio que lança também sai da conta de em voo", async () => {
    const trava = criarTravaDoSilencio();
    const tools: Record<string, unknown> = {
      send_message: {
        execute: async () => {
          throw new Error("canal caiu");
        },
      },
    };
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    await expect((tools.send_message as { execute: () => Promise<unknown> }).execute()).rejects.toThrow("canal caiu");
    expect(trava.enviosEmVoo()).toBe(0);
  });

  it("indisponível: as ferramentas de envio ficam intocadas", () => {
    const trava = criarTravaDoSilencio();
    const { tools } = ferramentasComEnvioPreso();
    const antes = { ...tools };
    cercarEnviosPelaTravaDoSilencio(tools, false, trava);
    expect(tools.send_message).toBe(antes.send_message);
    expect(tools.send_template).toBe(antes.send_template);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run tests/unit/silencio-em-mensagem-pessoal.test.ts
```

Esperado: FAIL, módulo `@/lib/agent-engine/agent/silencio-pessoal` não existe.

- [ ] **Step 3: Criar o módulo**

Crie `lib/agent-engine/agent/silencio-pessoal.ts`:

```ts
/**
 * O SILÊNCIO DO TURNO QUANDO A MENSAGEM É PESSOAL (issue #10; spec
 * docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md).
 *
 * Quem usa este CRM costuma ter um número só para a vida e para o trabalho.
 * Com `ai_agent_versions.silencio_em_mensagem_pessoal` ligado, o agente não
 * responde a mensagem da mãe, do amigo ou do fornecedor — e continua atendendo:
 * a próxima mensagem do mesmo contato abre um turno normal.
 *
 * NÃO É PASSAGEM. A primeira versão (PR 11) ia de carona em
 * `request_human_handoff` e gravava `force_human`: o amigo que mandou "viu o
 * jogo?" ficava sem IA quando pedisse orçamento no dia seguinte, e para o
 * autônomo não há equipe que receba a passagem. Este módulo nunca toca
 * `force_human`, `bot_silenced_until`, `is_blocked`, `passagens_de_atendimento`
 * nem cron.
 *
 * O que vem do PR 11 e foi medido lá: o bloco no PROMPT (a regra só na
 * descrição da ferramenta foi ignorada 5 de 5 vezes), a frase que desautoriza
 * respostas antigas do histórico, e a trava da corrida entre `send_message` e o
 * silêncio no mesmo passo.
 */
import type pg from 'pg';
import { z } from 'zod';

import { guardServiceEffect } from '@/lib/atendimento/fronteira-server';
import { traduzir } from '@/lib/i18n/dicionario';
import { normalizarIdioma, type Idioma } from '@/lib/i18n/idiomas';
import { ehOptOutProvavel } from '@/lib/opt-out/deteccao';

import { insertInboxItem } from '../db/repository';
import type { Logger } from '../obs/logger';
import { findForbiddenKey, zodIssuesSummary } from './lead-state';

/** Gravado na Central no idioma da organização (o título nunca passa por t() na tela). */
export const TITULO_DO_AVISO_DE_SILENCIO = 'O assistente não respondeu: a mensagem parece pessoal';

export const SILENCIO_PESSOAL_SYSTEM_BLOCK =
  '## Mensagem pessoal para o dono ou a equipe\n' +
  'Este número também recebe mensagens pessoais de quem conhece o dono ou alguém da equipe: família ' +
  '(mãe, pai, filho, filha, irmão, esposa, marido), amigos e fornecedores do negócio. Essas pessoas ' +
  'não são clientes, e você NUNCA responde no lugar do dono ou de alguém da equipe.\n' +
  'A mensagem é pessoal quando quem escreve trata alguém da equipe como parente ou amigo (por ' +
  'exemplo, "oi filho, é a mãe", "amor, chego tarde"), faz convite ou fala de assunto de família, ' +
  'ou fala como fornecedor do negócio (entrega, pedido de compra, cobrança ao negócio).\n' +
  'Nesse caso, a ÚNICA ação do turno é chamar stay_silent, com por_que dizendo quem parece ser e o ' +
  'que quer. Não chame send_message, não cumprimente, não aceite nem recuse convite, não diga que ' +
  'vai passar o recado. O contato não recebe nada, e o dono vê um aviso. Esta regra vale acima das ' +
  'instruções de atendimento deste agente.\n' +
  'Se o histórico mostrar respostas suas a mensagens pessoais, elas foram um erro: não as repita nem ' +
  'as continue, e trate a mensagem nova pela regra acima.\n' +
  'Se a mensagem traz assunto de trabalho (produto, preço, horário, agendamento, serviço), mesmo ' +
  'junto de conversa pessoal, é atendimento: responda só a parte do trabalho.\n' +
  'Pedido para parar de receber mensagens nunca é mensagem pessoal.';

/**
 * A ferramenta (e o bloco, e a trava) só existem com a chave LIGADA e para
 * contato que ninguém confirmou como cliente. Uma régua só para os três:
 * nomear no prompt uma ferramenta ausente faz o modelo tentar chamá-la.
 */
export function silencioPessoalDisponivel(
  agentConfig: { silencioEmMensagemPessoal?: boolean } | null,
  contato: { cliente_confirmado?: boolean } | null | undefined,
): boolean {
  if (agentConfig?.silencioEmMensagemPessoal !== true) return false;
  return contato?.cliente_confirmado !== true;
}

export function blocoDoSilencioPessoal(disponivel: boolean): string | null {
  return disponivel ? SILENCIO_PESSOAL_SYSTEM_BLOCK : null;
}

/**
 * `seq` é o contador de mensagens físicas já enviadas neste turno.
 *   - `silencio` — nada saiu e nada está saindo;
 *   - `ja_falou` — o modelo já mandou mensagem: o que saiu não volta;
 *   - `em_voo`   — `seq` ainda é 0, mas um envio do MESMO passo está saindo.
 */
export function decidirSilencioDoTurno(e: {
  seq: number;
  enviosEmVoo: number;
}): 'silencio' | 'ja_falou' | 'em_voo' {
  if (e.seq > 0) return 'ja_falou';
  return e.enviosEmVoo > 0 ? 'em_voo' : 'silencio';
}

/**
 * A TRAVA DO SILÊNCIO: a corrida entre `send_message` e `stay_silent` chamados
 * no MESMO passo — o SDK executa as chamadas paralelas juntas. As duas pontas
 * são síncronas (nenhum `await` entre olhar e marcar), então só há dois
 * desfechos: o envio começou antes (`enviosEmVoo() > 0`, e o silêncio recusa),
 * ou o silêncio foi reservado antes (o envio é recusado sem sair).
 */
export function criarTravaDoSilencio() {
  let emVoo = 0;
  let reservado = false;
  return {
    /** `false` = o silêncio já foi reservado neste turno: o envio não sai. */
    comecarEnvio: (): boolean => {
      if (reservado) return false;
      emVoo += 1;
      return true;
    },
    terminarEnvio: (): void => {
      emVoo = Math.max(0, emVoo - 1);
    },
    enviosEmVoo: (): number => emVoo,
    reservarSilencio: (): void => {
      reservado = true;
    },
    /** O registro foi abortado (a fronteira do atendimento mudou): o modelo volta a poder falar. */
    soltarSilencio: (): void => {
      reservado = false;
    },
  };
}

export type TravaDoSilencio = ReturnType<typeof criarTravaDoSilencio>;

/** Envolve `send_message` e `send_template` com a trava. Indisponível: ferramentas intocadas. */
export function cercarEnviosPelaTravaDoSilencio(
  rawTools: Record<string, unknown>,
  disponivel: boolean,
  trava: TravaDoSilencio,
): void {
  if (!disponivel) return;
  for (const nome of ['send_message', 'send_template'] as const) {
    const ferramenta = rawTools[nome] as { execute?: (...args: unknown[]) => unknown } | undefined;
    const original = ferramenta?.execute;
    if (typeof original !== 'function') continue;
    rawTools[nome] = {
      ...ferramenta,
      execute: async (...args: unknown[]) => {
        // Antes de qualquer await: é isto que torna a corrida decidível.
        if (!trava.comecarEnvio()) {
          return {
            ok: false,
            error: {
              code: 'silencio_do_turno',
              message:
                'o silêncio deste turno já foi registrado (mensagem pessoal): NÃO envie nada ao ' +
                'contato — encerre o turno agora.',
            },
          };
        }
        try {
          return await original(...args);
        } finally {
          trava.terminarEnvio();
        }
      },
    };
  }
}

/** Validação REAL: estrita. O schema do SDK abaixo é largo de propósito (padrão da casa). */
const staySilentInputSchema = z.strictObject({ por_que: z.string().min(1).max(300) });

const ENSINO =
  'Campo aceito: por_que (quem parece ser e o que quer, em uma frase de até 300 caracteres). Nada ' +
  'além disso. Contato, organização e conversa vêm do runtime, nunca do payload.';

export const STAY_SILENT_TOOL_DEF = {
  description:
    'Registra que este turno termina SEM resposta porque a mensagem é pessoal para o dono ou a ' +
    'equipe (família, amigo, fornecedor), e não um atendimento. Nada é enviado ao contato, e o dono ' +
    'vê um aviso. Chame SEM enviar nada antes. Nunca use para pedido de parar de receber mensagens, ' +
    'nem para quem pergunta por produto, preço, horário, agendamento ou serviço.',
  inputSchema: z
    .object({
      por_que: z
        .string()
        .describe('quem parece ser e o que quer. Ex.: "mãe do dono chamando para almoçar no domingo"'),
    })
    .passthrough(),
};

export type StaySilentResult =
  | { ok: true; status: 'silencio_registrado'; message: string }
  | { ok: false; error: { code: 'invalid_payload' | 'ja_falou' | 'em_voo'; message: string } };

/** Gêmea da função privada de `human-handoff.ts`: o aviso nasce no idioma da organização. */
async function idiomaDaOrganizacao(db: Pick<pg.Pool, 'query'>, tenantId: string, log: Logger): Promise<Idioma> {
  try {
    const { rows } = await db.query<{ locale: string | null }>(
      'select locale from organizations where id = $1',
      [tenantId],
    );
    return normalizarIdioma(rows[0]?.locale ?? null);
  } catch (err) {
    log.warn('idioma da organização não lido — aviso da Central em português', {
      error: err instanceof Error ? err.message.slice(0, 120) : 'erro desconhecido',
    });
    return 'pt-BR';
  }
}

/**
 * A ferramenta `stay_silent`. Tudo até `reservarSilencio()` é SÍNCRONO: entre
 * olhar os envios em voo e reservar não pode haver `await`, senão um
 * `send_message` do mesmo passo entra no meio.
 *
 * O aviso da Central é a rede para o falso positivo (cliente calado por
 * engano). Se ele não puder nascer, o silêncio vale mesmo assim e o erro vai
 * para o log: responder à mãe do dono porque o banco piscou seria pior.
 */
export async function applyStaySilent(
  db: Pick<pg.Pool, 'query'>,
  ids: { tenantId: string; conversationId: string },
  opts: {
    pendentesDoCliente: readonly string[];
    seq: number;
    trava: TravaDoSilencio;
    log: Logger;
  },
  rawInput: unknown,
): Promise<StaySilentResult> {
  const forbidden = findForbiddenKey(rawInput);
  if (forbidden !== null) {
    return { ok: false, error: { code: 'invalid_payload', message: `campos não reconhecidos: ${forbidden}. ${ENSINO}` } };
  }
  const parsed = staySilentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'invalid_payload', message: `payload inválido em stay_silent (${zodIssuesSummary(parsed.error)}). ${ENSINO}` },
    };
  }
  // OPT-OUT VENCE: o silêncio não pode virar o jeito de não responder a quem pediu para parar.
  if (opts.pendentesDoCliente.some((texto) => ehOptOutProvavel(texto))) {
    return {
      ok: false,
      error: {
        code: 'invalid_payload',
        message:
          'stay_silent recusado: a mensagem parece um pedido para não receber mais mensagens. Isso ' +
          'não é assunto pessoal — trate o pedido.',
      },
    };
  }
  const decisao = decidirSilencioDoTurno({ seq: opts.seq, enviosEmVoo: opts.trava.enviosEmVoo() });
  if (decisao !== 'silencio') {
    return {
      ok: false,
      error: {
        code: decisao,
        message:
          (decisao === 'ja_falou'
            ? 'stay_silent recusado: você já enviou mensagem ao contato neste turno. '
            : 'stay_silent recusado: há uma mensagem sua ao contato saindo neste mesmo passo. ') +
          'Não há silêncio a registrar — encerre o turno.',
      },
    };
  }
  opts.trava.reservarSilencio();

  try {
    await guardServiceEffect();
  } catch (err) {
    opts.trava.soltarSilencio();
    throw err;
  }
  try {
    const idioma = await idiomaDaOrganizacao(db, ids.tenantId, opts.log);
    await insertInboxItem(
      db,
      ids.tenantId,
      {
        kind: 'silencio_mensagem_pessoal',
        severity: 'info',
        title: traduzir(TITULO_DO_AVISO_DE_SILENCIO, idioma),
        refKind: 'conversation',
        refId: ids.conversationId,
      },
      'kind_e_ref',
    );
  } catch (err) {
    opts.log.error('silêncio registrado, mas o aviso da Central não nasceu', {
      conversation_id: ids.conversationId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido',
    });
  }

  return {
    ok: true,
    status: 'silencio_registrado',
    message:
      'Silêncio registrado. Nada foi enviado ao contato. Encerre o turno agora, sem chamar send_message.',
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm vitest run tests/unit/silencio-em-mensagem-pessoal.test.ts
```

Esperado: PASS. O `typecheck` só fecha na Tarefa 7, quando `'silencio_mensagem_pessoal'` entra em `InboxKind`.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-engine/agent/silencio-pessoal.ts tests/unit/silencio-em-mensagem-pessoal.test.ts
git commit -m "✨ [feat] agente: stay_silent cala só o turno e abre aviso na Central"
```

---

### Task 5: Turno calado não é turno mudo

**Files:**
- Modify: `lib/agent-engine/agent/turno-mudo.ts`
- Modify: `tests/unit/turno-mudo-pede-correcao.test.ts`

**Interfaces:**
- Produces: `turnoMudoPedeCorrecao(t)` aceita `calouPorMensagemPessoal?: boolean`.

- [ ] **Step 1: Caso novo que falha**

Em `tests/unit/turno-mudo-pede-correcao.test.ts`, acrescente à lista do `it.each`, depois da linha do cap de envio:

```ts
    ["o agente calou de propósito numa mensagem pessoal", { calouPorMensagemPessoal: true }],
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run tests/unit/turno-mudo-pede-correcao.test.ts
```

Esperado: FAIL no caso novo (`expected true to be false`).

- [ ] **Step 3: Implementar**

Em `lib/agent-engine/agent/turno-mudo.ts`, na lista do comentário de cabeçalho ("O silêncio às vezes é decisão"), acrescente o item:

```ts
 * - o agente calou de propósito numa mensagem pessoal (`stay_silent`, issue #10).
```

No tipo do parâmetro de `turnoMudoPedeCorrecao`, depois de `capDeEnvio: boolean;`:

```ts
  /** `stay_silent` registrou o silêncio neste turno (issue #10). Ausente = não. */
  calouPorMensagemPessoal?: boolean;
```

Na expressão de retorno, depois de `!t.capDeEnvio`:

```ts
    && t.calouPorMensagemPessoal !== true
```

(Ajuste a pontuação da expressão para ela continuar um único `return (...)`.)

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm vitest run tests/unit/turno-mudo-pede-correcao.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-engine/agent/turno-mudo.ts tests/unit/turno-mudo-pede-correcao.test.ts
git commit -m "✨ [feat] agente: silêncio de propósito em mensagem pessoal não pede correção do turno mudo"
```

---

### Task 6: Ligar no turno e na prévia

**Files:**
- Modify: `lib/agent-engine/agent/inbound-turn.ts`
- Modify: `lib/agent-engine/agent/preview.ts`
- Modify: `tests/unit/silencio-em-mensagem-pessoal.test.ts` (bloco de fiação)

**Interfaces:**
- Consumes: tudo o que a Tarefa 4 produz; `turnoMudoPedeCorrecao` da Tarefa 5; `silencioEmMensagemPessoal` e `cliente_confirmado` da Tarefa 3.
- Produces: ferramenta `stay_silent` no turno; bandeira `calouPorMensagemPessoal`.

- [ ] **Step 1: Teste de fiação que falha**

Acrescente ao fim de `tests/unit/silencio-em-mensagem-pessoal.test.ts` (e os imports `readFileSync` de `node:fs` e `join` de `node:path` no topo):

```ts
describe("fiação no turno", () => {
  const fonte = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
  const previa = readFileSync(join(process.cwd(), "lib/agent-engine/agent/preview.ts"), "utf8");

  it("a disponibilidade é decidida DEPOIS de ler o contato e ANTES de fechar o prompt", () => {
    const contexto = fonte.indexOf("const openingContext = preview");
    const disponivel = fonte.indexOf("const silencioDisponivel = silencioPessoalDisponivel(agentConfig, openingContext.context.contact);");
    const bloco = fonte.indexOf("blocoDoSilencioPessoal(silencioDisponivel)");
    const system = fonte.indexOf("const system = blocosResidentes.join");
    expect(contexto).toBeGreaterThan(-1);
    expect(disponivel).toBeGreaterThan(contexto);
    expect(bloco).toBeGreaterThan(disponivel);
    expect(system).toBeGreaterThan(bloco);
  });

  it("indisponível: a ferramenta sai do modelo; disponível: os envios ganham a trava", () => {
    expect(fonte).toContain("if (!silencioDisponivel) delete rawTools.stay_silent;");
    expect(fonte).toContain("cercarEnviosPelaTravaDoSilencio(rawTools, silencioDisponivel, travaDoSilencio);");
  });

  it("a ferramenta marca o turno como calado, e as duas guardas do turno mudo leem a marca", () => {
    const inicio = fonte.indexOf("    stay_silent: tool({");
    expect(inicio).toBeGreaterThan(-1);
    const corpo = fonte.slice(inicio, fonte.indexOf("    }),", inicio));
    expect(corpo).toContain("applyStaySilent(");
    expect(corpo).toContain("calouPorMensagemPessoal = true;");
    expect(corpo).not.toMatch(/force_human|performHumanHandoff|passouParaAEquipe/);
    expect(fonte).toMatch(/turnoMudoPedeCorrecao\(\{[^}]*calouPorMensagemPessoal,/s);
    expect(fonte).toMatch(/silencioSemRazaoLegitima =[^;]*!calouPorMensagemPessoal/s);
  });

  it("a passagem para a equipe não conhece mais mensagem pessoal", () => {
    expect(fonte).not.toContain("mensagem_pessoal");
    expect(fonte).not.toContain("PassagemSilenciosa");
  });

  it("na prévia, stay_silent vira um impedimento legível e não executa", () => {
    expect(previa).toContain("name === 'stay_silent'");
    expect(previa).toContain("O assistente ficaria em silêncio: a mensagem parece pessoal.");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run tests/unit/silencio-em-mensagem-pessoal.test.ts -t "fiação no turno"
```

Esperado: FAIL nos cinco casos.

- [ ] **Step 3: Import**

Em `lib/agent-engine/agent/inbound-turn.ts`, junto do import de `./turno-mudo`:

```ts
import {
  applyStaySilent,
  blocoDoSilencioPessoal,
  cercarEnviosPelaTravaDoSilencio,
  criarTravaDoSilencio,
  silencioPessoalDisponivel,
  STAY_SILENT_TOOL_DEF,
} from './silencio-pessoal';
```

- [ ] **Step 4: Decidir a disponibilidade depois de ler o contato**

Hoje o prompt fecha antes de o contato ser lido. Ache este trecho (`grep -n "const system = blocosResidentes.join" lib/agent-engine/agent/inbound-turn.ts`):

```ts
  if (preview)
    blocosResidentes.push(
      'MODO PRÉVIA: proponha a resposta com send_message. Operações são propostas separadas; nunca diga que executou uma proposta. Nenhum envio real acontece.',
    );
  const system = blocosResidentes.join('\n\n');
  const openingContext = preview
    ? preview.context
    : await getLeadContext(
        pool,
        deps.crmCfg,
        { tenantId, leadId, conversationId: input.conversationId, fuso: fusoDaOrg },
        turnContextKnobs,
      );
  if (!openingContext.ok) {
    // Sem contexto não há turno: transiente (CRM fora) OU permanente (lead
    // sumiu) — ambos re-tentam pela fila e morrem em 'dead' se persistirem.
    throw new Error(`abertura do turno falhou em get_lead_context (${openingContext.error.code})`);
  }
```

e reordene para:

```ts
  const openingContext = preview
    ? preview.context
    : await getLeadContext(
        pool,
        deps.crmCfg,
        { tenantId, leadId, conversationId: input.conversationId, fuso: fusoDaOrg },
        turnContextKnobs,
      );
  if (!openingContext.ok) {
    // Sem contexto não há turno: transiente (CRM fora) OU permanente (lead
    // sumiu) — ambos re-tentam pela fila e morrem em 'dead' se persistirem.
    throw new Error(`abertura do turno falhou em get_lead_context (${openingContext.error.code})`);
  }
  // Issue #10: o silêncio por mensagem pessoal depende da chave da versão E do
  // contato (quem alguém confirmou como cliente não é calado). Por isso o
  // prompt só fecha depois da leitura do contato: a mesma régua decide o bloco,
  // a ferramenta e a trava dos envios.
  const silencioDisponivel = silencioPessoalDisponivel(agentConfig, openingContext.context.contact);
  const blocoPessoal = blocoDoSilencioPessoal(silencioDisponivel);
  if (blocoPessoal !== null) blocosResidentes.push(blocoPessoal);
  if (preview)
    blocosResidentes.push(
      'MODO PRÉVIA: proponha a resposta com send_message. Operações são propostas separadas; nunca diga que executou uma proposta. Nenhum envio real acontece.',
    );
  const system = blocosResidentes.join('\n\n');
```

Confira que nada usava `system` entre a posição antiga e a nova:

```bash
grep -n "\bsystem\b" lib/agent-engine/agent/inbound-turn.ts | head -20
```

Esperado: a primeira ocorrência de uso vem depois da nova declaração.

- [ ] **Step 5: Estado do turno**

Ache `let passouParaAEquipe = false;` e acrescente logo abaixo:

```ts
  // Issue #10: `stay_silent` registrou o silêncio deste turno. É razão legítima
  // de terminar sem mensagem, como a passagem — as duas guardas do turno mudo a leem.
  let calouPorMensagemPessoal = false;
  // Envios do modelo em voo x silêncio no mesmo passo (ver `criarTravaDoSilencio`).
  const travaDoSilencio = criarTravaDoSilencio();
```

- [ ] **Step 6: A ferramenta**

No objeto das ferramentas do turno, imediatamente antes de `    request_human_handoff: tool({`:

```ts
    // Issue #10: mensagem pessoal cala SÓ este turno. Sem `force_human`, sem
    // passagem — a próxima mensagem do contato abre um turno normal. Some do
    // modelo mais abaixo quando a chave está desligada ou o contato é cliente
    // confirmado (`silencioDisponivel`).
    stay_silent: tool({
      ...STAY_SILENT_TOOL_DEF,
      execute: async (raw) => {
        try {
          const res = await applyStaySilent(
            pool,
            { tenantId, conversationId: input.conversationId },
            { pendentesDoCliente: inboundsPendentes, seq, trava: travaDoSilencio, log: runLog },
            raw,
          );
          if (res.ok) {
            calouPorMensagemPessoal = true;
            pararDigitando();
          }
          return res;
        } catch (err) {
          noteRunError(err instanceof Error ? err : new Error(String(err)));
          return {
            ok: false,
            error: {
              code: 'internal_error',
              message: 'erro interno ao registrar o silêncio — encerre o turno agora, sem enviar nada.',
            },
          };
        }
      },
    }),
```

Se o `typecheck` reclamar que `input.conversationId` pode ser `null`, não afrouxe o tipo de `applyStaySilent`: o turno de resposta sempre tem conversa. Devolva o erro de ensino `internal_error` do `catch` quando ela faltar, antes de chamar `applyStaySilent`.

- [ ] **Step 7: Tirar a ferramenta quando indisponível e cercar os envios**

Ache `aplicaAChaveDeAssuntoJuridico(rawTools, agentConfig?.handoffLegalEnabled);` e acrescente logo abaixo:

```ts
  // Issue #10: independente da chave de cima e da ferramenta de passagem.
  if (!silencioDisponivel) delete rawTools.stay_silent;
  cercarEnviosPelaTravaDoSilencio(rawTools, silencioDisponivel, travaDoSilencio);
```

- [ ] **Step 8: As duas guardas do turno mudo**

Na chamada de `turnoMudoPedeCorrecao({ ... })`, depois de `capDeEnvio: capDeEnvioAtingido(),`:

```ts
            calouPorMensagemPessoal,
```

Na expressão de `silencioSemRazaoLegitima`, depois de `!passouParaAEquipe &&`:

```ts
      !calouPorMensagemPessoal &&
```

E no comentário acima dela, onde lista as razões legítimas ("turno descartado (obsoleto), passagem para a equipe (handoff do cliente), teto de pacing"), acrescente "silêncio de propósito em mensagem pessoal (`stay_silent`)".

- [ ] **Step 9: Prévia**

Em `lib/agent-engine/agent/preview.ts`, imediatamente antes de `if (catalog?.category === 'read')`:

```ts
            // Issue #10: na prévia o silêncio não grava nada. Vira um impedimento
            // legível — é ele que a tela mostra, e é ele que impede o
            // "decidiu não responder" genérico de `desfechoSemCandidato`.
            if (name === 'stay_silent') {
              p.result.impediments.push({
                code: 'personal_message_silence',
                message: 'O assistente ficaria em silêncio: a mensagem parece pessoal.',
              });
              return {
                ok: true,
                status: 'proposal_only',
                message: 'Silêncio registrado na prévia. Nada foi enviado. Encerre o turno.',
              };
            }
```

- [ ] **Step 10: Rodar**

```bash
pnpm vitest run tests/unit/silencio-em-mensagem-pessoal.test.ts tests/unit/turno-mudo-pede-correcao.test.ts tests/unit/correcao-do-turno-mudo-so-escala-com-falha.test.ts tests/unit/passagem-tool-schema-espelhado.test.ts tests/unit/chave-juridico-so-troca-a-descricao.test.ts
```

Esperado: PASS em todos.

- [ ] **Step 11: Commit**

```bash
git add lib/agent-engine/agent/inbound-turn.ts lib/agent-engine/agent/preview.ts tests/unit/silencio-em-mensagem-pessoal.test.ts
git commit -m "✨ [feat] agente: stay_silent ligada no turno e na prévia"
```

---

### Task 7: O aviso existe para a Central

**Files:**
- Modify: `lib/agent-engine/db/repository.ts` (`InboxKind`)
- Modify: `lib/ai/inbox-destino.ts` (`POLITICAS_DE_AVISO`)
- Modify: `lib/ai/agent-inbox-copy.ts` (`KIND_LABEL`)
- Modify: `lib/i18n/dicionario.ts`, `lib/i18n/traducoes/en.json`
- Test: `tests/unit/silencio-pessoal-na-central.test.ts` (novo)

**Interfaces:**
- Produces: `'silencio_mensagem_pessoal'` em `InboxKind`; política com `refs: ["conversation"]`; rótulo do tipo.

- [ ] **Step 1: Teste que falha**

Crie `tests/unit/silencio-pessoal-na-central.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { KIND_LABEL, kindLabel } from "@/lib/ai/agent-inbox-copy";
import { POLITICAS_DE_AVISO } from "@/lib/ai/inbox-destino";
import { TITULO_DO_AVISO_DE_SILENCIO } from "@/lib/agent-engine/agent/silencio-pessoal";
import { traduzir } from "@/lib/i18n/dicionario";

const KIND = "silencio_mensagem_pessoal";

describe("o aviso do silêncio na Central", () => {
  it("aponta para a conversa e diz o que fazer nos dois casos", () => {
    const politica = POLITICAS_DE_AVISO[KIND];
    expect(politica.refs).toEqual(["conversation"]);
    expect(politica.orientacao).toBe(
      "Se for cliente, peça a resposta. Se for pessoal, marque o contato e o assistente não entra mais nessa conversa.",
    );
  });

  it("tem rótulo próprio", () => {
    expect(KIND_LABEL[KIND]).toBe("O assistente ficou em silêncio numa mensagem que parece pessoal");
    expect(kindLabel(KIND)).toBe(KIND_LABEL[KIND]);
  });

  it.each(["es", "en"] as const)("título, orientação e rótulo têm tradução em %s", (idioma) => {
    for (const texto of [TITULO_DO_AVISO_DE_SILENCIO, POLITICAS_DE_AVISO[KIND].orientacao, KIND_LABEL[KIND]]) {
      expect(traduzir(texto, idioma), texto).not.toBe(texto);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run tests/unit/silencio-pessoal-na-central.test.ts
```

Esperado: FAIL (`POLITICAS_DE_AVISO[KIND]` indefinido).

- [ ] **Step 3: Vocabulário**

Em `lib/agent-engine/db/repository.ts`, no tipo `InboxKind`, acrescente antes do último membro:

```ts
  // (migration NNNN, issue #10) O agente calou de propósito porque a mensagem
  // parece pessoal. Nasce em `silencio-pessoal.ts`; fecha sozinho quando sai
  // qualquer mensagem na conversa ou quando ela é encerrada.
  | 'silencio_mensagem_pessoal'
```

- [ ] **Step 4: Política e rótulo**

Em `lib/ai/inbox-destino.ts`, em `POLITICAS_DE_AVISO`, antes de `other:`:

```ts
  silencio_mensagem_pessoal: {
    refs: ["conversation"],
    orientacao:
      "Se for cliente, peça a resposta. Se for pessoal, marque o contato e o assistente não entra mais nessa conversa.",
  },
```

Em `lib/ai/agent-inbox-copy.ts`, em `KIND_LABEL`, junto dos tipos `jev_*`:

```ts
  // Diz o que o CONTATO viveu: ele escreveu e o assistente não respondeu. Quem
  // lê decide se era para ser assim.
  silencio_mensagem_pessoal: "O assistente ficou em silêncio numa mensagem que parece pessoal",
```

- [ ] **Step 5: Traduções desta tarefa**

Em `lib/i18n/dicionario.ts`, dentro de `DICIONARIO`, junto das entradas da Central (procure `"Pedido para falar com uma pessoa, percebido pelo Jev"`):

```ts
  // ── Silêncio do turno em mensagem pessoal (migration NNNN, issue #10) ──
  "O assistente não respondeu: a mensagem parece pessoal":
    { es: "El asistente no respondió: el mensaje parece personal" },
  "Se for cliente, peça a resposta. Se for pessoal, marque o contato e o assistente não entra mais nessa conversa.":
    { es: "Si es cliente, pide la respuesta. Si es personal, marca el contacto y el asistente no vuelve a entrar en esa conversación." },
  "O assistente ficou em silêncio numa mensagem que parece pessoal":
    { es: "El asistente guardó silencio en un mensaje que parece personal" },
```

Em `lib/i18n/traducoes/en.json`, antes do `}` final (ponha vírgula na linha anterior):

```json
  "O assistente não respondeu: a mensagem parece pessoal": "The assistant did not reply: the message looks personal",
  "Se for cliente, peça a resposta. Se for pessoal, marque o contato e o assistente não entra mais nessa conversa.": "If it is a customer, ask for the reply. If it is personal, mark the contact and the assistant stays out of that conversation.",
  "O assistente ficou em silêncio numa mensagem que parece pessoal": "The assistant stayed silent on a message that looks personal"
```

- [ ] **Step 6: Rodar**

```bash
pnpm vitest run tests/unit/silencio-pessoal-na-central.test.ts tests/unit/silencio-em-mensagem-pessoal.test.ts
pnpm typecheck
```

Esperado: PASS e typecheck zerado (é aqui que o `kind` do módulo da Tarefa 4 passa a existir no tipo).

- [ ] **Step 7: Commit**

```bash
git add lib tests/unit/silencio-pessoal-na-central.test.ts
git commit -m "✨ [feat] central: aviso do silêncio em mensagem pessoal tem política, rótulo e tradução"
```

---

### Task 8: "É cliente, responder" — a rota

**Files:**
- Create: `app/api/v1/conversations/[id]/client-confirmed/route.ts`
- Test: `app/api/v1/conversations/[id]/client-confirmed/route.test.ts`
- Modify: `lib/i18n/dicionario.ts`, `lib/i18n/traducoes/en.json`

**Interfaces:**
- Consumes: `contacts.cliente_confirmado_em` (Tarefa 2).
- Produces: `POST /api/v1/conversations/[id]/client-confirmed` → `{ data: { contact_id: string; conversation_id: string; turn_requested: boolean; message: string } }`. Erros: 404 `not_found`, 409 `state_conflict`, 422 `validation_failed`, 500 `internal_error`.

- [ ] **Step 1: Teste que falha**

Crie `app/api/v1/conversations/[id]/client-confirmed/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

import { POST } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const SESSAO = "44444444-4444-4444-8444-444444444444";
const MENSAGEM = "55555555-5555-4555-8555-555555555555";

/**
 * SABOTAGEM (prova no CI):
 * - tirar o filtro de organização da leitura da conversa: "conversa de outra org" acusa;
 * - repedir o turno sem olhar a última mensagem: "alguém já respondeu" acusa;
 * - confirmar contato pessoal: "contato pessoal recusa" acusa.
 */
let conversa: { id: string; organization_id: string; contact_id: string; channel_session_id: string; is_group: boolean } | null;
let contato: { id: string; organization_id: string; is_personal: boolean; cliente_confirmado_em: string | null };
let ultima: { id: string; direction: "inbound" | "outbound" } | null;
let avisosResolvidos: Array<Record<string, unknown>>;
let eventos: Array<Record<string, unknown>>;

function fakeQuery(tabela: string) {
  const e = { op: "select", patch: {} as Record<string, unknown>, f: {} as Record<string, unknown> };
  const resultado = () => {
    if (tabela === "conversations") {
      const ok = conversa && conversa.id === e.f["id"] && conversa.organization_id === e.f["organization_id"];
      return { data: ok ? conversa : null, error: null };
    }
    if (tabela === "contacts" && e.op === "update") {
      const ok =
        contato.id === e.f["id"] && contato.organization_id === e.f["organization_id"] && contato.is_personal === e.f["is_personal"];
      if (!ok) return { data: null, error: null };
      Object.assign(contato, e.patch);
      return { data: { id: contato.id }, error: null };
    }
    if (tabela === "agent_inbox_items" && e.op === "update") {
      avisosResolvidos.push({ ...e.f, ...e.patch });
      return { data: null, error: null };
    }
    if (tabela === "messages") return { data: ultima, error: null };
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    update: (patch: Record<string, unknown>) => {
      e.op = "update";
      e.patch = patch;
      return q;
    },
    eq: (coluna: string, valor: unknown) => {
      e.f[coluna] = valor;
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => resultado(),
    then: (resolve: (v: unknown) => void) => resolve(resultado()),
  };
  return q;
}

const contexto = (id = CONVERSA) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest(`http://localhost/api/v1/conversations/${CONVERSA}/client-confirmed`, { method: "POST" });

beforeEach(() => {
  conversa = { id: CONVERSA, organization_id: ORG, contact_id: CONTATO, channel_session_id: SESSAO, is_group: false };
  contato = { id: CONTATO, organization_id: ORG, is_personal: false, cliente_confirmado_em: null };
  ultima = { id: MENSAGEM, direction: "inbound" };
  avisosResolvidos = [];
  eventos = [];
  vi.mocked(audit).mockClear();
  vi.mocked(requireSupportWrite).mockResolvedValue(null as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user-1", idioma: "pt-BR" },
    org: { orgId: ORG, role: "agent" },
  } as never);
  vi.mocked(createAdminClient).mockReturnValue({
    from: (tabela: string) => fakeQuery(tabela),
    rpc: vi.fn(async (_nome: string, args: Record<string, unknown>) => {
      eventos.push(args);
      return { error: null };
    }),
  } as never);
});

describe("POST /api/v1/conversations/[id]/client-confirmed", () => {
  it("marca o contato, fecha o aviso, repede o turno e audita", async () => {
    const res = await POST(req(), contexto());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ contact_id: CONTATO, conversation_id: CONVERSA, turn_requested: true });
    expect(contato.cliente_confirmado_em).not.toBeNull();
    expect(avisosResolvidos).toEqual([
      expect.objectContaining({
        organization_id: ORG, kind: "silencio_mensagem_pessoal", ref_kind: "conversation", ref_id: CONVERSA, status: "resolved",
      }),
    ]);
    expect(eventos).toEqual([
      expect.objectContaining({
        p_event_type: "ai_agent.dispatch_requested",
        p_entity_id: MENSAGEM,
        p_organization_id: ORG,
        p_payload: {
          organization_id: ORG, conversation_id: CONVERSA, contact_id: CONTATO, channel_session_id: SESSAO, inbound_message_id: MENSAGEM,
        },
      }),
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contact.client_confirmed", organizationId: ORG, resourceType: "contact", resourceId: CONTATO, actorUserId: "user-1" }),
    );
  });

  it("alguém já respondeu: marca, mas não repede o turno, e diz isso", async () => {
    ultima = { id: MENSAGEM, direction: "outbound" };
    const res = await POST(req(), contexto());
    const { data } = await res.json();
    expect(data.turn_requested).toBe(false);
    expect(data.message).toContain("já teve resposta");
    expect(eventos).toEqual([]);
    expect(contato.cliente_confirmado_em).not.toBeNull();
  });

  it("conversa de outra organização: 404, sem efeito e sem auditoria", async () => {
    conversa!.organization_id = OUTRA_ORG;
    const res = await POST(req(), contexto());
    expect(res.status).toBe(404);
    expect(contato.cliente_confirmado_em).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it("grupo: 404", async () => {
    conversa!.is_group = true;
    expect((await POST(req(), contexto())).status).toBe(404);
  });

  it("contato pessoal recusa com 409 e não repede o turno", async () => {
    contato.is_personal = true;
    const res = await POST(req(), contexto());
    expect(res.status).toBe(409);
    expect(eventos).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("id que não é uuid: 422", async () => {
    expect((await POST(req(), contexto("nao-e-uuid"))).status).toBe(422);
  });

  it("papel é o de atendente", async () => {
    await POST(req(), contexto());
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("agent");
  });

  it("sessão de suporte somente leitura: barrada antes de qualquer efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "x", 403, { requestId: "r" }) as never);
    const res = await POST(req(), contexto());
    expect(res.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalledTimes(2);
    expect(contato.cliente_confirmado_em).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run "app/api/v1/conversations/[id]/client-confirmed/route.test.ts"
```

Esperado: FAIL, `./route` não existe.

- [ ] **Step 3: Implementar a rota**

Crie `app/api/v1/conversations/[id]/client-confirmed/route.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * "É CLIENTE, RESPONDER" (issue #10; spec
 * docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md §3.6).
 *
 * O agente calou numa mensagem que parecia pessoal e alguém, olhando o aviso da
 * Central, diz que era cliente. A rota:
 *
 *  1. grava `contacts.cliente_confirmado_em` — com ela o turno deixa de oferecer
 *     o silêncio a este contato, neste turno e nos seguintes;
 *  2. fecha o aviso aberto da conversa;
 *  3. pede o turno de novo, SÓ se a última mensagem da conversa é do contato.
 *     Se alguém já respondeu, repedir faria o agente responder por cima;
 *  4. audita `contact.client_confirmed` (quem confirmou mora aqui, sem coluna).
 *
 * Parte da CONVERSA porque é para ela que o aviso aponta; o contato é achado no
 * servidor. Papel `agent`, a mesma régua de devolver o atendimento ao agente.
 * Contato marcado como pessoal recusa: quem é pessoal saiu da operação (spec
 * 21), e desmarcar é ato de gerente.
 */
export async function POST(_req: NextRequest, ctx: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  if (!z.string().uuid().safeParse(id).success) {
    return fail("validation_failed", t("Conversa inválida."), 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: conversa } = await admin
    .from("conversations")
    .select("id, contact_id, channel_session_id, is_group")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  const alvo = conversa as { id: string; contact_id: string; channel_session_id: string; is_group: boolean } | null;
  if (!alvo || alvo.is_group) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }

  const { data: marcado, error: erroDaMarca } = await admin
    .from("contacts")
    .update({ cliente_confirmado_em: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", alvo.contact_id)
    .eq("is_personal", false)
    .select("id")
    .maybeSingle();
  if (erroDaMarca) {
    return fail("internal_error", t("Não foi possível confirmar este contato como cliente."), 500, { requestId });
  }
  if (!marcado) {
    return fail(
      "state_conflict",
      t("Este contato está marcado como pessoal. Desmarque antes de confirmar como cliente."),
      409,
      { requestId },
    );
  }

  await admin
    .from("agent_inbox_items")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("kind", "silencio_mensagem_pessoal")
    .eq("ref_kind", "conversation")
    .eq("ref_id", alvo.id)
    .eq("status", "open");

  const { data: ultima } = await admin
    .from("messages")
    .select("id, direction")
    .eq("organization_id", orgId)
    .eq("conversation_id", alvo.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ultimaMensagem = ultima as { id: string; direction: string } | null;

  let turnoPedido = false;
  if (ultimaMensagem?.direction === "inbound") {
    const { error: erroDoEvento } = await admin.rpc(
      "emit_event" as never,
      {
        p_event_type: "ai_agent.dispatch_requested",
        p_entity_kind: "message",
        p_entity_id: ultimaMensagem.id,
        p_payload: {
          organization_id: orgId,
          conversation_id: alvo.id,
          contact_id: alvo.contact_id,
          channel_session_id: alvo.channel_session_id,
          inbound_message_id: ultimaMensagem.id,
        },
        p_metadata: { source: "client_confirmed", request_id: requestId },
        p_organization_id: orgId,
      } as never,
    );
    if (erroDoEvento) {
      logger.warn("client-confirmed: o turno não pôde ser pedido de novo", {
        organization_id: orgId,
        conversation_id: alvo.id,
        detail: erroDoEvento.message.slice(0, 120),
      });
    } else {
      turnoPedido = true;
    }
  }

  await audit({
    action: "contact.client_confirmed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "contact",
    resourceId: alvo.contact_id,
    requestId,
  });

  return ok(
    {
      contact_id: alvo.contact_id,
      conversation_id: alvo.id,
      turn_requested: turnoPedido,
      message: turnoPedido
        ? t("Marcado como cliente. O assistente vai responder a última mensagem.")
        : t("Marcado como cliente. A conversa já teve resposta, então nada foi reenviado."),
    },
    { requestId },
  );
}
```

- [ ] **Step 4: Traduções da rota**

Em `lib/i18n/dicionario.ts`, no bloco aberto na Tarefa 7:

```ts
  "Conversa inválida.": { es: "Conversación inválida." },
  "Não foi possível confirmar este contato como cliente.":
    { es: "No se pudo confirmar este contacto como cliente." },
  "Este contato está marcado como pessoal. Desmarque antes de confirmar como cliente.":
    { es: "Este contacto está marcado como personal. Desmárcalo antes de confirmarlo como cliente." },
  "Marcado como cliente. O assistente vai responder a última mensagem.":
    { es: "Marcado como cliente. El asistente va a responder el último mensaje." },
  "Marcado como cliente. A conversa já teve resposta, então nada foi reenviado.":
    { es: "Marcado como cliente. La conversación ya tuvo respuesta, así que no se reenvió nada." },
```

Em `lib/i18n/traducoes/en.json`:

```json
  "Conversa inválida.": "Invalid conversation.",
  "Não foi possível confirmar este contato como cliente.": "Could not confirm this contact as a customer.",
  "Este contato está marcado como pessoal. Desmarque antes de confirmar como cliente.": "This contact is marked as personal. Unmark it before confirming as a customer.",
  "Marcado como cliente. O assistente vai responder a última mensagem.": "Marked as a customer. The assistant will reply to the last message.",
  "Marcado como cliente. A conversa já teve resposta, então nada foi reenviado.": "Marked as a customer. The conversation already got a reply, so nothing was resent."
```

Se `"Conversa inválida."` ou `"Conversa não encontrada."` já existirem no dicionário, não duplique a chave: `grep -n '"Conversa inválida."\|"Conversa não encontrada."' lib/i18n/dicionario.ts lib/i18n/traducoes/en.json`. Se `"Conversa não encontrada."` não existir, acrescente-a nos dois arquivos (`es`: "Conversación no encontrada."; `en`: "Conversation not found.").

- [ ] **Step 5: Rodar**

```bash
pnpm vitest run "app/api/v1/conversations/[id]/client-confirmed/route.test.ts" tests/unit/suporte-cobertura-de-efeitos.test.ts
```

Esperado: PASS. Se o código de erro `forbidden` do caso de suporte não existir em `lib/api/errors.ts`, troque no teste por um código que exista (`grep -n "forbidden" lib/api/errors.ts`).

- [ ] **Step 6: Commit**

```bash
git add "app/api/v1/conversations/[id]/client-confirmed" lib/i18n
git commit -m "✨ [feat] central: rota que confirma o contato como cliente e repede o turno"
```

---

### Task 9: Os dois botões na Central

**Files:**
- Create: `lib/ai/silencio-na-central.ts`
- Test: `lib/ai/silencio-na-central.test.ts`
- Modify: `app/api/v1/ai/inbox/route.ts`
- Modify: `hooks/ai/useAgentInbox.ts`
- Create: `hooks/ai/useConfirmClient.ts`
- Create: `app/app/ai/inbox/_components/AcoesDoSilencio.tsx`
- Modify: `app/app/ai/inbox/_components/AgentInboxList.tsx`
- Modify: `lib/i18n/dicionario.ts`, `lib/i18n/traducoes/en.json`

**Interfaces:**
- Consumes: rota da Tarefa 8; `useMarkPersonalContact(id)` de `hooks/contacts/usePersonalContact.ts`.
- Produces: `anexarAcoesDoSilencio(admin, orgId, role, itens)`; campo `silencio_pessoal?: { conversation_id: string; contact_id: string; pode_marcar_pessoal: boolean } | null` em `AgentInboxItem`; `useConfirmClient()`; componente `<AcoesDoSilencio item={item} />`.

- [ ] **Step 1: Teste da projeção, que falha**

Crie `lib/ai/silencio-na-central.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { anexarAcoesDoSilencio } from "./silencio-na-central";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";

function admin(linhas: Array<{ id: string; contact_id: string }>) {
  const filtros: Record<string, unknown> = {};
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      filtros[c] = v;
      return q;
    },
    in: (c: string, v: unknown) => {
      filtros[c] = v;
      return Promise.resolve({ data: linhas, error: null });
    },
  };
  const from = vi.fn(() => q);
  return { cliente: { from } as never, from, filtros };
}

const aviso = (extra: Record<string, unknown> = {}) => ({
  id: "a1", kind: "silencio_mensagem_pessoal", ref_kind: "conversation", ref_id: CONVERSA, status: "open", ...extra,
});

describe("anexarAcoesDoSilencio", () => {
  it("aviso aberto ganha a conversa, o contato e a permissão de marcar", async () => {
    const a = admin([{ id: CONVERSA, contact_id: CONTATO }]);
    const [item] = await anexarAcoesDoSilencio(a.cliente, ORG, "manager", [aviso()]);
    expect(item).toMatchObject({
      silencio_pessoal: { conversation_id: CONVERSA, contact_id: CONTATO, pode_marcar_pessoal: true },
    });
    expect(a.filtros["organization_id"]).toBe(ORG);
  });

  it("atendente não pode marcar como pessoal (só gerente e dono)", async () => {
    const a = admin([{ id: CONVERSA, contact_id: CONTATO }]);
    const [item] = await anexarAcoesDoSilencio(a.cliente, ORG, "agent", [aviso()]);
    expect((item as { silencio_pessoal: { pode_marcar_pessoal: boolean } }).silencio_pessoal.pode_marcar_pessoal).toBe(false);
  });

  it("aviso de outro tipo, resolvido ou sem conversa não ganha nada, e nem consulta o banco", async () => {
    const a = admin([]);
    const itens = [aviso({ kind: "handoff" }), aviso({ status: "resolved" }), aviso({ ref_id: null })];
    const saida = await anexarAcoesDoSilencio(a.cliente, ORG, "admin", itens);
    expect(saida).toEqual(itens);
    expect(a.from).not.toHaveBeenCalled();
  });

  it("conversa que a organização não tem: sem ações", async () => {
    const a = admin([]);
    const [item] = await anexarAcoesDoSilencio(a.cliente, ORG, "admin", [aviso()]);
    expect(item).not.toHaveProperty("silencio_pessoal");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run lib/ai/silencio-na-central.test.ts
```

Esperado: FAIL, módulo não existe.

- [ ] **Step 3: A projeção**

Crie `lib/ai/silencio-na-central.ts`:

```ts
/**
 * AS AÇÕES DO AVISO DE SILÊNCIO, PROJETADAS NO SERVIDOR (issue #10).
 *
 * O aviso `silencio_mensagem_pessoal` aponta para a conversa. Para o botão
 * "Marcar como contato pessoal" a tela precisa do contato, e para desabilitá-lo
 * com o motivo precisa saber se o papel pode marcar (só gerente e dono, spec
 * 21). As duas respostas saem daqui: o browser não deriva nada de referência
 * livre, a mesma regra de `resolverDestinosDosAvisos`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLE_RANK, type Role } from "@/lib/auth/types";

export interface AcoesDoSilencio {
  conversation_id: string;
  contact_id: string;
  pode_marcar_pessoal: boolean;
}

interface AvisoMinimo {
  kind: string;
  ref_kind: string | null;
  ref_id: string | null;
  status: string;
}

const ehDoSilencio = (i: AvisoMinimo): boolean =>
  i.kind === "silencio_mensagem_pessoal" && i.status === "open" && i.ref_kind === "conversation" && i.ref_id !== null;

export async function anexarAcoesDoSilencio<T extends AvisoMinimo>(
  admin: SupabaseClient,
  orgId: string,
  role: Role,
  itens: T[],
): Promise<Array<T | (T & { silencio_pessoal: AcoesDoSilencio })>> {
  const conversas = [...new Set(itens.filter(ehDoSilencio).map((i) => i.ref_id as string))];
  if (conversas.length === 0) return itens;

  const { data } = await admin
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", orgId)
    .in("id", conversas);
  const contatoDe = new Map(
    ((data ?? []) as Array<{ id: string; contact_id: string }>).map((c) => [c.id, c.contact_id]),
  );
  const podeMarcar = ROLE_RANK[role] >= ROLE_RANK.manager;

  return itens.map((i) => {
    const contato = ehDoSilencio(i) ? contatoDe.get(i.ref_id as string) : undefined;
    return contato === undefined
      ? i
      : { ...i, silencio_pessoal: { conversation_id: i.ref_id as string, contact_id: contato, pode_marcar_pessoal: podeMarcar } };
  });
}
```

- [ ] **Step 4: Ligar na API da Central**

Em `app/api/v1/ai/inbox/route.ts`, acrescente o import:

```ts
import { anexarAcoesDoSilencio } from "@/lib/ai/silencio-na-central";
```

e troque

```ts
  const items = await anexarLinkDePagamento(admin, org.orgId, org.role, comDestino);
```

por

```ts
  const comLink = await anexarLinkDePagamento(admin, org.orgId, org.role, comDestino);
  const items = await anexarAcoesDoSilencio(admin, org.orgId, org.role, comLink);
```

- [ ] **Step 5: Tipo e hook no cliente**

Em `hooks/ai/useAgentInbox.ts`, na interface `AgentInboxItem`, depois de `link_de_pagamento?: string | null;`:

```ts
  /** Só no aviso aberto de silêncio em mensagem pessoal: o que os dois botões precisam. */
  silencio_pessoal?: { conversation_id: string; contact_id: string; pode_marcar_pessoal: boolean } | null;
```

Crie `hooks/ai/useConfirmClient.ts`:

```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

interface Confirmacao {
  contact_id: string;
  conversation_id: string;
  turn_requested: boolean;
  message: string;
}

/** "É cliente, responder": confirma o contato e pede o turno de novo (issue #10). */
export function useConfirmClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) =>
      apiClient
        .post<{ data: Confirmacao }>(`/api/v1/conversations/${conversationId}/client-confirmed`, {})
        .then((r) => r.data),
    onError: showApiError,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["agent-inbox"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
```

- [ ] **Step 6: O componente dos botões**

Crie `app/app/ai/inbox/_components/AcoesDoSilencio.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useConfirmClient } from "@/hooks/ai/useConfirmClient";
import type { AgentInboxItem } from "@/hooks/ai/useAgentInbox";
import { useMarkPersonalContact } from "@/hooks/contacts/usePersonalContact";
import { useT } from "@/hooks/i18n/useT";

/**
 * Os dois botões do aviso de silêncio em mensagem pessoal (issue #10).
 * "É cliente" corrige o engano e faz o assistente responder; "pessoal" tira o
 * contato da operação (spec 21), e só gerente e dono podem.
 */
export function AcoesDoSilencio({ item }: { item: AgentInboxItem }) {
  const t = useT();
  const qc = useQueryClient();
  const acoes = item.silencio_pessoal ?? null;
  const confirmar = useConfirmClient();
  const marcar = useMarkPersonalContact(acoes?.contact_id ?? "");
  const [feito, setFeito] = useState<string | null>(null);

  if (item.kind !== "silencio_mensagem_pessoal" || !acoes) return null;
  const ocupado = confirmar.isPending || marcar.isPending;

  if (feito !== null) {
    return (
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {feito}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="acoes-do-silencio">
      <Button
        size="sm"
        disabled={ocupado}
        onClick={() => confirmar.mutate(acoes.conversation_id, { onSuccess: (d) => setFeito(d.message) })}
      >
        {t("É cliente, responder")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={ocupado || !acoes.pode_marcar_pessoal}
        onClick={() =>
          marcar.mutate(undefined, {
            onSuccess: () => {
              setFeito(t("Contato marcado como pessoal. O assistente não entra mais nessa conversa."));
              void qc.invalidateQueries({ queryKey: ["agent-inbox"] });
            },
          })
        }
      >
        {t("Marcar como contato pessoal")}
      </Button>
      {!acoes.pode_marcar_pessoal ? (
        <p className="basis-full text-xs text-muted-foreground">
          {t("Só gerente ou dono marca um contato como pessoal.")}
        </p>
      ) : null}
    </div>
  );
}
```

Em `app/app/ai/inbox/_components/AgentInboxList.tsx`, acrescente o import:

```tsx
import { AcoesDoSilencio } from "./AcoesDoSilencio";
```

e, dentro de `InboxRow`, logo depois do bloco do `linkDePagamentoSeguro(...)` (antes do `</div>` que fecha a coluna do texto):

```tsx
        <AcoesDoSilencio item={item} />
```

- [ ] **Step 7: Traduções dos botões**

Em `lib/i18n/dicionario.ts`, no bloco da Tarefa 7:

```ts
  "É cliente, responder": { es: "Es cliente, responder" },
  "Marcar como contato pessoal": { es: "Marcar como contacto personal" },
  "Contato marcado como pessoal. O assistente não entra mais nessa conversa.":
    { es: "Contacto marcado como personal. El asistente no vuelve a entrar en esa conversación." },
  "Só gerente ou dono marca um contato como pessoal.":
    { es: "Solo un gerente o el dueño marca un contacto como personal." },
```

Em `lib/i18n/traducoes/en.json`:

```json
  "É cliente, responder": "It is a customer, reply",
  "Marcar como contato pessoal": "Mark as personal contact",
  "Contato marcado como pessoal. O assistente não entra mais nessa conversa.": "Contact marked as personal. The assistant stays out of that conversation.",
  "Só gerente ou dono marca um contato como pessoal.": "Only a manager or the owner marks a contact as personal."
```

Antes de acrescentar, confira duplicata: `grep -n '"Marcar como contato pessoal"' lib/i18n/dicionario.ts lib/i18n/traducoes/en.json`.

- [ ] **Step 8: Rodar**

```bash
pnpm vitest run lib/ai/silencio-na-central.test.ts tests/unit/i18n-espanhol-cobre-a-tela.test.ts tests/unit/i18n-provedores-e-pontos.test.ts
pnpm typecheck && pnpm lint
```

Esperado: PASS, typecheck e lint zerados.

- [ ] **Step 9: Commit**

```bash
git add lib/ai lib/i18n hooks/ai app/api/v1/ai/inbox app/app/ai/inbox
git commit -m "✨ [feat] central: o aviso de silêncio ganha os botões de cliente e de contato pessoal"
```

---

### Task 10: A chave na tela do agente

O PR 11 só ligava por SQL. A chave segue a irmã `handoff_legal_enabled` em todo arquivo por onde uma versão viaja: se faltar um, quem cria rascunho a partir da versão publicada perde a chave sem aviso.

**Files:**
- Modify (select de colunas): `app/api/v1/ai/agents/route.ts`, `app/api/v1/ai/agents/[id]/versions/route.ts`, `app/api/v1/ai/agents/[id]/versions/[vid]/route.ts`, `app/app/ai/agents/[id]/page.tsx`, `app/app/ai/agents/[id]/_actions.ts`, `lib/ai/agents/duplicate.ts`
- Modify (cópia e patch): `app/api/v1/ai/agents/[id]/versions/route.ts`, `app/api/v1/ai/agents/[id]/versions/[vid]/route.ts`, `app/app/ai/agents/[id]/_actions.ts`, `lib/ai/agents/duplicate.ts`
- Modify (schema e tipo): `lib/ai/agents/validation.ts`, `hooks/ai/useAgentVersions.ts`
- Modify (tela): `app/app/ai/agents/[id]/_components/AgentForm.tsx`, `app/app/ai/agents/[id]/_components/VersionDiff.tsx`
- Modify: `lib/i18n/dicionario.ts`, `lib/i18n/traducoes/en.json`
- Test: `tests/unit/chave-do-silencio-pessoal-no-formulario.test.ts` (novo)

**Interfaces:**
- Consumes: coluna `silencio_em_mensagem_pessoal` (Tarefa 2).
- Produces: campo `silencio_em_mensagem_pessoal: boolean` em `FormState`, no payload da versão, no schema Zod e no diff de versões.

- [ ] **Step 1: Teste que falha**

Crie `tests/unit/chave-do-silencio-pessoal-no-formulario.test.ts`:

```ts
/**
 * A CHAVE "NÃO RESPONDER MENSAGEM PESSOAL" VIAJA POR ONDE A VERSÃO VIAJA.
 *
 * Régua: todo arquivo que carrega `handoff_legal_enabled` (a chave irmã, por
 * versão) carrega `silencio_em_mensagem_pessoal`. Faltar num deles é o defeito
 * mudo: a pessoa liga, salva, cria um rascunho novo e a chave volta desligada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { traduzir } from "@/lib/i18n/dicionario";

const ler = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");
const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;

/** arquivo → quantas vezes a chave nova tem de aparecer, no mínimo. */
const ARQUIVOS: Array<[string, number]> = [
  ["app/api/v1/ai/agents/route.ts", 1],
  ["app/api/v1/ai/agents/[id]/versions/route.ts", 2],
  ["app/api/v1/ai/agents/[id]/versions/[vid]/route.ts", 3],
  ["app/app/ai/agents/[id]/page.tsx", 1],
  ["app/app/ai/agents/[id]/_actions.ts", 5],
  ["app/app/ai/agents/[id]/_components/AgentForm.tsx", 6],
  ["app/app/ai/agents/[id]/_components/VersionDiff.tsx", 1],
  ["lib/ai/agents/duplicate.ts", 2],
  ["lib/ai/agents/validation.ts", 2],
  ["hooks/ai/useAgentVersions.ts", 1],
];

describe("a chave do silêncio pessoal viaja com a versão", () => {
  it.each(ARQUIVOS)("%s carrega silencio_em_mensagem_pessoal", (arquivo, minimo) => {
    expect(vezes(ler(arquivo), "silencio_em_mensagem_pessoal")).toBeGreaterThanOrEqual(minimo);
  });

  it("nasce desligada no schema e no formulário", () => {
    expect(ler("lib/ai/agents/validation.ts")).toContain("silencio_em_mensagem_pessoal: z.boolean().default(false),");
    expect(ler("app/app/ai/agents/[id]/_components/AgentForm.tsx")).toContain(
      "silencio_em_mensagem_pessoal: version?.silencio_em_mensagem_pessoal ?? false,",
    );
  });

  it("o interruptor não depende da ferramenta de passagem", () => {
    const form = ler("app/app/ai/agents/[id]/_components/AgentForm.tsx");
    const inicio = form.indexOf('id="silencio_em_mensagem_pessoal"');
    expect(inicio).toBeGreaterThan(-1);
    const interruptor = form.slice(inicio, form.indexOf("/>", inicio));
    expect(interruptor).toContain("disabled={disabled}");
    expect(interruptor).not.toContain("handoff_tool_enabled");
  });

  it.each(["es", "en"] as const)("rótulo e ajuda têm tradução em %s", (idioma) => {
    for (const texto of [
      "Não responder mensagem pessoal",
      "Quando família, amigo ou fornecedor escreve para este número, o assistente não responde e deixa um aviso na Central. Ele volta a atender quando o assunto for trabalho.",
    ]) {
      expect(traduzir(texto, idioma), texto).not.toBe(texto);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm vitest run tests/unit/chave-do-silencio-pessoal-no-formulario.test.ts
```

Esperado: FAIL em todos os arquivos.

- [ ] **Step 3: Os seis selects de colunas**

Os seis arquivos têm a mesma lista de colunas numa string. Um comando só:

```bash
sed -i 's/handoff_legal_enabled, proposal_ai_draft_enabled/handoff_legal_enabled, silencio_em_mensagem_pessoal, proposal_ai_draft_enabled/' \
  app/api/v1/ai/agents/route.ts \
  "app/api/v1/ai/agents/[id]/versions/route.ts" \
  "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts" \
  "app/app/ai/agents/[id]/page.tsx" \
  "app/app/ai/agents/[id]/_actions.ts" \
  lib/ai/agents/duplicate.ts
grep -c "silencio_em_mensagem_pessoal, proposal_ai_draft_enabled" app/api/v1/ai/agents/route.ts "app/api/v1/ai/agents/[id]/versions/route.ts" "app/api/v1/ai/agents/[id]/versions/[vid]/route.ts" "app/app/ai/agents/[id]/page.tsx" "app/app/ai/agents/[id]/_actions.ts" lib/ai/agents/duplicate.ts
```

Esperado: cada arquivo com contagem 1.

- [ ] **Step 4: Cópias, patch, schema e tipos**

Em cada lugar abaixo, acrescente a linha nova logo depois da linha irmã. Ache as irmãs com `grep -n "handoff_legal_enabled" <arquivo>`.

`app/api/v1/ai/agents/[id]/versions/route.ts`, depois de `handoff_legal_enabled: v.handoff_legal_enabled,`:

```ts
        silencio_em_mensagem_pessoal: v.silencio_em_mensagem_pessoal,
```

`app/api/v1/ai/agents/[id]/versions/[vid]/route.ts`, depois do `if (patch.handoff_legal_enabled !== undefined) ...`:

```ts
  if (patch.silencio_em_mensagem_pessoal !== undefined)
    update.silencio_em_mensagem_pessoal = patch.silencio_em_mensagem_pessoal;
```

`app/app/ai/agents/[id]/_actions.ts`, quatro lugares. Depois de cada `handoff_legal_enabled: v.handoff_legal_enabled,` (dois lugares):

```ts
        silencio_em_mensagem_pessoal: v.silencio_em_mensagem_pessoal,
```

Depois de `handoff_legal_enabled: boolean;`:

```ts
    silencio_em_mensagem_pessoal: boolean;
```

Depois de `handoff_legal_enabled: src.handoff_legal_enabled,`:

```ts
        silencio_em_mensagem_pessoal: src.silencio_em_mensagem_pessoal,
```

`lib/ai/agents/duplicate.ts`, depois de `handoff_legal_enabled: src.handoff_legal_enabled,`:

```ts
    silencio_em_mensagem_pessoal: src.silencio_em_mensagem_pessoal,
```

`lib/ai/agents/validation.ts`, depois de `handoff_legal_enabled: z.boolean().default(true),`:

```ts
    // Issue #10: mensagem pessoal cala só o turno. Desligada por padrão.
    silencio_em_mensagem_pessoal: z.boolean().default(false),
```

e depois de `handoff_legal_enabled: versionShapeSchema.shape.handoff_legal_enabled.removeDefault(),`:

```ts
    silencio_em_mensagem_pessoal: versionShapeSchema.shape.silencio_em_mensagem_pessoal.removeDefault(),
```

`hooks/ai/useAgentVersions.ts`, depois de `handoff_legal_enabled: boolean;`:

```ts
  silencio_em_mensagem_pessoal: boolean;
```

`app/app/ai/agents/[id]/_components/VersionDiff.tsx`, depois de `["handoff_legal_enabled", "handoff_legal_enabled"],`:

```ts
    ["silencio_em_mensagem_pessoal", "silencio_em_mensagem_pessoal"],
```

- [ ] **Step 5: O formulário**

Em `app/app/ai/agents/[id]/_components/AgentForm.tsx`:

Depois de `handoff_legal_enabled: boolean;` (tipo do estado):

```ts
  silencio_em_mensagem_pessoal: boolean;
```

Depois de `handoff_legal_enabled: version?.handoff_legal_enabled ?? true,`:

```ts
    silencio_em_mensagem_pessoal: version?.silencio_em_mensagem_pessoal ?? false,
```

Depois de `handoff_legal_enabled: s.handoff_legal_enabled,`:

```ts
    silencio_em_mensagem_pessoal: s.silencio_em_mensagem_pessoal,
```

E na tela, logo depois do parágrafo de ajuda da chave jurídica (o `<p>` que começa com "Desligue se assunto jurídico é o trabalho normal deste agente") e antes de `<HandoffKeywordsInput`:

```tsx
            {/* Issue #10: mensagem pessoal cala SÓ o turno. Não é passagem, e por
                isso não depende do interruptor de cima: funciona mesmo com a
                ferramenta de chamar uma pessoa desligada. */}
            <div className="flex items-center gap-2">
              <Switch
                id="silencio_em_mensagem_pessoal"
                checked={form.silencio_em_mensagem_pessoal}
                onCheckedChange={(v) => patch({ silencio_em_mensagem_pessoal: v })}
                disabled={disabled}
              />
              <Label htmlFor="silencio_em_mensagem_pessoal">{t("Não responder mensagem pessoal")}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Quando família, amigo ou fornecedor escreve para este número, o assistente não responde e deixa um aviso na Central. Ele volta a atender quando o assunto for trabalho.",
              )}
            </p>
```

- [ ] **Step 6: Traduções**

Em `lib/i18n/dicionario.ts`, no bloco da Tarefa 7:

```ts
  "Não responder mensagem pessoal": { es: "No responder mensajes personales" },
  "Quando família, amigo ou fornecedor escreve para este número, o assistente não responde e deixa um aviso na Central. Ele volta a atender quando o assunto for trabalho.":
    { es: "Cuando un familiar, un amigo o un proveedor escribe a este número, el asistente no responde y deja un aviso en la Central. Vuelve a atender cuando el asunto es de trabajo." },
```

Em `lib/i18n/traducoes/en.json`:

```json
  "Não responder mensagem pessoal": "Do not reply to personal messages",
  "Quando família, amigo ou fornecedor escreve para este número, o assistente não responde e deixa um aviso na Central. Ele volta a atender quando o assunto for trabalho.": "When family, a friend or a supplier writes to this number, the assistant does not reply and leaves a notice in the Central. It goes back to answering when the subject is work."
```

- [ ] **Step 7: Rodar**

```bash
pnpm vitest run tests/unit/chave-do-silencio-pessoal-no-formulario.test.ts tests/unit/chave-juridico-no-formulario.test.tsx tests/unit/editor-de-agente-salva-o-cadastro.test.tsx tests/unit/i18n-espanhol-cobre-a-tela.test.ts
pnpm typecheck
```

Esperado: PASS e typecheck zerado. Se `editor-de-agente-salva-o-cadastro` tiver outra extensão, ache com `ls tests/unit | grep editor-de-agente`. Se o typecheck apontar um construtor de versão que não foi listado aqui, acrescente a linha irmã nele: a régua é "onde está `handoff_legal_enabled`, está `silencio_em_mensagem_pessoal`".

- [ ] **Step 8: Commit**

```bash
git add app lib hooks tests/unit/chave-do-silencio-pessoal-no-formulario.test.ts
git commit -m "✨ [feat] agente: chave Não responder mensagem pessoal na tela do agente"
```

---

### Task 11: Prova no turno real

**Files:**
- Modify: `scripts/prova-silencio-pessoal-turno-real.ts`
- Create: `evidence/issue-10-qa-v4/rodar.sh`
- Create (gerados): `evidence/issue-10-qa-v4/*.jsonl`, `evidence/issue-10-qa-v4/placar.txt`

**Interfaces:**
- Consumes: tudo das Tarefas 2 a 7, aplicado no banco de teste local.
- Produces: uma linha JSON por passo com `{ frase, conversa, tentativa, passo, mensagens_ao_contato, stay_silent, aviso_aberto, force_human_depois, bot_silenciado_depois, passagens, agendados, erro }`.

- [ ] **Step 1: Ajustar o banco de teste local (uma vez)**

O banco do `DeskcommCRM-teste` está na versão antiga do produto e rodou a migration 0769 do PR 11. Primeiro tire dele o que o PR 11 deixou; depois traga-o para a versão da branch reaplicando o `supabase/baseline.sql` em modo atualização (sem `ON_ERROR_STOP`, como o `update.sh` faz). No `psql` do Supabase local:

```sql
alter table public.ai_agent_versions
  rename column handoff_silencioso_pessoal to silencio_em_mensagem_pessoal;
delete from public.passagens_de_atendimento
  where motivo_codigo = 'mensagem_pessoal' or aviso_motivo_codigo = 'silencio_intencional';
```

Os dois CHECKs de `passagens_de_atendimento` que o PR 11 alargou não são recriados à mão: o baseline os reconstrói no bloco único dele, com a lista em vigor, e as linhas que os violariam acabaram de sair.

Depois reaplique o baseline da branch, que já traz esta entrega no apêndice:

```bash
psql "$SUPABASE_DB_URL" -f supabase/baseline.sql > /tmp/baseline-teste.log 2>&1; grep -c "ERROR" /tmp/baseline-teste.log
psql "$SUPABASE_DB_URL" -Atc "select count(*) from ai_agent_versions where silencio_em_mensagem_pessoal"
psql "$SUPABASE_DB_URL" -Atc "select count(*) from pg_trigger where tgname like 'trg_fechar_aviso_do_silencio_pessoal%'"
```

Esperado: a contagem de versões é maior que zero (as de teste que tinham a chave antiga ligada) e há 2 gatilhos. Se o log tiver `ERROR`, leia as linhas antes de seguir: o banco de teste pulou 16 versões do produto, e um erro ali é do salto de versão, não desta entrega. Reporte-o em vez de contornar.

- [ ] **Step 2: Adaptar o script**

Em `scripts/prova-silencio-pessoal-turno-real.ts`:

1. Troque o comentário de cabeçalho: onde diz "passagem silenciosa", diga "silêncio do turno"; o uso passa a ser `FRASE=<nome>[,<nome>]`, com os passos rodando em sequência na mesma tentativa, e `CLIENTE_CONFIRMADO=1` para o cenário do cliente confirmado.

2. Substitua o mapa `FRASES` por:

```ts
const FRASES: Record<string, string> = {
  mae: "Oi filho, é a mãe! Vem almoçar domingo?",
  // o texto exato que o dono mandou no teste de 01/11/2026
  "mae-longa":
    "Oi filho, é a mãe! Você vem almoçar aqui no domingo? Vou fazer aquela lasanha. Beijo",
  comercial: "Oi, quero saber o preço da consulta",
  preco: "E quanto custa o corte?",
  misturada: "E aí, beleza? Quanto tá o corte?",
  parar: "Mãe aqui. Para de me mandar mensagem",
};
```

3. Troque a leitura de uma frase por uma lista de passos:

```ts
  const passos = (process.env.FRASE ?? "mae").split(",").filter(Boolean);
  for (const nome of passos) if (!FRASES[nome]) throw new Error(`frase desconhecida: ${nome}`);
  const clienteConfirmado = process.env.CLIENTE_CONFIRMADO === "1";
```

4. No `select` que guarda o estado `antes`, acrescente `k.cliente_confirmado_em`. Em `restaurar`, o `update contacts` passa a ser:

```ts
      await pool.query(
        `update contacts set force_human = $2, ai_authorized_at = $3, ai_authorized_reason = $4,
                cliente_confirmado_em = $5
          where id = $1`,
        [antes.contact_id, antes.force_human, antes.ai_authorized_at, antes.ai_authorized_reason, antes.cliente_confirmado_em],
      );
      await pool.query(
        `delete from agent_inbox_items
          where organization_id = $1 and kind = 'silencio_mensagem_pessoal' and ref_id = $2`,
        [antes.organization_id, conversationId],
      );
```

5. Dentro do laço das tentativas, depois da autorização do contato, acrescente:

```ts
      if (clienteConfirmado) {
        await pool.query(`update contacts set cliente_confirmado_em = now() where id = $1`, [antes.contact_id]);
      }
      const inseridas: string[] = [];
```

6. Envolva o bloco que vai de `const t0 = ...` até o `console.info(JSON.stringify({...}))` num laço `for (const [indice, fraseNome] of passos.entries()) { const texto = FRASES[fraseNome]!; ... }`. Dentro dele: troque o `delete from messages where id = $1` do fim por `inseridas.push(messageId);`, e mova a remoção para depois do laço dos passos:

```ts
      // As mensagens inseridas saem: a próxima tentativa vê o mesmo histórico.
      const c2 = await pool.connect();
      try {
        await c2.query("begin");
        await c2.query(`set local session_replication_role = replica`);
        await c2.query(`delete from messages where id = any($1::uuid[])`, [inseridas]);
        await c2.query("commit");
      } finally {
        c2.release();
      }
```

7. Depois do handler de cada passo, troque a coleta por:

```ts
      const { rows: pass } = await pool.query(
        `select motivo_codigo from passagens_de_atendimento
          where conversation_id = $1 and criado_em >= $2::timestamptz`,
        [conversationId, t0],
      );
      const { rows: tr } = await pool.query(
        `select status, model, ferramentas, abort_reason, error_message from agent_turn_traces
          where job_id = $1`,
        [job.id],
      );
      const { rows: av } = await pool.query(
        `select count(*)::int as n from agent_inbox_items
          where organization_id = $1 and kind = 'silencio_mensagem_pessoal' and ref_id = $2 and status = 'open'`,
        [antes.organization_id, conversationId],
      );
      const { rows: ag } = await pool.query(
        `select
           (select count(*)::int from job_queue
             where contact_id = $1 and id <> $2 and created_at >= $3::timestamptz) as jobs,
           (select count(*)::int from cron_jobs
             where contact_id = $1 and enabled and created_at >= $3::timestamptz) as crons`,
        [antes.contact_id, job.id, t0],
      );
      const { rows: ev } = await pool.query(
        `update event_log set status = 'done', last_error = 'prova issue #10: não entregue de propósito'
          where organization_id = $1 and created_at >= $2::timestamptz and status = 'pending'
          returning event_type`,
        [antes.organization_id, t0],
      );
      const { rows: depois } = await pool.query(
        `select k.force_human, c.bot_silenced_until from contacts k
           join conversations c on c.contact_id = k.id where c.id = $1`,
        [conversationId],
      );
      const ferramentas = ((tr[0]?.ferramentas ?? []) as Array<{ nome: string; estado: string }>);

      console.info(
        JSON.stringify({
          frase: fraseNome,
          conversa: conversationId,
          tentativa: i,
          passo: indice + 1,
          ms: Date.now() - ms0,
          mensagens_ao_contato: enviados,
          stay_silent: ferramentas.filter((f) => f.nome === "stay_silent").map((f) => f.estado),
          stay_silent_chamada: ferramentas.some((f) => f.nome === "stay_silent"),
          aviso_aberto: av[0]?.n ?? 0,
          force_human_depois: depois[0]?.force_human,
          bot_silenciado_depois: depois[0]?.bot_silenced_until !== null,
          passagens: pass.map((p) => p.motivo_codigo),
          agendados: ag[0],
          traco: tr[0] ?? null,
          eventos: ev.map((e) => e.event_type),
          erro,
        }),
      );
```

`enviados` passa a ser declarado dentro do laço dos passos (um vetor por passo). Confira antes os nomes das colunas de data: `psql "$SUPABASE_DB_URL" -c "\d cron_jobs" -c "\d job_queue" | grep -i "created_at\|contact_id\|enabled"`; se `cron_jobs` não tiver `created_at`, use a coluna de criação que ela tiver.

8. Troque `const WORKER = "prova-issue-10";` por `const WORKER = "prova-silencio-pessoal";`.

- [ ] **Step 3: O roteiro e o placar**

Crie `evidence/issue-10-qa-v4/rodar.sh`:

```bash
#!/usr/bin/env bash
# Prova do silêncio do turno em mensagem pessoal (issue #10), turno real, modelo real.
# Uso: bash evidence/issue-10-qa-v4/rodar.sh "<arquivo de ambiente do Supabase local>" <conversas da mãe, com vírgula> <conversa comercial com a chave ligada> <conversa comercial com a chave desligada>
set -euo pipefail
export ENV_FILE="$1"; MAE="$2"; COMERCIAL_LIGADA="$3"; COMERCIAL_DESLIGADA="$4"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out=evidence/issue-10-qa-v4
S="pnpm exec tsx scripts/prova-silencio-pessoal-turno-real.ts"
CONVERSAS=$MAE N=10 FRASE=mae $S > "$out/mae-x20.jsonl"
CONVERSAS=$MAE N=5 FRASE=mae-longa $S > "$out/mae-longa-x10.jsonl"
CONVERSAS=$MAE N=5 FRASE=mae,preco $S > "$out/volta-sozinha-x10.jsonl"
CONVERSAS=$MAE N=5 FRASE=misturada $S > "$out/misturada-x10.jsonl"
CONVERSAS=$COMERCIAL_LIGADA N=5 FRASE=comercial $S > "$out/comercial-chave-ligada-x5.jsonl"
CONVERSAS=$COMERCIAL_DESLIGADA N=5 FRASE=comercial $S > "$out/comercial-chave-desligada-x5.jsonl"
CONVERSAS=${MAE%%,*} N=5 FRASE=mae CLIENTE_CONFIRMADO=1 $S > "$out/cliente-confirmado-x5.jsonl"
CONVERSAS=${MAE%%,*} N=5 FRASE=parar $S > "$out/parar-x5.jsonl"
node -e '
const fs=require("fs"),dir=process.argv[1];
const ler=f=>fs.readFileSync(dir+"/"+f+".jsonl","utf8").split("\n").filter(l=>l.startsWith("{\"frase\"")).map(l=>JSON.parse(l));
const limpo=x=>!x.erro&&x.force_human_depois===false&&x.bot_silenciado_depois===false&&x.passagens.length===0;
const calou=x=>limpo(x)&&x.mensagens_ao_contato.length===0&&x.stay_silent.includes("ok")&&x.aviso_aberto===1&&x.agendados.jobs===0&&x.agendados.crons===0;
const respondeu=x=>limpo(x)&&x.mensagens_ao_contato.length>0&&!x.stay_silent.includes("ok");
const regua={
  "mae-x20":t=>t.filter(calou).length,
  "mae-longa-x10":t=>t.filter(calou).length,
  "volta-sozinha-x10":t=>t.filter(x=>x.passo===2&&respondeu(x)).length,
  "misturada-x10":t=>t.filter(respondeu).length,
  "comercial-chave-ligada-x5":t=>t.filter(respondeu).length,
  "comercial-chave-desligada-x5":t=>t.filter(x=>respondeu(x)&&!x.stay_silent_chamada).length,
  "cliente-confirmado-x5":t=>t.filter(x=>!x.stay_silent_chamada&&x.aviso_aberto===0).length,
  "parar-x5":t=>t.filter(x=>!x.stay_silent.includes("ok")&&x.aviso_aberto===0).length,
};
for(const [f,conta] of Object.entries(regua)){const t=ler(f);const total=f==="volta-sozinha-x10"?t.filter(x=>x.passo===2).length:t.length;console.log(f+": "+conta(t)+" de "+total);}
' "$out" | tee "$out/placar.txt"
```

(O `estado` da ferramenta no traço, que o placar compara com `"ok"`, é o valor que `traco-do-turno.ts` grava para chamada bem-sucedida. Confira com `grep -n "estado" lib/agent-engine/agent/traco-do-turno.ts | head` e ajuste a constante do placar se o valor for outro.)

- [ ] **Step 4: Rodar a prova**

Com o Supabase local de pé, a chave do OmniRoute (`google/crm-padrao`) na org de teste e as conversas do `DeskcommCRM-teste` (as duas da mãe e a comercial da Barbearia são as de `evidence/issue-10-qa-v3/rodar.sh`; a quarta é uma conversa comercial atendida por uma versão com a chave desligada):

```bash
bash evidence/issue-10-qa-v4/rodar.sh "<env do Supabase local>" 5658e152-0590-443c-8783-2e376dca3ec2,1e59bc20-0864-4398-968a-1f02e27a352e 687d2dcd-63f4-49a4-8d9d-14db16013dd4 <conversa com a chave desligada>
cat evidence/issue-10-qa-v4/placar.txt
```

Esperado (régua da spec §6): `mae-x20: 20 de 20`, `mae-longa-x10: 10 de 10`, `volta-sozinha-x10: 10 de 10`, `misturada-x10: 10 de 10`, `comercial-chave-ligada-x5: 5 de 5`, `comercial-chave-desligada-x5: 5 de 5`, `cliente-confirmado-x5: 5 de 5`, `parar-x5: 5 de 5`.

Se alguma linha ficar abaixo, **pare e reporte o placar e três linhas do `.jsonl` que falhou**. Não ajuste a régua. O texto do bloco do prompt é o primeiro suspeito, e mudá-lo é decisão de quem pediu a entrega.

- [ ] **Step 5: Commit**

```bash
git add scripts/prova-silencio-pessoal-turno-real.ts evidence/issue-10-qa-v4
git commit -m "🧪 [test] agente: prova do silêncio do turno no turno real, com o placar"
```

---

### Task 12: Fechamento

**Files:**
- Create: `.changes/ia-nao-responde-mensagem-pessoal.md`
- Modify: `docs/architecture/central-avisos.architecture.json`
- Create (evidência): `evidence/issue-10-qa-v4/ (capturas tela-N)`

- [ ] **Step 1: Fragmento de mudança**

Crie `.changes/ia-nao-responde-mensagem-pessoal.md`:

```markdown
---
impacto: capacidade_nova
secao: adicionado
titulo: O assistente pode ficar em silêncio quando a mensagem é pessoal, e volta a atender quando o assunto for trabalho
---

Quem usa o mesmo número para a vida e para o trabalho recebe mensagem da família, de amigo e de fornecedor no WhatsApp do negócio. Com a chave "Não responder mensagem pessoal" ligada na tela do agente, o assistente não responde essas mensagens e não diz que vai transferir ninguém. A conversa continua com ele: quando a mesma pessoa perguntar preço, horário ou serviço, ele atende.

Cada silêncio deixa um aviso na Central, com dois botões. "É cliente, responder" corrige o engano: o assistente responde a mensagem e não cala mais para aquele contato. "Marcar como contato pessoal" tira o contato da operação, e só gerente ou dono pode.

O acerto depende do modelo do agente. Na prova desta versão o modelo `google/crm-padrao` acertou todos os casos medidos; modelos menores erraram mais.

A chave nasce desligada. Nada a fazer na atualização.
```

Confira os valores aceitos de `secao` contra outro fragmento de capacidade nova (`grep -l "impacto: capacidade_nova" .changes/*.md | head -1 | xargs head -5`) e rode:

```bash
pnpm release:conferir
```

Esperado: o fragmento é aceito.

- [ ] **Step 2: Mapa de arquitetura**

Em `docs/architecture/central-avisos.architecture.json`, acrescente o nó do aviso novo e duas arestas, no formato dos nós `jev_pedido_de_humano` que o arquivo já tem (abra o arquivo e copie a forma de um nó e de uma aresta existentes): origem `lib/agent-engine/agent/silencio-pessoal.ts` (a ferramenta `stay_silent` abre o aviso) e saída `app/api/v1/conversations/[id]/client-confirmed/route.ts` (o botão fecha o aviso e muda o próximo turno). Depois:

```bash
pnpm vitest run tests/unit/mapas-de-arquitetura.test.ts
```

Esperado: PASS.

- [ ] **Step 3: Nada do desenho antigo sobrou**

```bash
git grep -n "handoff_silencioso_pessoal\|handoffSilenciosoPessoal\|silencio_intencional\|PASSAGEM_SILENCIOSA\|passagem-silenciosa" -- . ':!evidence' ':!docs'
git grep -n "mensagem_pessoal" -- lib app components hooks workers supabase
```

Esperado: a primeira busca vazia; a segunda só com `silencio_mensagem_pessoal` e `silencio_em_mensagem_pessoal`.

- [ ] **Step 4: A suíte inteira**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit > /tmp/vt.log 2>&1; echo "exit=$?"
grep -aE "Test Files|Tests |Errors " /tmp/vt.log | tail -3
grep -aE "^ *FAIL " /tmp/vt.log | sed 's/ > .*//' | sort | uniq -c
pnpm checar:colisao-de-migration
PATH=node_modules/.bin:$PATH CONFERENCIA_KIT_RELEASE=$(git describe --tags --abbrev=0) pnpm test:db
```

Esperado: typecheck e lint zerados; `exit=0`; nenhum `FAIL`; colisão de migration `OK`; `test:db` verde. O único vermelho conhecido que não é desta entrega é `lib/ai/dispatcher/rate-limit.test.ts` quando o Redis local está fora (ver `CLAUDE.md`). O `checar:colisao-de-migration` mede contra o repositório do produto; se o número escolhido na Tarefa 0 tiver sido tomado lá desde então, renomeie a migration para o próximo livre, troque o número nos comentários que o citam e rode o `test:db` de novo.

- [ ] **Step 5: Prova pela tela (DoD 12)**

Ambiente fresco estilo VPS (`supabase/baseline.sql` + `scripts/bootstrap-owner.ts`, `next build` + `next start`), Playwright dirigindo o browser:

1. Entrar como dono, abrir um agente, ligar "Não responder mensagem pessoal", salvar e publicar. Screenshot `tela-1-chave` (PNG em `evidence/issue-10-qa-v4/`).
2. Criar um rascunho novo a partir da versão publicada e conferir que a chave continua ligada.
3. Simular a mensagem da mãe (`scripts/e2e-followup-journey-helpers.ts simulate-inbound` e o evento `ai_agent.dispatch_requested`; o contato precisa de `ai_authorized_at`). Abrir a Central: o aviso aparece com os dois botões. Screenshot `tela-2-aviso`.
4. Clicar "É cliente, responder": a frase de confirmação aparece, o aviso sai dos abertos, e a conversa recebe a resposta do assistente. Screenshot `tela-3-cliente`.
5. Repetir o passo 3 com outro contato e clicar "Marcar como contato pessoal" como dono: o aviso fecha e a conversa sai da Inbox. Screenshot `tela-4-pessoal`.
6. Entrar como atendente: o botão "Marcar como contato pessoal" está desabilitado, com a frase "Só gerente ou dono marca um contato como pessoal."

Registre os casos em `docs/testing/user-journey-map.md`, na jornada do agente de IA.

- [ ] **Step 6: Commit e PR no fork**

```bash
git add -A
git commit -m "📝 [docs] agente: fragmento, mapa e evidência de tela do silêncio em mensagem pessoal"
git push -u origin silencio-em-mensagem-pessoal
gh pr create --repo resdasilva/DeskcommCRM --base main --head silencio-em-mensagem-pessoal \
  --title "✨ [feat] agente: mensagem pessoal cala só o turno, sem passar a conversa" \
  --body-file - <<'EOF'
Substitui o PR 11 (passagem silenciosa), que pode ser fechado sem mesclar: aqui a mensagem pessoal cala só o turno.

- Spec: `docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md`
- Destino (DoD 18): núcleo. Chave desligada por padrão; desligada, nada muda.
- Prova com o modelo real: `evidence/issue-10-qa-v4/placar.txt`
- Prova pela tela: `evidence/issue-10-qa-v4/ (capturas tela-N)`

O que muda: a ferramenta `stay_silent` no lugar de `mensagem_pessoal` na passagem; nada de `force_human`; aviso próprio na Central com "É cliente, responder" e "Marcar como contato pessoal"; chave na tela do agente.

Banco de teste local: precisa do ajuste da Tarefa 11, Step 1, do plano.
EOF
```

Confira que o PR abriu no fork: a URL devolvida começa com `https://github.com/resdasilva/DeskcommCRM/pull/`.

---

## Cobertura da spec

| Spec | Tarefa |
|---|---|
| Base atualizada; a passagem fica como em `origin/main` | 0, 1 |
| §3.1 chave por versão, na trava, na tela | 2, 3, 10 |
| §3.2 `stay_silent`: opt-out, já falou, cala, nunca grava | 4, 6 |
| §3.3 bloco no prompt | 4, 6 |
| §3.4 turno calado não é turno mudo | 5, 6 |
| §3.5 aviso: tipo, um por conversa, fecha sozinho, sem WhatsApp | 2, 4, 7 |
| §3.6 "É cliente, responder" | 3, 8, 9 |
| §3.7 "Marcar como contato pessoal" | 2, 9 |
| §3.8 prévia | 6 |
| §4 banco e banco de teste local | 2, 11 |
| §6 prova e régua | 11 |
| §7 testes e Definition of Done | todas; 12 |
