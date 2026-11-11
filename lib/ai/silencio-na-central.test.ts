import { describe, expect, it, vi } from "vitest";

import { anexarAcoesDoSilencio } from "./silencio-na-central";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";

function admin(linhas: Array<{ id: string; contact_id: string }>) {
  const filtros: Record<string, unknown> = {};
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      filtros[c] = v;
      return q;
    },
    in: (c: string, v: unknown) => {
      filtros[c] = v;
      return Promise.resolve({ data: linhas, error: null });
    },
  };
  const from = vi.fn(() => q);
  return { cliente: { from } as never, from, filtros };
}

const aviso = (extra: Record<string, unknown> = {}) => ({
  id: "a1", kind: "silencio_mensagem_pessoal", ref_kind: "conversation", ref_id: CONVERSA, status: "open", ...extra,
});

describe("anexarAcoesDoSilencio", () => {
  it("aviso aberto ganha a conversa, o contato e a permissão de marcar", async () => {
    const a = admin([{ id: CONVERSA, contact_id: CONTATO }]);
    const [item] = await anexarAcoesDoSilencio(a.cliente, ORG, "manager", [aviso()]);
    expect(item).toMatchObject({
      silencio_pessoal: { conversation_id: CONVERSA, contact_id: CONTATO, pode_marcar_pessoal: true },
    });
    expect(a.filtros["organization_id"]).toBe(ORG);
  });

  it("atendente não pode marcar como pessoal (só gerente e dono)", async () => {
    const a = admin([{ id: CONVERSA, contact_id: CONTATO }]);
    const [item] = await anexarAcoesDoSilencio(a.cliente, ORG, "agent", [aviso()]);
    expect((item as { silencio_pessoal: { pode_marcar_pessoal: boolean } }).silencio_pessoal.pode_marcar_pessoal).toBe(false);
  });

  it("aviso de outro tipo, resolvido ou sem conversa não ganha nada, e nem consulta o banco", async () => {
    const a = admin([]);
    const itens = [aviso({ kind: "handoff" }), aviso({ status: "resolved" }), aviso({ ref_id: null })];
    const saida = await anexarAcoesDoSilencio(a.cliente, ORG, "admin", itens);
    expect(saida).toEqual(itens);
    expect(a.from).not.toHaveBeenCalled();
  });

  it("conversa que a organização não tem: sem ações", async () => {
    const a = admin([]);
    const [item] = await anexarAcoesDoSilencio(a.cliente, ORG, "admin", [aviso()]);
    expect(item).not.toHaveProperty("silencio_pessoal");
  });
});
