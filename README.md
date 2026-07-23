# Pass Keeper

A self-hosted, multi-user personal password manager. Node/Express + SQLite backend, React + Tailwind frontend, built to run as a single process on your own server.

## Security model

- Master passwords are hashed with **Argon2id** — never stored in plaintext.
- Vault entry passwords/notes are encrypted at rest with **AES-256-GCM** using an envelope-encryption scheme:
  - Each user gets a random **Data Encryption Key (DEK)** at registration.
  - The DEK is wrapped (encrypted) with a **Key-Encryption-Key (KEK)** derived from the master password via Argon2id + a per-user salt.
  - Only the wrapped DEK is stored in the database — the plaintext DEK and KEK never touch disk.
  - At login, the KEK is re-derived from the submitted password to unwrap the DEK, which is then held **only in server memory**, keyed by an opaque session ID. A server restart clears all sessions (users must log back in) by design — key material is never persisted.
- Sessions use an httpOnly, `Secure` (in production), `SameSite=Strict` cookie holding a random session ID — not a JWT, since the in-memory key store already requires server-side session state.
- CSRF is mitigated via `SameSite=Strict` plus a hand-rolled double-submit cookie token required on all state-changing requests.
- Login/registration are rate-limited per IP.
- `two_fa_enabled` / `two_fa_secret` columns exist on `users` for a future phase; the Settings page shows a disabled "coming soon" toggle only — no TOTP logic is implemented yet.

## Project structure

```
backend/    Express API + SQLite (better-sqlite3), serves the built frontend in production
frontend/   React + Vite + Tailwind SPA
```

## Setup

Requires Node.js 18+.

```bash
npm install                 # installs both workspaces
cp backend/.env.example backend/.env
```

Edit `backend/.env` and fill in real random values for `COOKIE_SECRET`, `CSRF_SECRET`, and `ENCRYPTION_PEPPER`, e.g.:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run that three times for the three secrets. **Back up `ENCRYPTION_PEPPER` somewhere safe** — losing it permanently locks every user out of their vault.

The SQLite database is created automatically (via migration) the first time the backend starts; no manual step is needed.

## Development

```bash
npm run dev
```

This runs the backend on `http://localhost:4000` and the Vite dev server on `http://localhost:5173` (which proxies `/api` requests to the backend, so cookies work without CORS). Open `http://localhost:5173`.

## Production

```bash
npm run build     # builds frontend/dist
npm start          # runs migration, then starts the backend, which serves frontend/dist
```

Put this behind a reverse proxy (nginx/Caddy) that terminates HTTPS — the session cookie is marked `Secure` when `NODE_ENV=production`, so it will only be sent over HTTPS.

## Data

The SQLite file lives at `backend/data/pass-keeper.db` (gitignored). Back this file up regularly — combined with `ENCRYPTION_PEPPER`, it's the only copy of every user's vault.
