import { describe, expect, it } from "vitest";

import { ehPedidoDeAgendaPeloGrupo, type MarcacaoPeloGrupo, type MensagemDoGrupo } from "./pedido-pelo-grupo";

const config = (o: Partial<MarcacaoPeloGrupo> = {}): MarcacaoPeloGrupo => ({
  grupo: "120363000000000001@g.us",
  ligado: true,
  autorizados: ["+5531991110000"],
  ...o,
});
const msg = (o: Partial<MensagemDoGrupo> = {}): MensagemDoGrupo => ({
  groupChatId: "120363000000000001@g.us",
  direction: "inbound",
  telefoneDoRemetente: "+5531991110000",
  ...o,
});

describe("pedido de agenda pelo grupo (issue #5)", () => {
  it("número autorizado, no grupo do aviso, com o recurso ligado: é pedido", () => {
    expect(ehPedidoDeAgendaPeloGrupo(config(), msg())).toBe(true);
  });

  it("autorizado salvo com o nono dígito casa com o remetente que chega sem ele", () => {
    expect(ehPedidoDeAgendaPeloGrupo(config(), msg({ telefoneDoRemetente: "+553191110000" }))).toBe(true);
  });

  it("número não autorizado não é pedido", () => {
    expect(ehPedidoDeAgendaPeloGrupo(config(), msg({ telefoneDoRemetente: "+5511988887777" }))).toBe(false);
  });

  it("outro grupo não é pedido, mesmo com número autorizado", () => {
    expect(ehPedidoDeAgendaPeloGrupo(config(), msg({ groupChatId: "120363999999999999@g.us" }))).toBe(false);
  });

  it("recurso desligado não é pedido", () => {
    expect(ehPedidoDeAgendaPeloGrupo(config({ ligado: false }), msg())).toBe(false);
  });

  it("mensagem enviada do próprio celular (fromMe) não é pedido", () => {
    expect(ehPedidoDeAgendaPeloGrupo(config(), msg({ direction: "outbound" }))).toBe(false);
  });

  it("sem aviso configurado, sem grupo ou remetente sem telefone: não é pedido", () => {
    expect(ehPedidoDeAgendaPeloGrupo(null, msg())).toBe(false);
    expect(ehPedidoDeAgendaPeloGrupo(config({ grupo: null }), msg())).toBe(false);
    expect(ehPedidoDeAgendaPeloGrupo(config(), msg({ telefoneDoRemetente: null }))).toBe(false);
  });

  it("lista vazia não autoriza ninguém", () => {
    expect(ehPedidoDeAgendaPeloGrupo(config({ autorizados: [] }), msg())).toBe(false);
  });
});
