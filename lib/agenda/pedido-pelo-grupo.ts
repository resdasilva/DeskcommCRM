/**
 * PEDIDO DE AGENDA PELO GRUPO — quem, no grupo do aviso de agendamento, pode
 * pedir horário escrevendo ali (issue #5, segunda fatia de #3).
 *
 * É a ÚNICA exceção à regra "grupo nunca entra em IA" (CLAUDE.md › WAHA ›
 * Grupos), e ela é fechada: só vale quando as três coisas são verdade ao mesmo
 * tempo —
 *
 *   1. a mensagem chegou no grupo escolhido em Agenda › Avisos
 *      (`config_aviso_de_agendamento.grupo_destino`);
 *   2. o "marcar pelo grupo" está ligado (`marcar_pelo_grupo`, 0768 — o banco
 *      já o desliga quando o grupo sai);
 *   3. quem escreveu (`p.author`, gravado como `group_sender.phone`) está na
 *      lista `numeros_autorizados`, nas duas grafias do nono dígito.
 *
 * Mensagem enviada do próprio celular (`fromMe`, direção `outbound`) nunca é
 * pedido: é a empresa falando, inclusive a confirmação que a fatia seguinte
 * vai mandar — contá-la como pedido faria o agente responder a si mesmo.
 *
 * Esta fatia só ANOTA o pedido em `event_log`; quem o atende é
 * `./pedido-pelo-grupo-atendimento.ts` (issue #6), que pergunta esta regra de novo.
 */
import { phoneLookupVariants } from "@/lib/channels/phone-variants";

export interface MarcacaoPeloGrupo {
  grupo: string | null;
  ligado: boolean;
  autorizados: readonly string[];
}

export interface MensagemDoGrupo {
  groupChatId: string;
  direction: "inbound" | "outbound";
  /** `group_sender.phone` já validado (`+` e dígitos), ou `null` quando só há lid. */
  telefoneDoRemetente: string | null;
}

export function ehPedidoDeAgendaPeloGrupo(config: MarcacaoPeloGrupo | null, m: MensagemDoGrupo): boolean {
  if (!config || !config.ligado || !config.grupo) return false;
  if (m.direction !== "inbound" || m.groupChatId !== config.grupo) return false;
  if (!m.telefoneDoRemetente) return false;
  const autorizados = new Set(config.autorizados.flatMap(phoneLookupVariants));
  return phoneLookupVariants(m.telefoneDoRemetente).some((v) => autorizados.has(v));
}
