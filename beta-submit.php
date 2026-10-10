<?php
/**
 * The Stimulus Control Room — beta mock exam: answers -> survey -> results.
 * Used by beta.html (JSON in, JSON out).
 *
 *   action=answers  Saves the tester's 85 answers (only people on the beta list).
 *   action=survey   Saves the Phase 1 survey, scores the exam, and emails the tester
 *                   their score plus the Answer Key & Explanations PDF.
 *
 * Private files, one folder ABOVE public_html (not in GitHub):
 *   waitlist-signups.csv              beta list (written by send.php)
 *   beta-exams/exam-N-key.json        answer key for exam N (answers, domains, scored, pdf)
 *   beta-exams/<answer key PDF>       named in the key file
 *   beta-data/responses.json          saved answers, survey, and scores (created automatically)
 *   beta-survey-responses.csv         one row per completed tester, for Excel / Google Sheets
 */

require __DIR__ . '/mailer.php';

header('Content-Type: application/json; charset=utf-8');

function reply($ok, array $extra = []) {
    if (!$ok) http_response_code(400);
    echo json_encode(array_merge(['ok' => $ok], $extra));
    exit;
}

function fail($message) {
    reply(false, ['error' => $message]);
}

function post($key, $max = 200) {
    $v = isset($_POST[$key]) && !is_array($_POST[$key]) ? trim((string) $_POST[$key]) : '';
    return mb_substr(str_replace("\0", '', $v), 0, $max);
}

function postList($key) {
    $v = isset($_POST[$key]) && is_array($_POST[$key]) ? $_POST[$key] : [];
    return array_values(array_unique(array_map(function ($x) { return trim((string) $x); }, $v)));
}

const DOMAINS = [
    'A' => 'Data Collection and Graphing',
    'B' => 'Behavior Assessment',
    'C' => 'Behavior Acquisition',
    'D' => 'Behavior Reduction',
    'E' => 'Documentation and Reporting',
    'F' => 'Ethics',
];

const SURVEY = [
    'q1' => ['label' => 'When is your RBT exam scheduled?', 'options' => ['Within 2 weeks', '2–4 weeks', '1–3 months', 'Not scheduled yet', 'Already taken and did not pass. Retaking.']],
    'q2' => ['label' => 'What score do you expect on this mock exam?', 'options' => ['Below 60%', '60–69%', '70–79%', '80–89%', '90% or higher']],
    'q3' => ['label' => 'Which content area felt hardest? (up to 2)', 'options' => ['A', 'B', 'C', 'D', 'E', 'F'], 'multi' => 2],
    'q4' => ['label' => 'Compared to the real exam, this mock exam felt', 'options' => ['Much easier', 'Somewhat easier', 'About the same', 'Somewhat harder', 'Much harder', 'Not sure']],
    'q5' => ['label' => 'Were any questions unclear or confusing?', 'options' => ['No', 'Yes']],
    'q6' => ['label' => 'How have you prepared so far?', 'options' => ['40-hour training only', 'Supervisor or BCBA review', 'Flashcards or apps', 'Other practice exams', 'Study group', 'On-the-job experience only'], 'multi' => 6],
    'q7' => ['label' => 'How did you hear about us?', 'options' => ['Google search', 'Instagram', 'TikTok', 'Facebook group', 'Reddit', 'YouTube', 'Supervisor or BCBA recommendation', 'Coworker or friend', 'Employer or ABA agency', 'Other']],
];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Invalid request.');
if (!withinRateLimit('scr_beta', 20, 600)) fail('Too many attempts. Please wait a few minutes and try again.');

$action = post('action', 20);
$email  = strtolower(oneLine(post('email', 200)));
$examId = (int) post('exam', 3);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter the email address you used to sign up.');
if ($examId < 1 || $examId > 9) fail('Unknown exam.');

// Answer key (private)
$keyFile = $privateDir . "/beta-exams/exam-$examId-key.json";
$key = is_readable($keyFile) ? json_decode((string) file_get_contents($keyFile), true) : null;
if (!$key || empty($key['answers'])) fail('This exam is not open for submissions yet. Please email ' . FROM_EMAIL . '.');
$total = strlen($key['answers']);

// Must be on the beta list (first 30 sign-ups)
$name = '';
$onList = false;
$csvFile = $privateDir . '/waitlist-signups.csv';
if (($fh = @fopen($csvFile, 'r')) !== false) {
    fgetcsv($fh); // header
    while (($row = fgetcsv($fh)) !== false) {
        if (count($row) < 7) continue;
        $rowEmail = strtolower(ltrim(trim($row[3]), "'"));
        if ($rowEmail === $email && stripos($row[6], 'Free beta') === 0) {
            $onList = true;
            $name = ltrim(trim($row[4]), "'");
            break;
        }
    }
    fclose($fh);
}
if (!$onList) fail("We couldn't find that email on our beta tester list. Please use the same email address you signed up with, or email " . FROM_EMAIL . '.');

// Saved responses (private), locked for the rest of the request
$dataDir = $privateDir . '/beta-data';
if (!is_dir($dataDir)) @mkdir($dataDir, 0750, true);
$store = fopen($dataDir . '/responses.json', 'c+');
if (!$store) fail('The server could not save your answers. Please email ' . FROM_EMAIL . '.');
flock($store, LOCK_EX);
$all = json_decode((string) stream_get_contents($store), true);
if (!is_array($all)) $all = [];
$id = $email . '|' . $examId;
$rec = isset($all[$id]) ? $all[$id] : null;

function save($store, array $all) {
    ftruncate($store, 0);
    rewind($store);
    fwrite($store, json_encode($all, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($store);
}

$password = smtpPassword();
$examTitle = isset($key['title']) ? $key['title'] : "RBT Mock Exam $examId";

if ($rec && !empty($rec['results_sent'])) {
    reply(true, ['status' => 'done', 'message' => 'You have already completed this exam. Your results were emailed to you on ' . substr($rec['results_sent'], 0, 10) . '. Check your inbox and spam folder, or email ' . FROM_EMAIL . ' if you need them resent.']);
}

if ($action === 'answers') {
    if ($rec && !empty($rec['answers'])) reply(true, ['status' => 'survey', 'message' => 'We already have your answers. Please complete the short survey below to get your results.']);
    $answers = strtoupper(preg_replace('/[^A-Da-d-]/', '', post('answers', 200)));
    if (strlen($answers) !== $total) fail('Something went wrong reading your answer sheet. Please try again.');
    $all[$id] = [
        'email' => $email, 'name' => $name, 'exam' => $examId,
        'answers' => $answers, 'answers_submitted' => gmdate('Y-m-d H:i') . ' UTC',
    ];
    save($store, $all);
    $blank = substr_count($answers, '-');
    emailOwner($password, "Beta answers received - $examTitle",
        "A beta tester submitted their answer sheet.\n\nName:  " . ($name !== '' ? $name : '(not given)') . "\nEmail: $email\nExam:  $examTitle\n"
        . "Blank answers: $blank of $total\n\nThey now see the Phase 1 survey. Their score and answer key are emailed to them automatically when they finish it.\n",
        $email);
    reply(true, ['status' => 'survey']);
}

if ($action !== 'survey') fail('Invalid request.');
if (!$rec || empty($rec['answers'])) fail('Please submit your answer sheet first.');

// Validate the survey
$survey = [];
foreach (SURVEY as $q => $def) {
    if (!empty($def['multi'])) {
        $picked = array_values(array_intersect($def['options'], postList($q)));
        if (!$picked) fail('Please answer: ' . $def['label']);
        if (count($picked) > $def['multi']) fail('Please choose no more than ' . $def['multi'] . ' for: ' . $def['label']);
        $survey[$q] = $picked;
    } else {
        $v = post($q, 100);
        if (!in_array($v, $def['options'], true)) fail('Please answer: ' . $def['label']);
        $survey[$q] = $v;
    }
}
$unclear = post('q5_detail', 2000);
$otherSource = post('q7_other', 200);
if ($survey['q5'] === 'Yes' && $unclear === '') fail('Please tell us which question numbers were unclear and why.');
if ($survey['q7'] === 'Other' && $otherSource === '') fail('Please tell us how you heard about us.');

// Score
$answers = $rec['answers'];
$scored = isset($key['scored']) && is_array($key['scored']) ? array_map('intval', $key['scored']) : range(1, $total);
$correct = 0;
$byDomain = [];
$missed = [];
for ($n = 1; $n <= $total; $n++) {
    if (!in_array($n, $scored, true)) continue;
    $right = $key['answers'][$n - 1];
    $given = $answers[$n - 1];
    $dom = isset($key['domains'][(string) $n]) ? $key['domains'][(string) $n] : '?';
    if (!isset($byDomain[$dom])) $byDomain[$dom] = [0, 0];
    $byDomain[$dom][1]++;
    if ($given === $right) {
        $correct++;
        $byDomain[$dom][0]++;
    } else {
        $missed[] = $n . ' (' . ($given === '-' ? 'blank' : "you chose $given") . ", correct: $right)";
    }
}
$count = count($scored);
$pct = (int) round($correct / max(1, $count) * 100);
ksort($byDomain);

$domainLines = '';
foreach ($byDomain as $d => $c) {
    $domainLines .= sprintf("  %s. %s: %d of %d (%d%%)\n", $d, array_key_exists($d, DOMAINS) ? DOMAINS[$d] : $d, $c[0], $c[1], round($c[0] / max(1, $c[1]) * 100));
}

// Email the tester their results + answer key PDF
$hi = $name !== '' ? "Hi $name," : 'Hi there,';
$text = $hi . "\n\n"
    . "Thank you for completing the survey! Your feedback is a huge help. Here are your results for $examTitle:\n\n"
    . "YOUR SCORE: $correct of $count correct ($pct%)\n\n"
    . "By content area:\n$domainLines\n"
    . ($missed ? "Questions to review:\n  " . implode("\n  ", $missed) . "\n\n" : "You answered every scored question correctly. Outstanding work!\n\n")
    . "Your full Answer Key & Detailed Explanations are attached. Start with the questions above, and focus your study on your lowest content area.\n\n"
    . "Thank you again for helping shape our mock exams. Good luck on your RBT exam!\n\n"
    . signature();
$pdf = !empty($key['answer_key_pdf']) ? $privateDir . '/beta-exams/' . basename($key['answer_key_pdf']) : '';
$attach = ($pdf !== '' && is_readable($pdf)) ? $pdf : '';
$sent = $password !== '' && emailVisitor($password, $email, "Your $examTitle results - " . SITE_NAME, $text, $attach);

$rec['survey'] = $survey;
$rec['q5_detail'] = $unclear;
$rec['q7_other'] = $otherSource;
$rec['survey_submitted'] = gmdate('Y-m-d H:i') . ' UTC';
$rec['score'] = "$correct/$count";
$rec['percent'] = $pct;
if ($sent) $rec['results_sent'] = gmdate('Y-m-d H:i') . ' UTC';
$all[$id] = $rec;
save($store, $all);
flock($store, LOCK_UN);
fclose($store);

// Survey spreadsheet (private)
$csv = $privateDir . '/beta-survey-responses.csv';
$isNew = !file_exists($csv);
if ($out = @fopen($csv, 'a')) {
    flock($out, LOCK_EX);
    if ($isNew) {
        fputcsv($out, ['Date (UTC)', 'Email', 'First name', 'Exam', 'Score', 'Percent', 'A %', 'B %', 'C %', 'D %', 'E %', 'F %',
            'Exam scheduled', 'Expected score', 'Hardest areas', 'Compared to real exam', 'Unclear questions?', 'Which / why',
            'How prepared', 'Heard about us', 'Heard about us (other)', 'Answers']);
    }
    $dp = function ($d) use ($byDomain) { return isset($byDomain[$d]) ? round($byDomain[$d][0] / max(1, $byDomain[$d][1]) * 100) : ''; };
    $safe = function ($v) { return preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v; };
    fputcsv($out, [gmdate('Y-m-d H:i'), $safe($email), $safe($name), $examTitle, "$correct/$count", $pct,
        $dp('A'), $dp('B'), $dp('C'), $dp('D'), $dp('E'), $dp('F'),
        $survey['q1'], $survey['q2'], implode('; ', $survey['q3']), $survey['q4'], $survey['q5'], $safe($unclear),
        implode('; ', $survey['q6']), $survey['q7'], $safe($otherSource), $safe($answers)]);
    flock($out, LOCK_UN);
    fclose($out);
}

// Owner summary
$summary = "A beta tester finished the survey" . ($sent ? ' and was emailed their results and answer key.' : '. THEIR RESULTS EMAIL COULD NOT BE SENT. Please email them their score and the answer key.') . "\n\n"
    . 'Name:  ' . ($name !== '' ? $name : '(not given)') . "\nEmail: $email\nExam:  $examTitle\n"
    . "Score: $correct of $count ($pct%)\n\nBy content area:\n$domainLines\n"
    . "PHASE 1 SURVEY\n"
    . "1. Exam scheduled: {$survey['q1']}\n"
    . "2. Expected score: {$survey['q2']}\n"
    . '3. Hardest areas: ' . implode(', ', $survey['q3']) . "\n"
    . "4. Compared to real exam: {$survey['q4']}\n"
    . "5. Unclear questions: {$survey['q5']}" . ($unclear !== '' ? "\n   $unclear" : '') . "\n"
    . '6. How prepared: ' . implode(', ', $survey['q6']) . "\n"
    . "7. Heard about us: {$survey['q7']}" . ($otherSource !== '' ? " ($otherSource)" : '') . "\n\n"
    . "All survey responses are also saved in beta-survey-responses.csv (File manager, the folder above public_html).\n";
emailOwner($password, "Beta survey + results: $correct/$count ($pct%) - " . ($name !== '' ? $name : $email), $summary, $email);

if (!$sent) {
    reply(true, ['status' => 'done', 'message' => "Thank you! Your survey was received. We had trouble emailing your results automatically, so Jeanne will email your score and answer key to you personally within 1–2 days."]);
}
reply(true, ['status' => 'done', 'score' => "$correct of $count", 'percent' => $pct,
    'message' => "Thank you! Your results and the full Answer Key & Detailed Explanations have been emailed to you. Check your inbox (and your spam folder, just in case)."]);
