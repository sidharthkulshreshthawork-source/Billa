# Billa — Optional Accounting (Beta) Inside the Original Billing App

> This is an **experimental, service-only, single-owner accounting vertical slice**.
> It is **not** a production-ready GST filing or full-accounting release.
> The original Dashboard, invoices, customers, products, inventory and reports
> remain the default. Accounting (Beta) is a separate optional sidebar section.

## Requirements

- Node.js **22.16 or later** (the feature uses `node:sqlite`).
- The original Billa repository and its dependencies (`npm ci`).
- Local computer access. The Express server binds to loopback.

## How to try it (Windows PowerShell)

```powershell
node --version
npm ci
npm run build
$env:ACCOUNTING_MODE = "1"
$env:ACCOUNTING_DATA_DIR = "$HOME\Documents\BillaAccountingData"
npm run server
```

Open the local URL printed by the server (normally `http://localhost:47371`).
**Billa opens its original interface first**. Choose **Accounting (Beta)** from
the original sidebar to open the isolated SQLite workspace. Closing or leaving
Beta returns to the original Billa application and does not import old invoices.

On macOS/Linux or in a temporary test terminal:

```bash
ACCOUNTING_MODE=1 ACCOUNTING_DATA_DIR="$HOME/BillaAccountingData" npm run server
```

The original GST Billing application works **even while `ACCOUNTING_MODE=1`**.
Setting `ACCOUNTING_MODE=0` hides the Beta section. Original records remain
under the legacy app's `data/` directory by default (or `BILLA_LEGACY_DATA_DIR`
when explicitly configured). Beta accounting records remain in
`ACCOUNTING_DATA_DIR`. There is **no automatic import, cross-posting or sync**.

## Supported first workflow

1. Create your local business using a password of at least 12 characters. No internet account.
2. Sign in. Enter your real seller state and GSTIN under **GST settings** if registered.
3. Create a **service credit invoice** in INR. Supply the real customer, place of supply,
   service SAC code, quantity, unit rate, and an **explicitly selected, validated GST rate**.
   Do not assume the software has checked all GST classification obligations.
4. Click **Save draft & calculate**. Server computes values and returns actionable errors.
   Drafts do **not** enter the journal.
5. Check taxable value, CGST/SGST or IGST, and grand total in the confirmation dialog.
   Click **Confirm and post**. Approval binds the exact version and expires after five minutes.
6. See an immutable posted invoice with a **print-friendly** view.
7. Open **Accounts** to inspect the double-entry journal, trial balance, output GST,
   and unpaid customer receivables. These reports derive from finalized SQLite entries.

### INR 10,000 + 18% GST example (Rajasthan to Rajasthan)

| Ledger account | Debit | Credit |
| --- | ---: | ---: |
| Trade receivables | ₹11,800 | |
| Service revenue | | ₹10,000 |
| Output CGST | | ₹900 |
| Output SGST | | ₹900 |

The same transaction across states records ₹1,800 output IGST instead.

## Security and limitations

- This local mode is owner-only with an HTTP-only session cookie, salted scrypt
  password verification, CSRF protection and same-origin checks.
- Original JSON billing APIs stay available in the main Billa app. Beta
  uses only authenticated `/api/v2/*` routes and its own SQLite database.
  Old JSON documents and `data/` are **not** silently migrated or posted.
- The Beta owner login protects only the Beta ledger. It does **not** protect
  legacy JSON endpoints; keep Billa bound to localhost and use existing
  security options for the original billing app.
- If your original Billa installation was in **another folder**, the updater
  cannot automatically discover that installation's old data. Use a verified
  legacy backup/restore process; never copy legacy JSON files into SQLite.
- SQLite stores amounts in integer paise, uses foreign keys, and posts documents,
  journal entries, approval consumption, idempotency records and audit events in
  one transaction. Finalized journals cannot be edited or deleted.
- The new SQLite database is **not encrypted at rest**. Keep the computer secured.
  Because the SQLite database runs in WAL mode, **shut down Billa before copying
  the entire accounting data directory for backup**. Never copy a live `.sqlite`
  file alone. Automated verified encrypted backups are still to be built.
- There is no password reset/email recovery yet; keep a reliable password record.
- Only service invoices with basic intra- or inter-state tax splits are supported.
  Returns, credit notes, receipts/settlement, bank reconciliation, inventory/COGS,
  advanced GST, GSTR filings, complete P&L, balance sheet and cash flow are not
  enabled in accounting mode. A revenue figure **is not profit**.
- There is no automatic multi-business switching, PostgreSQL cloud mode, AI/MCP
  connection, offline/cloud sync, production e-invoice or GST portal integration.
- GSTIN validation currently checks its format/state prefix. **A GST professional
  should verify actual registration status, jurisdiction and applicable rate.**
- This mode is not meant for a public server: retain loopback binding and do not
  expose the port through a reverse proxy.

## Repeatable checks

```bash
npm run test:accounting
npm run test:accounting:e2e
npm run test:unit
npm run build
npx playwright install chromium firefox
npm run test:accounting:ui
node tests/smoke.mjs
```

The feature branch's GitHub Actions workflow runs all of these. **Do not claim
the feature production-ready or all tests passing without inspecting the
actual workflow results.** The original app includes known baseline lint
diagnostics, which are reported separately.

## Rollout plan

This first feature is the foundation for the complete accounting V1. Next:
stock-backed purchase/sale accounting, receipts and expenses, corrections
and bank reconciliation, full reports, PostgreSQL cloud parity, MCP access,
legacy JSON migration, Windows signed installer, backup and recovery hardening.
These are not represented as shipped features here.
