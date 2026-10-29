(function () {
  "use strict";

  // Estado compartilhado
  var intervalMin = 40;
  var running = false;
  var endTime = null;            // instante do próximo lembrete (ms)
  var pausedRemainingMs = null;  // tempo congelado quando em pausa
  var intervalDefaultMs = intervalMin * 60000;
  var soundOn = true;
  var countToday = 0;
  var settingsOpen = false;
  var activeStart = 8;
  var activeEnd = 22;
  var GOLES = { 0.5: 100, 2: 400, 4: 800 };
  var localMlHoje = 0;
  var localMlDia = null;

  var audioCtx = null;
  var wakeLock = null;
  var dueKey = null;

  var PRESETS = [20, 30, 40, 60, 90];
  var STORAGE_KEY = "lembrete-agua-v2";
  var CODE_KEY = "lembrete-agua-codigo";

  var fb = { ready: false, db: null, messaging: null, uid: null, token: null, unsub: null, unsubEventos: null };
  var historicoOpen = false;
  var syncCode = null;
  var remote = false;
  var aplicandoRemoto = false;

  var el = {
    water: document.getElementById("water"),
    flash: document.getElementById("flash"),
    count: document.getElementById("count"),
    countLabel: document.getElementById("countLabel"),
    eyebrow: document.getElementById("eyebrow"),
    timer: document.getElementById("timer"),
    caption: document.getElementById("caption"),
    primary: document.getElementById("primary"),
    reset: document.getElementById("reset"),
    toggleSettings: document.getElementById("toggleSettings"),
    chev: document.getElementById("chev"),
    panel: document.getElementById("panel"),
    presets: document.getElementById("presets"),
    custom: document.getElementById("custom"),
    activeStart: document.getElementById("activeStart"),
    activeEnd: document.getElementById("activeEnd"),
    soundSwitch: document.getElementById("soundSwitch"),
    testSound: document.getElementById("testSound"),
    permwarn: document.getElementById("permwarn"),
    btnPermitir: document.getElementById("btnPermitir"),
    pushstatus: document.getElementById("pushstatus"),
    syncCurrent: document.getElementById("syncCurrent"),
    syncInput: document.getElementById("syncInput"),
    applySync: document.getElementById("applySync"),
    syncstatus: document.getElementById("syncstatus"),
    toggleHistory: document.getElementById("toggleHistory"),
    chevHist: document.getElementById("chevHist"),
    histPanel: document.getElementById("histPanel"),
    histLembretes: document.getElementById("histLembretes"),
    histGoles: document.getElementById("histGoles"),
    histList: document.getElementById("histList"),
    histMl: document.getElementById("histMl"),
    drinkHalf: document.getElementById("drinkHalf"),
    drink2: document.getElementById("drink2"),
    drink4: document.getElementById("drink4"),
    mlHoje: document.getElementById("mlHoje"),
    toast: document.getElementById("toast"),
    toastDrinkHalf: document.getElementById("toastDrinkHalf"),
    toastDrink2: document.getElementById("toastDrink2"),
    toastDrink4: document.getElementById("toastDrink4"),
    snooze: document.getElementById("snooze")
  };

  // Preferências locais (só o que é do aparelho: som e contagem do dia)
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        soundOn: soundOn, countToday: countToday, countDate: todayKey(),
        localMlHoje: localMlHoje, localMlDia: localMlDia
      }));
    } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (typeof data.soundOn === "boolean") soundOn = data.soundOn;
      if (data.countDate === todayKey() && typeof data.countToday === "number") countToday = data.countToday;
      if (data.localMlDia === todayKey() && typeof data.localMlHoje === "number") {
        localMlHoje = data.localMlHoje; localMlDia = data.localMlDia;
      }
    } catch (e) {}
  }

  function clampMin(m) { m = Math.round(Number(m) || 40); return Math.min(240, Math.max(1, m)); }
  function clampHour(h) { h = Math.round(Number(h)); if (isNaN(h)) return 0; return Math.min(23, Math.max(0, h)); }
  function tzOffsetMin() { return new Date().getTimezoneOffset(); }

  function carregarCodigo() {
    try { syncCode = localStorage.getItem(CODE_KEY) || null; } catch (e) { syncCode = null; }
  }
  function mostrarCodigo() {
    if (el.syncCurrent) el.syncCurrent.textContent = syncCode || "nenhum código definido";
  }

  // Som de ding (sino) sem arquivo externo
  function ensureAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  // Libera o som no primeiro toque em qualquer lugar da tela, para o ding
  // funcionar mesmo num aparelho que só mostra a contagem por sincronização.
  function liberarAudioNoGesto() {
    var soltar = function () {
      var ctx = ensureAudio();
      try {
        if (ctx) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          g.gain.value = 0.0001;
          o.connect(g).connect(ctx.destination);
          o.start();
          o.stop(ctx.currentTime + 0.02);
        }
      } catch (e) {}
    };
    window.addEventListener("pointerdown", soltar);
    window.addEventListener("touchstart", soltar);
    window.addEventListener("keydown", soltar);
  }
  function playDing() {
    var ctx = ensureAudio();
    if (!ctx) return;
    var now = ctx.currentTime;
    function bell(freq, start, gainPeak) {
      var partials = [
        { mult: 1, gain: 1.0 }, { mult: 2.01, gain: 0.5 },
        { mult: 3.0, gain: 0.25 }, { mult: 4.2, gain: 0.12 }
      ];
      var master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, start);
      master.gain.exponentialRampToValueAtTime(gainPeak, start + 0.01);
      master.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);
      master.connect(ctx.destination);
      partials.forEach(function (p) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq * p.mult;
        g.gain.value = p.gain;
        osc.connect(g).connect(master);
        osc.start(start);
        osc.stop(start + 1.7);
      });
    }
    bell(880, now, 0.5);
    bell(1174.66, now + 0.14, 0.4);
  }

  function notificacaoLocal() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      new Notification("Hora de beber água", {
        body: "Levante, beba um copo e volte revigorada.",
        icon: "icon-192.png", badge: "favicon-32x32.png", tag: "lembrete-agua", renotify: true
      });
    } catch (e) {}
  }

  function updatePermWarn() {
    if (el.btnPermitir) el.btnPermitir.hidden = true;
    el.permwarn.hidden = false;
    el.permwarn.textContent = "O aviso toca e aparece na tela enquanto o aplicativo está aberto.";
  }
  function setPushStatus(msg) {
    if (!msg) { el.pushstatus.hidden = true; return; }
    el.pushstatus.hidden = false;
    el.pushstatus.textContent = msg;
  }
  function setSyncStatus(msg) {
    if (!msg) { el.syncstatus.hidden = true; return; }
    el.syncstatus.hidden = false;
    el.syncstatus.textContent = msg;
  }

  function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        navigator.wakeLock.request("screen").then(function (w) { wakeLock = w; }).catch(function () {});
      }
    } catch (e) {}
  }
  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && running) requestWakeLock();
  });

  // Firebase
  function configPreenchida() {
    var c = self.FIREBASE_CONFIG;
    return c && c.apiKey && c.apiKey.indexOf("COLE_AQUI") === -1 &&
      c.projectId && c.projectId.indexOf("SEU-PROJETO") === -1;
  }

  function docRef() {
    if (!fb.db || !syncCode) return null;
    return fb.db.collection("reminders").doc(syncCode);
  }

  function gravar(campos) {
    var ref = docRef();
    if (!ref) return;
    campos.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    try { ref.set(campos, { merge: true }); } catch (e) {}
  }

  function assinar() {
    if (fb.unsub) { try { fb.unsub(); } catch (e) {} fb.unsub = null; }
    var ref = docRef();
    if (!ref) return;
    fb.unsub = ref.onSnapshot(function (snap) {
      aplicarRemoto(snap.exists ? snap.data() : null);
    }, function () {});
    assinarEventos();
  }

  function assinarEventos() {
    if (fb.unsubEventos) { try { fb.unsubEventos(); } catch (e) {} fb.unsubEventos = null; }
    var ref = docRef();
    if (!ref) return;
    fb.unsubEventos = ref.collection("eventos").orderBy("at", "desc").limit(60)
      .onSnapshot(function (qs) {
        var docs = [];
        qs.forEach(function (d) { docs.push(d.data()); });
        aplicarEventos(docs);
      }, function () {});
  }

  function rotuloDia(dt) {
    return dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate();
  }

  function aplicarEventos(docs) {
    var hoje = todayKey();
    var hojeL = 0, hojeGoles = 0, hojeMl = 0;
    var linhas = "";
    docs.forEach(function (e) {
      var ms = (e.at && e.at.toMillis) ? e.at.toMillis() : null;
      if (!ms) return;
      var dt = new Date(ms);
      if (rotuloDia(dt) === hoje) {
        if (e.tipo === "lembrete") hojeL += 1;
        else if (e.tipo === "bebi") {
          hojeGoles += (e.goles != null ? Number(e.goles) : 0);
          hojeMl += (e.ml != null ? Number(e.ml) : 0);
        }
      }
      var hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      var dia = dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      var texto;
      if (e.tipo === "bebi") {
        var rotuloGole;
        if (e.goles == null) rotuloGole = "Água";
        else if (Number(e.goles) === 0.5) rotuloGole = "Meio gole";
        else if (Number(e.goles) === 1) rotuloGole = "1 gole";
        else rotuloGole = e.goles + " goles";
        texto = rotuloGole + (e.ml != null ? " (" + e.ml + " ml)" : "");
      } else {
        texto = "Lembrete";
      }
      var classe = e.tipo === "bebi" ? "tipo bebi" : "tipo";
      linhas += '<div class="histitem"><span class="' + classe + '">' + texto +
        '</span><span class="quando">' + dia + " " + hora + "</span></div>";
    });

    countToday = hojeL;
    if (el.histLembretes) el.histLembretes.textContent = hojeL;
    if (el.histGoles) el.histGoles.textContent = hojeGoles;
    if (el.histMl) el.histMl.textContent = hojeMl;
    if (el.mlHoje) el.mlHoje.textContent = hojeMl;
    if (el.histList) el.histList.innerHTML = linhas || '<div class="histempty">Ainda sem registros. Os lembretes e os goles aparecem aqui.</div>';
    render();
  }

  function registrarCopo(goles) {
    var ml = GOLES[goles] || 0;
    var ref = docRef();
    if (remote && ref) {
      try { ref.collection("eventos").add({ tipo: "bebi", goles: goles, ml: ml, at: firebase.firestore.FieldValue.serverTimestamp() }); } catch (e) {}
    } else {
      if (localMlDia !== todayKey()) { localMlDia = todayKey(); localMlHoje = 0; }
      localMlHoje += ml;
      save();
      if (el.mlHoje) el.mlHoje.textContent = localMlHoje;
      if (el.histMl) el.histMl.textContent = localMlHoje;
    }
  }

  function aplicarRemoto(data) {
    if (!data) { render(); return; }
    aplicandoRemoto = true;
    if (data.intervalMin != null) { intervalMin = clampMin(data.intervalMin); intervalDefaultMs = intervalMin * 60000; }
    if (data.activeStart != null) activeStart = clampHour(data.activeStart);
    if (data.activeEnd != null) activeEnd = clampHour(data.activeEnd);
    running = !!data.enabled;
    endTime = (data.nextFireAt && data.nextFireAt.toMillis) ? data.nextFireAt.toMillis() : endTime;
    if (data.pausedRemainingMs != null) pausedRemainingMs = data.pausedRemainingMs;
    el.custom.value = String(intervalMin);
    el.activeStart.value = String(activeStart);
    el.activeEnd.value = String(activeEnd);
    if (running) requestWakeLock(); else releaseWakeLock();
    aplicandoRemoto = false;
    render();
  }

  function initFirebase() {
    if (typeof firebase === "undefined" || !configPreenchida()) {
      setSyncStatus("Sincronização indisponível: configure o Firebase e publique o site.");
      return;
    }
    try {
      firebase.initializeApp(self.FIREBASE_CONFIG);
      fb.db = firebase.firestore();
      firebase.auth().signInAnonymously().catch(function () {});
      firebase.auth().onAuthStateChanged(function (user) {
        if (!user) return;
        fb.uid = user.uid;
        fb.ready = true;
        remote = true;
        if (syncCode) {
          assinar();
          setSyncStatus("Sincronizado por código. Use o mesmo código nos outros aparelhos.");
        } else {
          setSyncStatus("Defina um código de sincronização abaixo. Use o mesmo em cada aparelho.");
        }
      });
    } catch (e) {
      setSyncStatus("Não foi possível iniciar a sincronização agora.");
    }
  }

  function habilitarPush() {
    return Promise.resolve(false);
  }

  // Laço do aplicativo. No cruzamento do zero, avisa, registra e reinicia o intervalo.
  function tick() {
    if (running && endTime && Date.now() >= endTime) {
      if (dueKey !== endTime) {
        dueKey = endTime;
        if (soundOn) playDing();
        showToast();
        flash();
        notificacaoLocal();
        endTime = Date.now() + intervalMin * 60000;
        var ref = docRef();
        if (remote && ref) {
          try { ref.collection("eventos").add({ tipo: "lembrete", at: firebase.firestore.FieldValue.serverTimestamp() }); } catch (e) {}
          gravar({ nextFireAt: firebase.firestore.Timestamp.fromMillis(endTime) });
        } else {
          countToday += 1;
          save();
        }
      }
    }
    render();
  }

  // Ações (em modo remoto, gravam no Firestore e voltam pelo onSnapshot)
  function start() {
    ensureAudio();
    requestWakeLock();
    var novo = Date.now() + (pausedRemainingMs != null ? pausedRemainingMs : intervalMin * 60000);
    running = true;
    endTime = novo;
    pausedRemainingMs = null;
    dueKey = null;
    render();
    if (remote) {
      gravar({
        enabled: true,
        nextFireAt: firebase.firestore.Timestamp.fromMillis(novo),
        intervalMin: intervalMin, activeStart: activeStart, activeEnd: activeEnd,
        tzOffset: tzOffsetMin()
      });
    }
  }
  function pause() {
    if (endTime) pausedRemainingMs = Math.max(0, endTime - Date.now());
    running = false;
    releaseWakeLock();
    render();
    if (remote) gravar({ enabled: false, pausedRemainingMs: pausedRemainingMs });
  }
  function reset() {
    dueKey = null;
    hideToast();
    if (running) {
      endTime = Date.now() + intervalMin * 60000;
      if (remote) gravar({ nextFireAt: firebase.firestore.Timestamp.fromMillis(endTime) });
    } else {
      pausedRemainingMs = intervalMin * 60000;
      if (remote) gravar({ pausedRemainingMs: pausedRemainingMs });
    }
    render();
  }
  function applyInterval(min) {
    intervalMin = clampMin(min);
    intervalDefaultMs = intervalMin * 60000;
    el.custom.value = String(intervalMin);
    dueKey = null;
    hideToast();
    if (running) {
      endTime = Date.now() + intervalMin * 60000;
      if (remote) gravar({ intervalMin: intervalMin, nextFireAt: firebase.firestore.Timestamp.fromMillis(endTime) });
    } else {
      pausedRemainingMs = intervalMin * 60000;
      if (remote) gravar({ intervalMin: intervalMin, pausedRemainingMs: pausedRemainingMs });
    }
    render();
  }
  function applyActiveHours() {
    activeStart = clampHour(el.activeStart.value);
    activeEnd = clampHour(el.activeEnd.value);
    el.activeStart.value = String(activeStart);
    el.activeEnd.value = String(activeEnd);
    if (remote) gravar({ activeStart: activeStart, activeEnd: activeEnd, tzOffset: tzOffsetMin() });
  }

  function showToast() { el.toast.hidden = false; }
  function hideToast() { el.toast.hidden = true; }
  function flash() {
    el.flash.hidden = false;
    el.flash.style.animation = "none";
    void el.flash.offsetWidth;
    el.flash.style.animation = "";
    setTimeout(function () { el.flash.hidden = true; }, 1300);
  }
  function snooze() {
    hideToast();
    var ms = 5 * 60000;
    endTime = Date.now() + ms;
    running = true;
    dueKey = null;
    render();
    if (remote) gravar({ enabled: true, nextFireAt: firebase.firestore.Timestamp.fromMillis(endTime) });
  }

  // Trocar de código para juntar aparelhos
  function usarCodigo(codigo) {
    codigo = (codigo || "").trim();
    if (codigo.length < 12) { setSyncStatus("O código precisa ter pelo menos doze caracteres."); return; }
    syncCode = codigo;
    try { localStorage.setItem(CODE_KEY, syncCode); } catch (e) {}
    mostrarCodigo();
    el.syncInput.value = "";
    setSyncStatus("Ligado a este código. Os aparelhos com o mesmo código ficam espelhados.");
    if (remote) {
      assinar();
      gravar({ tzOffset: tzOffsetMin() });
    }
  }

  // Render
  function pad(n) { return String(n).padStart(2, "0"); }
  function render() {
    var totalMs = intervalMin * 60000;
    var remaining;
    if (running && endTime) remaining = Math.max(0, endTime - Date.now());
    else if (pausedRemainingMs != null) remaining = pausedRemainingMs;
    else remaining = totalMs;

    var totalSec = Math.ceil(remaining / 1000);
    el.timer.textContent = pad(Math.floor(totalSec / 60)) + ":" + pad(totalSec % 60);

    var fill = (running || (pausedRemainingMs != null && pausedRemainingMs < totalMs)) ? (1 - remaining / totalMs) : 0;
    el.water.style.height = Math.min(100, Math.max(0, fill * 100)) + "%";

    el.count.textContent = countToday;
    el.countLabel.textContent = countToday === 1 ? "lembrete" : "lembretes";

    if (running) {
      el.eyebrow.textContent = "próximo copo em";
      var at = new Date(endTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      el.caption.innerHTML = "lembrete às <b>" + at + "</b>";
      el.primary.textContent = "Pausar";
    } else {
      el.eyebrow.textContent = (pausedRemainingMs != null && pausedRemainingMs < totalMs) ? "em pausa" : "pronta para começar";
      el.caption.innerHTML = "intervalo de <b>" + intervalMin + " minutos</b>";
      el.primary.textContent = (pausedRemainingMs != null && pausedRemainingMs < totalMs) ? "Retomar" : "Começar";
    }

    Array.prototype.forEach.call(el.presets.children, function (chip) {
      chip.classList.toggle("active", Number(chip.getAttribute("data-min")) === intervalMin);
    });
    el.soundSwitch.classList.toggle("on", soundOn);
    el.soundSwitch.setAttribute("aria-checked", soundOn ? "true" : "false");
  }

  // Montagem
  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.className = "chip";
    b.textContent = p + " min";
    b.setAttribute("data-min", p);
    b.addEventListener("click", function () { applyInterval(p); });
    el.presets.appendChild(b);
  });

  el.primary.addEventListener("click", function () { if (running) pause(); else start(); });
  el.reset.addEventListener("click", reset);
  el.custom.addEventListener("keydown", function (e) { if (e.key === "Enter") applyInterval(el.custom.value || intervalMin); });
  el.custom.addEventListener("change", function () { applyInterval(el.custom.value || intervalMin); });
  el.activeStart.addEventListener("change", applyActiveHours);
  el.activeEnd.addEventListener("change", applyActiveHours);
  el.drinkHalf.addEventListener("click", function () { registrarCopo(0.5); });
  el.drink2.addEventListener("click", function () { registrarCopo(2); });
  el.drink4.addEventListener("click", function () { registrarCopo(4); });
  el.soundSwitch.addEventListener("click", function () { soundOn = !soundOn; save(); render(); });
  el.testSound.addEventListener("click", function () { ensureAudio(); playDing(); });
  el.applySync.addEventListener("click", function () { usarCodigo(el.syncInput.value); });
  el.syncInput.addEventListener("keydown", function (e) { if (e.key === "Enter") usarCodigo(el.syncInput.value); });
  el.syncCurrent.addEventListener("click", function () {
    try { navigator.clipboard.writeText(syncCode); setSyncStatus("Código copiado. Cole no outro aparelho."); } catch (e) {}
  });
  el.toggleSettings.addEventListener("click", function () {
    settingsOpen = !settingsOpen;
    el.toggleSettings.setAttribute("aria-expanded", settingsOpen ? "true" : "false");
    el.chev.classList.toggle("open", settingsOpen);
    el.panel.style.maxHeight = settingsOpen ? "680px" : "0";
    el.panel.style.opacity = settingsOpen ? "1" : "0";
  });
  el.toggleHistory.addEventListener("click", function () {
    historicoOpen = !historicoOpen;
    el.toggleHistory.setAttribute("aria-expanded", historicoOpen ? "true" : "false");
    el.chevHist.classList.toggle("open", historicoOpen);
    el.histPanel.style.maxHeight = historicoOpen ? "360px" : "0";
    el.histPanel.style.opacity = historicoOpen ? "1" : "0";
  });
  el.toastDrinkHalf.addEventListener("click", function () { registrarCopo(0.5); hideToast(); });
  el.toastDrink2.addEventListener("click", function () { registrarCopo(2); hideToast(); });
  el.toastDrink4.addEventListener("click", function () { registrarCopo(4); hideToast(); });
  el.snooze.addEventListener("click", snooze);

  // Início
  load();
  carregarCodigo();
  mostrarCodigo();
  el.custom.value = String(intervalMin);
  el.activeStart.value = String(activeStart);
  el.activeEnd.value = String(activeEnd);
  if (el.mlHoje && localMlDia === todayKey()) el.mlHoje.textContent = localMlHoje;
  updatePermWarn();
  liberarAudioNoGesto();
  initFirebase();
  render();
  setInterval(tick, 250);
})();
