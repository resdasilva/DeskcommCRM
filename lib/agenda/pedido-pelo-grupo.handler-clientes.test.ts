/**
 * A porta de produção `clientesPorNome` (rebuild 1 da #6), medida pela fábrica
 * `criarDepsDoPedidoPeloGrupo` com o client de service role dublado.
 *
 * Três coisas que o dublê de `pedido-pelo-grupo-atendimento.test.ts` não vê:
 * - a consulta filtra `organization_id` à mão (o client ignora RLS);
 * - aspas do nome não chegam ao filtro `.or` do PostgREST, onde fechariam o valor;
 * - o nome devolvido sai de `nomeDoContato`: `name` antes de `display_name`, e
 *   um identificador técnico nunca vira nome de cliente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = { metodo: string; args: unknown[] };

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ metodo: string; args: unknown[] }>,
  linhas: [] as Array<{ id: string; name: string | null; display_name: string | null }>,
}));

function consulta() {
  const q: Record<string, unknown> = {};
  for (const metodo of ["from", "select", "eq", "or", "limit"]) {
    q[metodo] = (...args: unknown[]) => {
      estado.chamadas.push({ metodo, args });
      return q;
    };
  }
  q.then = (ok: (v: unknown) => unknown) => ok({ data: estado.linhas, error: null });
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => consulta() }));
vi.mock("@/lib/escalacao/aviso-ao-suporte.handler", () => ({
  criarTransporteDoAviso: vi.fn(async () => ({})),
}));
vi.mock("@/lib/agent-engine/pacing/ledger-supabase", () => ({
  criarPacingDoCanal: vi.fn(async () => ({})),
}));

import { criarDepsDoPedidoPeloGrupo } from "./pedido-pelo-grupo.handler";

const ORG = "org-a";

beforeEach(() => {
  estado.chamadas = [];
  estado.linhas = [];
});

const doMetodo = (m: string): Chamada[] => estado.chamadas.filter((c) => c.metodo === m);

describe("clientesPorNome — a consulta de produção", () => {
  it("filtra a organização da linha e só pessoas não anonimizadas", async () => {
    const deps = await criarDepsDoPedidoPeloGrupo();
    await deps.db.clientesPorNome(ORG, "Rafael");
    expect(doMetodo("from").map((c) => c.args[0])).toEqual(["contacts"]);
    expect(doMetodo("eq").map((c) => c.args)).toEqual([
      ["organization_id", ORG],
      ["kind", "person"],
      ["is_anonymized", false],
    ]);
    expect(doMetodo("or")[0]?.args[0]).toBe('name.ilike."Rafael",display_name.ilike."Rafael"');
  });

  it("aspas, vírgula, parênteses e curingas do nome não chegam ao filtro .or", async () => {
    const deps = await criarDepsDoPedidoPeloGrupo();
    await deps.db.clientesPorNome(ORG, ' Ra"fa,el (Zé) 10%_* ');
    const filtro = String(doMetodo("or")[0]?.args[0]);
    const valores = [...filtro.matchAll(/ilike\."([^"]*)"/g)].map((m) => m[1]);
    expect(valores).toHaveLength(2);
    for (const v of valores) {
      expect(v).not.toMatch(/[",()%_*]/);
      expect(v).toContain("Ra fa el");
    }
  });

  it("o nome sai de nomeDoContato: name antes de display_name, id técnico cai no nome pedido", async () => {
    estado.linhas = [
      { id: "c1", name: "Rafael Souza", display_name: "Rafa" },
      { id: "c2", name: null, display_name: "Rafael" },
      { id: "c3", name: "5511999998888", display_name: null },
    ];
    const deps = await criarDepsDoPedidoPeloGrupo();
    const r = await deps.db.clientesPorNome(ORG, "Rafael");
    expect(r).toEqual([
      { id: "c1", nome: "Rafael Souza" },
      { id: "c2", nome: "Rafael" },
      { id: "c3", nome: "Rafael" },
    ]);
  });
});

describe("clientesParecidos — nome pedido seguido de sobrenome (R1 da revisão)", () => {
  it("mesma organização e mesmos filtros; o padrão é o nome + espaço + qualquer coisa", async () => {
    const deps = await criarDepsDoPedidoPeloGrupo();
    await deps.db.clientesParecidos(ORG, " Rafael ");
    expect(doMetodo("eq").map((c) => c.args)).toEqual([
      ["organization_id", ORG],
      ["kind", "person"],
      ["is_anonymized", false],
    ]);
    // O espaço antes do % deixa a "Rafaela" de fora.
    expect(doMetodo("or")[0]?.args[0]).toBe('name.ilike."Rafael %",display_name.ilike."Rafael %"');
  });

  it("o curinga só vem do padrão: o % e o * digitados no grupo são removidos", async () => {
    const deps = await criarDepsDoPedidoPeloGrupo();
    await deps.db.clientesParecidos(ORG, "Ra%fa*el_");
    expect(doMetodo("or")[0]?.args[0]).toBe('name.ilike."Rafael %",display_name.ilike."Rafael %"');
  });
});
