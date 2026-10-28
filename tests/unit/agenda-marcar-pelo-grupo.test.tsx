/**
 * MARCAR PELO GRUPO — a fiação da tela de Agenda › Avisos (issue #4).
 *
 * A regra mora em `lib/agenda/numeros-autorizados.ts` e
 * `lib/agenda/rascunho-do-aviso-de-agendamento.ts`, com teste próprio. Este
 * arquivo prova que a tela passa por elas e que o PUT leva o que elas deixaram:
 * desligado em organização nova, indisponível sem grupo, número normalizado,
 * repetido recusado com frase, e remoção.
 *
 * Os hooks são mocados; o componente é renderizado de verdade.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstadoDaTelaDoAvisoDeAgendamento } from "@/lib/agenda/tela-do-aviso-de-agendamento";

const { consulta, salvar } = vi.hoisted(() => ({ consulta: vi.fn(), salvar: vi.fn() }));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/agenda/useAvisoDeAgendamento", () => ({
  CHAVE_DO_AVISO_DE_AGENDAMENTO: ["agenda-aviso-de-agendamento"],
  useAvisoDeAgendamento: () => consulta(),
  useGruposDaConexao: () => ({
    data: [{ chatId: GRUPO, subject: "Equipe da agenda", presente: true }],
    isLoading: false,
    isError: false,
  }),
  useSalvarAvisoDeAgendamento: () => ({ mutateAsync: salvar, isPending: false }),
  useTestarAvisoDeAgendamento: () => ({ mutateAsync: vi.fn(), isPending: false, data: undefined }),
}));

import { AvisoDeAgendamento } from "@/app/app/agenda/avisos/_components/AvisoDeAgendamento";

const CONEXAO = "11111111-1111-4111-8111-111111111111";
const GRUPO = "120363000000000001@g.us";

function estado(config: Partial<NonNullable<EstadoDaTelaDoAvisoDeAgendamento["config"]>> | null) {
  return {
    config:
      config === null
        ? null
        : {
            usa_numero_do_aviso_de_caso: false,
            channel_session_id: CONEXAO,
            telefone: "+5531998966398",
            grupo: GRUPO,
            marcar_pelo_grupo: false,
            numeros_autorizados: [],
            ligado: true,
            atualizado_em: "2026-10-26T12:00:00.000Z",
            ...config,
          },
    aviso_de_caso: null,
    conexoes: [{ id: CONEXAO, nome: "Agenda", status: "WORKING", aceitaMensagemLivre: true }],
    entregas: [],
    fuso: "America/Sao_Paulo",
  } as EstadoDaTelaDoAvisoDeAgendamento;
}

function montar(e: EstadoDaTelaDoAvisoDeAgendamento) {
  consulta.mockReturnValue({ data: e, isLoading: false, error: null });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AvisoDeAgendamento />
    </QueryClientProvider>,
  );
}

const interruptor = () => screen.getByRole("switch", { name: "Marcar horário pelo grupo" });

beforeEach(() => {
  vi.clearAllMocks();
  salvar.mockResolvedValue({});
});
afterEach(cleanup);

describe("marcar pelo grupo na tela do aviso (issue #4)", () => {
  it("organização nova: o interruptor está desligado e indisponível, com a explicação", () => {
    montar(estado(null));
    expect(interruptor().getAttribute("aria-checked")).toBe("false");
    expect(interruptor().hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("marcar-pelo-grupo-explicacao").textContent).toContain(
      "escolha antes o grupo que recebe os avisos",
    );
  });

  it("com grupo, liga, adiciona número normalizado, recusa o repetido e salva a lista", async () => {
    montar(estado({}));
    expect(interruptor().hasAttribute("disabled")).toBe(false);
    fireEvent.click(interruptor());

    const campo = screen.getByLabelText("Quem pode marcar");
    fireEvent.change(campo, { target: { value: "+55 (31) 99111-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByTestId("numeros-autorizados").textContent).toContain("+5531991110000");

    fireEvent.change(campo, { target: { value: "55 31 9111-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByTestId("numero-autorizado-recusado").textContent).toContain("já está na lista");

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(salvar.mock.calls[0]?.[0]).toMatchObject({
      grupo: GRUPO,
      marcar_pelo_grupo: true,
      numeros_autorizados: ["+5531991110000"],
    });
  });

  it("número digitado sem o código do país entra com +55 e vai assim no PUT (issue #5)", async () => {
    montar(estado({ marcar_pelo_grupo: true }));
    fireEvent.change(screen.getByLabelText("Quem pode marcar"), { target: { value: "11 98765-4321" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(screen.getByTestId("numeros-autorizados").textContent).toContain("+5511987654321");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(salvar.mock.calls[0]?.[0]).toMatchObject({ numeros_autorizados: ["+5511987654321"] });
  });

  it("remover tira o número da lista que vai no PUT", async () => {
    montar(estado({ marcar_pelo_grupo: true, numeros_autorizados: ["+5531991110000", "+5511988887777"] }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(salvar.mock.calls[0]?.[0]).toMatchObject({ numeros_autorizados: ["+5511988887777"] });
  });
});
