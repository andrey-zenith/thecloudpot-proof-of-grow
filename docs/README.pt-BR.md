# TheCloudPot — Proof of Grow (MVP Solana Devnet)

Registra na **Solana Devnet** a impressão digital (SHA-256) de um snapshot de cultivo e permite
que qualquer pessoa confira depois se os dados apresentados são os mesmos.

```
Export JSON → sanitize → JCS (RFC 8785) → SHA-256 → Memo na Devnet → assinatura → verify
```

- **On-chain:** só o hash + metadados mínimos (`app`, `v`, `schema`, `alg`, `canon`, `hash`).
- **Off-chain:** snapshot sanitizado, recibo e registro de tentativas.
- **O que a prova demonstra:** integridade do snapshot ancorado e qual carteira assinou.
  **Não demonstra:** calibração, veracidade física da medição, identidade do Arduino nem histórico
  completo. Quem assina é a carteira do backend, não o Arduino.

Nada aqui altera o Arduino, a PCB, o app ou a Function que já alimenta o Firestore.

---

## 1. Preparar (uma vez, ~15 min)

Requisitos: **Node 22 ou mais novo** e npm. Alvo da Function: runtime `nodejs24` (`.nvmrc`).
Rodar localmente com Node 26 funciona; os tipos estão fixados no Node 24 (`@types/node`), então o TypeScript
acusa erro se o código usar alguma API que não exista no runtime da Function.

```bash
cd proof-of-grow
npm install
npm test                  # 28 testes offline, sem rede e sem segredos
npm run keygen            # cria secrets/devnet-wallet.json e um .env com segredo HMAC aleatório
```

1. Abra o `.env` e preencha `POG_DEVICE_ID` com o identificador do dispositivo (o MAC do nome do arquivo de export).
2. Copie o export real, **sem editar**, para `fixtures/source-export.json` (nome neutro; o arquivo é ignorado pelo Git).
3. Abasteça a carteira com SOL de teste: https://faucet.solana.com (selecione Devnet e cole o endereço que o `keygen` mostrou),
   ou tente `npm run balance -- --airdrop`. Confira com `npm run balance`. 1 SOL dá para milhares de provas.

> O RPC público da Devnet limita requisições. Se aparecer erro 429, crie um endpoint grátis
> (Helius, QuickNode etc.) e coloque em `SOLANA_RPC_URL`.

## 2. Gerar o snapshot (offline)

```bash
npm run snapshot
```

Gera `out/snapshot.sanitized.json` e `out/commitment.json` (hash, JSON canônico, payload do Memo).

**Dois formatos de export são aceitos:**

| Export | Como escolher o dispositivo |
|---|---|
| De um dispositivo (raiz = `RealTimeControl`, `Version`…) | `--device <MAC>` ou `POG_DEVICE_ID` no `.env` |
| Completo (`/thecloudpot/arduinos/<MAC>/…`) | `--device <MAC>`; o ID é a própria chave do nó |

```bash
npm run devices -- --input fixtures/full-export.private.json          # lista e valida todos
npm run publish-proof -- --input fixtures/full-export.private.json --device AA:BB:CC:DD:EE:02
npm run tamper-test -- --input fixtures/full-export.private.json --device AA:BB:CC:DD:EE:02
```

`--device` aceita o MAC em qualquer formato (`AA:BB:…`, `AA_BB_…`, `aabb…`) e tem prioridade sobre o `.env`.
Dispositivos incompletos (ex.: menos de 6 plantas, sem `Version`) são rejeitados com o motivo, nunca completados.
Para testar sem o export real: `npm run snapshot -- --input fixtures/example-export.json`.

Os caminhos do export estão fixados em `FIELD_PATHS` (`src/sanitize.ts`), conferidos no export real.

## 3. Publicar na Devnet

```bash
npm run publish-proof
```

- Assina e persiste a tentativa **antes** de enviar, espera a confirmação `finalized` e só então marca `anchored`.
- Imprime a assinatura e o link do Explorer (`?cluster=devnet`) e grava `out/receipt.json`.
- **Idempotente:** rodar de novo com o mesmo snapshot reaproveita a prova. Se der timeout, rodar de novo
  **reconcilia pela assinatura** e só reenvia depois que o blockhash expira.
- Para a demo, `POG_COMMITMENT=confirmed` no `.env` responde em ~1 s em vez de ~15 s.

## 4. Verificar e testar adulteração

```bash
npm run verify            # snapshot original x transação → VERIFIED
npm run tamper-test       # positivo (verified) + Weed1/Humidity 74→73 → HASH_MISMATCH
```

O verificador **não confia no recibo**: recalcula JCS + SHA-256, busca a transação via `getTransaction`,
confere `meta.err == null`, Memo Program correto, payload reconhecido e se a carteira esperada assinou, e
compara com o hash **lido do Memo on-chain**.

| Status | Significado |
|---|---|
| `verified` | Snapshot bate com o commitment ancorado e assinado pela carteira esperada |
| `hash_mismatch` | Snapshot diferente do que foi ancorado (adulterado ou outro snapshot) |
| `invalid_snapshot` | Arquivo apresentado não é um `pog.snapshot.v1` válido |
| `invalid_proof` | Transação falhou, carteira errada, Memo ausente/irreconhecível ou cluster errado |
| `pending_or_unavailable` | RPC fora do ar ou transação ainda não confirmada. **Não** significa adulteração |

Carteira esperada: `--signer <endereço>`, `POG_EXPECTED_SIGNER` ou a carteira local (nunca só o recibo).

## Página pública de verificação (proof.thecloudpot.com)

Página estática em `site/`. Ela lê cada transação **direto da Solana Devnet** e recalcula o hash **no navegador**
(JCS + SHA-256 via Web Crypto). Os jurados podem mudar uma leitura e ver a prova quebrar.
Publica só o snapshot sanitizado (leituras, firmware, horário, pseudônimo); **nunca o MAC**
(`npm run site-data` aborta se encontrar algo com formato de MAC).

```bash
npm run site-data      # gera site/proofs.json a partir das provas ancoradas em data/proofs
npm run site           # pré-visualização em http://localhost:5173
```

Deploy no Firebase Hosting (site separado, não mexe em nenhum site existente do projeto):

```bash
npm install -g firebase-tools
firebase login
firebase use --add                                   # escolha o projeto do TheCloudPot
firebase hosting:sites:create thecloudpot-proof      # uma vez; se o nome estiver ocupado, troque aqui e no firebase.json
firebase deploy --only hosting:thecloudpot-proof
```

Domínio `proof.thecloudpot.com` (DNS no Cloudflare):

1. Firebase Console → Hosting → site `thecloudpot-proof` → **Add custom domain** → `proof.thecloudpot.com`.
2. No Cloudflare (DNS → Records), crie exatamente os registros que o Firebase mostrar (TXT e A) com o nome `proof`.
3. Deixe esses registros como **DNS only (nuvem cinza)**. Com o proxy laranja, o Firebase não consegue emitir o certificado.
4. Não altere os registros `@`/`www` (site principal no Lovable).
5. Aguarde a verificação e o SSL (minutos a algumas horas).

Depois de cada nova prova: `npm run site-data` e `firebase deploy --only hosting:thecloudpot-proof`.

## Ancoragem automática (Cloud Functions, a cada 15 minutos)

Duas Functions num **codebase próprio** (`proof-of-grow`), separadas das Functions que já existem no projeto:

| Function | O que faz |
|---|---|
| `pogAnchor` | A cada 15 min lê `/thecloudpot/arduinos` (só leitura), ancora cada Grower válido na **Devnet** e grava o recibo em `Firestore/pogProofs`. Snapshot repetido = prova reaproveitada (sem transação nova). |
| `pogProofs` | HTTPS somente leitura, exposto pela página em `/api/proofs`. Devolve só dados sanitizados (sem MAC). |

A página junta as provas manuais (`proofs.json`) com as automáticas (`/api/proofs`) e atualiza sozinha a cada 30 s:
`Sending to Solana…` → `Confirmed…` → `Finalized ✓`. A verificação independente continua no navegador.

### Deploy (uma vez)

```cmd
REM 1. Segredos no Secret Manager (use o MESMO segredo HMAC do .env)
firebase functions:secrets:set POG_WALLET_SECRET_KEY --data-file secrets/devnet-wallet.json
firebase functions:secrets:set POG_PSEUDONYM_SECRET
REM    (cole o valor de POG_PSEUDONYM_SECRET do .env quando pedir)

REM 2. Dependências e build
npm install
cd functions && npm install && cd ..
npm run build:functions

REM 3. Deploy SÓ do codebase novo + a página
firebase deploy --only functions:proof-of-grow,hosting:thecloudpot-proof
```

- **Sempre** `--only functions:proof-of-grow`: nunca `firebase deploy` puro nem `--only functions`.
- O primeiro deploy pode pedir para ativar APIs (Cloud Scheduler, Cloud Build, Artifact Registry, Secret Manager): responda **Y**.
- Logs: `firebase functions:log --only pogAnchor`. Rodar na hora sem esperar 15 min: Google Cloud Console → Cloud Scheduler → job do `pogAnchor` → **Force run**.
- Pausar: Cloud Scheduler → **Pause**. Mudar a frequência: `schedule` em `functions/src/index.ts`, `npm run build:functions` e deploy de novo.

## Evidência para a apresentação

- `out/snapshot.sanitized.json` e o hash
- Assinatura real + link do Explorer com `cluster=devnet`
- Saída do `npm run tamper-test` (verified + hash_mismatch)
- Saída do `npm test`

---

## Contrato do snapshot `pog.snapshot.v1`

```text
schemaVersion: "pog.snapshot.v1"
source: "thecloudpot.rtdb"
devicePseudonym: HMAC-SHA256(segredo, "pog.device.v1|" + id normalizado)   (hex)
firmwareVersion: "1.0.2"
reportedTimestampRaw: "1790969067"   epoch em segundos, mantido como string
reportIntervalMin: 5
soilMoistureUnit: "unspecified"
plants: [{ id: "plant-01", soilMoisture: 74, temperatureC: 26.25 }, … plant-06]
```

- `Weed1..6` → `plant-01..06`, ordem fixa. Valores **sem arredondamento**; campo ausente/inválido é rejeitado (não vira zero).
- `Humidity` = umidade do **solo**; não adicionamos “%” (escala não declarada).
- Normalização do ID (`pog.device.v1`): `trim` + minúsculas + remove `:` `-` `_` `.` e espaços. Nada mais.
  `AA_BB_CC_DD_EE_01` e `aa:bb:cc:dd:ee:01` geram o mesmo pseudônimo.
- O recibo traz `reportedAtIso` só como leitura humana; o hash cobre a string bruta.

**Fora do commitment (não protegido pela prova):** `Commands`, `LightSchedules`, `WateringSchedules`,
estados ON/OFF, `lastAutoOn/Off`, `pumpTimeout_seconds`, identificador bruto e qualquer campo fora da whitelist.
Mudar esses campos **não** muda o hash, e isso é intencional.

## Segurança

- `.env`, `secrets/`, `fixtures/source-export.json`, `out/` e `data/` estão no `.gitignore`.
- O Memo nunca contém snapshot, MAC, pseudônimo, chaves ou URLs privadas. A carteira pública e o horário são visíveis.
- Carteira **exclusiva da Devnet**. Na Function, a chave privada e o segredo HMAC vêm do **Secret Manager**.
- Devnet é ambiente de teste: sem garantia de permanência e sem valor financeiro.

## Estrutura

```
src/
  strict-json.ts      parser que rejeita chaves duplicadas
  sanitize.ts         whitelist, schema v1, pseudônimo HMAC, validação
  canonicalize.ts     JCS (pacote `canonicalize`, versão fixada) + UTF-8
  hash.ts             SHA-256 (node:crypto)
  payload.ts          payload do Memo + proofId
  chain.ts            interface da blockchain (real ou simulada)
  solana.ts           Memo Program v2, envio, status, getTransaction
  create-proof.ts     pipeline, lock, reconciliação, recibo
  verify.ts           verificação local + on-chain (5 estados)
  store.ts            registro de provas (arquivo local; Firestore na Function)
  config.ts           .env, carteira, cluster
  adapters/file.ts    entrada 1: arquivo
  adapters/rtdb.ts    entrada 2: Realtime Database (esboço, etapa 2)
  cli/                keygen, balance, snapshot, publish, verify, tamper-test
tests/                testes offline com blockchain simulada
fixtures/             example-export.json (versionado) e source-export.json (privado)
```

## Próximos passos (depois da demo)

1. **Firebase Function (Blaze):** envolver `createProof` numa Function HTTP/agendada com `secrets: [...]`
   e trocar `FileProofStore` por uma coleção dedicada no Firestore (ex.: `pogProofs`), com transação para o lock.
2. **Adaptador RTDB** (`src/adapters/rtdb.ts`): trigger em `Status`, persistindo snapshots próprios.
3. Batching com Merkle root, Program/PDA ("Grow Passport") e novas evidências, conforme o guia.

Checklist de aceite: ver seção 7 do guia de implementação.
