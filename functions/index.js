/* Função agendada do Firebase.
   De minuto em minuto, percorre os cadastros ligados e, quando chega a hora,
   dentro da janela de horário permitida, envia a notificação por push para
   todos os aparelhos daquele código, e registra o disparo no histórico. */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

function dentroDaJanela(agoraMs, tzOffsetMin, inicio, fim) {
  const local = new Date(agoraMs - tzOffsetMin * 60000);
  const hora = local.getUTCHours();
  if (inicio === fim) return true;
  if (inicio < fim) return hora >= inicio && hora < fim;
  return hora >= inicio || hora < fim;
}

exports.enviarLembretes = onSchedule(
  { schedule: "every 1 minutes", timeZone: "America/Sao_Paulo", region: "southamerica-east1" },
  async () => {
    const agora = Date.now();
    const snap = await db
      .collection("reminders")
      .where("enabled", "==", true)
      .where("nextFireAt", "<=", Timestamp.fromMillis(agora))
      .get();

    if (snap.empty) return;

    const tarefas = snap.docs.map(async (doc) => {
      const d = doc.data();
      const intervalo = Number(d.intervalMin) || 40;
      const proximo = agora + intervalo * 60000;
      const inicio = d.activeStart != null ? Number(d.activeStart) : 8;
      const fim = d.activeEnd != null ? Number(d.activeEnd) : 22;
      const tz = d.tzOffset != null ? Number(d.tzOffset) : 180;
      const tokens = Array.isArray(d.tokens) ? d.tokens.filter(Boolean) : [];

      if (dentroDaJanela(agora, tz, inicio, fim)) {
        if (tokens.length) {
          const resposta = await getMessaging().sendEachForMulticast({
            tokens: tokens,
            notification: {
              title: "Hora de beber água",
              body: "Levante, beba um copo e volte revigorada."
            },
            webpush: {
              notification: { icon: "icon-192.png", badge: "favicon-32x32.png", tag: "lembrete-agua", renotify: true },
              fcmOptions: { link: "./" }
            }
          });
          const invalidos = [];
          resposta.responses.forEach((r, i) => {
            if (!r.success) {
              const codigo = r.error && r.error.code;
              if (
                codigo === "messaging/registration-token-not-registered" ||
                codigo === "messaging/invalid-registration-token" ||
                codigo === "messaging/invalid-argument"
              ) invalidos.push(tokens[i]);
            }
          });
          if (invalidos.length) await doc.ref.update({ tokens: FieldValue.arrayRemove(...invalidos) });
        }
        await doc.ref.collection("eventos").add({ tipo: "lembrete", at: FieldValue.serverTimestamp() });
      }

      await doc.ref.update({ nextFireAt: Timestamp.fromMillis(proximo), lastFireAt: FieldValue.serverTimestamp() });
    });

    await Promise.all(tarefas);
  }
);
