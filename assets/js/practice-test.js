/* ABA Exam Prep Studio — free RBT practice test page.
   Answers and explanations are in the HTML (so search engines can read them);
   this script only adds click-to-check and a running score. */
(function () {
  "use strict";
  var cards = document.querySelectorAll(".pt-q");
  var scoreBox = document.querySelector(".pt-score");
  var scoreText = document.getElementById("pt-score-text");
  if (!cards.length) return;
  var answered = 0, correct = 0;

  function updateScore() {
    if (!scoreBox) return;
    scoreBox.hidden = false;
    scoreText.innerHTML = "<strong>You’ve answered " + answered + " of " + cards.length + " questions: " + correct + " correct.</strong>" +
      (answered === cards.length ? ' Nice work! Keep going with the <a href="/quiz.html?set=mock">free 20-question RBT mock exam</a>.' : "");
  }

  cards.forEach(function (card) {
    var right = parseInt(card.getAttribute("data-correct"), 10);
    var options = card.querySelectorAll(".option");
    var details = card.querySelector(".pt-answer");
    options.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (card.classList.contains("is-answered")) return;
        card.classList.add("is-answered");
        var k = parseInt(btn.getAttribute("data-k"), 10);
        btn.setAttribute("aria-pressed", "true");
        options.forEach(function (b) {
          var i = parseInt(b.getAttribute("data-k"), 10);
          if (i === right) b.classList.add("correct");
          else if (i === k) b.classList.add("incorrect");
          b.disabled = true;
        });
        answered++;
        if (k === right) correct++;
        if (details) details.open = true;
        updateScore();
      });
    });
  });
})();
