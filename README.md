<div align="center">

# OpenABX

**An open-source UI for the AlphBanX stablecoin protocol on Alephium.**

Unaffiliated with AlphBanX. Client-only. Hosted on GitHub Pages.

[![CI](https://github.com/openABX/openABX-frontend/actions/workflows/ci.yml/badge.svg)](https://github.com/openABX/openABX-frontend/actions/workflows/ci.yml)
[![Mainnet address drift](https://github.com/openABX/openABX-frontend/actions/workflows/verify-mainnet.yml/badge.svg)](https://github.com/openABX/openABX-frontend/actions/workflows/verify-mainnet.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg)](./LICENSE)

[Live site](https://openabx.com) · [Release notes](./RELEASE-CANDIDATE.md) · [Security](./docs/05-security.md) · [Reference contracts](https://github.com/openABX/openabx-ref-contracts)

</div>

---

## What this is

AlphBanX is a CDP stablecoin protocol on Alephium — borrow **ABD** against **ALPH**, earn by absorbing liquidations in four auction pools, stake **ABX** for a share of every protocol fee. The contracts are live on mainnet.

OpenABX is an independent, MIT-licensed user interface to those same contracts. Everything a user can do at `app.alphbanx.com` — borrow, stake, deposit, redeem — also works here. Every write is **simulated against mainnet state before your wallet signs**, so if it would revert, you see the error instead of signing a failing tx.

**Why it exists:** if the primary UI ever goes offline, OpenABX keeps working. That's the whole pitch.

**Scope:** this repo is purely the frontend — no contracts of our own are deployed from here. The clean-room Ralph reference implementation that used to live alongside the UI was split out on 2026-04-24 to [`openABX/openabx-ref-contracts`](https://github.com/openABX/openabx-ref-contracts); it is testnet-only and has no bearing on what the live site does.

## Mainnet status

| Operation                                        | Status                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| Borrow / repay / close / add+withdraw collateral | ✅ wired, simulation-gated                              |
| Redeem (unified with closeLoan, mi=19)           | ✅ wired                                                |
| Stake / unstake / claim rewards                  | ✅ wired, full drain per claim (see note below)         |
| Auction pool deposit / withdraw / claim          | ✅ wired                                                |
| Borrow more (existing loan)                      | ⏳ mi=7 template's U256 semantics still ambiguous       |
| Liquidate                                        | ⏳ keeper-only — no live sample tx to template from yet |
| Vesting claim                                    | ⏳ AlphBanX hasn't activated Vesting on mainnet         |

11 of 14 operations are live, simulation-verified end-to-end. A daily GitHub Actions cron re-hashes every AlphBanX mainnet contract and auto-opens an incident issue on drift.

**Claim-rewards correctness (2026-04-24).** The AlphBanX `StakeManager.claim` method takes its U256 arg as a hard cap (`transferred = min(arg, realPending)`), not as an ignored hint — confirmed via live simulation-diff against tx `bc74392f…a3a6c`. Earlier OpenABX builds baked the sample-tx value of 5.386 ALPH into the script, silently short-paying any user with more pending than that. Both the displayed pending (now read via a claim-simulation probe) and the claim tx itself (now sends an oversized arg so the contract caps at actual pending) drain fully in one click. The same class of bug was found and fixed in `claimUnstake` during the follow-up audit. Users short-paid by the prior versions can simply click Claim again to recover the stuck remainder; no on-chain migration required.

## Quick start

```bash
pnpm i
pnpm typecheck && pnpm lint && pnpm test
pnpm dev                         # http://localhost:3000 (mainnet)
```

`NEXT_PUBLIC_NETWORK` is fixed to `mainnet`; any other value is rejected at build time. Contributors who want a sandboxed end-to-end can deploy the reference contracts from [`openabx-ref-contracts`](https://github.com/openABX/openabx-ref-contracts) to a local devnet and point a fork's build at it.

Build a static bundle to match what GitHub Pages serves:

```bash
pnpm -C web build                # output: web/out/
```

## Hosting your own mirror

```bash
git clone https://github.com/openABX/openABX-frontend
cd openABX-frontend
pnpm i
pnpm -C web build
# serve web/out/ from any static host
```

Fork, tag, deploy. OpenABX can't push an update to your mirror unless you pull. Community mirrors don't inherit the official openabx.com Umami analytics unless they set `NEXT_PUBLIC_UMAMI_WEBSITE_ID` themselves.

## Clean-room discipline

Before any line of code was written:

- No JavaScript source from `app.alphbanx.com` was read.
- No Ralph bytecode has been decompiled.
- Every mainnet write template is built from **publicly observable transactions** — decoded, decompiled never.
- AlphBanX's own source repo has been **intentionally not accessed**.

Every commit message reaffirms this discipline.

## Repository layout

```
web/          Next.js 14 frontend — 9 routes, static export
sdk/          TypeScript SDK: network, addresses, ABIs, mainnet templates
e2e/          Playwright smoke tests
scripts/      Operator scripts: verify-mainnet-addresses, observe-alphbanx-writes, catalog-alphbanx-writes
.github/      CI + Pages deploy + daily address-drift cron + bug-report issue form
docs/         Frontend-scoped docs (architecture, security, user guide, mainnet write path)
references/   Published paper, contract address log, operation templates
```

## Where to read next

- [`RELEASE-CANDIDATE.md`](./RELEASE-CANDIDATE.md) — what's in v0.1.0-beta, what's deferred.
- [`docs/05-security.md`](./docs/05-security.md) — threat model, incident-response playbook, drill cadence.
- [`docs/06-user-guide.md`](./docs/06-user-guide.md) — user-facing walkthrough.
- [`docs/07-mainnet-write-path.md`](./docs/07-mainnet-write-path.md) — how the mainnet operation templates were built.
- [`references/alphbanx-contract-addresses.md`](./references/alphbanx-contract-addresses.md) — AlphBanX mainnet addresses + provenance.
- [`openABX/openabx-ref-contracts`](https://github.com/openABX/openabx-ref-contracts) — clean-room Ralph implementation + protocol spec + reward-math derivations.

## Security

Report vulnerabilities via [Security Advisory](https://github.com/openABX/openABX-frontend/security/advisories/new). See [`docs/05-security.md §Incident response`](./docs/05-security.md#incident-response) for what happens next.

For security issues in **AlphBanX's mainnet contracts**: not our contracts. Report to AlphBanX directly via their Discord / Telegram.

## Acknowledgements

- Zahnentferner, _"BanX: A Hybrid Crypto-Backed and Crypto-Collateralized Stablecoin Protocol"_ (Nov 2024) — foundational design.
- AlphBanX team — for the live mainnet deployment and public GitBook.
- Inference AG — the public audit that gave us the canonical decomposition.
- Liquity Labs — the v1 Stability Pool + SortedTroves patterns.
- Alephium core team — Ralph, SDK, explorer, testnet reliability.
- DIA — ALPH/USD oracle feed.

## License

[MIT](./LICENSE). Fork freely.
