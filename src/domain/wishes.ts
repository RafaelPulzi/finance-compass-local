import type { CommandOutcome } from "./command";
import { type Centavos, centavos, formatBRL } from "./money";
import type { Id, Vault, Wish } from "./types";
import { isOpenWish } from "./types";

/**
 * Wishes: things the user wants to buy, held behind a waiting period so an
 * impulse has time to die before it costs money (docs/adr/0009).
 *
 * The two rules live here and only here:
 * - a cheaper item waits 48 hours;
 * - an expensive one (THIRTY_DAY_THRESHOLD or more) waits 30 days.
 *
 * Buying is refused until the wait is over — that refusal *is* the feature.
 * Deciding not to buy is allowed at any moment: the wait exists to slow
 * spending down, never to slow giving it up.
 */

/** The first price that counts as expensive and waits 30 days: R$ 500,00. */
export const THIRTY_DAY_THRESHOLD: Centavos = centavos(500_00);

const HOUR_MS = 60 * 60 * 1000;
export const SHORT_WAIT_MS = 48 * HOUR_MS;
export const LONG_WAIT_MS = 30 * 24 * HOUR_MS;

export type WaitRule = "48-hours" | "30-days";

/** Which waiting rule a price falls under. */
export function waitRuleFor(price: Centavos): WaitRule {
  return price >= THIRTY_DAY_THRESHOLD ? "30-days" : "48-hours";
}

/** When this Wish's wait ends, as epoch milliseconds. Derived, never stored. */
export function wishDeadline(wish: Wish): number {
  const wait = waitRuleFor(wish.price) === "30-days" ? LONG_WAIT_MS : SHORT_WAIT_MS;
  return Date.parse(wish.createdAt) + wait;
}

/** Whether the wait has passed and the Wish may be bought. */
export function isWaitOver(wish: Wish, nowMs: number): boolean {
  return nowMs >= wishDeadline(wish);
}

export interface WishInput {
  name: string;
  price: Centavos;
}

/** What a session has to provide: ids and the clock, so commands stay pure. */
export interface WishDeps {
  newId: () => Id;
  /** The current moment as an ISO timestamp. */
  now: () => string;
}

const deadlineLabel = (wish: Wish): string =>
  new Date(wishDeadline(wish)).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function findOpenWish(
  vault: Vault,
  wishId: Id,
): { ok: true; wish: Wish } | { ok: false; message: string } {
  const wish = vault.wishes.find((w) => w.id === wishId);
  if (wish === undefined) {
    return { ok: false, message: "Esse desejo não existe mais." };
  }
  if (!isOpenWish(wish)) {
    return { ok: false, message: "Esse desejo já foi decidido." };
  }
  return { ok: true, wish };
}

/** Add a Wish, which starts its wait at this very moment. */
export function addWish(
  vault: Vault,
  input: WishInput,
  deps: WishDeps,
): CommandOutcome<{ wish: Wish }> {
  const name = input.name.trim();
  if (name === "") {
    return { ok: false, message: "Dê um nome ao desejo." };
  }
  if (!Number.isInteger(input.price) || input.price <= 0) {
    return { ok: false, message: "Informe um preço maior que zero." };
  }
  const wish: Wish = {
    id: deps.newId(),
    name,
    price: input.price,
    createdAt: deps.now(),
  };
  return { ok: true, vault: { ...vault, wishes: [...vault.wishes, wish] }, wish };
}

/**
 * Buy a Wish — refused while its wait is still running. The refusal names the
 * moment the wait ends, so the answer is "not yet, until then", never a wall.
 */
export function buyWish(vault: Vault, wishId: Id, deps: WishDeps): CommandOutcome {
  const found = findOpenWish(vault, wishId);
  if (!found.ok) return found;
  const { wish } = found;
  const nowISO = deps.now();
  if (!isWaitOver(wish, Date.parse(nowISO))) {
    const rule = waitRuleFor(wish.price) === "30-days" ? "30 dias" : "48 horas";
    return {
      ok: false,
      message:
        `${wish.name} (${formatBRL(wish.price)}) ainda está na espera de ${rule}. ` +
        `Se continuar querendo, dá para comprar a partir de ${deadlineLabel(wish)}.`,
    };
  }
  return { ok: true, vault: decide(vault, wishId, "bought", nowISO) };
}

/**
 * Give a Wish up. Allowed at any moment, wait or no wait: deciding *not* to
 * spend is exactly what the list is for, so it is never made to wait.
 */
export function dropWish(vault: Vault, wishId: Id, deps: WishDeps): CommandOutcome {
  const found = findOpenWish(vault, wishId);
  if (!found.ok) return found;
  return { ok: true, vault: decide(vault, wishId, "dropped", deps.now()) };
}

/** Remove a decided Wish from the history. An open one is dropped, not deleted. */
export function deleteWish(vault: Vault, wishId: Id): CommandOutcome {
  const wish = vault.wishes.find((w) => w.id === wishId);
  if (wish === undefined) {
    return { ok: false, message: "Esse desejo não existe mais." };
  }
  if (isOpenWish(wish)) {
    return { ok: false, message: "Um desejo em aberto se desiste, não se apaga." };
  }
  return { ok: true, vault: { ...vault, wishes: vault.wishes.filter((w) => w.id !== wishId) } };
}

function decide(
  vault: Vault,
  wishId: Id,
  decision: Wish["decision"],
  decidedAt: string,
): Vault {
  return {
    ...vault,
    wishes: vault.wishes.map((w) => (w.id === wishId ? { ...w, decision, decidedAt } : w)),
  };
}
