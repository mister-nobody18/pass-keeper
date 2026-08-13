<?php

declare(strict_types=1);

/**
 * Copy this file to config.php in the same directory and fill in real
 * values. config.php must NEVER be committed to git (already covered by
 * .gitignore). This directory lives outside public_html/, so on a
 * correctly configured host it is not directly web-accessible at all,
 * regardless of PHP's execution state — that's its primary protection,
 * not any .htaccess rule.
 */
return [
    // 'production' enables Secure cookies (requires HTTPS). Use
    // 'development' only for a local machine running over plain HTTP.
    'app_env' => 'production',

    // The canonical origin this app is served from. Used ONLY to build
    // password-reset links server-side — deliberately not built from the
    // request's Host header, which is client-supplied and not something a
    // security-sensitive email link should be constructed from.
    'app_url' => 'https://vault.soricu.com',

    'mail' => [
        'from_address' => 'noreply@soricu.com',
        'from_name'    => 'Pass Keeper',
    ],

    'password_reset' => [
        // How long a reset link stays valid. Kept short deliberately - see
        // docs/THREAT-MODEL.md.
        'expiry_minutes' => 10,
    ],

    'db' => [
        'host'    => '127.0.0.1',
        'port'    => '3306',
        'name'    => 'passkeeper',
        'user'    => 'passkeeper_user',
        'pass'    => 'CHANGE_ME',
        'charset' => 'utf8mb4',
    ],

    // Secret mixed into every stored auth hash (see lib/crypto_helpers.php).
    // Generate with:
    //   php -r "echo bin2hex(random_bytes(48));"
    // Back this up somewhere safe, separate from the database backup.
    // Losing it makes every stored auth hash unverifiable — a full login
    // outage — but does NOT expose or destroy vault data, which this
    // server never had the ability to decrypt regardless of this value.
    'pepper' => 'CHANGE_ME_GENERATE_A_LONG_RANDOM_HEX_STRING',

    'session' => [
        // Deliberately not the framework/language default cookie name.
        'cookie_name'          => 'pk_session',
        'idle_timeout_minutes' => 60,
    ],

    'csrf' => [
        'cookie_name' => 'pk_csrf',
    ],

    // Fixed-window rate limits, enforced via the rate_limits MySQL table.
    // See docs/ARCHITECTURE.md §3 and lib/rate_limit.php.
    'rate_limits' => [
        'register'                 => ['limit' => 5,  'window_seconds' => 3600],
        'login'                     => ['limit' => 10, 'window_seconds' => 900],
        'change_password'           => ['limit' => 5,  'window_seconds' => 900],
        // Deliberately tight - an unthrottled reset-request endpoint is a
        // ready-made way to email-bomb someone else's inbox with reset links.
        'password_reset_request'    => ['limit' => 3,  'window_seconds' => 3600],
        'password_reset_verify'     => ['limit' => 20, 'window_seconds' => 3600],
        'password_reset_confirm'    => ['limit' => 10, 'window_seconds' => 3600],
        // Generous - this fires at most once per account in practice (the
        // wrapped_dek_password IS NULL guard in migrate_vault.php makes
        // every call after the first a no-op).
        'migrate_vault'              => ['limit' => 20, 'window_seconds' => 3600],
    ],

    // Returned by the login-salt lookup for emails that don't exist, so the
    // response is indistinguishable in shape from a real one (see
    // lib/crypto_helpers.php::pk_fake_kdf_salt and docs/THREAT-MODEL.md).
    // Keep this in sync with whatever the frontend actually uses for new
    // registrations, so a fake and a freshly-registered real account look
    // the same.
    'fake_kdf_params' => '{"algorithm":"argon2id","memory":65536,"iterations":3,"parallelism":1}',
];
