<?php

declare(strict_types=1);

/**
 * Hand-rolled double-submit-cookie CSRF protection, mirroring the original
 * Node prototype's approach: a JS-readable cookie must match a custom
 * header, which a cross-site attacker cannot set because same-origin policy
 * stops them reading the victim's cookie value in the first place.
 */
function pk_issue_csrf_cookie(array $config): void
{
    $token = $_SESSION['csrf_token'] ?? '';

    setcookie($config['csrf']['cookie_name'], $token, [
        'expires'  => 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => pk_is_production($config),
        'httponly' => false, // must be readable by frontend JS to echo back in the header
        'samesite' => 'Strict',
    ]);
}

function pk_clear_csrf_cookie(array $config): void
{
    setcookie($config['csrf']['cookie_name'], '', [
        'expires'  => time() - 42000,
        'path'     => '/',
        'domain'   => '',
        'secure'   => pk_is_production($config),
        'httponly' => false,
        'samesite' => 'Strict',
    ]);
}

function pk_verify_csrf(): void
{
    $header = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $sessionToken = $_SESSION['csrf_token'] ?? '';

    if ($header === '' || $sessionToken === '' || !hash_equals($sessionToken, $header)) {
        pk_error_response('Invalid or missing CSRF token.', 403);
    }
}
