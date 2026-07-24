<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');

$db = pk_db();

// IP-based limit applies even to malformed requests, so a request crafted
// to fail validation can't be used to dodge rate limiting.
pk_rate_limit_endpoint($db, $pkConfig, 'login', pk_client_ip());

$body = pk_read_json_body();
$email    = is_string($body['email'] ?? null) ? strtolower(trim($body['email'])) : '';
$authHash = $body['authHash'] ?? null;

if (!pk_valid_email($email) || !pk_valid_string($authHash, 16, 512)) {
    pk_error_response('Email and auth hash are required.', 400);
}

// Additionally rate-limit per account, so a botnet spreading attempts
// across many IPs can't bypass the IP-based limit for one target account.
pk_rate_limit_endpoint($db, $pkConfig, 'login', 'email:' . hash('sha256', $email));

$stmt = $db->prepare('SELECT id, email, auth_hash FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);
$user = $stmt->fetch();

if ($user === false) {
    // No such account: burn comparable time to a real verification, then
    // return the exact same error as a wrong password below. Never reveal
    // which case occurred.
    pk_burn_argon2id_time();
    pk_error_response('Invalid email or password.', 401);
}

if (!pk_verify_auth_value($authHash, $pkConfig['pepper'], $user['auth_hash'])) {
    pk_error_response('Invalid email or password.', 401);
}

pk_login_session((int) $user['id'], $user['email']);
pk_issue_csrf_cookie($pkConfig);

pk_json_response(['user' => ['id' => (int) $user['id'], 'email' => $user['email']]]);
