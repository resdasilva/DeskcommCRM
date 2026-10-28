"use client";
/**
 * "MARCAR PELO GRUPO" — o interruptor e a lista de quem pode marcar horário
 * escrevendo no grupo que recebe o aviso de agendamento (issue #4, 0768).
 *
 * Só tela e dado: nada é lido do grupo ainda. Sem grupo escolhido o
 * interruptor fica indisponível e diz por quê; tirar o grupo desliga sozinho
 * (`mudarRascunhoDoAviso`). A lista só aparece com o interruptor ligado, e
 * cada número passa por `adicionarNumeroAutorizado` antes de entrar.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { adicionarNumeroAutorizado, removerNumeroAutorizado } from "@/lib/agenda/numeros-autorizados";

const FRASE_DA_RECUSA = {
  invalido: "Esse número ainda não está completo. Comece pelo código do país.",
  repetido: "Esse número já está na lista de quem pode marcar.",
} as const;

export function MarcarPeloGrupo({
  temGrupo,
  ligado,
  numeros,
  desabilitado,
  telefoneExemplo,
  onLigado,
  onNumeros,
}: {
  temGrupo: boolean;
  ligado: boolean;
  numeros: string[];
  desabilitado: boolean;
  telefoneExemplo: string;
  onLigado: (v: boolean) => void;
  onNumeros: (numeros: string[]) => void;
}) {
  const t = useT();
  const [novo, setNovo] = useState("");
  const [recusa, setRecusa] = useState<keyof typeof FRASE_DA_RECUSA | null>(null);

  function adicionar() {
    const r = adicionarNumeroAutorizado(numeros, novo);
    if ("recusa" in r) {
      setRecusa(r.recusa);
      return;
    }
    onNumeros(r.lista);
    setNovo("");
    setRecusa(null);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3" data-testid="marcar-pelo-grupo">
      <div className="flex items-start gap-3">
        <Switch
          id="marcar-pelo-grupo"
          checked={temGrupo && ligado}
          disabled={!temGrupo || desabilitado}
          onCheckedChange={onLigado}
          aria-label={t("Marcar horário pelo grupo")}
        />
        <div className="space-y-1">
          <Label htmlFor="marcar-pelo-grupo" className="text-sm font-medium">
            {t("Marcar horário pelo grupo")}
          </Label>
          <p className="text-xs text-muted-foreground" data-testid="marcar-pelo-grupo-explicacao">
            {temGrupo
              ? t("Só os números da lista abaixo podem marcar horário escrevendo no grupo.")
              : t("Para marcar pelo grupo, escolha antes o grupo que recebe os avisos.")}
          </p>
        </div>
      </div>

      {temGrupo && ligado ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="numero-autorizado">{t("Quem pode marcar")}</Label>
          {numeros.length === 0 ? (
            <p className="text-xs text-warning-fg" data-testid="sem-numeros-autorizados">
              {t("Ninguém na lista ainda. Enquanto ela estiver vazia, ninguém marca pelo grupo.")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="numeros-autorizados">
              {numeros.map((n) => (
                <li key={n} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono">{n}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={desabilitado}
                    onClick={() => onNumeros(removerNumeroAutorizado(numeros, n))}
                  >
                    {t("Remover")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="numero-autorizado"
              inputMode="tel"
              className="w-full sm:w-72"
              placeholder={telefoneExemplo}
              value={novo}
              disabled={desabilitado}
              onChange={(e) => {
                // Guarda o que foi digitado: normalizar aqui poria o `+` antes de
                // saber se a pessoa o digitou, e "11 98765-4321" viraria número dos
                // EUA. Quem decide o `+55` é `adicionarNumeroAutorizado` (issue #5).
                setNovo(e.target.value);
                setRecusa(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  adicionar();
                }
              }}
              aria-invalid={recusa !== null}
            />
            <Button variant="outline" size="sm" disabled={desabilitado || novo.trim() === ""} onClick={adicionar}>
              {t("Adicionar")}
            </Button>
          </div>
          {recusa ? (
            <p className="text-xs text-destructive" data-testid="numero-autorizado-recusado">
              {t(FRASE_DA_RECUSA[recusa])}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("A lista vale depois de salvar.")}</p>
        </div>
      ) : null}
    </div>
  );
}
