import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

import { POST } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const SESSAO = "44444444-4444-4444-8444-444444444444";
const MENSAGEM = "55555555-5555-4555-8555-555555555555";

/**
 * SABOTAGEM (prova no CI):
 * - tirar o filtro de organização da leitura da conversa: "conversa de outra org" acusa;
 * - repedir o turno sem olhar a última mensagem: "alguém já respondeu" acusa;
 * - confirmar contato pessoal: "contato pessoal recusa" acusa.
 */
let conversa: { id: string; organization_id: string; contact_id: string; channel_session_id: string; is_group: boolean } | null;
let contato: { id: string; organization_id: string; is_personal: boolean; cliente_confirmado_em: string | null };
let ultima: { id: string; direction: "inbound" | "outbound" } | null;
let avisosResolvidos: Array<Record<string, unknown>>;
let eventos: Array<Record<string, unknown>>;

function fakeQuery(tabela: string) {
  const e = { op: "select", patch: {} as Record<string, unknown>, f: {} as Record<string, unknown> };
  const resultado = () => {
    if (tabela === "conversations") {
      const ok = conversa && conversa.id === e.f["id"] && conversa.organization_id === e.f["organization_id"];
      return { data: ok ? conversa : null, error: null };
    }
    if (tabela === "contacts" && e.op === "update") {
      const ok =
        contato.id === e.f["id"] && contato.organization_id === e.f["organization_id"] && contato.is_personal === e.f["is_personal"];
      if (!ok) return { data: null, error: null };
      Object.assign(contato, e.patch);
      return { data: { id: contato.id }, error: null };
    }
    if (tabela === "agent_inbox_items" && e.op === "update") {
      avisosResolvidos.push({ ...e.f, ...e.patch });
      return { data: null, error: null };
    }
    if (tabela === "messages") return { data: ultima, error: null };
    return { data: null, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    update: (patch: Record<string, unknown>) => {
      e.op = "update";
      e.patch = patch;
      return q;
    },
    eq: (coluna: string, valor: unknown) => {
      e.f[coluna] = valor;
      return q;
    },
    order: () => q,
    limit: () => q,
    maybeSingle: async () => resultado(),
    then: (resolve: (v: unknown) => void) => resolve(resultado()),
  };
  return q;
}

const contexto = (id = CONVERSA) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest(`http://localhost/api/v1/conversations/${CONVERSA}/client-confirmed`, { method: "POST" });

beforeEach(() => {
  conversa = { id: CONVERSA, organization_id: ORG, contact_id: CONTATO, channel_session_id: SESSAO, is_group: false };
  contato = { id: CONTATO, organization_id: ORG, is_personal: false, cliente_confirmado_em: null };
  ultima = { id: MENSAGEM, direction: "inbound" };
  avisosResolvidos = [];
  eventos = [];
  vi.mocked(audit).mockClear();
  vi.mocked(requireSupportWrite).mockResolvedValue(null as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user-1", idioma: "pt-BR" },
    org: { orgId: ORG, role: "agent" },
  } as never);
  vi.mocked(createAdminClient).mockReturnValue({
    from: (tabela: string) => fakeQuery(tabela),
    rpc: vi.fn(async (_nome: string, args: Record<string, unknown>) => {
      eventos.push(args);
      return { error: null };
    }),
  } as never);
});

describe("POST /api/v1/conversations/[id]/client-confirmed", () => {
  it("marca o contato, fecha o aviso, repede o turno e audita", async () => {
    const res = await POST(req(), contexto());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ contact_id: CONTATO, conversation_id: CONVERSA, turn_requested: true });
    expect(contato.cliente_confirmado_em).not.toBeNull();
    expect(avisosResolvidos).toEqual([
      expect.objectContaining({
        organization_id: ORG, kind: "silencio_mensagem_pessoal", ref_kind: "conversation", ref_id: CONVERSA, status: "resolved",
      }),
    ]);
    expect(eventos).toEqual([
      expect.objectContaining({
        p_event_type: "ai_agent.dispatch_requested",
        p_entity_id: MENSAGEM,
        p_organization_id: ORG,
        p_payload: {
          organization_id: ORG, conversation_id: CONVERSA, contact_id: CONTATO, channel_session_id: SESSAO, inbound_message_id: MENSAGEM,
        },
      }),
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "contact.client_confirmed", organizationId: ORG, resourceType: "contact", resourceId: CONTATO, actorUserId: "user-1" }),
    );
  });

  it("alguém já respondeu: marca, mas não repede o turno, e diz isso", async () => {
    ultima = { id: MENSAGEM, direction: "outbound" };
    const res = await POST(req(), contexto());
    const { data } = await res.json();
    expect(data.turn_requested).toBe(false);
    expect(data.message).toContain("já teve resposta");
    expect(eventos).toEqual([]);
    expect(contato.cliente_confirmado_em).not.toBeNull();
  });

  it("conversa de outra organização: 404, sem efeito e sem auditoria", async () => {
    conversa!.organization_id = OUTRA_ORG;
    const res = await POST(req(), contexto());
    expect(res.status).toBe(404);
    expect(contato.cliente_confirmado_em).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it("grupo: 404", async () => {
    conversa!.is_group = true;
    expect((await POST(req(), contexto())).status).toBe(404);
  });

  it("contato pessoal recusa com 409 e não repede o turno", async () => {
    contato.is_personal = true;
    const res = await POST(req(), contexto());
    expect(res.status).toBe(409);
    expect(eventos).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("id que não é uuid: 422", async () => {
    expect((await POST(req(), contexto("nao-e-uuid"))).status).toBe(422);
  });

  it("papel é o de atendente", async () => {
    await POST(req(), contexto());
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("agent");
  });

  it("sessão de suporte somente leitura: barrada antes de qualquer efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "x", 403, { requestId: "r" }) as never);
    const res = await POST(req(), contexto());
    expect(res.status).toBe(403);
    expect(requireRole).not.toHaveBeenCalledTimes(2);
    expect(contato.cliente_confirmado_em).toBeNull();
  });
});
