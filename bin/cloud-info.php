<?php

// Prints the address of the cloud slideshow. Run  php bin/cloud-info.php  on the booth PC.

require_once __DIR__ . '/../lib/boot.php';

use Photobooth\Service\CloudStorageService;

$cloud = CloudStorageService::getInstance();
if (!$cloud->isEnabled()) {
    fwrite(STDERR, "Cloud storage is not enabled. Check the cloud section of the configuration and the keys in .env.\n");
    exit(1);
}

echo "Manifest   " . $cloud->getManifestUrl() . "\n";
echo "Slideshow  open christmas/slideshow/index.html with  ?m=<manifest address>\n";
