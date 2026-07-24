# Contributing

## Project structure

**Node prototype (not yet decommissioned; kept for reference — see
README.md "Project status"):**

```
backend/    Express API + SQLite (better-sqlite3), serves the built frontend in production
```

**PHP/MySQL backend + browser crypto frontend (the live stack — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md)):**

```
backend-php/
├── config/
│   ├── config.example.php   Committed template — copy to config.php locally, never commit that copy
│   └── config.php           Git-ignored. DB credentials, server pepper, cookie names, rate limits.
├── lib/                     Shared helpers, required by every endpoint via lib/bootstrap.php:
│   ├── bootstrap.php          the one require every endpoint file starts with
│   ├── config.php             loads + caches config/config.php
│   ├── db.php                 PDO connection (MySQL, real prepared statements)
│   ├── http.php               JSON response/error helpers, method + body parsing
│   ├── security_headers.php   CSP and friends for JSON API responses
│   ├── session.php            native PHP session config, login/logout/idle-timeout helpers
│   ├── csrf.php                double-submit CSRF issue/verify
│   ├── rate_limit.php         MySQL-backed fixed-window rate limiting
│   ├── crypto_helpers.php     auth-hash hashing/verification (pepper + Argon2id), enumeration-safe helpers
│   └── validation.php         input validation helpers
├── public_html/              The actual web root — point the domain/subdomain here, not at backend-php/
│   ├── .htaccess              baseline headers, forces HTTPS, denies dotfiles
│   └── api/
│       ├── me.php             GET  - identity check after a reload (see crypto/vaultKeyStore.js below)
│       ├── register.php
│       ├── login_salt.php
│       ├── login.php
│       ├── logout.php
│       ├── vault.php          GET + PUT (same resource, two methods, one file)
│       └── change_password.php
└── schema.sql                 Run once against a fresh MySQL database — see README.md setup steps

frontend/src/
├── crypto/                   All cryptography lives here - see docs/ARCHITECTURE.md §5 and this
│   │                          file's "Crypto parameters and primitives" section below
│   ├── base64.js               plain encoding helpers, not a crypto primitive
│   ├── kdfWorker.js             runs Argon2id + HKDF + AES-GCM key import INSIDE a Web Worker
│   ├── kdfClient.js              main-thread worker interface; DEFAULT_KDF_PARAMS lives here
│   ├── vaultCipher.js            AES-256-GCM encrypt/decrypt of the whole vault blob
│   └── vaultKeyStore.js          the one place the encryption key is held; never persisted
├── api/client.js              talks to backend-php's endpoints (not backend/'s)
├── context/AuthContext.jsx     register/login/logout, wires the crypto pipeline to api/client.js
├── context/VaultLockContext.jsx  idle-lock + unlock, same crypto pipeline as AuthContext's login
└── components/ui/*, pages/*    unchanged design system - see the earlier redesign work
```

`config/` and `lib/` are **outside `public_html/`** — that placement (not
any `.htaccess` rule) is what keeps them from ever being served over HTTP.
Get the document root wrong and this protection is gone; see README.md's
setup steps for the explicit warning.

The frontend's design system (`frontend/src/components/ui/*`, the CSS token
layer, the client-side password-strength/age-indicator/auto-lock logic)
carried over into this architecture unchanged — see `docs/ARCHITECTURE.md`
§2 for the full carries-over/rebuilt breakdown. The backend is a full
rewrite; nothing under `backend/` survives as-is, and `backend-php/` has
zero Composer dependencies — every endpoint uses only PHP's built-in `PDO`,
`password_hash()`/`password_verify()`, native sessions, and
`hash_hmac()`/`hash_equals()`.

## Local development on PHP-only hosting

The target hosting environment has no Node, no SSH, no persistent process,
and no Redis — but **local development is not restricted to those
limitations**, only production deployment is. Locally, use whatever's
convenient to reproduce the target environment closely enough to catch
real bugs:

- Run PHP's built-in development server against a local MySQL instance:
  `php -S localhost:8000` from `backend-php/public_html/`, pointed at a
  local MySQL/MariaDB database created from `backend-php/schema.sql`. See
  README.md's setup steps for the full sequence (create DB, copy
  `config.example.php`, confirm Argon2id is available).
- Run the frontend dev server (`npm run dev` inside `frontend/`) alongside
  it — `vite.config.js`'s proxy already points `/api` at
  `http://localhost:8000`, matching the PHP dev server above.
- **Never rely on anything in local dev that won't exist in production** —
  no Node-only conveniences leaking into request-handling logic, no
  assuming a persistent process, no assuming Redis/cron are available
  unless you've confirmed the target host actually has them (see
  `docs/ARCHITECTURE.md` §4, migration checklist step 1).
- Composer dependencies, if any are ever justified, must have their
  `vendor/` directory **committed to git** — the production host cannot run
  `composer install` without shell access, so "it works because I ran
  composer locally" is not good enough; the repo itself has to be
  deployable by file copy alone.

## Coding conventions

- **Prefer no dependency over a dependency**, and a small, auditable
  hand-rolled implementation over a framework, unless the alternative is
  clearly worse (e.g., WebCrypto and native `password_hash()` cover almost
  everything needed; a WASM Argon2id library is a justified exception
  because there's no browser-native Argon2id). This mirrors the existing
  project's choices (no UI framework, no zxcvbn, hand-rolled CSRF) — keep
  holding that line on the PHP side.
- **All SQL goes through parameterized queries** (PDO prepared statements
  on the PHP side, exactly as `better-sqlite3` prepared statements are used
  today). No string concatenation into a query, ever, no exceptions for
  "trusted" input.
- **Every database query that touches user data is scoped to the
  authenticated user's ID.** Never trust a client-supplied ID alone to
  select which row to act on.
- **The server must stay crypto-blind.** No endpoint, no debug path, no
  logging statement should ever receive, compute, or persist a master
  password, a derived encryption key, or vault plaintext. If you find
  yourself writing PHP code that touches any of those, stop — that almost
  certainly means something has been designed wrong upstream of that line
  of code, not that this specific line needs a comment explaining why it's
  fine.
- **Security headers and CSP directives are not optional boilerplate** —
  treat changes to them with the same care as the crypto rule below, since
  a loosened CSP (e.g., adding `'unsafe-inline'` to `script-src` to fix a
  quick styling problem) can silently undo the XSS protections the whole
  architecture leans on.
- Match the existing frontend's restraint: no new UI component library, no
  CSS framework beyond what's already in place, keep the design token
  layer in one place.

## How to add an endpoint safely

Every existing endpoint in `backend-php/public_html/api/` follows the same
shape. Match it rather than improvising — the consistency is what makes
this backend auditable despite having no framework enforcing structure.

1. **Create `backend-php/public_html/api/your_endpoint.php`.** The
   filename is the URL — there's no router.

2. **First line of code (after `declare(strict_types=1);`): require the
   bootstrap.**

   ```php
   require __DIR__ . '/../../lib/bootstrap.php';
   ```

   This gives you `$pkConfig` (the loaded config array) and every helper
   function in `lib/`, and has already sent security headers and started
   the session. Do not duplicate any of that setup in your endpoint file.

3. **Declare the method(s) you accept**, as early as possible, before any
   other work happens:

   ```php
   pk_require_method('POST'); // or branch on $_SERVER['REQUEST_METHOD'] if the endpoint handles more than one, like vault.php
   ```

4. **If the endpoint requires a logged-in user, call `pk_require_auth()`**
   before touching the request body or the database. It returns the
   authenticated user's ID (`int`) or halts the request with `401`.

5. **If the endpoint changes state (anything but a safe `GET`), call
   `pk_verify_csrf()`** after auth, before acting on the request. The two
   exceptions are `register.php` and `login.php`, which precede any
   session and so have no CSRF token yet to check — don't add CSRF checks
   there, and don't treat their absence elsewhere as precedent to skip it.

6. **If the endpoint is a plausible brute-force or abuse target** (anything
   that checks a credential, or that an attacker could hit repeatedly to
   cause cost), call `pk_rate_limit_endpoint($db, $pkConfig,
   'your_bucket_name', $identifier)` — as early as you reasonably can, so
   even malformed/invalid requests still count against the limit and can't
   be used to dodge it (see `login.php` for the pattern: an IP-wide check
   before body validation, an additional account-specific check once the
   account identifier is known). Add the corresponding entry to
   `rate_limits` in `config.example.php` (and your real `config.php`).

7. **Validate every field from `pk_read_json_body()` or `$_GET` explicitly**
   with the helpers in `lib/validation.php` (`pk_valid_email`,
   `pk_valid_string`, `pk_valid_uint`) before using it — including length
   bounds, not just type. Reject with `pk_error_response($message, 400)`
   and stop; don't try to sanitize/coerce your way to something usable.

8. **All database access goes through `pk_db()` and prepared statements**
   with named parameters, scoped to the authenticated `user_id` wherever
   the query touches user-owned data. If the operation needs more than one
   write to stay consistent, wrap it in `$db->beginTransaction()` /
   `commit()` / `rollBack()` — see `change_password.php` for the pattern of
   rolling back cleanly on either a caught `PDOException` or a failed
   optimistic-concurrency check.

9. **Respond with `pk_json_response($data, $status)` or
   `pk_error_response($message, $status)`**, never a raw `echo`. Both call
   `exit` internally, so nothing after them runs — don't rely on code
   after a response call as an implicit "else" branch, because unlike a
   normal `return`, it's simply unreachable, not skipped-with-a-warning.

10. **Never let a caught exception's message reach the response.** Log
    detail with `error_log()`, return a generic `'Internal server error.'`
    at `500`. This is also true during development — get in the habit
    early, since it's an easy thing to loosen "just for now" and forget to
    tighten back up.

11. **Update the API reference table in `README.md`** (method, auth, CSRF,
    rate-limit columns) and, if the endpoint touches the schema, keep
    `backend-php/schema.sql` and `docs/ARCHITECTURE.md` §3 in sync with
    what you actually built — not just what was originally planned (see
    the sessions-table deviation callout in that doc as the example of
    what "keeping docs honest" looks like when reality and the original
    plan diverge).

If your endpoint needs something none of the existing ones do (a new kind
of side effect, a new external call, anything touching the items in the
hard-rule list below) — that's exactly the moment to slow down and get a
second opinion before writing it, not after.

## Hard rule: cryptography changes require review

**No change that touches key derivation, encryption/decryption, hashing, the
CSRF protocol, session token generation/validation, or the security-header
configuration ships without a second pair of eyes on it — no exceptions for
"small" changes, "just a refactor," or "obviously fine."**

Concretely, this covers changes to:

- Argon2id parameters or invocation (client-side KDF or server-side
  `password_hash()` re-hash)
- HKDF usage or the auth-hash/encryption-key split
- AES-256-GCM usage (IV generation, tag handling, blob format)
- `auth_hash` storage/comparison logic
- Session token generation, hashing, or validation
- CSRF token generation or validation
- Content-Security-Policy or other security headers
- Anything touching `kdf_salt`, `kdf_params`, or the `vaults.revision`
  compare-and-swap logic

If you're proposing one of these changes and don't have a reviewer
available, open it as a draft/discussion first rather than merging it
solo. A subtle bug in this code (a reused IV, a shortcut in a comparison
that isn't constant-time, a CSP relaxation) is exactly the kind of change
that looks correct in a diff and is expensive to notice later — the entire
point of the zero-knowledge design this project is built around is that
mistakes here are not easily contained or walked back once real user data
has been encrypted under them.

## Crypto parameters and primitives — do not change casually

The rule above is the policy. This section is the concrete list for the
client-side crypto specifically (`frontend/src/crypto/`), now that it's
implemented — see `docs/ARCHITECTURE.md` §5 for the full pipeline, the
measured timings behind the current numbers, and a diagram of what
actually crosses the network. Same review requirement as above; this is
what to actually check.

**Do not hand-roll a primitive that a library or the platform already
provides.** This project deliberately uses:
- **Argon2id via `libsodium-wrappers-sumo`** (`crypto/kdfWorker.js`) — not
  the plain `libsodium-wrappers` package, which does not include
  `crypto_pwhash` at all (an easy, silent downgrade if someone "cleans up"
  the dependency without checking — see the note in `docs/ARCHITECTURE.md`
  §5). If you're ever evaluating a replacement library, the bar is
  "established, audited, WASM" — not "smaller bundle."
- **HKDF via native `SubtleCrypto.deriveBits`**, **AES-256-GCM via native
  `SubtleCrypto.encrypt`/`.decrypt`** — no library, because the platform
  already provides these correctly. Don't add one "for consistency"; don't
  hand-roll one either.

**Do not change the Argon2id parameters** (`memory: 65536` KiB,
`iterations: 3`, `parallelism: 1` in `crypto/kdfClient.js`'s
`DEFAULT_KDF_PARAMS`, mirrored in `backend-php/config/config.example.php`'s
`fake_kdf_params`) without re-running the timing methodology in
`docs/ARCHITECTURE.md` §5 (measured desktop-Chromium timing + the
documented mobile-slowdown extrapolation) and updating that doc with new
numbers. These exist to target roughly one to two seconds on a mid-range
phone; changing them without re-measuring means shipping a UX or a security
posture nobody actually checked. Note that `DEFAULT_KDF_PARAMS` only affects
*new* registrations and re-keys (password changes) — existing accounts keep
whatever `kdf_params` they're stored with (see `users.kdf_params`) — so
raising these later is safe and expected, but still needs the doc updated
with why and by how much.

**Do not let `kdfParams` (the account's *stored* parameters) and
`DEFAULT_KDF_PARAMS` (the constant used for new derivations) get confused
in code.** Every derivation for an *existing* account must use the params
`GET /login_salt.php` returned for that account, never the constant — using
the constant for an existing account would derive the wrong key entirely
against an old high-cost or (later) upgraded account.

**Do not reuse an AES-GCM IV.** `crypto/vaultCipher.js`'s `encryptVault()`
calls `crypto.getRandomValues()` for a fresh 12-byte IV on every single
invocation, never caches or derives one. Reusing a GCM IV with the same key
is a real, catastrophic break (it can leak the authentication key and allow
forging ciphertexts) — this is the single easiest way to quietly destroy
this entire design's security property while every existing test still
passes, because encryption/decryption still "works" with a reused IV, it's
just no longer safe.

**Do not change the HKDF `info` strings** (`"pass-keeper-auth-v1"`,
`"pass-keeper-enc-v1"` in `crypto/kdfWorker.js`) without treating it as a
breaking migration. They're what keeps the auth-proof value and the
encryption key cryptographically independent outputs of the same master
key; changing either string changes every future derivation's output for
every account, silently locking everyone out (the auth hash won't match, and
even if it somehow did, the encryption key would be wrong too).

**Do not make the AES-GCM `encryptionKey` extractable.** It's imported with
`extractable: false` (`crypto/kdfWorker.js`) specifically so that no code
path — not a bug, not a future dependency, not an XSS payload that gets a
reference to the key object — can call `exportKey()` and recover raw key
bytes. There is no legitimate reason for this app to ever export it; if a
future change seems to need to, that's a sign the design changed in a way
that needs review, not a reason to flip the flag.

**Do not persist the encryption key anywhere** — `localStorage`,
`sessionStorage`, `IndexedDB`, a cookie, a global `window.*` property, React
state/context, or a server round-trip "just for convenience." It lives in
exactly one place: the module-level variable in `crypto/vaultKeyStore.js`.
If a feature seems to require persisting it, the feature needs to change,
not this rule.
