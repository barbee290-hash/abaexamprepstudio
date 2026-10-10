<?php
/**
 * The Stimulus Control Room — online beta mock exams: exam -> survey -> results.
 * Used by beta.html (JSON in, JSON out). Only people on the beta list can use it.
 *
 *   action=start    Checks the email, then returns the exam questions (no answers),
 *                   or the survey / results if the tester already got that far.
 *   action=answers  Saves the tester's answers.
 *   action=survey   Saves the Phase 1 survey, scores the exam, and returns the results
 *                   (score, by content area, and every question with its explanation).
 *
 * Private files, one folder ABOVE public_html (not in GitHub):
 *   waitlist-signups.csv          beta list (written by send.php)
 *   beta-exams/exam-N.json        exam N: questions, answers, explanations, scored flags
 *   beta-data/responses.json      saved answers, survey, and scores (created automatically)
 *   beta-survey-responses.csv     one row per completed exam, for Excel / Google Sheets
 */

require __DIR__ . '/mailer.php';

header('Content-Type: application/json; charset=utf-8');

function reply($ok, array $extra = []) {
    if (!$ok) http_response_code(400);
    echo json_encode(array_merge(['ok' => $ok], $extra), JSON_UNESCAPED_UNICODE);
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

function loadExam($id) {
    global $privateDir;
    $file = $privateDir . "/beta-exams/exam-$id.json";
    $exam = is_readable($file) ? json_decode((string) file_get_contents($file), true) : null;
    return ($exam && !empty($exam['questions'])) ? $exam : null;
}

// Score a saved answer string against an exam; returns everything the results screen needs
function results(array $exam, array $rec) {
    $answers = $rec['answers'];
    $correct = 0; $count = 0; $byDomain = []; $review = [];
    foreach ($exam['questions'] as $i => $q) {
        $given = isset($answers[$i]) ? $answers[$i] : '-';
        $ok = $given === $q['answer'];
        if ($q['scored']) {
            $count++;
            $d = $q['domain'];
            if (!isset($byDomain[$d])) $byDomain[$d] = ['d' => $d, 'name' => array_key_exists($d, DOMAINS) ? DOMAINS[$d] : $d, 'right' => 0, 'total' => 0];
            $byDomain[$d]['total']++;
            if ($ok) { $correct++; $byDomain[$d]['right']++; }
        }
        $review[] = ['n' => $q['n'], 'domain' => $q['domain'], 'task' => $q['task'], 'stem' => $q['stem'], 'options' => $q['options'],
            'your' => $given, 'answer' => $q['answer'], 'rationale' => $q['rationale'], 'source' => $q['source'], 'scored' => $q['scored']];
    }
    ksort($byDomain);
    $next = loadExam($exam['exam'] + 1) ? ['id' => $exam['exam'] + 1, 'title' => 'RBT Mock Exam ' . ($exam['exam'] + 1)] : null;
    return ['title' => $exam['title'], 'correct' => $correct, 'count' => $count, 'total' => count($exam['questions']),
        'percent' => (int) round($correct / max(1, $count) * 100), 'domains' => array_values($byDomain), 'review' => $review, 'next' => $next];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Invalid request.');
if (!withinRateLimit('scr_beta', 40, 600)) fail('Too many attempts. Please wait a few minutes and try again.');

$action = post('action', 20);
$email  = strtolower(oneLine(post('email', 200)));
$examId = (int) post('exam', 3);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter the email address you used to sign up.');
if ($examId < 1 || $examId > 9) fail('Unknown exam.');

$exam = loadExam($examId);
if (!$exam) fail('This exam is not open yet. Please email ' . FROM_EMAIL . '.');
$total = count($exam['questions']);

// Must be on the beta list (first 30 sign-ups)
$name = '';
$onList = false;
if (($fh = @fopen($privateDir . '/waitlist-signups.csv', 'r')) !== false) {
    fgetcsv($fh); // header
    while (($row = fgetcsv($fh)) !== false) {
        if (count($row) < 7) continue;
        if (strtolower(ltrim(trim($row[3]), "'")) === $email && stripos($row[6], 'Free beta') === 0) {
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

// Exams are taken in order: exam N opens after exam N-1 is finished
if ($examId > 1) {
    $prev = isset($all[$email . '|' . ($examId - 1)]) ? $all[$email . '|' . ($examId - 1)] : null;
    if (!$prev || empty($prev['survey_submitted'])) fail('Please finish RBT Mock Exam ' . ($examId - 1) . ' first. Mock exams open one after another.');
}

if ($rec && !empty($rec['survey_submitted'])) {
    reply(true, ['status' => 'results', 'name' => $name, 'results' => results($exam, $rec)]);
}

if ($action === 'start') {
    if ($rec && !empty($rec['answers'])) reply(true, ['status' => 'survey', 'name' => $name]);
    if (!$rec) {
        $all[$id] = ['email' => $email, 'name' => $name, 'exam' => $examId, 'started' => gmdate('Y-m-d H:i') . ' UTC', 'started_ts' => time()];
        save($store, $all);
        $rec = $all[$id];
    }
    $questions = array_map(function ($q) {
        return ['n' => $q['n'], 'domain' => $q['domain'], 'task' => $q['task'], 'stem' => $q['stem'], 'options' => $q['options']];
    }, $exam['questions']);
    $limit = (int) (isset($exam['time_limit_minutes']) ? $exam['time_limit_minutes'] : 90) * 60;
    reply(true, ['status' => 'exam', 'name' => $name, 'title' => $exam['title'], 'questions' => $questions,
        'time_limit' => $limit, 'elapsed' => max(0, time() - (int) $rec['started_ts'])]);
}

if ($action === 'answers') {
    if ($rec && !empty($rec['answers'])) reply(true, ['status' => 'survey']);
    $answers = strtoupper(preg_replace('/[^A-Da-d-]/', '', post('answers', 200)));
    if (strlen($answers) !== $total) fail('Something went wrong reading your answers. Please try again.');
    if (!$rec) $rec = ['email' => $email, 'name' => $name, 'exam' => $examId, 'started_ts' => time()];
    $rec['answers'] = $answers;
    $rec['answers_submitted'] = gmdate('Y-m-d H:i') . ' UTC';
    $rec['minutes_used'] = (int) round((time() - (int) $rec['started_ts']) / 60);
    $all[$id] = $rec;
    save($store, $all);
    reply(true, ['status' => 'survey']);
}

if ($action !== 'survey') fail('Invalid request.');
if (!$rec || empty($rec['answers'])) fail('Please finish the exam first.');

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

$rec['survey'] = $survey;
$rec['q5_detail'] = $unclear;
$rec['q7_other'] = $otherSource;
$rec['survey_submitted'] = gmdate('Y-m-d H:i') . ' UTC';
$res = results($exam, $rec);
$rec['score'] = $res['correct'] . '/' . $res['count'];
$rec['percent'] = $res['percent'];
$all[$id] = $rec;
save($store, $all);
flock($store, LOCK_UN);
fclose($store);

$dp = [];
$domainLines = '';
foreach ($res['domains'] as $d) {
    $dp[$d['d']] = (int) round($d['right'] / max(1, $d['total']) * 100);
    $domainLines .= sprintf("  %s. %s: %d of %d (%d%%)\n", $d['d'], $d['name'], $d['right'], $d['total'], $dp[$d['d']]);
}

// Survey spreadsheet (private)
$csv = $privateDir . '/beta-survey-responses.csv';
$isNew = !file_exists($csv);
if ($out = @fopen($csv, 'a')) {
    flock($out, LOCK_EX);
    if ($isNew) {
        fputcsv($out, ['Date (UTC)', 'Email', 'First name', 'Exam', 'Score', 'Percent', 'Minutes used', 'A %', 'B %', 'C %', 'D %', 'E %', 'F %',
            'Exam scheduled', 'Expected score', 'Hardest areas', 'Compared to real exam', 'Unclear questions?', 'Which / why',
            'How prepared', 'Heard about us', 'Heard about us (other)', 'Answers']);
    }
    $safe = function ($v) { return preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v; };
    $p = function ($d) use ($dp) { return isset($dp[$d]) ? $dp[$d] : ''; };
    fputcsv($out, [gmdate('Y-m-d H:i'), $safe($email), $safe($name), $exam['title'], $rec['score'], $res['percent'],
        isset($rec['minutes_used']) ? $rec['minutes_used'] : '',
        $p('A'), $p('B'), $p('C'), $p('D'), $p('E'), $p('F'),
        $survey['q1'], $survey['q2'], implode('; ', $survey['q3']), $survey['q4'], $survey['q5'], $safe($unclear),
        implode('; ', $survey['q6']), $survey['q7'], $safe($otherSource), $safe($rec['answers'])]);
    flock($out, LOCK_UN);
    fclose($out);
}

// Owner summary
$summary = "A beta tester finished {$exam['title']} and the survey. They saw their score and the full answer review on screen.\n\n"
    . 'Name:  ' . ($name !== '' ? $name : '(not given)') . "\nEmail: $email\n"
    . "Score: {$res['correct']} of {$res['count']} scored questions ({$res['percent']}%)"
    . (isset($rec['minutes_used']) ? "\nTime:  about {$rec['minutes_used']} minutes" : '') . "\n\nBy content area:\n$domainLines\n"
    . "PHASE 1 SURVEY\n"
    . "1. Exam scheduled: {$survey['q1']}\n"
    . "2. Expected score: {$survey['q2']}\n"
    . '3. Hardest areas: ' . implode(', ', $survey['q3']) . "\n"
    . "4. Compared to real exam: {$survey['q4']}\n"
    . "5. Unclear questions: {$survey['q5']}" . ($unclear !== '' ? "\n   $unclear" : '') . "\n"
    . '6. How prepared: ' . implode(', ', $survey['q6']) . "\n"
    . "7. Heard about us: {$survey['q7']}" . ($otherSource !== '' ? " ($otherSource)" : '') . "\n\n"
    . "All survey responses are also saved in beta-survey-responses.csv (File manager, the folder above public_html).\n";
emailOwner(smtpPassword(), "Beta {$exam['title']}: {$res['correct']}/{$res['count']} ({$res['percent']}%) - " . ($name !== '' ? $name : $email), $summary, $email);

reply(true, ['status' => 'results', 'name' => $name, 'results' => $res]);
