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
