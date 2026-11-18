import { type FormEvent, useMemo, useState } from "react";
import { categoryTree, treeHas } from "../domain/categories";
import { formatDateBR } from "../domain/dates";
import { formatBRL, parseBRL } from "../domain/money";
import { markingPreview } from "../domain/selection";
import { addTransaction } from "../domain/transactionCreate";
import { monthsWithTransactions } from "../domain/transactionQuery";
import type { Id, Transaction } from "../domain/types";
import { canUndoMarking } from "../domain/transferRecovery";
import { useVault } from "../store/useVault";
import type { BulkNotice } from "../worklist/worklist";
import { useWorklist } from "../worklist/useWorklist";
import { BulkActionsBar } from "./BulkActionsBar";
import { RuleOfferForm } from "./RuleOfferForm";
import { CategoryOptions, type CategoryTree } from "./CategoryOptions";
import { TransactionEditForm } from "./TransactionEditForm";
import { TransactionFilters } from "./TransactionFilters";
import { TransferCandidates } from "./TransferCandidates";
import { TransferMarkForm } from "./TransferMarkForm";
import { todayISO } from "./labels";

type Kind = Transaction["kind"];

/**
 * What the Worklist said, in Portuguese.
 *
 * The module reports structured outcomes — `{ converted, skipped }`,
 * `{ applied }` — and the words are built here, where every other piece of
 * Portuguese in the app lives. It keeps the module's tests off these strings.
 */
function noticeText(notice: BulkNotice, nameOfCategory: (id: Id) => string): string {
  switch (notice.said) {
    case "refused":
      return notice.message;

    case "marked": {
      // Every skip is named, not just counted: a batch chosen by description
      // can sweep in an entry that cannot convert, and a count alone would
      // leave the user believing their whole selection moved.
      const converted =
        notice.converted === 1
          ? "1 lançamento virou transferência."
          : `${notice.converted} lançamentos viraram transferências.`;
      if (notice.skipped.length === 0) return converted;
      const reasons = [...new Set(notice.skipped.map((s) => s.message))];
      return `${converted} ${notice.skipped.length} ignorado${
        notice.skipped.length === 1 ? "" : "s"
      }: ${reasons.join(" ")}`;
    }

    case "suggestionsApplied":
      return notice.applied === 0
        ? "Nenhuma sugestão para aplicar."
        : notice.applied === 1
          ? "1 transação categorizada a partir das suas decisões anteriores."
          : `${notice.applied} transações categorizadas a partir das suas decisões anteriores.`;

    case "ruleCreated":
      return `Regra criada: descrições com “${notice.pattern}” vão para ${nameOfCategory(
        notice.categoryId,
      )}. Aplique-a ao resto na página Regras.`;
  }
}

export function TransactionsPanel() {
  const vault = useVault((s) => s.vault);
  const run = useVault((s) => s.run);

  /**
   * Working through the list — the selection, which row has a form open, what
   * the app last said — is the Worklist's, not this component's (ADR-0011).
   */
  const list = useWorklist();
  const { state, view } = list;

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
  const rulePattern = useMemo(
    () => new Map(vault.rules.map((r) => [r.id, r.pattern])),
    [vault.rules],
  );
  const nameOfCategory = (id: Id) => categoryName.get(id) ?? "essa categoria";

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

    if (kind === "transfer" && !toAccountId) return setError("Escolha a conta de destino.");
    if (kind !== "transfer" && !categoryId) return setError("Escolha uma categoria.");
    // One entry point whatever the kind: the domain decided that, the form obeys.
    const result = run(
      addTransaction(
        kind === "transfer"
          ? { kind, date, amount: value, fromAccountId: accountId, toAccountId, description }
          : { kind, date, amount: value, accountId, categoryId, description },
      ),
    );
    // The domain has the last word; a refusal keeps what was typed so it can be fixed.
    if (!result.ok) return setError(result.message);
    setAmount("");
    setDescription("");
  }

  const inputClass =
    "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";

  const bulkNotice = state.notice?.at === "bulk" ? state.notice : null;
  const rowError = state.notice?.at === "row" ? state.notice : null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          Transações
        </h2>
        {view.pendingCategories > 0 && (
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {view.pendingCategories} sem categoria
            </span>
            {view.suggestionFor.size > 0 && (
              <button
                type="button"
                className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 underline hover:bg-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:hover:bg-sky-900"
                onClick={() => list.applyAllSuggestions()}
              >
                aplicar{" "}
                {view.suggestionFor.size === 1
                  ? "1 sugestão"
                  : `${view.suggestionFor.size} sugestões`}
              </button>
            )}
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

      <TransferCandidates />

      <TransactionFilters
        filter={state.filter}
        onChange={list.changeFilter}
        accounts={vault.accounts}
        treesByKind={treesByKind}
        months={months}
      />

      {/* What the filter is actually showing, so a narrowed list is never mistaken for the whole Vault. */}
      <p className="mb-2 text-xs text-slate-500" data-testid="selection-summary">
        {view.selection.count === 1 ? "1 transação" : `${view.selection.count} transações`}
        {" · Receitas "}
        <span className="font-mono">{formatBRL(view.selection.income)}</span>
        {" · Despesas "}
        <span className="font-mono">{formatBRL(view.selection.expense)}</span>
      </p>

      {/* The count is the filter's whole result set, not the visible page: that is
          what makes classifying a statement one decision instead of twelve. */}
      {view.selectableIds.length > 0 && (
        <label className="mb-2 flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            aria-label="Selecionar todas as transações do filtro"
            checked={view.allSelected}
            onChange={() => list.toggleAll()}
          />
          Selecionar todas ({view.selectableIds.length})
        </label>
      )}

      {state.selected.size > 0 && view.kindOfSelection !== null && (
        <BulkActionsBar
          selectedCount={state.selected.size}
          kind={view.kindOfSelection}
          tree={view.kindOfSelection === "mixed" ? [] : treesByKind[view.kindOfSelection]}
          accounts={vault.accounts}
          previewFor={(otherAccountId) =>
            markingPreview(vault, [...state.selected], otherAccountId)
          }
          onAssign={list.classifySelected}
          onMarkTransfers={list.markSelected}
          onClear={() => list.clearSelection()}
        />
      )}

      {state.ruleOffer !== null && (
        <RuleOfferForm
          suggested={state.ruleOffer.pattern}
          categoryName={nameOfCategory(state.ruleOffer.categoryId)}
          onAccept={list.acceptRuleOffer}
          onDecline={() => list.declineRuleOffer()}
        />
      )}

      {bulkNotice !== null && (
        <p
          className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          role="status"
        >
          {noticeText(bulkNotice, nameOfCategory)}
        </p>
      )}

      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
        {view.rows.length === 0 && (
          <li className="py-2 text-slate-500">
            {vault.transactions.length === 0
              ? "Nenhuma transação ainda."
              : "Nenhuma transação corresponde aos filtros."}
          </li>
        )}
        {view.rows.map((tx) => {
          const open = state.openRow?.id === tx.id ? state.openRow.mode : null;
          return (
          <li key={tx.id} className="flex flex-wrap items-center gap-2 py-2">
            {open === "editing" ? (
              <TransactionEditForm
                transaction={tx}
                accounts={vault.accounts}
                treesByKind={treesByKind}
                onSave={(changes) => list.saveRowEdit(tx.id, changes)}
                onCancel={() => list.closeRow()}
              />
            ) : open === "marking" && tx.kind !== "transfer" ? (
              <TransferMarkForm
                transaction={tx}
                accounts={vault.accounts}
                onMark={(otherAccountId) => list.markRow(tx.id, otherAccountId)}
                onCancel={() => list.closeRow()}
              />
            ) : open === "deleting" ? (
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
                  onClick={() => list.deleteRow(tx.id)}
                >
                  Confirmar exclusão
                </button>
                <button
                  type="button"
                  className="text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
                  onClick={() => list.closeRow()}
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
                checked={state.selected.has(tx.id)}
                onChange={() => list.toggleSelected(tx.id)}
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
                      onChange={(e) => {
                        if (!e.target.value) return;
                        list.classifyRow(tx.id, e.target.value);
                      }}
                    >
                      <option value="">Sem categoria</option>
                      <CategoryOptions tree={treesByKind[tx.kind]} />
                    </select>
                    {/* The Category the user's own repeated decisions point to;
                        one click accepts it through the same write classifying
                        by hand uses. */}
                    {view.suggestionFor.has(tx.id) && (
                      <button
                        type="button"
                        aria-label={`Aceitar sugestão para ${tx.description || "transação sem descrição"}`}
                        className="rounded border border-sky-300 bg-sky-50 px-1 py-0.5 text-xs text-sky-900 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900"
                        onClick={() => list.acceptSuggestion(tx.id)}
                      >
                        sugestão:{" "}
                        {categoryName.get(view.suggestionFor.get(tx.id)?.categoryId ?? "") ?? "?"}
                      </button>
                    )}
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
                canUndoMarking(tx) && (
                  <button
                    type="button"
                    aria-label={`Desfazer transferência ${tx.description || "sem descrição"}`}
                    className="underline hover:text-slate-700 dark:hover:text-slate-200"
                    onClick={() => list.undoRowMarking(tx.id)}
                  >
                    desfazer transferência
                  </button>
                )
              ) : (
                <button
                  type="button"
                  aria-label={`Marcar ${tx.description || "transação sem descrição"} como transferência`}
                  className="underline hover:text-slate-700 dark:hover:text-slate-200"
                  onClick={() => list.openRow(tx.id, "marking")}
                >
                  transferência
                </button>
              )}
              <button
                type="button"
                aria-label={`Editar ${tx.description || "transação sem descrição"}`}
                className="underline hover:text-slate-700 dark:hover:text-slate-200"
                onClick={() => list.openRow(tx.id, "editing")}
              >
                editar
              </button>
              <button
                type="button"
                aria-label={`Excluir ${tx.description || "transação sem descrição"}`}
                className="underline hover:text-red-600"
                onClick={() => list.openRow(tx.id, "deleting")}
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
          );
        })}
      </ul>

      {view.pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
            disabled={view.page === 0}
            onClick={() => list.goToPage(view.page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {view.page + 1} de {view.pageCount}
          </span>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40 dark:border-slate-600"
            disabled={view.page >= view.pageCount - 1}
            onClick={() => list.goToPage(view.page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </section>
  );
}
