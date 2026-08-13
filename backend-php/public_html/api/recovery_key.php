<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('PUT');
$userId = pk_require_auth();
pk_verify_csrf();

$db = pk_db();
// Reuses the change_password bucket's shape (user-id-only, no IP — see
// CHANGELOG.md's audit note on why IP must not be part of this key: this
// endpoint already requires a valid session, so IP adds no security value,
// only a bypass surface for an attacker who already holds a stolen cookie).
pk_rate_limit_endpoint($db, $pkConfig, 'change_password', 'user:' . $userId);

$body = pk_read_json_body();
$currentAuthHash = $body['currentAuthHash'] ?? null;
$newWrappedDekRecovery = $body['newWrappedDekRecovery'] ?? null;

if (!pk_valid_string($currentAuthHash, 16, 512)) {
    pk_error_response('Current password is required.', 400);
}
if (!pk_valid_string($newWrappedDekRecovery, 1, 5000)) {
    pk_error_response('A valid wrapped recovery key is required.', 400);
}

$stmt = $db->prepare('SELECT auth_hash FROM users WHERE id = :id');
$stmt->execute(['id' => $userId]);
$user = $stmt->fetch();

if ($user === false) {
    error_log('Pass Keeper: recovery_key.php found no user row for session user_id=' . $userId);
    pk_error_response('Internal server error.', 500);
}

if (!pk_verify_auth_value($currentAuthHash, $pkConfig['pepper'], $user['auth_hash'])) {
    // Already authenticated for this session - no enumeration concern in
    // being specific here, same reasoning as change_password.php.
    pk_error_response('Current password is incorrect.', 403);
}

$update = $db->prepare(
    'UPDATE users SET wrapped_dek_recovery = :wrapped_dek_recovery, recovery_key_created_at = NOW() WHERE id = :id'
);
$update->execute([
    'wrapped_dek_recovery' => $newWrappedDekRecovery,
    'id'                   => $userId,
]);

$stmt = $db->prepare('SELECT recovery_key_created_at FROM users WHERE id = :id');
$stmt->execute(['id' => $userId]);
$row = $stmt->fetch();

pk_json_response(['recoveryKeyCreatedAt' => $row['recovery_key_created_at']]);
