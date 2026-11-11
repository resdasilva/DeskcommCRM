"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useConfirmClient } from "@/hooks/ai/useConfirmClient";
import type { AgentInboxItem } from "@/hooks/ai/useAgentInbox";
import { useMarkPersonalContact } from "@/hooks/contacts/usePersonalContact";
import { useT } from "@/hooks/i18n/useT";

/**
 * Os dois botões do aviso de silêncio em mensagem pessoal (issue #10).
 * "É cliente" corrige o engano e faz o assistente responder; "pessoal" tira o
 * contato da operação (spec 21), e só gerente e dono podem.
 */
export function AcoesDoSilencio({ item }: { item: AgentInboxItem }) {
  const t = useT();
  const qc = useQueryClient();
  const acoes = item.silencio_pessoal ?? null;
  const confirmar = useConfirmClient();
  const marcar = useMarkPersonalContact(acoes?.contact_id ?? "");
  const [feito, setFeito] = useState<string | null>(null);

  if (item.kind !== "silencio_mensagem_pessoal" || !acoes) return null;
  const ocupado = confirmar.isPending || marcar.isPending;

  if (feito !== null) {
    return (
      <p role="status" className="mt-2 text-xs text-muted-foreground">
        {feito}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="acoes-do-silencio">
      <Button
        size="sm"
        disabled={ocupado}
        onClick={() => confirmar.mutate(acoes.conversation_id, { onSuccess: (d) => setFeito(d.message) })}
      >
        {t("É cliente, responder")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={ocupado || !acoes.pode_marcar_pessoal}
        onClick={() =>
          marcar.mutate(undefined, {
            onSuccess: () => {
              setFeito(t("Contato marcado como pessoal. O assistente não entra mais nessa conversa."));
              void qc.invalidateQueries({ queryKey: ["agent-inbox"] });
            },
          })
        }
      >
        {t("Marcar como contato pessoal")}
      </Button>
      {!acoes.pode_marcar_pessoal ? (
        <p className="basis-full text-xs text-muted-foreground">
          {t("Só gerente ou dono marca um contato como pessoal.")}
        </p>
      ) : null}
    </div>
  );
}
