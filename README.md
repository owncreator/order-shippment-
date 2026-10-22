# ParcelGuard Order Tracking Portal

A responsive full-stack order tracking starter with customer accounts, owner/staff dashboard, manual shipment events, encrypted private order fields, and an optional AfterShip courier adapter.

## Features

- Customer registration, login, session persistence, and private order history.
- Admin/staff dashboard with summary metrics, customer directory, order search, order creation, and status updates.
- Public tracking page exposes only order summary, tracking number, carrier, ETA, and tracking events. It does not expose customer email, address, amount, or internal notes.
- Unique order and tracking identifiers generated using cryptographically secure randomness.
- Passwords hashed with Argon2id.
- AES-256-GCM encryption for destination and internal notes at rest, with random nonce and authenticated tag per value.
- PostgreSQL-backed sessions; HttpOnly and SameSite cookies, Secure cookies in production.
- Helmet security headers, Content Security Policy, request size limits, Zod validation, rate limiting, origin checks, and CSRF token checks on state-changing API requests.
- Manual tracking updates and optional AfterShip v4 sync.

## Requirements

- Node.js 20+
- PostgreSQL 14+
- TLS/HTTPS in production
- An AfterShip API key if automatic courier sync is needed

## Local setup

1. Create a PostgreSQL database named `parcelguard` (or update `DATABASE_URL`).
2. Copy `.env.example` to `.env`.
3. Generate secrets:
   ```bash
   openssl rand -base64 32
   ```
   Set a random `SESSION_SECRET` (at least 32 characters). For `DATA_ENCRYPTION_KEY`, generate a 32-byte key:
   ```bash
   openssl rand -base64 32
   ```
   Do not reuse one secret for both values. Keep `.env` out of source control.
4. Install and initialise:
   ```bash
   npm install
   npm run db:init
   ```
5. Create the first admin account:
   ```bash
   npm run admin:create -- "Portal Owner" owner@example.com "use-a-long-unique-password"
   ```
   Use a password of at least 14 characters for the admin.
6. Start:
   ```bash
   npm run dev
   ```
7. Open `http://localhost:3000`.

Customers can register through the website. An order can be assigned to a customer only after that customer has registered with the same email.

## Courier API

The included adapter is for AfterShip Tracking API v4. Set `AFTERSHIP_API_KEY` in the server environment, then set a supported carrier slug and courier tracking ID on an order. The **Sync** button fetches the tracking record and records the latest checkpoint/status when a recognised status is returned.

Carrier slug support and API behaviour depend on your AfterShip account and current API version. Test with a sandbox/test tracking number first. The app does not claim courier tracking is live when the API key is absent. Never place the provider key in browser JavaScript.

## Deployment checklist

- Deploy Node app and PostgreSQL to trusted providers. Use the provider's private database networking where possible.
- Set `NODE_ENV=production`, `PUBLIC_BASE_URL`, `DATABASE_URL`, `SESSION_SECRET`, and `DATA_ENCRYPTION_KEY` as deployment secrets.
- Set `TRUST_PROXY=1` only when the app is behind a correctly configured trusted reverse proxy.
- Terminate HTTPS at a trusted proxy/platform and confirm secure cookies work end-to-end.
- Run `npm run db:init` as a release/migration step, not on every request.
- Restrict admin creation and database access. Do not expose the admin creation command to the public internet.
- Configure encrypted database backups, restore testing, log retention, alerting, and key rotation procedures.
- Add transactional email for password reset and order notifications before using this for real customers.
- Before production, add formal security review, automated tests, dependency scanning, monitoring, privacy/retention policies, and a documented incident-response plan.

## Security notes and limits

This is a functional starter, not a claim of a completed independent security audit. TLS protects data in transit; AES-GCM protects the selected fields at rest. The application server decrypts address/notes for authorised staff, so it is not end-to-end encryption. Anyone with the application encryption key and database access may be able to decrypt those fields. Back up keys separately and plan key rotation before storing real data.

Session CSRF protection is synchronised to the session. Use the same origin for the UI and API. Avoid permissive CORS. In production, the default Content Security Policy permits the Google Fonts stylesheet import used by the UI only if the CSP is updated to include the font stylesheet/font hosts; alternatively remove the `@import` and use system fonts. For a strict CSP, self-host fonts.

Public tracking numbers are bearer identifiers. Share them only with intended recipients. For higher privacy, require a second verification factor (e.g. order postcode/OTP) before showing the full event history. Do not put full addresses, customer contact details, or sensitive notes into tracking event descriptions.

## Main API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/track/:trackingNumber`
- `GET /api/customer/orders`
- `GET /api/admin/summary`
- `GET /api/admin/orders?q=...`
- `POST /api/admin/orders`
- `PATCH /api/admin/orders/:id/status`
- `POST /api/admin/orders/:id/sync`
- `GET /api/admin/customers`

All state-changing API calls require the session CSRF token in `x-csrf-token`, provided by `GET /api/csrf` or auth responses.
