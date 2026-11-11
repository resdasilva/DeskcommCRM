import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O SILÊNCIO DO TURNO QUANDO A MENSAGEM É PESSOAL (issue #10; spec
 * docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md).
 *
 * A ferramenta cala SÓ o turno: abre um aviso na Central e não toca
 * `force_human`, `bot_silenced_until` nem `passagens_de_atendimento`.
 */
vi.mock("@/lib/atendimento/fronteira-server", () => ({ guardServiceEffect: vi.fn(async () => {}) }));

import {
  applyStaySilent,
  blocoDoSilencioPessoal,
  cercarEnviosPelaTravaDoSilencio,
  criarTravaDoSilencio,
  decidirSilencioDoTurno,
  silencioPessoalDisponivel,
  SILENCIO_PESSOAL_SYSTEM_BLOCK,
  STAY_SILENT_TOOL_DEF,
  TITULO_DO_AVISO_DE_SILENCIO,
} from "@/lib/agent-engine/agent/silencio-pessoal";

const consultas: Array<{ sql: string; params: unknown[] }> = [];
const db = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    if (/select locale from organizations/.test(sql)) return { rows: [{ locale: "pt-BR" }], rowCount: 1 };
    if (/insert into agent_inbox_items/.test(sql)) return { rows: [{ id: "aviso1" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }),
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => log };
const ids = { tenantId: "org1", conversationId: "conv1" };
const sql = (re: RegExp) => consultas.filter((c) => re.test(c.sql));

function calar(raw: unknown, opts: { pendentes?: string[]; seq?: number; trava?: ReturnType<typeof criarTravaDoSilencio> } = {}) {
  return applyStaySilent(
    db as never,
    ids,
    {
      pendentesDoCliente: opts.pendentes ?? ["oi filho, é a mãe"],
      seq: opts.seq ?? 0,
      trava: opts.trava ?? criarTravaDoSilencio(),
      log: log as never,
    },
    raw,
  );
}

beforeEach(() => {
  consultas.length = 0;
  db.query.mockClear();
  log.error.mockClear();
});

describe("quando a ferramenta existe", () => {
  it("só com a chave ligada", () => {
    expect(silencioPessoalDisponivel(null, {})).toBe(false);
    expect(silencioPessoalDisponivel({}, {})).toBe(false);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: false }, {})).toBe(false);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, {})).toBe(true);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, null)).toBe(true);
  });

  it("nunca para cliente confirmado", () => {
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, { cliente_confirmado: true })).toBe(false);
    expect(silencioPessoalDisponivel({ silencioEmMensagemPessoal: true }, { cliente_confirmado: false })).toBe(true);
  });

  it("o bloco do prompt acompanha a ferramenta", () => {
    expect(blocoDoSilencioPessoal(false)).toBeNull();
    expect(blocoDoSilencioPessoal(true)).toBe(SILENCIO_PESSOAL_SYSTEM_BLOCK);
  });
});

describe("o bloco do prompt", () => {
  it("manda chamar stay_silent e não fala mais em passagem", () => {
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("stay_silent");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).not.toContain("request_human_handoff");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).not.toContain("a equipe é avisada");
  });

  it("guarda as regras medidas no PR 11: histórico desautorizado e opt-out fora", () => {
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("elas foram um erro");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("nunca é mensagem pessoal");
  });

  it("mensagem misturada é atendimento, e responde só o trabalho", () => {
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("mesmo junto de conversa pessoal");
    expect(SILENCIO_PESSOAL_SYSTEM_BLOCK).toContain("responda só a parte do trabalho");
  });

  it("a descrição da ferramenta também barra opt-out e assunto de trabalho", () => {
    expect(STAY_SILENT_TOOL_DEF.description).toContain("parar de receber");
    expect(STAY_SILENT_TOOL_DEF.description).toContain("preço");
  });
});

describe("a decisão do turno", () => {
  it("nada enviado e nada em voo: silêncio", () => {
    expect(decidirSilencioDoTurno({ seq: 0, enviosEmVoo: 0 })).toBe("silencio");
  });
  it("já enviou mensagem neste turno", () => {
    expect(decidirSilencioDoTurno({ seq: 2, enviosEmVoo: 0 })).toBe("ja_falou");
    expect(decidirSilencioDoTurno({ seq: 1, enviosEmVoo: 1 })).toBe("ja_falou");
  });
  it("envio em voo no mesmo passo", () => {
    expect(decidirSilencioDoTurno({ seq: 0, enviosEmVoo: 1 })).toBe("em_voo");
  });
});

describe("stay_silent cala só o turno", () => {
  it("registra o silêncio e abre UM aviso na Central, por conversa", async () => {
    const r = await calar({ por_que: "mãe do dono chamando para almoçar" });
    expect(r).toMatchObject({ ok: true, status: "silencio_registrado" });
    const aviso = sql(/insert into agent_inbox_items/);
    expect(aviso).toHaveLength(1);
    expect(aviso[0]!.params).toEqual(
      expect.arrayContaining(["org1", "silencio_mensagem_pessoal", "info", TITULO_DO_AVISO_DE_SILENCIO, "conversation", "conv1"]),
    );
    // O dedup por conversa é o `where not exists` de insertInboxItem ('kind_e_ref').
    expect(aviso[0]!.sql).toMatch(/where not exists/);
  });

  it("o aviso não repete o que o contato escreveu nem o motivo do modelo", async () => {
    await calar({ por_que: "é a mãe, quer almoço domingo" }, { pendentes: ["oi filho, vem almoçar"] });
    const params = JSON.stringify(sql(/insert into agent_inbox_items/)[0]!.params);
    expect(params).not.toContain("almoço");
    expect(params).not.toContain("almoçar");
  });

  it("não toca force_human, bot_silenced_until, passagem nem cron", async () => {
    await calar({ por_que: "fornecedor cobrando boleto" });
    expect(sql(/force_human|bot_silenced_until|is_blocked/)).toHaveLength(0);
    expect(sql(/passagens_de_atendimento/)).toHaveLength(0);
    expect(sql(/cron_jobs/)).toHaveLength(0);
    expect(sql(/update\s+(contacts|conversations)/i)).toHaveLength(0);
  });

  it("reserva o silêncio: o send_message do mesmo passo é recusado", async () => {
    const trava = criarTravaDoSilencio();
    await calar({ por_que: "amigo do dono" }, { trava });
    expect(trava.comecarEnvio()).toBe(false);
  });

  it("a frase de retorno manda encerrar sem enviar", async () => {
    const r = await calar({ por_que: "amigo do dono" });
    expect(r.ok && r.message).toContain("Nada foi enviado ao contato");
    expect(r.ok && r.message).toContain("sem chamar send_message");
  });

  it("falha ao abrir o aviso não desfaz o silêncio, e fica no log", async () => {
    db.query.mockImplementationOnce(async () => ({ rows: [{ locale: "pt-BR" }], rowCount: 1 }));
    db.query.mockImplementationOnce(async () => {
      throw new Error("banco fora");
    });
    const trava = criarTravaDoSilencio();
    const r = await calar({ por_que: "mãe" }, { trava });
    expect(r.ok).toBe(true);
    expect(trava.comecarEnvio()).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });
});

describe("as recusas", () => {
  it("pedido de parar de receber nunca é pessoal", async () => {
    const trava = criarTravaDoSilencio();
    const r = await calar({ por_que: "mãe" }, { pendentes: ["para de me mandar mensagem"], trava });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("não receber mais mensagens");
    expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
    expect(trava.comecarEnvio()).toBe(true);
  });

  it("já falou neste turno: recusa, sem aviso", async () => {
    const r = await calar({ por_que: "mãe" }, { seq: 1 });
    expect(r).toMatchObject({ ok: false, error: { code: "ja_falou" } });
    expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
  });

  it("envio em voo no mesmo passo: recusa, sem aviso", async () => {
    const trava = criarTravaDoSilencio();
    trava.comecarEnvio();
    const r = await calar({ por_que: "mãe" }, { trava });
    expect(r).toMatchObject({ ok: false, error: { code: "em_voo" } });
    expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
  });

  it.each([[{}], [{ por_que: "" }], [{ por_que: "x".repeat(301) }], [{ por_que: "mãe", motivo_codigo: "mensagem_pessoal" }], [null]])(
    "payload fora do contrato vira erro de ensino: %j",
    async (raw) => {
      const r = await calar(raw);
      expect(r).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
      expect(sql(/insert into agent_inbox_items/)).toHaveLength(0);
    },
  );
});

describe("a corrida no mesmo passo: send_message e o silêncio", () => {
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

  it("envio começou antes: o silêncio vê o envio em voo", async () => {
    const trava = criarTravaDoSilencio();
    const { tools, soltar } = ferramentasComEnvioPreso();
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    const envio = (tools.send_message as { execute: () => Promise<unknown> }).execute();
    expect(decidirSilencioDoTurno({ seq: 0, enviosEmVoo: trava.enviosEmVoo() })).toBe("em_voo");
    soltar();
    await envio;
    expect(trava.enviosEmVoo()).toBe(0);
  });

  it("silêncio reservado antes: o envio do mesmo passo é recusado e nada sai", async () => {
    const trava = criarTravaDoSilencio();
    const { tools, execute } = ferramentasComEnvioPreso();
    cercarEnviosPelaTravaDoSilencio(tools, true, trava);
    trava.reservarSilencio();
    const r = await (tools.send_message as { execute: () => Promise<unknown> }).execute();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).toContain("silencio_do_turno");
    const t = await (tools.send_template as { execute: () => Promise<unknown> }).execute();
    expect(JSON.stringify(t)).toContain("silencio_do_turno");
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

  it("indisponível: as ferramentas de envio ficam intocadas", () => {
    const trava = criarTravaDoSilencio();
    const { tools } = ferramentasComEnvioPreso();
    const antes = { ...tools };
    cercarEnviosPelaTravaDoSilencio(tools, false, trava);
    expect(tools.send_message).toBe(antes.send_message);
    expect(tools.send_template).toBe(antes.send_template);
  });
});
