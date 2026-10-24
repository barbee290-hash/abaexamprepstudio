<?php

declare(strict_types=1);

/*
 * The Stimulus Control Room
 * Secure Stripe download page
 *
 * stripe-config.php and the downloads folder must be
 * one level ABOVE public_html.
 */

$root = dirname(__DIR__);

$configFile  = $root . '/stripe-config.php';
$downloadDir = $root . '/downloads';

if (!is_file($configFile)) {
    http_response_code(500);
    exit('Configuration file not found.');
}

ob_start(); // never echo the config file, even if it is missing its <?php tag
$config = require $configFile;
ob_end_clean();

if (!is_array($config)) {
    http_response_code(500);
    exit('Configuration file is not set up correctly.');
}

$stripeKey    = $config['stripe_key'] ?? '';
$contactEmail = $config['contact_email'] ?? '';

if (!$stripeKey) {
    http_response_code(500);
    exit('Stripe configuration is incomplete.');
}

/*
 * These names must match the product names in Stripe.
 *
 * Change PDF filenames here if your actual files have
 * different names.
 */
$products = [
    'RBT Single Mock Exam' => [
        'RBT-Mock-Exam-1.pdf',
    ],

    'RBT 3-Exam Pack' => [
        'RBT-Mock-Exam-1.pdf',
        'RBT-Mock-Exam-2.pdf',
        'RBT-Mock-Exam-3.pdf',
    ],

    'RBT Exams + Study Guide Bundle' => [
        'RBT-Mock-Exam-1.pdf',
        'RBT-Mock-Exam-2.pdf',
        'RBT-Mock-Exam-3.pdf',
    ],
];


/* -------------------------------------------------------
   Stripe API helper
------------------------------------------------------- */

function stripeGet(string $url, string $key): array
{
    $ch = curl_init($url);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $key,
        ],
        CURLOPT_TIMEOUT => 15,
    ]);

    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($response === false) {
        curl_close($ch);
        throw new RuntimeException('Unable to contact Stripe.');
    }

    curl_close($ch);

    $data = json_decode($response, true);

    if ($status < 200 || $status >= 300 || !is_array($data)) {
        throw new RuntimeException('Stripe could not verify this purchase.');
    }

    return $data;
}


/* -------------------------------------------------------
   Get Checkout Session ID
------------------------------------------------------- */

$sessionId = $_GET['session_id'] ?? '';

if (
    !$sessionId ||
    !preg_match('/^cs_(test|live)_[A-Za-z0-9]+$/', $sessionId)
) {
    showError(
        'We could not find a valid purchase session.',
        $contactEmail
    );
}


/* -------------------------------------------------------
   Verify purchase with Stripe
------------------------------------------------------- */

try {

    $session = stripeGet(
        'https://api.stripe.com/v1/checkout/sessions/' .
        rawurlencode($sessionId),
        $stripeKey
    );

    /*
     * Never release files unless Stripe says payment
     * is actually paid.
     */
    if (($session['payment_status'] ?? '') !== 'paid') {
        showError(
            'This payment has not been confirmed as paid.',
            $contactEmail
        );
    }

    /*
     * Download access expires 7 days after purchase.
     */
    $created = (int)($session['created'] ?? 0);
    $expires = $created + (7 * 24 * 60 * 60);

    if (!$created || time() > $expires) {
        showError(
            'This download link has expired.',
            $contactEmail
        );
    }

    /*
     * Ask Stripe what was purchased.
     */
    $lineItems = stripeGet(
        'https://api.stripe.com/v1/checkout/sessions/' .
        rawurlencode($sessionId) .
        '/line_items?limit=10',
        $stripeKey
    );

} catch (Throwable $e) {

    showError(
        'We were unable to verify your purchase with Stripe.',
        $contactEmail
    );
}


/* -------------------------------------------------------
   Determine purchased tier
------------------------------------------------------- */

$allowedFiles = [];
$productName  = '';

foreach (($lineItems['data'] ?? []) as $item) {

    $description = trim((string)($item['description'] ?? ''));

    if (isset($products[$description])) {
        $productName  = $description;
        $allowedFiles = $products[$description];
        break;
    }
}

if (!$allowedFiles) {
    showError(
        'We could not match this purchase to a download package.',
        $contactEmail
    );
}


/* -------------------------------------------------------
   Download-count tracking
   Maximum: 10 downloads per purchase
------------------------------------------------------- */

$stateDir = $downloadDir . '/.download-state';

if (!is_dir($stateDir)) {
    @mkdir($stateDir, 0700, true);
}

$stateFile = $stateDir . '/' . hash('sha256', $sessionId) . '.json';


function getDownloadCount(string $stateFile): int
{
    if (!is_file($stateFile)) {
        return 0;
    }

    $data = json_decode(
        (string)file_get_contents($stateFile),
        true
    );

    return (int)($data['downloads'] ?? 0);
}


function incrementDownloadCount(string $stateFile): int
{
    $handle = fopen($stateFile, 'c+');

    if (!$handle) {
        throw new RuntimeException('Unable to record download.');
    }

    flock($handle, LOCK_EX);

    rewind($handle);
    $contents = stream_get_contents($handle);

    $data = $contents
        ? json_decode($contents, true)
        : [];

    $count = (int)($data['downloads'] ?? 0);

    if ($count >= 10) {
        flock($handle, LOCK_UN);
        fclose($handle);
        return $count;
    }

    $count++;

    $data = [
        'downloads' => $count,
        'updated'   => time(),
    ];

    ftruncate($handle, 0);
    rewind($handle);

    fwrite(
        $handle,
        json_encode($data, JSON_PRETTY_PRINT)
    );

    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return $count;
}


/* -------------------------------------------------------
   Handle an actual file download
------------------------------------------------------- */

if (isset($_GET['file'])) {

    $requested = basename((string)$_GET['file']);

    if (!in_array($requested, $allowedFiles, true)) {
        showError(
            'That file is not included with this purchase.',
            $contactEmail
        );
    }

    $filePath = $downloadDir . '/' . $requested;

    if (!is_file($filePath)) {
        showError(
            'The requested file could not be found.',
            $contactEmail
        );
    }

    $currentCount = getDownloadCount($stateFile);

    if ($currentCount >= 10) {
        showError(
            'This purchase has reached its 10-download limit.',
            $contactEmail
        );
    }

    try {
        incrementDownloadCount($stateFile);
    } catch (Throwable $e) {
        showError(
            'We could not authorize this download.',
            $contactEmail
        );
    }

    header('Content-Type: application/pdf');
    header(
        'Content-Disposition: attachment; filename="' .
        str_replace('"', '', $requested) .
        '"'
    );
    header('Content-Length: ' . filesize($filePath));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');

    readfile($filePath);
    exit;
}


/* -------------------------------------------------------
   Show download page
------------------------------------------------------- */

$count     = getDownloadCount($stateFile);
$remaining = max(0, 10 - $count);

$expiresFormatted = date(
    'F j, Y',
    $expires
);


/* -------------------------------------------------------
   Error-page function
------------------------------------------------------- */

function showError(string $message, string $email = ''): void
{
    $safeMessage = htmlspecialchars(
        $message,
        ENT_QUOTES,
        'UTF-8'
    );

    $safeEmail = htmlspecialchars(
        $email,
        ENT_QUOTES,
        'UTF-8'
    );

    http_response_code(403);

    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport"
              content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>Download unavailable</title>

        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 700px;
                margin: 60px auto;
                padding: 25px;
                line-height: 1.6;
            }

            .box {
                border: 1px solid #ddd;
                border-radius: 12px;
                padding: 30px;
            }
        </style>
    </head>

    <body>

    <div class="box">

        <h1>Download unavailable</h1>

        <p><?= $safeMessage ?></p>

        <?php if ($safeEmail): ?>

            <p>
                If you believe this is an error,
                contact
                <a href="mailto:<?= $safeEmail ?>">
                    <?= $safeEmail ?>
                </a>.
            </p>

        <?php endif; ?>

    </div>

    </body>
    </html>
    <?php

    exit;
}

?>
<!DOCTYPE html>

<html lang="en">

<head>

    <meta charset="UTF-8">

    <meta name="viewport"
          content="width=device-width, initial-scale=1">

    <meta name="robots" content="noindex">

    <title>Your RBT Downloads</title>

    <style>

        body {
            font-family: Arial, sans-serif;
            background: #f7f7f7;
            color: #222;
            margin: 0;
            padding: 40px 20px;
        }

        .container {
            max-width: 760px;
            margin: auto;
            background: white;
            padding: 35px;
            border-radius: 14px;
            box-shadow: 0 4px 18px rgba(0,0,0,.08);
        }

        h1 {
            margin-top: 0;
        }

        .download {
            display: block;
            padding: 15px 18px;
            margin: 12px 0;
            border: 1px solid #ddd;
            border-radius: 8px;
            text-decoration: none;
            color: #111;
            font-weight: bold;
        }

        .download:hover {
            background: #f1f1f1;
        }

        .details {
            margin-top: 25px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #555;
        }

    </style>

</head>

<body>

<div class="container">

    <h1>Thank you for your purchase!</h1>

    <p>
        Your payment has been verified.
    </p>

    <h2>
        <?= htmlspecialchars(
            $productName,
            ENT_QUOTES,
            'UTF-8'
        ) ?>
    </h2>

    <p>Your available files:</p>

    <?php foreach ($allowedFiles as $file): ?>

        <a
            class="download"
            href="?session_id=<?= urlencode($sessionId) ?>&amp;file=<?= urlencode($file) ?>"
        >
            Download
            <?= htmlspecialchars(
                $file,
                ENT_QUOTES,
                'UTF-8'
            ) ?>
        </a>

    <?php endforeach; ?>

    <div class="details">

        <p>
            <strong>Downloads remaining:</strong>
            <?= $remaining ?> of 10
        </p>

        <p>
            <strong>Download access expires:</strong>
            <?= htmlspecialchars($expiresFormatted) ?>
        </p>

        <?php if ($contactEmail): ?>

            <p>
                Need help?
                <a href="mailto:<?= htmlspecialchars(
                    $contactEmail,
                    ENT_QUOTES,
                    'UTF-8'
                ) ?>">
                    Contact us
                </a>.
            </p>

        <?php endif; ?>

    </div>

</div>

</body>

</html>
