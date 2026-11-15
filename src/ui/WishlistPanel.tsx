import { useEffect, useMemo, useState } from "react";
import { formatBRL, parseBRL, sumCentavos } from "../domain/money";
import type { Wish } from "../domain/types";
import { isOpenWish } from "../domain/types";
import {
  THIRTY_DAY_THRESHOLD,
  isWaitOver,
  waitRuleFor,
  wishDeadline,
} from "../domain/wishes";
import { useVault } from "../store/useVault";

const WAIT_LABELS = {
  "48-hours": "48 horas",
  "30-days": "30 dias",
} as const;

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "faltam 12 dias" / "faltam 3 h" / "falta menos de 1 h", floor on purpose. */
function remainingLabel(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 48) return `faltam ${Math.floor(hours / 24)} dias`;
  if (hours >= 2) return `faltam ${hours} h`;
  return "falta menos de 2 h";
}

export function WishlistPanel() {
  const vault = useVault((s) => s.vault);
  const addWish = useVault((s) => s.addWish);
  const buyWish = useVault((s) => s.buyWish);
  const dropWish = useVault((s) => s.dropWish);
  const deleteWish = useVault((s) => s.deleteWish);

  const [name, setName] = useState("");
  const [priceDraft, setPriceDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The clock the countdowns read. A minute is plenty: the shortest wait is
  // 48 hours, so nobody is watching seconds tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { open, decided } = useMemo(() => {
    const open = vault.wishes
      .filter(isOpenWish)
      .sort((a, b) => wishDeadline(a) - wishDeadline(b));
    const decided = vault.wishes
      .filter((w) => !isOpenWish(w))
      .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
    return { open, decided };
  }, [vault.wishes]);

  const avoided = sumCentavos(
    decided.filter((w) => w.decision === "dropped").map((w) => w.price),
  );

  /** Which wait the typed price would fall under, shown before anything is saved. */
  const draftRule = useMemo(() => {
    try {
      const price = parseBRL(priceDraft);
      return price > 0 ? waitRuleFor(price) : null;
    } catch {
      return null;
    }
  }, [priceDraft]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let result;
    try {
      result = addWish({ name, price: parseBRL(priceDraft) });
    } catch {
      setError("Preço inválido. Use o formato 199,90.");
      return;
    }
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setName("");
    setPriceDraft("");
    setError(null);
  }

  function act(action: (id: string) => { ok: true } | { ok: false; message: string }, id: string) {
    const result = action(id);
    setError(result.ok ? null : result.message);
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          Lista de desejos
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Anote o que você quer comprar e espere: 48 horas para itens de menor
          valor, 30 dias a partir de {formatBRL(THIRTY_DAY_THRESHOLD)}. Se a
          vontade sobreviver à espera, compre em paz.
        </p>

        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-slate-500">
            O que você quer comprar
            <input
              className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fone de ouvido"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-500">
            Preço (R$)
            <input
              className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-sm tabular-nums text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              placeholder="199,90"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Entrar na espera
          </button>
        </form>
        {draftRule !== null && (
          <p className="mt-2 text-xs text-slate-500">
            Este item vai esperar <strong>{WAIT_LABELS[draftRule]}</strong>.
          </p>
        )}
        {error !== null && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Em espera
        </h3>
        {open.length === 0 ? (
          <p className="py-3 text-sm text-slate-500">
            Nenhum desejo esperando. Que a lista continue assim.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {open.map((wish) => (
              <OpenWishRow
                key={wish.id}
                wish={wish}
                now={now}
                onBuy={() => act(buyWish, wish.id)}
                onDrop={() => act(dropWish, wish.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Decididos
          </h3>
          {avoided > 0 && (
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
              Desistindo, você deixou de gastar{" "}
              <strong className="font-mono tabular-nums">{formatBRL(avoided)}</strong>.
            </p>
          )}
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
            {decided.map((wish) => (
              <li key={wish.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-800 dark:text-slate-100">
                    {wish.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {wish.decision === "bought" ? "Comprado" : "Desistiu"}
                    {wish.decidedAt
                      ? ` em ${dateTime.format(new Date(wish.decidedAt))}`
                      : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`font-mono text-sm tabular-nums ${
                      wish.decision === "dropped"
                        ? "text-emerald-700 line-through dark:text-emerald-400"
                        : "text-slate-800 dark:text-slate-100"
                    }`}
                  >
                    {formatBRL(wish.price)}
                  </span>
                  <button
                    type="button"
                    onClick={() => act(deleteWish, wish.id)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OpenWishRow({
  wish,
  now,
  onBuy,
  onDrop,
}: {
  wish: Wish;
  now: number;
  onBuy: () => void;
  onDrop: () => void;
}) {
  const ready = isWaitOver(wish, now);
  const deadline = wishDeadline(wish);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-slate-800 dark:text-slate-100">
          {wish.name}
        </div>
        <div className="text-xs text-slate-500">
          Espera de {WAIT_LABELS[waitRuleFor(wish.price)]} ·{" "}
          {ready ? (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              a espera acabou — ainda quer?
            </span>
          ) : (
            <>
              libera em {dateTime.format(new Date(deadline))} (
              {remainingLabel(deadline - now)})
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-sm tabular-nums text-slate-800 dark:text-slate-100">
          {formatBRL(wish.price)}
        </span>
        {ready && (
          <button
            type="button"
            onClick={onBuy}
            className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Comprar
          </button>
        )}
        <button
          type="button"
          onClick={onDrop}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Desistir
        </button>
      </div>
    </li>
  );
}
