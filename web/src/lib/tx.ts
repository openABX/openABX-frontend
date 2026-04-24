// Wallet-signed transaction helpers. Every state-changing action a user can
// take on a protocol page lands here. All writes go through @openabx/sdk's
// mainnet templates — bytecode harvested from publicly-observable AlphBanX
// user transactions, substituted per-caller, and simulation-gated before
// the wallet is asked to sign. See docs/07-mainnet-write-path.md for the
// template-building methodology.

import { ONE_ALPH, type SignerProvider } from "@alephium/web3";
import type { MainnetOperation, Network, PreparedTx } from "@openabx/sdk";
import {
  buildAddCollateral as mnBuildAddCollateral,
  buildClaimRewards as mnBuildClaimRewards,
  buildClaimUnstake as mnBuildClaimUnstake,
  buildCloseLoan as mnBuildCloseLoan,
  buildOpenLoan as mnBuildOpenLoan,
  buildPoolClaim as mnBuildPoolClaim,
  buildPoolDeposit as mnBuildPoolDeposit,
  buildPoolWithdraw as mnBuildPoolWithdraw,
  buildRedeemMainnet as mnBuildRedeem,
  buildRepay as mnBuildRepay,
  buildRequestUnstake as mnBuildRequestUnstake,
  buildStake as mnBuildStake,
  buildWithdrawCollateral as mnBuildWithdrawCollateral,
  canMainnetWrite,
  fetchMainnetStakePosition,
  getNetworkConfig,
  resolveAddress,
  simulateScript,
} from "@openabx/sdk";

/** Writes are always allowed at the network level on mainnet (per-operation
 *  gating happens via canTransactOp). */
export function canTransact(_network: Network): boolean {
  return true;
}

/** Per-operation gate — returns true only for operations whose mainnet
 *  bytecode has been simulation-verified end-to-end. */
export function canTransactOp(_network: Network, op: MainnetOperation): boolean {
  return canMainnetWrite(op);
}

async function submitPrepared(
  network: Network,
  signer: SignerProvider,
  prepared: PreparedTx,
): Promise<TxResult> {
  const account = await signer.getSelectedAccount();
  const signerAddress = account.address;
  // Defense in depth: simulate before sign to catch any bytecode regression.
  const sim = await simulateScript(
    getNetworkConfig(network).nodeUrl,
    prepared.bytecode,
    signerAddress,
    {
      attoAlphAmount: prepared.attoAlphAmount + ONE_ALPH, // buffer for gas
      tokens: prepared.tokens,
    },
  );
  if (!sim.ok) {
    throw new Error(`Simulation failed (would revert on-chain): ${sim.error}`);
  }
  const res = await signer.signAndSubmitExecuteScriptTx({
    signerAddress,
    bytecode: prepared.bytecode,
    attoAlphAmount: prepared.attoAlphAmount.toString(),
    tokens: prepared.tokens.map((t) => ({
      id: t.id,
      amount: t.amount.toString(),
    })),
  });
  return { txId: res.txId };
}

function requireSigner(signer: SignerProvider | undefined): SignerProvider {
  if (!signer) throw new Error("Wallet not connected");
  return signer;
}

export interface TxResult {
  txId: string;
}

// -------- Borrow / Loan ------------------------------------------------------

export interface OpenLoanParams {
  collateralAlphAtto: bigint; // ALPH collateral (1e18)
  borrowAbdAtto: bigint; // ABD debt (1e9)
  interestRate1e18: bigint; // one of 8 tier values
}

export async function openLoan(
  network: Network,
  signer: SignerProvider,
  params: OpenLoanParams,
): Promise<TxResult> {
  requireSigner(signer);
  const prepared = mnBuildOpenLoan(
    params.collateralAlphAtto,
    params.borrowAbdAtto,
    params.interestRate1e18,
  );
  return submitPrepared(network, signer, prepared);
}

export async function addCollateral(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  return submitPrepared(network, signer, mnBuildAddCollateral(amountAtto));
}

export async function withdrawCollateral(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  const account = await signer.getSelectedAccount();
  return submitPrepared(
    network,
    signer,
    mnBuildWithdrawCollateral(amountAtto, account.address),
  );
}

export async function borrowMore(
  _network: Network,
  _signer: SignerProvider,
  _additionalDebtAtto: bigint,
): Promise<TxResult> {
  // borrowMore on AlphBanX mainnet is the mi=7 variant in docs/07, but the
  // template (borrowMoreOrAdd7.json) has ambiguous U256 semantics — only
  // 2 live sample txs, insufficient to distinguish it from addCollateral.
  // Flagging as pending until a clean sample lands, so users get a clear
  // error instead of a silent revert or short-pay.
  throw new Error(
    "borrowMore is pending on mainnet — the template's U256 semantics are " +
      "still ambiguous. As a workaround, repay the loan and re-open with a " +
      "larger debt, or contact the maintainers.",
  );
}

export async function repay(
  network: Network,
  signer: SignerProvider,
  _ownerAddress: string,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  return submitPrepared(network, signer, mnBuildRepay(amountAbdAtto));
}

export async function closeLoan(
  network: Network,
  signer: SignerProvider,
  remainingDebtAbdAtto: bigint = 0n,
): Promise<TxResult> {
  requireSigner(signer);
  const account = await signer.getSelectedAccount();
  return submitPrepared(
    network,
    signer,
    mnBuildCloseLoan(remainingDebtAbdAtto, account.address),
  );
}

// -------- Redemption / Liquidation -------------------------------------------

export async function redeem(
  network: Network,
  signer: SignerProvider,
  targetOwner: string,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  return submitPrepared(
    network,
    signer,
    mnBuildRedeem(targetOwner, amountAbdAtto),
  );
}

export async function liquidate(
  _network: Network,
  _signer: SignerProvider,
  _targetOwner: string,
): Promise<TxResult> {
  throw new Error(
    "Mainnet liquidate is pending — no observed sample tx yet in our catalog. " +
      "Liquidations are typically bot-driven; once one lands with a clear " +
      "token-flow signature, the cataloguer will surface it.",
  );
}

// -------- Auction pools ------------------------------------------------------

export type PoolTier = 500 | 1000 | 1500 | 2000;

export function poolRoleForTier(
  tier: PoolTier,
): Parameters<typeof resolveAddress>[1] {
  switch (tier) {
    case 500:
      return "auctionPool5";
    case 1000:
      return "auctionPool10";
    case 1500:
      return "auctionPool15";
    case 2000:
      return "auctionPool20";
  }
}

export async function depositToPool(
  network: Network,
  signer: SignerProvider,
  tier: PoolTier,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  return submitPrepared(
    network,
    signer,
    mnBuildPoolDeposit(tier, amountAbdAtto),
  );
}

export async function withdrawFromPool(
  network: Network,
  signer: SignerProvider,
  tier: PoolTier,
  amountAbdAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  const account = await signer.getSelectedAccount();
  return submitPrepared(
    network,
    signer,
    mnBuildPoolWithdraw(tier, amountAbdAtto, account.address),
  );
}

export async function claimFromPool(
  network: Network,
  signer: SignerProvider,
  tier: PoolTier,
  claimableAlphAtto: bigint = 1n,
): Promise<TxResult> {
  requireSigner(signer);
  const account = await signer.getSelectedAccount();
  return submitPrepared(
    network,
    signer,
    mnBuildPoolClaim(tier, account.address, claimableAlphAtto),
  );
}

// -------- Staking ------------------------------------------------------------

export async function stakeAbx(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  return submitPrepared(network, signer, mnBuildStake(amountAtto));
}

export async function requestUnstake(
  network: Network,
  signer: SignerProvider,
  amountAtto: bigint,
): Promise<TxResult> {
  requireSigner(signer);
  return submitPrepared(network, signer, mnBuildRequestUnstake(amountAtto));
}

export async function claimUnstake(
  network: Network,
  signer: SignerProvider,
): Promise<TxResult> {
  requireSigner(signer);
  const account = await signer.getSelectedAccount();
  // Read the user's current pendingUnstakeAbxAtto from the StakeManager
  // sub-contract (mut[2]); pass as the script arg so the transferred
  // ABX equals the user's actual matured amount. The prior static 150k
  // baked into the template short-paid/bounced users with any other
  // amount — see sdk/src/mainnet/index.ts::buildClaimUnstake for the
  // on-chain evidence.
  const pos = await fetchMainnetStakePosition(network, account.address);
  if (pos.pendingUnstakeAbxAtto <= 0n) {
    throw new Error("No pending unstake to claim");
  }
  if (pos.unstakeReadyAtMs > 0n && Date.now() < Number(pos.unstakeReadyAtMs)) {
    throw new Error(
      `Unstake cooldown not elapsed: ready at ${new Date(Number(pos.unstakeReadyAtMs)).toISOString()}`,
    );
  }
  return submitPrepared(
    network,
    signer,
    mnBuildClaimUnstake(account.address, pos.pendingUnstakeAbxAtto),
  );
}

export async function claimStakingRewards(
  network: Network,
  signer: SignerProvider,
): Promise<TxResult> {
  requireSigner(signer);
  const account = await signer.getSelectedAccount();
  // Read real pending only to decide whether the claim is worth submitting.
  // We DON'T pass `pos.pendingRewardsAlphAtto` as the claim arg: rewards
  // accrue continuously, so by the time the signed tx lands on-chain the
  // true pending is slightly higher than what we probed. Instead pass an
  // oversized arg (1M ALPH) — the StakeManager caps at min(arg, pending)
  // so the user drains whatever is actually available at tx-inclusion
  // time. This is the same arg shape used by the read-side probe.
  const pos = await fetchMainnetStakePosition(network, account.address);
  if (pos.pendingRewardsAlphAtto <= 0n) {
    throw new Error("No claimable ALPH rewards");
  }
  const OVERSIZED_CLAIM_ATTO = 1_000_000_000_000_000_000_000_000n; // 1M ALPH
  return submitPrepared(
    network,
    signer,
    mnBuildClaimRewards(account.address, OVERSIZED_CLAIM_ATTO),
  );
}

// -------- Vesting ------------------------------------------------------------

export async function claimVesting(
  _network: Network,
  _signer: SignerProvider,
  _beneficiary: string,
): Promise<TxResult> {
  throw new Error(
    "Vesting not yet active on AlphBanX mainnet. This flow will be wired " +
      "once a live sample tx is observable and the template can be extracted.",
  );
}
