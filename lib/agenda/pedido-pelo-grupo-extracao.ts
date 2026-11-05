/**
 * O PEDIDO DE AGENDA DO GRUPO, LIDO — o texto livre ("Rafael às 13 horas,
 * corte") vira um objeto validado (issue #6, terceira fatia de #3).
 *
 * ⚠️ O MODELO SÓ LÊ. Decisão do dono do produto: o modelo extrai o pedido para
 * o objeto abaixo e para aí — ele não marca, não remarca e não cancela nada.
 * Quem age é código determinístico (`./pedido-pelo-grupo-atendimento.ts`),
 * chamando as MESMAS ferramentas de agenda do agente. Extração inválida ou
 * incompleta vira pergunta no grupo, nunca palpite.
 *
 * O serviço e o profissional voltam como o IDENTIFICADOR de uma lista que nós
 * mandamos (slug do serviço, id do profissional), e o atendimento confere que
 * o valor está na lista: um nome que o modelo inventou não chega à agenda.
 */
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import { DEFAULT_CLASSIFIER_MODEL, gatewayHeaders, resolveLanguageModel } from "@/lib/ai/gateway";

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]?\d|2[0-3]):[0-5]\d$/;

// Sem `.transform`: o schema vira JSON Schema para o modelo, e transformação
// não tem representação lá. Texto vazio é tratado como ausente no atendimento.
const textoOuNulo = z.string().max(120).nullable();

/** O que o modelo devolve. `nenhuma` = a mensagem não é pedido de agenda (conversa do grupo). */
export const extracaoDoPedidoSchema = z.object({
  acao: z.enum(["marcar", "remarcar", "cancelar", "nenhuma"]),
  cliente: textoOuNulo,
  /** O `slug` de um dos serviços da lista, ou null. */
  servico: textoOuNulo,
  /** O dia NOVO (marcar/remarcar), em YYYY-MM-DD. null = o texto não disse o dia. */
  dia: z.string().regex(DIA).nullable(),
  /** A hora NOVA (marcar/remarcar), em HH:mm. */
  hora: z.string().regex(HORA).nullable(),
  /** O `id` de um dos profissionais da lista, ou null. */
  profissional: textoOuNulo,
  /** Remarcar/cancelar: o dia do agendamento que JÁ existe, quando o texto o diz. */
  dia_atual: z.string().regex(DIA).nullable(),
  /** Remarcar/cancelar: a hora do agendamento que JÁ existe, quando o texto a diz. */
  hora_atual: z.string().regex(HORA).nullable(),
});

export type ExtracaoDoPedido = z.infer<typeof extracaoDoPedidoSchema>;

export interface ContextoDaExtracao {
  /** Hoje no relógio da organização, YYYY-MM-DD. */
  hoje: string;
  /** Rótulo legível de hoje ("Qua 29/10"), para "amanhã" e "sexta" terem âncora. */
  hojeRotulo: string;
  servicos: ReadonlyArray<{ slug: string; nome: string }>;
  profissionais: ReadonlyArray<{ id: string; nome: string }>;
}

/** O resultado da leitura. `passageiro` = tente de novo depois (modelo fora do ar). */
export type LeituraDoPedido =
  | { ok: true; bruto: unknown }
  | { ok: false; passageiro: boolean; motivo: string };

export function instrucaoDaExtracao(ctx: ContextoDaExtracao): string {
  const servicos = ctx.servicos.map((s) => `- ${s.slug}: ${s.nome}`).join("\n") || "- (nenhum)";
  const profissionais = ctx.profissionais.map((p) => `- ${p.id}: ${p.nome}`).join("\n") || "- (nenhum)";
  return [
    "Você lê UMA mensagem do grupo de WhatsApp de uma empresa e extrai um pedido de agenda.",
    "Você NÃO marca nada e NÃO responde a ninguém: só preenche os campos.",
    `Hoje é ${ctx.hojeRotulo} (${ctx.hoje}).`,
    "",
    "Regras:",
    "- acao: marcar (horário novo), remarcar (mudar um que existe), cancelar (desmarcar um que existe),",
    "  ou nenhuma quando a mensagem não é pedido de agenda (cumprimento, conversa, dúvida).",
    "- cliente: o nome da pessoa atendida, como escrito. null se não aparece.",
    "- servico: o slug EXATO de um serviço da lista abaixo que corresponde ao pedido. null se não",
    "  aparece ou se nenhum corresponde. Nunca invente slug.",
    "- profissional: o id EXATO de um profissional da lista abaixo, só se o texto nomeia um. null senão.",
    "- dia e hora: o horário NOVO. dia em YYYY-MM-DD, hora em HH:mm de 24h (\"13 horas\" = 13:00,",
    "  \"1 da tarde\" = 13:00). Se o texto não diz o dia, dia = null. Se não diz a hora, hora = null.",
    "- dia_atual e hora_atual: só em remarcar/cancelar, o horário que o agendamento TEM hoje, quando",
    "  o texto o diz. null senão.",
    "- Nunca chute: o que o texto não diz fica null.",
    "",
    "Serviços (slug: nome):",
    servicos,
    "",
    "Profissionais (id: nome):",
    profissionais,
  ].join("\n");
}

/**
 * A leitura de produção, pelo modelo de classificação da instalação (gateway,
 * OpenRouter ou chave direta — `resolveLanguageModel`). Sem modelo configurado
 * não há o que tentar de novo: é `passageiro: false`.
 */
export async function lerPedidoComModelo(
  texto: string,
  ctx: ContextoDaExtracao,
  organizationId: string,
): Promise<LeituraDoPedido> {
  const model = resolveLanguageModel(DEFAULT_CLASSIFIER_MODEL);
  if (!model) return { ok: false, passageiro: false, motivo: "sem_modelo" };
  try {
    const r = await generateText({
      model,
      system: instrucaoDaExtracao(ctx),
      prompt: texto,
      output: Output.object({ schema: extracaoDoPedidoSchema }),
      headers: gatewayHeaders({ organizationId }),
      temperature: 0,
      maxRetries: 1,
    });
    return { ok: true, bruto: r.output };
  } catch (err) {
    // O modelo respondeu, mas fora do formato: é pedido ilegível (vira pergunta
    // no grupo), não indisponibilidade — tentar de novo devolveria o mesmo.
    if (NoObjectGeneratedError.isInstance(err)) return { ok: true, bruto: null };
    return { ok: false, passageiro: true, motivo: err instanceof Error ? err.name : "erro" };
  }
}
