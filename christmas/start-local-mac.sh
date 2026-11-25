#!/usr/bin/env bash
# Startet Photobooth lokal mit dem PHP-Entwicklungsserver. Nur für Tests am Mac gedacht.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8000}"

# Mehrere Worker, weil Vorschau und Foto-Verarbeitung parallel Anfragen stellen.
export PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-4}"

echo "Photobooth läuft auf http://localhost:${PORT} (Beenden mit Strg+C)"
PHP_BIN="${PHP_BIN:-/opt/homebrew/opt/php@8.4/bin/php}"
exec "${PHP_BIN}" -S "localhost:${PORT}" -t .
