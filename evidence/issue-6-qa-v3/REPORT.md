# QA v3 — issue #6, PR #9 (rebuild do achado R2)

Base testada: `8ff6abc` (rebuild 2 do builder, R1 e R3 consertados).

## R2 — a prova em par comparava o dublê com ele mesmo

O par antigo (`pedido-pelo-grupo.handler.test.ts`) chamava o mesmo `vi.fn` nos dois lados.
Saiu de lá. O par novo mora em `lib/agenda/pedido-pelo-grupo.prova-em-par.test.ts`:

- `crm_find_and_book_appointment` real dos dois lados;
- a lista de livres sai de `horariosLivresDaOrg` real, sobre um Supabase em memória que filtra
  (jornada 09:00–18:00 em São Paulo, 14:00 ocupado, e uma segunda organização com jornada aberta
  que não pode vazar);
- o lado do grupo passa por `atendePedidoDeAgendaPeloGrupo` e `criarAgendaDoPedido` de produção.

Dublado e declarado: a escrita (`marcarAgendamentoHandler`, só registra), o modelo que extrai o
pedido (fixo), e o nome do profissional.

| Caso | Grupo | Direto | Concordam |
|---|---|---|---|
| 13:00 livre | escreve `starts_at` 16:00Z, org A, contato Rafael | idem | sim (corpo da escrita igual) |
| 14:00 ocupado | nenhuma escrita, "não está livre" + alternativas | nenhuma escrita, `horario_indisponivel` | sim (alternativas da ferramenta aparecem na resposta do grupo) |

Mutação de controle: ocupar 13:00 no fixture deixa 2 dos 3 casos vermelhos (medido).

## Fora do alcance desta máquina

O lado "pela tela" do par: grupo real no WAHA com o modelo real. Sem WhatsApp pareado nem chave de
modelo aqui. Fica como passo humano (`needs-you:` no PR). Recibo real em `idempotency_keys` segue
sem `test:db`.

## Gates

- `lib/agenda/`: 24 arquivos, 257 casos verdes
- `pnpm typecheck` limpo (`NODE_OPTIONS=--max-old-space-size=8192`)
- eslint dos arquivos alterados: 0
- `pnpm test:unit`: ver `test-unit-resumo.txt` — nenhum vermelho do PR
