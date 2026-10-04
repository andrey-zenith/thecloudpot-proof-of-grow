# secrets/

Pasta local e ignorada pelo Git. `npm run keygen` grava aqui `devnet-wallet.json`
(chave privada da carteira **exclusiva da Devnet**).

- Nunca commitar, enviar por chat ou copiar para o Arduino/app.
- Em produção (Firebase Function), a chave vem do Secret Manager, não deste arquivo.
