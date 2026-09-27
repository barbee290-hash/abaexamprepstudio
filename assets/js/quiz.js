/* ABA Exam Prep Studio — quiz engine */
(function () {
  "use strict";

  var app = document.getElementById("quiz-app");
  if (!app || !window.AEP_QUESTIONS) return;

  var DOMAINS = window.AEP_DOMAINS;
  var BANK = window.AEP_QUESTIONS;
  var ICONS = "assets/img/icons.svg#";
  var LETTERS = ["A", "B", "C", "D"];
  // Free mock exam: 20 questions in roughly the same proportions as the real RBT exam
  var MOCK_MIX = { A: 3, B: 2, C: 5, D: 4, E: 3, F: 3 };
  // Real exam pace: 85 questions in 90 minutes, so 20 questions get 21 minutes
  var EXAM_SECONDS = 21 * 60;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var params = new URLSearchParams(location.search);
  var setKey = (params.get("set") || "mock").toUpperCase();
  if (setKey !== "MOCK" && !DOMAINS[setKey]) setKey = "MOCK";
  var isMock = setKey === "MOCK";
  var storageKey = isMock ? "mock" : setKey;

  var state = null;
  var timerId = null;

  /* ---------- helpers ---------- */
  function icon(id, cls) { return '<svg aria-hidden="true"' + (cls ? ' class="' + cls + '"' : "") + '><use href="' + ICONS + id + '"></use></svg>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fmtTime(s) { var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }
  function title() { return isMock ? "Free 20-Question RBT Mock Exam" : "Section " + setKey + ": " + DOMAINS[setKey].name; }
  function focusTop() {
    app.setAttribute("tabindex", "-1");
    app.focus({ preventScroll: true });
    var top = app.getBoundingClientRect().top + window.scrollY - 100;
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
  }
  function readBest() { try { return JSON.parse(localStorage.getItem("aep-best-scores") || "{}"); } catch (e) { return {}; } }
  function saveBest(pct) {
    try {
      var s = readBest();
      if (s[storageKey] == null || pct > s[storageKey]) { s[storageKey] = pct; localStorage.setItem("aep-best-scores", JSON.stringify(s)); return true; }
    } catch (e) { /* storage unavailable */ }
    return false;
  }

  function buildQuestions() {
    var picked = [];
    if (isMock) {
      Object.keys(MOCK_MIX).forEach(function (d) {
        shuffle(BANK[d]).slice(0, MOCK_MIX[d]).forEach(function (q) { picked.push({ d: d, src: q }); });
      });
      picked = shuffle(picked);
    } else {
      picked = shuffle(BANK[setKey]).map(function (q) { return { d: setKey, src: q }; });
    }
    return picked.map(function (p) {
      var opts = p.src.o.map(function (text, i) { return { text: text, correct: i === 0 }; });
      return { d: p.d, t: p.src.t, q: p.src.q, e: p.src.e, opts: shuffle(opts) };
    });
  }
  function correctIndex(q) { for (var i = 0; i < q.opts.length; i++) if (q.opts[i].correct) return i; return -1; }

  /* ---------- intro ---------- */
  function renderIntro() {
    stopTimer();
    var best = readBest()[storageKey];
    var desc = isMock
      ? "Twenty questions drawn from all six domains of the 2026 RBT® Test Content Outline, in roughly the same proportions as the real exam. You get a different mix every attempt."
      : "Twenty original questions covering the tasks in Section " + setKey + " (" + DOMAINS[setKey].name + "). This section makes up about " + DOMAINS[setKey].weight + "% of the real RBT® exam (" + DOMAINS[setKey].items + " of 75 scored questions).";

    app.innerHTML =
      '<div class="quiz-intro">' +
        "<div>" +
          '<span class="q-tag">' + icon(isMock ? "d-mock" : "d-" + setKey.toLowerCase()) + (isMock ? "All 6 sections" : "Section " + setKey) + "</span>" +
          "<h1>" + esc(title()) + "</h1>" +
          '<p class="lead">' + desc + "</p>" +
          '<div class="quiz-facts">' +
            '<span class="pill pill-light">' + icon("i-list") + " 20 questions</span>" +
            '<span class="pill pill-light">' + icon("i-clock") + " 21 min in Exam mode</span>" +
            '<span class="pill pill-light">' + icon("i-heart") + " Free, no sign-up</span>" +
            (best != null ? '<span class="pill pill-light">' + icon("i-star") + " Your best: " + best + "%</span>" : "") +
          "</div>" +
          '<form class="mode-form" novalidate>' +
            '<fieldset class="mode-picker" style="border:0;padding:0;margin:0 0 28px">' +
              '<legend class="h4" style="font-weight:800;color:var(--navy);margin-bottom:14px">Choose your mode</legend>' +
              '<div class="mode-option"><input type="radio" name="mode" id="mode-study" value="study" checked>' +
                '<label for="mode-study"><span class="radio"></span><span><strong>Study mode</strong><span class="desc">See whether you’re right, with an explanation, after every question. Best for learning.</span></span></label></div>' +
              '<div class="mode-option"><input type="radio" name="mode" id="mode-exam" value="exam">' +
                '<label for="mode-exam"><span class="radio"></span><span><strong>Exam mode</strong><span class="desc">21-minute timer, flag questions, move freely, then see your score and full review at the end. Best for test-day practice.</span></span></label></div>' +
            "</fieldset>" +
            '<div class="btn-row"><button type="submit" class="btn btn-primary">Start quiz ' + icon("i-arrow", "arrow") + '</button>' +
            '<a class="btn btn-outline" href="practice.html#sections">Choose another section</a></div>' +
          "</form>" +
        "</div>" +
        '<aside class="intro-side" aria-labelledby="tips-title">' +
          '<h2 id="tips-title">Before you start</h2>' +
          "<ul>" +
            "<li>Read every answer before choosing. The exam often includes two answers that look close.</li>" +
            "<li>Watch for words like <em>first</em>, <em>best</em>, and <em>most appropriate</em>.</li>" +
            "<li>Keyboard shortcuts: press <span class=\"kbd\">A</span>–<span class=\"kbd\">D</span> or <span class=\"kbd\">1</span>–<span class=\"kbd\">4</span> to answer and <span class=\"kbd\">Enter</span> to continue.</li>" +
            "<li>Your best score is saved only in this browser.</li>" +
          "</ul>" +
          (isMock ? "" : '<p class="mt-2 mb-0"><a class="text-link" href="exam-guide.html#domain-' + setKey.toLowerCase() + '">Review Section ' + setKey + " tasks " + icon("i-arrow") + "</a></p>") +
        "</aside>" +
      "</div>";

    app.querySelector(".mode-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var mode = app.querySelector("input[name='mode']:checked").value;
      start(mode);
    });
  }

  /* ---------- quiz ---------- */
  function start(mode) {
    state = {
      mode: mode,
      qs: buildQuestions(),
      answers: [],
      locked: [],
      flags: [],
      i: 0,
      remaining: EXAM_SECONDS,
      done: false
    };
    for (var k = 0; k < state.qs.length; k++) { state.answers.push(null); state.locked.push(false); state.flags.push(false); }
    if (mode === "exam") startTimer();
    renderQuestion();
    focusTop();
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      state.remaining--;
      var el = app.querySelector(".quiz-timer");
      if (el) {
        el.querySelector("span").textContent = fmtTime(Math.max(state.remaining, 0));
        el.classList.toggle("warn", state.remaining <= 120);
      }
      if (state.remaining === 120) announce("Two minutes remaining.");
      if (state.remaining <= 0) { stopTimer(); finish(true); }
    }, 1000);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function announce(msg) {
    var live = document.getElementById("quiz-live");
    if (live) { live.textContent = ""; setTimeout(function () { live.textContent = msg; }, 50); }
  }

  function renderQuestion() {
    var q = state.qs[state.i], n = state.qs.length, i = state.i;
    var exam = state.mode === "exam";
    var answeredCount = state.answers.filter(function (a) { return a !== null; }).length;
    var progress = exam ? (answeredCount / n) * 100 : ((i + (state.locked[i] ? 1 : 0)) / n) * 100;

    var html =
      '<div class="quiz-top">' +
        '<span class="quiz-progress-label">Question ' + (i + 1) + " of " + n + (exam ? " · " + answeredCount + " answered" : "") + "</span>" +
        (exam ? '<span class="quiz-timer' + (state.remaining <= 120 ? " warn" : "") + '" role="timer" aria-label="Time remaining">' + icon("i-clock") + "<span>" + fmtTime(state.remaining) + "</span></span>"
              : '<span class="pill pill-light">' + icon("i-book") + " Study mode</span>") +
      "</div>" +
      '<div class="progress" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(progress) + '"><i style="width:' + progress + '%"></i></div>' +
      '<div class="q-body' + (state.lastShown !== i ? " is-new" : "") + '">' +
        '<span class="q-tag">' + icon("d-" + q.d.toLowerCase()) + "Section " + q.d + " · " + esc(DOMAINS[q.d].short) + " · Task " + q.t + "</span>" +
        '<h2 class="q-text" id="q-text">' + esc(q.q) + "</h2>" +
        '<ul class="options" role="list" aria-labelledby="q-text">';

    q.opts.forEach(function (opt, k) {
      var cls = "option", pressed = state.answers[i] === k;
      if (!exam && state.locked[i]) {
        if (opt.correct) cls += " correct";
        else if (pressed) cls += " incorrect";
      }
      html += '<li><button type="button" class="' + cls + '" data-k="' + k + '" aria-pressed="' + pressed + '"' + (!exam && state.locked[i] ? " disabled" : "") + ">" +
        '<span class="letter" aria-hidden="true">' + LETTERS[k] + '</span><span><span class="sr-only">Option ' + LETTERS[k] + ": </span>" + esc(opt.text) + "</span></button></li>";
    });
    html += "</ul>";

    if (!exam && state.locked[i]) {
      var right = q.opts[state.answers[i]].correct;
      html += '<div class="explain ' + (right ? "good" : "bad") + '" role="status">' + icon(right ? "i-check-circle" : "i-x-circle") +
        "<div><strong>" + (right ? "Correct!" : "Not quite. The correct answer is " + LETTERS[correctIndex(q)] + ".") + "</strong><p>" + esc(q.e) + "</p></div></div>";
    }
    html += "</div>";

    // actions
    html += '<div class="quiz-actions"><div class="left">';
    if (i > 0) html += '<button type="button" class="btn btn-outline btn-sm" data-act="prev">' + icon("i-arrow-left") + " Previous</button>";
    if (exam) html += '<button type="button" class="btn btn-outline btn-sm flag-btn" data-act="flag" aria-pressed="' + state.flags[i] + '">' + icon("i-flag") + (state.flags[i] ? " Flagged" : " Flag for review") + "</button>";
    html += '</div><div class="right">';
    if (exam) {
      if (i < n - 1) html += '<button type="button" class="btn btn-teal" data-act="next">Next ' + icon("i-arrow", "arrow") + "</button>";
      html += '<button type="button" class="btn ' + (i === n - 1 ? "btn-primary" : "btn-outline") + '" data-act="submit">Submit exam</button>';
    } else if (state.locked[i]) {
      html += i < n - 1
        ? '<button type="button" class="btn btn-teal" data-act="next">Next question ' + icon("i-arrow", "arrow") + "</button>"
        : '<button type="button" class="btn btn-primary" data-act="finish">See my results ' + icon("i-arrow", "arrow") + "</button>";
    } else {
      html += '<button type="button" class="btn btn-teal" data-act="check" disabled>Check answer</button>';
    }
    html += "</div></div>";

    // exam navigator
    if (exam) {
      html += '<nav class="q-nav" aria-label="Question navigator"><h2>Jump to a question</h2><div class="q-nav-grid">';
      state.qs.forEach(function (_, k) {
        var c = [];
        if (state.answers[k] !== null) c.push("answered");
        if (state.flags[k]) c.push("flagged");
        if (k === i) c.push("current");
        html += '<button type="button" data-jump="' + k + '" class="' + c.join(" ") + '" aria-label="Question ' + (k + 1) + (state.answers[k] !== null ? ", answered" : ", not answered") + (state.flags[k] ? ", flagged" : "") + '"' + (k === i ? ' aria-current="step"' : "") + ">" + (k + 1) + "</button>";
      });
      html += '</div><div class="q-nav-legend"><span><i class="a"></i> Answered</span><span><i></i> Not answered</span><span><i class="f"></i> Flagged</span></div></nav>';
    }

    app.innerHTML = html;
    state.lastShown = i;
    bindQuestion();
  }

  function bindQuestion() {
    var exam = state.mode === "exam";
    app.querySelectorAll(".option").forEach(function (btn) {
      btn.addEventListener("click", function () { choose(parseInt(btn.getAttribute("data-k"), 10)); });
    });
    // In study mode, one click selects and a second click (or the Check button) confirms.
    var check = app.querySelector("[data-act='check']");
    if (check && state.answers[state.i] !== null) check.disabled = false;

    app.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act");
        if (act === "prev") go(state.i - 1);
        else if (act === "next") go(state.i + 1);
        else if (act === "check") lockStudy();
        else if (act === "finish") finish(false);
        else if (act === "flag") { state.flags[state.i] = !state.flags[state.i]; renderQuestion(); app.querySelector("[data-act='flag']").focus(); }
        else if (act === "submit") confirmSubmit();
      });
    });
    app.querySelectorAll("[data-jump]").forEach(function (b) {
      b.addEventListener("click", function () { go(parseInt(b.getAttribute("data-jump"), 10)); });
    });
    if (!exam && state.locked[state.i]) {
      var next = app.querySelector("[data-act='next'], [data-act='finish']");
      if (next) next.focus({ preventScroll: true });
    }
  }

  function choose(k) {
    if (state.done) return;
    var exam = state.mode === "exam";
    if (!exam && state.locked[state.i]) return;
    state.answers[state.i] = k;
    if (exam) {
      renderQuestion();
      var b = app.querySelector(".option[data-k='" + k + "']");
      if (b) b.focus({ preventScroll: true });
    } else {
      app.querySelectorAll(".option").forEach(function (b) { b.setAttribute("aria-pressed", String(parseInt(b.getAttribute("data-k"), 10) === k)); });
      var check = app.querySelector("[data-act='check']");
      if (check) check.disabled = false;
    }
  }

  function lockStudy() {
    if (state.answers[state.i] === null) return;
    state.locked[state.i] = true;
    renderQuestion();
    var explain = app.querySelector(".explain");
    if (explain) {
      var r = explain.getBoundingClientRect();
      if (r.bottom + 90 > window.innerHeight) window.scrollBy({ top: r.bottom + 90 - window.innerHeight, behavior: reduceMotion ? "auto" : "smooth" });
    }
    var q = state.qs[state.i];
    announce(q.opts[state.answers[state.i]].correct ? "Correct." : "Incorrect. The correct answer is " + LETTERS[correctIndex(q)] + ".");
  }

  function go(k) {
    if (k < 0 || k >= state.qs.length) return;
    // study mode: can't skip ahead past an unanswered question
    if (state.mode === "study" && k > state.i && !state.locked[state.i]) return;
    state.i = k;
    renderQuestion();
    focusTop();
  }

  function confirmSubmit() {
    var unanswered = state.answers.filter(function (a) { return a === null; }).length;
    var flagged = state.flags.filter(Boolean).length;
    if (!unanswered && !flagged) { finish(false); return; }
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<h2 id="m-title">Submit your exam?</h2><p>' +
      (unanswered ? "You have <strong>" + unanswered + " unanswered</strong> question" + (unanswered > 1 ? "s" : "") + ". Unanswered questions are scored as incorrect. " : "") +
      (flagged ? "You flagged <strong>" + flagged + "</strong> question" + (flagged > 1 ? "s" : "") + " for review." : "") +
      '</p><div class="btn-row"><button type="button" class="btn btn-primary" data-m="yes">Submit now</button><button type="button" class="btn btn-outline" data-m="no">Keep working</button></div></div>';
    document.body.appendChild(wrap);
    var yes = wrap.querySelector("[data-m='yes']"), no = wrap.querySelector("[data-m='no']");
    no.focus();
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey, true); if (lastFocus) lastFocus.focus(); }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "Tab") { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    yes.addEventListener("click", function () { close(); finish(false); });
    no.addEventListener("click", close);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
  }

  /* ---------- results ---------- */
  function finish(timedOut) {
    stopTimer();
    state.done = true;
    var n = state.qs.length, correct = 0, byGroup = {}, groupOrder = [];
    state.qs.forEach(function (q, k) {
      var ok = state.answers[k] !== null && q.opts[state.answers[k]].correct;
      if (ok) correct++;
      var g = isMock ? q.d : q.t;
      if (!byGroup[g]) { byGroup[g] = { right: 0, total: 0 }; groupOrder.push(g); }
      byGroup[g].total++;
      if (ok) byGroup[g].right++;
    });
    groupOrder.sort(function (a, b) {
      var pa = a.split("."), pb = b.split(".");
      return pa[0] === pb[0] ? (parseInt(pa[1] || 0, 10) - parseInt(pb[1] || 0, 10)) : (pa[0] < pb[0] ? -1 : 1);
    });
    var pct = Math.round((correct / n) * 100);
    var isNewBest = saveBest(pct);
    var level = pct >= 80 ? "good" : pct >= 65 ? "mid" : "low";
    var levelText = { good: "On track", mid: "Getting close", low: "Keep practicing" }[level];
    var levelMsg = {
      good: "Strong work. You answered most questions correctly. Keep it up by practicing your weakest area below.",
      mid: "You’re building a solid foundation. Review the explanations for the questions you missed, then try again.",
      low: "Every attempt teaches you something. Study the explanations below and focus on one section at a time."
    }[level];

    var circumference = 2 * Math.PI * 88;
    var html =
      '<div class="results-hero">' +
        '<div class="score-ring" role="img" aria-label="Score ' + pct + ' percent">' +
          '<svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="88" fill="none" stroke-width="14"/>' +
          '<circle class="bar" cx="100" cy="100" r="88" fill="none" stroke-width="14" stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + circumference.toFixed(1) + '"/></svg>' +
          '<div class="center"><div><b data-final="' + pct + '">0%</b><small>' + correct + " of " + n + " correct</small></div></div>" +
        "</div>" +
        "<div>" +
          '<span class="readiness ' + level + '">' + icon(level === "good" ? "i-check-circle" : "i-target") + levelText + "</span>" +
          "<h1 style=\"font-size:clamp(1.9rem,3.6vw,2.6rem)\">" + (timedOut ? "Time’s up! " : "") + "Your results</h1>" +
          '<p class="lead">' + levelMsg + (isNewBest ? " <strong>New personal best!</strong>" : "") + "</p>" +
          '<div class="btn-row">' +
            '<button type="button" class="btn btn-primary" data-r="retake">' + icon("i-refresh") + " Retake quiz</button>" +
            '<a class="btn btn-outline" href="practice.html#sections">Practice another section</a>' +
          "</div>" +
        "</div>" +
      "</div>";

    html += '<h2 style="font-size:1.5rem">' + (isMock ? "Score by exam section" : "Score by task item") + '</h2><div class="breakdown">';
    groupOrder.forEach(function (g) {
      var r = byGroup[g], p = Math.round((r.right / r.total) * 100);
      var label = isMock ? g + ". " + DOMAINS[g].name : "Task " + g;
      html += '<div class="breakdown-row"><span class="name">' + esc(label) + '</span><span class="val">' + r.right + "/" + r.total + '</span><div class="weight-bar"><i style="--w:' + p + '%"></i></div></div>';
    });
    html += "</div>";

    if (isMock) {
      var weakest = groupOrder.slice().sort(function (a, b) { return byGroup[a].right / byGroup[a].total - byGroup[b].right / byGroup[b].total; })[0];
      html += '<div class="callout mt-0" style="margin-bottom:40px">' + icon("i-bulb") + "<p><strong>Suggested next step:</strong> your lowest area was Section " + weakest + " (" + esc(DOMAINS[weakest].name) + '). <a href="quiz.html?set=' + weakest + '">Take the 20-question Section ' + weakest + " quiz</a>.</p></div>";
    }

    html += '<h2 style="font-size:1.5rem">Review your answers</h2>' +
      '<div class="review-filters" role="group" aria-label="Filter review">' +
        '<button type="button" data-f="all" aria-pressed="true">All (' + n + ")</button>" +
        '<button type="button" data-f="wrong" aria-pressed="false">Incorrect (' + (n - correct) + ")</button>" +
        (state.mode === "exam" ? '<button type="button" data-f="flag" aria-pressed="false">Flagged (' + state.flags.filter(Boolean).length + ")</button>" : "") +
      '</div><ol class="review-list">';
    state.qs.forEach(function (q, k) {
      var a = state.answers[k], ok = a !== null && q.opts[a].correct, ci = correctIndex(q);
      html += '<li class="review-item ' + (ok ? "is-right" : "is-wrong") + '" data-ok="' + ok + '" data-flag="' + state.flags[k] + '">' +
        '<div class="meta"><span>Q' + (k + 1) + "</span><span>Section " + q.d + " · Task " + q.t + "</span><span>" + (ok ? "Correct" : a === null ? "Not answered" : "Incorrect") + (state.flags[k] ? " · Flagged" : "") + "</span></div>" +
        "<h3>" + esc(q.q) + "</h3>" +
        (ok ? "" : '<p class="ans you-wrong">' + icon("i-x", "") + " Your answer: " + (a === null ? "none" : LETTERS[a] + ". " + esc(q.opts[a].text)) + "</p>") +
        '<p class="ans right">Correct answer: ' + LETTERS[ci] + ". " + esc(q.opts[ci].text) + "</p>" +
        '<p class="why">' + esc(q.e) + "</p></li>";
    });
    html += "</ol>" +
      '<div class="cta-band mt-3"><div><h2 style="font-size:1.6rem">Found an issue or have a suggestion?</h2><p>Tell us how we can make these practice quizzes more helpful.</p></div>' +
      '<div class="btn-row"><a class="btn btn-light" href="feedback.html">Leave feedback</a><a class="btn btn-ghost-light" style="--btn-fg:var(--navy-900);border-color:rgba(15,43,54,.35)" href="mailto:contact@abaexamprepstudio.com?subject=RBT%20practice%20question">Email us</a></div></div>';

    app.innerHTML = html;
    focusTop();
    announce("Quiz complete. You scored " + pct + " percent.");

    // animate ring + bars
    requestAnimationFrame(function () {
      setTimeout(function () {
        var bar = app.querySelector(".score-ring .bar");
        if (bar) bar.style.strokeDashoffset = (circumference * (1 - pct / 100)).toFixed(1);
        app.querySelectorAll(".breakdown .weight-bar").forEach(function (b) { b.classList.add("is-visible"); });
        countUp(app.querySelector("[data-final]"), pct);
        if (pct >= 80) confetti();
      }, 120);
    });

    app.querySelector("[data-r='retake']").addEventListener("click", function () { renderIntro(); focusTop(); });
    app.querySelectorAll("[data-f]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-f");
        app.querySelectorAll("[data-f]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        app.querySelectorAll(".review-item").forEach(function (li) {
          var show = f === "all" || (f === "wrong" && li.getAttribute("data-ok") === "false") || (f === "flag" && li.getAttribute("data-flag") === "true");
          li.hidden = !show;
        });
      });
    });
  }

  function countUp(el, end) {
    if (!el) return;
    if (reduceMotion) { el.textContent = end + "%"; return; }
    var t0 = performance.now();
    (function tick(now) {
      var p = Math.min((now - t0) / 1400, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + "%";
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  function confetti() {
    if (reduceMotion) return;
    var colors = ["#176B6B", "#E9785D", "#A9CBB7", "#173F4F", "#F5B7A5"];
    var box = document.createElement("div");
    box.className = "confetti";
    box.setAttribute("aria-hidden", "true");
    for (var k = 0; k < 90; k++) {
      var i = document.createElement("i");
      i.style.left = Math.random() * 100 + "%";
      i.style.background = colors[k % colors.length];
      i.style.animationDuration = 2.2 + Math.random() * 2 + "s";
      i.style.animationDelay = Math.random() * 0.6 + "s";
      i.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      box.appendChild(i);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 5200);
  }

  /* ---------- keyboard shortcuts ---------- */
  document.addEventListener("keydown", function (e) {
    if (!state || state.done || document.querySelector(".modal-backdrop")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    var key = e.key.toUpperCase();
    var idx = LETTERS.indexOf(key);
    if (idx === -1 && /^[1-4]$/.test(key)) idx = parseInt(key, 10) - 1;
    if (idx > -1) { e.preventDefault(); choose(idx); return; }
    if (e.key === "Enter" && e.target.tagName !== "BUTTON" && e.target.tagName !== "A") {
      var btn = app.querySelector("[data-act='check']:not([disabled]), [data-act='next'], [data-act='finish']");
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  // Update title/description for the chosen set
  // Keep tab titles under 60 characters for search results
  document.title = (isMock ? "Free RBT Mock Exam (20 Questions)" : "RBT Section " + setKey + " Practice Quiz") + " | ABA Exam Prep Studio";
  var crumb = document.getElementById("crumb-current");
  if (crumb) crumb.textContent = isMock ? "Free Mock Exam" : "Section " + setKey + " Quiz";

  renderIntro();
})();
