# Getting started with Finance K

## What this is

A private month-end ledger of your accounts. At the end of each month you type in the
balances, and Finance K shows your net worth and what moved it.

## What you need before you start

- A Mac with Node 24 or newer.
- Nothing else: no account, no key. Rates come from public APIs.

## First five minutes

1. Run `npm install`, then `npm run dev`, and open http://127.0.0.1:4817.
2. Choose "Add your first account" and enter a bank, a name and a currency.
3. Open "Close month", press "Fetch rates", type each balance and save.

You are set up when: **the Summary page shows your net worth for that month.**

## What it costs you

Nothing. The rate APIs are free and need no key.

## Your data

It lives in one SQLite file on this Mac (`FINANCE_K_DATA_DIR`, default
`~/Library/Application Support/finance-k`). Nothing is uploaded. Settings has a JSON
export; deleting the file deletes everything.

## When something is wrong

Run `./check.sh` and read what it prints. Include that output, what you clicked and what
you expected when you report a problem.
