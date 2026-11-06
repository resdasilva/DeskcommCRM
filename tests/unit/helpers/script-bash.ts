import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Grava um trecho bash num arquivo e devolve o caminho, para rodar com
 * `bash <arquivo>` em vez de `bash -c <trecho>`.
 *
 * No Windows, o trecho passado por `-c` atravessa a linha de comando do
 * processo, e o bash do Git para Windows a remonta com regras de aspas
 * próprias. Medido em `guarda-da-release-reconhece-o-corte.test.ts`: o passo
 * do `release.yml` (com `"\(.user.login)\t..."` dentro de um `--jq`) chegava
 * cortado logo depois do primeiro `if`, o bash saía 0 sem escrever nada, e o
 * caso lia "(nenhuma decisão)". Do arquivo o bash lê o texto byte a byte, e
 * em Linux o comportamento é o mesmo do `-c`.
 *
 * Os arquivos ficam numa pasta só, apagada quando o processo sai.
 */
let pasta: string | null = null;
let contador = 0;

export function scriptEmArquivo(trecho: string): string {
  if (pasta === null) {
    const criada = mkdtempSync(path.join(tmpdir(), "script-bash-"));
    pasta = criada;
    process.once("exit", () => rmSync(criada, { recursive: true, force: true }));
  }
  const arquivo = path.join(pasta, `trecho-${process.pid}-${++contador}.sh`);
  writeFileSync(arquivo, trecho);
  return arquivo;
}
