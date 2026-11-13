import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import { planImport } from "./statementImport";
import {
  TRANSFER_WINDOW_DAYS,
  acceptTransferPair,
  dismissTransferPair,
  findTransferCandidates,
} from "./transferDetection";
import type { Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const CHECKING = "acc-checking";
const SAVINGS = "acc-savings";
const CARD = "acc-card";

const expense = (
  id: string,
  date: string,
  amount: number,
  accountId = CHECKING,
): Transaction => ({
  id,
  kind: "expense",
  date,
  amount: centavos(amount),
  description: `saída ${id}`,
  accountId,
  categoryId: null,
});

const income = (
  id: string,
  date: string,
  amount: number,
  accountId = SAVINGS,
): Transaction => ({
  id,
  kind: "income",
  date,
  amount: centavos(amount),
  description: `entrada ${id}`,
  accountId,
  categoryId: null,
});

function vaultOf(
  transactions: Transaction[],
  dismissed: Vault["dismissedTransferPairs"] = [],
): Vault {
  return {
    ...emptyVault(),
    transactions,
    dismissedTransferPairs: dismissed,
  };
}

/** The candidates as "outgoing/incoming" pairs, in the order they were offered. */
const pairs = (vault: Vault) =>
  findTransferCandidates(vault).map(
    (c) => `${c.outgoing.transactionId}/${c.incoming.transactionId}`,
  );

describe("findTransferCandidates", () => {
  it("pairs an Expense with an Income of the same amount on another Account", () => {
    const vault = vaultOf([
      expense("e1", "2026-10-07", 50000),
      income("i1", "2026-10-07", 50000),
    ]);

    expect(pairs(vault)).toEqual(["e1/i1"]);
  });

  it("carries both sides and the amount, so nothing has to be looked up again", () => {
    const vault = vaultOf([
      expense("e1", "2026-10-07", 50000),
      income("i1", "2026-10-08", 50000),
    ]);

    expect(findTransferCandidates(vault)[0]).toMatchObject({
      outgoing: {
        transactionId: "e1",
        accountId: CHECKING,
        date: "2026-10-07",
        description: "saída e1",
      },
      incoming: {
        transactionId: "i1",
        accountId: SAVINGS,
        date: "2026-10-08",
        description: "entrada i1",
      },
      amount: 50000,
      daysApart: 1,
    });
  });

  it("does not pair equal amounts on the same Account", () => {
    const vault = vaultOf([
      expense("e1", "2026-10-07", 50000, CHECKING),
      income("i1", "2026-10-07", 50000, CHECKING),
    ]);

    expect(pairs(vault)).toEqual([]);
  });

  it("does not pair two Expenses or two Incomes", () => {
    expect(
      pairs(
        vaultOf([
          expense("e1", "2026-10-07", 50000, CHECKING),
          expense("e2", "2026-10-07", 50000, SAVINGS),
        ]),
      ),
    ).toEqual([]);

    expect(
      pairs(
        vaultOf([
          income("i1", "2026-10-07", 50000, CHECKING),
          income("i2", "2026-10-07", 50000, SAVINGS),
        ]),
      ),
    ).toEqual([]);
  });

  it("does not pair amounts a single centavo apart", () => {
    const vault = vaultOf([
      expense("e1", "2026-10-07", 50000),
      income("i1", "2026-10-07", 50001),
    ]);

    expect(pairs(vault)).toEqual([]);
  });

  describe("the date window", () => {
    it("pairs at exactly the edge of the window", () => {
      const vault = vaultOf([
        expense("e1", "2026-10-07", 50000),
        income("i1", "2026-10-10", 50000), // 3 days
      ]);

      expect(TRANSFER_WINDOW_DAYS).toBe(3);
      expect(pairs(vault)).toEqual(["e1/i1"]);
    });

    it("does not pair one day beyond the window", () => {
      const vault = vaultOf([
        expense("e1", "2026-10-07", 50000),
        income("i1", "2026-10-11", 50000), // 4 days
      ]);

      expect(pairs(vault)).toEqual([]);
    });

    it("works when the Income is the earlier side", () => {
      const vault = vaultOf([
        expense("e1", "2026-10-10", 50000),
        income("i1", "2026-10-07", 50000),
      ]);

      expect(pairs(vault)).toEqual(["e1/i1"]);
    });

    it("measures across a month boundary", () => {
      const vault = vaultOf([
        expense("e1", "2026-10-31", 50000),
        income("i1", "2026-11-01", 50000),
      ]);

      expect(findTransferCandidates(vault)[0].daysApart).toBe(1);
    });
  });

  describe("one pair per Transaction", () => {
    it("offers each Transaction at most once", () => {
      const vault = vaultOf([
        expense("e1", "2026-10-07", 50000),
        income("i1", "2026-10-07", 50000),
        income("i2", "2026-10-08", 50000, CARD),
      ]);

      const result = pairs(vault);
      expect(result).toHaveLength(1);
      expect(result).toEqual(["e1/i1"]);
    });

    it("gives the closest dates the pairing", () => {
      const vault = vaultOf([
        expense("e1", "2026-10-09", 50000),
        income("far", "2026-10-07", 50000),
        income("near", "2026-10-09", 50000, CARD),
      ]);

      expect(pairs(vault)).toEqual(["e1/near"]);
    });

    it("still pairs the leftovers with each other when it can", () => {
      // Two independent moves of the same amount on the same day.
      const vault = vaultOf([
        expense("e1", "2026-10-07", 50000, CHECKING),
        expense("e2", "2026-10-07", 50000, CARD),
        income("i1", "2026-10-07", 50000, SAVINGS),
        income("i2", "2026-10-07", 50000, SAVINGS),
      ]);

      expect(pairs(vault)).toHaveLength(2);
    });
  });

  it("never offers a Transfer as a side: it is already what a candidate becomes", () => {
    const transfer: Transaction = {
      id: "t1",
      kind: "transfer",
      date: "2026-10-07",
      amount: centavos(50000),
      description: "já convertida",
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
      recoveredFrom: [{ fitid: "bank-1", accountId: CHECKING }],
    };
    const vault = vaultOf([transfer, income("i1", "2026-10-07", 50000)]);

    expect(pairs(vault)).toEqual([]);
  });

  describe("dismissals", () => {
    it("never offers a pair the user dismissed", () => {
      const transactions = [
        expense("e1", "2026-10-07", 50000),
        income("i1", "2026-10-07", 50000),
      ];

      expect(pairs(vaultOf(transactions, [{ transactionIds: ["e1", "i1"] }]))).toEqual([]);
    });

    it("matches a dismissal whichever order its ids were stored in", () => {
      const transactions = [
        expense("e1", "2026-10-07", 50000),
        income("i1", "2026-10-07", 50000),
      ];

      expect(pairs(vaultOf(transactions, [{ transactionIds: ["i1", "e1"] }]))).toEqual([]);
    });

    it("leaves the other side free to pair with something else", () => {
      const vault = vaultOf(
        [
          expense("e1", "2026-10-07", 50000),
          income("i1", "2026-10-07", 50000),
          income("i2", "2026-10-08", 50000, CARD),
        ],
        [{ transactionIds: ["e1", "i1"] }],
      );

      expect(pairs(vault)).toEqual(["e1/i2"]);
    });
  });

  describe("ordering", () => {
    it("offers the closest-dated pairs first", () => {
      const vault = vaultOf([
        expense("eFar", "2026-10-01", 10000, CHECKING),
        income("iFar", "2026-10-04", 10000, SAVINGS),
        expense("eNear", "2026-10-20", 20000, CHECKING),
        income("iNear", "2026-10-20", 20000, SAVINGS),
      ]);

      expect(pairs(vault)).toEqual(["eNear/iNear", "eFar/iFar"]);
    });
  });

  describe("nothing to offer", () => {
    it("returns an empty list for a Vault with no Transactions", () => {
      expect(findTransferCandidates(emptyVault())).toEqual([]);
    });

    it("returns an empty list when no pair is possible", () => {
      const vault = vaultOf([
        expense("e1", "2026-10-07", 50000),
        income("i1", "2026-10-07", 123),
      ]);

      expect(findTransferCandidates(vault)).toEqual([]);
    });
  });

  it("is deterministic: the same Vault always yields the same offers", () => {
    const transactions = [
      expense("e1", "2026-10-07", 50000, CHECKING),
      expense("e2", "2026-10-07", 50000, CARD),
      income("i1", "2026-10-07", 50000, SAVINGS),
      income("i2", "2026-10-08", 50000, SAVINGS),
    ];
    const first = pairs(vaultOf(transactions));
    const again = pairs(vaultOf([...transactions].reverse()));

    expect(again).toEqual(first);
  });
});

describe("acceptTransferPair", () => {
  const newId = () => "tr-new";

  it("replaces the two entries with one Transfer, remembering both bank ids", () => {
    const vault = vaultOf([
      { ...expense("e1", "2026-10-07", 50000), fitid: "f-e1" } as Transaction,
      { ...income("i1", "2026-10-08", 50000), fitid: "f-i1" } as Transaction,
      expense("e-other", "2026-10-01", 123),
    ]);

    const outcome = acceptTransferPair(vault, "e1", "i1", newId);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.vault.transactions.map((tx) => tx.id)).toEqual(["e-other", "tr-new"]);
    expect(outcome.vault.transactions[1]).toMatchObject({
      kind: "transfer",
      // The Expense's date and description: the day and the words the money left with.
      date: "2026-10-07",
      description: "saída e1",
      amount: centavos(50000),
      fromAccountId: CHECKING,
      toAccountId: SAVINGS,
      recoveredFrom: [
        { fitid: "f-e1", accountId: CHECKING },
        { fitid: "f-i1", accountId: SAVINGS },
      ],
    });
  });

  it("records no recoveredFrom when neither side was imported", () => {
    const vault = vaultOf([
      expense("e1", "2026-10-07", 50000),
      income("i1", "2026-10-07", 50000),
    ]);
    const outcome = acceptTransferPair(vault, "e1", "i1", newId);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.vault.transactions[0]).not.toHaveProperty("recoveredFrom");
  });

  it("drops dismissals that named either converted entry", () => {
    const vault = vaultOf(
      [
        expense("e1", "2026-10-07", 50000),
        income("i1", "2026-10-07", 50000),
        income("i2", "2026-10-07", 50000, CARD),
      ],
      [{ transactionIds: ["e1", "i2"] }],
    );
    const outcome = acceptTransferPair(vault, "e1", "i1", newId);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.vault.dismissedTransferPairs).toEqual([]);
  });

  it("refuses a pair that is not an Expense and an Income", () => {
    const vault = vaultOf([
      expense("e1", "2026-10-07", 50000),
      expense("e2", "2026-10-07", 50000, SAVINGS),
    ]);
    expect(acceptTransferPair(vault, "e1", "e2", newId).ok).toBe(false);
  });

  it("refuses a same-account or unequal-amount pair, and a missing Transaction", () => {
    const sameAccount = vaultOf([
      expense("e1", "2026-10-07", 50000),
      income("i1", "2026-10-07", 50000, CHECKING),
    ]);
    expect(acceptTransferPair(sameAccount, "e1", "i1", newId).ok).toBe(false);

    const unequal = vaultOf([
      expense("e1", "2026-10-07", 50000),
      income("i1", "2026-10-07", 49900),
    ]);
    expect(acceptTransferPair(unequal, "e1", "i1", newId).ok).toBe(false);

    expect(acceptTransferPair(unequal, "e1", "ghost", newId).ok).toBe(false);
  });

  it("a re-import of either Statement skips the converted entries", () => {
    const vault = vaultOf([
      { ...expense("e1", "2026-10-07", 50000), fitid: "f-e1" } as Transaction,
      { ...income("i1", "2026-10-08", 50000), fitid: "f-i1" } as Transaction,
    ]);
    const outcome = acceptTransferPair(vault, "e1", "i1", newId);
    if (!outcome.ok) throw new Error(outcome.message);

    const plan = planImport(
      [{ fitid: "f-e1", trntype: "DEBIT", date: "2026-10-07", amount: -500, description: "saída e1" }],
      CHECKING,
      outcome.vault.transactions,
    );
    expect(plan.additions).toEqual([]);
    expect(plan.duplicates).toHaveLength(1);
  });
});

describe("dismissTransferPair", () => {
  it("remembers the pair so it is never offered again", () => {
    const vault = vaultOf([
      expense("e1", "2026-10-07", 50000),
      income("i1", "2026-10-07", 50000),
    ]);
    expect(pairs(vault)).toEqual(["e1/i1"]);

    const outcome = dismissTransferPair(vault, "e1", "i1");
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.vault.transactions).toBe(vault.transactions);
    expect(pairs(outcome.vault)).toEqual([]);
  });

  it("is idempotent, in either order", () => {
    const vault = vaultOf(
      [expense("e1", "2026-10-07", 50000), income("i1", "2026-10-07", 50000)],
      [{ transactionIds: ["i1", "e1"] }],
    );
    const outcome = dismissTransferPair(vault, "e1", "i1");
    expect(outcome.ok && outcome.vault).toBe(vault);
  });

  it("refuses a pair of one Transaction, or one that does not exist", () => {
    const vault = vaultOf([expense("e1", "2026-10-07", 50000)]);
    expect(dismissTransferPair(vault, "e1", "e1").ok).toBe(false);
    expect(dismissTransferPair(vault, "e1", "ghost").ok).toBe(false);
  });
});
