<?php

declare(strict_types=1);

/*
 * The Stimulus Control Room
 * Secure Lemon Squeezy download page
 *
 * ls-config.php and the downloads folder must be
 * one level ABOVE public_html.
 *
 * Folder layout expected above public_html:
 *   downloads/
 *     RBT-Mock-Exam-1.pdf
 *     study-guide/          ← all concept PDFs go here
 *       Concept-01-....pdf
 *       Concept-02-....pdf
 *       ...
 *
 * Success URL in Lemon Squeezy checkout:
 *   https://thestimuluscontrolroom.com/download.php?order_id={order_id}
 */


/* -------------------------------------------------------
   Products
   type 'files'  → serve each named file as a separate link
   type 'zip'    → zip every .pdf inside folder/ and send one download
------------------------------------------------------- */

$products = [

    'RBT Single Mock Exam' => [
        'type'  => 'files',
        'files' => ['RBT-Mock-Exam-1.pdf'],
    ],

    'RBT 3rd Edition Test Content Study Guide' => [
        'type'    => 'zip',
        'folders' => ['study-guide'],
        'zipname' => 'RBT-3rd-Edition-Study-Guide.zip',
    ],

    'RBT Study Guide & SAFEMEDS' => [
        'type'    => 'zip',
        'folders' => ['study-guide', 'safmeds'],
        'zipname' => 'RBT-Study-Guide-and-SAFMEDS.zip',
    ],

];


/* -------------------------------------------------------
   Error-page function (defined first so it is always
   available, even during bootstrap)
------------------------------------------------------- */

function showError(string $message, string $email = ''): void
{
    $safeMessage = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
    $safeEmail   = htmlspecialchars($email,   ENT_QUOTES, 'UTF-8');

    http_response_code(403);

    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>Download unavailable</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 700px; margin: 60px auto; padding: 25px; line-height: 1.6; }
            .box { border: 1px solid #ddd; border-radius: 12px; padding: 30px; }
        </style>
    </head>
    <body>
    <div class="box">
        <h1>Download unavailable</h1>
        <p><?= $safeMessage ?></p>
        <?php if ($safeEmail): ?>
            <p>If you believe this is an error, contact
               <a href="mailto:<?= $safeEmail ?>"><?= $safeEmail ?></a>.</p>
        <?php endif; ?>
    </div>
    </body>
    </html>
    <?php
    exit;
}


/* -------------------------------------------------------
   Lemon Squeezy API helper
------------------------------------------------------- */

function lsGet(string $url, string $key): array
{
    $ch = curl_init($url);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $key,
            'Accept: application/vnd.api+json',
        ],
        CURLOPT_TIMEOUT => 15,
    ]);

    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($response === false) {
        curl_close($ch);
        throw new RuntimeException('Unable to contact payment provider.');
    }

    curl_close($ch);

    $data = json_decode($response, true);

    if ($status < 200 || $status >= 300 || !is_array($data)) {
        throw new RuntimeException('Payment provider could not verify this purchase.');
    }

    return $data;
}


/* -------------------------------------------------------
   Download-count helpers (max 10 per order)
------------------------------------------------------- */

function getDownloadCount(string $stateFile): int
{
    if (!is_file($stateFile)) {
        return 0;
    }

    $data = json_decode((string)file_get_contents($stateFile), true);

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
    $data     = $contents ? json_decode($contents, true) : [];
    $count    = (int)($data['downloads'] ?? 0);

    if ($count >= 10) {
        flock($handle, LOCK_UN);
        fclose($handle);
        return $count;
    }

    $count++;
    $data = ['downloads' => $count, 'updated' => time()];

    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($data, JSON_PRETTY_PRINT));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);

    return $count;
}


/* -------------------------------------------------------
   ZIP helper — bundles every .pdf in $sourceDir and
   streams it to the browser, then removes the temp file
------------------------------------------------------- */

function streamZip(array $sourceDirs, string $zipFilename): void
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('ZIP support is not available on this server.');
    }

    $tmp = tempnam(sys_get_temp_dir(), 'scr_') . '.zip';

    $zip = new ZipArchive();

    if ($zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('Could not create ZIP archive.');
    }

    $added = 0;

    foreach ($sourceDirs as $sourceDir) {
        $pdfs = glob(rtrim($sourceDir, '/') . '/*.pdf') ?: [];
        foreach ($pdfs as $pdf) {
            // Put files from each folder into a subfolder inside the ZIP
            // so names from different folders never collide
            $folderName = basename($sourceDir);
            $zip->addFile($pdf, $folderName . '/' . basename($pdf));
            $added++;
        }
    }

    $zip->close();

    if ($added === 0) {
        @unlink($tmp);
        throw new RuntimeException('No files found to package.');
    }

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $zipFilename) . '"');
    header('Content-Length: ' . filesize($tmp));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store');

    readfile($tmp);

    @unlink($tmp);
    exit;
}


/* -------------------------------------------------------
   Bootstrap: config + paths
------------------------------------------------------- */

$root = dirname(__DIR__);

$configFile  = $root . '/ls-config.php';
$downloadDir = $root . '/downloads';

if (!is_file($configFile)) {
    http_response_code(500);
    exit('Configuration file not found.');
}

ob_start();
$config = require $configFile;
ob_end_clean();

if (!is_array($config)) {
    http_response_code(500);
    exit('Configuration file is not set up correctly.');
}

$lsApiKey     = $config['ls_api_key']    ?? '';
$contactEmail = $config['contact_email'] ?? '';

if (!$lsApiKey) {
    http_response_code(500);
    exit('Payment configuration is incomplete.');
}


/* -------------------------------------------------------
   Get and validate order ID
------------------------------------------------------- */

$orderId = $_GET['order_id'] ?? '';

if (!$orderId || !preg_match('/^\d+$/', $orderId)) {
    showError('We could not find a valid order.', $contactEmail);
}


/* -------------------------------------------------------
   Verify order with Lemon Squeezy
------------------------------------------------------- */

$createdAt   = 0;
$productName = '';

try {

    $orderData = lsGet(
        'https://api.lemonsqueezy.com/v1/orders/' .
        rawurlencode($orderId) .
        '?include=order-items',
        $lsApiKey
    );

    $attrs = $orderData['data']['attributes'] ?? [];

    if (($attrs['status'] ?? '') !== 'paid') {
        showError('This order has not been confirmed as paid.', $contactEmail);
    }

    $createdAt = strtotime((string)($attrs['created_at'] ?? ''));

    if (!$createdAt || time() > $createdAt + (7 * 24 * 60 * 60)) {
        showError('This download link has expired.', $contactEmail);
    }

    foreach (($orderData['included'] ?? []) as $item) {
        if (($item['type'] ?? '') === 'order-items') {
            $productName = trim((string)($item['attributes']['product_name'] ?? ''));
            break;
        }
    }

} catch (Throwable $e) {
    showError('We were unable to verify your purchase.', $contactEmail);
}


/* -------------------------------------------------------
   Map order to product definition
------------------------------------------------------- */

$product = $products[$productName] ?? null;

if (!$product) {
    showError(
        'We could not match this order to a download package.',
        $contactEmail
    );
}


/* -------------------------------------------------------
   Download-count state file
------------------------------------------------------- */

$stateDir = $downloadDir . '/.download-state';

if (!is_dir($stateDir)) {
    @mkdir($stateDir, 0700, true);
}

$stateFile = $stateDir . '/' . hash('sha256', $orderId) . '.json';


/* -------------------------------------------------------
   Handle an actual download request
------------------------------------------------------- */

$isFileRequest = isset($_GET['file']);
$isZipRequest  = isset($_GET['zip']);

if ($isFileRequest || $isZipRequest) {

    if (getDownloadCount($stateFile) >= 10) {
        showError('This order has reached its 10-download limit.', $contactEmail);
    }

    // --- individual file (mock exam) ---
    if ($isFileRequest && $product['type'] === 'files') {

        $requested = basename((string)$_GET['file']);

        if (!in_array($requested, $product['files'], true)) {
            showError('That file is not included with this order.', $contactEmail);
        }

        $filePath = $downloadDir . '/' . $requested;

        if (!is_file($filePath)) {
            showError('The requested file could not be found.', $contactEmail);
        }

        try {
            incrementDownloadCount($stateFile);
        } catch (Throwable $e) {
            showError('We could not authorize this download.', $contactEmail);
        }

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $requested) . '"');
        header('Content-Length: ' . filesize($filePath));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');

        readfile($filePath);
        exit;
    }

    // --- ZIP folder(s) (study guide / bundle) ---
    if ($isZipRequest && $product['type'] === 'zip') {

        $sourceDirs = array_map(
            fn($f) => $downloadDir . '/' . $f,
            $product['folders']
        );

        foreach ($sourceDirs as $dir) {
            if (!is_dir($dir)) {
                showError('A download folder could not be found.', $contactEmail);
            }
        }

        try {
            incrementDownloadCount($stateFile);
            streamZip($sourceDirs, $product['zipname']);
        } catch (Throwable $e) {
            showError('We could not prepare your download: ' . $e->getMessage(), $contactEmail);
        }
    }

    // Request type doesn't match product type
    showError('Invalid download request.', $contactEmail);
}


/* -------------------------------------------------------
   Show download page
------------------------------------------------------- */

$count            = getDownloadCount($stateFile);
$remaining        = max(0, 10 - $count);
$expiresFormatted = date('F j, Y', $createdAt + (7 * 24 * 60 * 60));

$safeOrderId     = urlencode($orderId);
$safeProductName = htmlspecialchars($productName, ENT_QUOTES, 'UTF-8');

?>
<!DOCTYPE html>

<html lang="en">

<head>

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
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

        h1 { margin-top: 0; }

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

        .download:hover { background: #f1f1f1; }

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

    <p>Your payment has been verified.</p>

    <h2><?= $safeProductName ?></h2>

    <?php if ($product['type'] === 'files'): ?>

        <p>Your available files:</p>

        <?php foreach ($product['files'] as $file): ?>
            <a
                class="download"
                href="?order_id=<?= $safeOrderId ?>&amp;file=<?= urlencode($file) ?>"
            >
                Download <?= htmlspecialchars($file, ENT_QUOTES, 'UTF-8') ?>
            </a>
        <?php endforeach; ?>

    <?php elseif ($product['type'] === 'zip'): ?>

        <p>Your purchase includes all concept PDFs bundled into a single ZIP file.</p>

        <a
            class="download"
            href="?order_id=<?= $safeOrderId ?>&amp;zip=1"
        >
            Download <?= htmlspecialchars($product['zipname'], ENT_QUOTES, 'UTF-8') ?>
        </a>

    <?php endif; ?>

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
            <p>Need help?
               <a href="mailto:<?= htmlspecialchars($contactEmail, ENT_QUOTES, 'UTF-8') ?>">
                   Contact us
               </a>.
            </p>
        <?php endif; ?>

    </div>

</div>

</body>

</html>
