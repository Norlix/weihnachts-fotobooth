<?php

namespace Photobooth\Utility;

/**
 * Reads secrets from the process environment or from a .env file in the project root. The file is never committed.
 */
class EnvUtility
{
    /** @var array<string, string>|null */
    private static ?array $fileValues = null;

    public static function get(string $name, string $default = ''): string
    {
        $value = getenv($name);
        if (is_string($value) && $value !== '') {
            return $value;
        }

        return self::fileValues()[$name] ?? $default;
    }

    /**
     * @return array<string, string>
     */
    private static function fileValues(): array
    {
        if (self::$fileValues !== null) {
            return self::$fileValues;
        }

        self::$fileValues = [];
        $path = PathUtility::getAbsolutePath('.env');
        if (!is_readable($path)) {
            return self::$fileValues;
        }

        foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $value = trim($value);
            if (strlen($value) >= 2 && ($value[0] === '"' || $value[0] === "'") && $value[-1] === $value[0]) {
                $value = substr($value, 1, -1);
            }
            self::$fileValues[trim($key)] = $value;
        }

        return self::$fileValues;
    }
}
