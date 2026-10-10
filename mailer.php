<?php
/**
 * The Stimulus Control Room — shared email helpers for send.php and beta-submit.php.
 * Sends through the contact@ mailbox over SMTP (Hostinger). The mailbox password
 * lives in smtp-password.txt one folder ABOVE public_html (not in GitHub).
 * Visiting this file directly does nothing.
 */

if (!defined('SITE_NAME')) {
    define('TO_EMAIL', 'contact@thestimuluscontrolroom.com');
    // Must be a real mailbox on this domain, or Hostinger may reject or spam-filter the message
    define('FROM_EMAIL', 'contact@thestimuluscontrolroom.com');
    define('SITE_NAME', 'The Stimulus Control Room');
    define('SITE_URL', 'thestimuluscontrolroom.com');
    define('SMTP_HOST', 'smtp.hostinger.com');
    define('SMTP_PORT', 465); // implicit SSL
}

$privateDir = dirname(__DIR__); // folder above public_html

// Header-safe single-line text (prevents email header injection)
function oneLine($v) {
    return trim(preg_replace('/[\r\n\t]+/', ' ', $v));
}

function encodeSubject($s) {
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

function smtpPassword() {
    global $privateDir;
    $passFile = $privateDir . '/smtp-password.txt';
    return is_readable($passFile) ? trim((string) @file_get_contents($passFile)) : '';
}

// Simple per-IP rate limit; returns false when the visitor is over the limit
function withinRateLimit($bucket, $max, $windowSeconds) {
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
    $rateFile = rtrim(sys_get_temp_dir(), '/\\') . '/' . $bucket . '_' . md5($ip);
    $hits = [];
    if (is_readable($rateFile)) {
        $hits = array_filter(array_map('intval', explode(',', (string) @file_get_contents($rateFile))), function ($t) use ($windowSeconds) {
            return $t > time() - $windowSeconds;
        });
    }
    if (count($hits) >= $max) return false;
    $hits[] = time();
    @file_put_contents($rateFile, implode(',', $hits), LOCK_EX);
    return true;
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
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . SITE_URL . '>',
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

// Email a visitor from contact@ (plain text, optional PDF attachment or list of attachments).
// Returns true on success.
function emailVisitor($password, $to, $subject, $text, $attach = '') {
    $files = array_values(array_filter((array) $attach, function ($f) { return $f !== '' && is_readable($f); }));
    $headers = [
        'From: ' . SITE_NAME . ' <' . FROM_EMAIL . '>',
        'Reply-To: ' . FROM_EMAIL,
        'MIME-Version: 1.0',
    ];
    if (!$files) {
        $headers[] = 'Content-Type: text/plain; charset=UTF-8';
        $headers[] = 'Content-Transfer-Encoding: 8bit';
        $body = $text;
    } else {
        $boundary = 'scr_' . bin2hex(random_bytes(8));
        $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
        $body  = "--$boundary\r\n";
        $body .= "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
        $body .= chunk_split(base64_encode(str_replace("\n", "\r\n", str_replace("\r\n", "\n", $text))));
        foreach ($files as $file) {
            $body .= "--$boundary\r\n";
            $body .= 'Content-Type: application/pdf; name="' . basename($file) . "\"\r\n";
            $body .= "Content-Transfer-Encoding: base64\r\n";
            $body .= 'Content-Disposition: attachment; filename="' . basename($file) . "\"\r\n\r\n";
            $body .= chunk_split(base64_encode((string) file_get_contents($file)));
        }
        $body .= "--$boundary--";
    }
    return smtpSend($password, $to, encodeSubject($subject), $body, $headers);
}

// Email the site owner (Reply-To set to the visitor when known). Falls back to PHP mail().
function emailOwner($password, $subject, $body, $replyTo = '') {
    $headers   = [];
    $headers[] = 'From: ' . SITE_NAME . ' <' . FROM_EMAIL . '>';
    if ($replyTo !== '') $headers[] = 'Reply-To: ' . $replyTo;
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
    $headers[] = 'Content-Transfer-Encoding: 8bit';
    $encoded = encodeSubject('[' . SITE_NAME . '] ' . $subject);
    if ($password !== '' && smtpSend($password, TO_EMAIL, $encoded, $body, $headers)) return 'smtp';
    if (@mail(TO_EMAIL, $encoded, $body, implode("\r\n", $headers), '-f' . FROM_EMAIL)) return 'mail';
    return '';
}

function signature() {
    return "Best regards,\n\nJeanne Barbee, MS, BCBA, LBA\nFounder, " . SITE_NAME . "\n" . FROM_EMAIL . "\nhttps://" . SITE_URL . "\n";
}
