import type { Network } from "@openabx/sdk";

// OpenABX is a mainnet-only UI over AlphBanX's live contracts. NEXT_PUBLIC_NETWORK
// is still read so future multi-network builds don't require touching callers,
// but any value other than "mainnet" is rejected at build time.
function resolveNetwork(): Network {
  const raw = process.env["NEXT_PUBLIC_NETWORK"];
  if (raw && raw !== "mainnet") {
    throw new Error(
      `NEXT_PUBLIC_NETWORK=${raw} is not supported. OpenABX is mainnet-only; the clean-room testnet/devnet stack lives at openABX/openabx-ref-contracts.`,
    );
  }
  return "mainnet";
}

export const NETWORK: Network = resolveNetwork();

export const WALLETCONNECT_PROJECT_ID =
  process.env["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"] ?? "";

export function isMainnet(): boolean {
  return NETWORK === "mainnet";
}
