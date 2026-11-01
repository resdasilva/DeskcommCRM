#!/usr/bin/env bash
# Prova do #10 no turno real de WhatsApp (inbound_turn, com histórico, modelo real).
# Uso: bash evidence/issue-10-qa-v3/rodar.sh "<caminho do arquivo de ambiente do Supabase local>"
set -euo pipefail
export ENV_FILE="$1"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out=evidence/issue-10-qa-v3
mkdir -p "$out"
MAE=5658e152-0590-443c-8783-2e376dca3ec2,1e59bc20-0864-4398-968a-1f02e27a352e
# AC: a frase do AC, 10 tentativas em cada conversa do dono (as duas já têm "Oi, mãe! Vou sim" no histórico)
CONVERSAS=$MAE N=10 FRASE=mae pnpm exec tsx scripts/prova-passagem-silenciosa-turno-real.ts \
  > "$out/turno-real-mae-x20.jsonl"
# extra: o texto exato que o dono mandou, 5 em cada conversa
CONVERSAS=$MAE N=5 FRASE=mae-longa pnpm exec tsx scripts/prova-passagem-silenciosa-turno-real.ts \
  > "$out/turno-real-mae-longa-x10.jsonl"
# AC: comercial, 5 tentativas na conversa com histórico comercial
CONVERSAS=687d2dcd-63f4-49a4-8d9d-14db16013dd4 N=5 FRASE=comercial \
  pnpm exec tsx scripts/prova-passagem-silenciosa-turno-real.ts > "$out/turno-real-comercial-x5.jsonl"
echo "pronto: $out"
# placar: passagem mensagem_pessoal sem nada ao contato (mãe) · sem passagem e com resposta (comercial)
node -e '
const fs=require("fs");
for (const f of ["turno-real-mae-x20","turno-real-mae-longa-x10","turno-real-comercial-x5"]) {
  const ls=fs.readFileSync(process.argv[1]+"/"+f+".jsonl","utf8").split("\n").filter(l=>l.startsWith("{\"frase\""));
  const t=ls.map(l=>JSON.parse(l));
  const ok=f.includes("comercial")
    ? t.filter(x=>x.passagem.length===0&&x.mensagens_ao_contato.length>0&&!x.erro).length
    : t.filter(x=>x.mensagens_ao_contato.length===0&&x.passagem.some(p=>p.motivo==="mensagem_pessoal")&&!x.erro).length;
  console.log(f+": "+ok+" de "+t.length);
}' "$out" | tee "$out/placar.txt"
