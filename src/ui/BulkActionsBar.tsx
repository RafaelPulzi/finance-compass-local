import { useState } from "react";
import { formatBRL } from "../domain/money";
import type { MarkingPreview } from "../domain/selection";
import type { Account, Id } from "../domain/types";
import { CategoryOptions, type CategoryTree } from "./CategoryOptions";

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
  /**
   * What marking the selection against one Account would actually do, decided
   * by the same domain function the confirmation runs — so the warning can
   * never promise a balance change the conversion then doesn't make.
   */
  previewFor: (otherAccountId: Id) => MarkingPreview;
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
  previewFor,
  onAssign,
  onMarkTransfers,
  onClear,
}: Props) {
  const [otherAccountId, setOtherAccountId] = useState("");
  const chosen = accounts.find((a) => a.id === otherAccountId);
  const preview = chosen === undefined ? null : previewFor(chosen.id);

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
        {chosen !== undefined && preview !== null && (
          <>
            <button
              type="button"
              className="rounded-md bg-slate-700 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
              disabled={preview.converts === 0}
              onClick={() => {
                onMarkTransfers(chosen.id);
                setOtherAccountId("");
              }}
            >
              Confirmar {preview.converts} transferência
              {preview.converts === 1 ? "" : "s"}
            </button>
            <p className="w-full text-xs text-emerald-900 dark:text-emerald-200">
              Esses valores deixam de contar como receita ou despesa. O saldo de{" "}
              {chosen.name}
              {preview.arrives > 0 && (
                <>
                  {" "}
                  aumenta <span className="font-mono">{formatBRL(preview.arrives)}</span>
                </>
              )}
              {preview.arrives > 0 && preview.leaves > 0 && " e"}
              {preview.leaves > 0 && (
                <>
                  {" "}
                  diminui <span className="font-mono">{formatBRL(preview.leaves)}</span>
                </>
              )}
              {preview.arrives === 0 && preview.leaves === 0 && " não muda"}.
              {preview.skipped > 0 &&
                ` ${preview.skipped === 1 ? "1 lançamento da seleção será ignorado" : `${preview.skipped} lançamentos da seleção serão ignorados`} — já está${preview.skipped === 1 ? "" : "ão"} nessa conta ou já ${preview.skipped === 1 ? "é" : "são"} transferência.`}
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
