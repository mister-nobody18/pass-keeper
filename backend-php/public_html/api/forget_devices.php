<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('PUT');
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
    error_log('Pass Keeper: forget_devices.php found no user row for session user_id=' . $userId);
    pk_error_response('Internal server error.', 500);
}

if (!pk_verify_auth_value($currentAuthHash, $pkConfig['pepper'], $user['auth_hash'])) {
    pk_error_response('Current password is incorrect.', 403);
}

$delete = $db->prepare('DELETE FROM trusted_devices WHERE user_id = :id');
$delete->execute(['id' => $userId]);

// Also clear THIS browser's own cookie - otherwise it would keep sending a
// now-deleted token, which is harmless (the DB lookup just won't match) but
// pointless to leave lying around.
pk_clear_trusted_device_cookie($pkConfig);

pk_json_response(['forgotten' => $delete->rowCount()]);
