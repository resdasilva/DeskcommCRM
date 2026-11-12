/**
 * A CHAVE "NÃO RESPONDER MENSAGEM PESSOAL" VIAJA POR ONDE A VERSÃO VIAJA.
 *
 * Régua: todo arquivo que carrega `handoff_legal_enabled` (a chave irmã, por
 * versão) carrega `silencio_em_mensagem_pessoal`. Faltar num deles é o defeito
 * mudo: a pessoa liga, salva, cria um rascunho novo e a chave volta desligada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { traduzir } from "@/lib/i18n/dicionario";

const ler = (caminho: string) => readFileSync(join(process.cwd(), caminho), "utf8");
const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;

/** arquivo → quantas vezes a chave nova tem de aparecer, no mínimo. */
const ARQUIVOS: Array<[string, number]> = [
  ["app/api/v1/ai/agents/route.ts", 1],
  ["app/api/v1/ai/agents/[id]/versions/route.ts", 2],
  ["app/api/v1/ai/agents/[id]/versions/[vid]/route.ts", 3],
  ["app/app/ai/agents/[id]/page.tsx", 1],
  ["app/app/ai/agents/[id]/_actions.ts", 5],
  ["app/app/ai/agents/[id]/_components/AgentForm.tsx", 6],
  ["app/app/ai/agents/[id]/_components/VersionDiff.tsx", 1],
  ["lib/ai/agents/duplicate.ts", 2],
  ["lib/ai/agents/validation.ts", 2],
  ["hooks/ai/useAgentVersions.ts", 1],
];

describe("a chave do silêncio pessoal viaja com a versão", () => {
  it.each(ARQUIVOS)("%s carrega silencio_em_mensagem_pessoal", (arquivo, minimo) => {
    expect(vezes(ler(arquivo), "silencio_em_mensagem_pessoal")).toBeGreaterThanOrEqual(minimo);
  });

  it("nasce desligada no schema e no formulário", () => {
    expect(ler("lib/ai/agents/validation.ts")).toContain("silencio_em_mensagem_pessoal: z.boolean().default(false),");
    expect(ler("app/app/ai/agents/[id]/_components/AgentForm.tsx")).toContain(
      "silencio_em_mensagem_pessoal: version?.silencio_em_mensagem_pessoal ?? false,",
    );
  });

  it("o interruptor não depende da ferramenta de passagem", () => {
    const form = ler("app/app/ai/agents/[id]/_components/AgentForm.tsx");
    const inicio = form.indexOf('id="silencio_em_mensagem_pessoal"');
    expect(inicio).toBeGreaterThan(-1);
    const interruptor = form.slice(inicio, form.indexOf("/>", inicio));
    expect(interruptor).toContain("disabled={disabled}");
    expect(interruptor).not.toContain("handoff_tool_enabled");
  });

  it("rótulo e ajuda têm tradução em espanhol e no catálogo de inglês", () => {
    // O inglês ainda está em construção: não é servido por `traduzir`, mas o
    // catálogo dele já tem de trazer o texto novo.
    const ingles = JSON.parse(ler("lib/i18n/traducoes/en.json")) as Record<string, string>;
    for (const texto of [
      "Não responder mensagem pessoal",
      "Quando família, amigo ou fornecedor escreve para este número, o assistente não responde e deixa um aviso na Central. Ele volta a atender quando o assunto for trabalho.",
    ]) {
      expect(traduzir(texto, "es"), texto).not.toBe(texto);
      expect(ingles[texto], texto).toBeTruthy();
    }
  });
});
