<?php

require_once '../lib/boot.php';

use Photobooth\Service\CloudStorageService;

header('Content-Type: application/json');
header('Cache-Control: no-store');

$file = basename((string) ($_GET['file'] ?? ''));
if ($file === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $file)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid file name.']);
    exit();
}

$cloud = CloudStorageService::getInstance();
$cloud->ensureWorker();

// The public address stays out of the answer, the QR code endpoint resolves it.
$status = $cloud->status($file);
unset($status['url']);
echo json_encode($status);
