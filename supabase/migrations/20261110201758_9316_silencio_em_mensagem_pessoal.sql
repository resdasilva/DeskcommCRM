-- manifest: **Silêncio do turno quando a mensagem é pessoal (issue #10).** `ai_agent_versions.silencio_em_mensagem_pessoal boolean not null default false` (desligada por padrão, coberta pela trava de imutabilidade da versão publicada); `contacts.cliente_confirmado_em` (quem alguém confirmou como cliente não é calado de novo, e a marca some quando o contato vira pessoal); `'silencio_mensagem_pessoal'` em `agent_inbox_items_kind_check`, com no máximo um aviso aberto por conversa e dois gatilhos que o fecham sozinho. Par de `lib/agent-engine/agent/silencio-pessoal.ts`.
-- 9316 — O SILÊNCIO DO TURNO QUANDO A MENSAGEM É PESSOAL
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
    or new.silencio_em_mensagem_pessoal is distinct from old.silencio_em_mensagem_pessoal
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.image_vision_enabled   is distinct from old.image_vision_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.skill_names            is distinct from old.skill_names
    or new.proposal_ai_draft_enabled is distinct from old.proposal_ai_draft_enabled
    or new.inbound_debounce_ms    is distinct from old.inbound_debounce_ms
    or new.reply_min_interval_ms  is distinct from old.reply_min_interval_ms
    or new.voz_enabled            is distinct from old.voz_enabled
    or new.voz_quando             is distinct from old.voz_quando
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
revoke all on function public.fn_contato_pessoal_perde_cliente_confirmado() from public, anon, authenticated;

drop trigger if exists trg_contato_pessoal_perde_cliente_confirmado on public.contacts;
create trigger trg_contato_pessoal_perde_cliente_confirmado
  before update of is_personal on public.contacts
  for each row when (new.is_personal and old.is_personal is distinct from true)
  execute function public.fn_contato_pessoal_perde_cliente_confirmado();

-- O vocabulário inteiro, igual ao bloco ÚNICO do baseline
-- (tests/unit/kind-check-migration-x-baseline.test.ts compara valor a valor).
alter table public.agent_inbox_items
  drop constraint if exists agent_inbox_items_kind_check;
alter table public.agent_inbox_items
  add constraint agent_inbox_items_kind_check check (kind in (
    'appointment_outcome_required',
    'appointment_recovery_review',
    'qr_rescan',
    'routing_unassigned',
    'job_dead',
    'event_dead',
    'budget_exceeded',
    'handoff',
    'promotion_review',
    'judge_unaligned',
    'followup_dead',
    'snooze_expired',
    'next_action_ambiguous',
    'risk_backlog_seeded',
    'reactivation_expired',
    'capabilities_missing',
    'message_send_stuck',
    'midia_nao_lida',
    'channel_template_review',
    'channel_number_alert',
    'promise_unfulfilled',
    'contact_proposal_expired',
    'budget_warning',
    'conhecimento_nao_indexado',
    'voice_call_missed',
    'case_stale',
    'aviso_de_caso_nao_entregue',
    'followup_sem_agente',
    'canal_mudo_sem_numero',
    'proposal_expired_notice',
    'proposal_acceptance_rate_drop',
    'proposal_promised_not_created',
    'proposta_travada',
    'proposta_pronta_para_revisao',
    'org_reativada',
    'jev_pedido_de_humano',
    'jev_parar_de_receber',
    'canal_pausado',
    'cobranca',
    'email_de_login_trocado',
    'task_due',
    'task_overdue',
    'recuperacao_da_queda',
    'cliente_sem_resposta_na_queda',
    'assinatura_desconectada',
    'silencio_mensagem_pessoal',
    'other'
  ));

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
