import { describe, expect, it } from "vitest";
import { buildOpenLoan } from "./index";
import { applyTemplate } from "./template";
import openLoan11 from "../../../references/alphbanx-operation-templates/openLoan11.json";

const SIGNER = "18NS5h8WSUrgi73nCeio34BDjDBLM51PXi9QEt3NhGtAi";
// The original sample-tx signer baked into the template — every prior
// build of buildOpenLoan shipped this hash in 4 P2PKH AddressConst slots.
const REFERRER_HASH =
  "06cc42cf2a667da0e2609af30f0f91b7401bff28173d55fb103382c3bdc390b6";

describe("buildOpenLoan — H1 referrer substitution", () => {
  it("removes the original referrer hash from the bytecode", () => {
    const { bytecode } = buildOpenLoan(
      5_000_000_000_000_000_000n,
      100_000_000_000n,
      SIGNER,
    );
    expect(bytecode.toLowerCase()).not.toContain(REFERRER_HASH);
  });

  it("substitutes the borrow amount (template literal removed)", () => {
    // The baked sample-tx borrow is 291545829 atto-ABD. After
    // substitution, that literal must no longer appear in the bytecode.
    const TEMPLATE_BORROW_HEX = (291_545_829n).toString(16);
    const { bytecode } = buildOpenLoan(
      5_000_000_000_000_000_000n,
      10_000_000_000n /* 10 ABD — different from baked sample */,
      SIGNER,
    );
    expect(bytecode.toLowerCase()).not.toContain(TEMPLATE_BORROW_HEX);
  });

  it("rejects invalid signer addresses", () => {
    expect(() => buildOpenLoan(1n, 1n, "not-an-address")).toThrow();
  });
});

describe("applyTemplate — H2 substitution-miss throws", () => {
  it("throws when a U256 substitution rule does not match any baked value", () => {
    expect(() =>
      applyTemplate(openLoan11 as never, {
        replaceU256: [{ from: 99999999999999n, to: 1n }],
      }),
    ).toThrow(/did not match/);
  });

  it("throws when replaceSignerAddress is requested but no P2PKH AddressConst is present", () => {
    // requestUnstake.json has zero P2PKH AddressConsts — pre-pass should reject.
    // (We're not importing it; just sanity-check the empty-P2PKH branch via
    // a synthetic minimal template.)
    const empty = {
      operation: "synthetic",
      contract: "x",
      methodIndex: 0,
      txId: "0",
      scriptOpt: "",
      contractInputs: [],
      methods: [
        { index: 0, argsLength: 0, localsLength: 0, returnLength: 0, instrs: [] },
      ],
    };
    expect(() =>
      applyTemplate(empty as never, { replaceSignerAddress: SIGNER }),
    ).toThrow(/no P2PKH AddressConst|requires every P2PKH/);
  });
});
