import { type FormEvent, useMemo, useState } from "react";
import { categoryTree } from "../domain/categories";
import { uncategorizedCount } from "../domain/transactionQuery";
import {
  pendingRuleCount,
  ruleMatchCounts,
} from "../domain/classificationRules";
import type { CategoryKind, Id } from "../domain/types";
import { type ActionResult, useVault } from "../store/useVault";
import { CategoryOptions } from "./CategoryOptions";

const inputClass =
  "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";
const linkClass =
  "text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300";

const KIND_LABEL: Record<CategoryKind, string> = {
  expense: "despesa",
  income: "receita",
};

type Editing = { id: Id; pattern: string; categoryId: Id } | null;

/**
 * Where Rules are written, ordered and run (issue #8).
 *
 * Its own page rather than a panel on the Transactions list, which is already
 * the busiest screen in the app. Every rule about Rules lives in
 * domain/classificationRules; this page asks and shows the verdict.
 *
 * Two things here are not decoration. The order is shown and reordered because
 * the order *is* the priority — the first match decides — and the count beside
 * each Rule is how a pattern that matches too much becomes visible instead of
 * quietly mislabelling a year of spending.
 */
export function RulesPanel() {
  const vault = useVault((s) => s.vault);
  const addRule = useVault((s) => s.addRule);
  const editRule = useVault((s) => s.editRule);
  const deleteRule = useVault((s) => s.deleteRule);
  const moveRule = useVault((s) => s.moveRule);
  const applyRulesToUncategorized = useVault((s) => s.applyRulesToUncategorized);

  const trees = useMemo(
    () => ({
      expense: categoryTree(vault, "expense"),
      income: categoryTree(vault, "income"),
    }),
    [vault],
  );
  const categoryName = useMemo(
    () => new Map(vault.categories.map((c) => [c.id, c.name])),
    [vault.categories],
  );
  const counts = useMemo(() => ruleMatchCounts(vault), [vault]);
  /** How many Uncategorized Transactions the Rules as they stand would classify. */
  const pending = useMemo(() => pendingRuleCount(vault), [vault]);

  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [deletingId, setDeletingId] = useState<Id | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(
    null,
  );
  /** Set when the user has asked to apply the Rules and is being shown the count. */
  const [confirmingApply, setConfirmingApply] = useState(false);

  function report(result: ActionResult, ok?: string) {
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return false;
    }
    setMessage(ok ? { tone: "ok", text: ok } : null);
    return true;
  }

  function submitNew(e: FormEvent) {
    e.preventDefault();
    const outcome = addRule({ pattern, categoryId });
    if (!outcome.ok) return setMessage({ tone: "error", text: outcome.message });
    setMessage(null);
    setPattern("");
    setCategoryId("");
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (editing === null) return;
    const result = editRule(editing.id, {
      pattern: editing.pattern,
      categoryId: editing.categoryId,
    });
    if (report(result)) setEditing(null);
  }

  function apply() {
    const { applied } = applyRulesToUncategorized();
    setConfirmingApply(false);
    setMessage({
      tone: "ok",
      text:
        applied === 0
          ? "Nenhuma transação sem categoria combinou com as regras."
          : applied === 1
            ? "1 transação classificada pelas regras."
            : `${applied} transações classificadas pelas regras.`,
    });
  }

  const uncategorized = uncategorizedCount(vault);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Regras</h2>
      <p className="mb-3 text-xs text-slate-500">
        Uma regra classifica sozinha o que a descrição contém — maiúsculas e acentos
        não importam. As regras são testadas de cima para baixo e a primeira que
        combina decide. Elas só preenchem transações <strong>sem categoria</strong>:
        nunca mudam uma categoria que você escolheu.
      </p>

      <div aria-live="polite">
        {message && (
          <p
            className={
              message.tone === "error"
                ? "mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
                : "mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            }
          >
            {message.text}
          </p>
        )}
      </div>

      <form onSubmit={submitNew} className="mb-4 flex flex-wrap items-center gap-2">
        <input
          aria-label="Padrão da nova regra"
          className={`${inputClass} min-w-0 flex-1`}
          placeholder="A descrição contém… (ex: IFOOD)"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <select
          aria-label="Categoria da nova regra"
          className={inputClass}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Categoria</option>
          {/* Both kinds are offered; which one a Rule is follows from the
              Category chosen, so the two can never contradict each other. */}
          <CategoryOptions tree={trees.expense} groupLabel={(g) => `Despesas · ${g.name}`} />
          <CategoryOptions tree={trees.income} groupLabel={(g) => `Receitas · ${g.name}`} />
        </select>
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Criar regra
        </button>
      </form>

      <ol className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
        {vault.rules.length === 0 && (
          <li className="py-2 text-slate-500">
            Nenhuma regra ainda. Crie uma acima, ou classifique algumas transações e
            aceite a regra que o app vai oferecer.
          </li>
        )}
        {vault.rules.map((rule, index) => (
          <li key={rule.id} className="flex flex-wrap items-center gap-2 py-2">
            {editing?.id === rule.id ? (
              <form onSubmit={submitEdit} className="flex flex-1 flex-wrap items-center gap-2">
                <input
                  aria-label="Padrão da regra"
                  className={`${inputClass} min-w-0 flex-1`}
                  value={editing.pattern}
                  autoFocus
                  onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                />
                <select
                  aria-label="Categoria da regra"
                  className={inputClass}
                  value={editing.categoryId}
                  onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}
                >
                  {/* A Rule can be retargeted to the other kind, which is the
                      same decision as creating it with that Category. */}
                  <CategoryOptions
                    tree={trees.expense}
                    groupLabel={(g) => `Despesas · ${g.name}`}
                  />
                  <CategoryOptions
                    tree={trees.income}
                    groupLabel={(g) => `Receitas · ${g.name}`}
                  />
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  Salvar
                </button>
                <button type="button" className={linkClass} onClick={() => setEditing(null)}>
                  Cancelar
                </button>
              </form>
            ) : deletingId === rule.id ? (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <span className="text-slate-700 dark:text-slate-200">
                  Excluir a regra “{rule.pattern}”? As{" "}
                  {counts.get(rule.id) ?? 0} transações que ela já classificou ficam
                  como estão.
                </span>
                <button
                  type="button"
                  className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                  onClick={() => {
                    report(deleteRule(rule.id));
                    setDeletingId(null);
                  }}
                >
                  Confirmar exclusão
                </button>
                <button type="button" className={linkClass} onClick={() => setDeletingId(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <span className="w-6 shrink-0 text-right text-xs text-slate-400">
                  {index + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-slate-800 dark:text-slate-100">
                    contém “{rule.pattern}” → {categoryName.get(rule.categoryId) ?? "?"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {KIND_LABEL[rule.kind]} ·{" "}
                    {(() => {
                      const count = counts.get(rule.id) ?? 0;
                      return count === 1
                        ? "1 transação classificada"
                        : `${count} transações classificadas`;
                    })()}
                  </div>
                </div>
                <span className="flex shrink-0 gap-2 text-xs text-slate-400">
                  <button
                    type="button"
                    aria-label={`Mover a regra ${rule.pattern} para cima`}
                    className="underline hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                    disabled={index === 0}
                    onClick={() => report(moveRule(rule.id, -1))}
                  >
                    subir
                  </button>
                  <button
                    type="button"
                    aria-label={`Mover a regra ${rule.pattern} para baixo`}
                    className="underline hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                    disabled={index === vault.rules.length - 1}
                    onClick={() => report(moveRule(rule.id, 1))}
                  >
                    descer
                  </button>
                  <button
                    type="button"
                    aria-label={`Editar a regra ${rule.pattern}`}
                    className="underline hover:text-slate-700 dark:hover:text-slate-200"
                    onClick={() =>
                      setEditing({
                        id: rule.id,
                        pattern: rule.pattern,
                        categoryId: rule.categoryId,
                      })
                    }
                  >
                    editar
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir a regra ${rule.pattern}`}
                    className="underline hover:text-red-600"
                    onClick={() => setDeletingId(rule.id)}
                  >
                    excluir
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ol>

      {vault.rules.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
          {/* Writing a rule has to be able to clear the backlog, not only help
              the next import — and the count is shown before anything changes,
              so a pattern that matches too much is caught before it lands. */}
          <p className="mb-2 text-xs text-slate-500">
            {uncategorized === 0
              ? "Nada sem categoria no cofre."
              : `${uncategorized} transações sem categoria no cofre, das quais as regras classificariam ${pending}.`}
          </p>
          {confirmingApply ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-700 dark:text-slate-200">
                {pending === 1
                  ? "Classificar 1 transação agora?"
                  : `Classificar ${pending} transações agora?`}
              </span>
              <button
                type="button"
                className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                onClick={apply}
              >
                Confirmar
              </button>
              <button
                type="button"
                className={linkClass}
                onClick={() => setConfirmingApply(false)}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
              disabled={pending === 0}
              onClick={() => setConfirmingApply(true)}
            >
              Aplicar as regras ao que está sem categoria
            </button>
          )}
        </div>
      )}
    </section>
  );
}
