import { describe, expect, it } from "vitest";
import {
  NETWORKS,
  findMainnetMethod,
  getNetworkConfig,
  isNetwork,
  requireAddress,
  resolveAddress,
} from "./index";

describe("networks", () => {
  it("is mainnet-only since 2026-04-24 split", () => {
    expect(NETWORKS).toEqual(["mainnet"]);
  });

  it("recognises mainnet, rejects everything else", () => {
    expect(isNetwork("mainnet")).toBe(true);
    expect(isNetwork("testnet")).toBe(false);
    expect(isNetwork("devnet")).toBe(false);
    expect(isNetwork("sepolia")).toBe(false);
  });

  it("gives mainnet a well-formed config", () => {
    const cfg = getNetworkConfig("mainnet");
    expect(cfg.name).toBe("mainnet");
    expect(cfg.nodeUrl).toMatch(/^https:\/\//);
    expect(cfg.confirmations).toBeGreaterThan(0);
    expect(cfg.networkId).toBe(0);
  });
});

describe("addresses", () => {
  it("resolves high-confidence AlphBanX mainnet roles", () => {
    expect(resolveAddress("mainnet", "abdToken")).toBe(
      "288xqicj5pfGWuxJLKYU78Pe55LENz4ndGXRoykz7NL2K",
    );
    expect(resolveAddress("mainnet", "abxToken")).toBe(
      "258k9T6WqezTLdfGvHixXzK1yLATeSPuyhtcxzQ3V2pqV",
    );
    expect(resolveAddress("mainnet", "loanManager")).toBe(
      "tpxjsWJSaUh5i7XzNAsTWMRtD9QvDTV9zmMNeHHS6jQB",
    );
    expect(resolveAddress("mainnet", "auctionManager")).toBe(
      "29YL53teVrvK2o4P2cVej8aCGN7iQS8mE86bgxA2oFWa3",
    );
    expect(resolveAddress("mainnet", "stakeManager")).toBe(
      "28Mhs2tczfKJDUq7seTzaRctZXUhqkMzikrehxAHy2kVu",
    );
    expect(resolveAddress("mainnet", "borrowerOperations")).toBe(
      "28QGP95rnmZYKRBEsBeGBTdLHetoSE9nxEatVrtuN2bEF",
    );
    expect(resolveAddress("mainnet", "diaAlphPriceAdapter")).toBe(
      "2AtjFo5tY8vjxtdni43wyVaq4VczV6WBwBu5Qw9Yaiec7",
    );
  });

  it("leaves medium-confidence roles unlabeled", () => {
    expect(resolveAddress("mainnet", "vesting")).toBeUndefined();
    expect(resolveAddress("mainnet", "circuitBreaker")).toBeUndefined();
  });

  it("requireAddress throws a useful message when role is unknown", () => {
    expect(() => requireAddress("mainnet", "vesting")).toThrow(/vesting/);
  });
});

describe("mainnet method ABI", () => {
  it("finds a known mainnet method", () => {
    const m = findMainnetMethod("auctionManager", "getContractName");
    expect(m).toBeDefined();
    expect(m!.methodIndex).toBe(0);
  });

  it("returns undefined for an unknown mainnet method", () => {
    expect(findMainnetMethod("auctionManager", "futureMethod")).toBeUndefined();
  });
});
