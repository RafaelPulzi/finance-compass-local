// The `/vitest` entry point also augments Vitest's `Assertion` type with the
// jest-dom matchers, so `toBeInTheDocument` and friends typecheck as well as run.
import "@testing-library/jest-dom/vitest";
