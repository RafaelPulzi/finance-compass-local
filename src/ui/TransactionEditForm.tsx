import { type FormEvent, useState } from "react";
import { treeHas } from "../domain/categories";
import { parseBRL } from "../domain/money";
import type { TransactionEdit } from "../domain/transactionEdit";
import type { Account, Transaction } from "../domain/types";
import type { TransactionEditResult } from "../store/useVault";
import { CategoryOptions, type CategoryTree } from "./CategoryOptions";

type EditableKind = "income" | "expense";

/** "30000" centavos -> "300,00", the form the amount field is typed in. */
function amountField(amount: number): string {
  return (amount / 100).toFixed(2).replace(".", ",");
}

interface Props {
  transaction: Transaction;
  accounts: readonly Account[];
  treesByKind: Record<EditableKind, CategoryTree>;
  /** Returns the store's verdict: a refused edit is reported, not swallowed. */
  onSave: (changes: TransactionEdit) => TransactionEditResult;
  onCancel: () => void;
}

/**
 * Corrects one Transaction in place of its row.
 *
 * A Transfer gets a different set of fields — two Accounts and no Category —
 * and cannot be turned into an Income or an Expense here. That conversion is a
 * different shape entirely and belongs with Transfer detection.
 */
export function TransactionEditForm({
  transaction,
  accounts,
  treesByKind,
  onSave,
  onCancel,
}: Props) {
  const isTransfer = transaction.kind === "transfer";

  const [kind, setKind] = useState<EditableKind>(
    isTransfer ? "expense" : (transaction.kind as EditableKind),
  );
  const [date, setDate] = useState(transaction.date);
  const [amount, setAmount] = useState(amountField(transaction.amount));
  const [description, setDescription] = useState(transaction.description);
  const [accountId, setAccountId] = useState(
    transaction.kind === "transfer" ? "" : transaction.accountId,
  );
  const [fromAccountId, setFromAccountId] = useState(
    transaction.kind === "transfer" ? transaction.fromAccountId : "",
  );
  const [toAccountId, setToAccountId] = useState(
    transaction.kind === "transfer" ? transaction.toAccountId : "",
  );
  const [categoryId, setCategoryId] = useState(
    transaction.kind === "transfer" ? "" : (transaction.categoryId ?? ""),
  );
  const [error, setError] = useState<string | null>(null);

  /**
   * Income and expense Categories are separate sets, so a Category that doesn't
   * belong to the newly chosen kind is cleared here rather than sent and refused.
   */
  function changeKind(next: EditableKind) {
    setKind(next);
    if (!treeHas(treesByKind[next], categoryId)) setCategoryId("");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let value: ReturnType<typeof parseBRL>;
    try {
      value = parseBRL(amount);
    } catch {
      return setError("Informe um valor válido.");
    }

    const changes: TransactionEdit = isTransfer
      ? { date, amount: value, description, fromAccountId, toAccountId }
      : {
          date,
          amount: value,
          description,
          kind,
          accountId,
          categoryId: categoryId === "" ? null : categoryId,
        };

    const result = onSave(changes);
    if (!result.ok) setError(result.message);
  }

  const inputClass =
    "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";

  return (
    <form onSubmit={submit} className="grid w-full grid-cols-2 gap-2 py-1">
      {isTransfer ? (
        <>
          <select
            aria-label="Editar conta de origem"
            className={inputClass}
            value={fromAccountId}
            onChange={(e) => setFromAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Editar conta de destino"
            className={inputClass}
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <select
            aria-label="Editar tipo"
            className={inputClass}
            value={kind}
            onChange={(e) => changeKind(e.target.value as EditableKind)}
          >
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
          <select
            aria-label="Editar conta"
            className={inputClass}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </>
      )}

      <input
        aria-label="Editar data"
        type="date"
        className={inputClass}
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <input
        aria-label="Editar valor"
        className={`${inputClass} text-right`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <input
        aria-label="Editar descrição"
        className={isTransfer ? `${inputClass} col-span-2` : inputClass}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {!isTransfer && (
        <select
          aria-label="Editar categoria"
          className={inputClass}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Sem categoria</option>
          <CategoryOptions tree={treesByKind[kind]} />
        </select>
      )}

      <div className="col-span-2 flex items-center gap-2">
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
        >
          Cancelar
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </form>
  );
}
