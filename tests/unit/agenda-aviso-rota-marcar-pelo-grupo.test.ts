/**
 * PUT /api/v1/agenda/aviso — a parte "marcar pelo grupo" (issue #4, 0768).
 *
 * Prova o que a ROTA faz em volta do RPC: só `admin` chega a ele, a lista é
 * recusada antes do banco quando não está em E.164, ausente vira `null`
 * ("manter o salvo"), cada recusa nova do RPC vira 422 com a sua frase, e a
 * auditoria sai uma vez, com a CONTAGEM da lista e nunca os números.
 *
 * O que o banco faz com os parâmetros (RLS, 2 organizações, repetido, sem
 * grupo) é de `tests/invariants/aviso-de-agendamento-escrita.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/agenda/tela-do-aviso-de-agendamento", () => ({
  lerEstadoDaTelaDoAvisoDeAgendamento: vi.fn(async () => ({ config: null })),
}));
vi.mock("@/lib/escalacao/numero-interno-de-aviso", () => ({ limparCacheDoNumeroInterno: vi.fn() }));

const { PUT } = await import("@/app/api/v1/agenda/aviso/route");

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const GRUPO = "120363000000000768@g.us";

function sessao(role: Role = "admin") {
  const user: AuthUser = {
    id: USER,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Org", role }],
  };
  vi.mocked(requireRole).mockImplementation(async (min: Role) => {
    if (ROLE_RANK[role] >= ROLE_RANK[min]) {
      return { ok: true, user, org: { orgId: ORG, name: "Org", role } };
    }
    return { ok: false, response: fail("forbidden_role", `Requer role >= ${min}.`, 403, {}) };
  });
}

function rpcQueDevolve(resposta: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
    data: resposta.data ?? {},
    error: resposta.error ?? null,
  }));
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  return rpc;
}

function put(body: unknown) {
  return new NextRequest("http://localhost/api/v1/agenda/aviso", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const BASE = { usa_numero_do_aviso_de_caso: true, grupo: GRUPO, ligado: true };

beforeEach(() => {
  vi.clearAllMocks();
  sessao();
});

describe("PUT /api/v1/agenda/aviso — marcar pelo grupo (issue #4)", () => {
  it.each(["manager", "agent", "viewer"] as const)("%s recebe 403 e o RPC não é chamado", async (role) => {
    sessao(role);
    const rpc = rpcQueDevolve({});
    const r = await PUT(put({ ...BASE, marcar_pelo_grupo: true, numeros_autorizados: ["+5531991110000"] }));
    expect(r.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("admin grava: os dois campos chegam ao RPC como vieram", async () => {
    const rpc = rpcQueDevolve({});
    const r = await PUT(
      put({ ...BASE, marcar_pelo_grupo: true, numeros_autorizados: ["+5531991110000", "+5511988887777"] }),
    );
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual([
      "fn_definir_aviso_de_agendamento",
      expect.objectContaining({
        p_org: ORG,
        p_grupo: GRUPO,
        p_marcar_pelo_grupo: true,
        p_numeros_autorizados: ["+5531991110000", "+5511988887777"],
      }),
    ]);
  });

  it("sem os dois campos, o RPC recebe `null` nos dois (manter o salvo)", async () => {
    const rpc = rpcQueDevolve({});
    await PUT(put(BASE));
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_marcar_pelo_grupo: null, p_numeros_autorizados: null });
  });

  it.each([["31 99111-0000"], ["5531991110000"], ["+0531991110000"], [""]])(
    "número fora de E.164 (%j) é recusado com 422 antes do banco",
    async (numero) => {
      const rpc = rpcQueDevolve({});
      const r = await PUT(put({ ...BASE, marcar_pelo_grupo: true, numeros_autorizados: [numero] }));
      expect(r.status).toBe(422);
      expect(rpc).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["aviso_de_agendamento_marcar_sem_grupo", "Para marcar pelo grupo, escolha antes o grupo que recebe os avisos."],
    [
      "aviso_de_agendamento_numero_autorizado_invalido",
      "Um dos números autorizados não é válido. Use o código do país, por exemplo +55 31 99999-8888.",
    ],
    ["aviso_de_agendamento_numero_autorizado_repetido", "Esse número já está na lista de quem pode marcar."],
  ])("a recusa %s do RPC vira 422 com a frase dela, sem auditoria", async (nome, frase) => {
    rpcQueDevolve({ error: { message: nome } });
    const r = await PUT(put({ ...BASE, marcar_pelo_grupo: true, numeros_autorizados: ["+5531991110000"] }));
    expect(r.status).toBe(422);
    const corpo = (await r.json()) as { error: { code: string; message: string } };
    expect(corpo.error).toMatchObject({ code: "validation_failed", message: frase });
    expect(audit).not.toHaveBeenCalled();
  });

  it("a gravação audita UMA vez, com a contagem da lista e sem nenhum número", async () => {
    rpcQueDevolve({});
    await PUT(put({ ...BASE, marcar_pelo_grupo: true, numeros_autorizados: ["+5531991110000", "+5511988887777"] }));
    expect(audit).toHaveBeenCalledTimes(1);
    const entrada = vi.mocked(audit).mock.calls[0]?.[0] as { organizationId: string; metadata: Record<string, unknown> };
    expect(entrada.organizationId).toBe(ORG);
    expect(entrada.metadata).toMatchObject({ marcar_pelo_grupo: true, numeros_autorizados: 2 });
    expect(JSON.stringify(entrada)).not.toMatch(/5531991110000|5511988887777/);
  });

  it("a lista tem teto de 100 números", async () => {
    const rpc = rpcQueDevolve({});
    const numeros = Array.from({ length: 101 }, (_, i) => `+5531990${String(i).padStart(6, "0")}`);
    const r = await PUT(put({ ...BASE, marcar_pelo_grupo: true, numeros_autorizados: numeros }));
    expect(r.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});
