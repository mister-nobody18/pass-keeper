<?php

declare(strict_types=1);

/**
 * Loads config/config.php once per request and caches it. Fails loudly
 * (500, no details leaked) rather than falling back to any default if the
 * file is missing or malformed — a missing config file must never be
 * silently treated as "no secrets configured."
 */
function pk_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $path = __DIR__ . '/../config/config.php';
    if (!is_file($path)) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Server configuration missing.']);
        exit;
    }

    /** @var mixed $loaded */
    $loaded = require $path;

    if (!is_array($loaded)) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Server configuration is invalid.']);
        exit;
    }

    $config = $loaded;
    return $config;
}

function pk_is_production(array $config): bool
{
    return ($config['app_env'] ?? 'production') === 'production';
}
