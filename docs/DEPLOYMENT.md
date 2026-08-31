# Deployment: DirectAdmin + LiteSpeed, `vault.soricu.com`

**Assumes no SSH.** Every step below is doable through DirectAdmin's File
Manager, phpMyAdmin, and the panel's Cron Jobs / SSL pages. Where a step
would normally use a terminal (`mysqldump`, `php -l`, `openssl rand`), this
doc gives the File-Manager/phpMyAdmin/browser equivalent instead.

See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for why the layout below looks
the way it does, and [`docs/THREAT-MODEL.md`](THREAT-MODEL.md) for what it
does and doesn't protect against.

---

## 1. Layout

```
/home/<directadmin-user>/domains/vault.soricu.com/
├── config/
│   └── config.php          Real secrets. NEVER inside public_html/.
├── lib/                    Shared PHP helpers (see CONTRIBUTING.md) — same, outside public_html/.
├── cron/
│   └── db-backup.php       Scheduled DB dump — see §4. Outside public_html/.
├── backups/                Created automatically on first backup run. Outside public_html/.
├── schema.sql              Reference copy; not needed at runtime — see §3.
└── public_html/            The web root. Point the subdomain's document root HERE.
    ├── .htaccess
    ├── index.html           \
    ├── assets/               } the built frontend (frontend/dist/ contents)
    └── api/
        ├── me.php
        ├── register.php
        ├── login_salt.php
        ├── login.php
        ├── logout.php
        ├── vault.php
        ├── change_password.php
        ├── recovery_key.php
        ├── password_reset_request.php
        ├── password_reset_verify.php
        └── password_reset_confirm.php
```

**The one fact that makes this whole layout safe:** `config/`, `lib/`,
`cron/`, `backups/`, and `schema.sql` are *siblings* of `public_html/`, not
descendants of it. When DirectAdmin creates `vault.soricu.com` and you point
its document root at `.../vault.soricu.com/public_html/`, the web server
has no path from any URL to anything outside that directory — not because
of a rule that blocks it, but because there is no route there at all. The
`.htaccess` rules in §2 are real, additional protection, not the primary
one; don't let a misconfigured document root be the thing that quietly
removes it.

---

## 2. Deploy steps (File Manager + phpMyAdmin + panel pages only)

1. **Create the subdomain**, if not already done: DirectAdmin → *Domain
   Setup* / *Subdomain Management* → add `vault` under `soricu.com`. Confirm
   its document root resolves to
   `domains/vault.soricu.com/public_html/` (DirectAdmin does this
   automatically for a subdomain in the usual layout — verify it in File
   Manager rather than assuming).

2. **Build the frontend locally** (this is the one step that needs Node,
   and it happens on your machine, never on the host):

   ```bash
   cd frontend
   npm install
   npm run build
   ```

   This produces `frontend/dist/` — its *contents* (not the folder itself)
   are what get uploaded into `public_html/` in step 4.

3. **Upload the app**, via File Manager's multi-file/folder upload
   (zip-and-extract isn't a reliable option on this host — files have to
   go up by hand):
   - `backend-php/lib/` → `domains/vault.soricu.com/lib/`
   - `backend-php/cron/` → `domains/vault.soricu.com/cron/`
   - `backend-php/schema.sql` → `domains/vault.soricu.com/schema.sql`
   - `backend-php/public_html/.htaccess` and `backend-php/public_html/api/`
     → `domains/vault.soricu.com/public_html/`
   - `frontend/dist/`'s *contents* → also into
     `domains/vault.soricu.com/public_html/` (so `index.html` and `api/`
     end up as siblings inside `public_html/`)
   - Do **not** upload `backend-php/config/` yet — that's step 6, done
     directly on the server so the real secrets never touch a laptop's
     upload history or an intermediate zip file any longer than necessary.

4. **Create the database**: DirectAdmin → *MySQL Management* → *Create new
   Database*. Note the generated database name, username, and password (or
   set your own) — DirectAdmin usually prefixes both with your account
   username (e.g. `youruser_passkeeper`).

5. **Apply the schema** — see §3.

6. **Configure secrets** — see §5.

7. **Enable SSL**: DirectAdmin → *SSL Certificates* → select
   `vault.soricu.com` → *Let's Encrypt* → request a certificate covering
   this subdomain → install. Confirm `https://vault.soricu.com` loads with
   a valid padlock before moving on; the `.htaccess` HTTP→HTTPS redirect
   depends on TLS actually being active here, not the other way around.

8. **Set up the backup cron job** — see §4.

9. **Run the verification URLs and checklist** — §6 and §7.

---

## 3. Schema setup via phpMyAdmin

`backend-php/schema.sql` is the same file already used for local
development — nothing new to write.

1. DirectAdmin → *MySQL Management* → click the database created in step 4
   above → **phpMyAdmin**. This opens phpMyAdmin already scoped to that
   database (no separate login needed).
2. Click the **Import** tab.
3. **Choose File** → select `schema.sql` (the copy on your own machine, from
   `backend-php/schema.sql` in this repo).
4. Leave the format as **SQL**, click **Go**.
5. Confirm the left sidebar now lists five tables: `users`, `vaults`,
   `rate_limits`, `password_resets`, `trusted_devices`. Click each and
   check *Structure* matches what's in the repo's `schema.sql` — a quick
   visual diff, not a formality; a partially-applied import (e.g. from a
   connection timeout on a slow upload) can leave a table silently missing
   a column. In particular, confirm `users` has `wrapped_dek_password`,
   `wrapped_dek_recovery`, `recovery_key_created_at`,
   `totp_secret_encrypted`, and `totp_enabled_at` — an old backup or a
   stale `schema.sql` copy predating the password-reset/2FA features would
   be missing these.

The schema uses `CREATE TABLE IF NOT EXISTS`, so re-running this same
import later (e.g. after restoring a backup that only contains data, not
structure — not the normal case here, since the backup script in §4 dumps
structure too, but worth knowing) won't error on tables that already exist.

### Upgrading an existing production database (not a fresh install)

**This is different from the fresh-install steps above and matters if your
database predates the master-password-reset feature** — i.e. `users`
doesn't yet have a `wrapped_dek_password` column. `schema.sql`'s `CREATE
TABLE IF NOT EXISTS` will *not* add missing columns to a table that already
exists — re-importing it here does nothing for an existing `users` table,
silently. Use the dedicated migration instead:

1. **Back up first.** Trigger the backup cron job manually (§4) or export
   via phpMyAdmin — do this before anything below, not after.
2. phpMyAdmin → **Import** → select `backend-php/migrations/
   001_add_dek_columns.sql` instead of `schema.sql` → **Go**.
3. Confirm via the **Structure** tab: `users` now has
   `wrapped_dek_password`, `wrapped_dek_recovery`,
   `recovery_key_created_at` (all nullable — existing accounts get `NULL`,
   a real state meaning "hasn't migrated to the new key model yet," not an
   error), and a new `password_resets` table exists.
4. Deploy the updated `backend-php/public_html/`, `lib/`, and the new
   frontend build as usual (§2).
5. **Log in once with each existing real account.** This is what actually
   completes the migration — it happens transparently on a normal login
   (briefly showing "Upgrading your vault…" if you're watching closely),
   re-wrapping that account's vault key without touching its data. Confirm
   via phpMyAdmin afterward that `wrapped_dek_password` is now populated
   for that account and that its vault entries are still there and correct
   in the app.
6. This migration script is **not** re-runnable — running `ADD COLUMN`
   against a column that already exists errors out. If you need to confirm
   whether it's already been applied, check the `users` table's Structure
   tab for `wrapped_dek_password` first.

See `CHANGELOG.md`'s "Compatibility fix: migrate existing accounts to the
DEK model" entry for the full technical reasoning and how this was verified
before being written up here.

### Adding two-factor authentication to an already-deployed database

A second, separate migration for the 2FA feature:
`backend-php/migrations/002_add_totp.sql` — same shape and same caveats as
`001_add_dek_columns.sql` above (not re-runnable, back up first). Follow
the same five steps, substituting this file, and confirm `users` gains
`totp_secret_encrypted` and `totp_enabled_at`, and a new `trusted_devices`
table exists.

**The one lesson from actually running `001_add_dek_columns.sql` against
real production data, worth repeating here so it isn't relearned the hard
way twice:** phpMyAdmin's **Import** tab has two different entry points —
a server-level one (reachable without selecting a database first) and a
per-database one (reachable by clicking the database's name in the left
sidebar first). The server-level one does **not** carry a database
context, so `ALTER TABLE`/`CREATE TABLE` statements run there fail with
`#1046 - No database selected` — sometimes while phpMyAdmin's own summary
banner still claims some queries "executed successfully," which is not
proof anything actually changed. Always click the database name in the
sidebar first, so the URL/session context is scoped to it, *then* use its
Import tab — and always verify via the **Structure** tab afterward rather
than trusting the import summary message alone.

---

## 4. Database backups: cron script + rotation + restore

### The script

[`backend-php/cron/db-backup.php`](../backend-php/cron/db-backup.php) dumps
every table to a timestamped, gzip-compressed SQL file in `../backups/`
(outside `public_html/` — never web-accessible) and deletes old backups
beyond the last 14.

It's pure PHP + PDO, not a wrapper around the `mysqldump` binary —
shell_exec()/exec()/proc_open() are frequently disabled on shared hosting,
and this needs to work without assuming any of them are available. It was
tested locally against a real MySQL 8 database, including an exact
byte-for-byte round-trip of a value containing quotes and backslashes
(`PDO::quote()` handles the escaping), and a restore into a clean database.

Change the retention window by editing `RETENTION_COUNT` near the top of
the file (default 14 — about two weeks at one backup/day).

### Scheduling it: DirectAdmin → Cron Jobs

1. DirectAdmin → **Cron Jobs**.
2. Add a job:
   - **Minute** `0`, **Hour** `3`, **Day** `*`, **Month** `*`, **Weekday**
     `*` (daily at 03:00 server time — adjust to taste).
   - **Command**:
     ```
     php -q /home/<your-directadmin-username>/domains/vault.soricu.com/cron/db-backup.php
     ```
     Replace `<your-directadmin-username>` with your actual account
     username (visible in DirectAdmin's account info, and in the path
     shown by File Manager). `-q` suppresses PHP's own startup banner if
     your CLI build prints one; the script's own output still goes to
     stdout/stderr, which DirectAdmin normally emails to the account's
     contact address on cron output — expect a short "backed up N rows per
     table" email after each run, which doubles as a lightweight success
     signal.
3. **If the command doesn't run** (no email ever arrives, or DirectAdmin's
   cron UI on your plan only accepts a URL, not a command): your host may
   invoke cron's `php` without the same PATH a shell would have, or may
   require a full interpreter path (e.g. `/usr/local/bin/php83` — check
   DirectAdmin's *PHP Selector* / *PHP Info* page for the exact binary path
   it lists for your selected PHP version) — try that full path in the
   Command field instead of bare `php`. As a last resort if your plan's
   cron truly only supports fetching a URL, that requires moving the script
   under a web-reachable path with a shared-secret guard; that's a
   meaningfully different (and slightly weaker) setup than the plan above,
   so treat it as a fallback to investigate only if the command approach
   genuinely doesn't work for your specific hosting plan, not a default.

### Restore procedure

1. **File Manager** → navigate to `domains/vault.soricu.com/backups/` →
   download the `.sql.gz` file you want to restore from.
2. phpMyAdmin usually imports `.sql.gz` directly (the Import tab
   auto-detects gzip compression) — try importing it as-is first. If your
   phpMyAdmin version rejects the compressed file, decompress it locally
   (any standard zip/gzip tool) to get the plain `.sql` file and import
   that instead.
3. DirectAdmin → *MySQL Management* → your database → **phpMyAdmin** →
   **Import** tab → **Choose File** → select the backup → **Go**.
4. The dump includes `DROP TABLE IF EXISTS` before every `CREATE TABLE`, so
   importing replaces the existing tables cleanly — no manual truncation
   needed first, and no harm in importing into a database that still has
   the old (e.g. corrupted) data in it.
5. **Verify**: phpMyAdmin → `users` table → *Browse* → row count and a
   couple of spot-checked emails look right; same for `vaults`.
6. **If the restore is because of a suspected compromise, not just data
   loss**: also rotate `pepper` in `config/config.php` (see §5) — this
   invalidates every stored `auth_hash`, which forces every account to be
   unusable until re-registered, so only do this if you actually mean it —
   and be aware there's no built-in "kill every active session" control
   (native PHP sessions have no central index — see
   [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) §3's callout); the practical
   equivalent is deleting the PHP session files if your host's File Manager
   can reach the session save path, or simply waiting out the idle timeout
   (default 60 minutes) on any sessions you can't directly clear.

---

## 5. Configuring secrets (`config/config.php`)

Done directly on the server, not uploaded from a laptop:

1. File Manager → navigate to `domains/vault.soricu.com/config/`.
2. Duplicate `config.example.php` (upload it here once from
   `backend-php/config/config.example.php` if it isn't already present) →
   rename the copy to `config.php`.
3. Edit `config.php` in File Manager's built-in editor and fill in:
   - `db` — the database name/username/password from §2 step 4.
   - `pepper` — needs 96+ hex characters of real randomness. Without shell
     access, generate this in a browser instead:
     [`https://www.random.org/strings/`](https://www.random.org/strings/)
     (set length 96, one string, "digits" only won't give you hex letters —
     use a password generator that outputs hex, or simpler: generate a
     48+ character random password with any reputable password generator
     and use that verbatim as the pepper — its job is to be a long, unique,
     unguessable secret, not specifically hex). Paste it in; don't reuse it
     anywhere else.
   - `app_env` — `'production'` (required for `Secure` cookies to actually
     be set — confirm SSL from step §2.7 is live *before* setting this,
     or login will silently break: a `Secure` cookie set over plain HTTP
     is simply refused by the browser).
   - `app_url` — `'https://vault.soricu.com'`. Used only to build the link
     inside password-reset emails; get this exactly right (including
     `https://`, no trailing slash needed — the code trims one if present)
     or reset links will point somewhere wrong.
   - `mail.from_address` / `mail.from_name` — `'noreply@soricu.com'` /
     `'Pass Keeper'` (or your own values). Confirm this mailbox actually
     exists in DirectAdmin's **Email Accounts** first — some hosts reject
     outbound mail with a `From` address that isn't a real, provisioned
     mailbox on the account, even for a send-only address.
   - `password_reset.expiry_minutes` — `10` is the default; leave as-is
     unless you have a specific reason to change it (see
     `docs/THREAT-MODEL.md` §2.8 for why it's kept short).
   - `rate_limits.totp_verify` — add this entry if it's missing (needed for
     the 2FA feature): `['limit' => 8, 'window_seconds' => 900]`, inside
     the existing `rate_limits` array alongside `register`/`login`/etc. A
     6-digit code is far lower entropy than a password, so this is kept
     tighter than the others — see `docs/ARCHITECTURE.md` §7.
   - `fake_kdf_params` — leave as-is unless the frontend's
     `DEFAULT_KDF_PARAMS` (`frontend/src/crypto/kdfClient.js`) changes; see
     that file's comments and `CONTRIBUTING.md`'s crypto-parameters
     section.
4. Save. Confirm the file is at
   `domains/vault.soricu.com/config/config.php` — a sibling of
   `public_html/`, **not** inside it (File Manager makes it easy to
   accidentally save into the wrong directory if you navigated via a
   different tab — double-check the path shown in the editor's title bar).

**Mail deliverability (SPF/DKIM).** Password-reset emails are sent via PHP's
native `mail()` — no external SMTP relay. For them to reliably land in an
inbox instead of spam (or get silently dropped by the recipient's mail
provider), configure SPF and DKIM for `soricu.com` in DirectAdmin: **DNS
Management** → confirm an `SPF` (`TXT`) record exists authorizing this
server's outbound mail, and **Email** → **DKIM** → enable it for the domain
if not already on (DirectAdmin usually generates and manages this key pair
for you — it just needs to be turned on and the resulting DNS record
published, which DirectAdmin does automatically once enabled). Skipping
this doesn't break the feature technically, but reset emails may not
reliably arrive, which from a user's perspective looks identical to the
feature being broken.

**Before trusting any of this in production**, confirm the host's PHP
actually has Argon2id support — check DirectAdmin's **PHP Selector** / **PHP
Info** page for your selected PHP version and look for `argon2id` under the
`password_hash` / `sodium` sections of the module list there first. If it's
not listed and you need a one-off browser-based check: temporarily create
`public_html/argon-check.php` containing only
`<?php var_dump(defined('PASSWORD_ARGON2ID'));`, visit it once, read the
result, **then delete the file immediately** — don't leave a diagnostic
script sitting in the web root. If it prints `bool(false)`, stop here and
see `docs/ARCHITECTURE.md`'s migration checklist step 1 before proceeding
further; the app refuses to hash or verify anything without it rather than
silently falling back to something weaker.

---

## 6. Verification URLs — each of these should return 403 or 404

Open each in a browser (or check via your browser's Network tab / view-source
so you see the actual status code, not just "the page looks empty") right
after deploying. None of these paths should exist under `public_html/` in
the first place, per the layout in §1 — this list exists to catch upload
mistakes (an extra file dragged in, a whole-repo zip extracted in the wrong
place) and to confirm `.htaccess` is actually being read.

| URL | Expected | Confirms |
|---|---|---|
| `https://vault.soricu.com/.env` | 403/404 | No stray env file, dotfile block works |
| `https://vault.soricu.com/.htaccess` | 403/404 | `.htaccess` itself is never servable |
| `https://vault.soricu.com/.git/config` | 403/404 | No accidental `.git/` upload |
| `https://vault.soricu.com/config.php` | 403/404 | No stray config copy landed in `public_html/` |
| `https://vault.soricu.com/config/config.php` | 404 | `config/` isn't reachable from the web root at all (§1) |
| `https://vault.soricu.com/schema.sql` | 403/404 | `.sql` extension block works, and it wasn't uploaded into `public_html/` anyway |
| `https://vault.soricu.com/backups/` | 404 | `backups/` isn't under `public_html/`; also confirms directory listing is off |
| `https://vault.soricu.com/cron/db-backup.php` | 404 | `cron/` isn't under `public_html/` |
| `https://vault.soricu.com/README.md` | 404 | The repo's docs/source weren't uploaded wholesale |

If any of these return **200**, stop and fix it before going further — in
rough order of likelihood, the usual causes are: the document root points
at `domains/vault.soricu.com/` instead of its `public_html/` subdirectory
(fixes the `config/config.php` and `cron/` checks at once), `.htaccess`
didn't upload or `AllowOverride` isn't enabled for this domain (contact
your host if `mod_headers`/`mod_rewrite` directives seem to have no effect
at all — DirectAdmin/LiteSpeed usually honor `.htaccess` by default, but a
custom LiteSpeed vhost config can disable overrides), or a bulk upload
included files it shouldn't have.

---

## 7. Five-minute post-deploy checklist

1. **HTTPS works and HTTP redirects to it.** Visit `http://vault.soricu.com`
   (no `s`) — confirm it 301s to `https://`. Confirm the padlock shows a
   valid cert.
2. **Run every URL in §6** — all 403/404.
3. **Client-side routes work on a direct/fresh load, not just via in-app
   navigation.** Visit `https://vault.soricu.com/settings`,
   `/forgot-password`, and `/reset-password?token=x` directly (paste the
   URL, don't click to them from within the app) — all should return
   **200** and show the app, not a server 404. These are routes React
   Router handles client-side; without an SPA-fallback rewrite rule in
   `.htaccess` (`RewriteCond %{REQUEST_FILENAME} !-f` /
   `!-d` → `RewriteRule ^ index.html`), the server looks for a real file at
   that path, finds nothing, and 404s — which is exactly how a real
   deployment's password-reset emails were caught broken (the emailed link
   points straight at `/reset-password`, a path nobody had ever needed to
   load directly before that feature existed). This is easy to miss if you
   only ever test by clicking around inside an already-loaded app.
4. **Register a real test account** through the actual UI at
   `https://vault.soricu.com`. Confirm the "Deriving key…" loading state
   appears briefly (proves the Argon2id WASM module loaded — if it hangs or
   errors here, open the browser console and check for a CSP violation
   naming `script-src`/`'wasm-unsafe-eval'` before anything else).
5. **Open browser DevTools → Application/Storage → Cookies** for
   `vault.soricu.com`. Confirm the session cookie (`pk_session`) shows
   `HttpOnly` ✓, `Secure` ✓, `SameSite=Strict`. Confirm `pk_csrf` is
   present and **not** `HttpOnly` (it has to be JS-readable — see
   `docs/ARCHITECTURE.md`).
6. **Add one vault entry, then reload the page.** Confirm it shows the lock
   screen (not a broken/blank page — see `docs/ARCHITECTURE.md` §5 on why
   a reload always re-locks), and that entering the same password unlocks
   it and the entry is still there.
7. **Check response headers** on the main page (DevTools → Network → click
   the document request → Headers): `Content-Security-Policy` present and
   matching the CSP set in `backend-php/public_html/.htaccess`,
   `Strict-Transport-Security` present, `X-Frame-Options: DENY` present.
   Then click any `/api/*.php` request in the same Network tab and confirm
   *its* CSP is the strict `default-src 'none'` one from
   `lib/security_headers.php` — **not** the SPA's — confirming the
   `env=SPA_CONTEXT` scoping in `.htaccess` is actually working and not
   silently overwriting the API's own header (see the comment at the top
   of that `.htaccess` for why this specific check matters).
8. **Trigger the backup cron job once manually** rather than waiting for
   03:00 — DirectAdmin's Cron Jobs page usually has a "run now" action, or
   just temporarily set it to run a minute from now and change it back
   after. Confirm a `.sql.gz` file appears in
   `domains/vault.soricu.com/backups/` via File Manager, and that you
   received (or can see logged) the row-count output.
9. **Trigger a real password-reset email.** From the login page, click
   "Forgot password?", submit the test account's real email address, and
   confirm the email actually arrives (check spam too) within a minute or
   two. Click the link, confirm it lands on `/reset-password` with a valid
   (not "invalid/expired") token, and complete a reset. If the email never
   arrives, check DirectAdmin's mail queue/logs (**Email** → **Email
   Queue** or equivalent) before assuming the app is broken — this is very
   often an SPF/DKIM or mailbox-existence issue (see §5's mail note), not a
   PHP one; `mail()` returning `true` only means the message was accepted
   for local delivery, not that it was delivered.
10. **Set up 2FA on the test account and confirm it actually gates login.**
    Settings → Two-factor authentication → Enable → scan the QR with a
    real authenticator app (not a simulated code) → confirm the code
    verifies. Log out and back in: confirm you're now challenged for a
    code. Check "remember this device," verify, log out and back in again:
    confirm the challenge is skipped this time. Then change the master
    password and confirm the *next* login challenges again even though the
    device was remembered — proves the revoke-on-password-change behavior
    is live in production, not just in local testing.

If all ten pass, the deployment matches the architecture documented in
`docs/ARCHITECTURE.md` and `docs/THREAT-MODEL.md`.
