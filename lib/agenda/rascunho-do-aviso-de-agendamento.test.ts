import { describe, expect, it } from "vitest";

import {
  SEM_GRUPO,
  conexaoQueEnviaDoRascunho,
  mudarRascunhoDoAviso,
  type RascunhoDoAvisoDeAgendamento,
} from "./rascunho-do-aviso-de-agendamento";

const CASO = { channel_session_id: "conexao-do-caso" };

function rascunho(
  parcial: Partial<RascunhoDoAvisoDeAgendamento> = {},
): RascunhoDoAvisoDeAgendamento {
  return {
    usaNumeroDoCaso: false,
    canal: "conexao-a",
    telefone: "+5511999990000",
    grupo: "120363000000000001@g.us",
    ligado: true,
    ...parcial,
  };
}

describe("o grupo escolhido acompanha a conexão que envia (R1, issue #1)", () => {
  it("trocar a conexão zera o grupo, que era da conexão anterior", () => {
    const depois = mudarRascunhoDoAviso(rascunho(), { canal: "conexao-b" }, CASO);
    expect(depois.canal).toBe("conexao-b");
    expect(depois.grupo).toBe(SEM_GRUPO);
  });

  it("ligar 'usar o número do aviso de caso' troca a conexão e zera o grupo", () => {
    const depois = mudarRascunhoDoAviso(rascunho(), { usaNumeroDoCaso: true }, CASO);
    expect(conexaoQueEnviaDoRascunho(depois, CASO)).toBe("conexao-do-caso");
    expect(depois.grupo).toBe(SEM_GRUPO);
  });

  it("desligar 'usar o número do aviso de caso' volta à conexão própria e zera o grupo", () => {
    const antes = rascunho({ usaNumeroDoCaso: true });
    const depois = mudarRascunhoDoAviso(antes, { usaNumeroDoCaso: false }, CASO);
    expect(depois.grupo).toBe(SEM_GRUPO);
  });

  it("escolher a mesma conexão de novo mantém o grupo", () => {
    const depois = mudarRascunhoDoAviso(rascunho(), { canal: "conexao-a" }, CASO);
    expect(depois.grupo).toBe("120363000000000001@g.us");
  });

  it("mudar o telefone, o grupo ou o liga/desliga não mexe no resto", () => {
    expect(mudarRascunhoDoAviso(rascunho(), { telefone: "+5511888880000" }, CASO).grupo).toBe(
      "120363000000000001@g.us",
    );
    expect(mudarRascunhoDoAviso(rascunho(), { grupo: "120363000000000002@g.us" }, CASO).grupo).toBe(
      "120363000000000002@g.us",
    );
    expect(mudarRascunhoDoAviso(rascunho(), { ligado: false }, CASO).grupo).toBe(
      "120363000000000001@g.us",
    );
  });

  it("sem aviso de caso, o switch não troca a conexão e o grupo fica", () => {
    const depois = mudarRascunhoDoAviso(rascunho(), { usaNumeroDoCaso: true }, null);
    expect(conexaoQueEnviaDoRascunho(depois, null)).toBe("conexao-a");
    expect(depois.grupo).toBe("120363000000000001@g.us");
  });

  it("sem conexão escolhida não há conexão que envia", () => {
    expect(conexaoQueEnviaDoRascunho(rascunho({ canal: "" }), null)).toBeNull();
  });
});
