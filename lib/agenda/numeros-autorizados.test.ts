import { describe, expect, it } from "vitest";

import { adicionarNumeroAutorizado, removerNumeroAutorizado } from "./numeros-autorizados";

describe("quem pode marcar pelo grupo (issue #4)", () => {
  it("normaliza o que a pessoa digitou para +dígitos", () => {
    expect(adicionarNumeroAutorizado([], "+55 (31) 99111-0000")).toEqual({ lista: ["+5531991110000"] });
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
