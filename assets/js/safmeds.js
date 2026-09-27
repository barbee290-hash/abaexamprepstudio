/* ABA Exam Prep Studio — SAFMEDS timing (Say All Fast, Minute Every Day, Shuffled) */
(function () {
  "use strict";

  var app = document.getElementById("safmeds-app");
  if (!app || !window.AEP_TERMS) return;

  var TERMS = window.AEP_TERMS;
  var SECTIONS = window.AEP_SECTIONS;
  var ICONS = "assets/img/icons.svg#";
  var TIMING_MS = 60 * 1000;
  var STORE = "aep-safmeds-v1";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var deckKey = "ALL";
  var run = null;        // active timing state
  var tickId = null;

  var params = new URLSearchParams(location.search);
  if (params.get("deck") && (params.get("deck").toUpperCase() === "ALL" || SECTIONS[params.get("deck").toUpperCase()])) {
    deckKey = params.get("deck").toUpperCase();
  }

  /* ---------- helpers ---------- */
  function icon(id) { return '<svg aria-hidden="true"><use href="' + ICONS + id + '"></use></svg>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function deckCards(key) { return key === "ALL" ? TERMS : TERMS.filter(function (c) { return c.s === key; }); }
  function deckName(key) { return key === "ALL" ? "All sections" : "Section " + key + ": " + SECTIONS[key]; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function readHistory() { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { return {}; } }
  function saveResult(key, correct, errors) {
    try {
      var h = readHistory(), list = h[key] || [], d = today();
      var existing = list.filter(function (r) { return r.d === d; })[0];
      if (existing) {
        existing.n = (existing.n || 1) + 1;
        if (correct > existing.c || (correct === existing.c && errors < existing.e)) { existing.c = correct; existing.e = errors; }
      } else {
        list.push({ d: d, c: correct, e: errors, n: 1 });
      }
      h[key] = list.slice(-60);
      localStorage.setItem(STORE, JSON.stringify(h));
    } catch (e) { /* storage unavailable */ }
  }
  function focusApp() {
    app.setAttribute("tabindex", "-1");
    app.focus({ preventScroll: true });
    var top = app.getBoundingClientRect().top + window.scrollY - 100;
    if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
  }
  function announce(msg) {
    var live = document.getElementById("safmeds-live");
    if (live) { live.textContent = ""; setTimeout(function () { live.textContent = msg; }, 50); }
  }

  /* ---------- progress chart ---------- */
  function chart(key) {
    var list = (readHistory()[key] || []).slice(-14);
    if (!list.length) {
      return '<div class="sm-chart-empty">' + icon("i-target") + "<p>Your daily best for this deck will be charted here after your first timing.</p></div>";
    }
    var W = 560, H = 220, L = 38, R = 12, T = 14, B = 34;
    var top = Math.max(20, Math.max.apply(null, list.map(function (r) { return Math.max(r.c, r.e); })));
    var gstep = top <= 20 ? 5 : top <= 60 ? 10 : 20;
    var max = Math.ceil(top / gstep) * gstep;
    var n = list.length, step = n > 1 ? (W - L - R) / (n - 1) : 0;
    function x(i) { return n > 1 ? L + i * step : (L + W - R) / 2; }
    function y(v) { return T + (H - T - B) * (1 - v / max); }
    var grid = "";
    for (var g = 0; g <= max; g += gstep) {
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#E8E4DA"/>' +
        '<text x="' + (L - 8) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="11" fill="#56636A">' + g + "</text>";
    }
    var cPath = list.map(function (r, i) { return (i ? "L" : "M") + x(i) + " " + y(r.c); }).join(" ");
    var ePath = list.map(function (r, i) { return (i ? "L" : "M") + x(i) + " " + y(r.e); }).join(" ");
    var dots = list.map(function (r, i) {
      var label = r.d.slice(5).replace("-", "/");
      return '<circle cx="' + x(i) + '" cy="' + y(r.c) + '" r="5" fill="#176B6B"><title>' + r.d + ": " + r.c + " correct</title></circle>" +
        '<path d="M' + (x(i) - 4) + " " + (y(r.e) - 4) + "l8 8M" + (x(i) + 4) + " " + (y(r.e) - 4) + 'l-8 8" stroke="#D9603F" stroke-width="2.4" stroke-linecap="round"><title>' + r.d + ": " + r.e + " errors</title></path>" +
        (n <= 8 || i % 2 === 0 || i === n - 1 ? '<text x="' + x(i) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="11" fill="#56636A">' + label + "</text>" : "");
    }).join("");
    var last = list[list.length - 1];
    return '<figure class="sm-chart"><svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Daily best for ' + esc(deckName(key)) + ": most recent " + last.c + " correct and " + last.e + ' errors per minute">' +
      grid + '<path d="' + cPath + '" fill="none" stroke="#176B6B" stroke-width="2.5"/>' +
      '<path d="' + ePath + '" fill="none" stroke="#E9785D" stroke-width="2" stroke-dasharray="5 5"/>' + dots + "</svg>" +
      '<figcaption><span><i class="lg-c"></i> Correct per minute</span><span><i class="lg-e"></i> Errors per minute</span><span class="muted">Best timing each day, last ' + n + " day" + (n > 1 ? "s" : "") + "</span></figcaption></figure>";
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    stopTick();
    run = null;
    var keys = ["ALL"].concat(Object.keys(SECTIONS));
    var hist = readHistory()[deckKey] || [];
    var best = hist.length ? hist.reduce(function (a, r) { return r.c > a.c ? r : a; }) : null;

    app.innerHTML =
      '<div class="sm-setup">' +
        '<div class="sm-setup-main">' +
          '<h2 class="sm-h">Choose a deck</h2>' +
          '<div class="sm-decks" role="radiogroup" aria-label="Deck">' +
            keys.map(function (k) {
              var n = deckCards(k).length;
              return '<button type="button" role="radio" class="sm-deck" data-deck="' + k + '" aria-checked="' + (k === deckKey) + '">' +
                '<span class="sm-deck-letter">' + (k === "ALL" ? icon("d-mock") : k) + "</span>" +
                "<span><strong>" + (k === "ALL" ? "All sections" : esc(SECTIONS[k])) + "</strong><small>" + n + " cards</small></span></button>";
            }).join("") +
          "</div>" +
          '<div class="btn-row mt-2">' +
            '<button type="button" class="btn btn-primary" data-act="start">' + icon("i-clock") + " Start 1-minute timing</button>" +
            '<a class="btn btn-outline" href="safmeds-print.html?deck=' + deckKey + '">' + icon("i-book") + " Print these cards</a>" +
          "</div>" +
          '<p class="form-note">Keyboard: <span class="kbd">Space</span> flip · <span class="kbd">→</span> correct · <span class="kbd">←</span> error</p>' +
        "</div>" +
        '<div class="sm-setup-side">' +
          '<h2 class="sm-h">Your progress: ' + esc(deckName(deckKey)) + "</h2>" +
          (best ? '<p class="muted">Personal best: <strong style="color:var(--teal)">' + best.c + " correct</strong> with " + best.e + " error" + (best.e === 1 ? "" : "s") + " (" + best.d + ")</p>" : "") +
          chart(deckKey) +
        "</div>" +
      "</div>";

    app.querySelectorAll(".sm-deck").forEach(function (b) {
      b.addEventListener("click", function () {
        deckKey = b.getAttribute("data-deck");
        history.replaceState(null, "", "?deck=" + deckKey);
        renderSetup();
        var again = app.querySelector('.sm-deck[data-deck="' + deckKey + '"]');
        if (again) again.focus();
      });
    });
    app.querySelector('[data-act="start"]').addEventListener("click", start);
  }

  /* ---------- timing ---------- */
  function start() {
    run = {
      queue: shuffle(deckCards(deckKey)),
      i: 0,
      flipped: false,
      correct: 0,
      errors: 0,
      missed: [],
      started: performance.now()
    };
    app.innerHTML =
      '<div class="sm-run">' +
        '<div class="sm-stats">' +
          '<div class="sm-timer" role="timer" aria-label="Time remaining">' + icon("i-clock") + '<span id="sm-time">1:00</span></div>' +
          '<div class="sm-count good">' + icon("i-check") + '<span id="sm-correct">0</span><small>correct</small></div>' +
          '<div class="sm-count bad">' + icon("i-x") + '<span id="sm-errors">0</span><small>errors</small></div>' +
        "</div>" +
        '<div class="sm-progress"><i id="sm-bar"></i></div>' +
        '<div class="sm-card-wrap"><button type="button" class="sm-card" id="sm-card" aria-live="polite"></button></div>' +
        '<div class="sm-actions" id="sm-actions"></div>' +
        '<p class="center mt-2"><button type="button" class="sm-stop" data-act="stop">Stop timing</button></p>' +
      "</div>";
    app.querySelector("#sm-card").addEventListener("click", function () { if (!run.flipped) flip(); });
    app.querySelector('[data-act="stop"]').addEventListener("click", function () { finish(true); });
    showCard();
    focusApp();
    tickId = setInterval(tick, 100);
    tick();
  }

  function current() {
    if (run.i >= run.queue.length) { run.queue = shuffle(deckCards(deckKey)); run.i = 0; }
    return run.queue[run.i];
  }

  function showCard() {
    var c = current();
    run.flipped = false;
    var card = app.querySelector("#sm-card");
    card.className = "sm-card";
    card.innerHTML =
      '<span class="sm-face sm-front"><span class="sm-tag">' + c.s + " · " + esc(SECTIONS[c.s]) + '</span><span class="sm-term">' + esc(c.t) + '</span><span class="sm-hint">Say the definition, then flip</span></span>' +
      '<span class="sm-face sm-back"><span class="sm-tag">' + esc(c.t) + '</span><span class="sm-def">' + esc(c.d) + "</span></span>";
    card.setAttribute("aria-label", "Term: " + c.t + ". Press to flip.");
    app.querySelector("#sm-actions").innerHTML =
      '<button type="button" class="btn btn-teal sm-flip" data-act="flip">Flip card <span class="kbd">Space</span></button>';
    app.querySelector('[data-act="flip"]').addEventListener("click", flip);
  }

  function flip() {
    if (!run || run.flipped) return;
    run.flipped = true;
    var c = current();
    var card = app.querySelector("#sm-card");
    card.classList.add("is-flipped");
    card.setAttribute("aria-label", "Definition: " + c.d);
    app.querySelector("#sm-actions").innerHTML =
      '<button type="button" class="btn sm-err" data-act="err">' + icon("i-x") + ' Error <span class="kbd">←</span></button>' +
      '<button type="button" class="btn sm-ok" data-act="ok">' + icon("i-check") + ' Correct <span class="kbd">→</span></button>';
    app.querySelector('[data-act="err"]').addEventListener("click", function () { mark(false); });
    app.querySelector('[data-act="ok"]').addEventListener("click", function () { mark(true); });
    var ok = app.querySelector('[data-act="ok"]');
    if (ok) ok.focus({ preventScroll: true });
  }

  function mark(isCorrect) {
    if (!run || !run.flipped) return;
    var c = current();
    if (isCorrect) run.correct++;
    else { run.errors++; if (run.missed.indexOf(c) === -1) run.missed.push(c); }
    app.querySelector("#sm-correct").textContent = run.correct;
    app.querySelector("#sm-errors").textContent = run.errors;
    run.i++;
    showCard();
    var f = app.querySelector('[data-act="flip"]');
    if (f) f.focus({ preventScroll: true });
  }

  function tick() {
    if (!run) return;
    var left = Math.max(0, TIMING_MS - (performance.now() - run.started));
    var secs = Math.ceil(left / 1000);
    var t = app.querySelector("#sm-time");
    if (t) t.textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    var bar = app.querySelector("#sm-bar");
    if (bar) bar.style.width = (100 - (left / TIMING_MS) * 100) + "%";
    var timer = app.querySelector(".sm-timer");
    if (timer) timer.classList.toggle("warn", secs <= 10);
    if (left <= 0) finish(false);
  }
  function stopTick() { if (tickId) { clearInterval(tickId); tickId = null; } }

  /* ---------- results ---------- */
  function finish(stoppedEarly) {
    if (!run) return;
    stopTick();
    var r = run;
    run = null;
    var elapsed = Math.min(TIMING_MS, performance.now() - r.started);
    // Stopping early doesn't count toward the chart, since SAFMEDS timings are a fixed minute.
    if (!stoppedEarly) saveResult(deckKey, r.correct, r.errors);
    var hist = readHistory()[deckKey] || [];
    var prevDays = hist.filter(function (x) { return x.d !== today(); });
    var prevBest = prevDays.length ? Math.max.apply(null, prevDays.map(function (x) { return x.c; })) : null;
    var improved = !stoppedEarly && prevBest !== null && r.correct > prevBest;

    app.innerHTML =
      '<div class="sm-results">' +
        '<div class="sm-score">' +
          '<div class="sm-big good"><b>' + r.correct + "</b><span>correct" + (stoppedEarly ? "" : " per minute") + "</span></div>" +
          '<div class="sm-big bad"><b>' + r.errors + "</b><span>error" + (r.errors === 1 ? "" : "s") + (stoppedEarly ? "" : " per minute") + "</span></div>" +
        "</div>" +
        '<p class="lead center">' +
          (stoppedEarly ? "Timing stopped after " + Math.round(elapsed / 1000) + " seconds, so it wasn’t added to your chart." :
            improved ? "New personal best for this deck. Great work!" :
            "Timing saved. Come back tomorrow and try to beat it. Daily practice is what builds fluency.") +
        "</p>" +
        '<div class="btn-row" style="justify-content:center">' +
          '<button type="button" class="btn btn-primary" data-act="again">' + icon("i-refresh") + " Go again</button>" +
          '<button type="button" class="btn btn-outline" data-act="decks">Change deck</button>' +
          '<a class="btn btn-outline" href="safmeds-print.html?deck=' + deckKey + '">' + icon("i-book") + " Print this deck</a>" +
        "</div>" +
        (r.missed.length ? '<h2 class="sm-h mt-3">Cards to review (' + r.missed.length + ")</h2>" +
          '<ul class="sm-missed">' + r.missed.map(function (c) { return "<li><strong>" + esc(c.t) + "</strong><span>" + esc(c.d) + "</span></li>"; }).join("") + "</ul>" : "") +
        '<h2 class="sm-h mt-3">Your progress: ' + esc(deckName(deckKey)) + "</h2>" +
        chart(deckKey) +
      "</div>";
    app.querySelector('[data-act="again"]').addEventListener("click", start);
    app.querySelector('[data-act="decks"]').addEventListener("click", function () { renderSetup(); focusApp(); });
    focusApp();
    announce("Time is up. " + r.correct + " correct and " + r.errors + " errors.");
  }

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", function (e) {
    if (!run || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); if (!run.flipped) flip(); }
    else if (e.key === "ArrowRight" || e.key === "j" || e.key === "J") { e.preventDefault(); mark(true); }
    else if (e.key === "ArrowLeft" || e.key === "f" || e.key === "F") { e.preventDefault(); mark(false); }
    else if (e.key === "Escape") { finish(true); }
  });

  renderSetup();
})();
