<?php

namespace Photobooth\Service;

use Photobooth\Enum\FolderEnum;
use Photobooth\Service\Cloud\S3Client;
use Photobooth\Utility\EnvUtility;
use Photobooth\Utility\PathUtility;

/**
 * Uploads finished photos to S3 compatible object storage in the background.
 *
 * Every photo goes to p/<random>.jpg, which backs the QR code download. A photo the guest agreed to show in the
 * slideshow is additionally stored scaled down as s/<random>.jpg and listed in the manifest m/<token>.json. All names
 * carry 128 bit of randomness, objects are public but cannot be listed without the access key.
 */
class CloudStorageService
{
    private const MAX_ATTEMPTS = 30;
    private const IMMUTABLE = 'public, max-age=31536000, immutable';
    private const NO_CACHE = 'no-cache, max-age=0';

    protected static ?self $instance = null;

    /** @var array<string, mixed> */
    private array $config;

    public function __construct()
    {
        $this->config = ConfigurationService::getInstance()->getConfiguration()['cloud'];
    }

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public function isEnabled(): bool
    {
        return (bool) $this->config['enabled'] && $this->hasCredentials() && $this->config['endpoint'] !== '' && $this->config['bucket'] !== '';
    }

    public function enqueuePhoto(string $file): void
    {
        $this->enqueue('photo', $file);
    }

    public function enqueueShare(string $file): void
    {
        $this->enqueue('share', $file);
    }

    /**
     * @return array{enabled: bool, uploaded: bool, failed: bool, url: string, shared: bool}
     */
    public function status(string $file): array
    {
        $entry = $this->readState()['files'][$file] ?? null;

        return [
            'enabled' => $this->isEnabled(),
            'uploaded' => (bool) ($entry['uploaded'] ?? false),
            'failed' => (bool) ($entry['failed'] ?? false),
            'url' => (string) ($entry['url'] ?? ''),
            'shared' => (bool) ($entry['sharedUploaded'] ?? false),
        ];
    }

    public function getManifestUrl(): string
    {
        return $this->publicUrl('m/' . $this->readState(true)['manifestToken'] . '.json', true);
    }

    /**
     * Name of the bucket for slideshow pictures and the manifest. Without a separate bucket everything shares one.
     */
    public function slideshowBucket(): string
    {
        return $this->config['slideshow_bucket'] !== '' ? (string) $this->config['slideshow_bucket'] : (string) $this->config['bucket'];
    }

    /**
     * Deletes everything this booth uploaded, for the cleanup after the event.
     */
    public function clearAll(): int
    {
        $count = 0;
        foreach ([[false, ['p/']], [true, ['s/', 'm/']]] as [$slideshow, $prefixes]) {
            $client = $this->client($slideshow);
            foreach ($prefixes as $prefix) {
                foreach ($client->listKeys($prefix) as $key) {
                    $client->delete($key);
                    $count++;
                }
            }
        }

        return $count;
    }

    /**
     * With a public base address the objects are public. Without one the bucket stays private and every link is signed
     * and expires, which is the only option on plans that do not include public buckets.
     */
    private function publicUrl(string $key, bool $slideshow): string
    {
        if ($this->config['public_base_url'] !== '') {
            return rtrim((string) $this->config['public_base_url'], '/') . '/' . $key;
        }

        return $this->client($slideshow)->presignGet($key, min((int) $this->config['retention_days'], 7) * 86400);
    }

    public function photosClient(): S3Client
    {
        return $this->client(false);
    }

    public function slideshowClient(): S3Client
    {
        return $this->client(true);
    }

    /**
     * Photos and slideshow pictures may live in different accounts, so each side can have its own endpoint, region and
     * keys. The slideshow side falls back to the photo side for everything it does not set.
     */
    private function client(bool $slideshow): S3Client
    {
        $fallback = fn (string $slideshowValue, string $photoValue): string => $slideshow && $slideshowValue !== '' ? $slideshowValue : $photoValue;

        return new S3Client(
            $fallback((string) $this->config['slideshow_endpoint'], (string) $this->config['endpoint']),
            $fallback((string) $this->config['slideshow_region'], (string) $this->config['region']),
            $slideshow ? $this->slideshowBucket() : (string) $this->config['bucket'],
            $this->credential($slideshow, 'ACCESS_KEY'),
            $this->credential($slideshow, 'SECRET_KEY')
        );
    }

    private function credential(bool $slideshow, string $name): string
    {
        $value = $slideshow ? EnvUtility::get('PHOTOBOOTH_S3_SLIDESHOW_' . $name) : '';

        return $value !== '' ? $value : EnvUtility::get('PHOTOBOOTH_S3_' . $name);
    }

    /**
     * Processes queued uploads until none are left. Only one worker runs at a time.
     */
    public function runWorker(): void
    {
        $lock = fopen($this->directory('') . '/worker.lock', 'c');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            return;
        }

        $idleSince = time();
        while (time() - $idleSince < 20) {
            $job = $this->nextJob();
            if ($job === null) {
                // Jobs waiting for a retry keep the worker alive, otherwise a short outage would strand them.
                if ($this->hasPendingJobs()) {
                    $idleSince = time();
                }
                sleep(1);
                continue;
            }
            $idleSince = time();
            $this->process($job);
        }

        flock($lock, LOCK_UN);
        fclose($lock);
    }

    /**
     * Starts a worker if jobs are waiting and none is running, for example after the PC was restarted.
     */
    public function ensureWorker(): void
    {
        if (!$this->isEnabled() || !$this->hasPendingJobs()) {
            return;
        }
        $lock = fopen($this->directory('') . '/worker.lock', 'c');
        if ($lock !== false && flock($lock, LOCK_EX | LOCK_NB)) {
            flock($lock, LOCK_UN);
            fclose($lock);
            $this->spawnWorker();
        }
    }

    private function hasPendingJobs(): bool
    {
        return (glob($this->directory('jobs') . '/*.json') ?: []) !== [];
    }

    private function hasCredentials(): bool
    {
        return $this->credential(false, 'ACCESS_KEY') !== '' && $this->credential(false, 'SECRET_KEY') !== ''
            && $this->credential(true, 'ACCESS_KEY') !== '' && $this->credential(true, 'SECRET_KEY') !== '';
    }

    private function enqueue(string $type, string $file): void
    {
        if (!$this->isEnabled() || $file !== basename($file) || !preg_match('/^[A-Za-z0-9._-]+\.jpe?g$/i', $file)) {
            return;
        }

        $this->updateState(function (array $state) use ($file, $type): array {
            $entry = $state['files'][$file] ?? ['key' => bin2hex(random_bytes(16))];
            if ($type === 'share' && !isset($entry['sharedKey'])) {
                $entry['sharedKey'] = bin2hex(random_bytes(16));
            }
            $state['files'][$file] = $entry;

            return $state;
        });

        $name = sprintf('%s-%s.json', str_pad((string) (int) (microtime(true) * 1000), 14, '0', STR_PAD_LEFT), bin2hex(random_bytes(4)));
        file_put_contents($this->directory('jobs') . '/' . $name, json_encode(['type' => $type, 'file' => $file, 'attempts' => 0, 'next' => 0]));
        $this->spawnWorker();
    }

    private function spawnWorker(): void
    {
        $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(PathUtility::getAbsolutePath('bin/cloud-worker.php'));
        if (PHP_OS_FAMILY === 'Windows') {
            pclose(popen('start /B "" ' . $command . ' > NUL 2>&1', 'r'));
        } else {
            exec($command . ' > /dev/null 2>&1 &');
        }
    }

    /**
     * @return array{path: string, data: array<string, mixed>}|null
     */
    private function nextJob(): ?array
    {
        $paths = glob($this->directory('jobs') . '/*.json') ?: [];
        sort($paths);
        foreach ($paths as $path) {
            $data = json_decode((string) file_get_contents($path), true);
            if (is_array($data) && ($data['next'] ?? 0) <= time()) {
                return ['path' => $path, 'data' => $data];
            }
        }

        return null;
    }

    /**
     * @param array{path: string, data: array<string, mixed>} $job
     */
    private function process(array $job): void
    {
        $data = $job['data'];
        try {
            $data['type'] === 'share' ? $this->uploadShare((string) $data['file']) : $this->uploadPhoto((string) $data['file']);
            unlink($job['path']);
        } catch (\Throwable $exception) {
            LoggerService::getInstance()->getLogger('cloud')->error($exception->getMessage(), ['file' => $data['file'] ?? '']);
            $data['attempts'] = ((int) $data['attempts']) + 1;
            if ($data['attempts'] >= self::MAX_ATTEMPTS) {
                rename($job['path'], $job['path'] . '.failed');
                $this->updateState(function (array $state) use ($data): array {
                    $state['files'][$data['file']]['failed'] = true;

                    return $state;
                });

                return;
            }
            $data['next'] = time() + min(60, 2 ** min((int) $data['attempts'], 6));
            file_put_contents($job['path'], json_encode($data));
        }
    }

    private function uploadPhoto(string $file): void
    {
        $path = FolderEnum::IMAGES->absolute() . DIRECTORY_SEPARATOR . $file;
        if (!is_file($path)) {
            return;
        }
        $entry = $this->readState()['files'][$file] ?? null;
        if ($entry === null) {
            return;
        }

        $key = 'p/' . $entry['key'] . '.jpg';
        $this->photosClient()->putFile($key, $path, 'image/jpeg', self::IMMUTABLE);

        // The QR code opens a small page that shows the photo and offers saving it to the photo library. A plain link
        // to the image only lets some phones save it to the files app.
        $pageKey = 'p/' . $entry['key'] . '.html';
        $this->photosClient()->putString($pageKey, $this->downloadPage($this->publicUrl($key, false)), 'text/html; charset=utf-8', 'private, max-age=3600');
        $url = $this->publicUrl($pageKey, false);
        $this->updateState(function (array $state) use ($file, $url): array {
            $state['files'][$file]['uploaded'] = true;
            $state['files'][$file]['url'] = $url;

            return $state;
        });
    }

    private function downloadPage(string $imageUrl): string
    {
        $template = (string) file_get_contents(PathUtility::getAbsolutePath('christmas/download/photo.html'));

        return strtr($template, [
            '%%IMAGE_URL%%' => htmlspecialchars($imageUrl, ENT_QUOTES),
            '%%IMAGE_URL_JS%%' => addcslashes($imageUrl, "\\\"\n\r"),
            '%%DAYS%%' => (string) min((int) $this->config['retention_days'], 7),
        ]);
    }

    private function uploadShare(string $file): void
    {
        $path = FolderEnum::IMAGES->absolute() . DIRECTORY_SEPARATOR . $file;
        $entry = $this->readState()['files'][$file] ?? null;
        if (!is_file($path) || $entry === null || !isset($entry['sharedKey'])) {
            return;
        }

        $scaled = $this->scaledCopy($path);
        try {
            $key = 's/' . $entry['sharedKey'] . '.jpg';
            $this->slideshowClient()->putFile($key, $scaled, 'image/jpeg', self::IMMUTABLE);
        } finally {
            if ($scaled !== $path) {
                @unlink($scaled);
            }
        }

        $sharedUrl = $this->publicUrl($key, true);
        $state = $this->updateState(function (array $state) use ($file, $sharedUrl): array {
            $state['files'][$file]['sharedUploaded'] = true;
            $state['files'][$file]['sharedUrl'] = $sharedUrl;
            $state['files'][$file]['sharedAt'] = $state['files'][$file]['sharedAt'] ?? time();

            return $state;
        });
        $this->slideshowClient()->putString('m/' . $state['manifestToken'] . '.json', $this->buildManifest($state), 'application/json', self::NO_CACHE);
    }

    private function scaledCopy(string $path): string
    {
        $maxWidth = (int) $this->config['slideshow_width'];
        $size = @getimagesize($path);
        if ($size === false || $size[0] <= $maxWidth) {
            return $path;
        }
        $source = imagecreatefromjpeg($path);
        if ($source === false) {
            return $path;
        }
        $scaled = imagescale($source, $maxWidth, -1, IMG_BICUBIC);
        $target = $this->directory('tmp') . '/' . bin2hex(random_bytes(6)) . '.jpg';
        if ($scaled === false || !imagejpeg($scaled, $target, (int) $this->config['slideshow_quality'])) {
            return $path;
        }

        return $target;
    }

    /**
     * @param array<string, mixed> $state
     */
    private function buildManifest(array $state): string
    {
        $images = [];
        foreach ($state['files'] as $entry) {
            if (!empty($entry['sharedUploaded'])) {
                $images[] = ['url' => $entry['sharedUrl'], 'added' => $entry['sharedAt']];
            }
        }
        usort($images, fn (array $a, array $b): int => $a['added'] <=> $b['added']);

        return (string) json_encode(['updated' => gmdate('c'), 'images' => $images], JSON_UNESCAPED_SLASHES);
    }

    private function directory(string $name): string
    {
        $path = PathUtility::getAbsolutePath('var/cloud' . ($name !== '' ? '/' . $name : ''));
        if (!is_dir($path)) {
            mkdir($path, 0775, true);
        }

        return $path;
    }

    private function statePath(): string
    {
        return PathUtility::getAbsolutePath(FolderEnum::DATA->value . '/cloud-state.json');
    }

    /**
     * @return array{manifestToken: string, files: array<string, array<string, mixed>>}
     */
    private function readState(bool $create = false): array
    {
        $state = is_file($this->statePath()) ? json_decode((string) file_get_contents($this->statePath()), true) : null;
        if (is_array($state) && isset($state['manifestToken'])) {
            return $state;
        }

        return $create ? $this->updateState(fn (array $state): array => $state) : ['manifestToken' => '', 'files' => []];
    }

    /**
     * @param callable(array{manifestToken: string, files: array<string, array<string, mixed>>}): array<string, mixed> $change
     * @return array{manifestToken: string, files: array<string, array<string, mixed>>}
     */
    private function updateState(callable $change): array
    {
        $handle = fopen($this->statePath(), 'c+');
        if ($handle === false || !flock($handle, LOCK_EX)) {
            throw new \RuntimeException('Cannot lock the cloud state file.');
        }
        $state = json_decode((string) stream_get_contents($handle), true);
        if (!is_array($state) || !isset($state['manifestToken'])) {
            $state = ['manifestToken' => bin2hex(random_bytes(16)), 'files' => []];
        }
        $state = $change($state);
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, (string) json_encode($state, JSON_UNESCAPED_SLASHES));
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        return $state;
    }
}
