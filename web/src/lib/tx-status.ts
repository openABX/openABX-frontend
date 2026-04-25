// Tx confirmation polling. After a signAndSubmit returns a txId, poll the
// node's /transactions/status endpoint until we see confirmed or timed-out.

import type { Network } from "@openabx/sdk";
import { getNetworkConfig } from "@openabx/sdk";

export type TxStatusKind =
  | "unconfirmed"
  | "confirmed"
  | "mempool"
  | "error"
  | "timeout";

export interface TxStatus {
  kind: TxStatusKind;
  confirmations?: number;
  blockHash?: string;
  error?: string;
}

interface NodeTxStatus {
  type: string;
  chainConfirmations?: number;
  blockHash?: string;
  fromGroupConfirmations?: number;
  toGroupConfirmations?: number;
}

/**
 * Poll txId until confirmed or `opts.timeoutMs` elapses. Invokes `onUpdate`
 * on every status change so the UI can render "submitted → mempool →
 * confirmed".
 *
 * Pass `opts.signal` to abort the poll cooperatively — the runner hook
 * uses this to stop poll callbacks after the consuming component
 * unmounts (audit fix H8).
 */
export async function pollTxStatus(
  network: Network,
  txId: string,
  opts: {
    onUpdate?: (s: TxStatus) => void;
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<TxStatus> {
  const nodeUrl = getNetworkConfig(network).nodeUrl;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const signal = opts.signal;
  const start = Date.now();
  let lastKind: TxStatusKind | "" = "";

  if (signal?.aborted) return { kind: "timeout" };
  opts.onUpdate?.({ kind: "unconfirmed" });

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return { kind: "timeout" };
    try {
      const res = await fetch(
        `${nodeUrl}/transactions/status?txId=${encodeURIComponent(txId)}`,
        signal ? { signal } : undefined,
      );
      if (res.ok) {
        const data = (await res.json()) as NodeTxStatus;
        let kind: TxStatusKind = "unconfirmed";
        if (data.type === "Confirmed") kind = "confirmed";
        else if (data.type === "MemPooled") kind = "mempool";
        else if (data.type === "TxNotFound") kind = "unconfirmed";
        else kind = "unconfirmed";

        const status: TxStatus = {
          kind,
          confirmations: Math.min(
            data.chainConfirmations ?? 0,
            data.fromGroupConfirmations ?? data.chainConfirmations ?? 0,
          ),
          blockHash: data.blockHash,
        };
        if (kind !== lastKind && !signal?.aborted) {
          opts.onUpdate?.(status);
          lastKind = kind;
        }
        if (kind === "confirmed") return status;
      }
    } catch (err) {
      if (signal?.aborted) return { kind: "timeout" };
      if ((err as { name?: string }).name === "AbortError") {
        return { kind: "timeout" };
      }
      /* otherwise ignore transient network error and keep polling */
    }
    // Sleep, but wake immediately on abort.
    await sleepCancellable(intervalMs, signal);
  }
  const timeout: TxStatus = { kind: "timeout" };
  if (!signal?.aborted) opts.onUpdate?.(timeout);
  return timeout;
}

function sleepCancellable(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
