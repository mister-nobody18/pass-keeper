<?php

declare(strict_types=1);

function pk_json_response(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function pk_error_response(string $message, int $status = 400): void
{
    pk_json_response(['error' => $message], $status);
}

function pk_require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        pk_error_response('Method not allowed.', 405);
    }
}

/**
 * Reads and JSON-decodes the request body. Returns [] for an empty body
 * (e.g. GET requests); rejects anything present-but-not-valid-JSON.
 */
function pk_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        pk_error_response('Invalid JSON body.', 400);
    }

    return $data;
}

function pk_client_ip(): string
{
    // Shared hosting is assumed to terminate connections directly (no
    // trusted reverse proxy in front) — see docs/ARCHITECTURE.md. If a
    // proxy/CDN is ever introduced, this must be changed to read a
    // specific, trusted forwarded-for header instead, never blindly.
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}
