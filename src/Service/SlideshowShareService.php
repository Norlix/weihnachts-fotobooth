<?php

namespace Photobooth\Service;

use Photobooth\Enum\FolderEnum;
use Photobooth\Utility\PathUtility;

/**
 * Keeps the list of pictures the guests agreed to show in the party slideshow.
 * The pictures themselves stay in data/images, only their names are recorded.
 */
class SlideshowShareService
{
    private const LIST_FILE = 'slideshow-share.json';

    protected static ?self $instance = null;

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public function isValidFileName(string $fileName): bool
    {
        return $fileName === basename($fileName) && preg_match('/^[A-Za-z0-9._-]+\.(jpe?g|png)$/i', $fileName) === 1;
    }

    public function share(string $fileName): bool
    {
        if (!$this->isValidFileName($fileName) || !is_file(FolderEnum::IMAGES->absolute() . DIRECTORY_SEPARATOR . $fileName)) {
            return false;
        }

        $handle = fopen($this->getListPath(), 'c+');
        if ($handle === false || !flock($handle, LOCK_EX)) {
            return false;
        }

        $files = $this->decode((string) stream_get_contents($handle));
        if (!in_array($fileName, $files, true)) {
            $files[] = $fileName;
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, (string) json_encode($files));
        }

        flock($handle, LOCK_UN);
        fclose($handle);

        return true;
    }

    /**
     * @return string[] Shared pictures that still exist, oldest first.
     */
    public function getFiles(): array
    {
        $path = $this->getListPath();
        if (!is_file($path)) {
            return [];
        }

        $files = $this->decode((string) file_get_contents($path));

        return array_values(array_filter(
            $files,
            fn (string $file): bool => is_file(FolderEnum::IMAGES->absolute() . DIRECTORY_SEPARATOR . $file)
        ));
    }

    /**
     * Changes whenever pictures are added or removed, so the slideshow can detect updates.
     */
    public function getStatusToken(): int
    {
        return crc32(implode('|', $this->getFiles()));
    }

    /**
     * @return string[]
     */
    private function decode(string $json): array
    {
        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            return [];
        }

        return array_values(array_filter($decoded, fn ($entry): bool => is_string($entry) && $this->isValidFileName($entry)));
    }

    private function getListPath(): string
    {
        return PathUtility::getAbsolutePath(FolderEnum::DATA->value . DIRECTORY_SEPARATOR . self::LIST_FILE);
    }
}
