import { describe, expect, it } from "vitest";
import { decodeOfxBytes, parseOfx, parseOfxAmount, parseOfxDate } from "./ofx";

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

describe("decodeOfxBytes", () => {
  const HEADER_1252 = "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nENCODING:USASCII\nCHARSET:1252\n\n";

  /** Bytes for an SGML statement whose header claims 1252, with a body in `encoding`. */
  function statementBytes(memo: string, encoding: "utf-8" | "windows-1252"): ArrayBuffer {
    const body = `<OFX><STMTTRN><FITID>1<DTPOSTED>20260105<TRNAMT>-1.00<MEMO>${memo}</STMTTRN></OFX>`;
    const encoded =
      encoding === "utf-8"
        ? new TextEncoder().encode(HEADER_1252 + body)
        : // Every character used here is in latin1, where 1252 and charCode agree.
          Uint8Array.from(HEADER_1252 + body, (ch) => ch.charCodeAt(0));
    return encoded.buffer as ArrayBuffer;
  }

  it("decodes a file that really is windows-1252, as declared", () => {
    const text = decodeOfxBytes(statementBytes("SÃO PAULO ALIMENTAÇÃO", "windows-1252"));
    expect(text).toContain("SÃO PAULO ALIMENTAÇÃO");
  });

  it("decodes UTF-8 bytes correctly even when the header claims 1252", () => {
    // Seen in a real bank export: CHARSET:1252 in the header, UTF-8 in the body.
    // Trusting the header produced "SÃ£O" for every accented description.
    const text = decodeOfxBytes(statementBytes("SÃO PAULO ALIMENTAÇÃO ÚNICO", "utf-8"));
    expect(text).toContain("SÃO PAULO ALIMENTAÇÃO ÚNICO");
    expect(text).not.toMatch(/Ã£|Ã§|Ãº/);
  });

  it("leaves a pure-ASCII 1252 file unchanged", () => {
    expect(decodeOfxBytes(statementBytes("PADARIA", "windows-1252"))).toContain("PADARIA");
  });
});

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

describe("decodeOfxBytes when the header is missing or wrong the other way", () => {
  /** windows-1252 bytes; every character used is in latin1, where 1252 and charCode agree. */
  const latin1 = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0)).buffer as ArrayBuffer;

  it("reads windows-1252 accents in a file that declares no charset at all", () => {
    // Without a CHARSET line the default was UTF-8, and every "Ç" became U+FFFD.
    const text = decodeOfxBytes(
      latin1("<OFX><STMTTRN><FITID>1<DTPOSTED>20260105<TRNAMT>-1.00<MEMO>AÇOUGUE SÃO JOÃO</STMTTRN></OFX>"),
    );
    expect(text).toContain("AÇOUGUE SÃO JOÃO");
    expect(text).not.toContain("�");
  });

  it("reads windows-1252 accents in a file that wrongly claims UTF-8", () => {
    const text = decodeOfxBytes(
      latin1("OFXHEADER:100\nENCODING:UTF-8\n\n<OFX><STMTTRN><MEMO>FARMÁCIA</STMTTRN></OFX>"),
    );
    expect(text).toContain("FARMÁCIA");
  });

  it("still reads real UTF-8 with no header as UTF-8", () => {
    const bytes = new TextEncoder().encode("<OFX><MEMO>PÃO DE AÇÚCAR</OFX>");
    expect(decodeOfxBytes(bytes.buffer as ArrayBuffer)).toContain("PÃO DE AÇÚCAR");
  });
});

describe("parseOfx robustness", () => {
  const one = (fields: string) =>
    `<OFX><BANKTRANLIST><STMTTRN>${fields}</STMTTRN></BANKTRANLIST></OFX>`;

  it("counts an entry dated on a day that does not exist as unreadable", () => {
    const statement = parseOfx(one("<FITID>x<DTPOSTED>20260231<TRNAMT>-5.00"));
    expect(statement.entries).toHaveLength(0);
    expect(statement.malformed).toBe(1);
  });

  it("decodes hexadecimal character references", () => {
    const statement = parseOfx(one("<FITID>x<DTPOSTED>20260105<TRNAMT>-5.00<MEMO>CAF&#xC9; &#233;"));
    expect(statement.entries[0].description).toBe("CAFÉ é");
  });

  it("keeps an out-of-range character reference as text instead of failing the whole file", () => {
    const statement = parseOfx(
      one("<FITID>x<DTPOSTED>20260105<TRNAMT>-5.00<MEMO>LOJA &#99999999; CENTRO"),
    );
    expect(statement.entries).toHaveLength(1);
    expect(statement.entries[0].description).toBe("LOJA &#99999999; CENTRO");
  });

  it("does not double-decode an escaped ampersand", () => {
    const statement = parseOfx(one("<FITID>x<DTPOSTED>20260105<TRNAMT>-5.00<MEMO>A &amp;lt; B"));
    expect(statement.entries[0].description).toBe("A &lt; B");
  });

  it("joins NAME and MEMO, and does not repeat them when the bank sends the same text twice", () => {
    const both = parseOfx(one("<FITID>x<DTPOSTED>20260105<TRNAMT>-5.00<NAME>UBER<MEMO>VIAGEM"));
    expect(both.entries[0].description).toBe("UBER · VIAGEM");
    const same = parseOfx(one("<FITID>x<DTPOSTED>20260105<TRNAMT>-5.00<NAME>UBER<MEMO>UBER"));
    expect(same.entries[0].description).toBe("UBER");
  });

  it("reads a statement whose last STMTTRN has no closing tag", () => {
    const text = `<OFX><BANKTRANLIST>
<STMTTRN><FITID>a<DTPOSTED>20260105<TRNAMT>-1.00
<STMTTRN><FITID>b<DTPOSTED>20260106<TRNAMT>2.00
</BANKTRANLIST></OFX>`;
    const statement = parseOfx(text);
    expect(statement.entries.map((e) => [e.fitid, e.amount])).toEqual([
      ["a", -100],
      ["b", 200],
    ]);
  });

  it("handles a large statement quickly and exactly", () => {
    // Two years of a busy account is a few thousand entries; the total must be exact.
    const blocks: string[] = [];
    let expected = 0;
    for (let i = 0; i < 5000; i++) {
      const cents = ((i * 37) % 100000) - 50000;
      expected += cents;
      const amount = `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
      blocks.push(`<STMTTRN><FITID>F${i}<DTPOSTED>2026${String((i % 12) + 1).padStart(2, "0")}15<TRNAMT>${amount}<MEMO>ITEM ${i}</STMTTRN>`);
    }
    const started = performance.now();
    const statement = parseOfx(`<OFX><BANKTRANLIST>${blocks.join("\n")}</BANKTRANLIST></OFX>`);
    const elapsed = performance.now() - started;

    expect(statement.entries).toHaveLength(5000);
    expect(statement.malformed).toBe(0);
    expect(statement.entries.reduce((sum, e) => sum + e.amount, 0)).toBe(expected);
    // Generous on purpose: this guards against accidental quadratic parsing, not machine speed.
    expect(elapsed).toBeLessThan(5000);
  });
});
