<?php

declare(strict_types=1);

/**
 * Configures and starts PHP's native session mechanism: HttpOnly, Secure
 * (in production), SameSite=Strict, a non-default cookie name. Called once
 * per request from lib/bootstrap.php, before any endpoint logic runs.
 */
function pk_configure_session(array $config): void
{
    $sessionCfg = $config['session'];

    session_name($sessionCfg['cookie_name']);

    session_set_cookie_params([
        'lifetime' => 0, // session cookie; idle expiry is enforced server-side below
        'path'     => '/',
        'domain'   => '',
        'secure'   => pk_is_production($config),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', (string) ($sessionCfg['idle_timeout_minutes'] * 60));

    session_start();

    pk_enforce_idle_timeout($sessionCfg['idle_timeout_minutes'] * 60);
}

function pk_enforce_idle_timeout(int $maxIdleSeconds): void
{
    if (isset($_SESSION['last_activity']) && (time() - (int) $_SESSION['last_activity']) > $maxIdleSeconds) {
        pk_destroy_session();
        return;
    }
    $_SESSION['last_activity'] = time();
}

/**
 * Establishes an authenticated session after a successful register/login.
 * Regenerates the session ID (session fixation defense: an attacker who set
 * a session cookie on the victim's browser before login can't inherit an
 * authenticated one) and issues a fresh CSRF token tied to this session.
 */
function pk_login_session(int $userId, string $email): void
{
    session_regenerate_id(true);
    $_SESSION['user_id']       = $userId;
    $_SESSION['email']         = $email;
    $_SESSION['last_activity'] = time();
    $_SESSION['csrf_token']    = bin2hex(random_bytes(32));
}

function pk_current_user_id(): ?int
{
    return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
}

function pk_current_email(): ?string
{
    return isset($_SESSION['email']) ? (string) $_SESSION['email'] : null;
}

function pk_require_auth(): int
{
    $userId = pk_current_user_id();
    if ($userId === null) {
        pk_error_response('Not authenticated.', 401);
    }
    return $userId;
}

/**
 * Finishes an authenticated login: establishes the session, issues the CSRF
 * cookie, and sends the standard {user, wrappedDekPassword} response shape
 * every successful login/register/reset ends with. Shared by login.php's
 * non-2FA path and totp_verify.php's post-code-verification path, so this
 * "how a login actually finishes" logic exists in exactly one place.
 */
function pk_complete_login(array $user, array $config): void
{
    pk_login_session((int) $user['id'], $user['email']);
    pk_issue_csrf_cookie($config);

    pk_json_response([
        'user' => [
            'id' => (int) $user['id'],
            'email' => $user['email'],
            'recoveryKeyCreatedAt' => $user['recovery_key_created_at'] ?? null,
            'totpEnabled' => ($user['totp_enabled_at'] ?? null) !== null,
        ],
        'wrappedDekPassword' => $user['wrapped_dek_password'],
    ]);
}

function pk_destroy_session(): void
{
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
    }

    session_destroy();
}
