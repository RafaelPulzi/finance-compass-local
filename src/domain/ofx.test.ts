import { describe, expect, it } from "vitest";
import { parseOfx, parseOfxAmount, parseOfxDate } from "./ofx";

/** OFX 1.0.2 SGML, the shape Brazilian banks usually export: no closing tags on leaf elements. */
const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>260
<ACCTID>1234567-8
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260105120000[-3:BRT]
<TRNAMT>-49.90
<FITID>202601050001
<MEMO>MERCADO SAO JOAO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260110
<TRNAMT>5000.00
<FITID>202601100002
<MEMO>SALARIO
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

/** OFX 2.x is well-formed XML with closing tags. */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <CCSTMTRS>
        <CURDEF>BRL</CURDEF>
        <CCACCTFROM><ACCTID>4111********1111</ACCTID></CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20260201</DTSTART>
          <DTEND>20260228</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260214</DTPOSTED>
            <TRNAMT>-120.45</TRNAMT>
            <FITID>CC-77</FITID>
            <NAME>PADARIA P&amp;A</NAME>
            <MEMO>PARCELA 1/3</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`;

describe("parseOfxAmount", () => {
  it("parses plain OFX amounts to signed centavos", () => {
    expect(parseOfxAmount("-49.90")).toBe(-4990);
    expect(parseOfxAmount("5000.00")).toBe(500000);
    expect(parseOfxAmount("0")).toBe(0);
    expect(parseOfxAmount("-0.01")).toBe(-1);
    expect(parseOfxAmount("+12.3")).toBe(1230);
  });

  it("handles thousands separators in either convention", () => {
    expect(parseOfxAmount("1.234,56")).toBe(123456);
    expect(parseOfxAmount("1,234.56")).toBe(123456);
    expect(parseOfxAmount("-1.234,56")).toBe(-123456);
  });

  it("rounds half-up when a file carries more than two decimals", () => {
    expect(parseOfxAmount("12.345")).toBe(1235);
    expect(parseOfxAmount("12.344")).toBe(1234);
  });

  it("is exact where floats are not", () => {
    // 841.35 * 100 in floating point is 84134.99999999999
    expect(parseOfxAmount("841.35")).toBe(84135);
  });

  it("rejects junk", () => {
    expect(() => parseOfxAmount("abc")).toThrow();
    expect(() => parseOfxAmount("")).toThrow();
  });
});

describe("parseOfxDate", () => {
  it("takes the date part, ignoring time and timezone", () => {
    expect(parseOfxDate("20260105")).toBe("2026-01-05");
    expect(parseOfxDate("20260105120000[-3:BRT]")).toBe("2026-01-05");
  });

  it("rejects impossible dates", () => {
    expect(() => parseOfxDate("20261305")).toThrow();
    expect(() => parseOfxDate("nope")).toThrow();
  });
});

describe("parseOfx (SGML, unclosed leaf tags)", () => {
  const statement = parseOfx(SGML);

  it("reads every transaction", () => {
    expect(statement.entries).toHaveLength(2);
    expect(statement.malformed).toBe(0);
  });

  it("keeps the sign, which is what decides expense vs income", () => {
    expect(statement.entries[0]).toMatchObject({
      fitid: "202601050001",
      date: "2026-01-05",
      amount: -4990,
      description: "MERCADO SAO JOAO",
    });
    expect(statement.entries[1].amount).toBe(500000);
  });

  it("reads the statement's account, currency and period", () => {
    expect(statement.acctId).toBe("1234567-8");
    expect(statement.currency).toBe("BRL");
    expect(statement.periodStart).toBe("2026-01-01");
    expect(statement.periodEnd).toBe("2026-01-31");
  });
});

describe("parseOfx (XML 2.x, credit card)", () => {
  const statement = parseOfx(XML);

  it("reads closed tags and decodes entities", () => {
    expect(statement.entries).toHaveLength(1);
    expect(statement.entries[0]).toMatchObject({
      fitid: "CC-77",
      date: "2026-02-14",
      amount: -12045,
    });
    // NAME and MEMO both carry information, so both are kept.
    expect(statement.entries[0].description).toBe("PADARIA P&A · PARCELA 1/3");
  });

  it("reads the credit card account id", () => {
    expect(statement.acctId).toBe("4111********1111");
  });
});

describe("parseOfx error handling", () => {
  it("counts unreadable entries instead of silently dropping them", () => {
    const broken = `<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260105<TRNAMT>-10.00</STMTTRN>
<STMTTRN><FITID>ok-1<DTPOSTED>20260106<TRNAMT>-11.00</STMTTRN>
</BANKTRANLIST></OFX>`;
    const statement = parseOfx(broken);
    expect(statement.entries).toHaveLength(1); // the one with a FITID
    expect(statement.malformed).toBe(1); // the one without
  });

  it("accepts a valid OFX file with no transactions", () => {
    expect(parseOfx("<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>").entries).toEqual([]);
  });

  it("rejects a file that isn't OFX at all", () => {
    expect(() => parseOfx("date,amount\n2026-01-01,10")).toThrow();
  });
});
