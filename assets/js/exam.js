/* The Stimulus Control Room — full exam engine (Exam 2 / Exam 3) */
(function () {
  "use strict";

  // Gate check
  try {
    if (localStorage.getItem("scr_exam_access") !== "true") {
      window.location.replace("my-exams.html");
      return;
    }
  } catch (e) {
    window.location.replace("my-exams.html");
    return;
  }

  var app = document.getElementById("exam-app");
  if (!app || !window.AEP_EXAMS) return;

  var params = new URLSearchParams(location.search);
  var examNum = parseInt(params.get("exam") || "2", 10);
  if (!AEP_EXAMS[examNum]) { window.location.replace("my-exams.html"); return; }

  var EXAM = AEP_EXAMS[examNum];
  var DOMAINS = { A: "Data Collection & Graphing", B: "Behavior Assessment", C: "Behavior Acquisition", D: "Behavior Reduction", E: "Documentation & Reporting", F: "Ethics" };
  var ICONS = "assets/img/icons.svg#";
  var LETTERS = ["A", "B", "C", "D"];
  var SCORED_TOTAL = EXAM.questions.filter(function (q) { return q.scored; }).length;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var state = null;
  var timerId = null;

  function icon(id, cls) { return '<svg aria-hidden="true"' + (cls ? ' class="' + cls + '"' : "") + '><use href="' + ICONS + id + '"></use></svg>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fmtTime(s) { var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }
  function focusTop() {
    app.setAttribute("tabindex", "-1");
    app.focus({ preventScroll: true });
    var top = app.getBoundingClientRect().top + window.scrollY - 100;
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function buildQuestions() {
    // Shuffle question order — options stay in original ABCD order (like the real exam)
    return shuffle(EXAM.questions.map(function (q) {
      return {
        d: q.d, t: q.t, q: q.q, e: q.e, scored: q.scored,
        opts: q.opts.slice() // preserve original ABCD order
      };
    }));
  }

  function correctIndex(q) {
    for (var i = 0; i < q.opts.length; i++) if (q.opts[i].correct) return i;
    return -1;
  }

  /* ---------- intro ---------- */
  function renderIntro() {
    stopTimer();
    app.innerHTML =
      '<div class="quiz-intro">' +
        "<div>" +
          '<span class="q-tag">' + icon("d-mock") + "Full 85-Question Exam</span>" +
          "<h1>" + esc(EXAM.title) + "</h1>" +
          '<p class="lead">A complete 85-question mock exam covering all six domains of the 2026 RBT® Test Content Outline. Questions are presented in a randomized order. Seventy-five questions are scored; ten are unscored pretest items mixed throughout (you won’t know which is which, just like the real exam).</p>' +
          '<div class="quiz-facts">' +
            '<span class="pill pill-light">' + icon("i-list") + " 85 questions</span>" +
            '<span class="pill pill-light">' + icon("i-clock") + " 90-minute timer</span>" +
            '<span class="pill pill-light">' + icon("i-star") + " Score based on 75 scored questions</span>" +
          "</div>" +
          '<form class="mode-form" novalidate>' +
            '<fieldset class="mode-picker" style="border:0;padding:0;margin:0 0 28px">' +
              '<legend class="h4" style="font-weight:800;color:var(--navy);margin-bottom:14px">Choose your mode</legend>' +
              '<div class="mode-option"><input type="radio" name="mode" id="mode-exam" value="exam" checked>' +
                '<label for="mode-exam"><span class="radio"></span><span><strong>Exam mode</strong><span class="desc">90-minute timer, flag questions, move freely, then see your score and full review at the end. Best for test-day practice.</span></span></label></div>' +
              '<div class="mode-option"><input type="radio" name="mode" id="mode-study" value="study">' +
                '<label for="mode-study"><span class="radio"></span><span><strong>Study mode</strong><span class="desc">See whether you\'re right, with an explanation, after every question. Best for learning the material.</span></span></label></div>' +
            "</fieldset>" +
            '<div class="btn-row">' +
              '<button type="submit" class="btn btn-primary">Start exam ' + icon("i-arrow", "arrow") + '</button>' +
              '<a class="btn btn-outline" href="my-exams.html">Back to My Exams</a>' +
            "</div>" +
          "</form>" +
        "</div>" +
        '<aside class="intro-side" aria-labelledby="tips-title">' +
          '<h2 id="tips-title">Before you start</h2>' +
          "<ul>" +
            "<li>Read every answer before choosing. The exam often includes two options that look very close.</li>" +
            "<li>Watch for key words like <em>first</em>, <em>best</em>, and <em>most appropriate</em>.</li>" +
            "<li>You can flag questions and return to them before submitting.</li>" +
            "<li>Keyboard shortcuts: press <span class=\"kbd\">A</span>–<span class=\"kbd\">D</span> or <span class=\"kbd\">1</span>–<span class=\"kbd\">4</span> to answer, <span class=\"kbd\">Enter</span> to continue.</li>" +
            "<li>Unanswered questions count as incorrect when time runs out.</li>" +
          "</ul>" +
        "</aside>" +
      "</div>";

    app.querySelector(".mode-form").addEventListener("submit", function (e) {
      e.preventDefault();
      start(app.querySelector("input[name='mode']:checked").value);
    });
  }

  /* ---------- quiz ---------- */
  function start(mode) {
    var qs = buildQuestions();
    state = {
      mode: mode,
      qs: qs,
      answers: qs.map(function () { return null; }),
      locked: qs.map(function () { return false; }),
      flags: qs.map(function () { return false; }),
      i: 0,
      remaining: EXAM.time,
      done: false
    };
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
      if (state.remaining === 300) announce("Five minutes remaining.");
      if (state.remaining === 120) announce("Two minutes remaining.");
      if (state.remaining <= 0) { stopTimer(); finish(true); }
    }, 1000);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function announce(msg) {
    var live = document.getElementById("exam-live");
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
        (exam
          ? '<span class="quiz-timer' + (state.remaining <= 120 ? " warn" : "") + '" role="timer" aria-label="Time remaining">' + icon("i-clock") + "<span>" + fmtTime(state.remaining) + "</span></span>"
          : '<span class="pill pill-light">' + icon("i-book") + " Study mode</span>") +
      "</div>" +
      '<div class="progress" role="progressbar" aria-label="Exam progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(progress) + '"><i style="width:' + progress + '%"></i></div>' +
      '<div class="q-body' + (state.lastShown !== i ? " is-new" : "") + '">' +
        '<span class="q-tag">' + icon("d-" + q.d.toLowerCase()) + "Section " + q.d + " · " + esc(DOMAINS[q.d]) + " · Task " + q.t + "</span>" +
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
      var ci = correctIndex(q);
      html += '<div class="explain ' + (right ? "good" : "bad") + '" role="status">' + icon(right ? "i-check-circle" : "i-x-circle") +
        "<div><strong>" + (right ? "Correct!" : "Not quite. The correct answer is " + LETTERS[ci] + ".") + "</strong><p>" + esc(q.e) + "</p></div></div>";
    }
    html += "</div>";

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
    document.addEventListener("keydown", onKey);
    if (!exam && state.locked[state.i]) {
      var next = app.querySelector("[data-act='next'], [data-act='finish']");
      if (next) next.focus({ preventScroll: true });
    }
  }

  function onKey(e) {
    if (state && !state.done) {
      var k = { "1": 0, "2": 1, "3": 2, "4": 3, "a": 0, "b": 1, "c": 2, "d": 3 }[e.key.toLowerCase()];
      if (k !== undefined) { choose(k); return; }
      if (e.key === "Enter") {
        var exam = state.mode === "exam";
        if (exam) {
          var next = app.querySelector("[data-act='next']");
          if (next) next.click();
        } else {
          var check = app.querySelector("[data-act='check']:not([disabled])");
          if (check) { check.click(); return; }
          var cont = app.querySelector("[data-act='next'], [data-act='finish']");
          if (cont) cont.click();
        }
      }
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
    if (state.mode === "study" && k > state.i && !state.locked[state.i]) return;
    document.removeEventListener("keydown", onKey);
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
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey2, true); if (lastFocus) lastFocus.focus(); }
    function onKey2(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "Tab") { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    }
    document.addEventListener("keydown", onKey2, true);
    yes.addEventListener("click", function () { close(); finish(false); });
    no.addEventListener("click", close);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
  }

  /* ---------- results ---------- */
  function finish(timedOut) {
    stopTimer();
    document.removeEventListener("keydown", onKey);
    state.done = true;

    // Score only scored questions
    var correct = 0, byDomain = {}, domainOrder = [];
    state.qs.forEach(function (q, k) {
      var ok = state.answers[k] !== null && q.opts[state.answers[k]].correct;
      if (q.scored) {
        if (!byDomain[q.d]) { byDomain[q.d] = { right: 0, total: 0 }; domainOrder.push(q.d); }
        byDomain[q.d].total++;
        if (ok) { correct++; byDomain[q.d].right++; }
      }
    });
    domainOrder.sort();

    var pct = Math.round((correct / SCORED_TOTAL) * 100);
    var level = pct >= 80 ? "good" : pct >= 65 ? "mid" : "low";
    var levelText = { good: "On track", mid: "Getting close", low: "Keep practicing" }[level];
    var levelMsg = {
      good: "Strong work. You answered most questions correctly. Review the breakdown below and focus on any weak spots.",
      mid: "You're building a solid foundation. Review the explanations for the questions you missed and try the other full exam.",
      low: "Every attempt teaches you something. Study the explanations below and focus on one section at a time."
    }[level];

    var circumference = 2 * Math.PI * 88;
    var html =
      '<div class="results-hero">' +
        '<div class="score-ring" role="img" aria-label="Score ' + pct + ' percent">' +
          '<svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="88" fill="none" stroke-width="14"/>' +
          '<circle class="bar" cx="100" cy="100" r="88" fill="none" stroke-width="14" stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + circumference.toFixed(1) + '"/></svg>' +
          '<div class="center"><div><b data-final="' + pct + '">0%</b><small>' + correct + " of " + SCORED_TOTAL + " scored</small></div></div>" +
        "</div>" +
        "<div>" +
          '<span class="readiness ' + level + '">' + icon(level === "good" ? "i-check-circle" : "i-target") + levelText + "</span>" +
          "<h1 style=\"font-size:clamp(1.9rem,3.6vw,2.6rem)\">" + (timedOut ? "Time's up! " : "") + "Your results</h1>" +
          '<p class="lead">' + esc(levelMsg) + "</p>" +
          '<div class="btn-row">' +
            '<button type="button" class="btn btn-primary" data-r="retake">' + icon("i-refresh") + " Retake exam</button>" +
            '<a class="btn btn-teal" href="practice.html">Practice weak areas ' + icon("i-arrow", "arrow") + "</a>" +
            '<a class="btn btn-outline" href="my-exams.html">Back to My Exams</a>' +
          "</div>" +
        "</div>" +
      "</div>";

    html += '<h2 style="font-size:1.5rem">Score by exam section</h2><div class="breakdown">';
    domainOrder.forEach(function (d) {
      var r = byDomain[d], p = Math.round((r.right / r.total) * 100);
      html += '<div class="breakdown-row"><span class="name">' + esc(d + ". " + (DOMAINS[d] || d)) + '</span><span class="val">' + r.right + "/" + r.total + '</span><div class="weight-bar"><i style="--w:' + p + '%"></i></div></div>';
    });
    html += "</div>";

    var totalQ = state.qs.length;
    var totalCorrect = state.qs.filter(function (q, k) { return state.answers[k] !== null && q.opts[state.answers[k]].correct; }).length;
    var totalWrong = totalQ - totalCorrect;

    html += '<h2 style="font-size:1.5rem">Review your answers</h2>' +
      '<div class="review-filters" role="group" aria-label="Filter review">' +
        '<button type="button" data-f="all" aria-pressed="true">All (' + totalQ + ")</button>" +
        '<button type="button" data-f="wrong" aria-pressed="false">Incorrect (' + totalWrong + ")</button>" +
        (state.mode === "exam" ? '<button type="button" data-f="flag" aria-pressed="false">Flagged (' + state.flags.filter(Boolean).length + ")</button>" : "") +
      '</div><ol class="review-list">';

    state.qs.forEach(function (q, k) {
      var a = state.answers[k], ok = a !== null && q.opts[a].correct, ci = correctIndex(q);
      var unscoredBadge = !q.scored ? ' <span class="pill" style="font-size:.7rem;background:var(--coral);color:#fff;border-radius:4px;padding:1px 6px;vertical-align:middle">Unscored</span>' : "";
      html += '<li class="review-item ' + (ok ? "is-right" : "is-wrong") + '" data-ok="' + ok + '" data-flag="' + state.flags[k] + '" data-scored="' + q.scored + '">' +
        '<div class="meta"><span>Q' + (k + 1) + "</span><span>Section " + q.d + " · Task " + q.t + "</span><span>" + (ok ? "Correct" : a === null ? "Not answered" : "Incorrect") + (state.flags[k] ? " · Flagged" : "") + unscoredBadge + "</span></div>" +
        "<h3>" + esc(q.q) + "</h3>" +
        (ok ? "" : '<p class="ans you-wrong">' + icon("i-x", "") + " Your answer: " + (a === null ? "none" : LETTERS[a] + ". " + esc(q.opts[a].text)) + "</p>") +
        '<p class="ans right">Correct answer: ' + LETTERS[ci] + ". " + esc(q.opts[ci].text) + "</p>" +
        '<p class="why">' + esc(q.e) + "</p></li>";
    });
    html += "</ol>" +
      '<div class="cta-band mt-3"><div><h2 style="font-size:1.6rem">Want to go deeper?</h2><p>The RBT Study Guide walks through every task list item with examples. SAFMEDS cards help you lock in the vocabulary at speed.</p></div>' +
      '<div class="btn-row"><a class="btn btn-light" href="full-exams.html">See all study tools</a><a class="btn btn-ghost-light" style="--btn-fg:var(--navy-900);border-color:rgba(15,43,54,.35)" href="safmeds.html">Try SAFMEDS free</a></div></div>' +
      '<div class="cta-band mt-3"><div><h2 style="font-size:1.6rem">Found an issue or have a suggestion?</h2><p>Tell us how we can make these exams more useful.</p></div>' +
      '<div class="btn-row"><a class="btn btn-light" href="feedback.html">Leave feedback</a><a class="btn btn-ghost-light" style="--btn-fg:var(--navy-900);border-color:rgba(15,43,54,.35)" href="mailto:contact@thestimuluscontrolroom.com?subject=RBT%20Mock%20Exam%20Feedback">Email us</a></div></div>';

    app.innerHTML = html;
    focusTop();
    announce("Exam complete. You scored " + pct + " percent on scored questions.");

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
    var start = 0, dur = 800, t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      el.textContent = Math.round(p * end) + "%";
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function confetti() {
    if (typeof window.confetti === "function") { window.confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } }); }
  }

  /* ---------- init ---------- */
  renderIntro();
})();
