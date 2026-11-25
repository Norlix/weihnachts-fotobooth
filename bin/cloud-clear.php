<?php

// Deletes all photos from the cloud bucket after the event. Run  php bin/cloud-clear.php --yes  on the booth PC.

require_once __DIR__ . '/../lib/boot.php';

use Photobooth\Service\CloudStorageService;

$cloud = CloudStorageService::getInstance();
if (!$cloud->isEnabled()) {
    fwrite(STDERR, "Cloud storage is not enabled.\n");
    exit(1);
}
if (!in_array('--yes', $argv, true)) {
    fwrite(STDERR, "This deletes every uploaded photo, slideshow image and the manifest. Run again with --yes to continue.\n");
    exit(1);
}

echo $cloud->clearAll() . " objects deleted.\n";
