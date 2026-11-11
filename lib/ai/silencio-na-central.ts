/**
 * AS AÇÕES DO AVISO DE SILÊNCIO, PROJETADAS NO SERVIDOR (issue #10).
 *
 * O aviso `silencio_mensagem_pessoal` aponta para a conversa. Para o botão
 * "Marcar como contato pessoal" a tela precisa do contato, e para desabilitá-lo
 * com o motivo precisa saber se o papel pode marcar (só gerente e dono, spec
 * 21). As duas respostas saem daqui: o browser não deriva nada de referência
 * livre, a mesma regra de `resolverDestinosDosAvisos`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLE_RANK, type Role } from "@/lib/auth/types";

export interface AcoesDoSilencio {
  conversation_id: string;
  contact_id: string;
  pode_marcar_pessoal: boolean;
}

interface AvisoMinimo {
  kind: string;
  ref_kind: string | null;
  ref_id: string | null;
  status: string;
}

const ehDoSilencio = (i: AvisoMinimo): boolean =>
  i.kind === "silencio_mensagem_pessoal" && i.status === "open" && i.ref_kind === "conversation" && i.ref_id !== null;

export async function anexarAcoesDoSilencio<T extends AvisoMinimo>(
  admin: SupabaseClient,
  orgId: string,
  role: Role,
  itens: T[],
): Promise<Array<T | (T & { silencio_pessoal: AcoesDoSilencio })>> {
  const conversas = [...new Set(itens.filter(ehDoSilencio).map((i) => i.ref_id as string))];
  if (conversas.length === 0) return itens;

  const { data } = await admin
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", orgId)
    .in("id", conversas);
  const contatoDe = new Map(
    ((data ?? []) as Array<{ id: string; contact_id: string }>).map((c) => [c.id, c.contact_id]),
  );
  const podeMarcar = ROLE_RANK[role] >= ROLE_RANK.manager;

  return itens.map((i) => {
    const contato = ehDoSilencio(i) ? contatoDe.get(i.ref_id as string) : undefined;
    return contato === undefined
      ? i
      : { ...i, silencio_pessoal: { conversation_id: i.ref_id as string, contact_id: contato, pode_marcar_pessoal: podeMarcar } };
  });
}
