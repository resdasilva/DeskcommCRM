/**
 * PROVA COM O MODELO REAL da passagem silenciosa (issue #10, item 7).
 *
 * Roda o "Testar agente" (`testAgentVersion`, o mesmo motor do turno de
 * WhatsApp em modo prévia) contra uma versão de agente com a chave
 * `handoff_silencioso_pessoal` ligada, N vezes por frase, e conta o que o
 * modelo fez: chamou `request_human_handoff` com `mensagem_pessoal`? Propôs
 * mensagem ao contato?
 *
 * Prévia: nada sai para o WhatsApp; a passagem vira proposta.
 *
 * Uso (no worktree, com o ambiente do Supabase LOCAL no processo):
 *   ENV_FILE=<caminho do .env.local do ambiente local> VERSION_ID=<uuid> N=5 \
 *     pnpm exec tsx scripts/prova-passagem-silenciosa-modelo-real.ts
 */
import { randomUUID } from "node:crypto";

if (process.env.ENV_FILE) process.loadEnvFile(process.env.ENV_FILE);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  throw new Error(`recusado: o Supabase não é local (${new URL(url || "http://x").host})`);
}

const FRASES = [
  { nome: "mae", texto: "Oi filho, é a mãe! Vem almoçar domingo?", espera: "passagem" },
  {
    // o texto exato que o dono mandou no teste de 01/11/2026
    nome: "mae-longa",
    texto: "Oi filho, é a mãe! Você vem almoçar aqui no domingo? Vou fazer aquela lasanha. Beijo",
    espera: "passagem",
  },
  { nome: "comercial", texto: "Oi, quero saber o preço da consulta", espera: "atende" },
] as const;

async function main(): Promise<void> {
  const { testAgentVersion } = await import("@/lib/agent-engine/agent/sandbox");
  const { requestTurnDeps } = await import("@/lib/agent-engine/agent/request-deps");
  const { getRequestPool } = await import("@/lib/agent-engine/db/request-pool");
  const pool = getRequestPool();
  const versionId = process.env.VERSION_ID!;
  const { rows } = await pool.query(
    `select organization_id, agent_id, channel_session_id, model, handoff_silencioso_pessoal
       from ai_agent_versions where id = $1`,
    [versionId],
  );
  const v = rows[0];
  if (!v) throw new Error("versão não encontrada");
  const n = Number(process.env.N ?? 5);
  const so = process.env.SO ?? "";
  console.log(JSON.stringify({ versao: versionId, modelo: v.model, chave: v.handoff_silencioso_pessoal }));
  for (const f of FRASES) {
    if (so && so !== f.nome) continue;
    for (let i = 1; i <= n; i++) {
      const runId = randomUUID();
      const t0 = Date.now();
      try {
        const r = await testAgentVersion(pool, requestTurnDeps(), {
          organizationId: v.organization_id,
          agentId: v.agent_id,
          versionId,
          runId,
          sampleMessage: f.texto,
          channelId: v.channel_session_id,
        });
        const proposals = r.proposals as unknown as Array<Record<string, unknown>>;
        const handoff = proposals.filter((p) => JSON.stringify(p).includes("request_human_handoff"));
        console.log(
          JSON.stringify({
            frase: f.nome,
            tentativa: i,
            ms: Date.now() - t0,
            mensagens_ao_contato: r.candidates.map((c) => c.body),
            passagem: handoff.map((p) => p),
            ferramentas: proposals.map((p) => p.tool ?? p.name ?? p.kind),
            impedimentos: r.impediments,
          }),
        );
      } catch (e) {
        console.log(JSON.stringify({ frase: f.nome, tentativa: i, erro: String(e).slice(0, 300) }));
      }
    }
  }
  await pool.end();
}

void main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
