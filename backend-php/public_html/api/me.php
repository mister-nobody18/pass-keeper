<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('GET');
$userId = pk_require_auth();

// Echoes the current session's identity - no new data, nothing an
// authenticated request couldn't already learn from any other endpoint.
// Exists because the client-side encryption key can never survive a page
// reload by design (see docs/ARCHITECTURE.md) - the frontend uses this to
// know whether to prompt "re-enter your password to unlock" (session still
// valid) or show a full login form (session gone), without guessing.
pk_json_response(['user' => ['id' => $userId, 'email' => pk_current_email()]]);
