import { type FormEvent, useMemo, useState } from "react";
import { categoryKind, categoryTree, treeHas } from "../domain/categories";
import { normalizedPattern, suggestedPattern } from "../domain/classificationRules";
import { formatDateBR } from "../domain/dates";
import { formatBRL, parseBRL } from "../domain/money";
import {
  NO_FILTER,
  type TransactionFilter,
  monthsWithTransactions,
  selectTransactions,
} from "../domain/transactionQuery";
import type { Id, Transaction } from "../domain/types";
import { useVault } from "../store/useVault";
import { BulkActionsBar, type SelectionTotals } from "./BulkActionsBar";
import { RuleOfferForm } from "./RuleOfferForm";
import { CategoryOptions, type CategoryTree } from "./CategoryOptions";
import { TransactionEditForm } from "./TransactionEditForm";
import { TransactionFilters } from "./TransactionFilters";
import { TransferMarkForm } from "./TransferMarkForm";
import { todayISO } from "./labels";

type Kind = Transaction["kind"];

/**
 * How many Transactions one page of the list shows. A Vault holding a couple of
 * years of imported Statements runs to several hundred, which is well within
 * what the DOM handles in pages — no windowing library earns its place here.
 */
const PAGE_SIZE = 50;

export function TransactionsPanel() {
  const vault = useVault((s) => s.vault);
  const addIncome = useVault((s) => s.addIncome);
  const addExpense = useVault((s) => s.addExpense);
  const addTransfer = useVault((s) => s.addTransfer);
  const setTransactionCategory = useVault((s) => s.setTransactionCategory);
  const setTransactionCategoryMany = useVault((s) => s.setTransactionCategoryMany);
  const editTransaction = useVault((s) => s.editTransaction);
  const deleteTransaction = useVault((s) => s.deleteTransaction);
  const markTransactionAsTransfer = useVault((s) => s.markTransactionAsTransfer);
  const markTransactionsAsTransfer = useVault((s) => s.markTransactionsAsTransfer);
  const addRule = useVault((s) => s.addRule);
  const revertTransferToEntry = useVault((s) => s.revertTransferToEntry);

  const [kind, setKind] = useState<Kind>("expense");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<TransactionFilter>(NO_FILTER);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<Id>>(new Set());
  /** At most one row is being edited, and at most one is awaiting a delete confirmation. */
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [deletingId, setDeletingId] = useState<Id | null>(null);
  /** At most one row is naming the other side of a Transfer. */
  const [markingId, setMarkingId] = useState<Id | null>(null);
  /** A refusal that has no form of its own to show it, shown on its row. */
  const [rowError, setRowError] = useState<{ id: Id; message: string } | null>(null);
  /**
   * What the last bulk action did. It outlives the selection on purpose: the
   * selection is cleared by the action, so a message living in the bar would
   * disappear with the bar that reported it.
   */
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  /** A Rule the app is offering to remember, from classification just done by hand. */
  const [ruleOffer, setRuleOffer] = useState<{ pattern: string; categoryId: Id } | null>(
    null,
  );

  /**
   * A new filter is a new result set, so the page the user was on no longer
   * means anything — and neither does the selection. Keeping a selection the
   * user can no longer see is how someone classifies 500 Transactions they
   * weren't looking at.
   */
  function changeFilter(next: TransactionFilter) {
    setFilter(next);
    setPage(0);
    setSelected(new Set());
    // A row being edited may not survive the new filter, and an open form the
    // user can no longer see is a change they can't finish or abandon.
    setEditingId(null);
    setDeletingId(null);
    setMarkingId(null);
    setRowError(null);
    setBulkNotice(null);
    setRuleOffer(null);
  }

  /** Open one row's form, closing anything else that was open. */
  function startEditing(id: Id) {
    setEditingId(id);
    setDeletingId(null);
    setMarkingId(null);
  }

  function startDeleting(id: Id) {
    setDeletingId(id);
    setEditingId(null);
    setMarkingId(null);
  }

  function startMarking(id: Id) {
    setMarkingId(id);
    setEditingId(null);
    setDeletingId(null);
    setRowError(null);
  }

  function toggleSelected(id: Id) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const accountName = useMemo(
    () => new Map(vault.accounts.map((a) => [a.id, a.name])),
    [vault.accounts],
  );
  const categoryName = useMemo(
    () => new Map(vault.categories.map((c) => [c.id, c.name])),
    [vault.categories],
  );
  const rulePattern = useMemo(
    () => new Map(vault.rules.map((r) => [r.id, r.pattern])),
    [vault.rules],
  );

  /** Categories split by the kind of transaction they can classify, under their Groups. */
  const treesByKind = useMemo<Record<"income" | "expense", CategoryTree>>(
    () => ({ income: categoryTree(vault, "income"), expense: categoryTree(vault, "expense") }),
    [vault],
  );

  /**
   * Income and expense Categories are separate sets, so a Category picked for
   * one kind is cleared when the kind changes. Keeping it is how an Income used
   * to be saved under an expense Category: the select showed nothing chosen,
   * but the stale id was still there and went with the submit.
   */
  function changeKind(next: Kind) {
    setKind(next);
    if (next === "transfer" || !treeHas(treesByKind[next], categoryId)) setCategoryId("");
  }

  const months = useMemo(() => monthsWithTransactions(vault), [vault]);
  const selection = useMemo(() => selectTransactions(vault, filter), [vault, filter]);

  const pageCount = Math.max(1, Math.ceil(selection.count / PAGE_SIZE));
  // Classifying or deleting can shrink the result under the page being viewed.
  const currentPage = Math.min(page, pageCount - 1);
  const rows = selection.transactions.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  );

  /** Transfers carry no Category, so they are never selectable for classification. */
  const selectableIds = useMemo(
    () =>
      selection.transactions.filter((tx) => tx.kind !== "transfer").map((tx) => tx.id),
    [selection],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  /**
   * The kind every selected Transaction shares, or "mixed" when the selection
   * spans both — income and expense Categories are separate, so a mixed
   * selection has no Category that could apply to all of it.
   */
  const selectedKind = useMemo(() => {
    let kind: "income" | "expense" | null = null;
    for (const tx of vault.transactions) {
      if (tx.kind === "transfer" || !selected.has(tx.id)) continue;
      if (kind === null) kind = tx.kind;
      else if (kind !== tx.kind) return "mixed" as const;
    }
    return kind;
  }, [vault.transactions, selected]);

  /**
   * What marking the selection would move, split by direction: the Expenses
   * arrive in the other Account and the Incomes leave it. Both sums are needed
   * because a selection may hold either or both.
   */
  const selectedTotals = useMemo<SelectionTotals>(() => {
    let outgoing = 0;
    let incoming = 0;
    for (const tx of vault.transactions) {
      if (tx.kind === "transfer" || !selected.has(tx.id)) continue;
      if (tx.kind === "expense") outgoing += tx.amount;
      else incoming += tx.amount;
    }
    return { outgoing, incoming } as SelectionTotals;
  }, [vault.transactions, selected]);

  function assignToSelected(categoryId: Id) {
    // Read the descriptions before the selection is cleared: they are what the
    // offered Rule is guessed from.
    const descriptions = vault.transactions
      .filter((tx) => tx.kind !== "transfer" && selected.has(tx.id))
      .map((tx) => tx.description);

    setTransactionCategoryMany([...selected], categoryId);
    setSelected(new Set());
    setBulkNotice(null);
    setRuleOffer(offerFor(descriptions, categoryId));
  }

  /**
   * The Rule worth offering for work just done by hand, or null when there is
   * none: no shared pattern to guess from, or a Rule that already says this.
   */
  function offerFor(descriptions: readonly string[], categoryId: Id) {
    const suggested = suggestedPattern(descriptions);
    if (suggested === null) return null;
    const kind = categoryKind(vault, categoryId);
    if (kind === undefined) return null;
    const known = vault.rules.some(
      (rule) => rule.kind === kind && normalizedPattern(rule.pattern) === suggested,
    );
    return known ? null : { pattern: suggested, categoryId };
  }

  function acceptRuleOffer(pattern: string) {
    if (ruleOffer === null) return;
    const outcome = addRule({ pattern, categoryId: ruleOffer.categoryId });
    setRuleOffer(null);
    setBulkNotice(
      outcome.ok
        ? `Regra criada: descrições com “${pattern}” vão para ${
            categoryName.get(ruleOffer.categoryId) ?? "essa categoria"
          }. Aplique-a ao resto na página Regras.`
        : outcome.message,
    );
  }

  function markSelectedAsTransfers(otherAccountId: Id) {
    const result = markTransactionsAsTransfer([...selected], otherAccountId);
    if (!result.ok) return setBulkNotice(result.message);

    // Every skip is named, not just counted: a batch chosen by description can
    // sweep in an entry that cannot convert, and a count alone would leave the
    // user believing their whole selection moved.
    const reasons = [...new Set(result.skipped.map((s) => s.message))];
    const converted =
      result.converted === 1
        ? "1 lançamento virou transferência."
        : `${result.converted} lançamentos viraram transferências.`;
    setBulkNotice(
      result.skipped.length === 0
        ? converted
        : `${converted} ${result.skipped.length} ignorado${
            result.skipped.length === 1 ? "" : "s"
          }: ${reasons.join(" ")}`,
    );
    setSelected(new Set());
  }

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

    let result;
    if (kind === "transfer") {
      if (!toAccountId) return setError("Escolha a conta de destino.");
      result = addTransfer({ date, amount: value, fromAccountId: accountId, toAccountId, description });
    } else {
      if (!categoryId) return setError("Escolha uma categoria.");
      const payload = { date, amount: value, accountId, categoryId, description };
      result = kind === "income" ? addIncome(payload) : addExpense(payload);
    }
    // The domain has the last word; a refusal keeps what was typed so it can be fixed.
    if (!result.ok) return setError(result.message);
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
        <select
          aria-label="Nova transação: tipo"
          className={inputClass}
          value={kind}
          onChange={(e) => changeKind(e.target.value as Kind)}
        >
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
          <option value="transfer">Transferência</option>
        </select>
        <input
          aria-label="Nova transação: data"
          className={inputClass}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        <input
          aria-label="Nova transação: valor"
          className={`${inputClass} text-right`}
          placeholder="Valor (ex: 49,90)"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          aria-label="Nova transação: descrição"
          className={inputClass}
          placeholder="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <select
          aria-label={kind === "transfer" ? "Nova transação: conta de origem" : "Nova transação: conta"}
          className={inputClass}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">{kind === "transfer" ? "Conta de origem" : "Conta"}</option>
          {vault.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {kind === "transfer" ? (
          <select
            aria-label="Nova transação: conta de destino"
            className={inputClass}
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
          >
            <option value="">Conta de destino</option>
            {vault.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        ) : (
          <select
            aria-label="Nova transação: categoria"
            className={inputClass}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Categoria</option>
            <CategoryOptions tree={treesByKind[kind]} />
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

      <TransactionFilters
        filter={filter}
        onChange={changeFilter}
        accounts={vault.accounts}
        treesByKind={treesByKind}
        months={months}
      />

      {/* What the filter is actually showing, so a narrowed list is never mistaken for the whole Vault. */}
      <p className="mb-2 text-xs text-slate-500" data-testid="selection-summary">
        {selection.count === 1 ? "1 transação" : `${selection.count} transações`}
        {" · Receitas "}
        <span className="font-mono">{formatBRL(selection.income)}</span>
        {" · Despesas "}
        <span className="font-mono">{formatBRL(selection.expense)}</span>
      </p>

      {/* The count is the filter's whole result set, not the visible page: that is
          what makes classifying a statement one decision instead of twelve. */}
      {selectableIds.length > 0 && (
        <label className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            aria-label="Selecionar todas as transações do filtro"
            checked={allSelected}
            onChange={() =>
              setSelected(allSelected ? new Set() : new Set(selectableIds))
            }
          />
          Selecionar todas ({selectableIds.length})
        </label>
      )}

      {selected.size > 0 && selectedKind !== null && (
        <BulkActionsBar
          selectedCount={selected.size}
          kind={selectedKind}
          tree={selectedKind === "mixed" ? [] : treesByKind[selectedKind]}
          accounts={vault.accounts}
          totals={selectedTotals}
          onAssign={assignToSelected}
          onMarkTransfers={markSelectedAsTransfers}
          onClear={() => setSelected(new Set())}
        />
      )}

      {ruleOffer !== null && (
        <RuleOfferForm
          suggested={ruleOffer.pattern}
          categoryName={categoryName.get(ruleOffer.categoryId) ?? "essa categoria"}
          onAccept={acceptRuleOffer}
          onDecline={() => setRuleOffer(null)}
        />
      )}

      {bulkNotice !== null && (
        <p
          className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          role="status"
        >
          {bulkNotice}
        </p>
      )}

      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
        {rows.length === 0 && (
          <li className="py-2 text-slate-500">
            {vault.transactions.length === 0
              ? "Nenhuma transação ainda."
              : "Nenhuma transação corresponde aos filtros."}
          </li>
        )}
        {rows.map((tx) => (
          <li key={tx.id} className="flex flex-wrap items-center gap-2 py-2">
            {editingId === tx.id ? (
              <TransactionEditForm
                transaction={tx}
                accounts={vault.accounts}
                treesByKind={treesByKind}
                onSave={(changes) => {
                  const result = editTransaction(tx.id, changes);
                  // A refused edit keeps the form open with its message showing.
                  if (result.ok) setEditingId(null);
                  return result;
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : markingId === tx.id && tx.kind !== "transfer" ? (
              <TransferMarkForm
                transaction={tx}
                accounts={vault.accounts}
                onMark={(otherAccountId) => {
                  const result = markTransactionAsTransfer(tx.id, otherAccountId);
                  // A refused marking keeps the form open with its message showing.
                  if (result.ok) setMarkingId(null);
                  return result;
                }}
                onCancel={() => setMarkingId(null)}
              />
            ) : deletingId === tx.id ? (
              <div className="flex w-full flex-wrap items-center gap-2 py-1">
                {/* Naming the Transaction is what makes this a confirmation and
                    not just a second click. */}
                <span className="text-slate-700 dark:text-slate-200">
                  Excluir “{tx.description || "(sem descrição)"}” de {formatDateBR(tx.date)},{" "}
                  <span className="font-mono">{formatBRL(tx.amount)}</span>?
                </span>
                <button
                  type="button"
                  className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                  onClick={() => {
                    deleteTransaction(tx.id);
                    setDeletingId(null);
                  }}
                >
                  Confirmar exclusão
                </button>
                <button
                  type="button"
                  className="text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
                  onClick={() => setDeletingId(null)}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <>
            {tx.kind === "transfer" ? (
              // A Transfer has no Category, so there is nothing to classify it into.
              <span className="w-4 shrink-0" aria-hidden="true" />
            ) : (
              <input
                type="checkbox"
                className="shrink-0"
                aria-label={`Selecionar ${tx.description || "transação sem descrição"}`}
                checked={selected.has(tx.id)}
                onChange={() => toggleSelected(tx.id)}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-slate-800 dark:text-slate-100">
                {tx.description || "(sem descrição)"}
              </div>
              <div className="text-xs text-slate-500">
                {tx.kind === "transfer" ? (
                  <>
                    {formatDateBR(tx.date)} · {accountName.get(tx.fromAccountId) ?? "?"} →{" "}
                    {accountName.get(tx.toAccountId) ?? "?"}
                  </>
                ) : tx.categoryId === null ? (
                  // Imported transactions arrive uncategorized; classify them here.
                  <span className="flex items-center gap-1">
                    {formatDateBR(tx.date)} ·
                    <select
                      aria-label={`Categoria de ${tx.description || "transação sem descrição"}`}
                      className="rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      value=""
                      onChange={(e) =>
                        e.target.value && setTransactionCategory(tx.id, e.target.value)
                      }
                    >
                      <option value="">Sem categoria</option>
                      <CategoryOptions tree={treesByKind[tx.kind]} />
                    </select>
                    · {accountName.get(tx.accountId) ?? "?"}
                  </span>
                ) : (
                  <>
                    {formatDateBR(tx.date)} · {categoryName.get(tx.categoryId) ?? "?"} ·{" "}
                    {accountName.get(tx.accountId) ?? "?"}
                    {/* Which Rule did this, so a surprising Category is traceable
                        to the thing that caused it. A Rule since deleted leaves
                        the Category alone, and says so rather than nothing. */}
                    {tx.ruleId !== undefined &&
                      (rulePattern.has(tx.ruleId)
                        ? ` · regra “${rulePattern.get(tx.ruleId)}”`
                        : " · por uma regra já excluída")}
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
            <span className="flex shrink-0 gap-2 text-xs text-slate-400">
              {tx.kind === "transfer" ? (
                // Only a Transfer recovered from a single imported entry knows
                // what to go back to; one the user typed has no earlier entry,
                // and one recovered from both sides belongs to the pair list.
                tx.recoveredFrom?.length === 1 && (
                  <button
                    type="button"
                    aria-label={`Desfazer transferência ${tx.description || "sem descrição"}`}
                    className="underline hover:text-slate-700 dark:hover:text-slate-200"
                    onClick={() => {
                      const result = revertTransferToEntry(tx.id);
                      setRowError(
                        result.ok ? null : { id: tx.id, message: result.message },
                      );
                    }}
                  >
                    desfazer transferência
                  </button>
                )
              ) : (
                <button
                  type="button"
                  aria-label={`Marcar ${tx.description || "transação sem descrição"} como transferência`}
                  className="underline hover:text-slate-700 dark:hover:text-slate-200"
                  onClick={() => startMarking(tx.id)}
                >
                  transferência
                </button>
              )}
              <button
                type="button"
                aria-label={`Editar ${tx.description || "transação sem descrição"}`}
                className="underline hover:text-slate-700 dark:hover:text-slate-200"
                onClick={() => startEditing(tx.id)}
              >
                editar
              </button>
              <button
                type="button"
                aria-label={`Excluir ${tx.description || "transação sem descrição"}`}
                className="underline hover:text-red-600"
                onClick={() => startDeleting(tx.id)}
              >
                excluir
              </button>
            </span>
            {rowError?.id === tx.id && (
              <p className="w-full text-xs text-red-600">{rowError.message}</p>
            )}
              </>
            )}
          </li>
        ))}
      </ul>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Anterior
          </button>
          <span>
            Página {currentPage + 1} de {pageCount}
          </span>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}
