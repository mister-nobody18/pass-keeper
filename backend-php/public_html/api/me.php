<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('GET');
$userId = pk_require_auth();

$db = pk_db();
$stmt = $db->prepare('SELECT recovery_key_created_at, wrapped_dek_password, totp_enabled_at FROM users WHERE id = :id');
$stmt->execute(['id' => $userId]);
$row = $stmt->fetch();

// Echoes the current session's identity - no new data, nothing an
// authenticated request couldn't already learn from any other endpoint.
// Exists because the client-side encryption key can never survive a page
// reload by design (see docs/ARCHITECTURE.md) - the frontend uses this to
// know whether to prompt "re-enter your password to unlock" (session still
// valid) or show a full login form (session gone), without guessing.
//
// wrappedDekPassword is included so an already-authenticated tab can
// re-derive/re-wrap its own DEK (e.g. Settings' change-password and
// regenerate-recovery-key flows) without a redundant call to login.php -
// this reveals nothing an attacker with a hijacked session couldn't already
// get from GET /vault.php plus this same wrap.
pk_json_response(['user' => [
    'id' => $userId,
    'email' => pk_current_email(),
    'recoveryKeyCreatedAt' => $row['recovery_key_created_at'] ?? null,
    'totpEnabled' => $row['totp_enabled_at'] !== null,
], 'wrappedDekPassword' => $row['wrapped_dek_password'] ?? null]);
