import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * O MESMO tratamento para quem já tem o caminho na mão — relativo, ou vindo de
 * um `join` que não passou por `path.relative`.
 *
 * Existe porque `relativoEmBarraNormal` só cobre metade dos chamadores: um
 * `readdirSync` recursivo monta `app\api\v1\...` a partir de um diretório
 * RELATIVO, e ali não há raiz para subtrair. Sem esta porta, quem tem esse
 * caminho escreve o `.split(path.sep).join("/")` à mão — que é a cópia que
 * este arquivo existe para não ter.
 */
export function emBarraNormal(caminho: string): string {
  return caminho.split(path.sep).join("/");
}

/**
 * Caminho relativo à raiz, SEMPRE em barra normal — nunca a do sistema de
 * arquivos.
 *
 * Todo gate deste repo que varre o disco compara o que achou contra uma lista
 * DECLARADA: allowlist com motivo escrito, registro de telas, conjunto de
 * esperados. Essas listas são escritas — como todo caminho neste repo — com
 * `/`. No Windows, `path.relative` devolve `app\app\ai\page.tsx`, e aí o
 * gate erra nas DUAS pontas ao mesmo tempo: o arquivo JUSTIFICADO é acusado de
 * infrator, e a justificativa que o liberava é acusada de órfã. Nenhuma das
 * duas mensagens diz "seu separador de caminho está errado" — elas dizem que
 * há dívida nova e allowlist podre, que é ruído caro num gate cuja mensagem é
 * a única coisa que a próxima pessoa lê.
 *
 * No CI (Linux) passava, então o defeito só existia na máquina de quem
 * contribui do Windows — o pior lugar para ele estar.
 *
 * Vive aqui, num lugar só, pelo mesmo motivo que a varredura de
 * `varrer-codigo.ts` vive lá: quatro cópias desta linha é a garantia de que
 * uma delas vai divergir.
 */
export function relativoEmBarraNormal(raiz: string, absoluto: string): string {
  return emBarraNormal(path.relative(raiz, absoluto));
}

/**
 * PATH com `pastas` na frente do PATH de quem roda o teste, no separador do
 * sistema — nunca `${pasta}:${process.env.PATH}` escrito à mão.
 *
 * No Windows o PATH é separado por `;`. Com `:` a primeira entrada vira
 * `C:\...\stub:C:\Program Files\...`, e nem o Node acha o `bash` nem o bash
 * acha o stub — e o teste passa a falar com o `gh` DE VERDADE. O bash do Git
 * para Windows converte o PATH em `;` para a forma dele ao subir, então o
 * mesmo valor serve aos dois.
 */
export function pathComNaFrente(...pastas: string[]): string {
  return [...pastas, process.env.PATH ?? ""].join(path.delimiter);
}

/**
 * Caminho como o bash o lê quando vai ESCRITO dentro de um script.
 *
 * No Windows, `C:\Users\x` colado num trecho bash perde as barras (`C:Usersx`)
 * fora de aspas; em barra normal (`C:/Users/x`) o bash do Git para Windows o
 * aceita dentro e fora de aspas. Em Linux/macOS é a identidade.
 */
export function paraBash(caminho: string): string {
  return process.platform === "win32" ? emBarraNormal(caminho) : caminho;
}

/**
 * PATH mínimo de sistema, com `pastas` na frente: o shell, o git e as
 * ferramentas básicas, e NADA instalado à parte (o `gh`, um `ffmpeg` da
 * máquina de quem roda o teste).
 *
 * Em Linux/macOS é `/usr/sbin:/usr/bin:/sbin:/bin`. No Windows esse valor não
 * acha nem o `bash` (o Node procura o executável no PATH que o filho recebe),
 * e o equivalente são as pastas do Git para Windows onde moram `bash.exe` com
 * as ferramentas básicas (`usr\bin`) e `git.exe` — achadas no PATH de quem roda.
 */
export function pathMinimo(...pastas: string[]): string {
  if (process.platform !== "win32") return [...pastas, "/usr/sbin", "/usr/bin", "/sbin", "/bin"].join(":");
  const doProcesso = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const com = (...exes: string[]) =>
    doProcesso.find((pasta) => exes.every((exe) => existsSync(path.join(pasta, exe))));
  const doBash = com("bash.exe", "sed.exe");
  const doGit = com("git.exe");
  return [...pastas, ...[doBash, doGit].filter((p): p is string => Boolean(p))].join(path.delimiter);
}

/**
 * O caminho como o bash o devolve quando o recebe por variável de ambiente
 * (`HOME`, `TMPDIR`): no Windows o bash do Git o converte para a forma dele
 * (`C:\Users\x\AppData\Local\Temp\y` vira `/tmp/y`), e é essa forma que
 * aparece no que o script escreve. Em Linux/macOS é a identidade.
 */
export function comoOBashVe(caminho: string): string {
  if (process.platform !== "win32") return caminho;
  return execFileSync("cygpath", ["-u", caminho], { encoding: "utf8" }).trim();
}
