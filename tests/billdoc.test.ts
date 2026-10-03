/**
 * Printing Hub batch-export tests (bun:test, run with `bun test tests/`).
 *
 * Guards the four Printing Hub bug fixes:
 *  - page geometry of the PDF batch writers under custom page margins
 *    (one-up / two-up / extreme margins must never change the page count),
 *  - exactly ONE separator between consecutive documents in Word/print
 *    output (a dead stripTear used to stack two dashed dividers per
 *    boundary, pushing 2-up batches onto extra pages),
 *  - the combo bill+receipt layout printing every month bill, with a
 *    "no receipt issued yet" placeholder instead of dropping the bill.
 *
 * Not part of the vite build (tsconfig.app includes only src/); run via bun.
 *
 * DOM shims: Word/print exports hand a Blob (via URL.createObjectURL) or an
 * HTML string (via window.open) to the browser. We shim document/window to
 * capture them. `window` must NOT exist when billDoc is imported — jsPDF
 * picks its browser build then and crashes on atob — so the window shim is
 * installed only inside the print tests.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  DEFAULT_MARGINS,
  billWithReceiptPdfBytes,
  billWithReceiptPrint,
  billWithReceiptWord,
  billsPdfBatchBytes,
  billsPrintBatch,
  billsWordBatch,
  receiptsPdfBatchBytes,
  receiptsPrintBatch,
  receiptsWordBatch,
  vouchersPdfBatchBytes,
  vouchersPrintBatch,
  vouchersWordBatch,
  type LegacyBillData,
  type LegacyReceiptData,
  type PageMargins,
  type VoucherDocData,
} from "../src/lib/billDoc";

/* ------------------------------- fixtures -------------------------------- */

const society = { name: "Test Co-op Society", address: "Plot 1, Test Road" };

const makeBill = (no: string): LegacyBillData => ({
  society,
  billNo: no,
  billDate: "2026-04-01",
  dueDate: "2026-04-10",
  periodLabel: "April,2026",
  memberName: "Test Member",
  flatNo: "A-1",
  lines: [{ name: "Maintenance", amount: 500, serial: "1" }],
  total: 500,
  arrears: 0,
  totalDue: 500,
  paidAmount: 0,
});

const makeReceipt = (): LegacyReceiptData => ({
  society,
  receiptNo: "R-1",
  receiptDate: "2026-04-05",
  memberName: "Test Member",
  flatNo: "A-1",
  amount: 500,
  paymentKind: "full",
  purpose: "Maintenance for April,2026",
  mode: "UPI",
  copyLabel: "Original",
});

const makeVoucher = (no: string): VoucherDocData => ({
  society,
  title: "Payment Voucher",
  voucherNo: no,
  voucherDate: "2026-04-05",
  amount: 500,
  lines: [{ name: "Electricity charges", debit: 500, credit: 0 }],
});

const billItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ data: makeBill(`BILL-${i + 1}`) }));
const receiptItems = (n: number) =>
  Array.from({ length: n }, () => ({ data: makeReceipt(), copyLabel: "Original" }));
const voucherItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ data: makeVoucher(`VCH-${i + 1}`) }));

/** jsPDF page count (uncompressed output → page objects are readable). */
const pageCount = (bytes: Uint8Array): number =>
  (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page[^s]/g) ?? []).length;

const EXTREME: PageMargins = { top: 50, bottom: 50, left: 50, right: 50, centre: 50 };
const ZERO: PageMargins = { top: 0, bottom: 0, left: 0, right: 0, centre: 0 };

/* ----------------------------- capture shims ----------------------------- */

let lastBlob: Blob | null = null;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;

globalThis.document = {
  createElement: () => ({ href: "", download: "", click() {} }),
  body: { appendChild() {}, removeChild() {} },
} as unknown as Document;
URL.createObjectURL = ((blob: Blob) => {
  lastBlob = blob;
  return "blob:test";
}) as typeof URL.createObjectURL;
URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

/** Take the Word document captured by the last *WordBatch export. */
async function takeWordHtml(): Promise<string> {
  const blob = lastBlob;
  lastBlob = null;
  if (!blob) throw new Error("no Word document captured");
  return blob.text();
}

/** Install a print-window shim; returns a getter for the written HTML. */
function installPrintWindow(): () => string {
  let html = "";
  (globalThis as { window?: unknown }).window = {
    open: () => ({
      document: {
        write: (h: string) => {
          html = h;
        },
        close() {},
      },
      focus() {},
      print() {},
    }),
  };
  return () => html;
}

afterAll(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
});

/* ------------------------------ assertions ------------------------------- */

const tears = (html: string) => (html.match(/<div class="tear">/g) ?? []).length;
const pageBreaks = (html: string) => (html.match(/page-break-before/g) ?? []).length;
const doubleTears = (html: string) =>
  (html.match(/<div class="tear"><\/div>\s*<div class="tear"><\/div>/g) ?? []).length;

/** y coordinate (PDF space, from page bottom) of every dashed cut line —
 *  jsPDF writes the pattern as `[5. 4.] 0. d` right before the line op. */
const cutLines = (bytes: Uint8Array): number[] => {
  const s = new TextDecoder("latin1").decode(bytes);
  const out: number[] = [];
  const re = /\[5\. 4\.\]\s*0\.\s*d\s+([\d.]+) ([\d.]+) m\s+[\d.]+ \2 l\s+S/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(parseFloat(m[2] as string));
  return out;
};

const MM_PT = 72 / 25.4;
const A4_H_PT = 297 * MM_PT;
/** Expected cut-line y: the midpoint BETWEEN the top and bottom margins. */
const expectedCutY = (M: PageMargins): number =>
  A4_H_PT - MM_PT * (M.top + (297 - M.top - M.bottom) / 2);

/** First `height:` (mm) declared for a CSS class in the captured HTML. */
const cssHeight = (html: string, cls: string): number | null => {
  const m = html.match(new RegExp(`\\.${cls} \\{ height:([\\d.]+)mm`));
  return m ? parseFloat(m[1] as string) : null;
};

/* --------------------------------- tests --------------------------------- */

describe("PDF batch page geometry", () => {
  test("default margins: one page per doc, two docs per page when twoUp", () => {
    for (const n of [1, 2, 3, 5]) {
      expect(pageCount(billsPdfBatchBytes(billItems(n), false))).toBe(n);
      expect(pageCount(billsPdfBatchBytes(billItems(n), true))).toBe(Math.ceil(n / 2));
    }
    expect(pageCount(receiptsPdfBatchBytes(receiptItems(4), true))).toBe(2);
    expect(pageCount(vouchersPdfBatchBytes(voucherItems(3), true))).toBe(2);
    expect(pageCount(vouchersPdfBatchBytes(voucherItems(2), false))).toBe(2);
  });

  test("extreme and zero margins never change the page count", () => {
    for (const margins of [EXTREME, ZERO]) {
      expect(pageCount(billsPdfBatchBytes(billItems(2), false, margins))).toBe(2);
      expect(pageCount(billsPdfBatchBytes(billItems(4), true, margins))).toBe(2);
      expect(pageCount(receiptsPdfBatchBytes(receiptItems(4), true, margins))).toBe(2);
    }
  });

  test("partial margins merge over the defaults instead of throwing", () => {
    expect(pageCount(billsPdfBatchBytes(billItems(1), false, { top: 20 } as PageMargins))).toBe(1);
  });

  test("defaults stay A4-friendly (10mm edges, 8mm centre gap)", () => {
    expect(DEFAULT_MARGINS).toEqual({ top: 10, bottom: 10, left: 10, right: 10, centre: 8 });
  });

  test("two-up cut line sits exactly halfway between top and bottom margins", () => {
    const cases: PageMargins[] = [
      DEFAULT_MARGINS,
      EXTREME,
      ZERO,
      { top: 20, bottom: 12, centre: 12 } as PageMargins, // partial merge
    ];
    for (const margins of cases) {
      const M = { ...DEFAULT_MARGINS, ...margins };
      for (const bytes of [
        billsPdfBatchBytes(billItems(2), true, margins),
        receiptsPdfBatchBytes(receiptItems(2), true, margins),
        vouchersPdfBatchBytes(voucherItems(2), true, margins),
      ]) {
        const lines = cutLines(bytes);
        expect(lines.length).toBe(1);
        expect(Math.abs(lines[0]! - expectedCutY(M))).toBeLessThan(0.5);
      }
    }
  });

  test("combo PDF cut line lands on the exact midpoint too", () => {
    const margins = { top: 20, bottom: 15, centre: 10 } as PageMargins;
    const M = { ...DEFAULT_MARGINS, ...margins };
    const pairs = [
      { bill: makeBill("BILL-1"), receipt: makeReceipt() },
      { bill: makeBill("BILL-2") },
    ];
    const lines = cutLines(billWithReceiptPdfBytes(pairs, margins));
    expect(lines.length).toBe(2); // one cut per pair-page
    for (const y of lines) expect(Math.abs(y - expectedCutY(M))).toBeLessThan(0.5);
  });
});

describe("combo bill + receipt PDF", () => {
  const pairs = [
    { bill: makeBill("BILL-1"), receipt: makeReceipt() },
    { bill: makeBill("BILL-2") }, // no receipt → placeholder, bill still prints
  ];

  test("every bill prints — one page per pair, receipt or placeholder", () => {
    expect(pageCount(billWithReceiptPdfBytes(pairs))).toBe(pairs.length);
    expect(pageCount(billWithReceiptPdfBytes(pairs, EXTREME))).toBe(pairs.length);
  });

  test("the receipt-less pair carries the visible placeholder notice", () => {
    const text = new TextDecoder("latin1").decode(billWithReceiptPdfBytes(pairs));
    expect(text).toContain("NO RECEIPT ISSUED YET");
    expect(text).toContain("BILL-2");
  });
});

describe("Word/print separators (no doubled cut lines)", () => {
  test("bills Word: exactly one separator per boundary, none after the last", async () => {
    billsWordBatch(billItems(2), "bills", false);
    let html = await takeWordHtml();
    expect(tears(html)).toBe(1); // n-1 separators
    expect(pageBreaks(html)).toBe(0);
    expect(doubleTears(html)).toBe(0);

    billsWordBatch(billItems(4), "bills", true);
    html = await takeWordHtml();
    expect(tears(html) + pageBreaks(html)).toBe(3); // n-1 separators
    expect(pageBreaks(html)).toBe(1); // pairs are cut at the page break
    expect(doubleTears(html)).toBe(0);
  });

  test("vouchers Word mirrors bills", async () => {
    vouchersWordBatch(voucherItems(3), "vouchers", false);
    const html = await takeWordHtml();
    expect(tears(html)).toBe(2);
    expect(doubleTears(html)).toBe(0);
  });

  test("receipts Word: 3-arg legacy call still works; twoUp honours the layout", async () => {
    receiptsWordBatch(receiptItems(2), "receipts"); // VoucherList's 2-arg call
    let html = await takeWordHtml();
    expect(tears(html)).toBe(1);

    receiptsWordBatch(receiptItems(4), "receipts", EXTREME, true);
    html = await takeWordHtml();
    expect(tears(html) + pageBreaks(html)).toBe(3);
    expect(pageBreaks(html)).toBe(1);
    expect(doubleTears(html)).toBe(0);
    expect(html).toContain("50mm"); // margins land in @page
  });

  test("print output matches Word separator-for-separator", () => {
    const read = installPrintWindow();
    billsPrintBatch(billItems(2), false);
    expect(tears(read())).toBe(1);
    billsPrintBatch(billItems(4), true);
    const html = read();
    expect(tears(html) + pageBreaks(html)).toBe(3);
    expect(doubleTears(html)).toBe(0);
  });

  test("combo Word/print: placeholder text present, no doubled dividers", async () => {
    const pairs = [
      { bill: makeBill("BILL-1"), receipt: makeReceipt() },
      { bill: makeBill("BILL-2") },
    ];
    billWithReceiptWord(pairs, "combo");
    let html = await takeWordHtml();
    expect(html).toContain("No receipt issued yet");
    expect(doubleTears(html)).toBe(0);
    expect(pageBreaks(html)).toBe(1); // one break between the two pairs

    const read = installPrintWindow();
    billWithReceiptPrint(pairs);
    html = read();
    expect(html).toContain("No receipt issued yet");
    expect(doubleTears(html)).toBe(0);
    expect(pageBreaks(html)).toBe(1);
  });
});

describe("exact half-page centre split (Word/print)", () => {
  const halfH = (M: PageMargins) => (297 - M.top - M.bottom - M.centre) / 2;

  test("bills Word two-up pins each box to the exact half and centres the cut", async () => {
    billsWordBatch(billItems(4), "bills", true);
    const html = await takeWordHtml();
    expect(cssHeight(html, "halfbox")).toBeCloseTo(halfH(DEFAULT_MARGINS), 1); // 134.5mm
    expect(cssHeight(html, "teargap")).toBeCloseTo(DEFAULT_MARGINS.centre / 2, 1);
    // one exact tear per complete pair (n=4 → 2 mid-tears) + the per-box pin
    expect((html.match(/<div class="tear"><div class="teargap">/g) ?? []).length).toBe(2);
    expect((html.match(/class="wrap halfbox compact"/g) ?? []).length).toBe(4);
    expect(html).toContain("tearline"); // dashed cut inside the centre gap
  });

  test("receipts Word two-up honours custom margins (top/bottom/centre)", async () => {
    const margins = { top: 20, bottom: 15, centre: 10 } as PageMargins;
    receiptsWordBatch(receiptItems(4), "receipts", margins, true);
    const html = await takeWordHtml();
    expect(cssHeight(html, "halfbox")).toBeCloseTo(halfH(margins), 1); // 126mm
    expect(cssHeight(html, "teargap")).toBeCloseTo(5, 1);
  });

  test("one-up Word stays free-flowing (no half pins)", async () => {
    billsWordBatch(billItems(2), "bills", false);
    const html = await takeWordHtml();
    expect(html).not.toContain("halfbox");
    expect(html).not.toContain("teargap");
    expect(html).not.toContain("tearline");
    expect(tears(html)).toBe(1); // plain separator
  });

  test("print two-up mirrors the Word exact-half geometry", () => {
    const read = installPrintWindow();
    billsPrintBatch(billItems(4), true);
    const html = read();
    expect(cssHeight(html, "halfbox")).toBeCloseTo(halfH(DEFAULT_MARGINS), 1);
    expect((html.match(/<div class="tear"><div class="teargap">/g) ?? []).length).toBe(2);
    expect((html.match(/<div class="tearline"><\/div>/g) ?? []).length).toBe(2);
    receiptsPrintBatch(receiptItems(2), true);
    expect(read()).toContain("halfbox");
    vouchersPrintBatch(voucherItems(2), true);
    expect(read()).toContain("tearline");
  });

  test("combo Word/print: each half pinned, exact tear between bill and receipt", async () => {
    const pairs = [
      { bill: makeBill("BILL-1"), receipt: makeReceipt() },
      { bill: makeBill("BILL-2") },
    ];
    billWithReceiptWord(pairs, "combo");
    let html = await takeWordHtml();
    expect(cssHeight(html, "halfbox")).toBeCloseTo(halfH(DEFAULT_MARGINS), 1);
    expect((html.match(/<div class="tear"><div class="teargap">/g) ?? []).length).toBe(2);
    expect(html).toContain("No receipt issued yet");

    const read = installPrintWindow();
    billWithReceiptPrint(pairs);
    html = read();
    expect(cssHeight(html, "halfbox")).toBeCloseTo(halfH(DEFAULT_MARGINS), 1);
    expect((html.match(/<div class="tear"><div class="teargap">/g) ?? []).length).toBe(2);
  });
});
