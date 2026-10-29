import { describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/event-log/dispatcher";

import {
  atendePedidoDeAgendaPeloGrupo,
  type AgendaDoPedido,
  type AgendamentoDoCliente,
  type DecisaoDoPedido,
  type DesfechoDaAgenda,
  type PedidoPeloGrupoDb,
  type PedidoPeloGrupoDeps,
} from "./pedido-pelo-grupo-atendimento";
import type { ExtracaoDoPedido, LeituraDoPedido } from "./pedido-pelo-grupo-extracao";

const ORG = "org-a";
const GRUPO = "120363000000000000@g.us";
const DONO = "+5511987654321";
const FUSO = "America/Sao_Paulo";
// 29/10/2026, 10:00 em São Paulo.
const AGORA = new Date("2026-10-29T13:00:00.000Z");

function linha(over: Partial<EventRow> = {}): EventRow {
  return {
    id: "ev-1",
    organization_id: ORG,
    event_type: "agenda.group_booking_requested",
    entity_kind: "conversation",
    entity_id: "conv-1",
    payload: { channel_session_id: "canal-1", group_chat_id: GRUPO, external_id: "wamid-1", sender_phone: DONO },
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: AGORA.toISOString(),
    ...over,
  };
}

function extracao(over: Partial<ExtracaoDoPedido>): ExtracaoDoPedido {
  return {
    acao: "marcar",
    cliente: null,
    servico: null,
    dia: null,
    hora: null,
    profissional: null,
    dia_atual: null,
    hora_atual: null,
    ...over,
  };
}

const marcadoOk = (over: Partial<Extract<DesfechoDaAgenda, { ok: true }>> = {}): DesfechoDaAgenda => ({
  ok: true,
  appointmentId: "apt-novo",
  inicio: new Date("2026-10-29T16:00:00.000Z"), // 13:00 em SP
  fuso: FUSO,
  servico: "Corte",
  profissional: "Bruno",
  aguardaConfirmacao: false,
  ...over,
});

/** Um banco em memória: o recibo é de verdade (uma execução por chave). */
function montar(opts: {
  leitura?: LeituraDoPedido | (() => LeituraDoPedido);
  texto?: string | null;
  clientes?: Array<{ id: string; nome: string }>;
  vivos?: AgendamentoDoCliente[];
  agenda?: Partial<AgendaDoPedido>;
  ligado?: boolean;
  origem?: "worker" | "request";
}) {
  const orgsVistas: string[] = [];
  const vista = (org: string) => {
    orgsVistas.push(org);
  };
  const recibos = new Map<string, DecisaoDoPedido>();
  const db: PedidoPeloGrupoDb = {
    marcacaoPeloGrupo: vi.fn(async (org) => {
      vista(org);
      return { grupo: GRUPO, ligado: opts.ligado ?? true, autorizados: [DONO] };
    }),
    textoDaMensagem: vi.fn(async (org) => {
      vista(org);
      return opts.texto === undefined ? "Rafael às 13 horas, corte" : opts.texto;
    }),
    contexto: vi.fn(async (org) => {
      vista(org);
      return {
        fuso: FUSO,
        hoje: "2026-10-29",
        hojeRotulo: "Qui 29/10",
        servicos: [
          { slug: "corte", nome: "Corte" },
          { slug: "barba", nome: "Barba" },
        ],
        profissionais: [{ id: "user-bruno", nome: "Bruno" }],
      };
    }),
    clientesPorNome: vi.fn(async (org) => {
      vista(org);
      return opts.clientes ?? [{ id: "contato-rafael", nome: "Rafael" }];
    }),
    criaCliente: vi.fn(async (org, nome) => {
      vista(org);
      return { id: "contato-novo", nome };
    }),
    agendamentosVivos: vi.fn(async (org) => {
      vista(org);
      return opts.vivos ?? [];
    }),
    comRecibo: vi.fn(async (org, chave, executar) => {
      vista(org);
      const k = `${org}:${chave}`;
      const ja = recibos.get(k);
      if (ja) return { tipo: "replay" as const, decisao: ja };
      const decisao = await executar();
      recibos.set(k, decisao);
      return { tipo: "executou" as const, decisao };
    }),
  };
  const agenda: AgendaDoPedido = {
    marcar: vi.fn(async (org) => {
      vista(org);
      return marcadoOk();
    }),
    remarcar: vi.fn(async (org) => {
      vista(org);
      return marcadoOk({ appointmentId: "apt-1", inicio: new Date("2026-10-30T18:00:00.000Z") });
    }),
    cancelar: vi.fn(async (org) => {
      vista(org);
      return marcadoOk({ appointmentId: "apt-1" });
    }),
    ...opts.agenda,
  };
  const leitura = opts.leitura ?? {
    ok: true,
    bruto: extracao({ cliente: "Rafael", servico: "corte", hora: "13:00" }),
  };
  const lerPedido = vi.fn(async () => (typeof leitura === "function" ? leitura() : leitura));
  const responder = vi.fn(async () => ({ status: "ok" as const }));
  const audita = vi.fn();
  const deps: PedidoPeloGrupoDeps = {
    db,
    agenda,
    lerPedido,
    responder,
    clock: () => AGORA,
    origemDoDreno: () => opts.origem ?? "worker",
    audita,
  };
  return { deps, db, agenda, lerPedido, responder, audita, orgsVistas };
}

const resposta = (responder: ReturnType<typeof montar>["responder"]) =>
  String((responder.mock.calls[0] as unknown[] | undefined)?.[3] ?? "");

describe("pedido de agenda pelo grupo — marcar", () => {
  it("cliente, serviço e hora livre: marca e responde com cliente, serviço, dia, hora e profissional", async () => {
    const t = montar({});
    const d = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());

    expect(d.status).toBe("ok");
    expect(t.agenda.marcar).toHaveBeenCalledTimes(1);
    expect(t.agenda.marcar).toHaveBeenCalledWith(ORG, {
      servicoSlug: "corte",
      // Sem dia no texto: hoje, no relógio da organização.
      dia: "2026-10-29",
      hora: "13:00",
      contactId: "contato-rafael",
      profissionalId: null,
      chave: "agenda-pelo-grupo:wamid-1",
    });
    expect(t.responder).toHaveBeenCalledWith(ORG, "canal-1", GRUPO, expect.any(String));
    const texto = resposta(t.responder);
    for (const parte of ["Rafael", "Corte", "29/10", "13:00", "Bruno"]) expect(texto).toContain(parte);
  });

  it("cliente que não existe vira contato novo antes de marcar", async () => {
    const t = montar({ clientes: [] });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.db.criaCliente).toHaveBeenCalledWith(ORG, "Rafael");
    expect(t.agenda.marcar).toHaveBeenCalledWith(ORG, expect.objectContaining({ contactId: "contato-novo" }));
  });

  it("tipo que pede aprovação: diz que reservou e que a equipe confirma, nunca 'marcado'", async () => {
    const t = montar({ agenda: { marcar: vi.fn(async () => marcadoOk({ aguardaConfirmacao: true })) } });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(resposta(t.responder)).toContain("aguardando a equipe confirmar");
    expect(resposta(t.responder)).not.toContain("Marcado");
  });
});

describe("pedido de agenda pelo grupo — incompleto ou ocupado não marca nada", () => {
  it("sem hora: pergunta o que falta e não chama a agenda", async () => {
    const t = montar({ leitura: { ok: true, bruto: extracao({ cliente: "Rafael", servico: "corte" }) } });
    const d = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(d.status).toBe("ok");
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("faltou a hora");
  });

  it("sem cliente e sem serviço: pergunta os dois", async () => {
    const t = montar({ leitura: { ok: true, bruto: extracao({ hora: "13:00" }) } });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("o cliente, o serviço");
  });

  it("horário ocupado: não marca e oferece os livres do dia", async () => {
    const t = montar({
      agenda: {
        marcar: vi.fn(async () => ({ ok: false as const, motivo: "horario_indisponivel" as const, alternativas: ["14:00", "15:30"] })),
      },
    });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    const texto = resposta(t.responder);
    expect(texto).toContain("13:00 de 29/10 não está livre");
    expect(texto).toContain("14:00, 15:30");
    expect(texto).toContain("não marquei nada");
  });

  it("serviço que o modelo inventou (fora da lista) vira pergunta, nunca marcação", async () => {
    const t = montar({ leitura: { ok: true, bruto: extracao({ cliente: "Rafael", servico: "luzes", hora: "13:00" }) } });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("Corte, Barba");
  });

  it("dois clientes com o mesmo nome: pergunta qual, não escolhe", async () => {
    const t = montar({
      clientes: [
        { id: "c1", nome: "Rafael" },
        { id: "c2", nome: "Rafael" },
      ],
    });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    expect(t.db.criaCliente).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("mais de um cliente");
  });

  it("extração fora do schema: pergunta de novo, não chuta", async () => {
    const t = montar({ leitura: { ok: true, bruto: { acao: "marcar", hora: "13h" } } });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("Não entendi o pedido");
  });
});

describe("pedido de agenda pelo grupo — remarcar e cancelar", () => {
  const vivos: AgendamentoDoCliente[] = [
    {
      id: "apt-1",
      inicio: new Date("2026-10-30T16:00:00.000Z"),
      fuso: FUSO,
      servicoSlug: "corte",
      servicoNome: "Corte",
      profissionalId: "user-bruno",
    },
    {
      id: "apt-2",
      inicio: new Date("2026-11-05T16:00:00.000Z"),
      fuso: FUSO,
      servicoSlug: "barba",
      servicoNome: "Barba",
      profissionalId: "user-bruno",
    },
  ];

  it("remarcar: mexe só no agendamento apontado e confirma no grupo", async () => {
    const t = montar({
      vivos,
      leitura: { ok: true, bruto: extracao({ acao: "remarcar", cliente: "Rafael", servico: "corte", hora: "15:00" }) },
    });
    const d = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(d.status).toBe("ok");
    expect(t.agenda.remarcar).toHaveBeenCalledTimes(1);
    // Sem dia novo: o mesmo dia do agendamento (30/10).
    expect(t.agenda.remarcar).toHaveBeenCalledWith(ORG, { agendamento: vivos[0], dia: "2026-10-30", hora: "15:00" });
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    expect(t.agenda.cancelar).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("Remarcado Rafael");
  });

  it("cancelar: cancela só o apontado pelo dia e confirma", async () => {
    const t = montar({
      vivos,
      leitura: { ok: true, bruto: extracao({ acao: "cancelar", cliente: "Rafael", dia_atual: "2026-11-05" }) },
    });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.agenda.cancelar).toHaveBeenCalledTimes(1);
    expect(t.agenda.cancelar).toHaveBeenCalledWith(ORG, expect.objectContaining({ agendamento: vivos[1] }));
    expect(resposta(t.responder)).toContain("Cancelado o horário de Rafael");
  });

  it("dois agendamentos e nenhuma pista: pergunta qual e não mexe em nenhum", async () => {
    const t = montar({ vivos, leitura: { ok: true, bruto: extracao({ acao: "cancelar", cliente: "Rafael" }) } });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.agenda.cancelar).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("mais de um agendamento");
  });

  it("cliente sem agendamento futuro: avisa e não mexe", async () => {
    const t = montar({ vivos: [], leitura: { ok: true, bruto: extracao({ acao: "cancelar", cliente: "Rafael" }) } });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.agenda.cancelar).not.toHaveBeenCalled();
    expect(resposta(t.responder)).toContain("Não achei agendamento futuro de Rafael");
  });
});

describe("pedido de agenda pelo grupo — um pedido, um agendamento", () => {
  it("o mesmo evento reprocessado não marca de novo: o recibo devolve a decisão e a resposta sai de novo", async () => {
    const t = montar({});
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    const segunda = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());

    expect(segunda.status).toBe("ok");
    expect(segunda.detail).toContain("replay");
    expect(t.agenda.marcar).toHaveBeenCalledTimes(1);
    expect(t.lerPedido).toHaveBeenCalledTimes(1);
    expect(t.responder).toHaveBeenCalledTimes(2);
    // A auditoria é da DECISÃO: uma linha, não uma por rodada.
    expect(t.audita).toHaveBeenCalledTimes(1);
  });

  it("toda leitura e escrita usa a organização da linha do event_log", async () => {
    const t = montar({ clientes: [] });
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.orgsVistas.length).toBeGreaterThan(5);
    expect(new Set(t.orgsVistas)).toEqual(new Set([ORG]));
  });

  it("a decisão é auditada sem texto nem telefone", async () => {
    const t = montar({});
    await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(t.audita).toHaveBeenCalledWith({
      organizationId: ORG,
      appointmentId: "apt-novo",
      metadata: { external_id: "wamid-1", acao: "marcar", desfecho: "marcado", appointment_id: "apt-novo", conversation_id: "conv-1", respondeu: true },
    });
    expect(JSON.stringify(t.audita.mock.calls)).not.toContain(DONO);
    expect(JSON.stringify(t.audita.mock.calls)).not.toContain("13 horas");
  });

  it("modelo fora do ar: adia sem gravar recibo, e a rodada seguinte atende", async () => {
    let vez = 0;
    const t = montar({
      leitura: () =>
        ++vez === 1
          ? { ok: false, passageiro: true, motivo: "APICallError" }
          : { ok: true, bruto: extracao({ cliente: "Rafael", servico: "corte", hora: "13:00" }) },
    });
    // O recibo em memória do dublê só grava quando `executar` termina — como o real, que libera a reserva no throw.
    const primeira = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(primeira.status).toBe("retry");
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    const segunda = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(segunda.status).toBe("ok");
    expect(t.agenda.marcar).toHaveBeenCalledTimes(1);
  });
});

describe("pedido de agenda pelo grupo — o que não é atendido", () => {
  it("mensagem que não é pedido (conversa do grupo): nada na agenda e nada no grupo", async () => {
    const t = montar({ leitura: { ok: true, bruto: extracao({ acao: "nenhuma" }) } });
    const d = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(d.status).toBe("skipped");
    expect(t.agenda.marcar).not.toHaveBeenCalled();
    expect(t.responder).not.toHaveBeenCalled();
  });

  it("recurso desligado depois da mensagem: ignora sem ler o texto", async () => {
    const t = montar({ ligado: false });
    const d = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(d).toEqual({ status: "skipped", detail: "nao_e_mais_pedido" });
    expect(t.db.textoDaMensagem).not.toHaveBeenCalled();
    expect(t.lerPedido).not.toHaveBeenCalled();
  });

  it("número que saiu da lista: ignora", async () => {
    const t = montar({});
    const d = await atendePedidoDeAgendaPeloGrupo(
      t.deps,
      linha({ payload: { ...linha().payload, sender_phone: "+5511900000000" } }),
    );
    expect(d.detail).toBe("nao_e_mais_pedido");
  });

  it("dreno dentro do webhook: adia sem chamar o modelo", async () => {
    const t = montar({ origem: "request" });
    const d = await atendePedidoDeAgendaPeloGrupo(t.deps, linha());
    expect(d.status).toBe("retry");
    expect(t.lerPedido).not.toHaveBeenCalled();
  });

  it("evento de mais de meia hora: não age sobre um pedido velho", async () => {
    const t = montar({});
    const d = await atendePedidoDeAgendaPeloGrupo(
      t.deps,
      linha({ created_at: new Date(AGORA.getTime() - 31 * 60 * 1000).toISOString() }),
    );
    expect(d.detail).toBe("evento_velho");
    expect(t.lerPedido).not.toHaveBeenCalled();
  });

  it("payload sem external_id: pula", async () => {
    const t = montar({});
    const d = await atendePedidoDeAgendaPeloGrupo(t.deps, linha({ payload: { group_chat_id: GRUPO } }));
    expect(d.detail).toBe("payload_incompleto");
  });
});
