/* The Stimulus Control Room — beta mock exam: answer sheet -> survey -> results.
   Talks to beta-submit.php. Answers are saved in this browser as the tester goes. */
(function () {
  "use strict";
  var TOTAL = 85;
  var LETTERS = ["A", "B", "C", "D"];
  var params = new URLSearchParams(location.search);
  var exam = /^[1-9]$/.test(params.get("exam") || "") ? params.get("exam") : "1";
  var draftKey = "scr-beta-answers-" + exam;

  var answersForm = document.getElementById("beta-answers");
  var surveyForm = document.getElementById("beta-survey");
  var done = document.getElementById("beta-done");
  var grid = document.getElementById("answer-grid");
  if (!answersForm || !grid) return;

  answersForm.querySelector("input[name='exam']").value = exam;
  document.querySelectorAll("[data-exam-title]").forEach(function (el) { el.textContent = "RBT Mock Exam " + exam; });
  document.querySelectorAll("[data-total]").forEach(function (el) { el.textContent = TOTAL; });
  var emailInput = answersForm.querySelector("input[name='email']");
  if (params.get("email")) emailInput.value = params.get("email");

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(draftKey) || "{}"); } catch (e) { return {}; }
  }
  function writeDraft(d) {
    try { localStorage.setItem(draftKey, JSON.stringify(d)); } catch (e) { /* storage unavailable */ }
  }
  var draft = readDraft();
  if (!emailInput.value && draft.email) emailInput.value = draft.email;

  // Build the 85-row answer sheet
  var html = "";
  for (var n = 1; n <= TOTAL; n++) {
    html += '<fieldset class="answer-row"><legend><span class="sr-only">Question </span>' + n + ".</legend>";
    LETTERS.forEach(function (l) {
      var checked = draft["q" + n] === l ? " checked" : "";
      html += '<label class="bubble"><input type="radio" name="a' + n + '" value="' + l + '"' + checked + '><span aria-hidden="true">' + l + '</span><span class="sr-only">' + l + "</span></label>";
    });
    html += "</fieldset>";
  }
  grid.innerHTML = html;

  var countEl = answersForm.querySelector("[data-answered]");
  function answered() { return grid.querySelectorAll("input:checked").length; }
  function updateCount() { countEl.textContent = answered(); }
  updateCount();

  grid.addEventListener("change", function (e) {
    var t = e.target;
    if (t.type !== "radio") return;
    draft["q" + t.name.slice(1)] = t.value;
    writeDraft(draft);
    updateCount();
  });
  emailInput.addEventListener("change", function () { draft.email = emailInput.value.trim(); writeDraft(draft); });

  function status(form, kind, msg) {
    var box = form.querySelector(".form-status");
    var icon = kind === "success" ? "i-check-circle" : "i-x-circle";
    box.className = "form-status is-shown " + kind;
    box.innerHTML = '<svg aria-hidden="true"><use href="assets/img/icons.svg#' + icon + '"></use></svg><div>' + msg + "</div>";
  }
  function busy(form, on) {
    var btn = form.querySelector("button[type='submit']");
    btn.disabled = on;
    btn.classList.toggle("is-loading", on);
  }
  function send(data) {
    return fetch("beta-submit.php", { method: "POST", body: data, headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  var steps = document.querySelectorAll(".beta-steps li");
  function showStep(i) {
    steps.forEach(function (li, k) { li.classList.toggle("is-active", k === i); li.classList.toggle("is-done", k < i); });
    answersForm.hidden = i !== 0;
    surveyForm.hidden = i !== 1;
    done.hidden = i !== 2;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showDone(res) {
    done.querySelector("[data-done-message]").textContent = res.message || "Thank you!";
    if (res.score) {
      done.querySelector(".beta-score").hidden = false;
      done.querySelector("[data-score]").textContent = res.score + " (" + res.percent + "%)";
    }
    showStep(2);
    done.focus();
  }

  answersForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status(answersForm, "error", "Please enter the email address you signed up with.");
      emailInput.focus();
      return;
    }
    var sheet = "";
    for (var n = 1; n <= TOTAL; n++) {
      var c = grid.querySelector("input[name='a" + n + "']:checked");
      sheet += c ? c.value : "-";
    }
    var blank = (sheet.match(/-/g) || []).length;
    if (blank && !window.confirm("You left " + blank + " question" + (blank === 1 ? "" : "s") + " blank. Blank answers are scored as incorrect. Submit anyway?")) return;

    var data = new FormData();
    data.append("action", "answers");
    data.append("email", email);
    data.append("exam", exam);
    data.append("answers", sheet);
    busy(answersForm, true);
    send(data).then(function (res) {
      busy(answersForm, false);
      if (!res.ok) { status(answersForm, "error", res.error || "Something went wrong. Please try again."); return; }
      if (res.status === "done") { showDone(res); return; }
      if (res.message) status(surveyForm, "success", res.message);
      showStep(1);
    }).catch(function () {
      busy(answersForm, false);
      status(answersForm, "error", "We couldn't reach the server. Please check your connection and try again.");
    });
  });

  // Survey: limit checkboxes, show follow-up boxes
  surveyForm.querySelectorAll("fieldset[data-max]").forEach(function (fs) {
    var max = parseInt(fs.getAttribute("data-max"), 10);
    fs.addEventListener("change", function () {
      var boxes = fs.querySelectorAll("input[type='checkbox']");
      var n = fs.querySelectorAll("input:checked").length;
      boxes.forEach(function (b) { b.disabled = !b.checked && n >= max; });
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
    var data = new FormData(surveyForm);
    data.append("action", "survey");
    data.append("email", emailInput.value.trim());
    data.append("exam", exam);
    busy(surveyForm, true);
    send(data).then(function (res) {
      busy(surveyForm, false);
      if (!res.ok) { status(surveyForm, "error", res.error || "Something went wrong. Please try again."); return; }
      try { localStorage.removeItem(draftKey); } catch (err) { /* ignore */ }
      showDone(res);
    }).catch(function () {
      busy(surveyForm, false);
      status(surveyForm, "error", "We couldn't reach the server. Please check your connection and try again.");
    });
  });
})();
