// Per-user and global protocol reads. Used by the Dashboard + every protocol
// page so the connected wallet can see its own state.
//
// Approach:
//   - Wallet balances use the public /addresses/<addr>/balance endpoint.
//   - Per-user protocol reads go through @openabx/sdk's mainnet readers, which
//     observe AlphBanX's on-chain layout (method indices + mut-field offsets
//     pinned in references/alphbanx-mainnet-methods.json).
//   - Global protocol reads use raw /contracts/<addr>/state fetches against
//     AlphBanX's live contracts.

import { binToHex, contractIdFromAddress } from "@alephium/web3";
import type { Network } from "@openabx/sdk";
import {
  fetchMainnetLoanId,
  fetchMainnetPoolPositions,
  fetchMainnetStakePosition,
  getNetworkConfig,
  resolveAddress,
} from "@openabx/sdk";
import { addressFromContractId } from "@alephium/web3";

/**
 * Convert a base58 contract address into its hex token id (32 bytes) — used
 * to match tokens in the /addresses/<addr>/balance endpoint, which keys
 * token balances by hex id rather than base58 address.
 */
export function tokenIdFromAddress(
  address: string | undefined,
): string | undefined {
  if (!address) return undefined;
  try {
    return binToHex(contractIdFromAddress(address));
  } catch {
    return undefined;
  }
}

export interface WalletBalances {
  alphAtto: bigint;
  abdAtto: bigint;
  abxAtto: bigint;
}

interface TokenBalance {
  id: string;
  amount: string;
}

interface BalanceResponse {
  balance: string;
  tokenBalances?: TokenBalance[];
}

function matchToken(
  list: TokenBalance[],
  tokenIdHex: string | undefined,
): bigint {
  if (!tokenIdHex) return 0n;
  const norm = tokenIdHex.toLowerCase();
  for (const b of list) {
    if (b.id.toLowerCase() === norm) {
      return BigInt(b.amount);
    }
  }
  return 0n;
}

export async function fetchWalletBalances(
  network: Network,
  walletAddress: string,
): Promise<WalletBalances> {
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const res = await fetch(`${nodeUrl}/addresses/${walletAddress}/balance`);
  if (!res.ok) throw new Error(`balance HTTP ${res.status}`);
  const json = (await res.json()) as BalanceResponse;
  const tokens = json.tokenBalances ?? [];
  const abdId = tokenIdFromAddress(resolveAddress(network, "abdToken"));
  const abxId = tokenIdFromAddress(resolveAddress(network, "abxToken"));
  return {
    alphAtto: BigInt(json.balance),
    abdAtto: matchToken(tokens, abdId),
    abxAtto: matchToken(tokens, abxId),
  };
}

export interface LoanPosition {
  exists: boolean;
  collateralAtto: bigint;
  debtAtto: bigint;
  interestRate1e18: bigint;
  lastInterestMs: bigint;
}

export const EMPTY_LOAN: LoanPosition = {
  exists: false,
  collateralAtto: 0n,
  debtAtto: 0n,
  interestRate1e18: 0n,
  lastInterestMs: 0n,
};

export async function fetchLoanPosition(
  network: Network,
  walletAddress: string,
): Promise<LoanPosition> {
  // AlphBanX mainnet Loan layout (verified 2026-04-23 against 4 active loans):
  //   mut[0] lastInterestMs
  //   mut[1] interestRate integer % (e.g., 5, 15, 35)
  //   mut[2] cumulative-interest index at 1e18 scale
  //   mut[3] collateral atto-ALPH (1e18 scale)
  //   mut[4] debt atto-ABD (1e9 scale)
  const loanId = await fetchMainnetLoanId(network, walletAddress);
  if (!loanId) return EMPTY_LOAN;
  try {
    const loanAddress = addressFromContractId(loanId);
    const res = await fetch(
      `${getNetworkConfig(network).nodeUrl}/contracts/${loanAddress}/state`,
    );
    if (!res.ok) return EMPTY_LOAN;
    const state = (await res.json()) as {
      mutFields: Array<{ type: string; value: string }>;
    };
    const u256 = (i: number): bigint | null => {
      const f = state.mutFields[i];
      if (!f || f.type !== "U256") return null;
      try {
        return BigInt(f.value);
      } catch {
        return null;
      }
    };
    const lastInterestMs = u256(0);
    const rateIntPercent = u256(1) ?? 0n;
    const collateral = u256(3);
    const debt = u256(4);
    if (collateral === null) return EMPTY_LOAN;
    const interestRate1e18 =
      rateIntPercent > 0n ? rateIntPercent * 10_000_000_000_000_000n : 0n;
    return {
      exists: true,
      collateralAtto: collateral,
      debtAtto: debt ?? 0n,
      interestRate1e18,
      lastInterestMs: lastInterestMs ?? 0n,
    };
  } catch {
    return EMPTY_LOAN;
  }
}

export interface PoolPosition {
  discountBps: number;
  addr: string;
  hasDeposit: boolean;
  abdAtto: bigint;
  claimableAlphAtto: bigint;
}

export async function fetchPoolPositions(
  network: Network,
  walletAddress: string,
): Promise<PoolPosition[]> {
  const mainnetPositions = await fetchMainnetPoolPositions(
    network,
    walletAddress,
  );
  return mainnetPositions.map((p) => ({
    discountBps: p.tierBps,
    addr: p.subAddress ?? "",
    hasDeposit: p.depositedAbdAtto > 0n,
    abdAtto: p.depositedAbdAtto,
    claimableAlphAtto: p.claimableAlphAtto,
  }));
}

export interface StakePosition {
  stakedAtto: bigint;
  pendingRewardsAtto: bigint;
  pendingUnstakeAtto: bigint;
  unstakeReadyAtMs: bigint;
}

export const EMPTY_STAKE: StakePosition = {
  stakedAtto: 0n,
  pendingRewardsAtto: 0n,
  pendingUnstakeAtto: 0n,
  unstakeReadyAtMs: 0n,
};

export async function fetchStakePosition(
  network: Network,
  walletAddress: string,
): Promise<StakePosition> {
  const m = await fetchMainnetStakePosition(network, walletAddress);
  return {
    stakedAtto: m.stakedAbxAtto,
    pendingRewardsAtto: m.pendingRewardsAlphAtto,
    pendingUnstakeAtto: m.pendingUnstakeAbxAtto,
    unstakeReadyAtMs: m.unstakeReadyAtMs,
  };
}

export interface VestingPosition {
  exists: boolean;
  totalAbxAtto: bigint;
  claimedAtto: bigint;
  claimableAtto: bigint;
  startMs: bigint;
  durationMs: bigint;
}

export const EMPTY_VESTING: VestingPosition = {
  exists: false,
  totalAbxAtto: 0n,
  claimedAtto: 0n,
  claimableAtto: 0n,
  startMs: 0n,
  durationMs: 0n,
};

export async function fetchVestingPosition(
  _network: Network,
  _walletAddress: string,
): Promise<VestingPosition> {
  // AlphBanX has not activated Vesting on mainnet as of 2026-04-24 — no
  // live contract to read against. Returning empty so the UI renders the
  // "no schedule" state rather than throwing.
  return EMPTY_VESTING;
}

export interface ProtocolGlobals {
  totalDebtAbd: bigint | null;
  totalCollateralAlph: bigint | null;
  abdTotalSupply: bigint | null;
  abxTotalSupply: bigint | null;
  alphUsd1e18: bigint | null;
  totalStakedAbx: bigint | null;
  totalPoolAbd: bigint | null;
}

interface NodeCallResponse {
  type: string;
  returns?: Array<{ type: string; value: string }>;
}

interface ContractStateResponse {
  immFields: Array<{ type: string; value: string }>;
  mutFields: Array<{ type: string; value: string }>;
}

async function rawState(
  nodeUrl: string,
  address: string,
): Promise<ContractStateResponse | null> {
  try {
    const res = await fetch(`${nodeUrl}/contracts/${address}/state`);
    if (!res.ok) return null;
    return (await res.json()) as ContractStateResponse;
  } catch {
    return null;
  }
}

async function rawCall(
  nodeUrl: string,
  address: string,
  methodIndex: number,
): Promise<NodeCallResponse | null> {
  try {
    const res = await fetch(`${nodeUrl}/contracts/call-contract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: 0, address, methodIndex }),
    });
    if (!res.ok) return null;
    return (await res.json()) as NodeCallResponse;
  } catch {
    return null;
  }
}

function decodeU256(
  slot: { type: string; value: string } | undefined,
): bigint | null {
  if (!slot || slot.type !== "U256") return null;
  try {
    return BigInt(slot.value);
  } catch {
    return null;
  }
}

// Mutable-field index 1 on ABD/ABX tokens holds totalSupply.
const TOKEN_TOTAL_SUPPLY_INDEX = 1;

// AlphBanX LoanManager layout (mut-field indices may differ from clean-room
// naming — these are placeholder pins and may render null until verified).
const LOANMGR_TOTAL_DEBT_INDEX = 1;
const LOANMGR_TOTAL_COLLATERAL_INDEX = 2;

// AuctionManager.mut[5] is the aggregate ABD in pools (mainnet-pinned 2026-04-23).
const AUCTIONMGR_TVL_INDEX = 5;

// StakeManager.mut[1] = totalStakedAbx.
const STAKEMGR_TOTAL_STAKED_INDEX = 1;

export async function fetchProtocolGlobals(
  network: Network,
): Promise<ProtocolGlobals> {
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const addrs = {
    abd: resolveAddress(network, "abdToken"),
    abx: resolveAddress(network, "abxToken"),
    loanMgr: resolveAddress(network, "loanManager"),
    auctionMgr: resolveAddress(network, "auctionManager"),
    stakeMgr: resolveAddress(network, "stakeManager"),
    oracle: resolveAddress(network, "diaAlphPriceAdapter"),
  };

  const [abdState, abxState, loanState, auctionState, stakeState, oracleCall] =
    await Promise.all([
      addrs.abd ? rawState(nodeUrl, addrs.abd) : Promise.resolve(null),
      addrs.abx ? rawState(nodeUrl, addrs.abx) : Promise.resolve(null),
      addrs.loanMgr ? rawState(nodeUrl, addrs.loanMgr) : Promise.resolve(null),
      addrs.auctionMgr
        ? rawState(nodeUrl, addrs.auctionMgr)
        : Promise.resolve(null),
      addrs.stakeMgr
        ? rawState(nodeUrl, addrs.stakeMgr)
        : Promise.resolve(null),
      addrs.oracle ? rawCall(nodeUrl, addrs.oracle, 1) : Promise.resolve(null),
    ]);

  const alphUsd1e18 =
    oracleCall?.type === "CallContractSucceeded" &&
    oracleCall.returns?.[0]?.type === "U256"
      ? BigInt(oracleCall.returns[0].value)
      : null;

  return {
    totalDebtAbd: decodeU256(loanState?.mutFields[LOANMGR_TOTAL_DEBT_INDEX]),
    totalCollateralAlph: decodeU256(
      loanState?.mutFields[LOANMGR_TOTAL_COLLATERAL_INDEX],
    ),
    abdTotalSupply: decodeU256(abdState?.mutFields[TOKEN_TOTAL_SUPPLY_INDEX]),
    abxTotalSupply: decodeU256(abxState?.mutFields[TOKEN_TOTAL_SUPPLY_INDEX]),
    alphUsd1e18,
    totalStakedAbx: decodeU256(
      stakeState?.mutFields[STAKEMGR_TOTAL_STAKED_INDEX],
    ),
    totalPoolAbd: decodeU256(auctionState?.mutFields[AUCTIONMGR_TVL_INDEX]),
  };
}
