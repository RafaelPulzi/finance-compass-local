# Money stored as integer centavos

All monetary values are stored and computed as **integer centavos** (R$ 12,34 is `1234`), never as floating-point reais. JavaScript floats cannot represent decimal currency exactly (`0.1 + 0.2 === 0.30000000000000004`), and the errors accumulate across many transactions into balances and budget totals that are visibly wrong — unacceptable in a finance app where users notice and lose trust. Values are formatted to "R$ 12,34" with `Intl.NumberFormat('pt-BR')` only at display time.

## Consequences

- A future reader seeing `1234` in the JSON or code should read it as centavos, not an error.
- All arithmetic (balances, budget sums) is integer math; conversion to/from reais happens only at the UI boundary.
