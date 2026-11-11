#!/usr/bin/env bash
# Prova do silêncio do turno em mensagem pessoal (issue #10), turno real, modelo real.
# Uso: bash evidence/issue-10-qa-v4/rodar.sh "<arquivo de ambiente do Supabase local>" <conversas da mãe, com vírgula> <conversa comercial com a chave ligada> <conversa comercial com a chave desligada>
set -euo pipefail
export ENV_FILE="$1"; MAE="$2"; COMERCIAL_LIGADA="$3"; COMERCIAL_DESLIGADA="$4"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out=evidence/issue-10-qa-v4
S="pnpm exec tsx scripts/prova-silencio-pessoal-turno-real.ts"
CONVERSAS=$MAE N=10 FRASE=mae $S > "$out/mae-x20.jsonl"
CONVERSAS=$MAE N=5 FRASE=mae-longa $S > "$out/mae-longa-x10.jsonl"
CONVERSAS=$MAE N=5 FRASE=mae,preco $S > "$out/volta-sozinha-x10.jsonl"
CONVERSAS=$MAE N=5 FRASE=misturada $S > "$out/misturada-x10.jsonl"
CONVERSAS=$COMERCIAL_LIGADA N=5 FRASE=comercial $S > "$out/comercial-chave-ligada-x5.jsonl"
CONVERSAS=$COMERCIAL_DESLIGADA N=5 FRASE=comercial $S > "$out/comercial-chave-desligada-x5.jsonl"
CONVERSAS=${MAE%%,*} N=5 FRASE=mae CLIENTE_CONFIRMADO=1 $S > "$out/cliente-confirmado-x5.jsonl"
CONVERSAS=${MAE%%,*} N=5 FRASE=parar $S > "$out/parar-x5.jsonl"
node -e '
const fs=require("fs"),dir=process.argv[1];
const ler=f=>fs.readFileSync(dir+"/"+f+".jsonl","utf8").split("\n").filter(l=>l.startsWith("{\"frase\"")).map(l=>JSON.parse(l));
const limpo=x=>!x.erro&&x.force_human_depois===false&&x.bot_silenciado_depois===false&&x.passagens.length===0;
const calou=x=>limpo(x)&&x.mensagens_ao_contato.length===0&&x.stay_silent.includes("ok")&&x.aviso_aberto===1&&x.agendados.jobs===0&&x.agendados.crons===0;
const respondeu=x=>limpo(x)&&x.mensagens_ao_contato.length>0&&!x.stay_silent.includes("ok");
const regua={
  "mae-x20":t=>t.filter(calou).length,
  "mae-longa-x10":t=>t.filter(calou).length,
  "volta-sozinha-x10":t=>t.filter(x=>x.passo===2&&respondeu(x)).length,
  "misturada-x10":t=>t.filter(respondeu).length,
  "comercial-chave-ligada-x5":t=>t.filter(respondeu).length,
  "comercial-chave-desligada-x5":t=>t.filter(x=>respondeu(x)&&!x.stay_silent_chamada).length,
  "cliente-confirmado-x5":t=>t.filter(x=>!x.stay_silent_chamada&&x.aviso_aberto===0).length,
  "parar-x5":t=>t.filter(x=>!x.stay_silent.includes("ok")&&x.aviso_aberto===0).length,
};
for(const [f,conta] of Object.entries(regua)){const t=ler(f);const total=f==="volta-sozinha-x10"?t.filter(x=>x.passo===2).length:t.length;console.log(f+": "+conta(t)+" de "+total);}
' "$out" | tee "$out/placar.txt"
