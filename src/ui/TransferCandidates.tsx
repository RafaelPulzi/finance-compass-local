import { useMemo, useState } from "react";
import { formatDateBR } from "../domain/dates";
import { formatBRL } from "../domain/money";
import { findTransferCandidates } from "../domain/transferDetection";
import { useVault } from "../store/useVault";

/** How many pairs show at once; a vault of PIX moves can hold dozens. */
const VISIBLE = 8;

/**
 * The candidate pairs the app believes are internal moves, offered one
 * decision at a time (ADR-0006): "converter" makes the pair one Transfer,
 * "não é" dismisses it for good. Renders nothing when there is nothing to ask.
 */
export function TransferCandidates() {
  const vault = useVault((s) => s.vault);
  const acceptTransferPair = useVault((s) => s.acceptTransferPair);
  const dismissTransferPair = useVault((s) => s.dismissTransferPair);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const candidates = useMemo(() => findTransferCandidates(vault), [vault]);
  const accountName = useMemo(
    () => new Map(vault.accounts.map((a) => [a.id, a.name])),
    [vault.accounts],
  );

  if (candidates.length === 0) return null;
  const visible = showAll ? candidates : candidates.slice(0, VISIBLE);

  function decide(result: { ok: true } | { ok: false; message: string }) {
    setError(result.ok ? null : result.message);
  }

  return (
    <section
      className="mb-3 rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950"
      aria-label="Possíveis transferências"
    >
      <p className="mb-2 text-xs font-medium text-sky-900 dark:text-sky-200">
        {candidates.length === 1
          ? "1 possível transferência entre suas contas"
          : `${candidates.length} possíveis transferências entre suas contas`}
        {" · mesmo valor, poucos dias de diferença. Nada é convertido sem você."}
      </p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-sky-100 text-xs dark:divide-sky-900">
        {visible.map((c) => (
          <li
            key={`${c.outgoing.transactionId}:${c.incoming.transactionId}`}
            className="flex flex-wrap items-center gap-2 py-1.5"
          >
            <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">
              <span className="font-mono">{formatBRL(c.amount)}</span>
              {" · "}
              {formatDateBR(c.outgoing.date)} “{c.outgoing.description || "(sem descrição)"}” (
              {accountName.get(c.outgoing.accountId) ?? "?"}) →{" "}
              {formatDateBR(c.incoming.date)} “{c.incoming.description || "(sem descrição)"}” (
              {accountName.get(c.incoming.accountId) ?? "?"})
            </span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                aria-label={`Converter ${c.outgoing.description || "par"} em transferência`}
                className="rounded-md bg-sky-600 px-2 py-0.5 font-medium text-white hover:bg-sky-700"
                onClick={() =>
                  decide(
                    acceptTransferPair(c.outgoing.transactionId, c.incoming.transactionId),
                  )
                }
              >
                converter
              </button>
              <button
                type="button"
                aria-label={`Dispensar par ${c.outgoing.description || "sem descrição"}`}
                className="text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
                onClick={() =>
                  decide(
                    dismissTransferPair(c.outgoing.transactionId, c.incoming.transactionId),
                  )
                }
              >
                não é
              </button>
            </span>
          </li>
        ))}
      </ul>
      {candidates.length > VISIBLE && (
        <button
          type="button"
          className="mt-2 text-xs text-sky-700 underline hover:text-sky-900 dark:text-sky-300"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "mostrar menos" : `mostrar todas (${candidates.length})`}
        </button>
      )}
    </section>
  );
}
