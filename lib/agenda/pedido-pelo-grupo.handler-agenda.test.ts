/**
 * A porta de agenda de produção (`criarAgendaDoPedido`) — o código que o
 * dublê de `pedido-pelo-grupo-atendimento.test.ts` substitui.
 *
 * Remarcar não tem uma ferramenta "consulta-e-remarca": a conferência de
 * horário livre é feita AQUI, antes de chamar `crm_reschedule_appointment`.
 * É a única regra de agenda que esta fatia escreve, então é medida direto:
 * horário ocupado não chama a ferramenta, e o instante enviado é o do slot.
 * Marcar leva a chave do pedido até a ferramenta (o reprocessamento não marca
 * duas vezes nem se o recibo do evento se perder).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dubles = vi.hoisted(() => ({
  marcar: vi.fn(),
  remarcar: vi.fn(),
  cancelar: vi.fn(),
  livres: vi.fn(),
}));

vi.mock("@/lib/mcp/tools/agendamento", () => ({
  crmFindAndBookAppointment: { handler: dubles.marcar },
  crmRescheduleAppointment: { handler: dubles.remarcar },
  crmCancelAppointment: { handler: dubles.cancelar },
}));
vi.mock("@/lib/mcp/tools/_users", () => ({
  resolveUserNames: vi.fn(async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, "Bruno"]))),
}));
vi.mock("./consulta", () => ({
  horariosLivresDaOrg: dubles.livres,
  listaTiposDeAtendimento: vi.fn(async () => ({ ok: true, tipos: [{ id: "t1", slug: "corte", nome: "Corte" }] })),
}));

import type { AgendamentoDoCliente } from "./pedido-pelo-grupo-atendimento";
import { criarAgendaDoPedido } from "./pedido-pelo-grupo.handler";

const ORG = "org-a";
const FUSO = "America/Sao_Paulo";
const AGORA = new Date("2026-10-29T13:00:00.000Z");

const alvo: AgendamentoDoCliente = {
  id: "apt-1",
  inicio: new Date("2026-10-30T16:00:00.000Z"), // 30/10 13:00 em SP
  fuso: FUSO,
  servicoSlug: "corte",
  servicoNome: "Corte",
  profissionalId: "user-bruno",
};

const slot = (iso: string) => ({ inicio: new Date(iso), fim: new Date(new Date(iso).getTime() + 30 * 60 * 1000) });

beforeEach(() => {
  for (const f of Object.values(dubles)) f.mockReset();
});

describe("criarAgendaDoPedido.remarcar — a conferência de horário livre antes da ferramenta", () => {
  it("horário ocupado: não chama a ferramenta e devolve os livres do dia", async () => {
    dubles.livres.mockResolvedValue({
      ok: true,
      fusoDaRegra: FUSO,
      // 30/10 14:00 e 16:00 em SP, e um do dia seguinte que não pode aparecer.
      slots: [slot("2026-10-30T17:00:00.000Z"), slot("2026-10-30T19:00:00.000Z"), slot("2026-10-31T17:00:00.000Z")],
    });
    const agenda = criarAgendaDoPedido({} as never, () => AGORA);

    const r = await agenda.remarcar(ORG, { agendamento: alvo, dia: "2026-10-30", hora: "15:00" });

    expect(dubles.remarcar).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, motivo: "horario_indisponivel", alternativas: ["14:00", "16:00"] });
  });

  it("horário livre: remarca SÓ aquele agendamento, no instante do slot, ignorando o próprio horário na consulta", async () => {
    dubles.livres.mockResolvedValue({ ok: true, fusoDaRegra: FUSO, slots: [slot("2026-10-30T18:00:00.000Z")] });
    dubles.remarcar.mockResolvedValue({
      remarcado: true,
      compromisso: {
        id: "apt-1",
        starts_at: "2026-10-30T18:00:00.000Z",
        time_zone: FUSO,
        owner_user_id: "user-bruno",
        status: "confirmed",
      },
    });
    const agenda = criarAgendaDoPedido({} as never, () => AGORA);

    const r = await agenda.remarcar(ORG, { agendamento: alvo, dia: "2026-10-30", hora: "15:00" });

    expect(dubles.livres).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.objectContaining({ eventTypeSlug: "corte", ownerUserId: "user-bruno", ignorarAgendamentoId: "apt-1" }),
    );
    expect(dubles.remarcar).toHaveBeenCalledTimes(1);
    const [input, ctx] = dubles.remarcar.mock.calls[0]!;
    expect(input).toEqual({ appointment_id: "apt-1", new_starts_at: "2026-10-30T18:00:00.000Z" });
    expect(ctx.organizationId).toBe(ORG);
    expect(r).toMatchObject({ ok: true, appointmentId: "apt-1", servico: "Corte", profissional: "Bruno" });
  });

  it("'9:00' e '09:00' acham o mesmo slot", async () => {
    dubles.livres.mockResolvedValue({ ok: true, fusoDaRegra: FUSO, slots: [slot("2026-10-30T12:00:00.000Z")] });
    dubles.remarcar.mockResolvedValue({
      remarcado: true,
      compromisso: { id: "apt-1", starts_at: "2026-10-30T12:00:00.000Z", time_zone: FUSO, owner_user_id: null },
    });
    const agenda = criarAgendaDoPedido({} as never, () => AGORA);

    const r = await agenda.remarcar(ORG, { agendamento: alvo, dia: "2026-10-30", hora: "9:00" });

    expect(dubles.remarcar).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
  });

  it("agendamento sem serviço: recusa sem consultar nem remarcar", async () => {
    const agenda = criarAgendaDoPedido({} as never, () => AGORA);

    const r = await agenda.remarcar(ORG, { agendamento: { ...alvo, servicoSlug: null }, dia: "2026-10-30", hora: "15:00" });

    expect(r.ok).toBe(false);
    expect(dubles.livres).not.toHaveBeenCalled();
    expect(dubles.remarcar).not.toHaveBeenCalled();
  });

  it("recusa da consulta vira a frase da agenda, sem remarcar", async () => {
    dubles.livres.mockResolvedValue({ ok: false, codigo: "servico_inativo", motivoParaCliente: "esse serviço não está ativo." });
    const agenda = criarAgendaDoPedido({} as never, () => AGORA);

    const r = await agenda.remarcar(ORG, { agendamento: alvo, dia: "2026-10-30", hora: "15:00" });

    expect(r).toEqual({ ok: false, motivo: "servico_inativo", mensagem: "esse serviço não está ativo." });
    expect(dubles.remarcar).not.toHaveBeenCalled();
  });
});

describe("criarAgendaDoPedido.marcar e cancelar — a chave e a organização chegam à ferramenta", () => {
  it("marcar leva a chave do pedido como idempotencyKey e a organização da linha", async () => {
    dubles.marcar.mockResolvedValue({
      marcado: true,
      compromisso: { id: "apt-novo", starts_at: "2026-10-29T16:00:00.000Z", time_zone: FUSO, owner_user_id: "user-bruno" },
    });
    const agenda = criarAgendaDoPedido({} as never, () => AGORA);

    await agenda.marcar(ORG, {
      servicoSlug: "corte",
      dia: "2026-10-29",
      hora: "13:00",
      contactId: "contato-rafael",
      profissionalId: null,
      chave: "agenda-pelo-grupo:wamid-1",
    });

    const [input, ctx] = dubles.marcar.mock.calls[0]!;
    expect(input).toEqual({ event_type_slug: "corte", dia: "2026-10-29", horario: "13:00", contact_id: "contato-rafael" });
    expect(ctx).toMatchObject({ organizationId: ORG, idempotencyKey: "agenda-pelo-grupo:wamid-1" });
  });

  it("cancelar mexe só no agendamento apontado", async () => {
    dubles.cancelar.mockResolvedValue({
      cancelado: true,
      compromisso: { id: "apt-1", starts_at: alvo.inicio.toISOString(), time_zone: FUSO, owner_user_id: "user-bruno" },
    });
    const agenda = criarAgendaDoPedido({} as never, () => AGORA);

    const r = await agenda.cancelar(ORG, { agendamento: alvo, motivo: "Cancelado pelo grupo do WhatsApp" });

    expect(dubles.cancelar).toHaveBeenCalledTimes(1);
    expect(dubles.cancelar.mock.calls[0]![0]).toEqual({ appointment_id: "apt-1", reason: "Cancelado pelo grupo do WhatsApp" });
    expect(dubles.cancelar.mock.calls[0]![1].organizationId).toBe(ORG);
    expect(r).toMatchObject({ ok: true, appointmentId: "apt-1" });
  });
});
