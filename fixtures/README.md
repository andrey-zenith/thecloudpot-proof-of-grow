# fixtures/

| Arquivo | O que é | Versionar? |
|---|---|---|
| `source-export.json` | **Cópia exata** do export real do Realtime Database, renomeada para nome neutro. É a fixture privada e imutável do MVP. | **Não** (está no `.gitignore`) |
| `example-export.json` | Conteúdo do export real de exemplo (sem identificador do dispositivo no conteúdo; o nome do arquivo foi neutralizado). Usado pelos testes automatizados. | Opcional (contém agendamentos reais) |

Como preparar a fixture real:

1. Copie o export original para `fixtures/source-export.json` **sem editar nada** (nem formatação).
2. Guarde o original (com o nome que contém o identificador do dispositivo) em local privado, fora do repositório.
3. Coloque o identificador do dispositivo apenas em `POG_DEVICE_ID` no `.env`.
4. Rode `npm run snapshot`. Se o sanitizador acusar caminho ausente ou ambíguo,
   ajuste `FIELD_PATHS` em `src/sanitize.ts`.

Estrutura confirmada no export real: `Version` na raiz; `RealTimeControl/Status/Weed1..6/{Humidity,Temperature}`;
`RealTimeControl/Status/timestamp` (epoch em segundos, string); `RealTimeControl/Configs/reportInterval_min`.
