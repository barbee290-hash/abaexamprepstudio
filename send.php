<?php
/**
 * ABA Exam Prep Studio — form handler
 * Emails feedback comments and waitlist sign-ups to the site owner.
 * Sends through the contact@ mailbox over SMTP (Hostinger), falls back to
 * PHP mail(), and as a last resort saves the message to a private file
 * outside public_html so nothing is lost. Returns JSON for fetch() requests,
 * or redirects back to the form page when JavaScript is off.
 *
 * The mailbox password is NOT in this file or in GitHub. It lives in
 * smtp-password.txt one folder ABOVE public_html (not reachable from the web).
 */

const TO_EMAIL   = 'contact@abaexamprepstudio.com';
// Must be a real mailbox on this domain, or Hostinger may reject or spam-filter the message
const FROM_EMAIL = 'contact@abaexamprepstudio.com';
const SITE_NAME  = 'ABA Exam Prep Studio';
const SMTP_HOST  = 'smtp.hostinger.com';
const SMTP_PORT  = 465;        // implicit SSL
const MAX_PER_WINDOW = 5;      // submissions allowed per IP...
const WINDOW_SECONDS = 600;    // ...in this many seconds
const MIN_FILL_SECONDS = 3;    // bots submit instantly

$privateDir = dirname(__DIR__); // folder above public_html
$wantsJson = isset($_SERVER['HTTP_ACCEPT']) && strpos($_SERVER['HTTP_ACCEPT'], 'application/json') !== false;
$formType  = (isset($_POST['form']) && $_POST['form'] === 'waitlist') ? 'waitlist' : 'feedback';
$backPage  = $formType === 'waitlist' ? 'full-exams.html' : 'feedback.html';

function respond($ok, $error = '', $via = '') {
    global $wantsJson, $backPage;
    if ($wantsJson) {
        header('Content-Type: application/json; charset=utf-8');
        if (!$ok) http_response_code(400);
        echo json_encode(['ok' => $ok, 'error' => $error, 'via' => $via]);
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

// Read one full SMTP reply (handles multi-line "250-..." replies); returns the status code
function smtpRead($fp) {
    $code = 0;
    while (($line = fgets($fp, 515)) !== false) {
        $code = (int) substr($line, 0, 3);
        if (strlen($line) < 4 || $line[3] !== '-') break;
    }
    return $code;
}

function smtpCmd($fp, $cmd, $expect) {
    fwrite($fp, $cmd . "\r\n");
    return smtpRead($fp) === $expect;
}

// Minimal authenticated SMTP send over SSL. Returns true on success.
function smtpSend($password, $to, $encodedSubject, $body, array $headers) {
    $fp = @stream_socket_client('ssl://' . SMTP_HOST . ':' . SMTP_PORT, $errno, $errstr, 15);
    if (!$fp) return false;
    stream_set_timeout($fp, 15);
    $host = isset($_SERVER['SERVER_NAME']) ? $_SERVER['SERVER_NAME'] : 'localhost';
    $ok = smtpRead($fp) === 220
        && smtpCmd($fp, 'EHLO ' . $host, 250)
        && smtpCmd($fp, 'AUTH LOGIN', 334)
        && smtpCmd($fp, base64_encode(FROM_EMAIL), 334)
        && smtpCmd($fp, base64_encode($password), 235)
        && smtpCmd($fp, 'MAIL FROM:<' . FROM_EMAIL . '>', 250)
        && smtpCmd($fp, 'RCPT TO:<' . $to . '>', 250)
        && smtpCmd($fp, 'DATA', 354);
    if ($ok) {
        $all = array_merge([
            'Date: ' . date('r'),
            'To: <' . $to . '>',
            'Subject: ' . $encodedSubject,
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@abaexamprepstudio.com>',
        ], $headers);
        $text = preg_replace('/\r\n|\r|\n/', "\r\n", $body);
        $text = preg_replace('/^\./m', '..', $text); // dot-stuffing
        fwrite($fp, implode("\r\n", $all) . "\r\n\r\n" . $text . "\r\n.\r\n");
        $ok = smtpRead($fp) === 250;
    }
    @fwrite($fp, "QUIT\r\n");
    fclose($fp);
    return $ok;
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

$encodedSubject = '=?UTF-8?B?' . base64_encode('[' . SITE_NAME . '] ' . $subject) . '?=';

// 1) SMTP through the real mailbox
$passFile = $privateDir . '/smtp-password.txt';
$password = is_readable($passFile) ? trim((string) @file_get_contents($passFile)) : '';
if ($password !== '' && smtpSend($password, TO_EMAIL, $encodedSubject, $body, $headers)) respond(true, '', 'smtp');

// 2) PHP mail() fallback
if (@mail(TO_EMAIL, $encodedSubject, $body, implode("\r\n", $headers), '-f' . FROM_EMAIL)) respond(true, '', 'mail');

// 3) Last resort: keep the message in a private file so it is never lost
$saved = @file_put_contents(
    $privateDir . '/form-backup.txt',
    "==== " . gmdate('Y-m-d H:i') . " UTC | $subject ====\n" . $body . "\n",
    FILE_APPEND | LOCK_EX
);
if ($saved) respond(true, '', 'saved');

respond(false, 'The server could not send your message.');
