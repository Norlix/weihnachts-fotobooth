<?php

// Processes the queue of cloud uploads. Started in the background by CloudStorageService.

require_once __DIR__ . '/../lib/boot.php';

\Photobooth\Service\CloudStorageService::getInstance()->runWorker();
