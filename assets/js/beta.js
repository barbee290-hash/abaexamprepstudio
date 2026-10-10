/* The Stimulus Control Room — online beta mock exam: exam -> survey -> results.
   Questions come from beta-submit.php only after the tester's email is checked.
   Answers, flags, and position are saved in this browser as the tester goes. */
(function () {
  "use strict";
  var LETTERS = ["A", "B", "C", "D"];
  var DOMAINS = { A: "Data Collection and Graphing", B: "Behavior Assessment", C: "Behavior Acquisition", D: "Behavior Reduction", E: "Documentation and Reporting", F: "Ethics" };
  var params = new URLSearchParams(location.search);
  var exam = /^[1-9]$/.test(params.get("exam") || "") ? params.get("exam") : "1";

  var startForm = document.getElementById("beta-start");
  var examBox = document.getElementById("beta-exam");
  var surveyForm = document.getElementById("beta-survey");
  var resultsBox = document.getElementById("beta-results");
  if (!startForm || !examBox) return;

  var emailInput = startForm.querySelector("input[name='email']");
  if (params.get("email")) emailInput.value = params.get("email");
  document.querySelectorAll("[data-exam-title]").forEach(function (el) { el.textContent = "RBT Mock Exam " + exam; });

  var state = null; // { email, title, qs, answers, flags, i, deadline }
  var timerId = null;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function icon(name, cls) {
    return '<svg aria-hidden="true"' + (cls ? ' class="' + cls + '"' : "") + '><use href="assets/img/icons.svg#' + name + '"></use></svg>';
  }
  function draftKey(email) { return "scr-beta-" + exam + "-" + email.toLowerCase(); }
  function readDraft(email) {
    try { return JSON.parse(localStorage.getItem(draftKey(email)) || "null"); } catch (e) { return null; }
  }
  function saveDraft() {
    try { localStorage.setItem(draftKey(state.email), JSON.stringify({ answers: state.answers, flags: state.flags, i: state.i })); } catch (e) { /* storage unavailable */ }
  }
  function clearDraft(email) {
    try { localStorage.removeItem(draftKey(email)); } catch (e) { /* ignore */ }
  }

  function status(form, kind, msg) {
    var box = form.querySelector(".form-status");
    box.className = "form-status is-shown " + kind;
    box.innerHTML = icon(kind === "success" ? "i-check-circle" : "i-x-circle") + "<div>" + msg + "</div>";
  }
  function busy(form, on) {
    var btn = form.querySelector("button[type='submit']");
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle("is-loading", on);
  }
  function send(fields, form) {
    var data = form && form.tagName === "FORM" && form !== startForm ? new FormData(form) : new FormData();
    Object.keys(fields).forEach(function (k) { data.append(k, fields[k]); });
    return fetch("beta-submit.php", { method: "POST", body: data, headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  var steps = document.querySelectorAll(".beta-steps li");
  function show(view) {
    var stepIndex = { start: 0, exam: 0, survey: 1, results: 2 }[view];
    steps.forEach(function (li, k) { li.classList.toggle("is-active", k === stepIndex); li.classList.toggle("is-done", k < stepIndex); });
    startForm.hidden = view !== "start";
    examBox.hidden = view !== "exam";
    surveyForm.hidden = view !== "survey";
    resultsBox.hidden = view !== "results";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- server responses ----------
  function handle(res, email) {
    if (res.status === "exam") startExam(res, email);
    else if (res.status === "survey") { stopTimer(); show("survey"); }
    else if (res.status === "results") { stopTimer(); clearDraft(email); renderResults(res.results); }
  }

  startForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status(startForm, "error", "Please enter the email address you signed up with.");
      emailInput.focus();
      return;
    }
    busy(startForm, true);
    send({ action: "start", email: email, exam: exam }).then(function (res) {
      busy(startForm, false);
      if (!res.ok) { status(startForm, "error", res.error || "Something went wrong. Please try again."); return; }
      handle(res, email);
    }).catch(function () {
      busy(startForm, false);
      status(startForm, "error", "We couldn't reach the server. Please check your connection and try again.");
    });
  });

  // ---------- exam ----------
  function startExam(res, email) {
    var draft = readDraft(email) || {};
    var n = res.questions.length;
    state = {
      email: email,
      title: res.title,
      qs: res.questions,
      answers: draft.answers && draft.answers.length === n ? draft.answers : new Array(n).fill(null),
      flags: draft.flags && draft.flags.length === n ? draft.flags : new Array(n).fill(false),
      i: typeof draft.i === "number" && draft.i < n ? draft.i : 0,
      deadline: Date.now() + Math.max(0, res.time_limit - res.elapsed) * 1000
    };
    show("exam");
    renderQuestion();
    stopTimer();
    timerId = setInterval(tick, 1000);
    tick();
  }

  function remaining() { return Math.max(0, Math.round((state.deadline - Date.now()) / 1000)); }
  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function tick() {
    if (!state) return;
    var left = remaining();
    var t = examBox.querySelector(".quiz-timer");
    if (t) {
      t.querySelector("span").textContent = fmt(left);
      t.classList.toggle("warn", left <= 300);
    }
    if (left <= 0) {
      stopTimer();
      submitAnswers(true);
    }
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function renderQuestion() {
    var q = state.qs[state.i], n = state.qs.length, i = state.i;
    var answered = state.answers.filter(function (a) { return a !== null; }).length;
    var html =
      '<div class="quiz-top">' +
        '<span class="quiz-progress-label">Question ' + (i + 1) + " of " + n + " · " + answered + " answered</span>" +
        '<span class="quiz-timer" role="timer" aria-label="Time remaining">' + icon("i-clock") + "<span>" + fmt(remaining()) + "</span></span>" +
      "</div>" +
      '<div class="progress" role="progressbar" aria-label="Exam progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(answered / n * 100) + '"><i style="width:' + (answered / n * 100) + '%"></i></div>' +
      '<div class="q-body">' +
        '<span class="q-tag">Question ' + q.n + "</span>" +
        '<h2 class="q-text" id="q-text">' + esc(q.stem) + "</h2>" +
        '<ul class="options" role="list" aria-labelledby="q-text">';
    LETTERS.forEach(function (L) {
      html += '<li><button type="button" class="option" data-l="' + L + '" aria-pressed="' + (state.answers[i] === L) + '">' +
        '<span class="letter" aria-hidden="true">' + L + '</span><span><span class="sr-only">Option ' + L + ": </span>" + esc(q.options[L]) + "</span></button></li>";
    });
    html += "</ul></div>";

    html += '<div class="quiz-actions"><div class="left">';
    if (i > 0) html += '<button type="button" class="btn btn-outline btn-sm" data-act="prev">' + icon("i-arrow-left") + " Previous</button>";
    html += '<button type="button" class="btn btn-outline btn-sm flag-btn" data-act="flag" aria-pressed="' + state.flags[i] + '">' + icon("i-flag") + (state.flags[i] ? " Flagged" : " Flag for review") + "</button>";
    html += '</div><div class="right">';
    if (i < n - 1) html += '<button type="button" class="btn btn-teal" data-act="next">Next ' + icon("i-arrow", "arrow") + "</button>";
    html += '<button type="button" class="btn ' + (i === n - 1 ? "btn-primary" : "btn-outline") + '" data-act="submit">Submit exam</button>';
    html += "</div></div>";

    html += '<nav class="q-nav" aria-label="Question navigator"><h2>Jump to a question</h2><div class="q-nav-grid">';
    state.qs.forEach(function (_, k) {
      var c = [];
      if (state.answers[k] !== null) c.push("answered");
      if (state.flags[k]) c.push("flagged");
      if (k === i) c.push("current");
      html += '<button type="button" data-jump="' + k + '" class="' + c.join(" ") + '" aria-label="Question ' + (k + 1) + (state.answers[k] !== null ? ", answered" : ", not answered") + (state.flags[k] ? ", flagged" : "") + '"' + (k === i ? ' aria-current="step"' : "") + ">" + (k + 1) + "</button>";
    });
    html += '</div><div class="q-nav-legend"><span><i class="a"></i> Answered</span><span><i></i> Not answered</span><span><i class="f"></i> Flagged</span></div></nav>';
    examBox.innerHTML = html;
  }

  function go(k) {
    state.i = Math.max(0, Math.min(state.qs.length - 1, k));
    saveDraft();
    renderQuestion();
    examBox.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  examBox.addEventListener("click", function (e) {
    var opt = e.target.closest(".option");
    if (opt) {
      state.answers[state.i] = opt.getAttribute("data-l");
      saveDraft();
      renderQuestion();
      return;
    }
    var jump = e.target.closest("[data-jump]");
    if (jump) { go(parseInt(jump.getAttribute("data-jump"), 10)); return; }
    var act = e.target.closest("[data-act]");
    if (!act) return;
    var a = act.getAttribute("data-act");
    if (a === "prev") go(state.i - 1);
    else if (a === "next") go(state.i + 1);
    else if (a === "flag") { state.flags[state.i] = !state.flags[state.i]; saveDraft(); renderQuestion(); }
    else if (a === "submit") confirmSubmit();
  });

  // In-page confirmation (browser pop-ups like confirm() can be silently blocked)
  function confirmSubmit() {
    var blank = state.answers.filter(function (x) { return x === null; }).length;
    var flagged = state.flags.filter(Boolean).length;
    var lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<h2 id="m-title">Submit your exam?</h2><p>' +
      (blank ? "You have <strong>" + blank + " unanswered</strong> question" + (blank > 1 ? "s" : "") + ". Unanswered questions are scored as incorrect. " : "You answered every question. ") +
      (flagged ? "You flagged <strong>" + flagged + "</strong> question" + (flagged > 1 ? "s" : "") + " for review. " : "") +
      "After you submit, you can't change your answers.</p>" +
      '<div class="btn-row"><button type="button" class="btn btn-primary" data-m="yes">Submit now</button><button type="button" class="btn btn-outline" data-m="no">Keep working</button></div></div>';
    document.body.appendChild(wrap);
    var yes = wrap.querySelector("[data-m='yes']"), no = wrap.querySelector("[data-m='no']");
    no.focus();
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey, true); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      if (e.key === "Tab") { e.preventDefault(); (document.activeElement === yes ? no : yes).focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    yes.addEventListener("click", function () { close(); submitAnswers(false); });
    no.addEventListener("click", close);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
  }

  function examError(msg) {
    var box = examBox.querySelector(".beta-exam-error");
    if (!box) {
      box = document.createElement("div");
      box.className = "form-status is-shown error beta-exam-error";
      box.setAttribute("role", "alert");
      examBox.insertBefore(box, examBox.querySelector(".q-nav"));
    }
    box.innerHTML = icon("i-x-circle") + "<div>" + msg + "</div>";
  }

  document.addEventListener("keydown", function (e) {
    if (examBox.hidden || !state || e.target.closest("input, textarea")) return;
    var k = LETTERS.indexOf(e.key.toUpperCase());
    if (k >= 0) { state.answers[state.i] = LETTERS[k]; saveDraft(); renderQuestion(); }
    else if (e.key === "ArrowRight" && state.i < state.qs.length - 1) go(state.i + 1);
    else if (e.key === "ArrowLeft" && state.i > 0) go(state.i - 1);
  });

  function submitAnswers(timeUp) {
    stopTimer();
    var sheet = state.answers.map(function (x) { return x || "-"; }).join("");
    examBox.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    send({ action: "answers", email: state.email, exam: exam, answers: sheet }).then(function (res) {
      if (!res.ok) {
        examBox.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
        examError(res.error || "Something went wrong submitting your exam. Please try again.");
        return;
      }
      if (timeUp) status(surveyForm, "success", "Time's up! Your answers were submitted automatically.");
      handle(res, state.email);
    }).catch(function () {
      examBox.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      examError("We couldn't reach the server. Your answers are saved on this device. Please check your connection and click Submit exam again.");
    });
  }

  // ---------- survey ----------
  surveyForm.querySelectorAll("fieldset[data-max]").forEach(function (fs) {
    var max = parseInt(fs.getAttribute("data-max"), 10);
    fs.addEventListener("change", function () {
      var n = fs.querySelectorAll("input:checked").length;
      fs.querySelectorAll("input[type='checkbox']").forEach(function (b) { b.disabled = !b.checked && n >= max; });
    });
  });
  surveyForm.addEventListener("change", function () {
    surveyForm.querySelectorAll("[data-show-when]").forEach(function (box) {
      var parts = box.getAttribute("data-show-when").split("=");
      var picked = surveyForm.querySelector("input[name='" + parts[0] + "']:checked");
      box.hidden = !(picked && picked.value === parts[1]);
    });
  });
  surveyForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var missing = [];
    surveyForm.querySelectorAll(".survey-q").forEach(function (fs, i) {
      if (!fs.querySelector("input:checked")) missing.push(i + 1);
    });
    if (missing.length) {
      status(surveyForm, "error", "Please answer question" + (missing.length > 1 ? "s " : " ") + missing.join(", ") + ".");
      return;
    }
    var email = state ? state.email : emailInput.value.trim();
    busy(surveyForm, true);
    send({ action: "survey", email: email, exam: exam }, surveyForm).then(function (res) {
      busy(surveyForm, false);
      if (!res.ok) { status(surveyForm, "error", res.error || "Something went wrong. Please try again."); return; }
      handle(res, email);
    }).catch(function () {
      busy(surveyForm, false);
      status(surveyForm, "error", "We couldn't reach the server. Please check your connection and try again.");
    });
  });

  // ---------- results ----------
  function renderResults(r) {
    var level = r.percent >= 80 ? "good" : r.percent >= 65 ? "mid" : "low";
    var levelText = { good: "On track", mid: "Getting close", low: "Keep practicing" }[level];
    var wrong = r.review.filter(function (q) { return q.scored && q.your !== q.answer; }).length;
    var html = '<div class="quiz-card">' +
      '<span class="readiness ' + level + '">' + icon(level === "good" ? "i-check-circle" : "i-target") + levelText + "</span>" +
      '<h2 style="font-size:clamp(1.8rem,3.4vw,2.4rem);margin-bottom:6px">Your results: ' + esc(r.title) + "</h2>" +
      '<p class="beta-big-score"><b>' + r.percent + '%</b> <span>' + r.correct + " of " + r.count + " scored questions correct</span></p>" +
      '<p class="muted">The ' + (r.total - r.count) + " unscored pilot questions don't count toward your score, but they're included in the review below.</p>" +
      '<h3 style="font-size:1.25rem;margin-top:26px">Score by content area</h3><div class="breakdown">';
    r.domains.forEach(function (d) {
      var p = Math.round(d.right / Math.max(1, d.total) * 100);
      html += '<div class="breakdown-row"><span class="name">' + d.d + ". " + esc(d.name) + '</span><span class="val">' + d.right + "/" + d.total + '</span><div class="weight-bar is-visible"><i style="--w:' + p + '%"></i></div></div>';
    });
    html += "</div>";
    if (r.next) {
      html += '<div class="founder-offer" style="margin:6px 0 30px"><div><span class="tag-new">Up next</span><h2>' + esc(r.next.title) + " is ready</h2>" +
        "<p>Same format: 85 questions, 90 minutes, a short survey, then your results. Take it whenever you're ready.</p></div>" +
        '<a class="btn btn-primary" href="beta.html?exam=' + r.next.id + "&email=" + encodeURIComponent(state ? state.email : emailInput.value.trim()) + '">Start ' + esc(r.next.title) + " " + icon("i-arrow", "arrow") + "</a></div>";
    } else {
      html += '<div class="callout" style="margin:6px 0 30px">' + icon("i-check-circle") + "<p><strong>That completes our beta mock exams.</strong> Thank you so much for helping shape them, and good luck on your RBT exam!</p></div>";
    }
    html += '<h3 style="font-size:1.25rem">Review every question</h3>' +
      '<div class="review-filters" role="group" aria-label="Filter review">' +
        '<button type="button" data-f="all" aria-pressed="true">All (' + r.review.length + ")</button>" +
        '<button type="button" data-f="wrong" aria-pressed="false">Missed (' + wrong + ")</button>" +
      '</div><ol class="review-list">';
    r.review.forEach(function (q) {
      var ok = q.your === q.answer;
      html += '<li class="review-item ' + (ok ? "is-right" : "is-wrong") + '" data-ok="' + (ok || !q.scored) + '">' +
        '<div class="meta"><span>Q' + q.n + "</span><span>Section " + q.domain + " · Task " + esc(q.task) + "</span><span>" + (ok ? "Correct" : q.your === "-" ? "Not answered" : "Incorrect") + (q.scored ? "" : " · Pilot, unscored") + "</span></div>" +
        "<h3>" + esc(q.stem) + "</h3>" +
        (ok ? "" : '<p class="ans you-wrong">' + icon("i-x") + " Your answer: " + (q.your === "-" ? "none" : q.your + ". " + esc(q.options[q.your])) + "</p>") +
        '<p class="ans right">Correct answer: ' + q.answer + ". " + esc(q.options[q.answer]) + "</p>" +
        '<p class="why">' + esc(q.rationale) + "</p>" +
        '<p class="why" style="font-size:.82rem">Source: ' + esc(q.source) + "</p></li>";
    });
    html += "</ol></div>";
    resultsBox.innerHTML = html;
    resultsBox.querySelectorAll("[data-f]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-f");
        resultsBox.querySelectorAll("[data-f]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        resultsBox.querySelectorAll(".review-item").forEach(function (li) {
          li.hidden = f === "wrong" && li.getAttribute("data-ok") === "true";
        });
      });
    });
    show("results");
    resultsBox.focus();
  }
})();
