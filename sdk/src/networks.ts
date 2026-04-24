// Supported networks for OpenABX. Mainnet-only — OpenABX is a UI over
// AlphBanX's live mainnet contracts. Testnet/devnet support was removed
// along with the clean-room Ralph implementation on 2026-04-24 (that
// code now lives at openABX/openabx-ref-contracts).

export const NETWORKS = ["mainnet"] as const;
export type Network = (typeof NETWORKS)[number];

export function isNetwork(x: unknown): x is Network {
  return typeof x === "string" && (NETWORKS as readonly string[]).includes(x);
}

export interface NetworkConfig {
  readonly name: Network;
  readonly nodeUrl: string;
  readonly backendUrl: string;
  readonly networkId: number;
  readonly confirmations: number;
}

const DEFAULTS: Record<Network, NetworkConfig> = {
  mainnet: {
    name: "mainnet",
    nodeUrl: "https://node.mainnet.alephium.org",
    backendUrl: "https://backend.mainnet.alephium.org",
    networkId: 0,
    confirmations: 3,
  },
};

export function getNetworkConfig(network: Network): NetworkConfig {
  return DEFAULTS[network];
}
