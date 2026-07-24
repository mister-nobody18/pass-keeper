# Threat model

**Status: planning document, written against the target PHP/MySQL architecture
described in `docs/ARCHITECTURE.md`, before that architecture is implemented.**

This is written to be read honestly, including the parts that are uncomfortable.
A threat model that only lists what a design protects against isn't a threat
model, it's marketing. The most important section here is §2.

---

## 1. What this design protects against

**Assumption throughout: TLS is enforced (HTTP redirects to HTTPS, HSTS set).
Every property below silently depends on that; without TLS, several of them
collapse.**

- **Server or database compromise (read access) does not expose vault
  contents.** An attacker who steals the MySQL database, a backup file, or
  gets read access via a vulnerability gets: email addresses, password
  hashes (of a value that isn't the master password — see below), KDF
  salts/params, opaque AES-GCM ciphertext blobs, session token *hashes*, and
  rate-limit/session metadata. They do not get plaintext vault contents,
  the master password, or the encryption key, because none of those are
  ever transmitted to or computed by the server.

- **The operator (hosting provider, DBA, or a passive observer of server
  memory/logs) cannot read vault contents**, for the same reason — the
  server is architecturally incapable of decrypting the blob it stores. This
  is a real, meaningful property against a *curious or compromised backend*,
  distinct from the JavaScript-serving concern in §2.

- **A stolen `users` table does not hand out working login credentials.**
  `auth_hash` (itself derived client-side from the master password) is
  hashed again server-side with `password_hash(..., PASSWORD_ARGON2ID)`
  before storage. An attacker with the stored value cannot submit it
  directly at the login endpoint and succeed — they'd need to invert an
  Argon2id hash, which is the point of using Argon2id. This is a real
  protection, but read it precisely: it protects login-as-user, not the
  vault. See §2's clarification of what stealing the DB *does* still allow.

- **Stolen session tokens (via DB leak, not live traffic interception) don't
  work either** — the `sessions` table stores only a SHA-256 hash of the
  token, the same reasoning as password hashing.

- **CSRF** is mitigated via a `SameSite=Strict` cookie plus a double-submit
  token that a cross-origin attacker cannot read (browser same-origin
  policy) and therefore cannot echo back in the required header.

- **Brute-force login/registration attempts** are slowed by the
  `rate_limits` table (per-IP and per-account buckets) and by Argon2id's
  deliberate cost on both the client (real KDF) and server (the re-hash of
  `auth_hash`).

- **SQL injection** is not a realistic vector if (and only if) every query
  uses PDO prepared statements with bound parameters, mirroring the current
  Node backend's discipline with `better-sqlite3`. This is a coding
  standard the implementation must hold to, not a property of the
  architecture on its own — call it out in code review every time.

- **Cross-user data access via authorization bugs** is mitigated by scoping
  every vault/session query to the authenticated `user_id`, never trusting
  a client-supplied ID alone.

- **XSS exfiltrating the in-memory encryption key during an active
  session** is mitigated by a tuned CSP (no `'unsafe-inline'` for scripts,
  no third-party script origins, no runtime CDN fetches) — the same posture
  the current frontend already has, extended to allow WASM instantiation
  (`'wasm-unsafe-eval'`) without opening the door to arbitrary inline
  script execution. This reduces but does not eliminate XSS risk; see §2.

---

## 2. What this design does NOT protect against

Read this section even if you skip everything else.

### 2.1 A compromised server can serve tampered JavaScript — the central residual risk

This is the honest headline limitation of any browser-based zero-knowledge
design, and it applies fully here. The client-side crypto is only as
trustworthy as the JavaScript the server delivered to run it. If an attacker
gains write access to the files this server serves — through a hosting
panel compromise, a vulnerability elsewhere on shared infrastructure, a
malicious insider with file-manager access, a supply-chain compromise of a
vendored dependency, or the hosting provider itself acting maliciously —
they can simply edit the served JavaScript to:

- send the master password (or the derived encryption key) to an
  attacker-controlled endpoint the instant the user types it,
- silently exfiltrate the decrypted vault after the legitimate app decrypts
  it locally,
- or serve a convincing fake login page.

**No purely client-side defense fully closes this.** The verifier — the
browser running the page — has no independent channel to confirm the code
it just received is the code you intended to ship, because the same
compromised origin serves the "trusted" code and any check on it.
Subresource Integrity can pin the hash of secondary bundles/assets loaded
by the entry point, but the entry HTML/JS itself is the root of trust and
can't self-verify. This is precisely why hardware wallets, Signal, and
Bitwarden's own browser-extension/native-app model all exist as *separate,
independently distributed and updated* software rather than as pure
web apps — a browser extension or native app can be pinned to a specific,
auditable version that isn't re-served by the same origin on every page
load. A plain web app, by construction, re-trusts the server on every visit.

This is not a flaw specific to this implementation. It's an accepted,
structural limitation of the "zero-knowledge web app" category as a whole,
and it is *worse* on unmanaged shared hosting specifically, because:

- there's no SSH to run file-integrity monitoring tooling on the host
  itself,
- deployment is via file upload (FTP/File Manager), which is itself a
  credential worth protecting as carefully as a database password,
- the hosting provider's own security posture (patching, staff access
  controls, isolation between tenants) is entirely outside this project's
  control.

**Mitigations that reduce (not eliminate) this risk**, to actually implement:

- Keep deploy credentials (DirectAdmin/FTP) high-entropy, unique, and under
  MFA where the panel supports it — treat them as equivalent in sensitivity
  to a database root password, because a compromise of either has the same
  practical outcome.
- Vendor all frontend dependencies at build time (already the project's
  practice — no runtime CDN script tags) so there's no third-party origin
  that could serve a compromised script on a bad day.
- Keep a git-committed, reproducible build (`vite build` from a clean
  checkout should always produce byte-identical output for a given commit)
  so that "what's actually deployed" can be diffed against "what git says
  should be deployed" by an external process — e.g., periodically fetching
  the live JS and comparing its hash against the hash recorded at release
  time. This needs to run *off* the shared host to be meaningful (a cron
  job on the same compromised server proves nothing).
- Minimize the deployed surface: no admin panels, no unused endpoints, no
  debug tooling left reachable in production.
- Accept, explicitly and in writing (this document), that this residual
  risk exists and is not closable within a "PHP-only shared hosting, no
  SSH" constraint. If the threat model for this deployment ever needs to
  exclude "hosting provider or panel-credential compromise," the project
  needs a different hosting model (a VPS with file-integrity monitoring, a
  signed/pinned browser extension, or a native app) — that's a real,
  legitimate future option, not a criticism of this one.

### 2.2 Offline brute-force of the master password, given a stolen database

Stated precisely, because it's easy to overstate what the server-side
`auth_hash` re-hashing (§1) buys you: it does **not** slow down an attacker
trying to open the *vault* ciphertext. Given a stolen `vaults.ciphertext`
and the matching `kdf_salt`/`kdf_params`, an attacker doesn't need the
server at all — they run the same Argon2id + HKDF the browser would, for
each candidate master password, and the AES-GCM authentication tag tells
them immediately whether they guessed right. This is exactly the same
shape of attack every zero-knowledge password manager's design accepts
(Bitwarden, 1Password, etc. all have this property) — the entire defense is
the master password's strength and Argon2id's cost, full stop. Two
consequences worth stating outright:

- The Argon2id **parameters chosen for the browser KDF** (memory cost,
  iterations) are the single most load-bearing security parameter in this
  whole system for vault confidentiality. They need to be as high as the
  slowest realistically-supported device/browser can tolerate without the
  UX becoming unusable, and they should be revisited periodically as
  hardware improves (which is exactly why `kdf_params` is stored
  per-user and versioned — see `docs/ARCHITECTURE.md` §3).
- **A weak master password is not protected by anything else in this
  system.** There's no secondary factor by default (2FA is out of scope
  for this migration), no server-side lockout that helps against an
  *offline* attack (lockouts only slow down attempts made *through* the
  server), and Argon2id raises the cost per guess but does not make a
  short/common password safe against a determined, patient attacker with a
  stolen database.

### 2.3 A compromised or malicious client device

Out of scope for any password manager, stated for completeness: keyloggers,
malicious browser extensions with page-content access, malware with
clipboard access, or a compromised OS can observe the master password as
it's typed or the vault contents as they're displayed, regardless of any
server-side design. The clipboard-clear timer and hold-to-reveal patterns
reduce casual/incidental exposure (shoulder-surfing, a decrypted password
lingering in the clipboard) — they do not defend against active malware on
the device.

### 2.4 Metadata leakage

Even with vault contents fully opaque to the server, the server necessarily
observes and stores: email addresses, account creation/login timestamps,
approximate vault size and how often it changes (ciphertext length, update
frequency), IP addresses at the point of rate-limiting (hashed at rest, but
seen in plaintext in transit and in web server access logs, which are
outside this application's control on shared hosting), and session
metadata. None of this reveals vault *contents*, but it is not nothing —
document it as a known, accepted limitation rather than pretending the
system leaks zero information.

### 2.5 Permanent, unrecoverable data loss on a forgotten master password

Not a third-party attack, but a critical property to be explicit about: this
design has, by construction, no "forgot password" recovery path for the
vault's contents. The server cannot decrypt the vault under any
circumstances, including a legitimate request from the account owner who
forgot their password — because the server never had the key. This is the
correct trade-off for genuine zero-knowledge (a recoverable system is a
system where the server, or someone who compromises it, can also recover
your data), but it means the UI and documentation must make this
unambiguous *before* a user picks a master password, not after they've lost
one. See the warning required in `README.md`.

### 2.6 Denial of service and shared-hosting-specific operational risk

Out of scope by necessity: there is no control over "noisy neighbor"
resource contention, the hosting provider's own uptime/patching practices,
or protection against volumetric DoS on shared infrastructure. Rate
limiting in `rate_limits` addresses *credential*-stuffing-style abuse of
the login endpoint, not infrastructure-level denial of service.

### 2.7 What server-side rate limiting via MySQL does and doesn't guarantee

The fixed-window counter approach (`docs/ARCHITECTURE.md` §3) is atomic
under InnoDB and race-safe for its own bucket, but it is coarser than the
in-memory sliding-window limiter the Node prototype used — a burst
straddling a window boundary can allow up to roughly double the nominal
limit in the worst case. Acceptable at this population size; noted so it's
a documented trade-off, not a silent gap.

---

## 3. Summary judgment

This design meaningfully raises the bar for what a server compromise or
database leak can yield, compared to a traditional password manager that
stores plaintext or server-decryptable data — that's the whole point, and
it's real. It does **not**, and structurally cannot, protect against a
compromise of the code-delivery path itself (§2.1), and it does not change
the fundamentals of offline brute-force resistance (§2.2) or client-device
compromise (§2.3). Anyone relying on this system should understand it as
"the operator cannot casually read your vault, and a passive database leak
doesn't hand it over either" — not as "this system is safe even if the
server is actively compromised by a capable attacker who controls what code
gets served." Those are different, and only the first is true here.
