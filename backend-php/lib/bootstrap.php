<?php

declare(strict_types=1);

/**
 * Required by every endpoint file as its first line. Loads every shared
 * helper, then performs the setup every endpoint needs regardless of what
 * it does: config load, security headers, session start. See
 * CONTRIBUTING.md "How to add an endpoint safely" for the full checklist
 * of what an endpoint file is expected to do after including this.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/security_headers.php';
require_once __DIR__ . '/session.php';
require_once __DIR__ . '/csrf.php';
require_once __DIR__ . '/rate_limit.php';
require_once __DIR__ . '/crypto_helpers.php';
require_once __DIR__ . '/validation.php';
require_once __DIR__ . '/password_reset.php';
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/totp.php';

$pkConfig = pk_config();

pk_send_security_headers();
pk_configure_session($pkConfig);
