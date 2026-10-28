/**
 * QUEM PODE MARCAR HORÁRIO PELO GRUPO — a lista que o admin monta em
 * Agenda › Avisos (issue #4, migration 0768).
 *
 * A forma é a do número do aviso (`+` e dígitos, E.164), e "repetido" usa as
 * duas grafias do nono dígito (`lib/channels/phone-variants.ts`): o mesmo
 * celular com e sem o 9 é UMA pessoa, e entraria duas vezes na lista.
 *
 * O banco recusa de novo o que não é E.164 e o repetido exato
 * (`fn_definir_aviso_de_agendamento`); aqui a recusa chega antes do clique em
 * Salvar, com a frase certa.
 *
 * Sem `+`, com 10 ou 11 dígitos e começando por um DDD brasileiro que existe,
 * o número é do Brasil e ganha o `+55` (issue #5): "11 98765-4321" virava
 * "+11987654321", um número dos EUA, e o colega certo ficava fora da lista sem
 * ninguém notar. Com `+` na frente nada é inferido — é assim que se digita
 * número de outro país. A lista mostra o número já com o `+55`, então a
 * suposição fica à vista de quem adicionou.
 */
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { normalizarTelefoneDeAviso, telefoneDeAvisoValido } from "@/lib/escalacao/estado-do-aviso";

// Os DDDs em uso no Brasil (Anatel). 20, 23, 25, 26, 29, 30, 36, 39, 40, 50,
// 52, 56–60, 70, 72, 76, 78, 80 e 90 não existem e não ganham +55.
const DDDS_DO_BRASIL = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function comCodigoDoBrasil(bruto: string): string {
  if (bruto.trim().startsWith("+")) return bruto;
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length !== 10 && digitos.length !== 11) return bruto;
  return DDDS_DO_BRASIL.has(Number(digitos.slice(0, 2))) ? `+55${digitos}` : bruto;
}

export type RecusaDoNumeroAutorizado = "invalido" | "repetido";

export function adicionarNumeroAutorizado(
  lista: readonly string[],
  bruto: string,
): { lista: string[] } | { recusa: RecusaDoNumeroAutorizado } {
  const numero = normalizarTelefoneDeAviso(comCodigoDoBrasil(bruto));
  if (!telefoneDeAvisoValido(numero)) return { recusa: "invalido" };
  const jaNaLista = new Set(lista.flatMap(phoneLookupVariants));
  if (phoneLookupVariants(numero).some((v) => jaNaLista.has(v))) return { recusa: "repetido" };
  return { lista: [...lista, numero] };
}

export function removerNumeroAutorizado(lista: readonly string[], numero: string): string[] {
  return lista.filter((n) => n !== numero);
}
