# Pass Keeper

A self-hosted, multi-user, zero-knowledge personal password manager, built to
run on plain PHP + MySQL shared hosting — no Node, no Redis, no persistent
server process, no SSH required to operate.

> **⚠️ There is no "forgot password" for your vault. If you lose your master
> password, your vault data is permanently and unrecoverably lost.** The
> server never has, and never can have, the ability to decrypt it for you —
> that's not a missing feature, it's the whole point of the design (see
> below). Write your master password down somewhere safe before you need it.

## Project status

**The live stack is `frontend/` + `backend-php/` + MySQL.** All cryptography
(Argon2id key derivation, HKDF, AES-256-GCM) runs client-side in the
browser, exactly as described in the security model below — this isn't
aspirational, it's what's running. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §5 for the full crypto
pipeline and [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for what it
does and doesn't protect against.

`backend/` — the original Node.js/Express + SQLite prototype, built around
an earlier, less strict security model (the server derived keys from your
master password at login and briefly held them in memory) — is kept in the
repo for reference and is not yet decommissioned, but the frontend no
longer talks to it. It will be removed in a future cleanup pass.

## What this is

A password vault you host yourself, for a small number of users (a
household, a team, yourself). You sign in with a master password; everything
else — every stored password, username, URL, and note — is encrypted and
decrypted entirely in your browser. The server stores encrypted data it
cannot read and never receives the key that could read it.

## The security model, in plain language

- **Your master password never leaves your browser.** When you type it, your
  browser runs a slow, memory-hard key-derivation function (Argon2id,
  ~1-1.5 seconds on a typical phone, via an established WASM library — see
  `docs/ARCHITECTURE.md` §5) on it locally, in a background thread so the
  page stays responsive while it works. That produces a key, which is then
  split in two: one half proves your identity to the server (so it knows to
  let you in), the other half encrypts your vault. Only the first half is
  ever sent anywhere. The encryption half lives only in your browser tab's
  memory for as long as the tab is open and unlocked — never in
  `localStorage`, a cookie, or any other form that would outlive it.
- **The server stores ciphertext, not your data.** Your entire vault is
  encrypted as one sealed blob (AES-256-GCM) before it's ever sent to the
  server. The server's job is to store that blob and hand it back to you —
  it has no way to open it.
- **A stolen database does not hand over your passwords.** If the server or
  its database were ever compromised or leaked, an attacker would get
  unreadable ciphertext, not plaintext. They would still have to guess your
  actual master password and run the same slow key-derivation your browser
  does — for every guess — which is deliberately made expensive.
- **This does not mean the system is invincible.** In particular, if the
  server that *delivers the app's JavaScript to your browser* is
  compromised, an attacker could tamper with that code to capture your
  master password directly, bypassing the encryption entirely. This is a
  real, structural limitation of any browser-based app like this one, not
  something this project claims to have solved. Read
  [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) for the honest version of
  this — it's short, and it matters more than any other paragraph in this
  README.

## Security

The plain-language summary above is accurate; this section is the same
information at the level of detail an engineer evaluating this project
would want, plus the limits stated as plainly as the guarantees. Full depth
is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §5 (the crypto
pipeline) and [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) (what's
in and out of scope). This project was audited end-to-end against its own
migration (client crypto, every backend endpoint, session/CSRF/rate-limit
logic) — see [`CHANGELOG.md`](CHANGELOG.md) for what that audit checked and
what it found.

**What's protected:**

- The master password and the vault's encryption key are never transmitted,
  in any form, at any point — not the raw password, not a hash of it that
  could substitute for it, nothing. Only an HKDF-derived `authHash` (proves
  identity) and AES-256-GCM ciphertext (opaque to the server) ever cross
  the network.
- Argon2id key derivation runs in the browser, in a Web Worker, via an
  established WASM library (`libsodium-wrappers-sumo`) — no hand-rolled
  crypto primitives anywhere in the pipeline.
- Every AES-GCM encryption uses a freshly generated random IV — verified
  never cached or reused.
- The stored auth hash is peppered and re-hashed server-side
  (`password_hash(..., PASSWORD_ARGON2ID)`), so a stolen `users` table
  alone isn't a directly replayable credential.
- Every database query that touches a user's vault or account row is
  scoped to the session's own user ID, server-side — there is no
  client-suppliable ID anywhere in the API that selects whose data to
  read or write, and the audit specifically checked for this.
- Sessions regenerate their ID on every authentication event (register,
  login, unlock, password change) — standard session-fixation defense.
- Every mutating endpoint that operates on an existing session requires a
  double-submit CSRF token; register/login are the deliberate, documented
  exception (no session exists yet to double-submit against).
- Login and the pre-login salt lookup are enumeration-resistant: identical
  error messages and comparable response timing (a dummy Argon2id
  computation stands in for a real verification) whether an account exists
  or not. Registration's "email already in use" is intentionally *not*
  enumeration-resistant — see `docs/THREAT-MODEL.md` for why that's a
  deliberate, different, lower-stakes case.
- The master-password change flow is atomic server-side (new auth hash and
  re-encrypted vault commit together or not at all) and was specifically
  audited for ways a network failure could leave a user stranded
  mid-change — see `CHANGELOG.md`.

**What's explicitly not protected, or not yet built:**

- **A compromised server can serve tampered JavaScript** and capture your
  master password directly as you type it, bypassing every guarantee
  above. This is a structural property of any browser-based zero-knowledge
  app, not something this project claims to have solved — see
  `docs/THREAT-MODEL.md` §2.1 for the honest version.
- **Offline brute-force resistance is only as strong as your master
  password.** A stolen database plus a weak/common master password can
  still be cracked offline; Argon2id raises the cost per guess, it doesn't
  make a weak password safe.
- **No two-factor authentication yet.** The schema has a reserved,
  currently-unused column for it; there's no TOTP flow.
- **No cross-device session revocation.** Sessions are native PHP sessions
  with no central index by user (a deliberate trade-off — see
  `docs/ARCHITECTURE.md` §3) — changing your master password rotates the
  *current* session but can't reach into other devices' sessions.
- **A compromised or malicious client device** (keylogger, malicious
  extension, malware with clipboard access) can observe your master
  password or decrypted vault contents regardless of anything server-side.
- **Metadata is not hidden.** The server sees your email, login times,
  approximate vault size, and IP address (hashed at rest for rate
  limiting, but visible in transit and in ordinary web server access logs
  outside this app's control).
- **Rate limiting is IP-and/or-account-based, not foolproof.** An attacker
  with access to many IPs can still exhaust the *registration* endpoint's
  per-IP limit (accepted at this project's scale — see
  `docs/THREAT-MODEL.md` §2.7); the audit specifically checked and fixed a
  case where the *change-password* endpoint's rate limit could have been
  bypassed by an attacker rotating IPs while holding an already-stolen
  session cookie (see `CHANGELOG.md`).

## Requirements

**To run the live stack (`backend-php/` + `frontend/`):**

- PHP 8.1+ (8.2+ preferred where the host offers it), with `pdo_mysql` and
  `openssl` extensions, and **`password_hash()` built with Argon2id
  support** — this is a hard requirement, not a nice-to-have; the backend
  refuses to hash or verify anything and fails loudly (500) if
  `PASSWORD_ARGON2ID` isn't available, rather than silently falling back to
  something weaker. Check this before deploying (see setup below).
- MySQL 5.7+/MariaDB 10.3+ (InnoDB)
- LiteSpeed or any web server that honors `.htaccess`, with TLS (Let's
  Encrypt via DirectAdmin or equivalent) — several security properties
  (Secure cookies, the auth hash's protection in transit) depend on TLS
  actually being enforced, which `backend-php/public_html/.htaccess`
  redirects to.
- A modern browser with WebCrypto, WebAssembly, and Web Worker support (any
  browser from the last several years).
- No Node, Redis, cron, or shell access required to *run* it. A build step
  (Node + `vite build`) is required to *produce* the frontend bundle before
  upload — that happens on a developer machine or in CI, never on the host.
  Zero PHP/Composer dependencies are used on the backend; the frontend has
  exactly one crypto dependency (`libsodium-wrappers-sumo`, for Argon2id —
  see `docs/ARCHITECTURE.md` §5).

**To run the legacy Node prototype instead:** Node.js 18+, documented in
full below.

## Setup

### The live stack (`backend-php/` + `frontend/`)

1. **Create the database and apply the schema:**

   ```bash
   mysql -u root -p -e "CREATE DATABASE passkeeper CHARACTER SET utf8mb4;"
   mysql -u root -p passkeeper < backend-php/schema.sql
   ```

   On DirectAdmin, do the equivalent through the panel's MySQL management
   UI / phpMyAdmin instead — same schema file, no shell needed.

2. **Configure secrets.** Copy the example config and fill it in — this
   file must never be committed:

   ```bash
   cp backend-php/config/config.example.php backend-php/config/config.php
   ```

   Edit `backend-php/config/config.php`:
   - `db` — your MySQL host/name/user/password.
   - `pepper` — generate with `php -r "echo bin2hex(random_bytes(48));"`
     and back it up somewhere separate from the database backup. Losing it
     locks every account out of *login* (it doesn't touch vault data — see
     the file's own comments for why those are different failure modes).
   - `app_env` — `'production'` on the real host (required for `Secure`
     cookies to be set; `Secure` cookies require HTTPS, so don't deploy to
     production with this set to `'development'`). Use `'development'`
     only for a local machine running over plain HTTP.
   - `fake_kdf_params` — leave as-is unless you change what the frontend
     sends at registration; see the file's comments.

   This file lives in `backend-php/config/`, a sibling of
   `backend-php/public_html/` (the actual web root) — **make sure your
   host's domain/document-root points at `public_html/`, not at
   `backend-php/` itself**, or `config/` would be served over HTTP. That
   placement, not any `.htaccess` rule, is what keeps it inaccessible.

3. **Confirm Argon2id is available** on the target PHP before relying on
   this in production:

   ```bash
   php -r "var_dump(defined('PASSWORD_ARGON2ID'));"
   ```

   If this prints `bool(false)`, do not deploy as-is — see
   `docs/ARCHITECTURE.md`'s migration checklist step 1 and
   `CONTRIBUTING.md`'s hard rule on cryptography changes before working
   around it.

4. **Run the backend locally**, against a local MySQL database set up the
   same way as step 1:

   ```bash
   cd backend-php/public_html
   php -S localhost:8000
   ```

5. **Run the frontend**, in a separate terminal:

   ```bash
   cd frontend
   npm install
   npm run dev      # :5173, proxies /api to the PHP server on :8000 (see vite.config.js)
   ```

   Open `http://localhost:5173`. See `CONTRIBUTING.md` for the full local
   dev loop and conventions.

6. **Deploy** by uploading `backend-php/config/` (with your real
   `config.php`, filled in, **not** committed), `backend-php/public_html/`,
   and the frontend's production build (`npm run build` inside `frontend/`,
   then upload the resulting `frontend/dist/` contents alongside
   `public_html/`'s existing files) via DirectAdmin's File Manager or
   FTP/SFTP — no build step runs on the host itself.

#### API reference

All endpoints are under `backend-php/public_html/api/`. Responses are JSON;
errors are `{"error": "..."}` with a non-2xx status. Every state-changing
request needs the CSRF header described below, except `register` and
`login` (there's no session yet at that point to double-submit against).

| Endpoint | Method | Auth | CSRF | Rate-limited | Purpose |
|---|---|---|---|---|---|
| `/api/me.php` | GET | Session | No (safe method) | No | Identity check after a page reload — the encryption key never survives one (see `docs/ARCHITECTURE.md` §5), so the frontend uses this to know whether to prompt "unlock" (session still valid) or show a full login form. |
| `/api/register.php` | POST | — | No | Yes (`register`) | Create an account and its empty vault; logs in on success. |
| `/api/login_salt.php` | GET | — | No | Yes (shares `login`'s bucket) | Look up the KDF salt/params needed before a login attempt can be computed. |
| `/api/login.php` | POST | — | No | Yes (`login`, by IP *and* by account) | Verify an auth hash and establish a session. |
| `/api/logout.php` | POST | Session | **Yes** | No | End the session. |
| `/api/vault.php` | GET | Session | No (safe method) | No | Fetch the encrypted vault blob + its current revision. |
| `/api/vault.php` | PUT | Session | **Yes** | No | Replace the vault blob — see optimistic concurrency below. |
| `/api/change_password.php` | PUT | Session | **Yes** | Yes (`change_password`, by account+IP) | Atomically replace the auth hash, KDF salt/params, and vault blob together. |

**Auth & session.** A successful `register`/`login` sets an HttpOnly,
`SameSite=Strict` session cookie (`Secure` when `app_env` is
`'production'`) under a non-default name, and regenerates the session ID
(session-fixation defense). It also sets a second, JS-readable cookie
holding a CSRF token. Every state-changing authenticated request must echo
that token back in an `X-CSRF-Token` header — the double-submit pattern: a
cross-origin attacker can't read the cookie to know what to put in the
header.

**Optimistic concurrency on the vault.** `GET /api/vault.php` returns a
`revision` integer alongside the ciphertext. `PUT /api/vault.php` must send
back the `revision` it read; if another save has landed in the meantime,
the update is rejected with `409` and the response includes the current
`currentRevision` so the client can reload rather than silently overwrite
someone else's change. `change_password.php` applies the same guard to its
own vault write, as part of the same atomic operation as the auth-hash
update (see below) — a stale vault read blocks the whole password change,
not just the vault half of it.

**Atomicity of `change_password.php`.** The new auth hash (new KDF salt +
params + hashed auth value) and the newly re-encrypted vault blob are
written in a single database transaction. If the vault's optimistic-
concurrency check fails, the *entire* transaction rolls back — the auth
hash is not updated either. There is no state where the password changed
but the vault didn't (or vice versa).

**Enumeration.** Login failures (`login.php`) return the identical
`"Invalid email or password."` message and roughly the same response time
whether the email doesn't exist or the password is wrong. `login_salt.php`
returns a deterministic, plausible-looking fake salt for a nonexistent
email rather than a distinguishable 404. **This scoping is deliberate and
narrower than "no endpoint ever reveals email existence":**
`register.php`'s `409 An account with that email already exists.` is
intentionally *not* enumeration-resistant — that's normal, expected signup
UX (every major signup form does this), a different and much lower-stakes
disclosure than the login-enumeration issue, which is the one with real
credential-stuffing value to an attacker. See `docs/THREAT-MODEL.md`.

### Legacy: the Node prototype (`backend/`)

Not the live stack (see "Project status" above), kept for reference:

```bash
npm install                 # installs both workspaces
cp backend/.env.example backend/.env
```

Edit `backend/.env` and fill in real random values for `COOKIE_SECRET`,
`CSRF_SECRET`, and `ENCRYPTION_PEPPER`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run that three times for the three secrets.

```bash
npm run dev      # backend on :4000, frontend dev server on :5173
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — full design reasoning,
  what carried over from the Node prototype vs. what was rebuilt, the MySQL
  schema (including one deviation adopted during implementation — see that
  doc), the migration checklist, and (§5) the complete client-side crypto
  pipeline: library choice, exact Argon2id parameters and how they were
  measured, the Web Worker architecture, key custody, and a diagram of
  exactly what does and doesn't cross the network.
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) — what this design protects
  against, and, explicitly, what it does not.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — project structure, local
  development, coding conventions, how to add a backend endpoint safely,
  and which crypto parameters/primitives must not be changed without
  review.
- [`backend-php/schema.sql`](backend-php/schema.sql) — the MySQL schema, as
  actually applied, not just as documented.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploying to DirectAdmin +
  LiteSpeed shared hosting with no SSH: exact layout, the `.htaccess`
  actually used, the database backup/rotation/restore procedure, schema
  setup via phpMyAdmin, a list of URLs to confirm nothing sensitive is
  reachable after deploy, and a five-minute post-deploy checklist.
- [`CHANGELOG.md`](CHANGELOG.md) — what changed in the PHP/MySQL +
  browser-crypto migration, and the findings and fixes from the end-to-end
  security audit that followed it.

## Data and backups

The MySQL `vaults` table (and `users`, for account/KDF metadata) is the
sole copy of every user's data — back it up regularly. Unlike the Node
prototype (which used a server-side pepper to protect stored data), a
MySQL backup alone is not directly useful to whoever holds it: every row is
either ciphertext the server never had the key to read, or a value already
salted and hashed with Argon2id. That's the point of the design — see
`docs/THREAT-MODEL.md` for exactly what that does and doesn't mean under an
offline attack.
