/**
 * Adapter que pluga `atendePedidoDeAgendaPeloGrupo`
 * (`./pedido-pelo-grupo-atendimento.ts`) no dispatcher do `event_log`, com as
 * portas de produção. A regra fica pura e testável; aqui só há ligação.
 *
 * ⚠️ A AGENDA É A DAS FERRAMENTAS DO AGENTE. `marcar` chama o handler de
 * `crm_find_and_book_appointment`, `cancelar` o de `crm_cancel_appointment`, e
 * `remarcar` faz a mesma conferência de horário livre que a consulta-e-marca
 * faz antes de chamar `crm_reschedule_appointment`. Uma segunda regra de
 * horário livre aqui daria ao grupo e ao agente respostas diferentes sobre o
 * mesmo horário. As ferramentas auditam a mutação (`agenda.appointment_*`).
 *
 * ⚠️ TODA consulta filtra `organization_id` À MÃO: o client é o de service
 * role. A organização vem da linha do `event_log`, nunca do texto.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { criarPacingDoCanal } from "@/lib/agent-engine/pacing/ledger-supabase";
import { createContactHandler } from "@/app/api/v1/contacts/_handler";
import { comIdempotencia } from "@/lib/api/idempotency";
import { createSupabaseAvisoDb } from "@/lib/escalacao/aviso-ao-suporte";
import { criarTransporteDoAviso } from "@/lib/escalacao/aviso-ao-suporte.handler";
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { origemDoDreno } from "@/lib/event-log/origem-do-dreno";
import { logger } from "@/lib/logger";
import type { McpContext } from "@/lib/mcp/types";
import { resolveUserNames } from "@/lib/mcp/tools/_users";
import {
  crmCancelAppointment,
  crmFindAndBookAppointment,
  crmRescheduleAppointment,
} from "@/lib/mcp/tools/agendamento";
import { contactCreateSchema } from "@/lib/schemas/contacts";
import { createAdminClient } from "@/lib/supabase/admin";
import { rotuloLocal } from "@/lib/tempo/agora";
import { criarIngestDeGrupoDb } from "@/lib/grupos/ingest";

import { createSupabaseAvisoDeAgendamentoDb } from "./aviso-de-agendamento";
import { horariosLivresDaOrg, listaTiposDeAtendimento } from "./consulta";
import { diaLocalISO } from "./fuso";
import {
  EVENTO_DO_PEDIDO_PELO_GRUPO,
  atendePedidoDeAgendaPeloGrupo,
  horaNoFuso,
  horaPadrao,
  type AgendaDoPedido,
  type AgendamentoDoCliente,
  type DecisaoDoPedido,
  type DesfechoDaAgenda,
  type DesfechoDoEnvio,
  type PedidoPeloGrupoDb,
  type PedidoPeloGrupoDeps,
} from "./pedido-pelo-grupo-atendimento";
import { lerPedidoComModelo } from "./pedido-pelo-grupo-extracao";
import { ENTIDADE_DO_AGENDAMENTO } from "./tipos";

export const PEDIDO_PELO_GRUPO_HANDLER_KEY = "agenda-pedido-pelo-grupo.v1";

/** O recibo não é de rota HTTP: o "endpoint" nomeia o evento que ele protege. */
const ENDPOINT_DO_RECIBO = `event:${EVENTO_DO_PEDIDO_PELO_GRUPO}`;

/** Quem age na agenda: o atendimento do grupo, nunca uma pessoa (nada de FK de usuário). */
function contextoDaFerramenta(admin: SupabaseClient, org: string, chave?: string): McpContext {
  return {
    organizationId: org,
    role: "ai_operator",
    actor: { type: "ai_agent", id: "agenda-pelo-grupo", role: "ai_operator" },
    apiTokenId: "agenda-pelo-grupo",
    requestId: randomUUID(),
    supabase: admin,
    ...(chave ? { idempotencyKey: chave } : {}),
  };
}

// ── Leitura dos retornos das ferramentas (puras, testadas) ───────────────────

type Registro = Record<string, unknown>;
const ehRegistro = (v: unknown): v is Registro => typeof v === "object" && v !== null && !Array.isArray(v);

/** Os horários livres de uma resposta de consulta, como "14:00". */
function alternativasDe(r: Registro): string[] {
  const fuso = typeof r.fuso_da_regra === "string" ? r.fuso_da_regra : null;
  const horarios = Array.isArray(r.horarios) ? r.horarios : [];
  return horarios.flatMap((h) =>
    ehRegistro(h) && typeof h.inicio === "string" && fuso ? [horaNoFuso(new Date(h.inicio), fuso)] : [],
  );
}

/**
 * O retorno de uma ferramenta de escrita de agenda → `DesfechoDaAgenda`.
 * `chaveDoSucesso` é o booleano da ferramenta (`marcado`, `remarcado`, `cancelado`).
 */
export function desfechoDaFerramenta(
  r: unknown,
  chaveDoSucesso: "marcado" | "remarcado" | "cancelado",
  nomes: { servico: string | null; profissional: (userId: string | null) => string | null },
): DesfechoDaAgenda {
  if (!ehRegistro(r)) return { ok: false, motivo: "resposta_ilegivel", mensagem: "a agenda não respondeu." };
  const c = ehRegistro(r.compromisso) ? r.compromisso : null;
  if (r[chaveDoSucesso] === true && c && typeof c.id === "string" && typeof c.starts_at === "string") {
    const dono = typeof c.owner_user_id === "string" ? c.owner_user_id : null;
    return {
      ok: true,
      appointmentId: c.id,
      inicio: new Date(c.starts_at),
      fuso: typeof c.time_zone === "string" ? c.time_zone : "America/Sao_Paulo",
      servico: nomes.servico ?? (typeof c.title === "string" ? c.title : null),
      profissional: nomes.profissional(dono),
      aguardaConfirmacao: r.aguarda_confirmacao === true || c.status === "pending",
    };
  }
  const motivo = typeof r.motivo === "string" ? r.motivo : "recusado";
  if (motivo === "horario_indisponivel" || motivo === "agenda_horario_indisponivel") {
    return { ok: false, motivo: "horario_indisponivel", alternativas: alternativasDe(r) };
  }
  const mensagem = typeof r.mensagem === "string" ? r.mensagem : "a agenda recusou o pedido.";
  return { ok: false, motivo, mensagem };
}

// ── Portas de produção ───────────────────────────────────────────────────────

async function nomesDosProfissionais(admin: SupabaseClient, org: string): Promise<Array<{ id: string; nome: string }>> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", org)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  const nomes = await resolveUserNames(admin, ids);
  return ids.flatMap((id) => {
    const nome = nomes.get(id);
    return nome ? [{ id, nome }] : [];
  });
}

export function criarAgendaDoPedido(admin: SupabaseClient, agora: () => Date): AgendaDoPedido {
  async function nomeDe(org: string, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    return (await resolveUserNames(admin, [userId])).get(userId) ?? null;
  }
  async function comNomes(org: string, r: unknown, chave: "marcado" | "remarcado" | "cancelado", servico: string | null) {
    const c = ehRegistro(r) && ehRegistro(r.compromisso) ? r.compromisso : null;
    const dono = c && typeof c.owner_user_id === "string" ? c.owner_user_id : null;
    const nome = await nomeDe(org, dono);
    return desfechoDaFerramenta(r, chave, { servico, profissional: () => nome });
  }

  return {
    async marcar(org, a) {
      const ctx = contextoDaFerramenta(admin, org, a.chave);
      const r = await crmFindAndBookAppointment.handler(
        {
          event_type_slug: a.servicoSlug,
          dia: a.dia,
          horario: a.hora,
          contact_id: a.contactId,
          ...(a.profissionalId ? { owner_user_id: a.profissionalId } : {}),
        },
        ctx,
      );
      const tipos = await listaTiposDeAtendimento(admin, org);
      const servico = tipos.ok ? (tipos.tipos.find((t) => t.slug === a.servicoSlug)?.nome ?? null) : null;
      return comNomes(org, r, "marcado", servico);
    },

    async remarcar(org, { agendamento, dia, hora }) {
      if (!agendamento.servicoSlug) {
        return { ok: false, motivo: "sem_servico", mensagem: "esse agendamento não tem serviço; remarque pela agenda." };
      }
      // A MESMA conferência da consulta-e-marca: o horário só é aceito se a
      // lista de livres o tem, e o instante vem do slot, não do texto.
      const inicioDoDiaUtc = new Date(`${dia}T00:00:00.000Z`);
      const consulta = await horariosLivresDaOrg(admin, org, {
        eventTypeSlug: agendamento.servicoSlug,
        ownerUserId: agendamento.profissionalId,
        de: new Date(inicioDoDiaUtc.getTime() - 14 * 60 * 60 * 1000),
        ate: new Date(inicioDoDiaUtc.getTime() + 38 * 60 * 60 * 1000),
        agora: agora(),
        ignorarAgendamentoId: agendamento.id,
      });
      if (!consulta.ok) return { ok: false, motivo: consulta.codigo, mensagem: consulta.motivoParaCliente };
      const doDia = consulta.slots.filter((s) => diaLocalISO(s.inicio, consulta.fusoDaRegra) === dia);
      const achado = doDia.find((s) => horaNoFuso(s.inicio, consulta.fusoDaRegra) === horaPadrao(hora));
      if (!achado) {
        return {
          ok: false,
          motivo: "horario_indisponivel",
          alternativas: doDia.map((s) => horaNoFuso(s.inicio, consulta.fusoDaRegra)),
        };
      }
      const r = await crmRescheduleAppointment.handler(
        { appointment_id: agendamento.id, new_starts_at: achado.inicio.toISOString() },
        contextoDaFerramenta(admin, org),
      );
      return comNomes(org, r, "remarcado", agendamento.servicoNome);
    },

    async cancelar(org, { agendamento, motivo }) {
      const r = await crmCancelAppointment.handler(
        { appointment_id: agendamento.id, reason: motivo },
        contextoDaFerramenta(admin, org),
      );
      return comNomes(org, r, "cancelado", agendamento.servicoNome);
    },
  };
}

function criarPedidoDb(admin: SupabaseClient): PedidoPeloGrupoDb {
  const aviso = createSupabaseAvisoDeAgendamentoDb(admin, createSupabaseAvisoDb(admin));
  const grupo = criarIngestDeGrupoDb(admin);
  return {
    marcacaoPeloGrupo: (org) => grupo.marcacaoPeloGrupo(org),

    async textoDaMensagem(org, externalId) {
      const { data, error } = await admin
        .from("messages")
        .select("body")
        .eq("organization_id", org)
        .eq("external_id", externalId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const body = (data as { body: string | null } | null)?.body;
      return typeof body === "string" && body.trim().length > 0 ? body : null;
    },

    async contexto(org, agora) {
      const fuso = await aviso.fusoDaOrganizacao(org);
      const tipos = await listaTiposDeAtendimento(admin, org);
      if (!tipos.ok) throw new Error(tipos.motivoParaOperador);
      return {
        fuso,
        hoje: diaLocalISO(agora, fuso),
        hojeRotulo: rotuloLocal(agora, fuso).split(" às ")[0] ?? diaLocalISO(agora, fuso),
        servicos: tipos.tipos.map((t) => ({ slug: t.slug, nome: t.nome })),
        profissionais: await nomesDosProfissionais(admin, org),
      };
    },

    async clientesPorNome(org, nome) {
      // Nome INTEIRO, sem curinga: "Rafael" não pode pegar a "Rafaela".
      const termo = nome.trim().replace(/[%_\\]/g, "").replace(/[,()]/g, " ");
      const { data, error } = await admin
        .from("contacts")
        .select("id, name, display_name")
        .eq("organization_id", org)
        .eq("kind", "person")
        .eq("is_anonymized", false)
        .or(`name.ilike."${termo}",display_name.ilike."${termo}"`)
        .limit(10);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ id: string; name: string | null; display_name: string | null }>).map((c) => ({
        id: c.id,
        nome: c.display_name ?? c.name ?? nome,
      }));
    },

    async criaCliente(org, nome) {
      const r = await createContactHandler(
        admin as never,
        { organization_id: org, actor: { type: "ai_agent", id: "agenda-pelo-grupo", role: "ai_operator" }, requestId: randomUUID() },
        contactCreateSchema.parse({ name: nome.trim(), source: "agenda_pelo_grupo" }),
      );
      return { id: r.contact.id, nome: r.contact.name ?? nome };
    },

    async agendamentosVivos(org, contactId, desde) {
      const { data, error } = await admin
        .from("calendar_appointments")
        .select("id, starts_at, time_zone, owner_user_id, event_type_id")
        .eq("organization_id", org)
        .eq("contact_id", contactId)
        .in("status", ["pending", "confirmed"])
        .gte("starts_at", desde.toISOString())
        .order("starts_at", { ascending: true })
        .limit(20);
      if (error) throw new Error(error.message);
      const linhas = (data ?? []) as Array<{
        id: string;
        starts_at: string;
        time_zone: string;
        owner_user_id: string | null;
        event_type_id: string | null;
      }>;
      const tipos = await listaTiposDeAtendimento(admin, org, { incluirInativos: true });
      const porId = new Map(tipos.ok ? tipos.tipos.map((t) => [t.id, t]) : []);
      return linhas.map<AgendamentoDoCliente>((l) => {
        const tipo = l.event_type_id ? porId.get(l.event_type_id) : undefined;
        return {
          id: l.id,
          inicio: new Date(l.starts_at),
          fuso: l.time_zone,
          servicoSlug: tipo?.slug ?? null,
          servicoNome: tipo?.nome ?? null,
          profissionalId: l.owner_user_id,
        };
      });
    },

    async comRecibo(org, chave, executar) {
      const d = await comIdempotencia<DecisaoDoPedido>({
        db: admin,
        organizationId: org,
        endpoint: ENDPOINT_DO_RECIBO,
        chave,
        // O corpo é a própria chave: o reprocessamento é a MESMA operação por
        // definição, mesmo que o modelo lesse o texto de outro jeito.
        corpo: { chave },
        executar: async () => ({ resposta: await executar(), status: 200 }),
      });
      if (d.tipo === "executou" || d.tipo === "replay") return { tipo: d.tipo, decisao: d.resposta };
      return { tipo: "em_curso" };
    },
  };
}

/** A resposta no grupo pelo MESMO transporte e espaçamento do aviso de agendamento. */
async function criarResposta(admin: SupabaseClient): Promise<PedidoPeloGrupoDeps["responder"]> {
  const aviso = createSupabaseAvisoDb(admin);
  const transporte = await criarTransporteDoAviso(admin);
  const pacing = await criarPacingDoCanal(admin);
  return async (org, channelSessionId, groupChatId, texto): Promise<DesfechoDoEnvio> => {
    const agora = new Date();
    const depois = (detail: string): DesfechoDoEnvio => ({
      status: "retry",
      quando: new Date(agora.getTime() + 5 * 60 * 1000),
      detail,
    });
    const canal = await aviso.carregaCanal(org, channelSessionId);
    if (!canal || canal.archived_at || canal.desativado) return { status: "skipped", detail: "canal_indisponivel" };
    if (!canal.aceitaMensagemLivre) return { status: "skipped", detail: "canal_nao_aceita_mensagem_livre" };
    if (canal.status !== "WORKING") return depois(`canal ${canal.status}`);
    if (!(await transporte.configurado(org, canal))) return depois("transporte fora do ar");
    const decisao = await pacing.decide(org, channelSessionId, agora);
    if (!decisao.liberado) return { status: "retry", quando: decisao.liberaEm, detail: `pacing:${decisao.motivo}` };
    const to = await transporte.resolveDestino(org, canal, groupChatId);
    if (!to) return { status: "skipped", detail: "destino_invalido" };
    try {
      await transporte.envia(org, canal, to, texto);
    } catch (err) {
      logger.warn("[agenda.pedido-pelo-grupo] resposta no grupo recusada", {
        organization_id: org,
        causa: err instanceof Error ? err.name : "erro",
      });
      return depois("envio recusado");
    }
    try {
      await pacing.registraEnvio(org, channelSessionId, agora);
    } catch (err) {
      logger.warn("[agenda.pedido-pelo-grupo] envio não contabilizado no pacing", {
        organization_id: org,
        causa: err instanceof Error ? err.message : String(err),
      });
    }
    return { status: "ok" };
  };
}

export async function criarDepsDoPedidoPeloGrupo(): Promise<PedidoPeloGrupoDeps> {
  const admin = createAdminClient();
  const clock = () => new Date();
  return {
    db: criarPedidoDb(admin),
    agenda: criarAgendaDoPedido(admin, clock),
    lerPedido: lerPedidoComModelo,
    responder: await criarResposta(admin),
    clock,
    origemDoDreno,
    audita: (entrada) => {
      void audit({
        action: "agenda.pedido_pelo_grupo_atendido",
        organizationId: entrada.organizationId,
        resourceType: ENTIDADE_DO_AGENDAMENTO,
        resourceId: entrada.appointmentId,
        bypassedRls: true,
        metadata: entrada.metadata,
      });
    },
  };
}

export const pedidoDeAgendaPeloGrupoHandler: EventHandler = {
  key: PEDIDO_PELO_GRUPO_HANDLER_KEY,
  // Chama modelo pago e sai pela rede de terceiro: numa organização parada, não roda.
  naOrgParada: "pula",
  events: [EVENTO_DO_PEDIDO_PELO_GRUPO],
  async handle(row): Promise<HandlerResult> {
    try {
      const desfecho = await atendePedidoDeAgendaPeloGrupo(await criarDepsDoPedidoPeloGrupo(), row);
      return {
        consumer_key: PEDIDO_PELO_GRUPO_HANDLER_KEY,
        status: desfecho.status,
        ...(desfecho.retry_at ? { retry_at: desfecho.retry_at } : {}),
        detail: desfecho.detail,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { consumer_key: PEDIDO_PELO_GRUPO_HANDLER_KEY, status: "error", detail };
    }
  },
};
