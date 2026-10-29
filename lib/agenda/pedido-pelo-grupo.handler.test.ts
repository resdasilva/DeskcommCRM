/**
 * A ponte entre o pedido do grupo e as ferramentas de agenda do agente, e a
 * PROVA EM PAR (`docs/doctrine/prova-em-par.md`): o mesmo texto cru pelo grupo
 * e pela ferramenta chamada direto tem de dar o mesmo resultado.
 *
 * A ferramenta aqui é dublada no nível do handler MCP — a mesma fronteira que
 * o agente cruza. O lado "pela tela" do par é do QA, num ambiente real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ferramentas = vi.hoisted(() => {
  // A agenda de mentira: 13:00 livre, 14:00 ocupado — para o grupo E para a chamada direta.
  const marcar = vi.fn(async (input: { horario: string; contact_id: string }, ctx: { organizationId: string }) => {
    if (input.horario === "13:00") {
      return {
        marcado: true,
        aguarda_confirmacao: false,
        compromisso: {
          id: `apt-${ctx.organizationId}`,
          starts_at: "2026-10-29T16:00:00.000Z",
          time_zone: "America/Sao_Paulo",
          owner_user_id: "user-bruno",
          title: "Corte",
          status: "confirmed",
        },
      };
    }
    return {
      marcado: false,
      motivo: "horario_indisponivel",
      fuso_da_regra: "America/Sao_Paulo",
      horarios: [{ inicio: "2026-10-29T18:00:00.000Z", quando: "Qui 29/10 às 15:00" }],
      mensagem: "não está livre",
    };
  });
  return { marcar };
});

vi.mock("@/lib/mcp/tools/agendamento", () => ({
  crmFindAndBookAppointment: { handler: ferramentas.marcar },
  crmRescheduleAppointment: { handler: vi.fn() },
  crmCancelAppointment: { handler: vi.fn() },
}));
vi.mock("@/lib/mcp/tools/_users", () => ({
  resolveUserNames: vi.fn(async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, "Bruno"]))),
}));
vi.mock("./consulta", () => ({
  horariosLivresDaOrg: vi.fn(),
  listaTiposDeAtendimento: vi.fn(async () => ({ ok: true, tipos: [{ id: "t1", slug: "corte", nome: "Corte" }] })),
}));

import type { EventRow } from "@/lib/event-log/dispatcher";

import { atendePedidoDeAgendaPeloGrupo, type DecisaoDoPedido, type PedidoPeloGrupoDeps } from "./pedido-pelo-grupo-atendimento";
import { criarAgendaDoPedido, desfechoDaFerramenta } from "./pedido-pelo-grupo.handler";

const ORG = "org-a";
const AGORA = new Date("2026-10-29T13:00:00.000Z");

beforeEach(() => {
  ferramentas.marcar.mockClear();
});

describe("desfechoDaFerramenta — o retorno da ferramenta lido sem palpite", () => {
  const nomes = { servico: "Corte", profissional: () => "Bruno" };

  it("marcado vira ok com o instante, o fuso e quem atende", () => {
    const d = desfechoDaFerramenta(
      {
        marcado: true,
        compromisso: { id: "a1", starts_at: "2026-10-29T16:00:00.000Z", time_zone: "America/Sao_Paulo", owner_user_id: "u" },
      },
      "marcado",
      nomes,
    );
    expect(d).toMatchObject({ ok: true, appointmentId: "a1", servico: "Corte", profissional: "Bruno", aguardaConfirmacao: false });
  });

  it("compromisso pendente é reserva, não confirmação", () => {
    const d = desfechoDaFerramenta(
      { marcado: true, compromisso: { id: "a1", starts_at: "2026-10-29T16:00:00.000Z", status: "pending" } },
      "marcado",
      nomes,
    );
    expect(d).toMatchObject({ ok: true, aguardaConfirmacao: true });
  });

  it("as duas grafias de indisponível viram a mesma recusa, com os livres em HH:mm", () => {
    for (const motivo of ["horario_indisponivel", "agenda_horario_indisponivel"]) {
      const d = desfechoDaFerramenta(
        {
          marcado: false,
          motivo,
          fuso_da_regra: "America/Sao_Paulo",
          horarios: [{ inicio: "2026-10-29T17:30:00.000Z" }],
        },
        "marcado",
        nomes,
      );
      expect(d).toEqual({ ok: false, motivo: "horario_indisponivel", alternativas: ["14:30"] });
    }
  });

  it("outra recusa leva a frase da ferramenta", () => {
    const d = desfechoDaFerramenta({ cancelado: false, motivo: "agenda_ja_cancelado", mensagem: "já estava desmarcado" }, "cancelado", nomes);
    expect(d).toEqual({ ok: false, motivo: "agenda_ja_cancelado", mensagem: "já estava desmarcado" });
  });

  it("'marcado: true' sem compromisso não é sucesso", () => {
    expect(desfechoDaFerramenta({ marcado: true }, "marcado", nomes).ok).toBe(false);
    expect(desfechoDaFerramenta("lixo", "marcado", nomes).ok).toBe(false);
  });
});

describe("prova em par — o mesmo texto pelo grupo e pela ferramenta direto", () => {
  /** O que o modelo extrairia de cada texto cru. Fixo aqui: o par mede a camada de baixo. */
  const CASOS = [
    { texto: "Rafael às 13 horas, corte", hora: "13:00", esperado: "marcado" },
    { texto: "Rafael às 14 horas, corte", hora: "14:00", esperado: "horario_indisponivel" },
  ] as const;

  function depsDoGrupo(texto: string, hora: string) {
    const recibos = new Map<string, DecisaoDoPedido>();
    const responder = vi.fn(async () => ({ status: "ok" as const }));
    const deps: PedidoPeloGrupoDeps = {
      db: {
        marcacaoPeloGrupo: async () => ({ grupo: "g@g.us", ligado: true, autorizados: ["+5511987654321"] }),
        textoDaMensagem: async () => texto,
        contexto: async () => ({
          fuso: "America/Sao_Paulo",
          hoje: "2026-10-29",
          hojeRotulo: "Qui 29/10",
          servicos: [{ slug: "corte", nome: "Corte" }],
          profissionais: [{ id: "user-bruno", nome: "Bruno" }],
        }),
        clientesPorNome: async () => [{ id: "contato-rafael", nome: "Rafael" }],
        clientesParecidos: async () => [],
        criaCliente: async () => {
          throw new Error("não deveria criar");
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
      agenda: criarAgendaDoPedido({} as never, () => AGORA),
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

  it.each(CASOS)("$texto → $esperado pelos dois lados", async ({ texto, hora, esperado }) => {
    // Lado 1: pelo grupo.
    const g = depsDoGrupo(texto, hora);
    await atendePedidoDeAgendaPeloGrupo(g.deps, linha);
    expect(ferramentas.marcar).toHaveBeenCalledTimes(1);
    const [argsDoGrupo, ctxDoGrupo] = ferramentas.marcar.mock.calls[0]!;
    expect(ctxDoGrupo.organizationId).toBe(ORG);
    const pelaFerramentaViaGrupo = await ferramentas.marcar.mock.results[0]!.value;

    // Lado 2: a ferramenta chamada direto, com o que o texto pede.
    const direto = await ferramentas.marcar(
      { event_type_slug: "corte", dia: "2026-10-29", horario: hora, contact_id: "contato-rafael" } as never,
      { organizationId: ORG } as never,
    );

    expect(argsDoGrupo).toEqual({ event_type_slug: "corte", dia: "2026-10-29", horario: hora, contact_id: "contato-rafael" });
    const nomes = { servico: "Corte", profissional: () => "Bruno" };
    const a = desfechoDaFerramenta(pelaFerramentaViaGrupo, "marcado", nomes);
    const b = desfechoDaFerramenta(direto, "marcado", nomes);
    expect(a).toEqual(b);
    expect(a.ok ? "marcado" : a.motivo).toBe(esperado);

    // E o grupo ouviu o mesmo desfecho que a ferramenta deu.
    const resposta = String((g.responder.mock.calls[0] as unknown[])[3]);
    expect(resposta).toContain(esperado === "marcado" ? "Marcado para Rafael" : "não está livre");
  });
});
