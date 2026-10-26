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
 */
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { normalizarTelefoneDeAviso, telefoneDeAvisoValido } from "@/lib/escalacao/estado-do-aviso";

export type RecusaDoNumeroAutorizado = "invalido" | "repetido";

export function adicionarNumeroAutorizado(
  lista: readonly string[],
  bruto: string,
): { lista: string[] } | { recusa: RecusaDoNumeroAutorizado } {
  const numero = normalizarTelefoneDeAviso(bruto);
  if (!telefoneDeAvisoValido(numero)) return { recusa: "invalido" };
  const jaNaLista = new Set(lista.flatMap(phoneLookupVariants));
  if (phoneLookupVariants(numero).some((v) => jaNaLista.has(v))) return { recusa: "repetido" };
  return { lista: [...lista, numero] };
}

export function removerNumeroAutorizado(lista: readonly string[], numero: string): string[] {
  return lista.filter((n) => n !== numero);
}
