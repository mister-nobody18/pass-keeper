<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/bootstrap.php';

pk_require_method('POST');
pk_require_auth();
pk_verify_csrf();

pk_destroy_session();
pk_clear_csrf_cookie($pkConfig);

http_response_code(204);
exit;
