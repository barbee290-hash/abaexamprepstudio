<?php
/**
 * The Stimulus Control Room — form handler
 * Emails feedback comments and waitlist sign-ups to the site owner.
 * Sends through the contact@ mailbox over SMTP (Hostinger), falls back to
 * PHP mail(), and as a last resort saves the message to a private file
 * outside public_html so nothing is lost. Returns JSON for fetch() requests,
 * or redirects back to the form page when JavaScript is off.
 *
 * Beta mock exam: the first BETA_SPOTS waitlist sign-ups are emailed the
 * welcome letter with the mock exam PDF attached and a link to beta.html,
 * where they submit answers, take the survey, and get their results.
 * Later sign-ups get a "beta testing complete + 25% Founders Discount" email.
 *
 * Private files live one folder ABOVE public_html (not reachable from the web),
 * and are NOT in GitHub:
 *   smtp-password.txt           the contact@ mailbox password
 *   beta-exams/<BETA_EXAM_FILE> the mock exam PDF sent to beta testers
 */

require __DIR__ . '/mailer.php';

const MAX_PER_WINDOW = 5;      // submissions allowed per IP...
const WINDOW_SECONDS = 600;    // ...in this many seconds
const MIN_FILL_SECONDS = 3;    // bots submit instantly
const BETA_SPOTS = 30;
const BETA_EXAM_FILE = 'RBT_Mock_Exam_1.pdf';
const BETA_EXAM_ID = 1;

$wantsJson = isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false;
$formType  = (isset($_POST['form']) && $_POST['form'] === 'waitlist') ? 'waitlist' : 'feedback';
$backPage  = $formType === 'waitlist' ? 'full-exams.html' : 'feedback.html';
$userMessage = ''; // optional success message shown on the page instead of the form's default

function respond($ok, $error = '', $via = '') {
    global $wantsJson, $backPage, $userMessage;
    if ($wantsJson) {
        header('Content-Type: application/json; charset=utf-8');
        if (!$ok) http_response_code(400);
        echo json_encode(['ok' => $ok, 'error' => $error, 'via' => $via, 'message' => $ok ? $userMessage : '']);
    } else {
        header('Location: ' . $backPage . '?sent=' . ($ok ? '1' : '0'), true, 303);
    }
    exit;
}

function field($key, $max) {
    $v = isset($_POST[$key]) ? trim((string) $_POST[$key]) : '';
    $v = str_replace("\0", '', $v);
    return function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
}

// Welcome letter for beta testers (from "Welcome Beta Full Mock Exam.docx")
function betaWelcomeText($name, $email) {
    $hi = $name !== '' ? "Hi $name," : 'Hi there,';
    $link = 'https://' . SITE_URL . '/beta.html?exam=' . BETA_EXAM_ID . '&email=' . rawurlencode($email);
    return $hi . "\n\n"
        . "Thank you so much for volunteering to be a beta tester for The Stimulus Control Room's full RBT mock exam! "
        . "Your feedback is invaluable in making sure this resource is as clear, realistic, and effective as possible.\n\n"
        . "To help capture your genuine test-taking experience and initial instincts before seeing the results, "
        . "we are splitting the feedback process into two brief stages:\n\n"
        . "1. Attached is the RBT Mock Exam (Questions Only) along with an Answer Sheet. "
        . "Please complete the exam, then submit your answers at this link:\n"
        . "   $link\n\n"
        . "2. As soon as you submit your answers, a short Phase 1 Survey will appear on the same page, asking about "
        . "your overall impression of the questions, difficulty level, and exam flow.\n\n"
        . "3. As soon as you submit that brief survey, your full Answer Key & Detailed Explanations will be emailed to you, "
        . "along with your calculated score so you don't have to score it yourself!\n\n"
        . "Thank you again for your time and insight. Good luck with the exam, and I look forward to your feedback!\n\n"
        . signature();
}

function waitlistFullText($name) {
    $hi = $name !== '' ? "Hi $name," : 'Hi there,';
    return $hi . "\n\n"
        . "Thank you for signing up to help shape our full-length RBT mock exams! We're sorry, but our beta testing "
        . "is now complete, and all " . BETA_SPOTS . " free beta tester spots have been filled.\n\n"
        . "The Stimulus Control Room has noted your interest in beta testing our future mock exams. Once the mock exam "
        . "is finalized, we'll send out a notification, and you'll be among the first to know. As a thank-you, you'll "
        . "also receive our Founders Discount of 25% off.\n\n"
        . "In the meantime, you can keep practicing with our free RBT practice test, section quizzes, and SAFMEDS "
        . "flashcards at https://" . SITE_URL . "\n\n"
        . signature();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: index.html', true, 303);
    exit;
}

// Honeypot: humans never see or fill this field. Pretend success for bots, but keep
// a copy in the private backup file in case browser autofill tripped it.
// ('website' is the old field name, still sent by cached copies of the pages.)
if (field('zx_check', 200) !== '' || field('website', 200) !== '') {
    @file_put_contents(
        $privateDir . '/form-backup.txt',
        '==== ' . gmdate('Y-m-d H:i') . " UTC | BLOCKED AS POSSIBLE BOT ($formType) ====\n"
            . 'Email: ' . oneLine(field('email', 200)) . "\n" . field('message', 2000) . "\n\n",
        FILE_APPEND | LOCK_EX
    );
    respond(true);
}

// Too-fast submissions are almost always bots
$started = (int) field('started', 20);
if ($started > 0 && (time() - $started) < MIN_FILL_SECONDS) respond(false, 'Please take a moment and try again.');

if (!withinRateLimit('aep_rate', MAX_PER_WINDOW, WINDOW_SECONDS)) respond(false, 'Too many messages. Please wait a few minutes.');

$name    = oneLine(field('name', 100));
$email   = oneLine(field('email', 200));
$rating  = (int) field('rating', 1);
$topic   = oneLine(field('topic', 60));
$message = field('message', 5000);

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) respond(false, 'Please enter a valid email address.');

$password = smtpPassword();

if ($formType === 'waitlist') {
    if ($email === '') respond(false, 'Please enter your email address.');
    // Running sign-up list for Excel / Google Sheets (private, above public_html)
    // Where they signed up from, e.g. "quiz-c", "mock", "practice-test", "youtube"
    $source = preg_replace('/[^a-z0-9-]/', '', strtolower(field('source', 30)));
    if ($source === '') $source = 'full-exams-page';
    $csvFile = $privateDir . '/waitlist-signups.csv';
    $isNew = !file_exists($csvFile);
    $existing = $isNew ? '' : (string) @file_get_contents($csvFile);
    $repeat = $existing !== '' && stripos($existing, ',' . $email . ',') !== false;
    // Sign-up number = earlier sign-ups (header and repeat rows not counted) + this one
    $rows = $existing === '' ? [] : array_slice(explode("\n", trim($existing)), 1);
    $number = 1 + count(array_filter($rows, function ($r) { return stripos($r, 'Repeat sign-up') === false; }));
    $isBeta = !$repeat && $number <= BETA_SPOTS;
    if ($fh = @fopen($csvFile, 'a')) {
        flock($fh, LOCK_EX);
        if ($isNew) fputcsv($fh, ['#', 'Date (UTC)', 'Time (UTC)', 'Email', 'First name', 'Signed up from', 'Offer']);
        // Leading = + - @ would be read as a formula by spreadsheets
        $cell = function ($v) { return preg_match('/^[=+\-@]/', $v) ? "'" . $v : $v; };
        $offer = $repeat ? 'Repeat sign-up' : ($isBeta ? 'Free beta mock exam (first ' . BETA_SPOTS . ')' : 'Waitlist + 25% Founders Discount');
        fputcsv($fh, [$repeat ? '' : $number, gmdate('Y-m-d'), gmdate('H:i'), $cell($email), $cell($name), $source, $offer]);
        flock($fh, LOCK_UN);
        fclose($fh);
    }

    // Email the visitor: beta testers get the welcome letter + exam PDF; later sign-ups get a waitlist note
    $examPath = $privateDir . '/beta-exams/' . BETA_EXAM_FILE;
    $visitorStatus = 'Not emailed (repeat sign-up).';
    if ($isBeta) {
        if (!is_readable($examPath)) {
            $visitorStatus = 'NOT SENT: the exam PDF is missing from the beta-exams folder on the server. Please email it to them yourself.';
        } elseif ($password !== '' && emailVisitor($password, $email, 'Your free RBT Mock Exam from ' . SITE_NAME, betaWelcomeText($name, $email), $examPath)) {
            $visitorStatus = 'Welcome letter + ' . BETA_EXAM_FILE . ' sent to them automatically.';
            $userMessage = "You're beta tester #$number! We just emailed you the mock exam. Check your inbox (and your spam folder, just in case).";
        } else {
            $visitorStatus = 'NOT SENT: the email could not be sent. Please email the exam to them yourself.';
        }
        if ($userMessage === '') $userMessage = "You're beta tester #$number! We'll email you the mock exam shortly.";
    } elseif (!$repeat) {
        $sentFull = $password !== '' && emailVisitor($password, $email, "Beta testing is complete: your 25% Founders Discount - " . SITE_NAME, waitlistFullText($name));
        $visitorStatus = $sentFull ? '"Beta testing complete + 25% Founders Discount" email sent to them. Remember to honor the 25% discount at launch.' : 'Waitlist email could not be sent.';
        $userMessage = "Thank you! Our beta testing is complete, but you're on our list for future beta testing, and you'll get our 25% Founders Discount when the full mock exam launches. Check your inbox for details.";
    } else {
        $userMessage = "You're already signed up! Check your inbox (and spam folder) for our earlier email.";
    }

    $subject = $repeat ? 'Repeat sign-up - Free beta mock exam'
        : ($isBeta ? "Free beta tester #$number of " . BETA_SPOTS . " - add to spreadsheet" : "New waitlist sign-up #$number (after first " . BETA_SPOTS . ") - add to spreadsheet");
    $body  = $repeat ? "This email address has signed up before (no new spot used).\n\n"
        : ($isBeta ? "New beta tester #$number of " . BETA_SPOTS . " for the free full-length RBT mock exam.\nThey get the full 85-question mock exam free in exchange for honest feedback.\n\n"
                   : "New sign-up #$number. The " . BETA_SPOTS . " free spots are filled, so this person is on the regular waitlist.\n\n");
    $body .= 'Name:        ' . ($name !== '' ? $name : '(not given)') . "\n";
    $body .= "Email:       $email\n";
    $body .= "Signed up:   " . gmdate('Y-m-d H:i') . " UTC\n";
    $body .= "Signed up from: $source\n";
    $body .= "Their email: $visitorStatus\n\n";
    $body .= "Tip: click Reply to email this customer directly.\n";
} else {
    $len = function_exists('mb_strlen') ? mb_strlen($message) : strlen($message);
    if ($len < 10) respond(false, 'Please write a slightly longer comment.');
    $allowedTopics = ['Practice questions', 'Report an error', 'Suggestion', 'Website', 'Other'];
    if (!in_array($topic, $allowedTopics, true)) $topic = 'Other';
    $subject = 'New feedback: ' . $topic;
    $body  = "New feedback from the website.\n\n";
    $body .= 'Name:   ' . ($name !== '' ? $name : '(not given)') . "\n";
    $body .= 'Email:  ' . ($email !== '' ? $email : '(not given)') . "\n";
    $body .= 'Rating: ' . ($rating >= 1 && $rating <= 5 ? str_repeat('*', $rating) . " ($rating/5)" : '(not given)') . "\n";
    $body .= "Topic:  $topic\n\n";
    $body .= "Message:\n$message\n";
}

$body .= "\n--\nSent from the " . SITE_NAME . " website on " . gmdate('Y-m-d H:i') . " UTC.\n";

// 1) SMTP through the real mailbox, 2) PHP mail() fallback
$via = emailOwner($password, $subject, $body, $email);
if ($via !== '') respond(true, '', $via);

// 3) Last resort: keep the message in a private file so it is never lost
$saved = @file_put_contents(
    $privateDir . '/form-backup.txt',
    "==== " . gmdate('Y-m-d H:i') . " UTC | $subject ====\n" . $body . "\n",
    FILE_APPEND | LOCK_EX
);
if ($saved) respond(true, '', 'saved');

respond(false, 'The server could not send your message.');
