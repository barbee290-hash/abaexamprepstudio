/* The Stimulus Control Room — site-wide behavior */
(function () {
  "use strict";
  document.documentElement.classList.remove("no-js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Sticky header shadow ---------- */
  var header = document.querySelector(".site-header");
  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");
  if (toggle && nav) {
    var mq = window.matchMedia("(max-width: 1280px)");

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      nav.classList.toggle("is-open", open);
      header.classList.toggle("nav-open", open);
      document.body.classList.toggle("nav-locked", open);
      if (open) {
        var first = nav.querySelector("a");
        if (first) setTimeout(function () { first.focus(); }, 250);
      }
    }
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
      // keep focus inside the open menu
      if (e.key === "Tab" && nav.classList.contains("is-open")) {
        var items = [toggle].concat(Array.prototype.slice.call(nav.querySelectorAll("a")));
        var firstEl = items[0], lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    });
    mq.addEventListener("change", function (e) { if (!e.matches) setOpen(false); });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll(".reveal, .weight-bar[data-animate]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Count-up numbers ---------- */
  var counters = document.querySelectorAll("[data-count]");
  if (counters.length && "IntersectionObserver" in window && !reduceMotion) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target, end = parseInt(el.getAttribute("data-count"), 10), suffix = el.getAttribute("data-suffix") || "";
        var start = performance.now(), dur = 1400;
        (function tick(now) {
          var p = Math.min((now - start) / dur, 1), eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(end * eased) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        })(start);
        cio.unobserve(el);
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ---------- Footer year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- Guide table of contents highlight ---------- */
  var tocLinks = document.querySelectorAll(".toc a[href^='#']");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var tio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          tocLinks.forEach(function (a) { a.classList.remove("is-active"); });
          var link = map[entry.target.id];
          if (link) link.classList.add("is-active");
        }
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    Object.keys(map).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) tio.observe(sec);
    });
  }

  /* ---------- Best scores from past quizzes ---------- */
  function readScores() {
    try { return JSON.parse(localStorage.getItem("aep-best-scores") || "{}"); } catch (e) { return {}; }
  }
  var scores = readScores();
  document.querySelectorAll("[data-best]").forEach(function (el) {
    var key = el.getAttribute("data-best");
    if (scores[key] != null) {
      el.textContent = "Best: " + scores[key] + "%";
      el.hidden = false;
    }
  });

  /* ---------- Forms (feedback + waitlist) ---------- */
  var isLocal = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  function statusBox(form) {
    return form.querySelector(".form-status") || form.parentElement.querySelector(".form-status");
  }
  function showStatus(box, type, html) {
    if (!box) return;
    var icon = type === "success" ? "i-check-circle" : type === "error" ? "i-x-circle" : "i-info";
    box.className = "form-status is-shown " + type;
    box.innerHTML = '<svg aria-hidden="true"><use href="assets/img/icons.svg#' + icon + '"></use></svg><div>' + html + "</div>";
    box.setAttribute("tabindex", "-1");
    box.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  }
  function validate(form) {
    var ok = true, firstBad = null;
    form.querySelectorAll("[data-validate]").forEach(function (input) {
      var field = input.closest(".field");
      var val = input.value.trim(), bad = false;
      if (input.required && !val) bad = true;
      if (!bad && val && input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) bad = true;
      if (!bad && input.minLength > 0 && val && val.length < input.minLength) bad = true;
      if (field) field.classList.toggle("has-error", bad);
      input.setAttribute("aria-invalid", bad ? "true" : "false");
      if (bad) { ok = false; if (!firstBad) firstBad = input; }
    });
    if (firstBad) firstBad.focus();
    return ok;
  }

  document.querySelectorAll("form[data-ajax]").forEach(function (form) {
    var started = form.querySelector("input[name='started']");
    if (started) started.value = String(Math.floor(Date.now() / 1000));
    // Which quiz sent them here (full-exams.html?from=quiz-c)
    var source = form.querySelector("input[name='source']");
    var from = /[?&]from=([A-Za-z0-9-]{1,20})/.exec(location.search);
    if (source && from) source.value = from[1];

    form.querySelectorAll("[data-validate]").forEach(function (input) {
      input.addEventListener("input", function () {
        var field = input.closest(".field");
        if (field && field.classList.contains("has-error")) field.classList.remove("has-error");
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var box = statusBox(form);
      if (!validate(form)) {
        showStatus(box, "error", "Please fix the highlighted fields and try again.");
        return;
      }
      var btn = form.querySelector("button[type='submit']");
      var label = btn ? btn.innerHTML : "";
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

      function done() { if (btn) { btn.disabled = false; btn.innerHTML = label; } }

      if (isLocal) {
        setTimeout(function () {
          done();
          showStatus(box, "test", "<strong>Test mode:</strong> the form works, but nothing was sent because this is a local preview. On thestimuluscontrolroom.com this message will be emailed to contact@abaexamprepstudio.com.");
          form.reset();
          if (started) started.value = String(Math.floor(Date.now() / 1000));
        }, 600);
        return;
      }

      fetch(form.getAttribute("action"), {
        method: "POST",
        body: new FormData(form),
        headers: { "Accept": "application/json" }
      })
        .then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
        .then(function (data) {
          done();
          if (data && data.ok) {
            showStatus(box, "success", form.getAttribute("data-success") || "Thank you! Your message was sent.");
            form.reset();
          } else {
            showStatus(box, "error", (data && data.error ? data.error + " " : "Something went wrong. ") + 'You can also email us at <a href="mailto:contact@abaexamprepstudio.com">contact@abaexamprepstudio.com</a>.');
          }
        })
        .catch(function () {
          done();
          showStatus(box, "error", 'We couldn’t reach the server. Please try again, or email <a href="mailto:contact@abaexamprepstudio.com">contact@abaexamprepstudio.com</a>.');
        });
    });
  });

  /* Show a message after a no-JavaScript form post redirects back */
  var params = new URLSearchParams(location.search);
  if (params.has("sent")) {
    var form = document.querySelector("form[data-ajax]");
    if (form) showStatus(statusBox(form), params.get("sent") === "1" ? "success" : "error",
      params.get("sent") === "1" ? (form.getAttribute("data-success") || "Thank you! Your message was sent.") : "Sorry, your message could not be sent. Please email contact@abaexamprepstudio.com.");
  }
})();
