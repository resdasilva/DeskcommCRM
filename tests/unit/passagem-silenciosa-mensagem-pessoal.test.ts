import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A PASSAGEM SILENCIOSA QUANDO A MENSAGEM É PESSOAL (issue #10).
 *
 * Familiar, amigo ou fornecedor escreve para o número do negócio, o agente
 * passa a conversa para a equipe — e o contato recebia "vou te passar para um
 * atendente". Com `ai_agent_versions.handoff_silencioso_pessoal` ligado, o
 * motivo `mensagem_pessoal` passa a conversa sem dizer nada ao contato. O resto
 * da passagem (force_human, silêncio do bot, crons, linha da passagem, item na
 * Central — de onde sai o aviso da equipe no WhatsApp) é o de sempre.
 *
 * O teste dirige a borda que a ferramenta chama (`applyRequestHumanHandoff`)
 * com um pool dublê e lê o que foi gravado; a decisão do turno (piso e
 * `seq > 0`) sai do closure numa função pura, e a fiação dela no closure é
 * cobrada na fonte — o mesmo padrão de `handoff-fantasma-fiacao.test.ts`.
 */

const { cancelPendingCronsForLead } = vi.hoisted(() => ({ cancelPendingCronsForLead: vi.fn(async () => 0) }));
vi.mock("@/lib/atendimento/fronteira-server", () => ({ guardServiceEffect: vi.fn(async () => {}) }));
vi.mock("@/lib/escalacao/disponibilidade", () => ({
  expectativaDeAtendimento: vi.fn(async () => ({ frase: "Uma pessoa vai responder." })),
}));
vi.mock("@/lib/leads/agent-activity", () => ({
  emitAgentActivityForContact: vi.fn(async () => ({ routed: true })),
}));
vi.mock("@/lib/agent-engine/cron/scheduler", () => ({ cancelPendingCronsForLead }));

import {
  applyRequestHumanHandoff,
  esquemaDaPassagemPedida,
  requestHumanHandoffInputSchema,
} from "@/lib/agent-engine/agent/human-handoff";
import {
  aplicaAChaveDaPassagemSilenciosa,
  cercarEnviosPelaTravaDoSilencio,
  criarTravaDoSilencio,
  decidirPassagemSilenciosa,
  descricaoDaFerramentaDePassagem,
  ENSINO_DA_PASSAGEM_SILENCIOSA,
} from "@/lib/agent-engine/agent/inbound-turn";
import { montarCartoesDaPassagem } from "@/lib/escalacao/cartao-da-passagem";
import { linhaDoAvisoAoCliente } from "@/lib/escalacao/passagem";

const consultas: Array<{ sql: string; params: unknown[] }> = [];
const db = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }),
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => log };
const ids = { tenantId: "org1", leadId: "cont1", conversationId: "conv1" };
const SILENCIO = { avisado: false, porque: "mensagem_pessoal", motivoCodigo: "silencio_intencional" } as const;

function passar(raw: unknown, opts: { chave?: boolean; pendentes?: string[]; aviso?: unknown } = {}) {
  return applyRequestHumanHandoff(
    db as never,
    ids,
    {
      conversationSummary: "resumo",
      contextoDoTurno: { checkpoint: null, pendentesDoCliente: opts.pendentes ?? ["oi, filho, liga pra mim"] },
      avisoAoLead: (opts.aviso ?? SILENCIO) as never,
      ...(opts.chave !== undefined ? { silenciosoPessoal: opts.chave } : {}),
      log: log as never,
    },
    raw,
  );
}

const sql = (re: RegExp) => consultas.filter((c) => re.test(c.sql));
const insercaoDaPassagem = () => sql(/insert into passagens_de_atendimento/)[0];
/** Os valores da linha da passagem, por nome de coluna (o insert é posicional). */
function linhaGravada(): Record<string, unknown> {
  const ins = insercaoDaPassagem();
  expect(ins, "a passagem não foi gravada").toBeTruthy();
  const colunas = /\(([^)]+)\)/.exec(ins!.sql)![1]!.split(",").map((c) => c.trim());
  return Object.fromEntries(colunas.map((c, i) => [c, ins!.params[i]]));
}

beforeEach(() => {
  consultas.length = 0;
  db.query.mockClear();
  cancelPendingCronsForLead.mockClear();
});

describe("o schema só aceita mensagem_pessoal com a chave ligada", () => {
  it("chave desligada (o schema de sempre): recusa", () => {
    expect(requestHumanHandoffInputSchema.safeParse({ motivo_codigo: "mensagem_pessoal" }).success).toBe(false);
    expect(esquemaDaPassagemPedida(false).safeParse({ motivo_codigo: "mensagem_pessoal" }).success).toBe(false);
  });

  it("chave ligada: aceita, e os motivos de antes continuam aceitos", () => {
    const ligado = esquemaDaPassagemPedida(true);
    expect(ligado.safeParse({ motivo_codigo: "mensagem_pessoal" }).success).toBe(true);
    expect(ligado.safeParse({ motivo_codigo: "requested_human" }).success).toBe(true);
    expect(ligado.safeParse({ motivo_codigo: "inventado" }).success).toBe(false);
  });

  it("na ferramenta: chave desligada devolve erro de ensino e não passa a conversa", async () => {
    const r = await passar({ motivo_codigo: "mensagem_pessoal" }, { chave: false });
    expect(r.ok).toBe(false);
    expect(sql(/update contacts set force_human/)).toHaveLength(0);
    // Sem a chave, o ensino não oferece o motivo novo.
    expect(JSON.stringify(r)).not.toContain("também aceita mensagem_pessoal");
  });
});

describe("com a chave ligada e mensagem_pessoal, a passagem acontece em silêncio", () => {
  it("o resto da passagem é o de sempre: force_human, silêncio do bot, crons e Central", async () => {
    const r = await passar({ motivo_codigo: "mensagem_pessoal", por_que: "é a mãe do dono" }, { chave: true });
    expect(r.ok).toBe(true);
    expect(sql(/update contacts set force_human = true/)).toHaveLength(1);
    const conversa = sql(/update conversations/)[0];
    expect(conversa?.sql).toMatch(/bot_silenced_until/);
    expect(cancelPendingCronsForLead).toHaveBeenCalledWith(db, "org1", "cont1");
    // O item na Central é o que dispara o aviso da equipe no WhatsApp.
    expect(sql(/insert into agent_inbox_items/)).toHaveLength(1);
  });

  it("a linha da passagem guarda mensagem_pessoal e silencio_intencional", async () => {
    await passar({ motivo_codigo: "mensagem_pessoal" }, { chave: true });
    expect(linhaGravada()).toMatchObject({
      motivo_codigo: "mensagem_pessoal",
      cliente_avisado: false,
      aviso_motivo_codigo: "silencio_intencional",
    });
  });

  it("a Central não acusa falha de envio, e o modelo não ouve que o contato foi avisado", async () => {
    const r = await passar({ motivo_codigo: "mensagem_pessoal" }, { chave: true });
    const corpo = String(sql(/insert into agent_inbox_items/)[0]!.params[2]);
    expect(corpo).toContain("de propósito: a mensagem era pessoal");
    expect(corpo).not.toContain("⚠️");
    expect(corpo).not.toContain("esperando sem saber");
    expect(r.ok && r.message).toContain("Nada foi enviado ao contato");
    expect(r.ok && r.message).not.toContain("JÁ foi avisado");
  });

  it("o cartão de quem assume não mostra o alerta de 'não avisado'", () => {
    expect(linhaDoAvisoAoCliente({ avisado: false, motivoCodigo: "silencio_intencional" }, (t) => t)).toBe(
      "O cliente não foi avisado, de propósito: a mensagem era pessoal.",
    );
    const [cartao] = montarCartoesDaPassagem(
      [
        {
          id: "p1",
          origem: "ferramenta_do_modelo",
          motivo_codigo: "mensagem_pessoal",
          title: null,
          body: "resumo",
          notes: null,
          content: null,
          tentativas: [],
          cliente_avisado: false,
          aviso_motivo_codigo: "silencio_intencional",
          caso_id: null,
          criado_em: "2026-11-01T12:00:00.000Z",
          reconhecido_em: null,
          reconhecido_por: null,
        },
      ] as never,
      { usuarioId: "u1", donoId: null, donoNome: null },
    );
    expect(cartao?.aviso).toBeNull();
  });
});

describe("opt-out vence a passagem silenciosa", () => {
  it("pedido para parar de receber mensagens recusa mensagem_pessoal, mesmo com a chave ligada", async () => {
    const r = await passar(
      { motivo_codigo: "mensagem_pessoal" },
      { chave: true, pendentes: ["para de me mandar mensagem"] },
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("não receber mais mensagens");
    expect(sql(/update contacts set force_human/)).toHaveLength(0);
  });
});

describe("regressão: os outros motivos avisam o contato como antes", () => {
  it.each(["requested_human", "critical_stage"])("%s com a chave ligada", async (motivo) => {
    const r = await passar({ motivo_codigo: motivo }, { chave: true, aviso: { avisado: true } });
    expect(r.ok).toBe(true);
    expect(r.ok && r.message).toContain("O lead JÁ foi avisado");
    expect(linhaGravada()).toMatchObject({ motivo_codigo: motivo, cliente_avisado: true });
  });
});

describe("a decisão do turno: piso e mensagem já enviada", () => {
  const pessoal = { motivo_codigo: "mensagem_pessoal" };

  it("chave desligada ou ausente: sempre o caminho de sempre", () => {
    expect(decidirPassagemSilenciosa({ chaveLigada: false, raw: pessoal, seq: 0 })).toBe("normal");
    expect(decidirPassagemSilenciosa({ chaveLigada: undefined, raw: pessoal, seq: 0 })).toBe("normal");
  });

  it("chave ligada e outro motivo: o caminho de sempre", () => {
    expect(decidirPassagemSilenciosa({ chaveLigada: true, raw: { motivo_codigo: "requested_human" }, seq: 0 })).toBe(
      "normal",
    );
    expect(decidirPassagemSilenciosa({ chaveLigada: true, raw: null, seq: 0 })).toBe("normal");
  });

  it("seq === 0: silenciosa — o piso não fala", () => {
    expect(decidirPassagemSilenciosa({ chaveLigada: true, raw: pessoal, seq: 0 })).toBe("silenciosa");
  });

  it("seq > 0: o modelo já falou, e o motivo é recusado", () => {
    expect(decidirPassagemSilenciosa({ chaveLigada: true, raw: pessoal, seq: 2 })).toBe("ja_falou");
  });

  it("send_message em voo com seq ainda 0: o motivo também é recusado", () => {
    expect(decidirPassagemSilenciosa({ chaveLigada: true, raw: pessoal, seq: 0, enviosEmVoo: 1 })).toBe("em_voo");
    // Já falou e ainda tem envio em voo: o que vale é o que já saiu.
    expect(decidirPassagemSilenciosa({ chaveLigada: true, raw: pessoal, seq: 1, enviosEmVoo: 1 })).toBe("ja_falou");
    // Chave desligada: o envio em voo não muda nada.
    expect(decidirPassagemSilenciosa({ chaveLigada: false, raw: pessoal, seq: 0, enviosEmVoo: 1 })).toBe("normal");
  });
});

describe("a corrida no mesmo passo: send_message e a passagem silenciosa", () => {
  const pessoal = { motivo_codigo: "mensagem_pessoal" };

  /** Um send_message dublê que só termina quando o teste manda. */
  function ferramentasComEnvioPreso() {
    let soltar: () => void = () => {};
    const preso = new Promise<void>((r) => {
      soltar = r;
    });
    const execute = vi.fn(async () => {
      await preso;
      return { ok: true };
    });
    const tools: Record<string, unknown> = {
      send_message: { description: "envia", execute },
      send_template: { description: "modelo", execute: vi.fn(async () => ({ ok: true })) },
    };
    return { tools, execute, soltar: () => soltar() };
  }

  it("envio começou antes: a passagem vê o envio em voo e recusa o silêncio", async () => {
    const trava = criarTravaDoSilencio();
    const { tools, soltar } = ferramentasComEnvioPreso();
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    const envio = (tools.send_message as { execute: () => Promise<unknown> }).execute();
    expect(
      decidirPassagemSilenciosa({ chaveLigada: true, raw: pessoal, seq: 0, enviosEmVoo: trava.enviosEmVoo() }),
    ).toBe("em_voo");
    soltar();
    await envio;
    // Terminado o envio, nada fica preso em voo.
    expect(trava.enviosEmVoo()).toBe(0);
  });

  it("silêncio reservado antes: o envio do mesmo passo é recusado e nada sai", async () => {
    const trava = criarTravaDoSilencio();
    const { tools, execute } = ferramentasComEnvioPreso();
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    trava.reservarSilencio();
    const r = await (tools.send_message as { execute: () => Promise<unknown> }).execute();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).toContain("passagem_silenciosa");
    const t = await (tools.send_template as { execute: () => Promise<unknown> }).execute();
    expect(JSON.stringify(t)).toContain("passagem_silenciosa");
  });

  it("silêncio solto (a passagem falhou): o envio volta a sair", async () => {
    const trava = criarTravaDoSilencio();
    const { tools, execute, soltar } = ferramentasComEnvioPreso();
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    trava.reservarSilencio();
    trava.soltarSilencio();
    soltar();
    await (tools.send_message as { execute: () => Promise<unknown> }).execute();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("envio que lança também sai da conta de em voo", async () => {
    const trava = criarTravaDoSilencio();
    const tools: Record<string, unknown> = {
      send_message: {
        execute: async () => {
          throw new Error("canal caiu");
        },
      },
    };
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    await expect((tools.send_message as { execute: () => Promise<unknown> }).execute()).rejects.toThrow("canal caiu");
    expect(trava.enviosEmVoo()).toBe(0);
  });

  it("chave desligada ou ausente: as ferramentas de envio ficam intocadas", () => {
    const trava = criarTravaDoSilencio();
    const { tools } = ferramentasComEnvioPreso();
    const antes = { ...tools };
    cercarEnviosPelaTravaDoSilencio(tools, false, trava);
    cercarEnviosPelaTravaDoSilencio(tools, undefined, trava);
    expect(tools.send_message).toBe(antes.send_message);
    expect(tools.send_template).toBe(antes.send_template);
  });
});

describe("a descrição da ferramenta só ensina o motivo com a chave ligada", () => {
  const ferramentas = () => ({ request_human_handoff: { description: descricaoDaFerramentaDePassagem(true) } });

  it("desligada: a descrição é byte a byte a de antes", () => {
    const t = ferramentas();
    aplicaAChaveDaPassagemSilenciosa(t, false);
    expect(t.request_human_handoff.description).toBe(descricaoDaFerramentaDePassagem(true));
    aplicaAChaveDaPassagemSilenciosa(t, undefined);
    expect(t.request_human_handoff.description).toBe(descricaoDaFerramentaDePassagem(true));
  });

  it("ligada: acrescenta o ensino do motivo novo", () => {
    const t = ferramentas();
    aplicaAChaveDaPassagemSilenciosa(t, true);
    expect(t.request_human_handoff.description).toBe(
      descricaoDaFerramentaDePassagem(true) + ENSINO_DA_PASSAGEM_SILENCIOSA,
    );
  });
});

describe("fiação no turno", () => {
  const fonte = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
  const inicio = fonte.indexOf("    request_human_handoff: tool({");
  const fim = fonte.indexOf("    }),\n  };", inicio);
  const corpo = fonte.slice(inicio, fim);

  it("a recusa de 'ja_falou' e 'em_voo' vem antes do piso, e o piso não roda em silêncio", () => {
    expect(inicio).toBeGreaterThan(-1);
    const recusa = corpo.indexOf("if (passagemSilenciosa === 'ja_falou' || passagemSilenciosa === 'em_voo')");
    const piso = corpo.indexOf("await avisarLeadDaEscalacao(");
    expect(recusa).toBeGreaterThan(-1);
    expect(recusa).toBeLessThan(piso);
    expect(corpo.slice(recusa, piso)).toMatch(/passagemSilenciosa === 'silenciosa'\s*\?\s*\(\{\s*avisado: false/);
  });

  it("a chave chega à ferramenta e à descrição", () => {
    expect(corpo).toContain("chaveLigada: silenciosoPessoal");
    expect(corpo).toMatch(/silenciosoPessoal,\s*log: runLog/);
    expect(fonte).toContain("aplicaAChaveDaPassagemSilenciosa(rawTools, agentConfig?.handoffSilenciosoPessoal);");
  });

  it("a trava do silêncio: lida e reservada sem await no meio, solta quando a passagem falha", () => {
    expect(corpo).toContain("enviosEmVoo: travaDoSilencio.enviosEmVoo()");
    const decisao = corpo.indexOf("decidirPassagemSilenciosa({");
    const reserva = corpo.indexOf("travaDoSilencio.reservarSilencio();");
    expect(decisao).toBeGreaterThan(-1);
    expect(reserva).toBeGreaterThan(decisao);
    // Entre olhar e reservar não pode haver await: senão um envio entra no meio.
    expect(corpo.slice(decisao, reserva)).not.toMatch(/await/);
    expect((corpo.match(/travaDoSilencio\.soltarSilencio\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(fonte).toContain(
      "cercarEnviosPelaTravaDoSilencio(rawTools, agentConfig?.handoffSilenciosoPessoal, travaDoSilencio);",
    );
  });
});
