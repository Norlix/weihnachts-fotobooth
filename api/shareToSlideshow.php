<?php

/** @var array $config */

require_once '../lib/boot.php';

use Photobooth\Service\CloudStorageService;
use Photobooth\Service\LoggerService;
use Photobooth\Service\SlideshowShareService;

header('Content-Type: application/json');

$logger = LoggerService::getInstance()->getLogger('main');
$logger->debug(basename($_SERVER['PHP_SELF']));

checkCsrfOrFail($_POST);

if (!$config['slideshowshare']['enabled']) {
    http_response_code(403);
    echo json_encode(['error' => 'Slideshow sharing is disabled.']);
    exit();
}

$file = basename((string) ($_POST['file'] ?? ''));
if (!SlideshowShareService::getInstance()->share($file)) {
    $logger->error('Sharing to slideshow failed', ['file' => $file]);
    http_response_code(400);
    echo json_encode(['error' => 'Picture could not be shared.']);
    exit();
}

CloudStorageService::getInstance()->enqueueShare($file);

$logger->info('Picture shared to slideshow', ['file' => $file]);
echo json_encode(['success' => true, 'file' => $file]);
