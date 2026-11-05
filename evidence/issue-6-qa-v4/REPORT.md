# QA v4 — issue #6, PR #9 (achado R4 do revisor)

Base testada: `6404c14`.

## R4 — o fixture do par nomeava a view da ocupação do Google

`lib/agenda/pedido-pelo-grupo.prova-em-par.test.ts` listava `calendar_selected_external_events`,
e a cerca `tests/unit/ocupacao-do-google-vem-de-um-lugar-so.test.ts` só aceita esse nome em
`lib/agenda/ocupacao-externa.ts`. A linha saiu em `6404c14`; o `clienteFalso` já devolve `[]`
para tabela ausente, então o par não muda.

- Antes do conserto: a cerca dá 1 vermelho (`r4-cerca-antes-do-conserto.txt`)
- Depois: cerca + par, 2 arquivos e 6 casos verdes (`r4-cerca-e-par.txt`)

## Gates

- `lib/agenda/` e cercas da fatia: 26 arquivos, 277 casos verdes (`agenda-e-cercas.txt`)
- `pnpm typecheck` limpo (`typecheck.txt`)
- `pnpm lint`: 0 erros (`lint-resumo.txt`)
- `pnpm test:unit`: 29 arquivos vermelhos, todos já na lista de base do QA v3; nenhum novo
  (`test-unit-resumo.txt`, `test-unit-full.log`)
- pr-security-review: 0 achados. O `.or` do PostgREST recebe o nome sem `"`, `,`, `(`, `)`, `%`,
  `_`, `*` e `\`; toda consulta filtra `organization_id` vindo da linha do `event_log`

## Fora do alcance desta máquina

Grupo real no WAHA com o modelo real (passo humano, `needs-you:` no PR) e recibo real em
`idempotency_keys` (sem `test:db`).
