<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('DELETE');
$userId = pk_require_auth();
pk_verify_csrf();

$db = pk_db();
pk_rate_limit_endpoint($db, $pkConfig, 'change_password', 'user:' . $userId);

$body = pk_read_json_body();
$currentAuthHash = $body['currentAuthHash'] ?? null;

if (!pk_valid_string($currentAuthHash, 16, 512)) {
    pk_error_response('Current password is required.', 400);
}

$stmt = $db->prepare('SELECT auth_hash FROM users WHERE id = :id');
$stmt->execute(['id' => $userId]);
$user = $stmt->fetch();

if ($user === false) {
    error_log('Pass Keeper: delete_account.php found no user row for session user_id=' . $userId);
    pk_error_response('Internal server error.', 500);
}

if (!pk_verify_auth_value($currentAuthHash, $pkConfig['pepper'], $user['auth_hash'])) {
    pk_error_response('Current password is incorrect.', 403);
}

// A single DELETE on `users` is enough - `vaults`, `password_resets`, and
// `trusted_devices` all have ON DELETE CASCADE foreign keys on user_id (see
// schema.sql), so every row belonging to this account is gone with it, not
// just the account's own row. rate_limits isn't tied to user_id by a FK
// (it's keyed by bucket strings like "login:email:<hash>", not an account
// id) and ages out on its own via the lazy cleanup every rate-limit check
// already does - nothing identifying survives there either.
$delete = $db->prepare('DELETE FROM users WHERE id = :id');
$delete->execute(['id' => $userId]);

pk_destroy_session();
pk_clear_csrf_cookie($pkConfig);
pk_clear_trusted_device_cookie($pkConfig);

http_response_code(204);
exit;
