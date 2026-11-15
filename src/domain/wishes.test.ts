import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import type { Vault, Wish } from "./types";
import { emptyVault } from "./types";
import {
  LONG_WAIT_MS,
  SHORT_WAIT_MS,
  THIRTY_DAY_THRESHOLD,
  addWish,
  buyWish,
  deleteWish,
  dropWish,
  waitRuleFor,
  wishDeadline,
} from "./wishes";

const T0 = "2026-11-15T12:00:00.000Z";

/** A clock stopped at `iso`, so every verdict about time is reproducible. */
const at = (iso: string) => ({ newId: () => "new", now: () => iso });

/** `ms` after T0, as the ISO string a deps clock returns. */
const after = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

function wish(partial: Partial<Wish> = {}): Wish {
  return { id: "w1", name: "Fone", price: centavos(19990), createdAt: T0, ...partial };
}

function vaultWith(...wishes: Wish[]): Vault {
  return { ...emptyVault(), wishes };
}

describe("the two waiting rules", () => {
  it("a cheaper item waits 48 hours", () => {
    expect(waitRuleFor(centavos(THIRTY_DAY_THRESHOLD - 1))).toBe("48-hours");
    expect(wishDeadline(wish())).toBe(Date.parse(T0) + SHORT_WAIT_MS);
  });

  it("the threshold itself is already expensive and waits 30 days", () => {
    expect(waitRuleFor(THIRTY_DAY_THRESHOLD)).toBe("30-days");
    expect(wishDeadline(wish({ price: THIRTY_DAY_THRESHOLD }))).toBe(
      Date.parse(T0) + LONG_WAIT_MS,
    );
  });
});

describe("addWish", () => {
  it("starts the wait at this very moment, with the name trimmed", () => {
    const result = addWish(vaultWith(), { name: "  Fone  ", price: centavos(100) }, at(T0));
    expect(result).toMatchObject({
      ok: true,
      wish: { id: "new", name: "Fone", price: 100, createdAt: T0 },
    });
    if (result.ok) expect(result.vault.wishes).toHaveLength(1);
  });

  it("refuses a nameless or free wish", () => {
    expect(addWish(vaultWith(), { name: "   ", price: centavos(100) }, at(T0)).ok).toBe(false);
    expect(addWish(vaultWith(), { name: "Fone", price: centavos(0) }, at(T0)).ok).toBe(false);
    expect(addWish(vaultWith(), { name: "Fone", price: centavos(-5) }, at(T0)).ok).toBe(false);
  });
});

describe("buyWish", () => {
  it("is refused while the wait runs, and the refusal says until when", () => {
    const result = buyWish(vaultWith(wish()), "w1", at(after(SHORT_WAIT_MS - 1)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/48 horas/);
  });

  it("a refused buy changes nothing", () => {
    const vault = vaultWith(wish());
    buyWish(vault, "w1", at(T0));
    expect(vault.wishes[0].decision).toBeUndefined();
  });

  it("is allowed the moment the wait ends", () => {
    const decidedAt = after(SHORT_WAIT_MS);
    const result = buyWish(vaultWith(wish()), "w1", at(decidedAt));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vault.wishes[0]).toMatchObject({ decision: "bought", decidedAt });
    }
  });

  it("an expensive wish is still waiting after 48 hours", () => {
    const vault = vaultWith(wish({ price: THIRTY_DAY_THRESHOLD }));
    expect(buyWish(vault, "w1", at(after(SHORT_WAIT_MS))).ok).toBe(false);
    expect(buyWish(vault, "w1", at(after(LONG_WAIT_MS))).ok).toBe(true);
  });

  it("refuses a wish that doesn't exist or was already decided", () => {
    expect(buyWish(vaultWith(), "ghost", at(T0)).ok).toBe(false);
    const decided = vaultWith(wish({ decision: "dropped", decidedAt: T0 }));
    expect(buyWish(decided, "w1", at(after(LONG_WAIT_MS))).ok).toBe(false);
  });
});

describe("dropWish", () => {
  it("never waits: giving a wish up is allowed immediately", () => {
    const result = dropWish(vaultWith(wish({ price: THIRTY_DAY_THRESHOLD })), "w1", at(T0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vault.wishes[0]).toMatchObject({ decision: "dropped", decidedAt: T0 });
    }
  });

  it("refuses a wish already decided", () => {
    const decided = vaultWith(wish({ decision: "bought", decidedAt: T0 }));
    expect(dropWish(decided, "w1", at(T0)).ok).toBe(false);
  });
});

describe("deleteWish", () => {
  it("removes a decided wish from the history", () => {
    const result = deleteWish(vaultWith(wish({ decision: "dropped", decidedAt: T0 })), "w1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.vault.wishes).toEqual([]);
  });

  it("refuses an open wish: it gets dropped, not erased", () => {
    expect(deleteWish(vaultWith(wish()), "w1").ok).toBe(false);
  });

  it("refuses a wish that doesn't exist", () => {
    expect(deleteWish(vaultWith(), "ghost").ok).toBe(false);
  });
});
