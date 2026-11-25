<?php

/** @var array $config */

use Photobooth\Service\CloudStorageService;
use Photobooth\Service\RemoteStorageService;
use Photobooth\Utility\PathUtility;
use Photobooth\Utility\QrCodeUtility;

require_once '../lib/boot.php';

$filename = (isset($_GET['filename']) && $_GET['filename']) != '' ? $_GET['filename'] : false;
if ($filename) {
    $filename = basename((string)$filename);
    if ($filename === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $filename)) {
        http_response_code(400);
        echo 'Invalid filename.';
        exit();
    }
    $url = $config['qr']['url'];
    if ($config['ftp']['enabled'] && $config['ftp']['useForQr']) {
        $remoteStorageService = RemoteStorageService::getInstance();
        $url = $remoteStorageService->getWebpageUri();
        if ($config['qr']['append_filename']) {
            $url .= '/images/';
        }
    }
    if ($config['qr']['append_filename']) {
        $url .= $filename;
    }
    $cloud = CloudStorageService::getInstance();
    if ($cloud->isEnabled()) {
        // With cloud storage the QR code points to the public download, so it only exists after the upload.
        $cloudStatus = $cloud->status($filename);
        if (!$cloudStatus['uploaded']) {
            http_response_code(404);
            echo 'The photo is not uploaded yet.';
            exit();
        }
        $url = $cloudStatus['url'];
    }
    $url = PathUtility::getPublicPath($url, true);
    try {
        $result = strlen($url) > 200 ? QrCodeUtility::create($url, '', 900, 40) : QrCodeUtility::create($url);
        header('Content-Type: ' . $result->getMimeType());
        echo $result->getString();
    } catch (\Exception $e) {
        http_response_code(500);
        echo 'Error generating QR Code.';
        if ($config['dev']['loglevel'] > 1) {
            echo $e->getMessage();
        }
    }

} else {
    http_response_code(400);
    echo 'No filename defined.';
}
exit();
