import { describe, expect, it } from "vitest";
import { formatDateBR, isValidISODate, localTodayISO, toLocalISODate } from "./dates";

describe("isValidISODate", () => {
  it("accepts real calendar days", () => {
    expect(isValidISODate("2026-10-07")).toBe(true);
    expect(isValidISODate("2026-01-31")).toBe(true);
    expect(isValidISODate("2026-12-31")).toBe(true);
  });

  it("knows leap years", () => {
    expect(isValidISODate("2024-02-29")).toBe(true);
    expect(isValidISODate("2026-02-29")).toBe(false);
    // Divisible by 100 but not 400: not a leap year.
    expect(isValidISODate("2100-02-29")).toBe(false);
    expect(isValidISODate("2000-02-29")).toBe(true);
  });

  it("refuses days that have the right shape but do not exist", () => {
    expect(isValidISODate("2026-02-31")).toBe(false);
    expect(isValidISODate("2026-04-31")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-00-10")).toBe(false);
    expect(isValidISODate("2026-10-00")).toBe(false);
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    for (const bad of ["", "2026-1-07", "07/10/2026", "2026-10-07T10:00", " 2026-10-07", "abcd-ef-gh"]) {
      expect(isValidISODate(bad), bad).toBe(false);
    }
  });
});

describe("toLocalISODate / localTodayISO", () => {
  it("reads the local calendar day, not the UTC one", () => {
    // 23:30 on the 31st, built from local components: whatever the machine's
    // zone, this is still the 31st locally. toISOString() would say the 1st in
    // any zone west of UTC — which is all of Brazil.
    const lateEvening = new Date(2026, 9, 31, 23, 30);
    expect(toLocalISODate(lateEvening)).toBe("2026-10-31");
    expect(localTodayISO(lateEvening)).toBe("2026-10-31");
  });

  it("is midnight-safe at the start of the day too", () => {
    expect(toLocalISODate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("pads month and day", () => {
    expect(toLocalISODate(new Date(2026, 2, 5, 12))).toBe("2026-03-05");
  });
});

describe("formatDateBR", () => {
  it("shows day, month and year the Brazilian way", () => {
    expect(formatDateBR("2026-10-07")).toBe("07/10/2026");
  });

  it("leaves something that is not an ISO date alone rather than garbling it", () => {
    expect(formatDateBR("sem data")).toBe("sem data");
  });
});
