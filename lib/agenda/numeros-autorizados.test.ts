import { describe, expect, it } from "vitest";

import { adicionarNumeroAutorizado, removerNumeroAutorizado } from "./numeros-autorizados";

describe("quem pode marcar pelo grupo (issue #4)", () => {
  it("normaliza o que a pessoa digitou para +dígitos", () => {
    expect(adicionarNumeroAutorizado([], "+55 (31) 99111-0000")).toEqual({ lista: ["+5531991110000"] });
  });

  it("celular brasileiro sem o código do país assume +55 (issue #5)", () => {
    expect(adicionarNumeroAutorizado([], "11 98765-4321")).toEqual({ lista: ["+5511987654321"] });
    expect(adicionarNumeroAutorizado([], "(31) 3232-1010")).toEqual({ lista: ["+553132321010"] });
  });

  it("número estrangeiro com + continua aceito como está", () => {
    expect(adicionarNumeroAutorizado([], "+1 212 555 0123")).toEqual({ lista: ["+12125550123"] });
    expect(adicionarNumeroAutorizado([], "+351 912 345 678")).toEqual({ lista: ["+351912345678"] });
  });

  it("10 ou 11 dígitos sem DDD brasileiro real não ganham +55", () => {
    // 20 e 23 não são DDD; o número segue a regra de antes (+ e dígitos).
    expect(adicionarNumeroAutorizado([], "20 98765-4321")).toEqual({ lista: ["+20987654321"] });
    expect(adicionarNumeroAutorizado([], "2398765432")).toEqual({ lista: ["+2398765432"] });
  });

  it("sem +55 também é recusado como repetido quando já está na lista", () => {
    expect(adicionarNumeroAutorizado(["+5511987654321"], "11 98765-4321")).toEqual({ recusa: "repetido" });
  });

  it("número incompleto é recusado como inválido", () => {
    expect(adicionarNumeroAutorizado([], "3199")).toEqual({ recusa: "invalido" });
    expect(adicionarNumeroAutorizado([], "")).toEqual({ recusa: "invalido" });
  });

  it("o mesmo número é recusado como repetido, inclusive sem o nono dígito", () => {
    const lista = ["+5531991110000"];
    expect(adicionarNumeroAutorizado(lista, "5531991110000")).toEqual({ recusa: "repetido" });
    expect(adicionarNumeroAutorizado(lista, "+55 31 9111-0000")).toEqual({ recusa: "repetido" });
  });

  it("número diferente entra no fim, sem mexer nos outros", () => {
    expect(adicionarNumeroAutorizado(["+5531991110000"], "+5511988887777")).toEqual({
      lista: ["+5531991110000", "+5511988887777"],
    });
  });

  it("remover tira só o número pedido", () => {
    expect(removerNumeroAutorizado(["+5531991110000", "+5511988887777"], "+5531991110000")).toEqual(["+5511988887777"]);
  });
});
