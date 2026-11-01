-- manifest: **Passagem silenciosa quando a mensagem é pessoal (issue #10).** Coluna nova `handoff_silencioso_pessoal boolean not null default false` em `ai_agent_versions` (desligada por padrão: quem não mexer fica como hoje), coberta pela trava de imutabilidade da versão publicada; o CHECK de `passagens_de_atendimento.motivo_codigo` aceita `mensagem_pessoal` e o de `aviso_motivo_codigo` aceita `silencio_intencional` — o cliente não foi avisado por decisão, e a tela não acusa falha de envio. Par de `MOTIVOS_DA_PASSAGEM`/`MOTIVOS_DO_AVISO` em `lib/escalacao/passagem.ts`.
-- 9101 — A PASSAGEM SILENCIOSA QUANDO A MENSAGEM É PESSOAL
--
-- Um familiar, amigo ou fornecedor escreve para o número do negócio e o
-- agente o trata como cliente. Quando o agente passa a conversa para a
-- equipe, o cliente SEMPRE recebe uma mensagem — e "vou te passar para um
-- atendente" dito à mãe do dono é constrangedor. Esta migration traz as três
-- peças de banco do comportamento:
--
--   1. A CHAVE, POR VERSÃO DO AGENTE, DESLIGADA POR PADRÃO. Mora na versão
--      pelo mesmo motivo de `handoff_legal_enabled` (0616): a versão
--      publicada é quem atende, e é imutável — mudar é publicar outra. A
--      coluna entra na trava `fn_ai_agent_version_content_immutable` (a
--      ÚLTIMA definição, a da 0616, com `set search_path = ''`); sem isso
--      `tests/unit/trigger-imutavel-cobre-todas-as-colunas-de-conteudo.test.ts`
--      reprova.
--   2. O MOTIVO `mensagem_pessoal` na passagem: o que vira frase no cartão de
--      quem assume.
--   3. O DESFECHO `silencio_intencional` no aviso: "o cliente não foi
--      avisado" deixa de ser sempre falha. Sem ele a passagem gravaria
--      `cliente_avisado = false` sem motivo, e a tela diria que a pessoa está
--      esperando sem saber.
--
-- Só alarga vocabulário e acrescenta coluna com default: nenhuma linha
-- existente viola os CHECKs novos. Idempotente (`add column if not exists`,
-- drop/add das constraints, `create or replace`, `drop trigger if exists`).
-- No `baseline.sql` os dois valores entram nos blocos ÚNICOS das constraints
-- (e nos CHECKs inline do `create table`), e o apêndice traz a coluna e a
-- trava.

alter table public.ai_agent_versions
  add column if not exists handoff_silencioso_pessoal boolean not null default false;

comment on column public.ai_agent_versions.handoff_silencioso_pessoal is
  'Quando a mensagem é pessoal para o dono ou a equipe (e não um atendimento), o agente passa a conversa sem dizer nada ao contato? Padrão DESLIGADO; só admin muda, e a mudança é publicar uma versão nova do agente. Opt-out continua vencendo.';

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_motivo_codigo_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_motivo_codigo_check
  check (motivo_codigo in (
    'requested_human','suspected_optout','orcamento_de_ia','low_sentiment',
    'low_confidence','critical_stage','legal_mention','refund_mention',
    'caso_escalado','verificacao_manual','mensagem_pessoal'));

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_aviso_motivo_codigo_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_aviso_motivo_codigo_check
  check (aviso_motivo_codigo is null or aviso_motivo_codigo in (
    'na_fila_canal_fora','falhou_no_envio','sem_telefone',
    'pre_go_live','canal_arquivado','fora_da_janela','silencio_intencional'));

create or replace function fn_ai_agent_version_content_immutable() returns trigger
-- search_path fixo na PRÓPRIA definição: um create or replace sem a cláusula
-- apaga o alter function ... set search_path da 0521 (invariante
-- tests/invariants/avisos-do-security-advisor.test.ts).
language plpgsql set search_path = '' as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.handoff_legal_enabled  is distinct from old.handoff_legal_enabled
    or new.handoff_silencioso_pessoal is distinct from old.handoff_silencioso_pessoal
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.proposal_ai_draft_enabled is distinct from old.proposal_ai_draft_enabled
    or new.inbound_debounce_ms    is distinct from old.inbound_debounce_ms
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_ai_agent_versions_content_immutable on public.ai_agent_versions;
create trigger trg_ai_agent_versions_content_immutable
  before update on public.ai_agent_versions
  for each row execute function fn_ai_agent_version_content_immutable();

notify pgrst, 'reload schema';
