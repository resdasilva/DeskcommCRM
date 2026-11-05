# QA v1 · issue #6 · PR #9 · head 2479e53

Resultado: ❌ falha. Os cinco ACs são cumpridos pelo código no nível unitário, mas `pnpm test:unit` ganha um arquivo vermelho causado pelo PR.

## O que reprova
- `tests/unit/rotulo-do-contato.test.ts` › "nenhum arquivo remonta a cadeia de fallback à mão"
  - acusa `lib/agenda/pedido-pelo-grupo.handler.ts:258`: `nome: c.display_name ?? c.name ?? nome`
  - falha isolado também (`rotulo-do-contato.txt`); não está entre os 27 vermelhos da base
  - conserto esperado: usar `nomeDoContato(c) ?? nome` de `lib/contacts/rotulo-do-contato.ts:105`

## O que passou
- Testes da fatia: 4 arquivos, 46 casos (`testes-da-fatia.txt`), incluindo os escritos pelo QA
- `pnpm typecheck`: limpo (precisou `NODE_OPTIONS=--max-old-space-size=8192`; com 4 GB estoura o heap no Windows)
- `pnpm lint`: 0 erros
- `pnpm test:unit`: 30 arquivos vermelhos; 28 são da base no Windows; `imagens-ok-so-aceita-pulo-declarado` passa isolado (carga); `rotulo-do-contato` é do PR

## Testes que o QA escreveu
- `lib/agenda/pedido-pelo-grupo.handler-agenda.test.ts`: a conferência de horário livre do remarcar (ocupado não chama a ferramenta, livre manda o instante do slot e ignora o próprio agendamento, 9:00 = 09:00, sem serviço e recusa da consulta), a chave de idempotência e a organização chegando à ferramenta de marcar, e o cancelar só no apontado
- `lib/agenda/pedido-pelo-grupo-atendimento.test.ts`: recibo `em_curso` adia sem ler texto, sem agenda, sem resposta e sem auditoria

## Lacunas não escritas
- Média: `clientesPorNome` (`.or(name.ilike."…")` no PostgREST) e o recibo real em `idempotency_keys` não foram exercitados contra Supabase; um nome com `"` quebra o filtro (Baixa)
- Média: prova em par só com a ferramenta dublada; não houve grupo do WhatsApp real com WAHA
- Baixa: o grupo recebe duas mensagens para a mesma marcação (resposta do pedido + aviso de agendamento), já declarado pelo builder
