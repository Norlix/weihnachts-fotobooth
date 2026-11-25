<?php

/** @var array $config */

require_once '../lib/boot.php';

use Photobooth\Enum\FolderEnum;
use Photobooth\Service\SlideshowShareService;
use Photobooth\Utility\PathUtility;

header('Content-Type: application/json');
header('Cache-Control: no-store');

if ($config['christmasui']['protect_viewer'] && $config['login']['enabled'] && !(isset($_SESSION['auth']) && $_SESSION['auth'] === true)) {
    http_response_code(403);
    echo json_encode(['error' => 'Login required.']);
    exit();
}

$files = [];
if (($_GET['source'] ?? 'shared') === 'all') {
    foreach (glob(FolderEnum::IMAGES->absolute() . '/*.{jpg,jpeg,png}', GLOB_BRACE) ?: [] as $path) {
        $files[basename($path)] = (int) filemtime($path);
    }
    asort($files);
} else {
    foreach (SlideshowShareService::getInstance()->getFiles() as $position => $file) {
        $files[$file] = $position;
    }
}

$images = [];
foreach ($files as $file => $added) {
    $images[] = ['url' => PathUtility::getPublicPath(FolderEnum::IMAGES->value . '/' . $file), 'added' => $added];
}

echo json_encode(['updated' => gmdate('c'), 'images' => $images], JSON_UNESCAPED_SLASHES);
