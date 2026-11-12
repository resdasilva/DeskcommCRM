/**
 * O BANCO DO SILÊNCIO EM MENSAGEM PESSOAL (migration 9343).
 *
 * Um aviso aberto por conversa; ele fecha sozinho quando a conversa é
 * encerrada ou quando sai qualquer mensagem nela; e marcar o contato como
 * pessoal zera a marca de cliente confirmado.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";

const KIND = "silencio_mensagem_pessoal";
const CONTATO = "cccccccc-9343-4000-8000-000000000001";
const CONVERSA = "cccccccc-9343-4000-8000-000000000011";

function abrir(): void {
  sql(`insert into public.agent_inbox_items (organization_id, kind, severity, title, ref_kind, ref_id)
       values ('${GOV_ORG}', '${KIND}', 'info', 'O assistente não respondeu', 'conversation', '${CONVERSA}')
       on conflict do nothing;`);
}

function avisos(): string[] {
  const saida = sql(`select status || case when resolved_at is not null then '+fim' else '' end
                       from public.agent_inbox_items
                      where organization_id = '${GOV_ORG}' and kind = '${KIND}' and ref_id = '${CONVERSA}'
                      order by created_at;`);
  return saida === "" ? [] : saida.split("\n");
}

beforeAll(() => {
  seedGov();
  sql(`insert into public.contacts (id, organization_id, display_name)
         values ('${CONTATO}', '${GOV_ORG}', 'Mãe do dono');
       insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
         values ('${CONVERSA}', '${GOV_ORG}', '${CONTATO}', '${GOV_SESSION}', 'open');`);
});

beforeEach(() => {
  sql(`delete from public.agent_inbox_items where organization_id = '${GOV_ORG}' and kind = '${KIND}';
       delete from public.messages where conversation_id = '${CONVERSA}';
       update public.conversations set status = 'open' where id = '${CONVERSA}';
       update public.contacts set is_personal = false, cliente_confirmado_em = null where id = '${CONTATO}';`);
});

describe("o aviso do silêncio em mensagem pessoal", () => {
  it("no máximo um aberto por conversa", () => {
    abrir();
    abrir();
    expect(avisos()).toEqual(["open"]);
  });

  it("depois de resolvido, um novo silêncio abre outro", () => {
    abrir();
    sql(`update public.agent_inbox_items set status = 'resolved', resolved_at = now()
          where kind = '${KIND}' and ref_id = '${CONVERSA}';`);
    abrir();
    expect(avisos()).toEqual(["resolved+fim", "open"]);
  });

  it("conversa encerrada fecha o aviso", () => {
    abrir();
    sql(`update public.conversations set status = 'closed' where id = '${CONVERSA}';`);
    expect(avisos()).toEqual(["resolved+fim"]);
  });

  it("mensagem de saída na conversa fecha o aviso", () => {
    abrir();
    sql(`insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via)
         values ('${GOV_ORG}', '${CONVERSA}', '${GOV_SESSION}', '${CONTATO}', 'text', 'outbound', 'sent', 'oi mãe', 'external_device');`);
    expect(avisos()).toEqual(["resolved+fim"]);
  });

  it("mensagem de entrada não fecha o aviso (controle)", () => {
    abrir();
    sql(`insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via)
         values ('${GOV_ORG}', '${CONVERSA}', '${GOV_SESSION}', '${CONTATO}', 'text', 'inbound', 'received', 'filho?', 'crm');`);
    expect(avisos()).toEqual(["open"]);
  });
});

describe("a marca de cliente confirmado", () => {
  it("some quando o contato vira pessoal", () => {
    sql(`update public.contacts set cliente_confirmado_em = now() where id = '${CONTATO}';`);
    expect(sql(`select cliente_confirmado_em is not null from public.contacts where id = '${CONTATO}';`)).toBe("t");
    sql(`update public.contacts set is_personal = true where id = '${CONTATO}';`);
    expect(sql(`select cliente_confirmado_em is null from public.contacts where id = '${CONTATO}';`)).toBe("t");
  });

  it("a chave da versão nasce desligada", () => {
    expect(
      sql(`select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'ai_agent_versions'
              and column_name = 'silencio_em_mensagem_pessoal';`),
    ).toBe("false");
  });
});
