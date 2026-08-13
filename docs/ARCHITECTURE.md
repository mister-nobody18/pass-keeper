# Architecture: PHP / MySQL migration

**Status: implemented, backend and frontend both.** `backend-php/` implements
the target architecture as approved, plus one deviation adopted during
implementation (native PHP sessions instead of a custom `sessions` table —
see the callout in §3). `frontend/` now performs all cryptography client-side
and talks to `backend-php/`'s endpoints — see §5 for the full client crypto
flow, exact parameters, measured timings, and a diagram of what actually
crosses the network. §6 documents the envelope-encryption (DEK) model that
underlies the master-password reset feature, and what crosses the network
for that flow specifically. The Node prototype (`backend/`) is not yet
decommissioned; see `README.md` "Project status."

This document is the detailed companion to the summary in `README.md`. It covers
the reasoning behind the target design, exactly what carries over from the current
Node.js prototype versus what gets rebuilt, the MySQL schema, and a migration
checklist.

See `docs/THREAT-MODEL.md` for what this design does and does not protect against.

---

## 1. Why this shape

The current prototype (`backend/`, Express + better-sqlite3 + native `argon2`)
assumes a long-running Node process: it holds each session's decrypted vault key
in an in-memory `Map` (`backend/src/services/session.service.js`) and does the
Argon2id key derivation *on the server*, using the master password the browser
sends it over TLS at login.

None of that is available on the target host:

- **No persistent process** → nothing can hold decrypted key material in server
  memory across requests. Every PHP request starts cold and ends cold.
- **No Redis** → no shared, fast, ephemeral store for session or rate-limit state.
  MySQL has to do that job instead.
- **No Node, no SSH** → no server-side JavaScript runtime, and no way to run
  `composer install` or a build step *on the host*. Anything that needs building
  (the frontend bundle, vendored PHP dependencies) has to be built **before**
  it's uploaded, from a developer machine or CI.

Rather than working around these constraints to preserve the old design, the
target architecture removes the reason they'd matter: **the server is never
trusted with anything that would need protecting in memory.** All key
derivation and encryption happens in the browser. The PHP backend's job shrinks
to: verify who you are, store an opaque encrypted blob, hand it back. That's a
better fit for stateless, shared-hosting PHP than trying to reconstruct a
long-lived Node process would ever be — this isn't a workaround, it's a
stricter and simpler trust model than the prototype had.

### The crypto flow

```
Browser (registration / login)
  masterPassword ──argon2id (WASM, per-user salt)──▶ masterKey
  masterKey ──HKDF──┬──▶ authHash        (sent to server, proves identity)
                     └──▶ encryptionKey  (never sent anywhere, kept in JS memory only)

Server (PHP)
  authHash ──password_hash(PASSWORD_ARGON2ID)──▶ stored, compared on login
  (server never sees masterPassword or encryptionKey)

Browser (using the vault)
  vault (all entries) ──serialize to JSON──▶ AES-256-GCM (WebCrypto, encryptionKey) ──▶ ciphertext blob
  ciphertext blob ──PUT──▶ server, stored as-is
  ciphertext blob ──GET──▶ decrypted client-side back into the vault object
```

Two points worth calling out explicitly because they're easy to get wrong:

- **`authHash` is hashed *again* server-side** (`password_hash($authHash,
  PASSWORD_ARGON2ID)`) before being stored, mirroring what the current backend
  already does with the raw master password. This isn't redundant: `authHash`
  is itself a bearer credential (whoever has it can log in), so a stolen
  `users` table shouldn't hand it over in usable form. The stored value is a
  slow-hash of a value the browser derived from Argon2id, not the raw
  `authHash` itself.
- **This does not add real protection to the *vault* against a stolen
  database.** An attacker with the DB has the ciphertext and the KDF salt.
  Their attack is: guess a master password, run the same Argon2id + HKDF the
  browser would, get a candidate `encryptionKey`, try to open the AES-GCM
  blob (the auth tag tells them instantly if they guessed right). The
  server-side re-hash of `authHash` doesn't slow this down, because it's a
  different derived value and the attacker doesn't need to touch it — they
  only need the master password to work through the browser's own KDF. This
  is the same offline-attack shape every zero-knowledge password manager has;
  see `docs/THREAT-MODEL.md`. The point of the double-hash is narrower and
  still real: it stops a stolen DB being *directly replayable as a login
  credential*, which is a distinct property from vault confidentiality.

### Why a single encrypted blob, not per-field encryption

The current backend encrypts each vault entry's password/notes as separate
columns (`vault_entries.encrypted_password`, `.encrypted_notes`) and does
per-entry CRUD. The target design encrypts the **entire vault as one JSON
document**, per your spec. Trade-off, stated plainly:

- **Gained:** much simpler client crypto code (one encrypt/decrypt path, not
  one per field), no server-side schema for entry fields at all (server
  is genuinely blind to structure, not just content), trivial to add new
  entry fields later without a migration (they just live in the JSON).
- **Lost:** every save re-encrypts and re-uploads the *whole* vault, not just
  the one entry that changed. No server-side pagination, sorting, or search —
  the client downloads and decrypts everything on load. No natural way for
  two devices to make concurrent edits without one clobbering the other
  (addressed with an optimistic-concurrency `revision` column — see schema
  below — which turns a silent data loss into a visible "someone else saved
  changes, reload" error, but doesn't merge them).

This is the right trade for "small population, possible growth later." It
would start to hurt if a single user's vault grew into the thousands of
entries or if real-time multi-device concurrent editing became a requirement —
see §3 for the explicit scale ceiling.

---

## 2. What carries over vs. what's rebuilt

### Carries over almost unchanged

| Piece | Why |
|---|---|
| **Entire frontend design system** — Tailwind config, CSS custom-property tokens, `components/ui/*` primitives (Button, Input, Panel, Modal, Badge, Toast, PasswordStrengthMeter, AgeBadge), the self-hosted JetBrains Mono font, lucide-react icons | Pure client-side code with no dependency on the Node backend. It talks to "an API" through `api/client.js` — that file is the only seam. |
| **`utils/passwordStrength.js`, `commonPasswords.js`** | Already 100% client-side, framework-agnostic logic. |
| **Auto-lock (`VaultLockContext`), clipboard-clear-timer, hold-or-toggle password reveal** | Client-only UX state, doesn't touch the server at all. |
| **Per-entry age/rotation indicator concept** | Rebuilt in the sense that it now reads `createdAt`/`updatedAt` from fields *inside* the decrypted JSON blob instead of from an API response — but the display component and logic (`AgeBadge`, `utils/time.js`) carry over unchanged. |
| **CSP posture, security-header philosophy, CSRF double-submit pattern, rate-limiting-on-auth-endpoints philosophy** | The *shape* of these carries over; the *implementation* is rewritten in PHP (see below) because there's no `helmet`, no `express-rate-limit`, no Express middleware chain. |
| **Design principle: minimal dependencies, hand-rolled auditable code over pulling in libraries** | The Node backend already avoided a UI library and a strength-meter dependency; the PHP backend should hold the same line — see §4 and `CONTRIBUTING.md`. |
| **Dev-loop shape**: local dev server + a build step before anything ships | Same idea, different tool: `vite dev` still runs locally against a local PHP server instead of the Node backend. |

### Rebuilt (new implementation, same or stricter intent)

| Piece | Old (Node) | New (PHP target) | Why it changes |
|---|---|---|---|
| Password/key derivation | Argon2id **on the server**, from the raw master password sent over TLS | Argon2id **in the browser** (WASM), server only ever sees a derived `authHash` | Stricter zero-knowledge property: the server should never see the master password, not even transiently. |
| Vault encryption | AES-256-GCM per-field, server-side (Node `crypto`) | AES-256-GCM on the whole vault blob, client-side (WebCrypto) | Server must be crypto-blind; single-blob model per spec. |
| Session / key custody | Signed cookie + session ID → in-memory `Map` holding the decrypted DEK | Signed cookie + session ID → **`sessions` table row**, and the table **never contains key material**, only proof-of-login | No persistent process to hold memory in; and there's no DEK to hold server-side any more at all — the encryption key never leaves the browser tab. |
| Rate limiting | `express-rate-limit`, in-memory | `rate_limits` MySQL table, fixed-window counters via atomic `INSERT … ON DUPLICATE KEY UPDATE` | No Redis, no in-memory process. |
| CSRF | Hand-rolled double-submit cookie (Node) | Hand-rolled double-submit cookie (PHP) — same protocol, new implementation | No framework dependency either side; logic ports directly. |
| Security headers | `helmet()` with an explicit CSP | Manually set headers in a PHP bootstrap (or via `.htaccess` where LiteSpeed honors it) | No `helmet` equivalent in plain PHP; must be set by hand and must add `'wasm-unsafe-eval'` to `script-src` for the Argon2id WASM module (see §4). |
| Secrets / config | `.env` + `dotenv` | Git-ignored `config/secrets.php` returning a PHP array, outside or access-denied within the web root | Shared hosting has no reliable process-env injection without shell access; PHP-native config file is the standard pattern. |
| DB access | `better-sqlite3`, prepared statements | `PDO` against MySQL, prepared statements | SQLite → MySQL is a hosting requirement, not a design choice. |
| Frontend build & deploy | `vite build` output served *by* the Node app | `vite build` output uploaded as static files, served by LiteSpeed directly | No Node process on the host to run or serve from. |
| API shape | Per-entry CRUD (`GET/POST/PUT/DELETE /api/vault/:id`) | Whole-blob `GET /api/vault` (returns ciphertext + revision) and `PUT /api/vault` (compare-and-swap on revision) | Follows from the single-blob storage model. |

### Eliminated outright (not carried over, not rebuilt — no longer needed)

- `session.service.js`'s entire reason for existing (holding a decrypted key
  server-side) goes away. Sessions become pure "who is this" tokens.
- Server-side per-field `encryptField`/`decryptField` (`crypto.service.js`) —
  there is no server-side encryption at all in the target design.
- The "unwrap DEK at login" step — there is no DEK for the server to unwrap;
  the browser derives its own encryption key directly and never sends it.

---

## 3. MySQL schema

> **Implementation deviation from the original draft below:** the `sessions`
> table originally sketched here was **not built**. The implementation in
> `backend-php/` uses PHP's native session mechanism instead — a specific,
> explicit request when the backend was implemented ("PHP sessions:
> httponly, secure, samesite=Strict, non-default cookie name, session ID
> regenerated on login"). Native sessions satisfy all of that directly, at
> the cost of one real capability this table would have given: centralized,
> cross-device session revocation (e.g. "sign out everywhere" after a
> password change). See `CONTRIBUTING.md` for exactly what that trade-off
> means in practice and how to reintroduce this table later if cross-device
> revocation becomes a requirement. The `users`, `vaults`, and `rate_limits`
> tables below match what's actually running in `backend-php/schema.sql`
> (with two small refinements: `kdf_salt`/`kdf_params` are `VARCHAR`, not
> `VARBINARY`, since the browser is free to encode them however it likes —
> the server only ever stores and returns them verbatim).
>
> **Second deviation, added with the password-reset feature (§6):** `users`
> gained `wrapped_dek_password`, `wrapped_dek_recovery` (nullable), and
> `recovery_key_created_at` (nullable) — the opaque, wrapped copies of the
> vault's DEK, never key material the server could act on. A new
> `password_resets` table was added, matching the shape sketched for the
> original `sessions` table's `token_hash` column (hash, not raw token; see
> §6). See `backend-php/schema.sql` for the exact, current DDL — it is the
> source of truth; the excerpt below is illustrative of the original design
> and does not repeat every column added since.

```sql
CREATE TABLE users (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email           VARCHAR(255) NOT NULL,
    auth_hash       VARCHAR(255) NOT NULL,      -- password_hash(clientAuthHash, PASSWORD_ARGON2ID)
    kdf_salt        VARBINARY(32) NOT NULL,     -- random per-user salt, used by the BROWSER's Argon2id; server never uses it cryptographically
    kdf_params      VARCHAR(191) NOT NULL,      -- e.g. '{"m":65536,"t":3,"p":1,"v":1}' — versioned so params can be upgraded later without breaking existing users
    failed_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    locked_until    DATETIME NULL,              -- defense-in-depth account lock, separate from the rate_limits table
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vaults (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT UNSIGNED NOT NULL,
    ciphertext      LONGTEXT NOT NULL,          -- opaque envelope (iv + AES-256-GCM ciphertext + tag), base64/JSON — server never parses this
    schema_version  SMALLINT UNSIGNED NOT NULL DEFAULT 1,  -- internal shape of the DECRYPTED blob, so the client can evolve it later
    revision        INT UNSIGNED NOT NULL DEFAULT 1,       -- optimistic-concurrency token: client must send back the revision it read
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_vaults_user_id (user_id),
    CONSTRAINT fk_vaults_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sessions (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token_hash      CHAR(64) NOT NULL,          -- SHA-256 hex of the session token; the raw token only ever exists client-side + in-transit, never stored
    csrf_token      CHAR(43) NOT NULL,          -- double-submit CSRF token issued alongside the session
    user_id         BIGINT UNSIGNED NOT NULL,
    ip_hash         CHAR(64) NULL,              -- SHA-256 of the request IP, for anomaly display only — not used for access control
    user_agent      VARCHAR(255) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      DATETIME NOT NULL,

    UNIQUE KEY uq_sessions_token_hash (token_hash),
    KEY idx_sessions_user_id (user_id),
    KEY idx_sessions_expires_at (expires_at),   -- for the cleanup query
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rate_limits (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bucket_key      VARCHAR(255) NOT NULL,      -- e.g. 'login:ip:203.0.113.4' or 'login:email:<sha256 of email>'
    window_start    DATETIME NOT NULL,          -- request time truncated to the bucket window (e.g. floor to 15 minutes)
    attempt_count   INT UNSIGNED NOT NULL DEFAULT 1,

    UNIQUE KEY uq_rate_limits_bucket (bucket_key, window_start),
    KEY idx_rate_limits_window_start (window_start)  -- for the cleanup query
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Notes:

- **Fixed-window rate limiting**, not sliding: on each attempt, compute
  `window_start = FLOOR(UNIX_TIMESTAMP(NOW()) / 900) * 900` (15-minute
  windows) and `INSERT … ON DUPLICATE KEY UPDATE attempt_count =
  attempt_count + 1`. This is atomic under InnoDB (no race condition between
  concurrent requests), and simple enough to reason about without a
  background process. It's slightly more permissive at window boundaries
  than a true sliding window (`express-rate-limit`'s default) — acceptable
  at this scale.
- **No cron dependency by default.** Old `rate_limits` rows are deleted
  lazily (`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL 1
  DAY`) as part of the same request that writes a new one, so the table
  self-prunes without needing a scheduled job. The same applies to expired
  `sessions` rows. If DirectAdmin cron is available, a nightly cleanup job
  is a nice-to-have belt-and-suspenders, not a requirement.
- **`sessions.token_hash`, not the raw token.** The cookie sent to the
  browser is opaque and unpredictable (32+ bytes of `random_bytes()`); only
  its SHA-256 is stored, the same reasoning as storing a password hash
  instead of a password — a read-only DB leak (backup theft, blind SQLi)
  shouldn't hand over live, directly-usable session tokens.
- **`vaults.revision`** is the optimistic-concurrency guard mentioned in
  §1. Write path: `UPDATE vaults SET ciphertext = ?, revision = revision + 1
  WHERE user_id = ? AND revision = ?` (the client's last-known revision).
  Zero rows affected means someone else saved in the meantime — surface that
  to the user rather than silently overwriting their change.
- **Passwords/keys never appear in this schema.** `kdf_salt` is public
  (salts always are) and `kdf_params` is public by design (the browser needs
  it to recompute the same derivation) — neither is secret, and their
  exposure via a DB leak is expected and harmless on its own.

### Where this strains at scale

This schema and the single-blob model are sized for "small population,
possible growth later," not for becoming a multi-tenant SaaS. Concretely:

- **Whole-vault read/write.** Every save transmits, encrypts, and stores the
  *entire* vault, and every load downloads and decrypts the entire thing.
  Fine up to (rough, hardware-dependent) low thousands of entries / a couple
  MB of JSON; beyond that, client-side latency (not MySQL) is the first
  thing to degrade. `LONGTEXT` itself tops out at 4 GB and won't be the
  bottleneck.
- **No server-side search, filter, or pagination is possible, ever**, by
  design — the server cannot see inside the blob. This is an inherent
  ceiling of the zero-knowledge single-blob model, not something a bigger
  server fixes. If that becomes a real problem, the fix is architectural
  (e.g., per-entry encrypted rows with an encrypted-but-indexable metadata
  layer), not a scaling tweak.
- **No real multi-device concurrent editing.** `revision` prevents silent
  data loss but doesn't merge concurrent edits — two devices editing
  offline and syncing later will require one of them to reload and redo
  their change. Acceptable for a small population using one device at a
  time; would need real conflict resolution (or per-entry storage) to grow
  past that.
- **`rate_limits` and `sessions` row counts** scale with login attempts and
  active sessions, both naturally small at this population size; the lazy
  cleanup keeps them bounded regardless.
- **Shared-hosting MySQL** (no connection pooling, no tuning control, often
  a shared instance) is fine for low request volume; it's the first thing
  to hit a ceiling if usage grows substantially, well before this schema's
  own design would be the limiting factor.

---

## 4. Migration checklist

1. **Confirm hosting capabilities before writing any code.** Specifically:
   PHP version and whether `password_hash()` supports `PASSWORD_ARGON2ID`
   (needs PHP built with libargon2 — not universal on shared hosts; if
   unavailable, the fallback is `PASSWORD_BCRYPT` with a documented,
   deliberate trade-off, see `docs/THREAT-MODEL.md`); `pdo_mysql` and
   `openssl` extensions enabled; whether `.htaccess` overrides are honored
   under LiteSpeed (needed for security headers and clean URLs); whether
   cron jobs are available via the DirectAdmin panel (nice-to-have, not
   required per §3); whether file transfer is possible at all without SSH
   (DirectAdmin File Manager and/or FTP/SFTP — note that SFTP-the-file-
   -protocol is sometimes available even when interactive SSH shell access
   is disabled; confirm which applies here rather than assuming).
2. **This document + threat model reviewed and approved.** (You are here.)
3. **Provision the MySQL database** and apply the schema in §3 via
   DirectAdmin's MySQL/phpMyAdmin tooling.
4. **Build the PHP backend skeleton**: a single front controller (or a
   small number of flat endpoint files, given the small surface area — no
   framework needed), a git-ignored `config/secrets.php`, a PDO connection
   helper, a security-headers bootstrap (CSP including `'wasm-unsafe-eval'`
   for the Argon2id WASM module, HSTS, `X-Content-Type-Options: nosniff`,
   etc.), CSRF helper, rate-limit helper, session helper. Zero Composer
   dependencies unless a clear need arises (see `CONTRIBUTING.md`) — if any
   are added, `vendor/` must be committed to git, since `composer install`
   can't run on the host without shell access.
5. **Implement auth endpoints**: `POST /register`, a salt-lookup step
   (`POST /auth/salt` or folded into a two-step login — see the user-
   enumeration note in `docs/THREAT-MODEL.md`), `POST /login`, `POST
   /logout`, `PUT /settings/password` (client re-encrypts the vault under a
   new key and submits new ciphertext + new `auth_hash` + new `kdf_salt`
   together).
6. **Implement vault endpoints**: `GET /vault` (returns ciphertext +
   `revision`), `PUT /vault` (compare-and-swap on `revision`).
7. **Frontend adaptation**:
   - Replace `frontend/src/api/client.js`'s endpoint calls/response shapes
     to match the new PHP API.
   - Add a client-side crypto module: Argon2id via a WASM library (e.g.
     `hash-wasm` or `libsodium.js` — pick one, vendor it, no runtime CDN
     fetch), HKDF via `SubtleCrypto.deriveBits` (native WebCrypto, no
     library needed), AES-256-GCM via `SubtleCrypto.encrypt`/`.decrypt`
     (native, no library needed).
   - Rework `Dashboard`/`EntryModal`/`VaultCard` to operate on an in-memory
     decrypted vault object (array of entries) with local mutations, plus
     an explicit/debounced "save whole vault" call, instead of per-entry
     API calls.
   - Re-verify the CSP still holds with WASM instantiation in the mix —
     this is the one concrete code-level CSP change already known to be
     needed (`script-src` needs `'wasm-unsafe-eval'`).
8. **Local dev without Node on the server**: PHP's built-in server (`php -S
   localhost:8000`) against a local MySQL instance, with the Vite dev
   server proxying `/api` to it — same shape as today's dev loop, different
   backend process.
9. **Build and deploy**: `vite build` locally/CI, upload `dist/` plus the
   PHP files via whatever transfer method was confirmed in step 1. No build
   step ever runs on the host itself.
10. **Data migration from the Node prototype.** The crypto scheme changes
    shape entirely (server-derived per-field keys → browser-derived
    single-blob keys), and the server was never meant to know any user's
    master password — so there is no automated path that re-encrypts
    existing data without user involvement. The realistic path: each
    existing user logs into the *old* app one last time, the old app
    exports a decrypted backup client-side (JSON download), the user then
    registers on the *new* app and imports that backup, which the new
    client immediately encrypts under a freshly-derived key. This should be
    a guided, one-time, per-user flow — not a bulk server-side migration
    script, since no such script could work without seeing every user's
    plaintext.
11. **Security review pass** against `docs/THREAT-MODEL.md` before go-live:
    CSP with WASM confirmed, rate limiting exercised under repeated
    attempts, session cookie flags confirmed (`HttpOnly`, `Secure`,
    `SameSite=Strict`), TLS enforced (redirect HTTP→HTTPS), `auth_hash`
    double-hashing confirmed, no verbose error output/stack traces reachable
    in production.
12. **Cut over and monitor** via DirectAdmin's log access; keep the Node
    prototype's repo history/branch archived for reference, don't delete it
    immediately after cutover.

---

## 5. Client crypto flow (implemented)

This section documents exactly what `frontend/src/crypto/` does, precisely
enough to audit against the actual code. See `CONTRIBUTING.md`'s "Crypto
parameters and primitives" section for the review requirement before
changing anything described here.

### Library choice

**Argon2id: [`libsodium-wrappers-sumo`](https://github.com/jedisct1/libsodium.js)**
(the WASM build of libsodium, via its `crypto_pwhash` API with
`crypto_pwhash_ALG_ARGON2ID13`). Not hand-implemented, per the requirement
that ruled this out from the start — libsodium is one of the two
established options named for this project, and is the one actually used.

One thing worth recording since it cost real time to discover: the
**non-sumo** `libsodium-wrappers` package does *not* include `crypto_pwhash`
at all — only `libsodium-wrappers-sumo` does. If a future dependency bump or
a "let's trim the bundle" change swaps to the smaller package, Argon2id
silently stops existing on the object and every derivation throws. This is
exactly the kind of change CONTRIBUTING.md's crypto-parameters rule exists
to catch before it ships.

**HKDF: native `SubtleCrypto.deriveBits({name: 'HKDF', ...})`.** No
library — WebCrypto has this built in, so writing one would violate "do not
implement any primitive by hand" in the other direction (there's no reason
to hand-roll what the platform already provides correctly).

**AES-256-GCM: native `SubtleCrypto.encrypt`/`.decrypt`.** Same reasoning.

### The full pipeline

```
                    ┌─────────────────────────────────────────────┐
                    │   Web Worker (crypto/kdfWorker.js)           │
                    │                                               │
  password  ───────▶│  sodium.crypto_pwhash(                       │
  kdfSalt  ─────────│      32, password, salt,                     │
  kdfParams ────────│      iterations, memory,                     │
                    │      ALG_ARGON2ID13)                         │
                    │        │                                     │
                    │        ▼ masterKey (32 bytes)                │
                    │  crypto.subtle.importKey('raw', masterKey,   │
                    │      'HKDF', false, ['deriveBits'])          │
                    │        │                                     │
                    │        ├─ deriveBits(info="pass-keeper-auth-v1")│
                    │        │     └─▶ authHash (32 bytes → base64)│
                    │        │                                     │
                    │        └─ deriveBits(info="pass-keeper-enc-v1")│
                    │              └─▶ importKey('raw', ..., 'AES-GCM',│
                    │                    extractable: false,        │
                    │                    usages: wrapKey/unwrapKey) │
                    │                    └─▶ passwordWrapKey (CryptoKey)│
                    └─────────────────────────────────────────────┘
                                 │ postMessage (structured clone)
                                 ▼
                    Main thread (crypto/kdfClient.js)
                         │                    │
                         │ authHash           │ passwordWrapKey (CryptoKey,
                         ▼                    │  non-extractable, wrapKey/unwrapKey only)
                  sent to server              ▼
                  (proves identity)    crypto/dek.js
                                        unwrapDek(wrappedDekPassword, passwordWrapKey)
                                        → DEK (CryptoKey, non-extractable,
                                          the SAME key regardless of which
                                          wrap unlocked it - see §6)
                                               │
                                               ▼
                                        crypto/vaultKeyStore.js
                                        (module-level variable only;
                                         never persisted anywhere)
                                               │
                                               ▼
                                 crypto/vaultCipher.js
                                 encryptVault(entries, DEK):
                                   iv = crypto.getRandomValues(12 bytes)  ← fresh every call
                                   ciphertext = subtle.encrypt('AES-GCM', {iv}, DEK, JSON(entries))
                                   → {"v":1,"iv":"<b64>","data":"<b64>"}  ← this string is what's sent/stored
```

**This is an envelope-encryption model, not a direct one** — as of the
master-password-reset feature (see §6), the key derived above no longer
encrypts the vault directly. It only wraps (via native `crypto.subtle.
wrapKey()`/`unwrapKey()`) a separate, random Data Encryption Key (the DEK),
which is what actually encrypts the vault. This indirection is what makes a
password reset possible without losing data: the *same* DEK can be wrapped
under more than one independently-derived key (the password, and optionally
a recovery key), so unwrapping it via either one yields an identical vault
key, and the vault ciphertext itself never has to move or be re-encrypted
when only *how* the DEK is protected changes. Before this feature, the
derived key encrypted the vault directly — the box above showing
`encryptionKey`/`passwordWrapKey` naming reflects that the same derivation
pipeline now produces a *wrapping* key rather than an *encrypting* one; see
§6 for the full reasoning and the reset flow itself.

**Why a Web Worker, specifically.** Argon2id at these parameters takes
roughly a second on real hardware (see "Parameters and measured timings"
below) and there is no way to make a memory-hard KDF fast — that cost is
the entire point of using one. Running it inline on the main thread would
freeze all interaction for that whole window on every register/login/
unlock/password-change. Routing it through a dedicated worker
(`new Worker(new URL('./kdfWorker.js', import.meta.url), {type: 'module'})`,
the standard Vite worker pattern) means the main thread stays free to
render the loading state described below, and — as a secondary but real
benefit — the raw master-key and encryption-key bytes are computed and
consumed entirely inside the worker's own heap. Only the finished,
non-extractable `CryptoKey` and the (already one-way-derived) `authHash`
string cross back to the page, via `postMessage`'s structured-clone
algorithm, which supports `CryptoKey` as a live, still-non-extractable
object — not as exported raw bytes.

### Parameters and measured timings

```json
{ "algorithm": "argon2id", "memory": 65536, "iterations": 3, "parallelism": 1 }
```

- `memory`: 65536 **KiB** = 64 MiB
- `iterations` (Argon2's time cost): 3
- `parallelism`: 1 — fixed by libsodium's `crypto_pwhash` API (it doesn't
  expose a parallelism parameter; browser Argon2id implementations
  generally don't, since real parallelism would need multiple WASM
  threads/`SharedArrayBuffer`, which isn't assumed available here). Stored
  anyway for forward-compatibility if that ever changes.
- Output: 32 bytes (256-bit master key, before HKDF splits it)
- Salt: 16 random bytes (`crypto.getRandomValues`) — libsodium's
  `crypto_pwhash_argon2id_SALTBYTES` is fixed at 16, not variable

**Measured, not guessed:** 160ms average (5 runs) for exactly this
(memory, iterations) pair, using this exact library, in real headless
Chromium — not Node's WASM runtime, though the two were within a few ms of
each other — on an AMD Ryzen 7 4800H desktop. That number by itself doesn't
answer the actual question, which is mid-range-phone timing. Extrapolating
with a conservative 6x mobile-slowdown multiplier (desktop-class CPUs are
commonly 4-8x faster single-thread than a 2021-2023 mid-tier phone chipset
for this kind of sustained memory-hard workload) gives an estimated
**~950ms-1.1s on a mid-range phone** — inside the "a second or two" target.

**This estimate has not been validated on physical mobile hardware** — that
would need someone to actually run it on a real device. Treat the 6x figure
as a documented, falsifiable starting point, not a measurement, and correct
it here once real device numbers exist.

**Per-user, versioned, upgradeable without breaking old accounts:** these
parameters are not a hardcoded constant the server enforces — they're
`kdfParams`, stored per-user (`users.kdf_params` in MySQL, returned by
`GET /login_salt.php`) and supplied by the *account*, not by
`DEFAULT_KDF_PARAMS`, at every derivation except registration. `DEFAULT_KDF_PARAMS`
(`frontend/src/crypto/kdfClient.js`) is used only when: (a) a new account
registers, or (b) an existing account changes its master password — both
moments where a *fresh* derivation naturally happens anyway. Raising these
parameters later (e.g., to 96 MiB once mid-range phones in the field are
faster) means changing `DEFAULT_KDF_PARAMS` and `backend-php/config/config.php`'s
`fake_kdf_params` together — existing accounts keep working at their
original parameters until they next change their password, at which point
they silently re-key under the new default. No migration script, no forced
mass re-key, no breakage.

### Key custody: where the encryption key lives, and doesn't

This describes the vault's actual encryption key — the DEK (§6) — which is
what ends up in `vaultKeyStore.js`. The password- and recovery-derived
*wrapping* keys that unlock it are shorter-lived: held only for the single
`wrapKey`/`unwrapKey` call that needs them, then left to be garbage
collected, never placed in `vaultKeyStore.js` themselves.

- **Never** `localStorage`, `sessionStorage`, `IndexedDB`, or a cookie —
  nothing that survives past the JS runtime of this exact tab.
- **Only** a module-level variable in `crypto/vaultKeyStore.js`, deliberately
  outside React state or context (React DevTools can inspect component
  state/context values; a secret living there would be visible to anyone
  with devtools access, which a plain module closure isn't).
- **Non-extractable by construction, in normal use.** `unwrapDek()`
  (`crypto/dek.js`) always produces the DEK with `extractable: false` — even
  code holding a direct reference to it cannot call `exportKey()` and
  recover raw bytes; it can only be handed to `encrypt`/`decrypt`. The one
  narrow exception is `unwrapDekForRewrap()`, used only by the
  change-password and recovery-key-rotation flows, which need an
  `extractable: true` copy transiently because WebCrypto's `wrapKey()`
  requires it of its source key — see §6.
- **Wiped** on: `lock()` (idle timeout or manual "Lock vault now"),
  `logout()`, and tab close/hide (`pagehide`/`beforeunload` listeners in
  `vaultKeyStore.js`). It is *also*, unavoidably, wiped by any page
  **reload** — all JS module state resets on a fresh load regardless of
  those listeners, which is why `VaultLockContext` initializes `locked` from
  `!hasVaultKey()` rather than assuming a prior session state. A page reload
  with a still-valid server session shows the "unlock" prompt with the known
  email pre-filled (via the `GET /me.php` identity check), not a blank login
  form — but it always re-derives the key from the password. There is no
  "remember me across reloads" for the encryption key, by design.
- **Honest limitation:** none of the above is a hard cryptographic
  guarantee. JavaScript gives applications no real control over memory — the
  engine's garbage collector may have already copied bytes elsewhere before
  a `.fill(0)` call runs, and V8/JS engines make no promise that
  "unreferenced" means "erased." Zeroing transient typed arrays
  (`crypto/kdfWorker.js`) is the standard available best-effort practice,
  documented here as exactly that: best-effort, not a proof.

### What crosses the network — and what never does

```
                    Browser                                    Server (PHP/MySQL)
                    ═══════                                    ═══════════════════

  master password ─────X  NEVER SENT. Never leaves the KDF pipeline above.

  encryption key ──────X  NEVER SENT. Non-extractable, memory-only (see above).

  authHash ─────────────────▶  POST /register.php, /login.php
                                 (server re-hashes with password_hash()
                                  + a server-side pepper before storing —
                                  see §1's "double-hash" note)

  kdfSalt, kdfParams ───────▶  POST /register.php  (client-generated,
                                 opaque to the server, stored verbatim)
                    ◀───────────  GET /login_salt.php
                                 (server returns the account's stored salt/
                                  params - or a deterministic fake pair for
                                  a nonexistent email, see THREAT-MODEL.md)

  vault ciphertext ─────────▶  PUT /vault.php, /register.php,
                                 /password_reset_confirm.php (destructive mode)
                                 ({"v":1,"iv":"...","data":"..."} - the
                                  server stores this string opaquely and
                                  never parses it)
                    ◀───────────  GET /vault.php
                                 (same opaque string, handed back verbatim)

  wrapped DEK ───────────────▶  POST /register.php, PUT /change_password.php,
  (password- and/or             PUT /recovery_key.php, POST /password_reset_confirm.php
  recovery-wrapped,              ({"v":1,"iv":"...","data":"..."} - same opaque
  each independently             envelope shape as vault ciphertext, but wrapping
  {"v":1,"iv":...,"data":...})   32 raw bytes instead of JSON - see §6)
                    ◀───────────  GET /login.php, GET /me.php,
                                 GET /password_reset_verify.php (recovery wrap only)

  session cookie ◀──▶            HttpOnly, Secure (prod), SameSite=Strict -
                                 proves *who*, carries no key material
  CSRF token     ◀──▶            double-submit cookie + header, see
                                 backend-php's lib/csrf.php
```

Everything under the double line is what an on-path observer (or a
compromised/curious server, per `docs/THREAT-MODEL.md` §1) can see. Notice
what's absent from that list: the master password, the encryption key, and
plaintext vault contents never appear on the wire in any form, at any point
in this flow — not encrypted-then-decrypted-server-side, not in a header,
not in a log-friendly query string. The server's view of a user's vault is
permanently limited to "an opaque string got PUT, and later GET, unchanged."

### Wrong-password / decryption-failure handling

`crypto/vaultCipher.js` wraps every `crypto.subtle.decrypt()` call and
**always** throws a typed `VaultDecryptionError` with a human-readable
message on failure — never a raw `DOMException`, never an unhandled
rejection. AES-GCM deliberately doesn't distinguish "wrong key" from
"tampered/corrupted ciphertext" (that's the point of an authenticated
cipher — see `docs/THREAT-MODEL.md`), so neither does this function; callers
decide what the failure means in their context:

- **Login and unlock** never actually reach this code path on a wrong
  password in the normal case — the server's `authHash` check
  (`POST /login.php`) rejects a wrong password first, with the standard
  enumeration-safe `"Invalid email or password."` message, before any
  vault ciphertext is even fetched.
- **Change-password** (`pages/Settings.jsx`) deliberately *does* exercise
  this path on purpose: it re-derives the *current* key from the typed
  current password and immediately uses it to decrypt the real vault,
  before deriving anything new or contacting the server for the actual
  change. A wrong current password fails right here, as an ordinary caught
  `VaultDecryptionError`, surfaced as `"Current password is incorrect."` —
  this is the concrete case the "handle the wrong-password case cleanly"
  requirement is about, and it's covered by an automated end-to-end test
  (register → add entry → reload → wrong password → clean error → correct
  password → change password → old password rejected, new password
  decrypts correctly).
- **A stale key after a password change on another device** is the other
  realistic way this fires: `pages/Dashboard.jsx` catches
  `VaultDecryptionError` specifically and calls `lock()` rather than
  showing a raw error over an otherwise-navigable page — the user sees the
  lock screen and a toast asking them to re-enter their (now-current)
  password, not a broken dashboard.

### Loading state during key derivation

Every call site that triggers a derivation (`Login.jsx`, `Register.jsx`,
`LockScreen.jsx`, `Settings.jsx`) passes an `onPhase` callback into the
relevant `AuthContext`/`VaultLockContext` function and renders a
phase-aware button label (`"Deriving key…"` while the worker runs Argon2id,
then `"Signing in…"` / `"Creating account…"` / `"Unlocking…"` /
`"Saving…"` once the network request starts), plus a small explanatory line
under the button while deriving specifically
("Running Argon2id locally in your browser — this takes a second."). Inputs
are disabled for the duration. Because the derivation runs in a worker (see
above), this loading UI stays responsive and animated for the full ~1s
rather than freezing along with the computation.

### File map

```
frontend/src/crypto/
├── base64.js          ArrayBuffer/Uint8Array <-> base64 (encoding, not a crypto primitive)
├── kdfWorker.js        Runs INSIDE the Web Worker: Argon2id + HKDF + AES-GCM key import
├── kdfClient.js         Main-thread interface to the worker; DEFAULT_KDF_PARAMS lives here
├── dek.js               Generates/wraps/unwraps the vault's DEK - see §6
├── recoveryKey.js        Generates/parses the recovery key, derives its wrap key - see §6
├── vaultCipher.js       AES-256-GCM encrypt/decrypt of the whole vault blob (main thread - fast)
└── vaultKeyStore.js     The one place the vault's DEK is held; never persisted
```

---

## 6. Envelope encryption and the password-reset flow

**Status: implemented.** This section documents the DEK/envelope model
introduced for master-password reset — how it's a strict superset of §5's
model (nothing about Argon2id, HKDF, or AES-GCM parameters changed; only
what the derived key is *used for* did), and exactly what the reset flow
sends over the network.

### Why an envelope, not a direct key

Before this feature, `encryptionKey` (§5) encrypted the vault directly. That
makes recovery structurally impossible: nothing but the master password
could ever produce that exact key again, so a lost password meant a lost
vault, full stop — the honest state the original README warning described.

A recovery key can't retroactively unlock something it was never involved
in wrapping. The fix is one level of indirection: introduce a random Data
Encryption Key (the DEK) that actually encrypts the vault, and wrap
(encrypt) *that* under one or more independently-derived keys — one from
the master password, optionally a second from a recovery key. Either one
alone unwraps the identical DEK, so either one alone can decrypt the vault.
Nothing about vault confidentiality against a stolen database changes: an
attacker still needs to either guess the master password or possess the
recovery key and run the same derivation the browser does.

```
DEK = crypto.subtle.generateKey(AES-GCM-256, extractable: true)   ← extractable is required
                                                                       transiently: wrapKey()
                                                                       needs it of its source key
passwordWrapKey = HKDF(Argon2id(password, kdfSalt))    ← identical derivation to §5, just
                                                            used to wrap now, not encrypt directly
wrappedDekPassword = crypto.subtle.wrapKey('raw', DEK, passwordWrapKey, AES-GCM)

recoveryKey = crypto.getRandomValues(20 bytes) → Base32, "XXXX-XXXX-...-XXXX" (8 groups)
recoveryWrapKey = HKDF(recoveryKey bytes, info="pass-keeper-recovery-wrap-v1")  ← fast HKDF,
                                                                                    no Argon2id: the
                                                                                    recovery key is
                                                                                    already 160 bits
                                                                                    of real entropy,
                                                                                    not a guessable
                                                                                    password
wrappedDekRecovery = crypto.subtle.wrapKey('raw', DEK, recoveryWrapKey, AES-GCM)

workingDek = crypto.subtle.unwrapKey(wrappedDekPassword, passwordWrapKey, extractable: false)
vaultCiphertext = AES-256-GCM-encrypt(entries, workingDek)   ← unchanged from §5, just keyed
                                                                  by workingDek instead of
                                                                  encryptionKey directly
```

Both `wrappedDekPassword` and `wrappedDekRecovery` use the same `{v, iv,
data}` JSON envelope shape `vaultCipher.js` already uses for the vault
itself (`crypto/dek.js`) — the only difference is what's inside: 32 raw DEK
bytes instead of a JSON-serialized entries array.

### Why WebCrypto's `wrapKey()`/`unwrapKey()`, not manual export-then-encrypt

`crypto.subtle.wrapKey()`/`unwrapKey()` are used instead of exporting the
DEK's raw bytes and running them through `encrypt()`/`decrypt()` by hand,
even though the two are cryptographically equivalent for AES-GCM. The
reason is custody, not correctness: `wrapKey()` internally exports and
encrypts a key without ever returning the raw bytes to JS-visible memory,
and `unwrapKey()` internally decrypts and imports without the plaintext key
ever existing as a JS-readable value either — only the finished `CryptoKey`
object comes back. A hand-rolled export-then-encrypt would necessarily hold
the DEK's raw 32 bytes in an ordinary, GC-visible `Uint8Array` at some point;
`wrapKey`/`unwrapKey` never do.

**A real constraint this surfaced, worth recording:** `wrapKey()` throws
`InvalidAccessError` on a non-extractable source key — wrapping fundamentally
requires the browser to access the key's raw bytes internally before
encrypting them. This means `generateDek()` must produce an `extractable:
true` key, which looks like it contradicts the non-extractable-by-default
posture in §5. The resolution: that extractable reference is used *only* to
call `wrapDek()` one or more times and is then discarded; every caller
immediately obtains its real *working* copy of the DEK by unwrapping one of
those envelopes again via `unwrapDek()`, which always returns
`extractable: false`. The one deliberate exception is
`unwrapDekForRewrap()`, used only by change-password and recovery-key
rotation (which need to re-wrap the *same* DEK under a *different* key, and
so need one more transiently-extractable copy) — see the file-level
comments in `crypto/dek.js` for the exact reasoning and call sites.

### The reset flow itself

```
Forgot password (frontend/src/pages/ForgotPassword.jsx)
  email ──POST /password_reset_request.php──▶ server
    server: looks up account (silently, no enumeration - always the same
      response either way), generates a 256-bit random token, stores only
      its SHA-256 hash + an expiry (backend-php/lib/password_reset.php),
      emails a link containing the RAW token (PHP's native mail(), zero
      dependencies - backend-php/lib/mailer.php)

Reset link clicked (frontend/src/pages/ResetPassword.jsx)
  token (from URL) ──GET /password_reset_verify.php?token=...──▶ server
    server: hashes the token, looks it up WITHOUT consuming it (so reloading
      this page doesn't burn the link), returns {valid, email,
      wrappedDekRecovery (nullable)}
  ◀── if wrappedDekRecovery is present, the recovery-key path is offered;
      the destructive ("start fresh") path is always offered as a fallback

Recovery-key path (vault preserved):
  recoveryKey (typed by user) ──parseRecoveryKey()──▶ raw bytes
    ──deriveRecoveryWrapKey()──▶ recoveryWrapKey
    ──unwrapDekForRewrap(wrappedDekRecovery, recoveryWrapKey)──▶ the SAME DEK
      (a wrong recovery key fails cleanly here, client-side, as a
       DekUnwrapError - never reaches the server)
  newPassword ──Argon2id/HKDF (fresh salt, current DEFAULT_KDF_PARAMS)──▶ newAuthHash, newPasswordWrapKey
  wrapDek(theSameDek, newPasswordWrapKey) ──▶ newWrappedDekPassword
  {token, newAuthHash, newKdfSalt, newKdfParams, newWrappedDekPassword,
   mode:"recovery"} ──POST /password_reset_confirm.php──▶ server
    server: atomically claims the token (single-use), then ONE UPDATE on
      users (auth_hash, kdf_salt, kdf_params, wrapped_dek_password) -
      vaults is never touched. Establishes a fresh session, same as login.

Destructive path (vault NOT preserved - explicit, checkbox-gated in the UI):
  DEK' = generateDek()  ← a brand-new DEK, unrelated to the old one
  newPassword ──▶ newPasswordWrapKey ──▶ wrappedDekPassword' = wrapDek(DEK', newPasswordWrapKey)
  a NEW recovery key is generated and offered immediately (shown once, same
    RecoveryKeyDisplay component as registration) so the user isn't left
    without one again
  emptyVault ──AES-256-GCM(DEK')──▶ newVaultCiphertext
  {token, ..., mode:"destructive", newWrappedDekRecovery, newVaultCiphertext}
    ──POST /password_reset_confirm.php──▶ server
    server: claims the token, then in one transaction UPDATEs users AND
      REPLACES vaults.ciphertext outright (no CAS guard needed - there is
      nothing left to preserve). The old ciphertext is not retained anywhere;
      this is the documented, deliberate cost of resetting without the
      recovery key.
```

### Token handling

`password_resets.token_hash` stores only the SHA-256 hash of the 256-bit
random token — the raw token exists only in the emailed link and briefly in
the browser's URL bar, the same reasoning as never storing a raw password or
a raw session identifier. Consumption is a single atomic `UPDATE ... WHERE
token_hash = ? AND used_at IS NULL AND expires_at > NOW()`, checked via
`rowCount()` (`pk_consume_reset_token()`, `backend-php/lib/password_reset.php`)
— the same compare-and-swap shape §3's `vaults.revision` guard uses — so two
concurrent submissions of the same link (a double-click, a retried request)
can't both succeed. Requesting a new link invalidates any prior unused one
for that account first, so only one reset link is ever live at a time.

### `change_password.php`'s simplification

A direct consequence of the envelope model: changing your master password
no longer touches the vault at all. §1 originally described
`change_password.php` as re-encrypting the whole vault inside a transaction
with the same optimistic-concurrency guard as `PUT /vault.php`. Under the
DEK model, a password change only re-wraps the DEK — the vault ciphertext
never moves — so the endpoint shrank to a single `UPDATE users` statement,
atomic by nature, with no transaction or revision check needed at all. See
`CHANGELOG.md` for this specific change and the README's API reference table
for the endpoint as it exists now.

---

## 7. Two-factor authentication (TOTP) and "remember this device"

**Status: implemented.** Standard TOTP (RFC 6238, built on HOTP/RFC 4226),
compatible with Google Authenticator and any other TOTP app: 30-second
step, 6-digit codes, SHA-1 (the algorithm virtually every TOTP app defaults
to, and the only one some support). Enrollment is a scanned QR code
(`otpauth://` URI) generated client-side via the `qrcode` npm package — the
frontend's second deliberate dependency, alongside `libsodium-wrappers-sumo`.

### The one deliberate exception to "the server never holds anything sensitive"

Every other secret in this system (the master password, the vault's DEK,
the recovery key) is designed so the server either never sees it at all, or
only ever sees a one-way hash of it. A TOTP secret can't work that way: the
server has to independently compute the *same* 6-digit code the user's
phone just did, which is only possible if it holds the actual secret, not
a hash of it. This is stated here explicitly rather than left as an
inconsistency someone has to notice on their own.

The mitigation: the secret is encrypted at rest, not stored in plaintext.
`backend-php/lib/totp.php` encrypts it with AES-256-GCM, keyed by
`hash_hmac('sha256', 'totp-secret-encryption-v1', $pepper, true)` — a
value derived from the existing server pepper via the same domain-separation
reasoning HKDF's `info` parameter uses on the frontend (§5), not the raw
pepper itself. A database leak alone doesn't expose usable TOTP secrets any
more directly than it exposes vault ciphertext's *key* — an attacker would
additionally need the pepper (`config/config.php`, outside the web root,
per the deployment layout). This is a materially weaker guarantee than the
vault's zero-knowledge property and is documented as such in
`docs/THREAT-MODEL.md` — it is not zero-knowledge, it's "encrypted rather
than plaintext," a real but different thing.

**Why the truncation/verification algorithm itself isn't a library
dependency:** `pk_hotp_code()` and `pk_totp_verify()` are built entirely on
PHP's own `hash_hmac('sha1', ...)` — a platform-provided primitive, the same
"don't hand-roll what the platform already provides" rule §5/CONTRIBUTING.md
already hold to. The truncation/formatting on top of that HMAC is a public,
standardized construction (RFC 4226 §5.3), not a cryptographic primitive in
its own right — the same reasoning that already justifies this codebase's
hand-rolled Base32 encoder. **This implementation is verified against the
official RFC 4226 test vectors** (`lib/totp.php`'s test secret
`"12345678901234567890"` against the ten published expected codes) before
ever being wired into a real endpoint.

### Verification is tolerant of clock drift, not of guessing

`pk_totp_verify()` checks the current 30-second step and one step on either
side (±30s, 90 seconds total) — standard practice, since phone clocks drift
slightly. What it does not tolerate is repeated guessing: `totp_verify.php`
(the login-time check) and `totp_setup_confirm.php` (the enrollment check)
are both rate-limited via the `totp_verify` bucket, deliberately tighter
than every other rate limit in this system — a 6-digit code is 1,000,000
possibilities, several orders of magnitude weaker than a password, so this
is the actual brute-force surface 2FA introduces alongside the protection
it adds.

### The login-time gate, and why idle-unlock is exempt

`pk_totp_challenge_needed()` (`lib/totp.php`) is the single function every
2FA-gated flow calls, so this logic exists in exactly one place: it returns
`false` (no challenge) if 2FA isn't enabled, if a session already
authenticated as this exact user exists, or if the `pk_trusted_device`
cookie hashes to a live row in `trusted_devices`.

The middle condition is what makes `VaultLockContext.unlock()`'s
idle-relock re-entry never re-prompt for a code — that flow re-calls
`login.php` on every unlock (re-deriving the session as a side effect,
§5), but only while a valid session for that same user is already live.
Only establishing a genuinely *new* session — a fresh browser session,
another device, or after an explicit logout — triggers the gate. Without
this exemption, 2FA would ask for a code every few minutes throughout a
single continuous work session, which isn't what "two-factor login" means
in practice anywhere else either.

The same gate applies to `password_reset_confirm.php`'s completion, not
just `login.php` — deliberately: without it, an attacker who's compromised
the account's email could use "forgot password" to bypass 2FA entirely,
which would defeat much of the reason to have it. Both endpoints share a
`$_SESSION['pending_2fa_user_id']` state (`pk_start_pending_totp()` /
`pk_pending_totp_user_id()`, 5-minute expiry) that proves the password was
already verified, without granting a real session — `totp_verify.php` is
the only endpoint that can turn that pending state into a real one, and
only with a correct code.

### "Remember this device"

A 30-day trusted-device grant, opt-in per login via a checkbox on the code
screen (never set silently — see `docs/CookiePolicy` in the frontend). A
random 256-bit token is generated, only its SHA-256 hash stored in
`trusted_devices` (the same "hash, never the raw value" pattern
`password_resets.token_hash` already uses), and the raw token set as an
`HttpOnly`/`Secure`/`SameSite=Strict` cookie — not JS-readable, same
posture as `pk_session`.

**Revoked, not just expired, on:** disabling 2FA (`totp_disable.php`),
changing the master password (`change_password.php`) — a credential change
is exactly the moment stale device trust should be cleared, in case the
change itself was prompted by a compromise — deleting the account (cascades
via the `trusted_devices.user_id` foreign key), or an explicit "sign out of
all remembered devices" action in Settings (`forget_devices.php`).

### Schema

`users` gains `totp_secret_encrypted TEXT NULL` (the AES-GCM envelope) and
`totp_enabled_at DATETIME NULL` (presence means enabled — the same
nullable-means-"not set up" pattern `wrapped_dek_recovery`/
`recovery_key_created_at` already use). New table `trusted_devices`: `id,
user_id, token_hash CHAR(64) UNIQUE, expires_at, created_at`, `ON DELETE
CASCADE` on `user_id`. See `backend-php/migrations/002_add_totp.sql` for
the migration against an already-deployed database.
