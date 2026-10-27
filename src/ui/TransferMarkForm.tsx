import { type FormEvent, useState } from "react";
import { formatBRL } from "../domain/money";
import type { Account, ExpenseTransaction, IncomeTransaction } from "../domain/types";
import type { TransactionEditResult } from "../store/useVault";

interface Props {
  transaction: IncomeTransaction | ExpenseTransaction;
  accounts: readonly Account[];
  /** Returns the store's verdict: a refused marking is reported, not swallowed. */
  onMark: (otherAccountId: string) => TransactionEditResult;
  onCancel: () => void;
}

/**
 * Names the other side of a Transfer the Statement could never name, in place of
 * the entry's row.
 *
 * Only the other Account is asked for. The direction follows from the entry
 * itself — an Expense left the Account it was imported on, an Income arrived
 * there — so asking the user to pick it would be a question with one right
 * answer that they could still get wrong.
 *
 * The balance warning is not decoration. This is the one conversion in the app
 * that moves money: the entry used to touch one Account and the Transfer touches
 * two, so the chosen Account's balance has to change. The user should read that
 * before the click, not discover it on the Accounts page afterwards.
 */
export function TransferMarkForm({ transaction, accounts, onMark, onCancel }: Props) {
  const [otherAccountId, setOtherAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const outgoing = transaction.kind === "expense";
  const others = accounts.filter((a) => a.id !== transaction.accountId);
  const chosen = others.find((a) => a.id === otherAccountId);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (otherAccountId === "") {
      return setError(outgoing ? "Escolha a conta de destino." : "Escolha a conta de origem.");
    }
    const result = onMark(otherAccountId);
    if (!result.ok) setError(result.message);
  }

  const inputClass =
    "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";

  return (
    <form onSubmit={submit} className="w-full space-y-2 py-1">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {outgoing ? "Para onde foi" : "De onde veio"} “
        {transaction.description || "(sem descrição)"}”,{" "}
        <span className="font-mono">{formatBRL(transaction.amount)}</span>?
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={outgoing ? "Conta de destino" : "Conta de origem"}
          className={inputClass}
          value={otherAccountId}
          onChange={(e) => setOtherAccountId(e.target.value)}
        >
          <option value="">{outgoing ? "Conta de destino" : "Conta de origem"}</option>
          {others.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="rounded-md bg-slate-700 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
        >
          Marcar como transferência
        </button>
        <button
          type="button"
          className="text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>

      {/* Stated once a destination exists, so it can name the Account and the
          direction instead of warning in the abstract. */}
      {chosen !== undefined && (
        <p className="text-xs text-slate-500">
          O valor deixa de contar como {outgoing ? "despesa" : "receita"}. O saldo de{" "}
          {chosen.name} {outgoing ? "aumenta" : "diminui"} em{" "}
          <span className="font-mono">{formatBRL(transaction.amount)}</span>; o saldo de{" "}
          {accounts.find((a) => a.id === transaction.accountId)?.name ?? "?"} não muda.
        </p>
      )}

      {others.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Só existe uma conta no cofre. Crie a outra conta — a poupança ou o CDB para
          onde o dinheiro foi — antes de marcar transferências.
        </p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
