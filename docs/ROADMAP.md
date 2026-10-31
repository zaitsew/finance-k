# Roadmap

The owner's words, 2026-10-23: "Can we develop a tool that will take data from all my
financial apps (banks, crypto, etc.) + cash and make me a monthly summary of the
state and month-to-month changes. Also i wanna track there what accounts i have."

Placement: a separate product with a link to BankJar. Primary platform: a local web
app on the Mac. Personal data stays on the Mac.

## S1 — registry, month-end snapshots, monthly summary

Serves: "track there what accounts i have", "+ cash", "a monthly summary of the
state and month-to-month changes".

- Account registry: institution, kind, currency, IBAN last 4, opened, purpose,
  fees, status, data source, optional BankJar bank id.
- Positions per account: cash in a currency, or an asset with a quantity.
- "Close the month": one screen with every open account, the last value
  prefilled, and a cash-on-hand row per currency.
- FX: ECB daily rates; RUB from the Bank of Russia (the ECB stopped RUB in 2022).
- Crypto prices: CoinGecko public API.
- Monthly summary: net worth in EUR. It splits the change into flows, market
  moves and FX, and breaks totals down by kind, currency and institution.
  It also lists dormant accounts.
- Idle cash in a bank account links to BankJar's savings offers.
- JSON export and import of the whole store.

## S2 — EU banks via Enable Banking (PSD2, read-only)

Serves: "take data from all my financial apps (banks ...)".

- Enable Banking restricted production: free, own accounts only.
- Owner step: sign up in the Enable Banking Control Panel and create an app.
- Balances sync daily. Transactions feed the flows split. A consent expiry
  warning appears 14 days ahead.

## S3 — crypto

Serves: "(banks, crypto, etc.)".

- Exchanges with read-only API keys (Revolut X, Kraken, Binance), keys in the
  macOS Keychain.
- Wallets by public address (BTC via mempool.space, EVM chains via public RPC).

## S4 — the summary comes to you

- A launchd job on the 1st of each month: sync, close the month, notify.
- An optional Haiku 5.5 narrative from aggregates only; no raw transactions
  leave the Mac.
- Statement import (CSV, then PDF) for banks with no API, such as Russian banks.
