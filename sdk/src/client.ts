// High-level client factory. Routes calls through a NodeProvider for the
// selected network. Mainnet-only since 2026-04-24 — OpenABX is a UI over
// AlphBanX's live mainnet contracts; testnet/devnet support was removed
// along with the clean-room Ralph implementation.

import { NodeProvider, web3 } from "@alephium/web3";
import { getNetworkConfig, type Network } from "./networks";
import {
  resolveAddresses,
  type AddressBook,
  type ContractRole,
} from "./addresses";

export interface ClientContext {
  readonly network: Network;
  readonly provider: NodeProvider;
  readonly addresses: AddressBook;
}

let cached: ClientContext | null = null;

/**
 * Build or return the shared client context for a given network. Idempotent.
 */
export function getClientContext(
  network: Network,
  fetchImpl?: typeof fetch,
): ClientContext {
  if (cached && cached.network === network) return cached;

  const cfg = getNetworkConfig(network);
  const provider = new NodeProvider(cfg.nodeUrl, undefined, fetchImpl);
  web3.setCurrentNodeProvider(provider);

  cached = {
    network,
    provider,
    addresses: resolveAddresses(network),
  };
  return cached;
}

export function clearClientContext(): void {
  cached = null;
}

/** Convenience getter — throws if the address for `role` is not known. */
export function getContractAddress(
  ctx: ClientContext,
  role: ContractRole,
): string {
  const addr = ctx.addresses[role];
  if (!addr) {
    throw new Error(
      `OpenABX SDK: ${role} has no address on ${ctx.network}. See resolveAddress().`,
    );
  }
  return addr;
}
