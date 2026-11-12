"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirmClient } from "@/hooks/ai/useConfirmClient";
import type { AgentInboxItem } from "@/hooks/ai/useAgentInbox";
import { useMarkPersonalContact } from "@/hooks/contacts/usePersonalContact";
import { useT } from "@/hooks/i18n/useT";

/**
 * Os dois botões do aviso de silêncio em mensagem pessoal (issue #10).
 * "É cliente" corrige o engano e faz o assistente responder; "pessoal" tira o
 * contato da operação (spec 21), e só gerente e dono podem.
 *
 * O resultado sai num aviso flutuante, e não na linha: os dois botões fecham o
 * aviso, a lista se relê e a linha some na hora. Medido pela tela em 12/11/2026:
 * com a frase na linha, ninguém chegava a lê-la.
 */
export function AcoesDoSilencio({ item }: { item: AgentInboxItem }) {
  const acoes = item.silencio_pessoal ?? null;
  // Os ganchos moram no filho: aviso de outro tipo não monta nada, e a lista
  // segue funcionando onde não há QueryClient (os testes da Central, por exemplo).
  if (item.kind !== "silencio_mensagem_pessoal" || !acoes) return null;
  return <Botoes acoes={acoes} />;
}

function Botoes({ acoes }: { acoes: NonNullable<AgentInboxItem["silencio_pessoal"]> }) {
  const t = useT();
  const qc = useQueryClient();
  const confirmar = useConfirmClient();
  const marcar = useMarkPersonalContact(acoes.contact_id);
  const ocupado = confirmar.isPending || marcar.isPending;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="acoes-do-silencio">
      <Button
        size="sm"
        disabled={ocupado}
        onClick={() =>
          confirmar.mutate(acoes.conversation_id, { onSuccess: (d) => toast.success(d.message) })
        }
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
              toast.success(
                t("Contato marcado como pessoal. O assistente não entra mais nessa conversa."),
              );
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
