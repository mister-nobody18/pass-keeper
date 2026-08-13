# Changelog

This project doesn't cut versioned releases yet — entries are grouped by
migration/audit milestone instead of a version number.

## Two-factor authentication, account deletion, data export, privacy pages — 2026-08-13

### Added

- **TOTP two-factor authentication** (RFC 6238/4226), compatible with
  Google Authenticator and any other standard authenticator app. Enrollment
  via a scanned QR code (`qrcode` npm package — the frontend's second
  deliberate dependency) or manual secret entry. `backend-php/lib/totp.php`
  implements the HOTP/TOTP algorithm on PHP's built-in `hash_hmac('sha1',
  ...)` (no library) and is verified against the official RFC 4226 test
  vectors before being wired into any endpoint. The secret is encrypted at
  rest (AES-256-GCM, keyed by a value derived from the server pepper) — the
  one deliberate exception to this project's "the server never holds
  anything sensitive readably" rule, since the server has to independently
  compute a live 6-digit code. See `docs/ARCHITECTURE.md` §7 and
  `docs/THREAT-MODEL.md` §2.9.
- **"Remember this device" for 30 days**, opt-in per login via a checkbox
  on the 2FA challenge screen — never set silently. Revoked on disabling
  2FA, changing the master password, or deleting the account.
- 2FA gates both `login.php` and `password_reset_confirm.php` — a
  password-reset completion still requires the code (unless the device is
  already remembered), otherwise 2FA would give no protection against
  someone who's compromised the account's email. Idle-unlock
  (`VaultLockContext.unlock()`) is deliberately exempt — it only re-proves
  the password against an already-authenticated session, so it never
  re-prompts for a code.
- New endpoints: `totp_setup_begin.php`, `totp_setup_confirm.php`,
  `totp_disable.php`, `totp_verify.php`, `forget_devices.php`. New `users`
  columns (`totp_secret_encrypted`, `totp_enabled_at`) and a new
  `trusted_devices` table (`backend-php/migrations/002_add_totp.sql` for
  already-deployed databases).
- **Account deletion** (`delete_account.php`) — a single `DELETE` on
  `users` that cascades to the account's vault, recovery-key wrap, 2FA
  secret, and remembered devices via existing foreign keys. Settings gains
  a "Delete my account" flow requiring current-password re-entry plus a
  separate typed confirmation.
- **Client-side data export** — a new "Export my data" button in Settings
  downloads the vault entries already decrypted in the current session
  plus basic account metadata as a JSON file, entirely client-side (a
  `Blob` + anchor click, no new dependency). Deliberately not a server
  endpoint: the server only ever holds opaque ciphertext, so a server-side
  "export" could only ever hand back the same encrypted blob, not
  something readable.
- **In-app Privacy Policy and Cookie Policy pages** (`/privacy`,
  `/cookies`, linked from the sign-in screen and Settings) — an honest,
  specific description of what this application actually collects, why,
  how long it's kept, and what rights are available (export/erasure via
  the features above), not generic boilerplate. Written because this
  instance now has users beyond the operator's own household, which
  changes GDPR's applicability.

### Fixed

- A real bug caught during this session's own testing, not a pre-existing
  one: every "re-enter your current password/code to confirm" endpoint
  (`recovery_key.php`, `change_password.php`, and now `totp_disable.php`,
  `forget_devices.php`, `delete_account.php`, `totp_setup_confirm.php`)
  returned `401` for "you typed it wrong" — but `api/client.js`'s global
  handler treats any authenticated-route `401` as "your session expired"
  and silently logs the user out. Fixed by using `403` for these
  authenticated re-verification failures, reserving `401` for genuinely no
  session; `totp_verify.php` (which runs before a session exists at all)
  keeps `401` and was added to `AUTH_ENTRY_PATHS` instead, the same
  treatment `login.php`/`register.php` already had.
- A second bug caught the same way: `pk_complete_login()` (the shared
  login-finishing helper both `login.php` and the new `totp_verify.php`
  use) never included `totpEnabled` in its response, so after any
  2FA-gated login the frontend's `user.totpEnabled` was `undefined` —
  Settings would show "Not enabled" even when 2FA was actually on. Fixed
  by including it consistently across `login.php`, `register.php`,
  `totp_verify.php`, and `password_reset_confirm.php`'s responses.
- `migrate_vault.php` (from the previous entry below) had never actually
  been added to `README.md`'s API reference table — fixed alongside the
  new endpoints added in this entry.

### Verification

Three Playwright suites (21 checks total) against the real local dev
stack: enrollment with a QR-derived secret and a real RFC-4226-verified
code (not a stubbed check), the full login challenge/wrong-code/
remember-device cycle, idle-unlock exemption, password-change device
revocation, the `totp_verify` rate limit actually engaging after repeated
wrong codes, the password-reset flow's 2FA gate, disabling 2FA, data
export content (decrypted entries, not ciphertext), and account deletion
followed by successful re-registration of the same email with a
confirmed-empty fresh vault (proving the old data was truly gone, not
just hidden).

## Fix: SPA client-side routes 404 on direct load — 2026-08-13

`backend-php/public_html/.htaccess` had no SPA-fallback rewrite rule -
undiscovered since the original PHP migration, because nothing before the
password-reset feature ever needed to be reached by a direct/external link.
A password-reset email's link points straight at `/reset-password`, which
has no real file behind it (React Router handles that path client-side) -
without a fallback rule, the server 404s before the app ever gets a chance
to load. `/settings`, `/forgot-password`, and any other client-side route
had the exact same problem on a fresh load or a page refresh, just never
noticed because everything had always been reached by clicking around
inside an already-loaded app until now.

Fixed by adding the standard SPA-fallback rule (any request not under
`/api/` and not matching a real file/directory falls through to
`index.html`), scoped with the same `!^/api/` condition the existing
`SPA_CONTEXT` CSP-scoping rule already used. Verified directly against the
live production server: every client-side route (`/settings`,
`/forgot-password`, `/reset-password`, an arbitrary unknown path) now
returns 200, `/api/*` endpoints are unaffected, and the CSP scoping between
the SPA and the API still isn't crossed. `docs/DEPLOYMENT.md`'s post-deploy
checklist gained a new step specifically testing this (direct navigation to
a client-side route, not navigation from within the app), so this class of
bug gets caught before going live next time, not after.

## Compatibility fix: migrate existing accounts to the DEK model — 2026-08-13

The previous entry below was written on the explicit, stated assumption
that no production data existed yet - every account so far had been a
disposable test account. That assumption turned out to be wrong: production
has one real account, on the pre-reset-feature schema and crypto model, with
real vault data. Deploying the DEK/envelope changes as-is would have broken
login entirely for that account (its `wrapped_dek_password` doesn't exist)
and, even with the schema patched, would have left its vault permanently
unreadable through the new code (no DEK was ever created for it). This
entry is the fix - a real account with real data now self-upgrades to the
DEK model transparently, on its own next successful login.

### Added

- `backend-php/migrations/001_add_dek_columns.sql` - a real `ALTER TABLE`
  migration for an *existing* production database (distinct from
  `schema.sql`, which stays the fresh-install source of truth; `CREATE
  TABLE IF NOT EXISTS` is a no-op against a table that already exists and
  was never going to add these columns on its own).
- `frontend/src/crypto/legacyMigration.js` (`resolveDekAfterLogin`), used
  by both `AuthContext.login()` and `VaultLockContext.unlock()`: if a
  login response has no `wrappedDekPassword`, the account predates the DEK
  model. The vault is decrypted directly with the password-derived key
  (exactly as the old model did), a fresh DEK is generated and wrapped, the
  vault is re-encrypted under it, and the result is persisted server-side -
  all transparently, no user action beyond typing their normal password.
  On any failure (network drop, a losing race against another tab, a stale
  revision), it falls back to using the vault directly with the
  password-derived key for that session instead of blocking access -
  migration is retried automatically on the next login, since
  `wrapped_dek_password` stays `NULL` server-side until one actually
  commits.
- `backend-php/public_html/api/migrate_vault.php` - the endpoint that
  persists the migration. Two guarded updates in one transaction: claiming
  `wrapped_dek_password` only succeeds while it's still `NULL` (so this can
  never overwrite a real wrap, even under a race), and the vault ciphertext
  update uses the same optimistic-concurrency revision guard `vault.php`
  already uses. Either both commit or neither does.

### Changed

- `frontend/src/crypto/kdfWorker.js`: the derived key's usages changed from
  `['wrapKey', 'unwrapKey']` to `['wrapKey', 'unwrapKey', 'encrypt',
  'decrypt']`. The extra two usages aren't for normal operation - they're
  what let this same key still open a pre-DEK legacy vault (which it
  encrypted directly, before the DEK model existed) during migration,
  without a second derivation. `vaultCipher.js`'s envelope format never
  changed across this whole feature, only what usages the key doing the
  decrypting was allowed - confirmed by diffing against the pre-DEK commit.
- `backend-php/schema.sql`: `users.wrapped_dek_password` changed from `TEXT
  NOT NULL` to `TEXT NULL`, matching what a migrated production database
  actually looks like. `register.php` still always supplies a value for
  every new account (an application-level guarantee, not a DB constraint) -
  `NULL` now has exactly one meaning: a legacy account that hasn't
  self-migrated yet.

### Verification

Simulated the real production scenario end-to-end before this was
considered safe to write up: built a test database from the actual
pre-DEK schema (`git show` of the commit before this feature), seeded it
with an account using real browser-derived crypto (not synthetic data) to
match exactly what a real legacy account looks like, ran the migration SQL
against it, then drove the real login UI - confirmed the vault decrypts
correctly, the migration persists (`wrapped_dek_password` populated,
vault revision incremented), a second login takes the normal already-
migrated path, and Settings correctly shows the recovery key as not set up
(migration is DEK-only, it doesn't invent a recovery key). Separately
verified the failure path by disabling the migration endpoint mid-test:
login still succeeds, the vault stays usable, the database is left
untouched (not half-migrated), and restoring the endpoint lets the very
next login retry and succeed.

## Master-password reset via recovery key — 2026-08-12

### Added

- **Envelope encryption for the vault's key.** A random Data Encryption Key
  (the DEK) now actually encrypts the vault; it's wrapped (via native
  `crypto.subtle.wrapKey()`/`unwrapKey()`, never manual export-then-encrypt)
  under a key derived from the master password, and optionally a second,
  independent key derived from a recovery key. Either wrap alone unwraps the
  identical DEK. See `docs/ARCHITECTURE.md` §6 for the full design and
  `frontend/src/crypto/dek.js`.
- **Recovery key**: a 160-bit random value, Base32-encoded and grouped
  (`XXXX-XXXX-...`), generated client-side and shown exactly once —
  never transmitted or stored in raw form anywhere. Offered at
  registration (skippable) and settable/rotatable any time afterward from
  Settings. `frontend/src/crypto/recoveryKey.js`, `components/
  RecoveryKeyDisplay.jsx`, `api/recovery_key.php`.
- **Password reset flow**: `ForgotPassword.jsx` (request a link by email,
  always the same generic response) and `ResetPassword.jsx` (verify the
  token, then either a recovery-key path that preserves the vault, or an
  explicit, checkbox-gated destructive path that starts a fresh empty vault
  and immediately offers a new recovery key). Backend: `lib/password_reset.
  php` (256-bit tokens, only the SHA-256 hash ever stored, single-use via an
  atomic claim), `lib/mailer.php` (PHP native `mail()`, zero dependencies),
  `api/password_reset_request.php`, `api/password_reset_verify.php`,
  `api/password_reset_confirm.php`.
- New `users` columns (`wrapped_dek_password`, `wrapped_dek_recovery`,
  `recovery_key_created_at`) and a new `password_resets` table —
  `backend-php/schema.sql`.
- New rate-limit buckets: `password_reset_request` (by IP *and* by
  account-email hash — an unthrottled reset-request endpoint is a
  ready-made way to email-bomb someone else's inbox), `password_reset_
  verify`, `password_reset_confirm`.
- `docs/ARCHITECTURE.md` §6, a new `docs/THREAT-MODEL.md` §2.8 on the reset
  flow's specific risks (token handling, recovery-key blast radius,
  email-bombing mitigation, the destructive path's deliberate data loss),
  and updates to `README.md`'s security section, API reference, and the
  top-of-file warning (no longer an unconditional "no forgot password").

### Changed

- **`change_password.php` simplified.** Under the envelope model, changing
  your master password only re-wraps the DEK — the vault ciphertext never
  moves. What was a cross-table transaction with an optimistic-concurrency
  guard on the vault write is now a single atomic `UPDATE users` statement.
  The endpoint's request/response shape changed accordingly (see `README.md`
  API reference) — this is a breaking change to that endpoint's contract,
  not just an internal refactor.
- `register.php`/`login.php` request/response shapes changed to carry the
  wrapped DEK(s) instead of a directly-password-encrypted vault blob.
- `crypto/kdfWorker.js`'s derived AES-GCM key now has `wrapKey`/`unwrapKey`
  usages instead of `encrypt`/`decrypt` — it wraps the DEK now, rather than
  encrypting the vault directly. No change to the Argon2id/HKDF parameters
  or pipeline itself.

### Fixed

- **A real race condition caught during this feature's own end-to-end
  testing, not a pre-existing bug:** `AuthContext.register()` originally
  called `setUser()` as its last step. Since `Register.jsx` is wrapped in
  `PublicOnlyRoute` (which redirects to `/` the instant `user` becomes
  truthy), that redirect fired before the newly-added recovery-key display
  could even render — the screen would flash and disappear, or in a
  scripted/fast-network test, never appear at all. Fixed by having
  `register()` return the pending user/DEK without committing them to
  React state; `Register.jsx` now only calls `setUser()`/`setVaultKey()`
  once the user has acknowledged the recovery key and clicked continue. The
  destructive reset path in `ResetPassword.jsx` was written with the same
  deferral from the start, having learned from this.

## PHP/MySQL migration + browser-side crypto — 2026-07-24

### Added

- `backend-php/`: full PHP 8.1+/MySQL backend — `register`, `login_salt`,
  `login`, `logout`, `me`, `vault` (GET/PUT), `change_password`. Zero
  Composer dependencies; every query is a PDO prepared statement.
- `frontend/src/crypto/`: client-side Argon2id (`libsodium-wrappers-sumo`,
  WASM, run in a dedicated Web Worker) + HKDF (native WebCrypto) +
  AES-256-GCM (native WebCrypto). The master password and the vault's
  encryption key never leave the browser in any form — only an
  HKDF-derived auth hash and opaque AES-GCM ciphertext ever reach the
  server. See `docs/ARCHITECTURE.md` §5 for the full pipeline.
- Whole-vault, single-encrypted-blob storage model with optimistic
  concurrency (revision-based compare-and-swap) on every save.
- Client-side idle auto-lock; wipes the in-memory encryption key on lock,
  logout, and tab close/hide.
- `docs/ARCHITECTURE.md`, `docs/THREAT-MODEL.md`, `docs/DEPLOYMENT.md`,
  and this file.
- MySQL-backed fixed-window rate limiting (no Redis available on the
  target host) on `register`, `login` (by IP *and* by account), and
  `change_password`.
- Deployment artifacts for DirectAdmin + LiteSpeed shared hosting with no
  SSH: `.htaccess` (HTTPS force, dotfile/config/`.sql` blocks, a CSP tight
  enough to allow the Argon2id WASM module while blocking inline scripts,
  correctly scoped so it can't clobber the API's own stricter CSP), a
  pure-PHP cron backup script with rotation (no `mysqldump`/shell
  dependency), and a full no-SSH deployment + verification procedure.

### Changed

- Migrated off the Node.js/Express + SQLite prototype (`backend/` — kept
  in the repo for reference; the frontend no longer talks to it).
- Vault storage moved from per-entry encrypted columns to a single
  client-encrypted JSON blob per user — see `docs/ARCHITECTURE.md` §1 for
  the trade-offs this accepts (no server-side search/pagination; every
  save re-encrypts the whole vault).
- Sessions moved from an in-memory Node `Map` (which briefly held a
  server-derived decryption key) to native PHP sessions holding no key
  material at all — the server is now fully crypto-blind, not just
  "crypto-blind at rest."

### Security

Findings from an end-to-end audit of the completed migration — client
crypto, every backend endpoint, session/CSRF/rate-limit/enumeration logic —
ranked by severity.

- **Medium — change-password rate limit was bypassable by rotating IP.**
  The rate-limit bucket key was `user:<id>:ip:<ip>`. Because it included
  the client's IP alongside the authenticated user ID, an attacker who
  already held a stolen session cookie (but not the master password)
  could rotate their apparent source IP (proxy pool, VPN, mobile network
  churn) to make unlimited current-password guesses against
  `change_password.php`, defeating the rate limit's purpose. **Fixed:**
  the bucket is now keyed on the user ID alone
  (`backend-php/public_html/api/change_password.php`). This endpoint
  already requires a valid session, so the ID isn't attacker-controlled;
  IP added no security value, only a bypass surface. (For comparison,
  `login.php`'s per-account bucket was already keyed on the email hash
  alone, with no IP component — it didn't have this bug.)

- **Medium — ambiguous client state on a network failure during
  change-password or a vault save.** If the connection dropped after the
  server had already committed a change but before the client received
  the response, the client had no way to distinguish "the request failed"
  from "it succeeded but the response was lost," and reported a plain
  failure. For change-password specifically, this could strand a user in
  a confusing state: retrying with what they believe is their current
  password would be rejected as "incorrect," because the server had
  already rotated to the new one. For a vault save, retrying could
  silently create a duplicate entry. **Fixed:** on a network-level
  failure (not a clean HTTP error response) during these two operations,
  the client now checks before reporting failure instead of assuming it —
  `Dashboard.jsx` re-fetches the vault's revision and reports success (not
  failure) if the write demonstrably landed; `Settings.jsx`, where a
  corroborating check isn't safely possible without knowing the new
  password, now says explicitly that the outcome is unknown and to try
  signing in with the *new* password before retrying with the old one,
  rather than implying nothing happened.

- **Low / informational — login and register have no CSRF check, by
  design** (there's no session yet at that point to double-submit
  against). Reviewed specifically for exploitability as "login CSRF": a
  cross-site attacker can't complete a working forgery here through a
  plain HTML form (blocked because the endpoint requires a JSON request
  body, which forms cannot produce) or through cross-origin `fetch`/`XHR`
  (blocked by the browser's CORS preflight, since the app sends no
  `Access-Control-Allow-Origin` permitting any cross-origin caller). No
  code change — but this protection is currently an *incidental* result
  of requiring JSON bodies and configuring no CORS policy, not an
  explicit control. Noted here as a dependency to be aware of if CORS is
  ever introduced for any reason (e.g. to support a future companion app).

- **Low / theoretical — the login-salt lookup's fake-account path does
  marginally more work than the real-account path** (the same indexed
  database query either way, plus one extra HMAC-SHA256 computation on
  the not-found path to build the deterministic fake salt). The resulting
  timing difference, if anything, makes real accounts respond *faster*,
  which is the safe direction, and is a computation on the order of
  microseconds — almost certainly undetectable under real network
  latency/jitter. No fix applied; noted as available headroom for future
  hardening (e.g. always computing the HMAC and discarding it on the
  found-account path), not a practical enumeration vector today.

- **Confirmed correct — specifically checked, nothing to fix:**
  - No key or plaintext reaches the server in any code path (traced every
    network call in `frontend/src/crypto/` and `frontend/src/api/client.js`).
  - Every AES-GCM encryption uses a freshly generated random IV, never
    cached or reused (confirmed by code review and by an automated test
    asserting two encryptions of identical plaintext produce different
    IVs/ciphertext).
  - The session ID regenerates on every authentication event — register,
    login, unlock, and password change — closing the standard
    session-fixation vector; no path establishes an authenticated session
    without regenerating first.
  - Every mutating endpoint operating on an existing session enforces the
    double-submit CSRF check; the only two without it (register, login)
    are the documented, reasoned exception above.
  - Every database query touching `vaults` or `users` is scoped to
    `$userId` from the server-side session (`pk_require_auth()`), never
    from client-supplied input — there is no endpoint in this codebase
    that accepts an ID selecting *whose* row to read or write. No
    cross-user vault access path exists.
  - Login and login-salt are enumeration-resistant for account existence:
    identical error messages, a deliberately equalized-cost dummy
    computation on the not-found path, and a deterministic fake salt
    response. Registration's "email already exists" conflict is the one
    deliberate exception to this — see `docs/THREAT-MODEL.md` for why
    that's a different, lower-stakes case, not an oversight.

### Known limitations carried forward

Not defects — accepted, documented trade-offs. See README.md's "Security"
section and `docs/THREAT-MODEL.md` for the full reasoning:

- A compromised server can still serve tampered JavaScript and capture the
  master password directly as it's typed; no purely browser-based
  zero-knowledge design can fully close this.
- No two-factor authentication yet (the schema reserves a column for it;
  no TOTP flow exists).
- No cross-device session revocation — native PHP sessions have no
  central index by user, so a password change rotates the current
  session but can't reach into others.
- Offline brute-force resistance is bounded by the master password's
  strength; Argon2id raises the cost per guess, it doesn't make a weak
  password safe against a stolen database.
