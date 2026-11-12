import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ler = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");

describe("a chave e a marca são lidas pelo turno", () => {
  it("agent-config lê a coluna da versão e a entrega como silencioEmMensagemPessoal", () => {
    const fonte = ler("lib/agent-engine/agent/agent-config.ts");
    expect(fonte).toContain("v.silencio_em_mensagem_pessoal,");
    expect(fonte).toContain("silencio_em_mensagem_pessoal: boolean;");
    expect(fonte).toContain("silencioEmMensagemPessoal: r.silencio_em_mensagem_pessoal,");
    expect(fonte).toContain("silencioEmMensagemPessoal?: boolean;");
  });

  it("get-lead-context lê a marca do contato no mesmo select do bloqueio", () => {
    const fonte = ler("lib/agent-engine/edge/crm/get-lead-context.ts");
    expect(fonte).toMatch(/is_personal, cliente_confirmado_em, source/);
    expect(fonte).toContain("cliente_confirmado: contact.cliente_confirmado_em !== null,");
    expect(fonte).toContain("cliente_confirmado?: boolean;");
  });
});
