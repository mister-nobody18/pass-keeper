<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('PUT');
$userId = pk_require_auth();
pk_verify_csrf();

$db = pk_db();
// Keyed on the authenticated user ID ALONE - not also IP. This endpoint
// already requires a valid session (pk_require_auth() above), so the ID
// isn't attacker-controlled; adding IP to the bucket key would let an
// attacker who already holds a stolen session cookie bypass the limit
// simply by rotating their apparent source IP (proxy pool, VPN, mobile
// network churn), making unlimited current-password guesses. See the
// audit note in CHANGELOG.md.
pk_rate_limit_endpoint($db, $pkConfig, 'change_password', 'user:' . $userId);

$body = pk_read_json_body();

$currentAuthHash    = $body['currentAuthHash'] ?? null;
$newAuthHash        = $body['newAuthHash'] ?? null;
$newKdfSalt         = $body['newKdfSalt'] ?? null;
$newKdfParams       = $body['newKdfParams'] ?? null;
$newVaultCiphertext = $body['newVaultCiphertext'] ?? null;
$expectedRevision   = $body['expectedVaultRevision'] ?? null;

if (!pk_valid_string($currentAuthHash, 16, 512) || !pk_valid_string($newAuthHash, 16, 512)) {
    pk_error_response('Current and new auth hashes are required.', 400);
}
if (!pk_valid_string($newKdfSalt, 8, 512) || !pk_valid_string($newKdfParams, 2, 512)) {
    pk_error_response('New KDF salt and parameters are required.', 400);
}
if (!pk_valid_string($newVaultCiphertext, 1, 5_000_000)) {
    pk_error_response('A valid re-encrypted vault is required.', 400);
}
if (!pk_valid_uint($expectedRevision)) {
    pk_error_response('The current vault revision is required.', 400);
}
$expectedRevision = (int) $expectedRevision;

$stmt = $db->prepare('SELECT auth_hash FROM users WHERE id = :id');
$stmt->execute(['id' => $userId]);
$user = $stmt->fetch();

if ($user === false) {
    // The session says this user exists but the row is gone — should not
    // happen (users.id is what sessions are keyed on), but fail closed.
    error_log('Pass Keeper: change-password found no user row for session user_id=' . $userId);
    pk_error_response('Internal server error.', 500);
}

if (!pk_verify_auth_value($currentAuthHash, $pkConfig['pepper'], $user['auth_hash'])) {
    // The user is already authenticated for this session, so unlike login
    // there's no enumeration concern in saying specifically that the
    // *current* password was wrong.
    pk_error_response('Current password is incorrect.', 401);
}

$newStoredAuthHash = pk_hash_auth_value($newAuthHash, $pkConfig['pepper']);

try {
    $db->beginTransaction();

    $updateUser = $db->prepare(
        'UPDATE users SET auth_hash = :auth_hash, kdf_salt = :kdf_salt, kdf_params = :kdf_params WHERE id = :id'
    );
    $updateUser->execute([
        'auth_hash'  => $newStoredAuthHash,
        'kdf_salt'   => $newKdfSalt,
        'kdf_params' => $newKdfParams,
        'id'         => $userId,
    ]);

    // Same optimistic-concurrency guard as vault.php's PUT — the new blob
    // was re-encrypted client-side from whatever revision it last read, so
    // if the vault moved in the meantime, committing this blob would
    // silently discard that other change. Roll back the auth-hash update
    // too in that case: the new blob and the new auth hash must commit
    // together, or neither commits at all.
    $updateVault = $db->prepare(
        'UPDATE vaults SET ciphertext = :ciphertext, revision = revision + 1
         WHERE user_id = :user_id AND revision = :expected_revision'
    );
    $updateVault->execute([
        'ciphertext'        => $newVaultCiphertext,
        'user_id'           => $userId,
        'expected_revision' => $expectedRevision,
    ]);

    if ($updateVault->rowCount() === 0) {
        $db->rollBack();

        $current = $db->prepare('SELECT revision FROM vaults WHERE user_id = :user_id');
        $current->execute(['user_id' => $userId]);
        $row = $current->fetch();

        pk_json_response([
            'error'           => 'The vault was changed elsewhere. Reload and try again.',
            'currentRevision' => $row !== false ? (int) $row['revision'] : null,
        ], 409);
    }

    $db->commit();
} catch (PDOException $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('Pass Keeper change-password failed: ' . $e->getMessage());
    pk_error_response('Internal server error.', 500);
}

// Rotate the session ID as an extra precaution after a credential change.
// This only affects THIS session/device — unlike the original Node
// prototype's in-memory session store, native PHP file-based sessions have
// no central index by user, so other active sessions on other devices
// can't be centrally revoked from here. See CONTRIBUTING.md.
session_regenerate_id(true);

pk_json_response(['user' => ['id' => $userId, 'email' => pk_current_email()]]);
