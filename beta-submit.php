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

const FAST_MINUTES = 25; // finishing faster than this is flagged as possible guessing

const DOMAINS = [
    'A' => 'Data Collection and Graphing',
    'B' => 'Behavior Assessment',
    'C' => 'Behavior Acquisition',
    'D' => 'Behavior Reduction',
    'E' => 'Documentation and Reporting',
    'F' => 'Ethics',
];

const SURVEY = [
    'q_rating' => ['label' => 'How well does this website provide the resources you need to prepare for and pass the RBT exam? (star rating)', 'options' => ['1', '2', '3', '4', '5']],
    'q1b' => ['label' => 'Have you taken the RBT exam before?', 'options' => ['No, this will be my first attempt', 'Yes, once', 'Yes, two or more times']],
    'q3' => ['label' => 'Which content areas did you find most difficult? (up to 2)', 'options' => ['A', 'B', 'C', 'D', 'E', 'F'], 'multi' => 2],
    'q4' => ['label' => 'How does this mock exam compare to other RBT practice exams you have taken?', 'options' => ['Much easier', 'Somewhat easier', 'About the same', 'Somewhat harder', 'Much harder', "I haven't taken any other practice exams"]],
    'q5' => ['label' => 'Were any questions or sections of this mock exam unclear or confusing?', 'options' => ['No', 'Yes']],
    'q6' => ['label' => 'What other resources would help you prepare for the exam?', 'options' => ['Online course', 'Mentorship (regularly scheduled 1:1 calls)', 'Flashcards or study apps', 'More practice exams', 'Study group', 'On-the-job experience', 'Other'], 'multi' => 7],
    'q7' => ['label' => 'How did you find this website?', 'options' => ['Google search', 'Instagram', 'TikTok', 'Facebook group', 'Reddit', 'YouTube', 'Supervisor or BCBA recommendation', 'Coworker or friend', 'Employer or ABA agency', 'AI assistant (ChatGPT, Claude, Gemini, etc.)', 'Other']],
    'q9' => ['label' => 'Permission to quote or share your feedback', 'options' => ['Yes, with my name', 'Yes, anonymously', 'No']],
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
        // Unanswered questions (only possible when time ran out) keep their answer and explanation hidden
        $hide = $given === '-';
        $review[] = ['n' => $q['n'], 'domain' => $q['domain'], 'task' => $q['task'], 'stem' => $q['stem'], 'options' => $q['options'],
            'your' => $given, 'answer' => $hide ? null : $q['answer'], 'rationale' => $hide ? null : $q['rationale'],
            'source' => $hide ? null : $q['source'], 'scored' => $q['scored']];
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

// Exams finished on paper (before the online version existed). Private file, one line per exam:
//   tester@example.com,1
function finishedOffline($email, $examId) {
    global $privateDir;
    $file = $privateDir . '/beta-exams/completed-offline.txt';
    if (!is_readable($file)) return false;
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $parts = array_map('trim', explode(',', strtolower($line)));
        if ($parts[0] === $email && (int) (isset($parts[1]) ? $parts[1] : 0) === $examId) return true;
    }
    return false;
}

// Exams are taken in order: exam N opens after exam N-1 is finished (online or on paper)
if ($examId > 1) {
    $prev = isset($all[$email . '|' . ($examId - 1)]) ? $all[$email . '|' . ($examId - 1)] : null;
    if ((!$prev || empty($prev['survey_submitted'])) && !finishedOffline($email, $examId - 1)) {
        fail('Please finish RBT Mock Exam ' . ($examId - 1) . ' first. Mock exams open one after another.');
    }
}
if (finishedOffline($email, $examId) && !$rec) {
    fail("Our records show you already completed {$exam['title']} on paper. Thank you! Please continue with RBT Mock Exam " . ($examId + 1) . '.');
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
    // Every question must be answered, unless the time limit has run out
    $blank = substr_count($answers, '-');
    $limit = (int) (isset($exam['time_limit_minutes']) ? $exam['time_limit_minutes'] : 90) * 60;
    $timeUp = time() - (int) $rec['started_ts'] >= $limit - 15;
    if ($blank && !$timeUp) fail("You still have $blank unanswered question" . ($blank === 1 ? '' : 's') . '. Please answer every question before submitting.');
    $rec['time_up'] = $timeUp && $blank > 0;
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
$comment = post('q8_comment', 2000);
$otherResource = post('q6_other', 200);
if ($survey['q5'] === 'Yes' && $unclear === '') fail('Please tell us which question numbers or sections were unclear and why.');
if (in_array('Other', $survey['q6'], true) && $otherResource === '') fail('Please specify the other resource that would help you.');
if ($survey['q7'] === 'Other' && $otherSource === '') fail('Please tell us how you heard about us.');

$rec['survey'] = $survey;
$rec['q5_detail'] = $unclear;
$rec['q7_other'] = $otherSource;
$rec['q6_other'] = $otherResource;
$rec['comment'] = $comment;
$rec['share_ok'] = $survey['q9'];
$rec['survey_submitted'] = gmdate('Y-m-d H:i') . ' UTC';
$res = results($exam, $rec);
$rec['score'] = $res['correct'] . '/' . $res['count'];
$rec['percent'] = $res['percent'];
$all[$id] = $rec;
save($store, $all);
flock($store, LOCK_UN);
fclose($store);

$minutes = isset($rec['minutes_used']) ? (int) $rec['minutes_used'] : null;
$fast = $minutes !== null && $minutes < FAST_MINUTES;
$flag = $fast ? "Possible guessing: finished in $minutes minutes (under " . FAST_MINUTES . ')' : '';
$dp = [];
$domainLines = '';
foreach ($res['domains'] as $d) {
    $dp[$d['d']] = (int) round($d['right'] / max(1, $d['total']) * 100);
    $domainLines .= sprintf("  %s. %s: %d of %d (%d%%)\n", $d['d'], $d['name'], $d['right'], $d['total'], $dp[$d['d']]);
}

// Survey spreadsheet (private)
$csv = $privateDir . '/beta-survey-responses.csv';
$isNew = !file_exists($csv) || filesize($csv) === 0 || trim((string) file_get_contents($csv)) === ''; // missing or emptied: add the header row
if ($out = @fopen($csv, 'a')) {
    flock($out, LOCK_EX);
    $tail = $isNew ? '' : (string) file_get_contents($csv, false, null, max(0, filesize($csv) - 1));
    if (!$isNew && $tail !== "\n") fwrite($out, "\n"); // hand-edited file without a final line break
    if ($isNew) {
        fputcsv($out, ['Date (UTC)', 'Email', 'First name', 'Exam', 'Score', 'Percent', 'Minutes used', 'Flag', 'A %', 'B %', 'C %', 'D %', 'E %', 'F %',
            'Site rating (1-5 stars)', 'Taken before?', 'Hardest areas', 'Compared to other practice exams', 'Unclear questions?', 'Which / why',
            'Resources that would help', 'Resources (other)', 'Found us via', 'Found us via (other)', 'Feedback', 'Permission to quote', 'Answers']);
    }
    $safe = function ($v) { return preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v; };
    $p = function ($d) use ($dp) { return isset($dp[$d]) ? $dp[$d] : ''; };
    fputcsv($out, [gmdate('Y-m-d H:i'), $safe($email), $safe($name), $exam['title'], $rec['score'], $res['percent'],
        $minutes !== null ? $minutes : '', $flag,
        $p('A'), $p('B'), $p('C'), $p('D'), $p('E'), $p('F'),
        $survey['q_rating'], $survey['q1b'], implode('; ', $survey['q3']), $survey['q4'], $survey['q5'], $safe($unclear),
        implode('; ', $survey['q6']), $safe($otherResource), $survey['q7'], $safe($otherSource), $safe($comment), $survey['q9'], $safe($rec['answers'])]);
    flock($out, LOCK_UN);
    fclose($out);
}

// Owner summary
$summary = ($fast ? "⚠ POSSIBLE GUESSING: they finished all {$total} questions in about $minutes minutes (under " . FAST_MINUTES . " minutes). You may want to disregard this feedback or follow up with them.\n\n" : '')
    . (!empty($rec['time_up']) ? "Note: time ran out before they answered every question.\n\n" : '')
    . "A beta tester finished {$exam['title']} and the survey. They saw their score and the full answer review on screen.\n\n"
    . 'Name:  ' . ($name !== '' ? $name : '(not given)') . "\nEmail: $email\n"
    . "Score: {$res['correct']} of {$res['count']} scored questions ({$res['percent']}%)"
    . (isset($rec['minutes_used']) ? "\nTime:  about {$rec['minutes_used']} minutes" : '') . "\n\nBy content area:\n$domainLines\n"
    . "SURVEY\n"
    . "1. Site rating: " . str_repeat('*', (int) $survey['q_rating']) . " ({$survey['q_rating']}/5)\n"
    . "2. Taken the RBT exam before: {$survey['q1b']}\n"
    . '3. Most difficult areas: ' . implode(', ', $survey['q3']) . "\n"
    . "4. Compared to other practice exams: {$survey['q4']}\n"
    . "5. Unclear questions or sections: {$survey['q5']}" . ($unclear !== '' ? "\n   $unclear" : '') . "\n"
    . '6. Resources that would help: ' . implode(', ', $survey['q6']) . ($otherResource !== '' ? " ($otherResource)" : '') . "\n"
    . "7. Found us via: {$survey['q7']}" . ($otherSource !== '' ? " ($otherSource)" : '') . "\n"
    . '8. Feedback: ' . ($comment !== '' ? "\n   $comment" : '(none)') . "\n"
    . "9. Permission to quote feedback: {$survey['q9']}" . ($survey['q9'] !== 'No' && $comment !== '' ? '  <-- possible testimonial' : '') . "\n\n"
    . "All survey responses are also saved in beta-survey-responses.csv (File manager, the folder above public_html).\n";
emailOwner(smtpPassword(), ($fast ? '⚠ FAST ' : '') . "Beta {$exam['title']}: {$res['correct']}/{$res['count']} ({$res['percent']}%) - " . ($name !== '' ? $name : $email), $summary, $email);

reply(true, ['status' => 'results', 'name' => $name, 'results' => $res]);
