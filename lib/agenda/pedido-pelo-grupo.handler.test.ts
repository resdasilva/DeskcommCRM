/**
 * A leitura do retorno das ferramentas de agenda do agente (`desfechoDaFerramenta`).
 *
 * A PROVA EM PAR mora em `pedido-pelo-grupo.prova-em-par.test.ts`, com a
 * ferramenta real dos dois lados: um par com a ferramenta dublada compararia o
 * dublê com ele mesmo.
 */
import { describe, expect, it, vi } from "vitest";

// O módulo da ponte importa as ferramentas e a consulta; aqui só a leitura pura é medida.
vi.mock("@/lib/mcp/tools/agendamento", () => ({
  crmFindAndBookAppointment: { handler: vi.fn() },
  crmRescheduleAppointment: { handler: vi.fn() },
  crmCancelAppointment: { handler: vi.fn() },
}));
vi.mock("@/lib/mcp/tools/_users", () => ({ resolveUserNames: vi.fn() }));
vi.mock("./consulta", () => ({ horariosLivresDaOrg: vi.fn(), listaTiposDeAtendimento: vi.fn() }));

import { desfechoDaFerramenta } from "./pedido-pelo-grupo.handler";

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
