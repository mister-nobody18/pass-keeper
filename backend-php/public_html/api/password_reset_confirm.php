<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');

$db = pk_db();
// IP-only (there's no account context yet - the token IS the credential
// here, and it's already 256 bits, unguessable; this is defense in depth).
pk_rate_limit_endpoint($db, $pkConfig, 'password_reset_confirm', pk_client_ip());

$body = pk_read_json_body();

$token               = $body['token'] ?? null;
$newAuthHash         = $body['newAuthHash'] ?? null;
$newKdfSalt          = $body['newKdfSalt'] ?? null;
$newKdfParams        = $body['newKdfParams'] ?? null;
$newWrappedDekPassword = $body['newWrappedDekPassword'] ?? null;
$mode                = $body['mode'] ?? null;
$newWrappedDekRecovery = $body['newWrappedDekRecovery'] ?? null; // optional, either mode
$newVaultCiphertext  = $body['newVaultCiphertext'] ?? null;       // required only for 'destructive'

if (!pk_valid_string($token, 32, 128)) {
    pk_error_response('A valid reset token is required.', 400);
}
if (!pk_valid_string($newAuthHash, 16, 512)) {
    pk_error_response('A valid auth hash is required.', 400);
}
if (!pk_valid_string($newKdfSalt, 8, 512) || !pk_valid_string($newKdfParams, 2, 512)) {
    pk_error_response('New KDF salt and parameters are required.', 400);
}
if (!pk_valid_string($newWrappedDekPassword, 1, 5000)) {
    pk_error_response('A valid wrapped key is required.', 400);
}
if ($mode !== 'recovery' && $mode !== 'destructive') {
    pk_error_response('A valid mode is required.', 400);
}
if ($newWrappedDekRecovery !== null && !pk_valid_string($newWrappedDekRecovery, 1, 5000)) {
    pk_error_response('Invalid recovery wrap.', 400);
}
if ($mode === 'destructive' && !pk_valid_string($newVaultCiphertext, 1, 5_000_000)) {
    pk_error_response('A valid empty vault is required for a destructive reset.', 400);
}

// Claims the token atomically - see lib/password_reset.php. Once this
// returns a user id, the token is already burned; a retry of this exact
// request (e.g. a double-click, or a network retry) will correctly fail
// here on the second attempt rather than applying the change twice.
$userId = pk_consume_reset_token($db, $token);
if ($userId === null) {
    pk_error_response('This reset link is invalid, expired, or already used. Request a new one.', 400);
}

try {
    $db->beginTransaction();

    if ($mode === 'recovery') {
        // The vault's DEK doesn't change - only how it's wrapped. The vault
        // ciphertext itself is never touched, so there's nothing to CAS here.
        $updateUser = $db->prepare(
            'UPDATE users
             SET auth_hash = :auth_hash, kdf_salt = :kdf_salt, kdf_params = :kdf_params,
                 wrapped_dek_password = :wrapped_dek_password
             WHERE id = :id'
        );
        $updateUser->execute([
            'auth_hash'            => pk_hash_auth_value($newAuthHash, $pkConfig['pepper']),
            'kdf_salt'             => $newKdfSalt,
            'kdf_params'           => $newKdfParams,
            'wrapped_dek_password' => $newWrappedDekPassword,
            'id'                   => $userId,
        ]);
    } else {
        // Destructive: a brand new DEK, a brand new (empty) vault. Old
        // ciphertext is unrecoverable from this point on - this is the
        // documented, deliberate trade-off of resetting without a recovery
        // key. No CAS on the vault write: there is nothing left to preserve.
        $updateUser = $db->prepare(
            'UPDATE users
             SET auth_hash = :auth_hash, kdf_salt = :kdf_salt, kdf_params = :kdf_params,
                 wrapped_dek_password = :wrapped_dek_password,
                 wrapped_dek_recovery = :wrapped_dek_recovery,
                 recovery_key_created_at = :recovery_key_created_at
             WHERE id = :id'
        );
        $updateUser->execute([
            'auth_hash'               => pk_hash_auth_value($newAuthHash, $pkConfig['pepper']),
            'kdf_salt'                => $newKdfSalt,
            'kdf_params'              => $newKdfParams,
            'wrapped_dek_password'    => $newWrappedDekPassword,
            'wrapped_dek_recovery'    => $newWrappedDekRecovery,
            'recovery_key_created_at' => $newWrappedDekRecovery !== null ? date('Y-m-d H:i:s') : null,
            'id'                      => $userId,
        ]);

        $updateVault = $db->prepare(
            'UPDATE vaults SET ciphertext = :ciphertext, revision = revision + 1 WHERE user_id = :user_id'
        );
        $updateVault->execute([
            'ciphertext' => $newVaultCiphertext,
            'user_id'    => $userId,
        ]);
    }

    $db->commit();
} catch (PDOException $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    error_log('Pass Keeper password_reset_confirm failed: ' . $e->getMessage());
    pk_error_response('Internal server error.', 500);
}

$stmt = $db->prepare(
    'SELECT id, email, wrapped_dek_password, recovery_key_created_at, totp_enabled_at FROM users WHERE id = :id'
);
$stmt->execute(['id' => $userId]);
$user = $stmt->fetch();

// A completed reset proves control of the account's email, not the account
// itself - if 2FA is enabled, this still shouldn't be enough to finish
// logging in on its own. Otherwise 2FA gives no protection against an
// attacker who's compromised the account's email and used "forgot
// password" to get this far. Same gate login.php uses, including the
// trusted-device skip - see lib/totp.php.
if (pk_totp_challenge_needed($db, $user)) {
    pk_start_pending_totp($userId);
    pk_json_response(['twoFactorRequired' => true]);
}

pk_complete_login($user, $pkConfig);
