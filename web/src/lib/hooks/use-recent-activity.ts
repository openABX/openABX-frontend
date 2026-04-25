"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@alephium/web3-react";
import { getNetworkConfig } from "@openabx/sdk";
import { NETWORK } from "@/lib/env";

export type ActivityKind =
  | "openLoan"
  | "repay"
  | "addCollateral"
  | "withdrawCollateral"
  | "closeLoan"
  | "redeem"
  | "stake"
  | "unstake"
  | "claim"
  | "poolDeposit"
  | "poolWithdraw"
  | "poolClaim"
  | "other";

export interface ActivityEntry {
  txId: string;
  timestamp: number;
  kind: ActivityKind;
  alphDelta: bigint;
  abdDelta: bigint;
  abxDelta: bigint;
}

interface ExplorerTx {
  hash: string;
  timestamp: number;
  inputs?: Array<{
    address?: string;
    contractInput: boolean;
    attoAlphAmount?: string;
    tokens?: Array<{ id: string; amount: string }>;
  }>;
  outputs?: Array<{
    type: string;
    address: string;
    attoAlphAmount?: string;
    tokens?: Array<{ id: string; amount: string }>;
  }>;
}

// Token IDs on mainnet (derived via contractIdFromAddress).
const ABD_ID =
  "c7d1dab489ee40ca4e6554efc64a64e73a9f0ddfdec9e544c82c1c6742ccc500";
const ABX_ID =
  "9b3070a93fd5127d8c39561870432fdbc79f598ca8dbf2a3398fc100dfd45f00";

// Audit fix H5: shape-validate the explorer response before walking
// inputs/outputs. A misconfigured backend or proxy could otherwise feed
// non-string token amounts into BigInt() and crash the activity feed.
function isExplorerTxArray(x: unknown): x is ExplorerTx[] {
  if (!Array.isArray(x)) return false;
  for (const t of x) {
    if (typeof t !== "object" || t === null) return false;
    const e = t as Record<string, unknown>;
    if (typeof e["hash"] !== "string") return false;
    if (typeof e["timestamp"] !== "number") return false;
    if (e["inputs"] !== undefined && !Array.isArray(e["inputs"])) return false;
    if (e["outputs"] !== undefined && !Array.isArray(e["outputs"]))
      return false;
  }
  return true;
}

function classify(
  alphDelta: bigint,
  abdDelta: bigint,
  abxDelta: bigint,
): ActivityKind {
  // Heuristic: inspect the user-side signed token deltas to label the tx
  // for the recent-activity feed. This is display-only — if we
  // mis-classify, the txId still links to the explorer where the truth
  // lives. All deltas are *user-side*: a stake tx spends ABX from the
  // user's wallet, so abxDelta < 0; a claimUnstake tx returns ABX to
  // the user, so abxDelta > 0.
  //
  // Audit fix H4 (2026-04-25): the prior rules were inverted for stake
  // (returned when abxDelta > 0, but staking spends ABX) and for
  // unstake (returned when abxDelta < 0, but `requestUnstake` doesn't
  // move ABX at all and `claimUnstake` returns ABX with abxDelta > 0).
  // The legacy `closeLoan` rule required abdDelta > 0 && alphDelta > 0
  // which never matches a real close (close burns ABD → abdDelta < 0,
  // returns collateral → alphDelta > 0). Fixed below; closeLoan and
  // redeem produce identical user-side deltas (both burn ABD and pay
  // out ALPH), so we label that shape "closeLoan" — closing your own
  // loan is the more frequent case for any given wallet's history.
  if (abxDelta < 0n && abdDelta === 0n) return "stake";
  if (abxDelta > 0n && abdDelta === 0n) return "claim"; // claimUnstake
  if (abxDelta === 0n && abdDelta > 0n && alphDelta < 0n) return "openLoan";
  if (abxDelta === 0n && abdDelta < 0n && alphDelta < 0n) return "repay";
  if (abxDelta === 0n && abdDelta < 0n && alphDelta > 0n) return "closeLoan";
  if (abxDelta === 0n && abdDelta > 0n && alphDelta > 0n) return "poolWithdraw";
  if (abxDelta === 0n && abdDelta === 0n && alphDelta > 0n) return "claim"; // poolClaim / claimRewards / withdrawCollateral
  if (abxDelta === 0n && abdDelta === 0n && alphDelta < 0n)
    return "addCollateral"; // also requestUnstake / poolClaim revert
  return "other";
}

export function useRecentActivity() {
  const wallet = useWallet();
  const address =
    wallet.connectionStatus === "connected" ? wallet.account.address : null;
  const backend = getNetworkConfig(NETWORK).backendUrl;

  return useQuery({
    queryKey: ["recent-activity", NETWORK, address],
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ActivityEntry[]> => {
      if (!address) return [];
      const res = await fetch(
        `${backend}/addresses/${address}/transactions?page=1&limit=10`,
      );
      if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
      const json: unknown = await res.json();
      if (!isExplorerTxArray(json)) {
        throw new Error("explorer response did not match expected shape");
      }
      const txs: ExplorerTx[] = json;

      return txs.map((tx) => {
        let alphDelta = 0n;
        let abdDelta = 0n;
        let abxDelta = 0n;
        // Token amounts come from an external backend — wrap each
        // BigInt() in a try/catch so one malformed entry can't blow up
        // the whole activity feed (audit fix H5).
        const safeBigInt = (v: string | undefined): bigint => {
          if (v === undefined) return 0n;
          try {
            return BigInt(v);
          } catch {
            return 0n;
          }
        };
        for (const inp of tx.inputs ?? []) {
          if (inp.contractInput || inp.address !== address) continue;
          alphDelta -= safeBigInt(inp.attoAlphAmount);
          for (const t of inp.tokens ?? []) {
            if (t.id === ABD_ID) abdDelta -= safeBigInt(t.amount);
            else if (t.id === ABX_ID) abxDelta -= safeBigInt(t.amount);
          }
        }
        for (const o of tx.outputs ?? []) {
          if (o.address !== address) continue;
          alphDelta += safeBigInt(o.attoAlphAmount);
          for (const t of o.tokens ?? []) {
            if (t.id === ABD_ID) abdDelta += safeBigInt(t.amount);
            else if (t.id === ABX_ID) abxDelta += safeBigInt(t.amount);
          }
        }
        return {
          txId: tx.hash,
          timestamp: tx.timestamp,
          kind: classify(alphDelta, abdDelta, abxDelta),
          alphDelta,
          abdDelta,
          abxDelta,
        };
      });
    },
  });
}
