import { useState } from "react";
import { type Centavos, formatBRL } from "../domain/money";
import type { Account } from "../domain/types";
import { CategoryOptions, type CategoryTree } from "./CategoryOptions";

/** What the selection would do to the balance of whichever Account is chosen. */
export interface SelectionTotals {
  /** Sum of the selected Expenses: money that left, so it arrives in the other Account. */
  outgoing: Centavos;
  /** Sum of the selected Incomes: money that arrived, so it left the other Account. */
  incoming: Centavos;
}

interface Props {
  selectedCount: number;
  /**
   * The kind every selected Transaction shares, or "mixed" when the selection
   * spans both. Income and expense Categories are strictly separate, so a mixed
   * selection has no Category that could apply to all of it — but it can still
   * be marked as Transfers, since each entry's direction comes from its own kind.
   */
  kind: "income" | "expense" | "mixed";
  tree: CategoryTree;
  accounts: readonly Account[];
  totals: SelectionTotals;
  onAssign: (categoryId: string) => void;
  onMarkTransfers: (otherAccountId: string) => void;
  onClear: () => void;
}

/**
 * Appears only while something is selected: the two things worth doing to a
 * whole selection at once.
 *
 * Classifying is the common one. Marking as Transfers is the rarer and heavier
 * one — it moves money between Accounts — so it asks for a confirmation that
 * names the Account and the amounts first. The confirmation is inline rather
 * than a `window.confirm`: a native modal blocks the webview, which makes it
 * untestable and the app unresponsive if anything goes wrong behind it.
 */
export function BulkActionsBar({
  selectedCount,
  kind,
  tree,
  accounts,
  totals,
  onAssign,
  onMarkTransfers,
  onClear,
}: Props) {
  const [otherAccountId, setOtherAccountId] = useState("");
  const chosen = accounts.find((a) => a.id === otherAccountId);

  return (
    <div className="mb-3 space-y-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-emerald-900 dark:text-emerald-200">
          {selectedCount === 1 ? "1 selecionada" : `${selectedCount} selecionadas`}
        </span>

        {kind === "mixed" ? (
          <span className="text-xs text-emerald-900 dark:text-emerald-200">
            Receitas e despesas usam categorias separadas. Filtre por tipo para
            classificar a seleção.
          </span>
        ) : (
          <select
            aria-label="Categoria para as selecionadas"
            className="rounded-md border border-emerald-400 bg-white px-2 py-1 text-sm dark:border-emerald-700 dark:bg-slate-900"
            value=""
            onChange={(e) => e.target.value && onAssign(e.target.value)}
          >
            <option value="">Classificar como…</option>
            <CategoryOptions tree={tree} />
          </select>
        )}

        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-xs text-emerald-900 underline hover:text-emerald-700 dark:text-emerald-300"
        >
          limpar seleção
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-emerald-200 pt-2 dark:border-emerald-800">
        <span className="text-xs text-emerald-900 dark:text-emerald-200">
          Ou marcar todas como transferência com a outra conta sendo
        </span>
        <select
          aria-label="Outra conta das transferências"
          className="rounded-md border border-emerald-400 bg-white px-2 py-1 text-sm dark:border-emerald-700 dark:bg-slate-900"
          value={otherAccountId}
          onChange={(e) => setOtherAccountId(e.target.value)}
        >
          <option value="">Escolher conta…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {/* Only once an Account is chosen, so the warning can name it and the
            amounts instead of warning in the abstract. */}
        {chosen !== undefined && (
          <>
            <button
              type="button"
              className="rounded-md bg-slate-700 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
              onClick={() => {
                onMarkTransfers(chosen.id);
                setOtherAccountId("");
              }}
            >
              Confirmar {selectedCount} transferência
              {selectedCount === 1 ? "" : "s"}
            </button>
            <p className="w-full text-xs text-emerald-900 dark:text-emerald-200">
              Esses valores deixam de contar como receita ou despesa. O saldo de{" "}
              {chosen.name}
              {totals.outgoing > 0 && (
                <>
                  {" "}
                  aumenta <span className="font-mono">{formatBRL(totals.outgoing)}</span>
                </>
              )}
              {totals.outgoing > 0 && totals.incoming > 0 && " e"}
              {totals.incoming > 0 && (
                <>
                  {" "}
                  diminui <span className="font-mono">{formatBRL(totals.incoming)}</span>
                </>
              )}
              . Lançamentos que já estão nessa conta são ignorados.
            </p>
          </>
        )}

        {accounts.length < 2 && (
          <p className="w-full text-xs text-amber-700 dark:text-amber-400">
            Só existe uma conta no cofre. Crie a outra conta — o CDB, a poupança
            ou o cartão para onde o dinheiro foi — antes de marcar transferências.
          </p>
        )}
      </div>
    </div>
  );
}
