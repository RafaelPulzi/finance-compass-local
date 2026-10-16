import { type FormEvent, useMemo, useState } from "react";
import { formatBRL, parseBRL } from "../domain/money";
import type { Category, Transaction } from "../domain/types";
import { useVault } from "../store/useVault";
import { todayISO } from "./labels";

type Kind = Transaction["kind"];

export function TransactionsPanel() {
  const vault = useVault((s) => s.vault);
  const addIncome = useVault((s) => s.addIncome);
  const addExpense = useVault((s) => s.addExpense);
  const addTransfer = useVault((s) => s.addTransfer);
  const setTransactionCategory = useVault((s) => s.setTransactionCategory);

  const [kind, setKind] = useState<Kind>("expense");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accountName = useMemo(
    () => new Map(vault.accounts.map((a) => [a.id, a.name])),
    [vault.accounts],
  );
  const categoryName = useMemo(
    () => new Map(vault.categories.map((c) => [c.id, c.name])),
    [vault.categories],
  );

  /** Categories split by the kind of transaction they can classify. */
  const categoriesByKind = useMemo(() => {
    const groupKind = new Map(vault.groups.map((g) => [g.id, g.kind]));
    const byKind: Record<"income" | "expense", Category[]> = { income: [], expense: [] };
    for (const category of vault.categories) {
      const k = groupKind.get(category.groupId);
      if (k) byKind[k].push(category);
    }
    return byKind;
  }, [vault.groups, vault.categories]);

  const categoryOptions = kind === "transfer" ? [] : categoriesByKind[kind];

  const recent = [...vault.transactions]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 15);

  const uncategorizedCount = vault.transactions.filter(
    (tx) => tx.kind !== "transfer" && tx.categoryId === null,
  ).length;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let value: ReturnType<typeof parseBRL>;
    try {
      value = parseBRL(amount);
      if (value <= 0) throw new Error();
    } catch {
      return setError("Informe um valor válido.");
    }
    if (!accountId) return setError("Escolha uma conta.");

    if (kind === "transfer") {
      if (!toAccountId) return setError("Escolha a conta de destino.");
      if (toAccountId === accountId)
        return setError("Origem e destino devem ser diferentes.");
      addTransfer({ date, amount: value, fromAccountId: accountId, toAccountId, description });
    } else {
      if (!categoryId) return setError("Escolha uma categoria.");
      const payload = { date, amount: value, accountId, categoryId, description };
      if (kind === "income") addIncome(payload);
      else addExpense(payload);
    }
    setAmount("");
    setDescription("");
  }

  const inputClass =
    "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          Transações
        </h2>
        {uncategorizedCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {uncategorizedCount} sem categoria
          </span>
        )}
      </div>

      <form onSubmit={submit} className="mb-4 grid grid-cols-2 gap-2">
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
          <option value="transfer">Transferência</option>
        </select>
        <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <input
          className={`${inputClass} text-right`}
          placeholder="Valor (ex: 49,90)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{kind === "transfer" ? "Conta de origem" : "Conta"}</option>
          {vault.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {kind === "transfer" ? (
          <select className={inputClass} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="">Conta de destino</option>
            {vault.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        ) : (
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Categoria</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        <button
          type="submit"
          className="col-span-2 rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Adicionar transação
        </button>
        {error && <p className="col-span-2 text-xs text-red-600">{error}</p>}
      </form>

      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
        {recent.length === 0 && (
          <li className="py-2 text-slate-500">Nenhuma transação ainda.</li>
        )}
        {recent.map((tx) => (
          <li key={tx.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-slate-800 dark:text-slate-100">
                {tx.description || "(sem descrição)"}
              </div>
              <div className="text-xs text-slate-500">
                {tx.kind === "transfer" ? (
                  <>
                    {tx.date} · {accountName.get(tx.fromAccountId) ?? "?"} →{" "}
                    {accountName.get(tx.toAccountId) ?? "?"}
                  </>
                ) : tx.categoryId === null ? (
                  // Imported transactions arrive uncategorized; classify them here.
                  <span className="flex items-center gap-1">
                    {tx.date} ·
                    <select
                      className="rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      value=""
                      onChange={(e) =>
                        e.target.value && setTransactionCategory(tx.id, e.target.value)
                      }
                    >
                      <option value="">Sem categoria</option>
                      {categoriesByKind[tx.kind].map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    · {accountName.get(tx.accountId) ?? "?"}
                  </span>
                ) : (
                  <>
                    {tx.date} · {categoryName.get(tx.categoryId) ?? "?"} ·{" "}
                    {accountName.get(tx.accountId) ?? "?"}
                  </>
                )}
              </div>
            </div>
            <span
              className={
                tx.kind === "income"
                  ? "shrink-0 font-mono text-emerald-600 dark:text-emerald-400"
                  : tx.kind === "expense"
                    ? "shrink-0 font-mono text-red-600 dark:text-red-400"
                    : "shrink-0 font-mono text-slate-500"
              }
            >
              {tx.kind === "income" ? "+" : tx.kind === "expense" ? "-" : ""}
              {formatBRL(tx.amount)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
