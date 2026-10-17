/* Service worker do Firebase Cloud Messaging.
   Recebe o aviso do servidor e o registro do token para o push.
   A notificação em segundo plano é exibida automaticamente pelo conteúdo enviado,
   então não a exibimos de novo aqui, para não duplicar. */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("firebase-config.js");

firebase.initializeApp(self.FIREBASE_CONFIG);
firebase.messaging();

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});
