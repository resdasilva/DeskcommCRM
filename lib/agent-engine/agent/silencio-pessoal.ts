/**
 * O SILÊNCIO DO TURNO QUANDO A MENSAGEM É PESSOAL (issue #10; spec
 * docs/superpowers/specs/2026-11-09-silencio-em-mensagem-pessoal-design.md).
 *
 * Quem usa este CRM costuma ter um número só para a vida e para o trabalho.
 * Com `ai_agent_versions.silencio_em_mensagem_pessoal` ligado, o agente não
 * responde a mensagem da mãe, do amigo ou do fornecedor — e continua atendendo:
 * a próxima mensagem do mesmo contato abre um turno normal.
 *
 * NÃO É PASSAGEM. A primeira versão (PR 11) ia de carona em
 * `request_human_handoff` e gravava `force_human`: o amigo que mandou "viu o
 * jogo?" ficava sem IA quando pedisse orçamento no dia seguinte, e para o
 * autônomo não há equipe que receba a passagem. Este módulo nunca toca
 * `force_human`, `bot_silenced_until`, `is_blocked`, `passagens_de_atendimento`
 * nem cron.
 *
 * O que vem do PR 11 e foi medido lá: o bloco no PROMPT (a regra só na
 * descrição da ferramenta foi ignorada 5 de 5 vezes), a frase que desautoriza
 * respostas antigas do histórico, e a trava da corrida entre `send_message` e o
 * silêncio no mesmo passo.
 */
import type pg from 'pg';
import { z } from 'zod';

import { guardServiceEffect } from '@/lib/atendimento/fronteira-server';
import { traduzir } from '@/lib/i18n/dicionario';
import { normalizarIdioma, type Idioma } from '@/lib/i18n/idiomas';
import { ehOptOutProvavel } from '@/lib/opt-out/deteccao';

import { insertInboxItem } from '../db/repository';
import type { Logger } from '../obs/logger';
import { findForbiddenKey, zodIssuesSummary } from './lead-state';

/** Gravado na Central no idioma da organização (o título nunca passa por t() na tela). */
export const TITULO_DO_AVISO_DE_SILENCIO = 'O assistente não respondeu: a mensagem parece pessoal';

export const SILENCIO_PESSOAL_SYSTEM_BLOCK =
  '## Mensagem pessoal para o dono ou a equipe\n' +
  'Este número também recebe mensagens pessoais de quem conhece o dono ou alguém da equipe: família ' +
  '(mãe, pai, filho, filha, irmão, esposa, marido), amigos e fornecedores do negócio. Essas pessoas ' +
  'não são clientes, e você NUNCA responde no lugar do dono ou de alguém da equipe.\n' +
  'A mensagem é pessoal quando quem escreve trata alguém da equipe como parente ou amigo (por ' +
  'exemplo, "oi filho, é a mãe", "amor, chego tarde"), faz convite ou fala de assunto de família, ' +
  'ou fala como fornecedor do negócio (entrega, pedido de compra, cobrança ao negócio).\n' +
  'Nesse caso, a ÚNICA ação do turno é chamar stay_silent, com por_que dizendo quem parece ser e o ' +
  'que quer. Não chame send_message, não cumprimente, não aceite nem recuse convite, não diga que ' +
  'vai passar o recado. O contato não recebe nada, e o dono vê um aviso. Esta regra vale acima das ' +
  'instruções de atendimento deste agente.\n' +
  'Se o histórico mostrar respostas suas a mensagens pessoais, elas foram um erro: não as repita nem ' +
  'as continue, e trate a mensagem nova pela regra acima.\n' +
  'Se a mensagem traz assunto de trabalho (produto, preço, horário, agendamento, serviço), mesmo ' +
  'junto de conversa pessoal, é atendimento: responda só a parte do trabalho.\n' +
  'Pedido para parar de receber mensagens nunca é mensagem pessoal.';

/**
 * A ferramenta (e o bloco, e a trava) só existem com a chave LIGADA e para
 * contato que ninguém confirmou como cliente. Uma régua só para os três:
 * nomear no prompt uma ferramenta ausente faz o modelo tentar chamá-la.
 */
export function silencioPessoalDisponivel(
  agentConfig: { silencioEmMensagemPessoal?: boolean } | null,
  contato: { cliente_confirmado?: boolean } | null | undefined,
): boolean {
  if (agentConfig?.silencioEmMensagemPessoal !== true) return false;
  return contato?.cliente_confirmado !== true;
}

export function blocoDoSilencioPessoal(disponivel: boolean): string | null {
  return disponivel ? SILENCIO_PESSOAL_SYSTEM_BLOCK : null;
}

/**
 * `seq` é o contador de mensagens físicas já enviadas neste turno.
 *   - `silencio` — nada saiu e nada está saindo;
 *   - `ja_falou` — o modelo já mandou mensagem: o que saiu não volta;
 *   - `em_voo`   — `seq` ainda é 0, mas um envio do MESMO passo está saindo.
 */
export function decidirSilencioDoTurno(e: {
  seq: number;
  enviosEmVoo: number;
}): 'silencio' | 'ja_falou' | 'em_voo' {
  if (e.seq > 0) return 'ja_falou';
  return e.enviosEmVoo > 0 ? 'em_voo' : 'silencio';
}

/**
 * A TRAVA DO SILÊNCIO: a corrida entre `send_message` e `stay_silent` chamados
 * no MESMO passo — o SDK executa as chamadas paralelas juntas. As duas pontas
 * são síncronas (nenhum `await` entre olhar e marcar), então só há dois
 * desfechos: o envio começou antes (`enviosEmVoo() > 0`, e o silêncio recusa),
 * ou o silêncio foi reservado antes (o envio é recusado sem sair).
 */
export function criarTravaDoSilencio() {
  let emVoo = 0;
  let reservado = false;
  return {
    /** `false` = o silêncio já foi reservado neste turno: o envio não sai. */
    comecarEnvio: (): boolean => {
      if (reservado) return false;
      emVoo += 1;
      return true;
    },
    terminarEnvio: (): void => {
      emVoo = Math.max(0, emVoo - 1);
    },
    enviosEmVoo: (): number => emVoo,
    reservarSilencio: (): void => {
      reservado = true;
    },
    /** O registro foi abortado (a fronteira do atendimento mudou): o modelo volta a poder falar. */
    soltarSilencio: (): void => {
      reservado = false;
    },
  };
}

export type TravaDoSilencio = ReturnType<typeof criarTravaDoSilencio>;

/** Envolve `send_message` e `send_template` com a trava. Indisponível: ferramentas intocadas. */
export function cercarEnviosPelaTravaDoSilencio(
  rawTools: Record<string, unknown>,
  disponivel: boolean,
  trava: TravaDoSilencio,
): void {
  if (!disponivel) return;
  for (const nome of ['send_message', 'send_template'] as const) {
    const ferramenta = rawTools[nome] as { execute?: (...args: unknown[]) => unknown } | undefined;
    const original = ferramenta?.execute;
    if (typeof original !== 'function') continue;
    rawTools[nome] = {
      ...ferramenta,
      execute: async (...args: unknown[]) => {
        // Antes de qualquer await: é isto que torna a corrida decidível.
        if (!trava.comecarEnvio()) {
          return {
            ok: false,
            error: {
              code: 'silencio_do_turno',
              message:
                'o silêncio deste turno já foi registrado (mensagem pessoal): NÃO envie nada ao ' +
                'contato — encerre o turno agora.',
            },
          };
        }
        try {
          return await original(...args);
        } finally {
          trava.terminarEnvio();
        }
      },
    };
  }
}

/** Validação REAL: estrita. O schema do SDK abaixo é largo de propósito (padrão da casa). */
const staySilentInputSchema = z.strictObject({ por_que: z.string().min(1).max(300) });

const ENSINO =
  'Campo aceito: por_que (quem parece ser e o que quer, em uma frase de até 300 caracteres). Nada ' +
  'além disso. Contato, organização e conversa vêm do runtime, nunca do payload.';

export const STAY_SILENT_TOOL_DEF = {
  description:
    'Registra que este turno termina SEM resposta porque a mensagem é pessoal para o dono ou a ' +
    'equipe (família, amigo, fornecedor), e não um atendimento. Nada é enviado ao contato, e o dono ' +
    'vê um aviso. Chame SEM enviar nada antes. Nunca use para pedido de parar de receber mensagens, ' +
    'nem para quem pergunta por produto, preço, horário, agendamento ou serviço.',
  inputSchema: z
    .object({
      por_que: z
        .string()
        .describe('quem parece ser e o que quer. Ex.: "mãe do dono chamando para almoçar no domingo"'),
    })
    .passthrough(),
};

export type StaySilentResult =
  | { ok: true; status: 'silencio_registrado'; message: string }
  | { ok: false; error: { code: 'invalid_payload' | 'ja_falou' | 'em_voo'; message: string } };

/** Gêmea da função privada de `human-handoff.ts`: o aviso nasce no idioma da organização. */
async function idiomaDaOrganizacao(db: Pick<pg.Pool, 'query'>, tenantId: string, log: Logger): Promise<Idioma> {
  try {
    const { rows } = await db.query<{ locale: string | null }>(
      'select locale from organizations where id = $1',
      [tenantId],
    );
    return normalizarIdioma(rows[0]?.locale ?? null);
  } catch (err) {
    log.warn('idioma da organização não lido — aviso da Central em português', {
      error: err instanceof Error ? err.message.slice(0, 120) : 'erro desconhecido',
    });
    return 'pt-BR';
  }
}

/**
 * A ferramenta `stay_silent`. Tudo até `reservarSilencio()` é SÍNCRONO: entre
 * olhar os envios em voo e reservar não pode haver `await`, senão um
 * `send_message` do mesmo passo entra no meio.
 *
 * O aviso da Central é a rede para o falso positivo (cliente calado por
 * engano). Se ele não puder nascer, o silêncio vale mesmo assim e o erro vai
 * para o log: responder à mãe do dono porque o banco piscou seria pior.
 */
export async function applyStaySilent(
  db: Pick<pg.Pool, 'query'>,
  ids: { tenantId: string; conversationId: string },
  opts: {
    pendentesDoCliente: readonly string[];
    seq: number;
    trava: TravaDoSilencio;
    log: Logger;
  },
  rawInput: unknown,
): Promise<StaySilentResult> {
  const forbidden = findForbiddenKey(rawInput);
  if (forbidden !== null) {
    return { ok: false, error: { code: 'invalid_payload', message: `campos não reconhecidos: ${forbidden}. ${ENSINO}` } };
  }
  const parsed = staySilentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'invalid_payload', message: `payload inválido em stay_silent (${zodIssuesSummary(parsed.error)}). ${ENSINO}` },
    };
  }
  // OPT-OUT VENCE: o silêncio não pode virar o jeito de não responder a quem pediu para parar.
  if (opts.pendentesDoCliente.some((texto) => ehOptOutProvavel(texto))) {
    return {
      ok: false,
      error: {
        code: 'invalid_payload',
        message:
          'stay_silent recusado: a mensagem parece um pedido para não receber mais mensagens. Isso ' +
          'não é assunto pessoal — trate o pedido.',
      },
    };
  }
  const decisao = decidirSilencioDoTurno({ seq: opts.seq, enviosEmVoo: opts.trava.enviosEmVoo() });
  if (decisao !== 'silencio') {
    return {
      ok: false,
      error: {
        code: decisao,
        message:
          (decisao === 'ja_falou'
            ? 'stay_silent recusado: você já enviou mensagem ao contato neste turno. '
            : 'stay_silent recusado: há uma mensagem sua ao contato saindo neste mesmo passo. ') +
          'Não há silêncio a registrar — encerre o turno.',
      },
    };
  }
  opts.trava.reservarSilencio();

  try {
    await guardServiceEffect();
  } catch (err) {
    opts.trava.soltarSilencio();
    throw err;
  }
  try {
    const idioma = await idiomaDaOrganizacao(db, ids.tenantId, opts.log);
    await insertInboxItem(
      db,
      ids.tenantId,
      {
        kind: 'silencio_mensagem_pessoal',
        severity: 'info',
        title: traduzir(TITULO_DO_AVISO_DE_SILENCIO, idioma),
        refKind: 'conversation',
        refId: ids.conversationId,
      },
      'kind_e_ref',
    );
  } catch (err) {
    opts.log.error('silêncio registrado, mas o aviso da Central não nasceu', {
      conversation_id: ids.conversationId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido',
    });
  }

  return {
    ok: true,
    status: 'silencio_registrado',
    message:
      'Silêncio registrado. Nada foi enviado ao contato. Encerre o turno agora, sem chamar send_message.',
  };
}
