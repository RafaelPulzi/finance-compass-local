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
