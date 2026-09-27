<?php
/**
 * ABA Exam Prep Studio — form handler
 * Emails feedback comments and waitlist sign-ups to the site owner.
 * Runs on Hostinger (PHP mail()). Returns JSON for fetch() requests,
 * or redirects back to the form page when JavaScript is off.
 */

const TO_EMAIL   = 'contact@abaexamprepstudio.com';
// Must be a real mailbox on this domain, or Hostinger may reject or spam-filter the message
const FROM_EMAIL = 'contact@abaexamprepstudio.com';
const SITE_NAME  = 'ABA Exam Prep Studio';
const MAX_PER_WINDOW = 5;      // submissions allowed per IP...
const WINDOW_SECONDS = 600;    // ...in this many seconds
const MIN_FILL_SECONDS = 3;    // bots submit instantly

$wantsJson = isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false;
$formType  = (isset($_POST['form']) && $_POST['form'] === 'waitlist') ? 'waitlist' : 'feedback';
$backPage  = $formType === 'waitlist' ? 'full-exams.html' : 'feedback.html';

function respond($ok, $error = '') {
    global $wantsJson, $backPage;
    if ($wantsJson) {
        header('Content-Type: application/json; charset=utf-8');
        if (!$ok) http_response_code(400);
        echo json_encode(['ok' => $ok, 'error' => $error]);
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

// Header-safe single-line text (prevents email header injection)
function oneLine($v) {
    return trim(preg_replace('/[\r\n\t]+/', ' ', $v));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: index.html', true, 303);
    exit;
}

// Honeypot: humans never see or fill this field. Pretend success for bots.
if (field('website', 200) !== '') respond(true);

// Too-fast submissions are almost always bots
$started = (int) field('started', 20);
if ($started > 0 && (time() - $started) < MIN_FILL_SECONDS) respond(false, 'Please take a moment and try again.');

// Simple per-IP rate limit
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
$rateFile = rtrim(sys_get_temp_dir(), '/\\') . '/aep_rate_' . md5($ip);
$hits = [];
if (is_readable($rateFile)) {
    $hits = array_filter(array_map('intval', explode(',', (string) @file_get_contents($rateFile))), function ($t) {
        return $t > time() - WINDOW_SECONDS;
    });
}
if (count($hits) >= MAX_PER_WINDOW) respond(false, 'Too many messages. Please wait a few minutes.');
$hits[] = time();
@file_put_contents($rateFile, implode(',', $hits), LOCK_EX);

$name    = oneLine(field('name', 100));
$email   = oneLine(field('email', 200));
$rating  = (int) field('rating', 1);
$topic   = oneLine(field('topic', 60));
$message = field('message', 5000);

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) respond(false, 'Please enter a valid email address.');

if ($formType === 'waitlist') {
    if ($email === '') respond(false, 'Please enter your email address.');
    $subject = 'Full-exam waitlist sign-up';
    $body = "New waitlist sign-up for full-length RBT exams.\n\nEmail: $email\n";
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

$headers   = [];
$headers[] = 'From: ' . SITE_NAME . ' <' . FROM_EMAIL . '>';
if ($email !== '') $headers[] = 'Reply-To: ' . $email;
$headers[] = 'MIME-Version: 1.0';
$headers[] = 'Content-Type: text/plain; charset=UTF-8';
$headers[] = 'Content-Transfer-Encoding: 8bit';
$headers[] = 'X-Mailer: PHP/' . phpversion();

$encodedSubject = '=?UTF-8?B?' . base64_encode('[' . SITE_NAME . '] ' . $subject) . '?=';
$sent = @mail(TO_EMAIL, $encodedSubject, $body, implode("\r\n", $headers), '-f' . FROM_EMAIL);

respond($sent, $sent ? '' : 'The server could not send your message.');
