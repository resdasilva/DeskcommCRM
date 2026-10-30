/**
 * PROVA EM PAR do pedido de agenda pelo grupo (`docs/doctrine/prova-em-par.md`,
 * AC 5 da issue #6), com a FERRAMENTA REAL dos dois lados.
 *
 * O par anterior (`pedido-pelo-grupo.handler.test.ts`) chamava o mesmo `vi.fn`
 * nos dois lados, e o `toEqual` comparava o dublê com ele mesmo (achado R2 da
 * revisão do PR #9). Aqui nada da decisão é dublado:
 *
 *  - `crm_find_and_book_appointment` é o handler de verdade;
 *  - a lista de livres sai de `horariosLivresDaOrg` de verdade, sobre um
 *    Supabase em memória que FILTRA (`eq/lt/gt/...`) — com jornada publicada
 *    (09:00–18:00 em São Paulo) e um agendamento ocupando 14:00;
 *  - o lado do grupo passa por `atendePedidoDeAgendaPeloGrupo` e pela porta de
 *    produção `criarAgendaDoPedido`.
 *
 * O que continua dublado, e por quê:
 *  1. **A escrita** (`marcarAgendamentoHandler`): grava, audita e reconfere em
 *     Postgres; aqui ela só registra o que recebeu. O desfecho LIVRE/OCUPADO é
 *     decidido antes dela, pela ferramenta real.
 *  2. **O modelo** que extrai o pedido (`lerPedido`): fixo, para o par medir a
 *     camada de baixo com o mesmo pedido.
 *  3. **O nome do profissional** (`resolveUserNames`): só rótulo.
 *
 * Fora do alcance desta máquina e declarado como passo humano no PR: o lado
 * "pela tela" com um grupo real no WAHA e o modelo real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

const escrita = vi.hoisted(() => ({ marcar: vi.fn() }));

vi.mock("@/app/api/v1/agenda/agendamentos/_handler", () => ({
  marcarAgendamentoHandler: escrita.marcar,
  alterarAgendamentoHandler: vi.fn(),
  cancelarAgendamentoHandler: vi.fn(),
}));
vi.mock("@/lib/mcp/tools/_users", () => ({
  resolveUserNames: vi.fn(async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, "Bruno"]))),
}));

import type { EventRow } from "@/lib/event-log/dispatcher";
import { crmFindAndBookAppointment } from "@/lib/mcp/tools/agendamento";
import type { McpContext } from "@/lib/mcp/types";

import { atendePedidoDeAgendaPeloGrupo, type DecisaoDoPedido, type PedidoPeloGrupoDeps } from "./pedido-pelo-grupo-atendimento";
import { criarAgendaDoPedido, desfechoDaFerramenta } from "./pedido-pelo-grupo.handler";

const ORG = "org-a";
const OUTRA_ORG = "org-b";
const TZ = "America/Sao_Paulo";
const DONO = "user-bruno";
const TIPO = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
/** 10:00 em São Paulo do dia 29/10. */
const AGORA = new Date("2026-10-29T13:00:00.000Z");
const HOJE = "2026-10-29";

type Linha = Record<string, unknown>;

/** Supabase em memória que aplica os filtros que a coleta usa. */
function clienteFalso(tabelas: Record<string, Linha[]>): SupabaseClient {
  function daTabela(tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
    const compara = (coluna: string, valor: unknown, ok: (a: string, b: string) => boolean) => {
      filtros.push((l) => ok(String(l[coluna]), String(valor)));
      return api;
    };
    const api = {
      select: () => api,
      order: () => api,
      limit: () => api,
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => l[coluna] === valor);
        return api;
      },
      neq: (coluna: string, valor: unknown) => {
        filtros.push((l) => l[coluna] !== valor);
        return api;
      },
      in: (coluna: string, valores: unknown[]) => {
        filtros.push((l) => valores.includes(l[coluna]));
        return api;
      },
      gte: (c: string, v: unknown) => compara(c, v, (a, b) => a >= b),
      lte: (c: string, v: unknown) => compara(c, v, (a, b) => a <= b),
      lt: (c: string, v: unknown) => compara(c, v, (a, b) => a < b),
      gt: (c: string, v: unknown) => compara(c, v, (a, b) => a > b),
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: linhas(), error: null }).then(resolve),
    };
    return api;
  }
  return {
    from: (tabela: string) => daTabela(tabela),
    rpc: async (fn: string) => {
      if (fn === "fn_google_coverage") return { data: false, error: null };
      if (fn === "fn_agenda_ocupacao_google_do_dono" || fn === "fn_agenda_conexoes_google_do_dono") {
        return { data: [], error: null };
      }
      throw new Error(`[duble] rpc não prevista: ${fn}`);
    },
  } as unknown as SupabaseClient;
}

/** A agenda da org A: corte de 30 min, Bruno atende 09–18 todo dia, 14:00 de hoje já ocupado. */
function agendaDaOrg(): Record<string, Linha[]> {
  return {
    calendar_event_types: [
      {
        id: TIPO,
        organization_id: ORG,
        slug: "corte",
        name: "Corte",
        is_active: true,
        duration_minutes: 30,
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        minimum_notice_minutes: 0,
        slot_interval_minutes: 30,
        booking_window_days: 365,
        default_owner_user_id: DONO,
        service_enabled: false,
        requires_confirmation: false,
      },
    ],
    attendant_availability: [
      {
        organization_id: ORG,
        user_id: DONO,
        schedule: { timezone: TZ, windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "09:00", end: "18:00" })) },
      },
      // Outra organização, mesmo usuário, jornada aberta: não pode vazar para a org A.
      {
        organization_id: OUTRA_ORG,
        user_id: DONO,
        schedule: { timezone: TZ, windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "00:00", end: "23:30" })) },
      },
    ],
    calendar_availability_exceptions: [],
    calendar_appointments: [
      {
        id: "apt-ocupado",
        organization_id: ORG,
        owner_user_id: DONO,
        starts_at: "2026-10-29T17:00:00.000Z", // 14:00 em SP
        ends_at: "2026-10-29T17:30:00.000Z",
        status: "confirmed",
      },
    ],
    calendar_external_events: [],
    calendar_connections: [],
    calendar_selected_external_events: [],
  };
}

/** O que a escrita recebe vira o compromisso devolvido — o instante é o que a ferramenta mandou. */
function escritaQueRegistra() {
  escrita.marcar.mockImplementation(async (_db: unknown, meta: { organization_id: string }, corpo: { starts_at: string }) => ({
    id: `apt-novo-${meta.organization_id}`,
    starts_at: corpo.starts_at,
    time_zone: TZ,
    owner_user_id: DONO,
    title: "Corte",
    status: "confirmed",
  }));
}

function depsDoGrupo(db: SupabaseClient, hora: string) {
  const recibos = new Map<string, DecisaoDoPedido>();
  const responder = vi.fn(async () => ({ status: "ok" as const }));
  const deps: PedidoPeloGrupoDeps = {
    db: {
      marcacaoPeloGrupo: async () => ({ grupo: "g@g.us", ligado: true, autorizados: ["+5511987654321"] }),
      textoDaMensagem: async () => `Rafael às ${hora}, corte`,
      contexto: async () => ({
        fuso: TZ,
        hoje: HOJE,
        hojeRotulo: "Qui 29/10",
        servicos: [{ slug: "corte", nome: "Corte" }],
        profissionais: [{ id: DONO, nome: "Bruno" }],
      }),
      clientesPorNome: async () => [{ id: CONTATO, nome: "Rafael" }],
      clientesParecidos: async () => [],
      criaCliente: async () => {
        throw new Error("não deveria criar contato");
      },
      agendamentosVivos: async () => [],
      comRecibo: async (_org, chave, executar) => {
        const ja = recibos.get(chave);
        if (ja) return { tipo: "replay", decisao: ja };
        const decisao = await executar();
        recibos.set(chave, decisao);
        return { tipo: "executou", decisao };
      },
    },
    agenda: criarAgendaDoPedido(db, () => AGORA),
    lerPedido: async () => ({
      ok: true,
      bruto: {
        acao: "marcar",
        cliente: "Rafael",
        servico: "corte",
        dia: null,
        hora,
        profissional: null,
        dia_atual: null,
        hora_atual: null,
      },
    }),
    responder,
    clock: () => AGORA,
    origemDoDreno: () => "worker",
    audita: () => {},
  };
  return { deps, responder };
}

const linha: EventRow = {
  id: "ev-1",
  organization_id: ORG,
  event_type: "agenda.group_booking_requested",
  entity_kind: "conversation",
  entity_id: "conv-1",
  payload: { channel_session_id: "canal-1", group_chat_id: "g@g.us", external_id: "wamid-1", sender_phone: "+5511987654321" },
  metadata: {},
  consumed_by: [],
  attempts: 0,
  created_at: AGORA.toISOString(),
};

function ctxDireto(db: SupabaseClient): McpContext {
  return {
    organizationId: ORG,
    role: "ai_operator",
    actor: { type: "ai_agent", id: "agente", role: "ai_operator" },
    apiTokenId: "tok",
    requestId: "req",
    supabase: db,
  };
}

const nomes = { servico: "Corte", profissional: () => "Bruno" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  escrita.marcar.mockReset();
  escritaQueRegistra();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("prova em par com a ferramenta real — o mesmo pedido pelo grupo e pela ferramenta direto", () => {
  it("o dublê de banco filtra: 14:00 sai da lista de livres e 13:00 fica", async () => {
    const { horariosLivresDaOrg } = await import("./consulta");
    const r = await horariosLivresDaOrg(clienteFalso(agendaDaOrg()), ORG, {
      eventTypeSlug: "corte",
      de: new Date("2026-10-29T03:00:00.000Z"),
      ate: new Date("2026-10-30T03:00:00.000Z"),
      agora: AGORA,
    });
    if (!r.ok) throw new Error(`a coleta recusou: ${r.codigo} — ${r.motivoParaOperador}`);
    const inicios = r.slots.map((s) => s.inicio.toISOString());
    expect(inicios).toContain("2026-10-29T16:00:00.000Z");
    expect(inicios).not.toContain("2026-10-29T17:00:00.000Z");
    // A jornada aberta da outra organização não vazou: nada antes das 09:00 locais.
    expect(inicios.every((i) => i >= "2026-10-29T12:00:00.000Z")).toBe(true);
  });

  it("13:00 livre: os dois lados marcam o MESMO instante, para a mesma org e o mesmo cliente", async () => {
    // Lado 1: pelo grupo.
    const g = depsDoGrupo(clienteFalso(agendaDaOrg()), "13:00");
    await atendePedidoDeAgendaPeloGrupo(g.deps, linha);
    expect(escrita.marcar).toHaveBeenCalledTimes(1);
    const [, metaGrupo, corpoGrupo] = escrita.marcar.mock.calls[0]!;
    const resultadoGrupo = await escrita.marcar.mock.results[0]!.value;

    // Lado 2: a ferramenta direto, com o que o texto pede.
    escrita.marcar.mockClear();
    const direto = await crmFindAndBookAppointment.handler(
      { event_type_slug: "corte", dia: HOJE, horario: "13:00", contact_id: CONTATO },
      ctxDireto(clienteFalso(agendaDaOrg())),
    );
    expect(escrita.marcar).toHaveBeenCalledTimes(1);
    const [, metaDireto, corpoDireto] = escrita.marcar.mock.calls[0]!;

    expect(metaGrupo.organization_id).toBe(ORG);
    expect(metaDireto.organization_id).toBe(ORG);
    expect(corpoGrupo).toMatchObject({ event_type_id: TIPO, starts_at: "2026-10-29T16:00:00.000Z", contact_id: CONTATO });
    expect(corpoGrupo).toEqual(corpoDireto);
    // Só o lado do grupo leva a chave do pedido (o reprocessamento não marca duas vezes).
    expect(typeof metaGrupo.idempotencyKey).toBe("string");

    const b = desfechoDaFerramenta(direto, "marcado", nomes);
    expect(b).toMatchObject({ ok: true, appointmentId: resultadoGrupo.id, servico: "Corte", profissional: "Bruno" });

    const resposta = String((g.responder.mock.calls[0] as unknown[])[3]);
    expect(resposta).toContain("Marcado para Rafael");
    expect(resposta).toContain("13:00");
  });

  it("14:00 ocupado: nenhum dos dois lados escreve, e os dois oferecem os mesmos horários", async () => {
    const g = depsDoGrupo(clienteFalso(agendaDaOrg()), "14:00");
    await atendePedidoDeAgendaPeloGrupo(g.deps, linha);
    expect(escrita.marcar).not.toHaveBeenCalled();

    const direto = await crmFindAndBookAppointment.handler(
      { event_type_slug: "corte", dia: HOJE, horario: "14:00", contact_id: CONTATO },
      ctxDireto(clienteFalso(agendaDaOrg())),
    );
    expect(escrita.marcar).not.toHaveBeenCalled();

    const b = desfechoDaFerramenta(direto, "marcado", nomes);
    expect(b.ok).toBe(false);
    if (b.ok || !("alternativas" in b)) throw new Error(`desfecho inesperado: ${JSON.stringify(b)}`);
    expect(b.motivo).toBe("horario_indisponivel");
    const alternativas = b.alternativas;
    expect(alternativas).not.toContain("14:00");
    expect(alternativas.length).toBeGreaterThan(0);

    const resposta = String((g.responder.mock.calls[0] as unknown[])[3]);
    expect(resposta).toContain("não está livre");
    expect(resposta).not.toContain("Marcado para");
    // O grupo ouve as alternativas que a ferramenta deu direto.
    for (const alt of alternativas.slice(0, 3)) expect(resposta).toContain(alt);
  });
});
