# Finance Compass

A local-first personal-finance tracker. The user logs money as it moves and the app tells them where they stand and whether they're on track. Everything is built on the Transaction; budgeting and account balances are layered on top.

## Language

**Vault**:
The folder on the user's own machine where all their financial data lives as plain files. The user owns it, can inspect it, move it, and back it up themselves (the Obsidian model). The app reads and writes a Vault; it never holds the only copy.
_Avoid_: Database, workspace, profile

**Transaction**:
A single record of money moving on a given date. Every Transaction is exactly one of three kinds — Income, Expense, or Transfer.
_Avoid_: Entry, record, movement, posting

**Income**:
A Transaction that brings money into an Account, classified by an income Category (e.g. Salary).

**Expense**:
A Transaction that takes money out of an Account, classified by an expense Category (e.g. Groceries).

**Transfer**:
A Transaction that moves money between two of the user's own Accounts (a source and a destination). It carries no spending Category and never counts as Income or Expense, so it stays out of budget and category totals.
_Avoid_: Payment, move

**Account**:
A place the user's money sits (e.g. checking, savings, cash, credit card). An Account has a name, a type, and an opening balance; its current balance is always *derived* from the opening balance plus its Transactions, never stored or edited directly.
_Avoid_: Wallet, ledger, source

**Category**:
A label for what an Income or Expense Transaction was for (e.g. Groceries, Salary, Rent). Income and expense Categories are kept separate. Transfers have no Category.
_Avoid_: Tag, label, bucket

**Uncategorized**:
The state of an Income or Expense Transaction that has no Category yet. Every imported Transaction starts uncategorized until the user classifies it. It is the absence of a Category, not a Category named "uncategorized", so uncategorized money is counted in Account balances but in no Category total or Budget.

**Group**:
A named collection of Categories (e.g. "Food" containing "Groceries" and "Restaurants"). Categories are organised two levels deep: Group → Category, no deeper.
_Avoid_: Parent category, folder

**Budget**:
A monthly spending limit set for a single expense Category (e.g. Groceries = R$800/month). The app compares the calendar month's actual Expenses in that Category against the limit. Unspent amounts do not roll over to the next month.
_Avoid_: Allowance, cap, envelope

## Importing

**Statement**:
A file the user exports from their own bank or card (e.g. OFX or CSV) listing that account's recent transactions. Finance Compass reads a Statement; it never connects to the bank directly.
_Avoid_: Feed, sync, export

**Import**:
The act, and the record, of turning one Statement into Transactions within a single Account. An Import skips entries that are already present so re-importing an overlapping Statement creates no duplicates.
_Avoid_: Sync, upload, ingest

## Recovering Transfers

A Statement describes one Account, so it can never say that money leaving it arrived in another Account the user also owns. An Import therefore produces only Income and Expense, and the Transfers hidden among them are recovered afterwards (ADR-0006).

**Candidate pair**:
Two imported entries the app believes are the two sides of one Transfer — an Expense on one Account and an Income on another, for the same amount, a few days apart. It is a suggestion, not a change: a candidate pair is offered to the user, who accepts or dismisses it, and nothing is ever converted on its own.
_Avoid_: Match, suggestion, detected transfer

**Dismissed**:
The state of a candidate pair the user has said no to. A dismissed pair is never offered again, so working through the list makes progress. Dismissing changes no Transaction.

**Recovered from**:
The imported entries a Transfer was built out of, each remembered as the bank's own id and the Account it was imported on. A Transfer recovered from a candidate pair has two; one marked from a single entry has one; a Transfer the user typed in has none, because it came from no Statement. This is what stops a later Import from re-adding entries that have already been converted.
_Avoid_: Sources (a Transfer's *source* is its origin Account), origins

**Marking**:
Naming, by hand, the Account on the other side of a single imported entry, which turns that entry into a Transfer. Needed when only one leg was ever imported — money moving to somewhere no Statement covers — so no candidate pair can exist. The entry is *replaced*, not kept alongside the Transfer, and its direction comes from its own sign rather than from the user. Marking is the one conversion that moves a balance: the chosen Account was not tracking that money before.
_Avoid_: Linking, assigning, converting to transfer

**Undoing a marking**:
Turning a Transfer back into the single imported entry it was recovered from, with that entry's bank id restored so a later Import still skips it. The entry comes back Uncategorized, since a Transfer had nowhere to keep a Category. A Transfer the user typed in has nothing to undo.
_Avoid_: Unmarking, reverting, rollback
