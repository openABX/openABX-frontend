"use client";

// Gate any mainnet signed-tx behind an explicit "I understand this is
// unaudited alpha" consent the first time per browser session. Consent is
// shared via React context (+ sessionStorage), so every useTxRunner sees
// the same modal, and confirming once applies to all subsequent actions
// until the tab closes.

import { AlertTriangle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "openabx:unaudited-consent-granted";

function readConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeConsent(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export class ConsentDeclinedError extends Error {
  constructor() {
    super("Consent declined");
    this.name = "ConsentDeclinedError";
  }
}

export interface ConsentApi {
  granted: boolean;
  /**
   * Run `action` only after the user has granted unaudited-mainnet consent.
   * Returns a Promise that resolves once `action` resolves, or rejects with
   * a `ConsentDeclinedError` if the user cancels the modal. Always awaited
   * by `useTxRunner.runTx` so callers' post-await code (e.g. clearing form
   * inputs) only fires after the action actually completes.
   */
  withConsent: (action: () => Promise<void>) => Promise<void>;
  isOpen: boolean;
  confirm: () => void;
  cancel: () => void;
}

const ConsentContext = createContext<ConsentApi | null>(null);

interface QueuedAction {
  action: () => Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [granted, setGranted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const queuedActionRef = useRef<QueuedAction | null>(null);

  useEffect(() => {
    setGranted(readConsent());
  }, []);

  const confirm = useCallback(() => {
    writeConsent();
    setGranted(true);
    setIsOpen(false);
    const queued = queuedActionRef.current;
    queuedActionRef.current = null;
    if (queued) {
      queued.action().then(queued.resolve, queued.reject);
    }
  }, []);

  const cancel = useCallback(() => {
    setIsOpen(false);
    const queued = queuedActionRef.current;
    queuedActionRef.current = null;
    queued?.reject(new ConsentDeclinedError());
  }, []);

  const withConsent = useCallback(
    (action: () => Promise<void>): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        if (granted || readConsent()) {
          setGranted(true);
          action().then(resolve, reject);
          return;
        }
        // Defensive: if a previous prompt is still queued (shouldn't happen
        // in practice — runTx awaits — but be explicit), reject the old
        // one before clobbering it.
        const prior = queuedActionRef.current;
        if (prior) prior.reject(new ConsentDeclinedError());
        queuedActionRef.current = { action, resolve, reject };
        setIsOpen(true);
      });
    },
    [granted],
  );

  const api: ConsentApi = {
    granted,
    withConsent,
    isOpen,
    confirm,
    cancel,
  };
  return (
    <ConsentContext.Provider value={api}>
      {children}
      <ConsentModal isOpen={isOpen} confirm={confirm} cancel={cancel} />
    </ConsentContext.Provider>
  );
}

export function useUnauditedConsent(): ConsentApi {
  const ctx = useContext(ConsentContext);
  if (!ctx) {
    throw new Error(
      "useUnauditedConsent must be used inside <ConsentProvider>",
    );
  }
  return ctx;
}

function ConsentModal({
  isOpen,
  confirm,
  cancel,
}: Pick<ConsentApi, "isOpen" | "confirm" | "cancel">) {
  if (!isOpen) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={cancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            Confirm you understand the risk
          </h2>
        </div>
        <div className="space-y-3 text-sm">
          <p>
            OpenABX is an{" "}
            <span className="font-semibold">
              independent open-source interface
            </span>{" "}
            to the ABD stablecoin protocol on Alephium. We did not author or
            deploy the underlying contracts and cannot protect you from bugs in
            them.
          </p>
          <p>
            The bytecode we submit is built by{" "}
            <strong>re-encoding templates</strong> derived from public on-chain
            activity. Each click is simulated against a public Alephium node via{" "}
            <span className="font-mono text-xs">/contracts/call-tx-script</span>{" "}
            before the wallet prompt — but simulation only catches reverts, not
            logic bugs in the underlying contracts.
          </p>
          <p>
            OpenABX itself is <strong>pre-audit alpha</strong>. Start with small
            amounts; never commit more than you can afford to lose.
          </p>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            I understand — proceed
          </button>
        </div>
      </div>
    </div>
  );
}
