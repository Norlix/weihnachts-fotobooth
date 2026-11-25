<?php

require_once '../lib/boot.php';

use Photobooth\Service\ApplicationService;
use Photobooth\Service\AssetService;
use Photobooth\Service\LanguageService;
use Photobooth\Service\SlideshowShareService;
use Photobooth\Utility\LoginMenuUtility;
use Photobooth\Utility\PathUtility;

$languageService = LanguageService::getInstance();

if ($config['christmasui']['protect_viewer'] && $config['login']['enabled'] && !(isset($_SESSION['auth']) && $_SESSION['auth'] === true)) {
    header('location: ' . PathUtility::getPublicPath('login'));
    exit();
}

if ($config['christmasui']['enabled']) {
    // The Christmas slideshow replaces the standard one, the list of pictures comes from the local manifest.
    $source = ($config['slideshowshare']['enabled'] && ($_GET['source'] ?? '') === 'shared') ? 'shared' : 'all';
    $manifest = PathUtility::getPublicPath('api/slideshowManifest.php') . '?source=' . $source;
    header('location: ' . PathUtility::getPublicPath('christmas/slideshow/index.html') . '?m=' . rawurlencode($manifest) . '&back=' . rawurlencode(PathUtility::getPublicPath('login')));
    exit();
}
$assetService = AssetService::getInstance();
$pageTitle = 'Slideshow - ' . ApplicationService::getInstance()->getTitle();
$photoswipe = true;
$randomImage = $config['slideshow']['randomPicture'];
$remoteBuzzer = false;
$standaloneReturnUrl = LoginMenuUtility::isMenuSessionActive($_SESSION) ? PathUtility::getPublicPath('login') : null;
if ($config['slideshow']['enabled'] && ($_GET['return'] ?? '') === 'start') {
    $standaloneReturnUrl = PathUtility::getPublicPath();
}

include PathUtility::getAbsolutePath('template/components/main.head.php');

$slideshowSource = ($config['slideshowshare']['enabled'] && ($_GET['source'] ?? '') === 'shared') ? 'shared' : 'all';
if ($slideshowSource === 'shared') {
    $imagelist = SlideshowShareService::getInstance()->getFiles();
    if ($randomImage && !empty($imagelist)) {
        shuffle($imagelist);
    }
}

?>
<body>
    <div id="gallery" class="gallery">
        <div class="gallery-header">
            <div class="gallery-title"><h1><?=$languageService->translate('slideshow')?></h1></div>
            <div class="gallery-actions">
                <?php if ($standaloneReturnUrl !== null): ?>
                    <?= \Photobooth\Utility\ComponentUtility::renderButtonLink('back', 'fa fa-chevron-left', $standaloneReturnUrl) ?>
                <?php endif; ?>
            </div>
        </div>
        <div class="gallery-body">
            <?php include PathUtility::getAbsolutePath('template/components/gallery.images.php'); ?>
        </div>
    </div>
    <?php include PathUtility::getAbsolutePath('template/components/main.footer.php'); ?>
    <script>
        standaloneReturnUrl = <?= json_encode($standaloneReturnUrl) ?>;
        slideshowSource = <?= json_encode($slideshowSource) ?>;
    </script>
    <script src="<?=$assetService->getUrl('resources/js/slideshow.js')?>"></script>
</body>
</html>
