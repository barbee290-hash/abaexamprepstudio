/* The Stimulus Control Room — printable SAFMEDS cards (3" x 6") */
(function () {
  "use strict";

  var form = document.getElementById("print-options");
  var area = document.getElementById("print-area");
  var summary = document.getElementById("print-summary");
  if (!form || !area || !window.AEP_TERMS) return;

  var TERMS = window.AEP_TERMS;
  var SECTIONS = window.AEP_SECTIONS;
  var pageStyle = document.createElement("style");
  pageStyle.id = "print-page-size";
  document.head.appendChild(pageStyle);

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function val(name) { var el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null; }

  // Preselect a deck from ?deck=
  var q = (new URLSearchParams(location.search).get("deck") || "").toUpperCase();
  if (q && (q === "ALL" || SECTIONS[q])) {
    var r = form.querySelector('input[name="deck"][value="' + q + '"]');
    if (r) r.checked = true;
  }

  function front(c) {
    return '<div class="pcard pcard-front"><span class="pc-tag">' + c.s + " · " + esc(SECTIONS[c.s]) + '</span>' +
      '<span class="pc-term">' + esc(c.t) + '</span><span class="pc-brand">The Stimulus Control Room · SAFMEDS</span></div>';
  }
  function back(c) {
    return '<div class="pcard pcard-back"><span class="pc-tag">' + esc(c.t) + '</span>' +
      '<span class="pc-def">' + esc(c.d) + '</span><span class="pc-brand">thestimuluscontrolroom.com</span></div>';
  }

  function render() {
    var deck = val("deck"), format = val("format"), sides = val("sides");
    var cards = deck === "ALL" ? TERMS : TERMS.filter(function (c) { return c.s === deck; });
    var html = "", pages = 0;

    if (format === "cards") {
      // One card per 6" x 3" page. For double-sided, each front is followed by its back.
      pageStyle.textContent = "@page { size: 6in 3in; margin: 0; }";
      cards.forEach(function (c) {
        if (sides !== "backs") { html += '<section class="ppage ppage-card">' + front(c) + "</section>"; pages++; }
        if (sides !== "fronts") { html += '<section class="ppage ppage-card">' + back(c) + "</section>"; pages++; }
      });
    } else {
      // Letter paper, 3 cards per sheet with cut lines. Back sheets follow each front sheet.
      pageStyle.textContent = "@page { size: letter portrait; margin: 0.5in 1.25in; }";
      for (var i = 0; i < cards.length; i += 3) {
        var group = cards.slice(i, i + 3);
        if (sides !== "backs") { html += '<section class="ppage ppage-sheet">' + group.map(front).join("") + "</section>"; pages++; }
        if (sides !== "fronts") { html += '<section class="ppage ppage-sheet">' + group.map(back).join("") + "</section>"; pages++; }
      }
    }
    area.className = "print-area format-" + format;
    area.innerHTML = html;
    if (summary) {
      summary.textContent = cards.length + " cards → " + pages + " printed " + (format === "cards" ? "index card" + (pages === 1 ? "" : "s") : "sheet" + (pages === 1 ? "" : "s")) +
        (sides === "both" ? " (fronts and backs)" : sides === "fronts" ? " (fronts only)" : " (backs only)");
    }
    var link = document.getElementById("time-this-deck");
    if (link) link.href = "safmeds.html?deck=" + deck;
  }

  form.addEventListener("change", render);
  var btn = document.getElementById("print-btn");
  if (btn) btn.addEventListener("click", function () { window.print(); });
  render();
})();
