/**
 * PROVA NO TURNO REAL DE WHATSAPP da passagem silenciosa (issue #10, AC de
 * 19 de 20).
 *
 * Por que não basta a prova da tela "Testar agente"
 * (`prova-passagem-silenciosa-modelo-real.ts`): o dono mediu 0 de 5 no turno de
 * WhatsApp de verdade, com o histórico da conversa, e a prévia mediu 14 de 15
 * num caminho diferente — sem histórico, em modo prévia, com o bloco "MODO
 * PRÉVIA" no prompt. Este script roda o MESMO handler que o worker registra
 * para `inbound_turn` (`createInboundTurnHandler`, dentro de `withServiceJob`,
 * com um job `running` de verdade em `job_queue`), na conversa real do dono,
 * com o histórico que ela já tem.
 *
 * O que é trocado, e só isto:
 *   - o TRANSPORTE: `deps.channel` é um adapter que ANOTA cada envio em vez de
 *     entregar ao WAHA. Todo o resto da cadeia (prompt, histórico, ferramentas,
 *     gates, a passagem gravada no banco) é o caminho real. Entregar ao WAHA
 *     mandaria 20 mensagens ao número de teste, e o que se mede é o que o
 *     agente TENTOU enviar, que o adapter vê inteiro;
 *   - `sleep` vira no-op (o atraso humano e o throttle só esperam).
 *
 * Para cada tentativa a conversa volta ao estado de antes, e a mensagem
 * inserida sai: as 20 tentativas veem o MESMO histórico, que é o do teste do
 * dono. Os eventos que a tentativa emitiu (o aviso da Central inclusive) são
 * contados como evidência e marcados `done`, para que nenhum worker os entregue
 * depois à equipe 20 vezes.
 *
 * Uso (no worktree, com o ambiente do Supabase LOCAL no processo):
 *   ENV_FILE=<.env.local do ambiente local> CONVERSAS=<uuid>[,<uuid>] N=10 \
 *     FRASE=mae|mae-longa|comercial pnpm exec tsx scripts/prova-passagem-silenciosa-turno-real.ts
 */
import { randomUUID } from "node:crypto";

if (process.env.ENV_FILE) process.loadEnvFile(process.env.ENV_FILE);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(`recusado: o Supabase não é local (${new URL(url || "http://x").host})`);
}

const FRASES: Record<string, string> = {
  mae: "Oi filho, é a mãe! Vem almoçar domingo?",
  // o texto exato que o dono mandou no teste de 01/11/2026
  "mae-longa":
    "Oi filho, é a mãe! Você vem almoçar aqui no domingo? Vou fazer aquela lasanha. Beijo",
  comercial: "Oi, quero saber o preço da consulta",
};

const WORKER = "prova-issue-10";

async function main(): Promise<void> {
  const { createInboundTurnHandler } = await import("@/lib/agent-engine/agent/inbound-turn");
  const { requestTurnDeps } = await import("@/lib/agent-engine/agent/request-deps");
  const { getRequestPool } = await import("@/lib/agent-engine/db/request-pool");
  const { withServiceJob, readCurrentServiceBoundary } =
    await import("@/lib/atendimento/fronteira-server");
  const pool = getRequestPool();

  const fraseNome = process.env.FRASE ?? "mae";
  const texto = FRASES[fraseNome];
  if (!texto) throw new Error(`frase desconhecida: ${fraseNome}`);
  const conversas = (process.env.CONVERSAS ?? "").split(",").filter(Boolean);
  if (conversas.length === 0) throw new Error("CONVERSAS vazio");
  const n = Number(process.env.N ?? 10);

  for (const conversationId of conversas) {
    const { rows: cr } = await pool.query(
      `select c.organization_id, c.contact_id, c.channel_session_id, c.status, c.bot_silenced_until,
              c.last_handoff_at, c.last_handoff_reason, c.active_ai_agent_id, c.active_intent,
              c.active_agent_set_at, c.metadata, k.force_human, k.ai_authorized_at, k.ai_authorized_reason
         from conversations c join contacts k on k.id = c.contact_id
        where c.id = $1`,
      [conversationId],
    );
    const antes = cr[0];
    if (!antes) throw new Error(`conversa não encontrada: ${conversationId}`);
    const { rows: hist } = await pool.query(
      `select direction, status, body from messages where conversation_id = $1 order by created_at`,
      [conversationId],
    );
    console.info(JSON.stringify({ conversa: conversationId, historico: hist }));

    const restaurar = async (): Promise<void> => {
      await pool.query(
        `update contacts set force_human = $2, ai_authorized_at = $3, ai_authorized_reason = $4
          where id = $1`,
        [antes.contact_id, antes.force_human, antes.ai_authorized_at, antes.ai_authorized_reason],
      );
      await pool.query(
        `update conversations set status = $2, bot_silenced_until = $3, last_handoff_at = $4,
                last_handoff_reason = $5, active_ai_agent_id = $6, active_intent = $7,
                active_agent_set_at = $8, metadata = $9
          where id = $1`,
        [
          conversationId,
          antes.status,
          antes.bot_silenced_until,
          antes.last_handoff_at,
          antes.last_handoff_reason,
          antes.active_ai_agent_id,
          antes.active_intent,
          antes.active_agent_set_at,
          antes.metadata,
        ],
      );
    };

    for (let i = 1; i <= n; i++) {
      await restaurar();
      // Com o gate 'allowlist' o contato precisa estar autorizado para a IA
      // atender — é o que o dono faz ao testar. Volta ao valor de antes no fim.
      if (antes.ai_authorized_at === null) {
        await pool.query(
          `update contacts set ai_authorized_at = now(), ai_authorized_reason = 'prova issue #10'
            where id = $1`,
          [antes.contact_id],
        );
      }
      const t0 = (await pool.query<{ t: string }>(`select now()::text as t`)).rows[0]!.t;
      const messageId = randomUUID();
      // A fronteira do atendimento, como o drain grava no payload do job de verdade.
      const atual = await readCurrentServiceBoundary(pool, antes.organization_id, conversationId);
      if (!atual) throw new Error("conversa sem fronteira de atendimento");
      const fronteira = {
        organization_id: atual.organization_id,
        contact_id: atual.contact_id,
        conversation_id: atual.conversation_id,
        service_revision: atual.service_revision,
        demanda_id: atual.demanda_id,
        demanda_revision: atual.demanda_revision,
      };
      // Sem gatilhos: a mensagem não pode acordar o drain de um worker de verdade.
      const cli = await pool.connect();
      try {
        await cli.query("begin");
        await cli.query(`set local session_replication_role = replica`);
        await cli.query(
          `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                                 type, direction, status, body, sent_via, service_revision,
                                 demanda_id, demanda_revision)
           values ($1, $2, $3, $4, $5, 'text', 'inbound', 'received', $6, 'crm', $7, $8, $9)`,
          [
            messageId,
            antes.organization_id,
            conversationId,
            antes.channel_session_id,
            antes.contact_id,
            texto,
            fronteira.service_revision,
            fronteira.demanda_id,
            fronteira.demanda_revision,
          ],
        );
        await cli.query("commit");
      } finally {
        cli.release();
      }
      const { rows: jr } = await pool.query(
        `insert into job_queue (organization_id, contact_id, kind, payload, status, locked_by, locked_at, attempts)
         values ($1, $2, 'inbound_turn', $3, 'running', $4, now(), 1)
         returning *, locked_at::text as claim_acquired_at`,
        [
          antes.organization_id,
          antes.contact_id,
          {
            conversation_id: conversationId,
            contact_id: antes.contact_id,
            channel_session_id: antes.channel_session_id,
            inbound_message_id: messageId,
            crm_event_id: randomUUID(),
            service_boundary: fronteira,
          },
          WORKER,
        ],
      );
      const job = jr[0];

      const enviados: string[] = [];
      const base = requestTurnDeps();
      const deps = {
        ...base,
        sleep: async () => {},
        channel: () => ({
          channel: "prova_issue_10",
          send: async (input: { body: string; jobId: string; seq: number }) => {
            enviados.push(input.body);
            return {
              kind: "sent" as const,
              idempotencyKey: `${input.jobId}:${input.seq}`,
              messageId: randomUUID(),
            };
          },
          sessionHealth: async () => ({ healthy: true, status: "WORKING", since: null }),
          capabilities: () => ({ freeformAnytime: true, serviceWindowHours: null }),
          costPerMessage: () => ({ perMessageUsdCents: 0, model: "flat" as const }),
        }),
      };
      const ms0 = Date.now();
      let erro: string | null = null;
      try {
        const handler = createInboundTurnHandler(deps as never);
        await withServiceJob(pool, job, () => handler(job, pool, { workerId: WORKER }));
      } catch (e) {
        erro = String(e).slice(0, 300);
      }
      await pool.query(`update job_queue set status = 'done', locked_by = null where id = $1`, [
        job.id,
      ]);

      const { rows: pass } = await pool.query(
        `select to_jsonb(p) as p from passagens_de_atendimento p
          where p.conversation_id = $1 and p.criado_em >= $2::timestamptz`,
        [conversationId, t0],
      );
      const { rows: tr } = await pool.query(
        `select status, model, ferramentas, abort_reason, error_message from agent_turn_traces
          where job_id = $1`,
        [job.id],
      );
      const { rows: ev } = await pool.query(
        `update event_log set status = 'done', last_error = 'prova issue #10: não entregue de propósito'
          where organization_id = $1 and created_at >= $2::timestamptz and status = 'pending'
          returning event_type`,
        [antes.organization_id, t0],
      );
      const { rows: fh } = await pool.query(`select force_human from contacts where id = $1`, [
        antes.contact_id,
      ]);

      const passagem = pass.map((r) => r.p as Record<string, unknown>);
      console.info(
        JSON.stringify({
          frase: fraseNome,
          conversa: conversationId,
          tentativa: i,
          ms: Date.now() - ms0,
          mensagens_ao_contato: enviados,
          passagem: passagem.map((p) => ({
            motivo: p.motivo_codigo,
            cliente_avisado: p.cliente_avisado,
            aviso: p.aviso_motivo_codigo,
          })),
          force_human_depois: fh[0]?.force_human,
          traco: tr[0] ?? null,
          eventos: ev.map((e) => e.event_type),
          erro,
        }),
      );

      // A mensagem inserida sai: a próxima tentativa vê o mesmo histórico.
      const c2 = await pool.connect();
      try {
        await c2.query("begin");
        await c2.query(`set local session_replication_role = replica`);
        await c2.query(`delete from messages where id = $1`, [messageId]);
        await c2.query("commit");
      } finally {
        c2.release();
      }
    }
    await restaurar();
  }
  await pool.end();
}

void main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
