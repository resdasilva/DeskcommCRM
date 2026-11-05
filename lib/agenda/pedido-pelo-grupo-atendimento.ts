/**
 * O PEDIDO DE AGENDA DO GRUPO, ATENDIDO — o consumidor de
 * `agenda.group_booking_requested` (issue #6, terceira e última fatia de #3).
 *
 * A fatia anterior (#5) anota em `event_log` a mensagem que um número
 * autorizado escreveu no grupo do aviso de agendamento. Esta a lê, marca,
 * remarca ou cancela pela agenda que já existe e responde no grupo.
 *
 * ## Quem decide o quê
 *
 * - O MODELO só lê o texto (`./pedido-pelo-grupo-extracao.ts`) e devolve um
 *   objeto. Ele não toca a agenda.
 * - ESTE ARQUIVO é código determinístico: confere o objeto, resolve cliente,
 *   serviço e profissional contra o banco e decide. Faltou algo, ou há mais de
 *   um candidato, vira PERGUNTA no grupo — nunca palpite.
 * - A AGENDA é a das ferramentas do agente (`crm_find_and_book_appointment`,
 *   `crm_reschedule_appointment`, `crm_cancel_appointment`), pela porta
 *   `AgendaDoPedido`. Mesmo horário livre, mesma recusa, mesma auditoria.
 *
 * ## Um pedido, no máximo um agendamento
 *
 * A decisão inteira roda dentro de um recibo de idempotência (`idempotency_keys`,
 * chave = `external_id` da mensagem). O reprocessamento do mesmo evento
 * encontra o recibo e só reenvia a resposta gravada — não lê o texto de novo,
 * não chama o modelo e não toca a agenda.
 *
 * ## NENHUM DESFECHO É `error`
 *
 * Mesma régua do aviso de agendamento: estado de mundo (sem texto, recurso
 * desligado, canal fora do ar) é `skipped` ou `retry`. `error` fica para
 * defeito de programa, no `catch` do handler.
 */
import { IDADE_MAXIMA_DO_EVENTO_MS, JANELA_DE_REIVINDICACAO_MS } from "@/lib/escalacao/aviso-ao-suporte";
import type { EventRow } from "@/lib/event-log/dispatcher";

import { diaLocalISO, partesNoFuso } from "./fuso";
import { ehPedidoDeAgendaPeloGrupo, type MarcacaoPeloGrupo } from "./pedido-pelo-grupo";
import {
  extracaoDoPedidoSchema,
  type ContextoDaExtracao,
  type ExtracaoDoPedido,
  type LeituraDoPedido,
} from "./pedido-pelo-grupo-extracao";

export const EVENTO_DO_PEDIDO_PELO_GRUPO = "agenda.group_booking_requested";

/** Quantos candidatos a pergunta lista antes de pedir para o pedido ser mais claro. */
const MAXIMO_NA_PERGUNTA = 5;

// ── Portas ───────────────────────────────────────────────────────────────────

export interface ClienteDoPedido {
  id: string;
  nome: string;
}

export interface AgendamentoDoCliente {
  id: string;
  inicio: Date;
  fuso: string;
  servicoSlug: string | null;
  servicoNome: string | null;
  profissionalId: string | null;
}

/** O que a agenda respondeu, já sem o formato de cada ferramenta. */
export type DesfechoDaAgenda =
  | {
      ok: true;
      appointmentId: string;
      inicio: Date;
      fuso: string;
      servico: string | null;
      profissional: string | null;
      aguardaConfirmacao: boolean;
    }
  /** O horário pedido não está livre. `alternativas` = os livres do dia ("14:00"). */
  | { ok: false; motivo: "horario_indisponivel"; alternativas: string[] }
  /** Recusa de negócio da agenda, com a frase que ela devolveu. */
  | { ok: false; motivo: string; mensagem: string };

export interface AgendaDoPedido {
  marcar(
    org: string,
    a: { servicoSlug: string; dia: string; hora: string; contactId: string; profissionalId: string | null; chave: string },
  ): Promise<DesfechoDaAgenda>;
  remarcar(
    org: string,
    a: { agendamento: AgendamentoDoCliente; dia: string; hora: string },
  ): Promise<DesfechoDaAgenda>;
  cancelar(org: string, a: { agendamento: AgendamentoDoCliente; motivo: string }): Promise<DesfechoDaAgenda>;
}

export type DesfechoDoEnvio =
  | { status: "ok" }
  | { status: "retry"; quando: Date; detail: string }
  | { status: "skipped"; detail: string };

/** O que fica gravado no recibo — é o que o reprocessamento reenvia. */
export interface DecisaoDoPedido {
  acao: ExtracaoDoPedido["acao"] | "ilegivel";
  desfecho: string;
  /** `null` = nada a responder no grupo (a mensagem não era pedido). */
  resposta: string | null;
  appointmentId: string | null;
}

export type DesfechoDoRecibo =
  | { tipo: "executou" | "replay"; decisao: DecisaoDoPedido }
  | { tipo: "em_curso" };

export interface PedidoPeloGrupoDb {
  marcacaoPeloGrupo(org: string): Promise<MarcacaoPeloGrupo | null>;
  textoDaMensagem(org: string, externalId: string): Promise<string | null>;
  contexto(org: string, agora: Date): Promise<ContextoDaExtracao & { fuso: string }>;
  clientesPorNome(org: string, nome: string): Promise<ClienteDoPedido[]>;
  /** Quem começa pelo nome pedido seguido de sobrenome ("Rafael" → "Rafael Souza"). */
  clientesParecidos(org: string, nome: string): Promise<ClienteDoPedido[]>;
  criaCliente(org: string, nome: string): Promise<ClienteDoPedido>;
  /** Os agendamentos `pending`/`confirmed` do cliente que ainda não começaram. */
  agendamentosVivos(org: string, contactId: string, desde: Date): Promise<AgendamentoDoCliente[]>;
  /** Roda `executar` uma vez por chave; o reprocessamento recebe a decisão gravada. */
  comRecibo(org: string, chave: string, executar: () => Promise<DecisaoDoPedido>): Promise<DesfechoDoRecibo>;
}

export interface PedidoPeloGrupoDeps {
  db: PedidoPeloGrupoDb;
  agenda: AgendaDoPedido;
  lerPedido(texto: string, ctx: ContextoDaExtracao, org: string): Promise<LeituraDoPedido>;
  responder(org: string, channelSessionId: string, groupChatId: string, texto: string): Promise<DesfechoDoEnvio>;
  clock: () => Date;
  origemDoDreno: () => "worker" | "request";
  /** Fire-and-forget. Nunca o texto nem o telefone: `api_audit_log` é append-only. */
  /** `appointmentId` vira `resource_id` (uuid) — `null` quando a decisão não tocou agendamento. */
  audita(entrada: { organizationId: string; appointmentId: string | null; metadata: Record<string, unknown> }): void;
}

export interface DesfechoDoPedido {
  status: "ok" | "skipped" | "retry";
  detail: string;
  retry_at?: string;
}

/** O modelo ficou fora do ar: o recibo é liberado e o evento volta depois. */
export class LeituraAdiada extends Error {
  constructor(readonly motivo: string) {
    super(`leitura_adiada:${motivo}`);
    this.name = "LeituraAdiada";
  }
}

const skipped = (detail: string): DesfechoDoPedido => ({ status: "skipped", detail });
const retry = (quando: Date, detail: string): DesfechoDoPedido => ({
  status: "retry",
  detail,
  retry_at: quando.toISOString(),
});
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

// ── O consumidor ─────────────────────────────────────────────────────────────

export async function atendePedidoDeAgendaPeloGrupo(
  deps: PedidoPeloGrupoDeps,
  row: EventRow,
): Promise<DesfechoDoPedido> {
  if (row.event_type !== EVENTO_DO_PEDIDO_PELO_GRUPO) return skipped("evento_ignorado");
  const org = row.organization_id;
  const agora = deps.clock();
  const externalId = texto(row.payload.external_id);
  const channelSessionId = texto(row.payload.channel_session_id);
  const groupChatId = texto(row.payload.group_chat_id);
  const remetente = texto(row.payload.sender_phone);
  if (!externalId || !channelSessionId || !groupChatId || !remetente) return skipped("payload_incompleto");

  // Pedido de meia hora atrás já não é "às 13h de hoje" para ninguém.
  if (row.created_at) {
    const emitido = Date.parse(row.created_at);
    if (!Number.isNaN(emitido) && agora.getTime() - emitido > IDADE_MAXIMA_DO_EVENTO_MS) return skipped("evento_velho");
  }

  // O modelo e o envio não rodam dentro do webhook que gravou a mensagem.
  if (deps.origemDoDreno() === "request") {
    return retry(new Date(agora.getTime() + JANELA_DE_REIVINDICACAO_MS), "adiado: dreno dentro do webhook");
  }

  // A tela pode ter desligado o recurso, trocado o grupo ou tirado o número
  // entre a mensagem e agora: a mesma regra da anotação, perguntada de novo.
  const config = await deps.db.marcacaoPeloGrupo(org);
  if (!ehPedidoDeAgendaPeloGrupo(config, { groupChatId, direction: "inbound", telefoneDoRemetente: remetente })) {
    return skipped("nao_e_mais_pedido");
  }

  let recibo: DesfechoDoRecibo;
  try {
    recibo = await deps.db.comRecibo(org, `agenda-pelo-grupo:${externalId}`, () =>
      decide(deps, org, externalId, agora),
    );
  } catch (err) {
    if (err instanceof LeituraAdiada) {
      return retry(new Date(agora.getTime() + JANELA_DE_REIVINDICACAO_MS), err.message);
    }
    throw err;
  }
  if (recibo.tipo === "em_curso") {
    return retry(new Date(agora.getTime() + JANELA_DE_REIVINDICACAO_MS), "outra rodada está atendendo este pedido");
  }

  const { decisao } = recibo;
  if (recibo.tipo === "executou") {
    deps.audita({
      organizationId: org,
      appointmentId: decisao.appointmentId,
      metadata: {
        external_id: externalId,
        acao: decisao.acao,
        desfecho: decisao.desfecho,
        appointment_id: decisao.appointmentId,
        conversation_id: row.entity_id,
        respondeu: decisao.resposta !== null,
      },
    });
  }
  if (!decisao.resposta) return skipped(`${decisao.acao}:${decisao.desfecho}`);

  const envio = await deps.responder(org, channelSessionId, groupChatId, decisao.resposta);
  const detail = `${recibo.tipo}:${decisao.acao}:${decisao.desfecho}`;
  if (envio.status === "retry") return retry(envio.quando, `${detail}:${envio.detail}`);
  if (envio.status === "skipped") return skipped(`${detail}:${envio.detail}`);
  return { status: "ok", detail };
}

// ── A decisão (dentro do recibo) ─────────────────────────────────────────────

async function decide(
  deps: PedidoPeloGrupoDeps,
  org: string,
  externalId: string,
  agora: Date,
): Promise<DecisaoDoPedido> {
  const corpo = await deps.db.textoDaMensagem(org, externalId);
  if (!corpo) return { acao: "nenhuma", desfecho: "sem_texto", resposta: null, appointmentId: null };

  const ctx = await deps.db.contexto(org, agora);
  const leitura = await deps.lerPedido(corpo, ctx, org);
  if (!leitura.ok) {
    if (leitura.passageiro) throw new LeituraAdiada(leitura.motivo);
    return pergunta("ilegivel", leitura.motivo, textos.semLeitura());
  }

  const lido = extracaoDoPedidoSchema.safeParse(leitura.bruto);
  if (!lido.success) return pergunta("ilegivel", "extracao_invalida", textos.naoEntendi());
  const pedido = normaliza(lido.data);

  switch (pedido.acao) {
    case "nenhuma":
      return { acao: "nenhuma", desfecho: "nao_e_pedido", resposta: null, appointmentId: null };
    case "marcar":
      return await marca(deps, org, externalId, pedido, ctx);
    case "remarcar":
    case "cancelar":
      return await mexeNoExistente(deps, org, pedido, ctx, agora);
  }
}

function pergunta(acao: DecisaoDoPedido["acao"], desfecho: string, resposta: string): DecisaoDoPedido {
  return { acao, desfecho, resposta, appointmentId: null };
}

/** Texto vazio é ausente: o schema do modelo não pode ter `.transform`. */
function normaliza(p: ExtracaoDoPedido): ExtracaoDoPedido {
  const vazio = (v: string | null) => (v && v.trim().length > 0 ? v.trim() : null);
  return { ...p, cliente: vazio(p.cliente), servico: vazio(p.servico), profissional: vazio(p.profissional) };
}

async function marca(
  deps: PedidoPeloGrupoDeps,
  org: string,
  externalId: string,
  p: ExtracaoDoPedido,
  ctx: ContextoDaExtracao,
): Promise<DecisaoDoPedido> {
  const falta = [!p.cliente && "o cliente", !p.servico && "o serviço", !p.hora && "a hora"].filter(
    (x): x is string => Boolean(x),
  );
  if (falta.length > 0) return pergunta("marcar", "incompleto", textos.falta(falta));

  const servico = ctx.servicos.find((s) => s.slug === p.servico);
  if (!servico) return pergunta("marcar", "servico_desconhecido", textos.servicoDesconhecido(ctx.servicos));
  const profissional = p.profissional ? ctx.profissionais.find((x) => x.id === p.profissional) : null;
  if (p.profissional && !profissional) {
    return pergunta("marcar", "profissional_desconhecido", textos.profissionalDesconhecido(ctx.profissionais));
  }

  const clientes = await deps.db.clientesPorNome(org, p.cliente!);
  if (clientes.length > 1) return pergunta("marcar", "cliente_ambiguo", textos.clienteAmbiguo(p.cliente!, clientes));
  if (clientes.length === 0) {
    // Contato novo só quando ninguém da base pode ser a mesma pessoa.
    const parecidos = await deps.db.clientesParecidos(org, p.cliente!);
    if (parecidos.length > 0) return pergunta("marcar", "cliente_parecido", textos.clienteParecido(p.cliente!, parecidos));
  }
  const cliente = clientes[0] ?? (await deps.db.criaCliente(org, p.cliente!));

  const dia = p.dia ?? ctx.hoje;
  const r = await deps.agenda.marcar(org, {
    servicoSlug: servico.slug,
    dia,
    hora: p.hora!,
    contactId: cliente.id,
    profissionalId: profissional?.id ?? null,
    chave: `agenda-pelo-grupo:${externalId}`,
  });
  if (!r.ok) return pergunta("marcar", r.motivo, textos.recusa(r, p.hora!, dia));
  return {
    acao: "marcar",
    desfecho: r.aguardaConfirmacao ? "reservado" : "marcado",
    resposta: textos.marcado(cliente.nome, r),
    appointmentId: r.appointmentId,
  };
}

async function mexeNoExistente(
  deps: PedidoPeloGrupoDeps,
  org: string,
  p: ExtracaoDoPedido,
  ctx: ContextoDaExtracao & { fuso: string },
  agora: Date,
): Promise<DecisaoDoPedido> {
  const acao = p.acao as "remarcar" | "cancelar";
  if (!p.cliente) return pergunta(acao, "incompleto", textos.falta(["o cliente"]));
  if (acao === "remarcar" && !p.hora) return pergunta(acao, "incompleto", textos.falta(["a hora nova"]));

  const clientes = await deps.db.clientesPorNome(org, p.cliente);
  if (clientes.length === 0) {
    const parecidos = await deps.db.clientesParecidos(org, p.cliente);
    if (parecidos.length > 0) return pergunta(acao, "cliente_parecido", textos.clienteParecido(p.cliente, parecidos));
    return pergunta(acao, "cliente_desconhecido", textos.semAgendamento(p.cliente));
  }
  if (clientes.length > 1) return pergunta(acao, "cliente_ambiguo", textos.clienteAmbiguo(p.cliente, clientes));
  const cliente = clientes[0]!;

  // O texto pode apontar QUAL agendamento (serviço, dia ou hora de hoje). Cada
  // pista só estreita; nenhuma escolhe sozinha entre dois que sobraram.
  let vivos = await deps.db.agendamentosVivos(org, cliente.id, agora);
  if (p.servico) vivos = vivos.filter((a) => a.servicoSlug === p.servico);
  if (p.dia_atual) vivos = vivos.filter((a) => diaLocalISO(a.inicio, a.fuso) === p.dia_atual);
  if (p.hora_atual) vivos = vivos.filter((a) => horaNoFuso(a.inicio, a.fuso) === horaPadrao(p.hora_atual!));
  if (vivos.length === 0) return pergunta(acao, "sem_agendamento", textos.semAgendamento(cliente.nome));
  if (vivos.length > 1) return pergunta(acao, "agendamento_ambiguo", textos.agendamentoAmbiguo(cliente.nome, vivos));
  const alvo = vivos[0]!;

  if (acao === "cancelar") {
    const r = await deps.agenda.cancelar(org, { agendamento: alvo, motivo: "Cancelado pelo grupo do WhatsApp" });
    if (!r.ok) return pergunta(acao, r.motivo, textos.recusa(r, horaNoFuso(alvo.inicio, alvo.fuso), diaLocalISO(alvo.inicio, alvo.fuso)));
    return { acao, desfecho: "cancelado", resposta: textos.cancelado(cliente.nome, r), appointmentId: alvo.id };
  }

  // Sem dia novo, "muda o Rafael para as 15h" é no MESMO dia do agendamento.
  const dia = p.dia ?? diaLocalISO(alvo.inicio, alvo.fuso);
  const r = await deps.agenda.remarcar(org, { agendamento: alvo, dia, hora: p.hora! });
  if (!r.ok) return pergunta(acao, r.motivo, textos.recusa(r, p.hora!, dia));
  return { acao, desfecho: "remarcado", resposta: textos.remarcado(cliente.nome, r), appointmentId: alvo.id };
}

// ── Relógio de parede ────────────────────────────────────────────────────────

export function horaNoFuso(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso);
  return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
}

/** "9:00" e "09:00" são a mesma hora. */
export function horaPadrao(hora: string): string {
  const [h = "", m = ""] = hora.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

function diaCurto(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

// ── As frases do grupo ───────────────────────────────────────────────────────

const EXEMPLO = "Exemplo: \"Rafael amanhã às 13h, corte\".";

function linhaDoHorario(r: Extract<DesfechoDaAgenda, { ok: true }>): string {
  const partesDoHorario = [`${diaCurto(diaLocalISO(r.inicio, r.fuso))} às ${horaNoFuso(r.inicio, r.fuso)}`];
  if (r.servico) partesDoHorario.push(r.servico);
  if (r.profissional) partesDoHorario.push(`com ${r.profissional}`);
  return partesDoHorario.join(" · ");
}

export const textos = {
  marcado(cliente: string, r: Extract<DesfechoDaAgenda, { ok: true }>): string {
    const cabeca = r.aguardaConfirmacao
      ? `📅 Horário reservado para ${cliente}, aguardando a equipe confirmar:`
      : `📅 Marcado para ${cliente}:`;
    return `${cabeca}\n${linhaDoHorario(r)}`;
  },
  remarcado(cliente: string, r: Extract<DesfechoDaAgenda, { ok: true }>): string {
    return `🔁 Remarcado ${cliente} para:\n${linhaDoHorario(r)}`;
  },
  cancelado(cliente: string, r: Extract<DesfechoDaAgenda, { ok: true }>): string {
    return `❌ Cancelado o horário de ${cliente}:\n${linhaDoHorario(r)}`;
  },
  falta(itens: string[]): string {
    return `Não marquei nada: faltou ${itens.join(", ")}. Mande o pedido completo numa mensagem só. ${EXEMPLO}`;
  },
  naoEntendi(): string {
    return `Não entendi o pedido e não marquei nada. Mande cliente, serviço, dia e hora numa mensagem só. ${EXEMPLO}`;
  },
  semLeitura(): string {
    return "Não consegui ler o pedido agora e não marquei nada. Marque pela agenda do CRM.";
  },
  servicoDesconhecido(servicos: ReadonlyArray<{ nome: string }>): string {
    const lista = servicos.slice(0, MAXIMO_NA_PERGUNTA).map((s) => s.nome).join(", ");
    return lista
      ? `Não achei esse serviço e não marquei nada. Serviços da agenda: ${lista}.`
      : "Não marquei nada: a agenda não tem serviço ativo para marcar.";
  },
  profissionalDesconhecido(profissionais: ReadonlyArray<{ nome: string }>): string {
    const lista = profissionais.slice(0, MAXIMO_NA_PERGUNTA).map((p) => p.nome).join(", ");
    return `Não achei esse profissional e não marquei nada. Quem atende: ${lista}.`;
  },
  clienteAmbiguo(nome: string, clientes: ClienteDoPedido[]): string {
    const lista = clientes.slice(0, MAXIMO_NA_PERGUNTA).map((c) => c.nome).join(", ");
    return `Há mais de um cliente "${nome}" (${lista}). Mande de novo com o nome completo; não mexi na agenda.`;
  },
  clienteParecido(nome: string, parecidos: ClienteDoPedido[]): string {
    const lista = parecidos.slice(0, MAXIMO_NA_PERGUNTA).map((c) => c.nome).join(", ");
    return `Não achei cliente com o nome exato "${nome}", mas achei ${lista}. Mande de novo com o nome completo (se for cliente novo, com o sobrenome); não mexi na agenda.`;
  },
  semAgendamento(nome: string): string {
    return `Não achei agendamento futuro de ${nome}; não mexi na agenda.`;
  },
  agendamentoAmbiguo(nome: string, vivos: AgendamentoDoCliente[]): string {
    const lista = vivos
      .slice(0, MAXIMO_NA_PERGUNTA)
      .map((a) => `${diaCurto(diaLocalISO(a.inicio, a.fuso))} às ${horaNoFuso(a.inicio, a.fuso)}${a.servicoNome ? ` (${a.servicoNome})` : ""}`)
      .join(", ");
    return `${nome} tem mais de um agendamento: ${lista}. Diga qual (dia e hora); não mexi na agenda.`;
  },
  recusa(r: Exclude<DesfechoDaAgenda, { ok: true }>, hora: string, dia: string): string {
    if (r.motivo === "horario_indisponivel" && "alternativas" in r) {
      const livres = r.alternativas.slice(0, MAXIMO_NA_PERGUNTA).join(", ");
      const quando = `${horaPadrao(hora)} de ${diaCurto(dia)}`;
      return livres
        ? `${quando} não está livre; não marquei nada. Livres nesse dia: ${livres}. Mande o pedido de novo com um deles.`
        : `${quando} não está livre e não há outro horário nesse dia; não marquei nada.`;
    }
    return `Não mexi na agenda: ${"mensagem" in r ? r.mensagem : r.motivo}`;
  },
};
