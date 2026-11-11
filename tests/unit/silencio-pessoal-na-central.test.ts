import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KIND_LABEL, kindLabel } from "@/lib/ai/agent-inbox-copy";
import { POLITICAS_DE_AVISO } from "@/lib/ai/inbox-destino";
import { TITULO_DO_AVISO_DE_SILENCIO } from "@/lib/agent-engine/agent/silencio-pessoal";
import { traduzir } from "@/lib/i18n/dicionario";

const KIND = "silencio_mensagem_pessoal";

describe("o aviso do silêncio na Central", () => {
  it("aponta para a conversa e diz o que fazer nos dois casos", () => {
    const politica = POLITICAS_DE_AVISO[KIND];
    expect(politica.refs).toEqual(["conversation"]);
    expect(politica.orientacao).toBe(
      "Se for cliente, peça a resposta. Se for pessoal, marque o contato e o assistente não entra mais nessa conversa.",
    );
  });

  it("tem rótulo próprio", () => {
    expect(KIND_LABEL[KIND]).toBe("O assistente ficou em silêncio numa mensagem que parece pessoal");
    expect(kindLabel(KIND)).toBe(KIND_LABEL[KIND]);
  });

  it("título, orientação e rótulo têm tradução em espanhol e no catálogo de inglês", () => {
    // O inglês ainda está em construção (`lib/i18n/catalogos.ts`): não é servido
    // por `traduzir`, mas o catálogo dele já tem de trazer o texto novo.
    const ingles = JSON.parse(readFileSync(join(process.cwd(), "lib/i18n/traducoes/en.json"), "utf8")) as Record<string, string>;
    for (const texto of [TITULO_DO_AVISO_DE_SILENCIO, POLITICAS_DE_AVISO[KIND].orientacao, KIND_LABEL[KIND]]) {
      expect(traduzir(texto, "es"), texto).not.toBe(texto);
      expect(ingles[texto], texto).toBeTruthy();
    }
  });
});
