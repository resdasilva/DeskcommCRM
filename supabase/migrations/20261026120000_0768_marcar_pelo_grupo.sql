-- manifest: marcar pelo grupo do WhatsApp — `config_aviso_de_agendamento` ganha `marcar_pelo_grupo` (desligado por padrão) e `numeros_autorizados` (E.164, sem repetição), escritos só por `fn_definir_aviso_de_agendamento` (dois parâmetros novos com default `null` = manter); só tela e dado, nada é lido do grupo ainda (issue #4).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0768 — Ligar a marcação pelo grupo e dizer quem pode marcar.
--
-- O dono quer que a equipe marque horário escrevendo no grupo da empresa que
-- já recebe o aviso de agendamento (0767). Antes de qualquer leitura do grupo,
-- é preciso o interruptor e a lista de quem pode: sem ela, qualquer pessoa do
-- grupo mexeria na agenda. Esta migration só guarda a decisão.
--
-- DIRC: as duas colunas moram na MESMA linha do aviso — o grupo é o dele, e a
-- autorização não existe sem o grupo. Os números são da EQUIPE, não de
-- contatos, por isso a cascata de LGPD não os alcança; a auditoria guarda só a
-- contagem.
--
-- A regra: sem grupo, `marcar_pelo_grupo` é sempre `false` (pedir `true` sem
-- grupo é recusado; tirar o grupo desliga sozinho e preserva a lista). Número
-- fora de E.164 ou repetido é recusado. RLS e grants da tabela não mudam: a
-- leitura continua `admin`, e a escrita continua só pela função.
--
-- Reaplicação: `add column if not exists`, `drop function if exists` da
-- assinatura anterior + `create or replace`.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.config_aviso_de_agendamento
  add column if not exists marcar_pelo_grupo boolean not null default false;
alter table public.config_aviso_de_agendamento
  add column if not exists numeros_autorizados text[] not null default '{}'::text[];

-- A assinatura muda (dois parâmetros no fim, com default): a de sete sai,
-- senão ficariam duas portas de escrita para a mesma tabela.
drop function if exists public.fn_definir_aviso_de_agendamento(uuid,boolean,uuid,text,boolean,boolean,text);
create or replace function public.fn_definir_aviso_de_agendamento(
  p_org uuid,
  p_usa_numero_do_aviso_de_caso boolean,
  p_channel uuid,
  p_telefone text,
  p_ligado boolean,
  p_confirma_contato boolean default false,
  p_grupo text default null,
  p_marcar_pelo_grupo boolean default null,
  p_numeros_autorizados text[] default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antes public.config_aviso_de_agendamento;
  v_arch timestamptz;
  v_digitos text;
  v_variantes text[];
  v_usa boolean := coalesce(p_usa_numero_do_aviso_de_caso, true);
  v_channel uuid := p_channel;
  v_telefone text := nullif(btrim(coalesce(p_telefone, '')), '');
  v_grupo text := nullif(btrim(coalesce(p_grupo, '')), '');
  v_marcar boolean;
  v_autorizados text[];
begin
  if auth.uid() is null or p_org is null
     or not public.fn_role_at_least(p_org, 'admin')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'aviso_de_agendamento_forbidden' using errcode = '42501';
  end if;
  if not public.fn_session_mfa_proven() then
    raise exception 'aviso_de_agendamento_mfa_required' using errcode = '42501';
  end if;

  if v_usa then
    -- O número do aviso de caso já passou pelas guardas da 0292 quando foi
    -- salvo. Aqui só se exige que ele EXISTA, senão a tela diria "usando o
    -- número do aviso de caso" sobre um número que não há.
    if not exists (
         select 1 from public.config_aviso_de_caso c
          where c.organization_id = p_org
            and c.channel_session_id is not null) then
      raise exception 'aviso_de_agendamento_sem_aviso_de_caso' using errcode = '22023';
    end if;
    v_channel := null;
    v_telefone := null;
  else
    if v_telefone is null or v_telefone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'aviso_de_agendamento_telefone_invalido' using errcode = '22023';
    end if;
    if v_channel is null then
      raise exception 'aviso_de_agendamento_canal_invalido' using errcode = '22023';
    end if;
    select archived_at into v_arch
      from public.channel_sessions
     where id = v_channel and organization_id = p_org;
    if not found or v_arch is not null then
      raise exception 'aviso_de_agendamento_canal_invalido' using errcode = '22023';
    end if;

    -- As duas grafias do nono dígito — a MESMA regra da 0292 e de
    -- `lib/channels/phone-variants.ts`.
    v_digitos := regexp_replace(v_telefone, '\D', '', 'g');
    v_variantes := array[v_digitos];
    if v_digitos like '55%' then
      if length(v_digitos) = 13
         and substring(v_digitos from 5 for 1) = '9'
         and substring(v_digitos from 6 for 1) between '6' and '9' then
        v_variantes := v_variantes || (substring(v_digitos from 1 for 4) || substring(v_digitos from 6));
      elsif length(v_digitos) = 12
         and substring(v_digitos from 5 for 1) between '6' and '9' then
        v_variantes := v_variantes || (substring(v_digitos from 1 for 4) || '9' || substring(v_digitos from 5));
      end if;
    end if;

    -- O número de destino NÃO pode ser de uma conexão da própria organização:
    -- é o laço robô-com-robô (a conexão avisa o número oficial, o agente dele
    -- responde, e as duas pontas se alimentam).
    if exists (
         select 1 from public.channel_sessions s
          where s.organization_id = p_org
            and s.archived_at is null
            and s.phone_number is not null
            and regexp_replace(s.phone_number, '\D', '', 'g') = any (v_variantes)) then
      raise exception 'aviso_de_agendamento_numero_da_propria_org' using errcode = '22023';
    end if;

    -- O número de aviso vira INTERNO (o que chega dele não vira atendimento).
    -- Se ele já é um cliente, isso não pode acontecer por engano.
    if not coalesce(p_confirma_contato, false) and exists (
         select 1 from public.contacts c
          where c.organization_id = p_org
            and c.phone_number is not null
            and regexp_replace(c.phone_number, '\D', '', 'g') = any (v_variantes)) then
      raise exception 'aviso_de_agendamento_numero_de_cliente' using errcode = '22023';
    end if;
  end if;

  -- O grupo é destino EXTRA, da mesma conexão que envia. Só a forma é
  -- conferida aqui: se o número saiu do grupo, o envio cai só para ele.
  if v_grupo is not null and v_grupo !~ '^[0-9-]+@g\.us$' then
    raise exception 'aviso_de_agendamento_grupo_invalido' using errcode = '22023';
  end if;

  select * into v_antes from public.config_aviso_de_agendamento where organization_id = p_org;

  -- MARCAR PELO GRUPO (0768). `null` nos dois parâmetros = manter o que está
  -- salvo: quem chama sem eles (a versão anterior da tela) não apaga a lista.
  if p_marcar_pelo_grupo is true and v_grupo is null then
    raise exception 'aviso_de_agendamento_marcar_sem_grupo' using errcode = '22023';
  end if;
  -- Sem grupo não há onde marcar: a chave cai sozinha, e a lista fica guardada.
  v_marcar := v_grupo is not null
              and coalesce(p_marcar_pelo_grupo, v_antes.marcar_pelo_grupo, false);
  v_autorizados := coalesce(p_numeros_autorizados, v_antes.numeros_autorizados, '{}'::text[]);
  -- A mesma forma E.164 do número do aviso; a tela já manda normalizado.
  if exists (select 1 from unnest(v_autorizados) n
              where n is null or n !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception 'aviso_de_agendamento_numero_autorizado_invalido' using errcode = '22023';
  end if;
  if (select count(distinct n) from unnest(v_autorizados) n) <> cardinality(v_autorizados) then
    raise exception 'aviso_de_agendamento_numero_autorizado_repetido' using errcode = '22023';
  end if;

  insert into public.config_aviso_de_agendamento
    (organization_id, usa_numero_do_aviso_de_caso, channel_session_id, telefone_destino, grupo_destino,
     marcar_pelo_grupo, numeros_autorizados, ligado, criado_por, atualizado_por)
  values
    (p_org, v_usa, v_channel, v_telefone, v_grupo,
     v_marcar, v_autorizados, coalesce(p_ligado, false), auth.uid(), auth.uid())
  on conflict (organization_id) do update
    set usa_numero_do_aviso_de_caso = excluded.usa_numero_do_aviso_de_caso,
        channel_session_id          = excluded.channel_session_id,
        telefone_destino            = excluded.telefone_destino,
        grupo_destino               = excluded.grupo_destino,
        marcar_pelo_grupo           = excluded.marcar_pelo_grupo,
        numeros_autorizados         = excluded.numeros_autorizados,
        ligado                      = excluded.ligado,
        atualizado_por              = auth.uid(),
        updated_at                  = now();

  return jsonb_build_object(
    'trocou_numero', (v_antes.telefone_destino is distinct from v_telefone
                      or v_antes.usa_numero_do_aviso_de_caso is distinct from v_usa),
    'antes_ligado',  coalesce(v_antes.ligado, false)
  );
end;
$$;
-- AS DUAS ORIGENS DE EXECUTE (item 9 da doutrina de migrations).
revoke all     on function public.fn_definir_aviso_de_agendamento(uuid,boolean,uuid,text,boolean,boolean,text,boolean,text[]) from public, anon;
grant  execute on function public.fn_definir_aviso_de_agendamento(uuid,boolean,uuid,text,boolean,boolean,text,boolean,text[]) to authenticated;

notify pgrst, 'reload schema';
