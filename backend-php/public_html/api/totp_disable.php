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
    error_log('Pass Keeper: totp_disable.php found no user row for session user_id=' . $userId);
    pk_error_response('Internal server error.', 500);
}

if (!pk_verify_auth_value($currentAuthHash, $pkConfig['pepper'], $user['auth_hash'])) {
    pk_error_response('Current password is incorrect.', 403);
}

try {
    $db->beginTransaction();

    $update = $db->prepare('UPDATE users SET totp_secret_encrypted = NULL, totp_enabled_at = NULL WHERE id = :id');
    $update->execute(['id' => $userId]);

    // Trust in a "remembered device" only ever means anything alongside a
    // 2FA challenge to skip - with 2FA off, stale trusted_devices rows are
    // just dead weight, and leaving them would let 2FA be silently
    // re-enabled later while old devices are still trusted from before.
    $deleteDevices = $db->prepare('DELETE FROM trusted_devices WHERE user_id = :id');
    $deleteDevices->execute(['id' => $userId]);

    $db->commit();
} catch (PDOException $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('Pass Keeper totp_disable failed: ' . $e->getMessage());
    pk_error_response('Internal server error.', 500);
}

pk_json_response(['disabled' => true]);
