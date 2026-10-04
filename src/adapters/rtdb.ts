/**
 * Adaptador 2 (depois que o fluxo por arquivo passar): captura do Realtime Database.
 *
 * Não implementado no MVP de propósito. Antes de implementar:
 * - Raiz confirmada pelo export completo: /thecloudpot/arduinos/{mac}/… (o {mac} do trigger é o deviceId).
 * - Disparar a partir de Status (nunca de Commands, agendamentos ou dos próprios registros da prova).
 * - Usar o valor do evento quando a atualização agrupa as leituras; se o firmware grava campos
 *   separadamente, definir estratégia de consistência antes de ancorar.
 * - Persistir o snapshot próprio ANTES que Status seja sobrescrito (forma a linha do tempo).
 * - Separar reportInterval_min do intervalo de ancoragem (não é preciso 1 transação por reporte).
 *
 * Esboço (Firebase Functions v2, plano Blaze):
 *
 *   import { onValueWritten } from "firebase-functions/v2/database";
 *   export const pogCapture = onValueWritten(
 *     { ref: "/thecloudpot/arduinos/{mac}/RealTimeControl/Status", secrets: ["POG_PSEUDONYM_SECRET"] },
 *     async (event) => {
 *       const device = await event.data.after.ref.parent!.parent!.get(); // /thecloudpot/arduinos/{mac}
 *       const snapshot = sanitize(device.val(), { deviceId: event.params.mac, pseudonymSecret });
 *       // gravar em coleção dedicada (ex.: pogSnapshots) e enfileirar a ancoragem
 *     },
 *   );
 */
export function readFromRealtimeDatabase(): never {
  throw new Error("Adaptador RTDB ainda não implementado (etapa 2 do guia).");
}
