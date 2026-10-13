import jsPDF from "jspdf";
import { formatDate } from "./format";
import { rupeesInWords } from "./amountWords";
import { amountUpiUri, cachedQrDataUrl, qrMatrix } from "./upiQr";

/** Society header block shared by the bill and the receipt documents. */
export type SocietyHeader = {
  name: string;
  address?: string;
  registrationNo?: string;
};

/**
 * Printing layouts for member bills & receipts, selectable per society in
 * Society Profile → Accounting. "classic" is the original bordered legacy
 * document and stays the default.
 */
export type BillDocFormat = "modern" | "classic" | "slip" | "ledger";

/** Selector entries for the Society Profile format picker. */
export const BILL_DOC_FORMATS: {
  key: BillDocFormat;
  label: string;
  description: string;
}[] = [
  {
    key: "classic",
    label: "Classic (bordered)",
    description:
      "Traditional bordered bill: letterhead band, ruled particulars, arrears panel and tear line.",
  },
  {
    key: "modern",
    label: "Modern",
    description:
      "Contemporary full-page layout: left-ruled header, clean meta grid and a gold Total Due chip.",
  },
  {
    key: "slip",
    label: "Compact slip",
    description:
      "Short payment slip with a one-line member band — two fit on an A4 sheet.",
  },
  {
    key: "ledger",
    label: "Ledger (traditional)",
    description:
      "Serif, register-style document ruled like an old society counterfoil book.",
  },
];

export type LegacyBillData = {
  society: SocietyHeader;
  billNo: string;
  billDate: string;
  dueDate: string;
  /** e.g. "June,2026" */
  periodLabel: string;
  memberName: string;
  /** Second applicant / co-owner line, if present */
  memberName2?: string;
  flatNo?: string;
  area?: string;
  lines: { name: string; amount: number; serial?: string }[];
  total: number;
  arrears: number;
  /** Full amount due including arrears. */
  totalDue: number;
  paidAmount: number;
  /**
   * Optional UPI payment block: the member's pay URI (payee + flat note, no
   * amount) plus the amount to prefill — drawn as a scannable QR on the bill.
   */
  upi?: { uri: string; amount: number };
  /**
   * The society's stable late-fee / interest rate (% per month) — drives the
   * printed late-fee footer note. Falls back to the legacy 18% p.a. wording
   * when the society has not set a rate.
   */
  lateFeePercent?: number;
  /**
   * Supplementary-bill presentation: replaces the monthly period band with a
   * clear "SUPPLEMENTARY BILL" label and shows the charge category.
   */
  supplementary?: { category?: string };
  /** Printing layout chosen by the society (default "classic"). */
  format?: BillDocFormat;
  /**
   * Custom payment notes for the footer next to the UPI QR (\n-separated).
   * When set these replace the standard fixed footer notes.
   */
  qrNote?: string;
};

export type LegacyReceiptData = {
  society: SocietyHeader;
  receiptNo: string;
  receiptDate: string;
  memberName: string;
  flatNo?: string;
  amount: number;
  /** "Full" or "Part" */
  paymentKind: "full" | "part";
  /** e.g. "Maintenance for the Month June,2026" */
  purpose: string;
  mode?: string;
  reference?: string;
  /** Optional copy tag rendered top-right, e.g. "Original" / "Duplicate". */
  copyLabel?: string;
  /** Printing layout chosen by the society (default "classic"). */
  format?: BillDocFormat;
};

/**
 * The carried balance on a member's bill is usually "Arrears" — earlier unpaid
 * amounts plus the opening balance. A member with an advance / credit balance
 * carries a NEGATIVE figure: it must print as "Advance:" with its magnitude
 * (and reduce Total Due), never as a negative "Arrears" amount. Shared by the
 * full-page PDF, the compact combo box and the Word/print HTML.
 */
export function arrearsLabel(arrears: number): string {
  return arrears < 0 ? "Advance:" : "Arrears:";
}

/** Trailing-zero-free rate text: 18 → "18", 19.5 → "19.5". */
function rateText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * Footer notes for the printed bill. The late-fee line follows the society's
 * STABLE rate setting (% per month) so it never drifts with bill generation —
 * it changes only when the office edits the rate. Societies without a saved
 * rate keep the legacy 18%-per-annum wording.
 */
export function footerNotes(lateFeePercent?: number): string[] {
  const base = [
    "PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.",
    "THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH",
  ];
  if (lateFeePercent !== undefined && lateFeePercent > 0) {
    return [
      ...base,
      `LATEFEES @${rateText(lateFeePercent * 12)}% P.A. (${rateText(lateFeePercent)}% P.M.) WILL BE CHARGED ON OVERDUE MONTH`,
    ];
  }
  return [...base, "LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH"];
}

/**
 * Footer payment notes printed beside the UPI QR. The society's custom note
 * (editable in Society Profile) wins over the standard fixed wording.
 */
export function footerNotesFor(data: { qrNote?: string; lateFeePercent?: number }): string[] {
  const custom = (data.qrNote ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (custom.length) return custom;
  return footerNotes(data.lateFeePercent);
}

function money(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** "June,2026"-style month label from "YYYY-MM". */
export function periodLabelLong(period: string): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const [y, m] = period.split("-");
  return `${months[Number(m) - 1] ?? m},${y}`;
}

/**
 * Billing-cycle range label: "April,2026 – June,2026" when the bill covers
 * `months` months from its anchor period, else the plain single-month label.
 * Multi-month bills (bi-monthly/quarterly/half-yearly/yearly) show the span
 * their amount covers; monthly bills are unchanged.
 */
export function periodLabelRange(period: string, months: number): string {
  if (months <= 1) return periodLabelLong(period);
  const [y, m] = period.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + (months - 1), 1));
  const months2 = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${periodLabelLong(period)} – ${months2[end.getUTCMonth()] ?? ""},${end.getUTCFullYear()}`;
}

/* ------------------------------------------------------------------ */
/* Shared document palette — deep indigo, gold rule, tinted panels.    */
/* ------------------------------------------------------------------ */

type RGB = [number, number, number];

const INK: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];
const ACCENT: RGB = [49, 46, 129];
const TINT: RGB = [238, 242, 255];
const TINT_ALT: RGB = [248, 250, 252];
const GOLD: RGB = [180, 83, 9];
const HAIRLINE: RGB = [203, 213, 225];
const WHITE: RGB = [255, 255, 255];

function fill(doc: jsPDF, c: RGB): void {
  doc.setFillColor(c[0], c[1], c[2]);
}
function stroke(doc: jsPDF, c: RGB): void {
  doc.setDrawColor(c[0], c[1], c[2]);
}
function ink(doc: jsPDF, c: RGB): void {
  doc.setTextColor(c[0], c[1], c[2]);
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Coloured letterhead band — society name in white over the brand indigo with
 * a thin gold rule underneath. Returns the y just below that rule.
 */
function drawLetterhead(doc: jsPDF, s: SocietyHeader, x: number, w: number, top: number): number {
  const bandH = 76;
  fill(doc, ACCENT);
  doc.rect(x, top, w, bandH, "F");
  fill(doc, GOLD);
  doc.rect(x, top + bandH, w, 3, "F");

  const cx = x + w / 2;
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(s.name.toUpperCase(), cx, top + 31, { align: "center", maxWidth: w - 36 });

  ink(doc, [199, 210, 254]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  let cy = top + 47;
  for (const line of [s.registrationNo, s.address].filter(Boolean) as string[]) {
    doc.text(line, cx, cy, { align: "center", maxWidth: w - 44 });
    cy += 11;
  }
  ink(doc, INK);
  return top + bandH + 3;
}

/**
 * Draw a QR synchronously into the PDF at (x, y) — dark modules over a white
 * ground, from the shared qrMatrix helper. No preload needed.
 */
function drawQrMatrix(doc: jsPDF, payload: string, x: number, y: number, size: number): void {
  const m = qrMatrix(payload);
  const n = m.length;
  const cell = size / n;
  fill(doc, WHITE);
  doc.rect(x, y, size, size, "F");
  fill(doc, INK);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) doc.rect(x + c * cell, y + r * cell, cell + 0.2, cell + 0.2, "F");
    }
  }
}

/** Bordered legacy bill: header box, particulars, totals, notes, signature. */
export function billPdf(data: LegacyBillData, filename: string) {
  downloadBytes(billPdfBytes(data), filename, "application/pdf");
}

/** Trigger a browser download for in-memory bytes. */
function downloadBytes(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Geometry of one drawn bill box, returned to callers for stacking. */
export type BillBoxGeometry = { top: number; bottom: number };

/**
 * Draw one complete legacy bill box (letterhead → totals → notes → signature
 * → frame) at (x, y) with the box height h. `scale` (0.5–1) compresses every
 * fixed offset and font so two bills fit one A4 page; the layout logic is
 * identical at either size. Returns the box's top/bottom y.
 */
function drawBillBox(
  doc: jsPDF,
  data: LegacyBillData,
  x: number,
  top: number,
  w: number,
  h: number,
  scale: number,
): BillBoxGeometry {
  const boxTop = top;
  const boxBottom = top + h;
  const footerH = 68 * scale;
  const totalsH = 84 * scale;
  const footerTop = boxBottom - footerH;
  const totalsTop = footerTop - totalsH;
  const labelX = x + w * 0.56;
  const valX = x + w - 12;

  const afterBand = drawLetterhead(doc, data.society, x, w, boxTop);

  // Period band
  let cy = afterBand + 22;
  fill(doc, TINT);
  doc.rect(x, cy, w, 26, "F");
  ink(doc, ACCENT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(
    data.supplementary
      ? `SUPPLEMENTARY BILL${data.supplementary.category ? ` — ${data.supplementary.category.toUpperCase()}` : ""}`
      : `BILL FOR THE MONTH OF ${data.periodLabel.toUpperCase()}`,
    x + w / 2,
    cy + 17.5,
    { align: "center" },
  );
  ink(doc, INK);
  cy += 26 + 18;

  // Bill / member details panel
  const rightLabel = x + w * 0.6;
  const r1 = cy + 20;
  const r2 = r1 + 24;
  const r3 = r2 + (data.memberName2 ? 15 : 0) + 24;
  const panelH = r3 - cy + 18;
  fill(doc, TINT_ALT);
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.rect(x, cy, w, panelH, "FD");

  const field = (label: string, value: string, ry: number, bold = false): void => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    ink(doc, MUTED);
    doc.text(label, x + 12, ry);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    ink(doc, INK);
    doc.text(value, x + 66, ry, { maxWidth: rightLabel - x - 78 });
  };
  const fieldRight = (label: string, value: string, ry: number): void => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    ink(doc, MUTED);
    doc.text(label, rightLabel, ry);
    ink(doc, INK);
    doc.text(value, valX, ry, { align: "right" });
  };

  field("Bill No:", String(data.billNo), r1, true);
  fieldRight("Bill Date:", formatDate(data.billDate), r1);
  field("Name:", data.memberName.toUpperCase(), r2, true);
  if (data.memberName2) {
    doc.setFont("helvetica", "normal");
    ink(doc, INK);
    doc.text(data.memberName2.toUpperCase(), x + 66, r2 + 14, { maxWidth: rightLabel - x - 78 });
  }
  fieldRight("Area :", data.area ?? "\u2014", r2);
  field("Flat", data.flatNo ?? "\u2014", r3);
  fieldRight("Due Date:", formatDate(data.dueDate), r3);
  cy += panelH + 18;

  // Particulars — indigo header band, striped rows, filled down to the totals
  fill(doc, ACCENT);
  doc.rect(x, cy, w, 22, "F");
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("P A R T I C U L A R S", x + 12, cy + 15);
  doc.text("A M O U N T", x + w - 12, cy + 15, { align: "right" });
  ink(doc, INK);
  cy += 22;
  const tableTop = cy;

  const amountX = x + w - 122;
  const dataCount = Math.max(data.lines.length, 1);
  const rowH = Math.max(12, Math.min(17, Math.floor((totalsTop - cy) / dataCount)));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  data.lines.forEach((l, i) => {
    if (i % 2 === 1) {
      fill(doc, TINT_ALT);
      doc.rect(x, cy, w, rowH, "F");
    }
    const no = l.serial ?? String(i + 1);
    ink(doc, INK);
    doc.text(`${no}. ${l.name.toUpperCase()}`, x + 12, cy + rowH - 5, {
      maxWidth: amountX - x - 24,
    });
    doc.text(money(l.amount), x + w - 12, cy + rowH - 5, { align: "right" });
    cy += rowH;
  });
  // Filler stripes keep the sheet looking like a full, ruled bill
  for (let i = data.lines.length; cy + rowH <= totalsTop; i++) {
    if (i % 2 === 1) {
      fill(doc, TINT_ALT);
      doc.rect(x, cy, w, rowH, "F");
    }
    cy += rowH;
  }

  stroke(doc, TINT);
  doc.setLineWidth(0.6);
  doc.line(amountX, tableTop, amountX, totalsTop);
  stroke(doc, HAIRLINE);
  doc.line(x, totalsTop, x + w, totalsTop);

  // Totals
  let ty = totalsTop + 17;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.6);
  ink(doc, MUTED);
  doc.text(rupeesInWords(data.totalDue), x + 12, ty, { maxWidth: labelX - x - 30 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Total:", labelX, ty, { align: "right" });
  ink(doc, INK);
  doc.text(money(data.total), valX, ty, { align: "right" });
  ty += 17;
  ink(doc, MUTED);
  doc.text(arrearsLabel(data.arrears), labelX, ty, { align: "right" });
  ink(doc, INK);
  doc.text(money(Math.abs(data.arrears)), valX, ty, { align: "right" });
  ty += 21;
  fill(doc, ACCENT);
  doc.rect(labelX - 16, ty - 15, valX - labelX + 28, 23, "F");
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("Total Due:", labelX, ty + 1.5, { align: "right" });
  doc.text(money(data.totalDue), valX, ty + 1.5, { align: "right" });
  ink(doc, INK);
  doc.setFont("helvetica", "normal");

  // Footer — notes on the left, signature on the right
  fill(doc, TINT_ALT);
  doc.rect(x, footerTop, w, footerH, "F");
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.line(x, footerTop, x + w, footerTop);
  doc.line(x + w * 0.52, footerTop, x + w * 0.52, boxBottom);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  ink(doc, MUTED);
  // UPI QR (when configured) sits left of the payment notes in the footer.
  const upi = data.upi;
  if (upi) {
    const qrSize = 46;
    const qrX = x + 10;
    const qrY = footerTop + 8;
    drawQrMatrix(doc, amountUpiUri(upi.uri, upi.amount), qrX, qrY, qrSize);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.4);
    ink(doc, ACCENT);
    doc.text(`SCAN TO PAY RS ${money(upi.amount)}`, qrX + qrSize / 2, qrY + qrSize + 7.5, {
      align: "center",
    });
    ink(doc, MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
  }
  let ny = footerTop + 19;
  for (const note of footerNotesFor(data)) {
    doc.text(note, x + (upi ? 70 : 12), ny);
    ny += 12;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, x + w - 12, footerTop + 19, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + w * 0.62, footerTop + 42, x + w - 12, footerTop + 42);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text("SECRETARY", x + w - 12, footerTop + 54, { align: "right" });

  // Outer frame + tear line
  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x, boxTop, w, boxBottom - boxTop);

  return { top: boxTop, bottom: boxBottom };
}

/* ------------------------------------------------------------------ */
/* Printing formats - modern / slip / ledger variants                  */
/* ------------------------------------------------------------------ */

/**
 * Draw a bill box in the society's selected printing format. Every variant
 * keeps the classic box's geometry contract (returns top/bottom y) so batching
 * and stacking code is layout-independent.
 */
function drawBillBoxFor(
  doc: jsPDF,
  data: LegacyBillData,
  x: number,
  top: number,
  w: number,
  h: number,
  scale: number,
): BillBoxGeometry {
  switch (data.format ?? "classic") {
    case "modern":
      return drawBillBoxModern(doc, data, x, top, w, h);
    case "slip":
      return drawBillBoxSlip(doc, data, x, top, w, h);
    case "ledger":
      return drawBillBoxLedger(doc, data, x, top, w, h);
    default:
      return drawBillBox(doc, data, x, top, w, h, scale);
  }
}

/** Footer block shared by the modern + ledger variants: QR left, custom or
 *  standard payment notes beside it, signature on the right. */
function drawBillFooterVariant(
  doc: jsPDF,
  data: LegacyBillData,
  x: number,
  w: number,
  footerTop: number,
  boxBottom: number,
): void {
  fill(doc, TINT_ALT);
  doc.rect(x, footerTop, w, boxBottom - footerTop, "F");
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.line(x, footerTop, x + w, footerTop);
  const upi = data.upi;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  ink(doc, MUTED);
  const noteX = upi ? x + 70 : x + 12;
  if (upi) {
    const qrSize = 46;
    drawQrMatrix(doc, amountUpiUri(upi.uri, upi.amount), x + 10, footerTop + 8, qrSize);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.4);
    ink(doc, ACCENT);
    doc.text(`SCAN TO PAY RS ${money(upi.amount)}`, x + 10 + qrSize / 2, footerTop + 8 + qrSize + 7.5, {
      align: "center",
    });
    ink(doc, MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
  }
  let ny = footerTop + 19;
  for (const note of footerNotesFor(data)) {
    doc.text(note, noteX, ny);
    ny += 12;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, x + w - 12, footerTop + 19, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + w * 0.62, footerTop + 42, x + w - 12, footerTop + 42);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text("SECRETARY", x + w - 12, footerTop + 54, { align: "right" });
}

/**
 * MODERN variant: airy white document — indigo left rule beside the society
 * name, clean meta grid, no filler stripes, a gold Total Due chip and the
 * shared variant footer (UPI QR + editable notes).
 */
function drawBillBoxModern(
  doc: jsPDF,
  data: LegacyBillData,
  x: number,
  top: number,
  w: number,
  h: number,
): BillBoxGeometry {
  const boxTop = top;
  const boxBottom = top + h;
  const footerH = 68;
  const totalsTop = boxBottom - footerH;

  // Header: white field with a heavy indigo left rule
  fill(doc, WHITE);
  doc.rect(x, boxTop, w, 62, "F");
  fill(doc, ACCENT);
  doc.rect(x, boxTop, 5, 62, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  ink(doc, ACCENT);
  doc.text(data.society.name.toUpperCase(), x + 18, boxTop + 27, { maxWidth: w - 150 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  ink(doc, MUTED);
  let hy = boxTop + 40;
  for (const line of [data.society.registrationNo, data.society.address].filter(Boolean) as string[]) {
    doc.text(line, x + 18, hy, { maxWidth: w - 150 });
    hy += 10;
  }
  // Right-hand "MEMBER BILL" tag
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  ink(doc, GOLD);
  doc.text(data.supplementary ? "SUPPLEMENTARY BILL" : "MEMBER BILL", x + w - 12, boxTop + 17, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  ink(doc, INK);
  doc.text(data.periodLabel.toUpperCase(), x + w - 12, boxTop + 32, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineWidth(1);
  doc.line(x, boxTop + 62, x + w, boxTop + 62);

  // Meta grid
  let cy = boxTop + 62 + 14;
  const metaH = 54;
  fill(doc, TINT_ALT);
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.5);
  doc.rect(x, cy, w, metaH, "FD");
  const mrow = (label: string, value: string, lx: number, vx: number, ry: number, bold = false): void => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    ink(doc, MUTED);
    doc.text(label, lx, ry);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    ink(doc, INK);
    doc.text(value, vx, ry, { maxWidth: x + w - vx - 12 });
  };
  mrow("Bill No:", String(data.billNo), x + 12, x + 62, cy + 17, true);
  mrow("Bill Date:", formatDate(data.billDate), x + w * 0.4, x + w * 0.4 + 60, cy + 17);
  mrow("Due Date:", formatDate(data.dueDate), x + w * 0.72, x + w * 0.72 + 54, cy + 17);
  mrow("Name:", data.memberName.toUpperCase(), x + 12, x + 62, cy + 33, true);
  mrow("Flat:", data.flatNo ?? "-", x + w * 0.4, x + w * 0.4 + 60, cy + 33);
  mrow("Area:", data.area ?? "-", x + w * 0.72, x + w * 0.72 + 54, cy + 33);
  mrow("Payable by:", "On or before the last day of the month", x + 12, x + 62, cy + 49);
  cy += metaH + 12;

  // Charges table: slim header, zebra-free rows, right rule only
  fill(doc, ACCENT);
  doc.rect(x, cy, w, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  ink(doc, WHITE);
  doc.text("PARTICULARS", x + 12, cy + 14);
  doc.text("AMOUNT (RS)", x + w - 12, cy + 14, { align: "right" });
  ink(doc, INK);
  cy += 20;
  const amountX = x + w - 122;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const [i, l] of data.lines.entries()) {
    doc.text(`${l.serial ?? i + 1}.  ${l.name.toUpperCase()}`, x + 12, cy + 13, {
      maxWidth: amountX - x - 24,
    });
    doc.text(money(l.amount), x + w - 12, cy + 13, { align: "right" });
    cy += 16;
  }
  stroke(doc, TINT);
  doc.setLineWidth(0.6);
  doc.line(amountX, cy - data.lines.length * 16 - 4, amountX, cy - 4);
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.line(x, cy, x + w, cy);
  cy += 16;

  // Amount in words (left) + totals stack (right)
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.6);
  ink(doc, MUTED);
  doc.text(`Rupees ${rupeesInWords(data.totalDue)} only`, x + 12, cy, { maxWidth: x + w * 0.5 - x - 20 });
  const lblX = x + w * 0.55;
  const valX = x + w - 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Total:", lblX, cy, { align: "right" });
  ink(doc, INK);
  doc.text(money(data.total), valX, cy, { align: "right" });
  ink(doc, MUTED);
  doc.text(arrearsLabel(data.arrears), lblX, cy + 15, { align: "right" });
  ink(doc, INK);
  doc.text(money(Math.abs(data.arrears)), valX, cy + 15, { align: "right" });
  // Gold Total Due chip
  const chipY = cy + 26;
  fill(doc, GOLD);
  doc.rect(lblX - 16, chipY, valX - lblX + 28, 24, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  ink(doc, WHITE);
  doc.text("Total Due:", lblX, chipY + 16, { align: "right" });
  doc.text(money(data.totalDue), valX, chipY + 16, { align: "right" });

  // Footer band is the full 68pt strip at the page bottom — passing a
  // squeezed band clips the 46pt UPI QR and the signature below the frame.
  drawBillFooterVariant(doc, data, x, w, totalsTop, boxBottom);
  doc.setFont("helvetica", "normal");
  // Thin outer rule spacing the document from the sheet
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.rect(x, boxTop, w, boxBottom - boxTop);
  return { top: boxTop, bottom: boxBottom };
}

/**
 * SLIP variant: a short payment slip — single-line member band, lean charge
 * list, one total line and the QR + notes row.Keeps the same box geometry so
 * batching can still stack two slips per sheet.
 */
function drawBillBoxSlip(
  doc: jsPDF,
  data: LegacyBillData,
  x: number,
  top: number,
  w: number,
  h: number,
): BillBoxGeometry {
  const boxTop = top;
  const boxBottom = top + h;
  const footerH = 52;
  const footerTop = boxBottom - footerH;
  let cy = drawLetterhead(doc, data.society, x, w, boxTop) + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  ink(doc, ACCENT);
  doc.text(
    `${data.supplementary ? "SUPPLEMENTARY" : data.periodLabel.toUpperCase()}  |  ${String(data.billNo)}  |  ${formatDate(data.billDate)}`,
    x + 12,
    cy,
  );
  ink(doc, INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${data.memberName.toUpperCase()}  |  Flat ${data.flatNo ?? "-"}`,
    x + w - 12,
    cy,
    { align: "right" },
  );
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.line(x, cy + 6, x + w, cy + 6);
  cy += 16;

  const valX = x + w - 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const rowH = Math.max(14, Math.min(20, Math.floor((footerTop - cy - 64) / Math.max(data.lines.length, 1))));
  for (const [i, l] of data.lines.entries()) {
    doc.text(`${l.serial ?? i + 1}. ${l.name.toUpperCase()}`, x + 12, cy + rowH - 5, {
      maxWidth: x + w * 0.6 - x - 20,
    });
    doc.text(money(l.amount), valX, cy + rowH - 5, { align: "right" });
    cy += rowH;
  }
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.line(x, cy, x + w, cy);

  const ty = Math.min(cy + 18, footerTop - 50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  ink(doc, ACCENT);
  doc.text(`TOTAL DUE   ${money(data.totalDue)}`, valX, ty, { align: "right" });
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.6);
  ink(doc, MUTED);
  doc.text(rupeesInWords(data.totalDue), x + 12, ty, { maxWidth: x + w * 0.5 - x - 20 });
  if (data.arrears !== 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(
      `${arrearsLabel(data.arrears)} ${money(Math.abs(data.arrears))}`,
      x + 12,
      ty + 15,
    );
  }

  // Footer: QR + notes + a small signature, no tinted band
  const upi = data.upi;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  ink(doc, MUTED);
  if (upi) {
    drawQrMatrix(doc, amountUpiUri(upi.uri, upi.amount), x + 10, footerTop + 6, 40);
  }
  let ny = footerTop + 13;
  for (const note of footerNotesFor(data)) {
    doc.text(note, x + (upi ? 64 : 12), ny);
    ny += 11;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, valX, footerTop + 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text("SECRETARY", valX, footerTop + 34, { align: "right" });

  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x, boxTop, w, boxBottom - boxTop);
  return { top: boxTop, bottom: boxBottom };
}

/**
 * LEDGER variant: serif, counterfoil-book styling — double outer rule,
 * uppercase small type, a ruled Sr/Particulars/Amount table with the arrears
 * shown INSIDE the table as "Previous Balance", and a grand-total double rule.
 */
function drawBillBoxLedger(
  doc: jsPDF,
  data: LegacyBillData,
  x: number,
  top: number,
  w: number,
  h: number,
): BillBoxGeometry {
  const boxTop = top;
  const boxBottom = top + h;
  const footerH = 68;
  const footerTop = boxBottom - footerH;
  const valX = x + w - 12;

  // Double outer rule + serif letterhead
  stroke(doc, INK);
  doc.setLineWidth(1.4);
  doc.rect(x, boxTop, w, boxBottom - boxTop);
  doc.setLineWidth(0.5);
  doc.rect(x + 4, boxTop + 4, w - 8, boxBottom - boxTop - 8);
  doc.setFont("times", "bold");
  doc.setFontSize(16);
  ink(doc, INK);
  doc.text(data.society.name.toUpperCase(), x + w / 2, boxTop + 34, { align: "center", maxWidth: w - 40 });
  doc.setFont("times", "normal");
  doc.setFontSize(9.5);
  let cy = boxTop + 48;
  for (const line of [data.society.registrationNo, data.society.address].filter(Boolean) as string[]) {
    doc.text(line, x + w / 2, cy, { align: "center", maxWidth: w - 48 });
    cy += 12;
  }
  stroke(doc, INK);
  doc.setLineWidth(0.8);
  doc.line(x + 4, cy + 4, x + w - 4, cy + 4);
  cy += 20;

  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.text(
    data.supplementary ? "SUPPLEMENTARY BILL" : `MONTHLY MAINTENANCE BILL - ${data.periodLabel.toUpperCase()}`,
    x + w / 2,
    cy,
    { align: "center" },
  );
  cy += 8;
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.text(`Bill No: ${String(data.billNo)}`, x + 14, cy + 10);
  doc.text(`Date: ${formatDate(data.billDate)}`, x + w / 2, cy + 10, { align: "center" });
  doc.text(`Due: ${formatDate(data.dueDate)}`, valX - 2, cy + 10, { align: "right" });
  cy += 24;
  doc.text(`Member: ${data.memberName.toUpperCase()}${data.memberName2 ? ` / ${data.memberName2.toUpperCase()}` : ""}`, x + 14, cy, { maxWidth: x + w - 130 - x - 14 });
  doc.setFont("times", "bold");
  doc.text(`Flat: ${data.flatNo ?? "-"}`, valX - 2, cy, { align: "right" });
  cy += 10;
  stroke(doc, INK);
  doc.setLineWidth(0.8);
  doc.line(x + 4, cy, x + w - 4, cy);
  cy += 14;

  // Rule the ledger table: Sr | Particulars | Amount
  const tableTop = cy;
  const rows: { text: string; value: number; bold?: boolean }[] = data.lines.map((l, i) => ({
    text: `${i + 1}.  ${l.name.toUpperCase()}`,
    value: l.amount,
  }));
  if (data.arrears > 0) {
    rows.unshift({ text: "Previous Balance brought forward", value: data.arrears });
  } else if (data.arrears < 0) {
    // Member is in advance / credit — show the negative adjustment inside
    // the table so the rows still sum to TOTAL DUE (matches the classic
    // format's "Advance:" label).
    rows.push({ text: "Less: Advance / credit balance adjusted", value: data.arrears });
  }
  const rowH = 18;
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  const amountX = x + w - 110;
  for (const r of rows) {
    if (r.bold) doc.setFont("times", "bold");
    ink(doc, INK);
    doc.text(r.text, x + 14, cy + rowH - 5, { maxWidth: amountX - x - 28 });
    doc.text(money(r.value), valX - 2, cy + rowH - 5, { align: "right" });
    if (r.bold) doc.setFont("times", "normal");
    doc.line(x + 4, cy + rowH, x + w - 4, cy + rowH);
    cy += rowH;
  }
  // Grand total with double rule
  cy += 6;
  doc.setFont("times", "bold");
  doc.text("TOTAL DUE", x + 14, cy + 4);
  doc.text(money(data.totalDue), valX - 2, cy + 4, { align: "right" });
  doc.setLineWidth(1);
  doc.line(amountX - 60, cy + 8, valX - 2, cy + 8);
  doc.setLineWidth(0.5);
  doc.line(amountX - 60, cy + 10.5, valX - 2, cy + 10.5);
  cy += 22;
  doc.setFont("times", "italic");
  doc.setFontSize(9);
  ink(doc, MUTED);
  doc.text(`Rupees ${rupeesInWords(data.totalDue)} only`, x + 14, cy, { maxWidth: x + w - 150 - x - 14 });
  doc.setFont("times", "normal");
  ink(doc, INK);

  drawBillFooterVariant(doc, data, x, w, footerTop, boxBottom);
  return { top: boxTop, bottom: boxBottom };
}

/** `billPdf` without the download — the caller mails or stores the bytes. */
export function billPdfBytes(data: LegacyBillData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = 38;
  const w = W - x * 2;
  drawBillBoxFor(doc, data, x, 30, w, H - 168, 1);
  // Tear line below the bill box (single-bill layout only).
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.setLineDashPattern([5, 4], 0);
  doc.line(x, H - 138 + 30, x + w, H - 138 + 30);
  doc.setLineDashPattern([], 0);

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/* ------------------------------------------------------------------ */
/* Batch layouts — two per A4 page, and bill+receipt combos            */
/* ------------------------------------------------------------------ */

export type BillBatchItem = { data: LegacyBillData; upiPayload?: string | null };

/** Page margins in millimetres for batch exports (PDF, Word and print). */
export type PageMargins = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Extra vertical gap between the two half-page documents in 2-up layout. */
  centre: number;
};

export const DEFAULT_MARGINS: PageMargins = {
  top: 10,
  bottom: 10,
  left: 10,
  right: 10,
  centre: 8,
};

const mmToPt = (mm: number) => (Math.max(0, mm || 0) * 72) / 25.4;

/** Merge user margins over the defaults. */
function withMargins(m?: PageMargins): PageMargins {
  return { ...DEFAULT_MARGINS, ...(m ?? {}) };
}

/** A4 portrait height in mm — the page every batch export assumes. */
const A4_HEIGHT_MM = 297;

/**
 * Height of each half-page box: (A4 − top − bottom − centre) / 2 mm. Shared by
 * the Word/print engine (the PDF writers compute the same value in points).
 */
function halfPageGeometry(M: PageMargins): number {
  return (A4_HEIGHT_MM - M.top - M.bottom - M.centre) / 2;
}

/** One compact half-page receipt box (gold rule + tear line omitted). */
function drawReceiptBoxCompact(
  doc: jsPDF,
  data: LegacyReceiptData,
  x: number,
  top: number,
  w: number,
  h: number,
): number {
  const bottom = top + h;
  let cy = drawLetterheadCompact(doc, data.society, x, w, top) + 6;
  const labelX = x + w * 0.44;
  const valX = x + w - 12;

  // Title band with amount
  fill(doc, TINT);
  doc.rect(x, cy, w, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  ink(doc, ACCENT);
  doc.text("R E C E I P T", x + 12, cy + 15);
  doc.text(`Rs. ${money(data.amount)}/-`, valX, cy + 15, { align: "right" });
  ink(doc, INK);
  doc.setFont("helvetica", "normal");
  cy += 22 + 12;

  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    ink(doc, MUTED);
    doc.text(label, x + 12, cy);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    ink(doc, INK);
    doc.text(value, labelX, cy, { maxWidth: valX - labelX - 6 });
    cy += 15;
  };
  line("Receipt No.:", String(data.receiptNo), true);
  line("Receipt Date:", formatDate(data.receiptDate));
  line("Received from:", data.memberName.toUpperCase(), true);
  if (data.flatNo) line("Flat:", data.flatNo);
  line("Being payment of:", data.purpose);
  const modeTxt = [data.reference, data.mode].filter(Boolean).join(" · ");
  if (modeTxt) line("Mode / Ref:", modeTxt);
  if (data.copyLabel) line("Copy:", data.copyLabel.toUpperCase());

  // Amount in words
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.4);
  ink(doc, ACCENT);
  doc.text(rupeesInWords(data.amount), x + 12, cy + 4, { maxWidth: w - 24 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  // Signature pinned to the box foot
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, valX, bottom - 34, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + w * 0.62, bottom - 16, valX, bottom - 16);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text("SECRETARY", valX, bottom - 6, { align: "right" });

  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x, top, w, h);
  return bottom;
}

/** Compact letterhead for half-page boxes — smaller name, tighter band. */
function drawLetterheadCompact(doc: jsPDF, s: SocietyHeader, x: number, w: number, top: number): number {
  const bandH = 44;
  fill(doc, ACCENT);
  doc.rect(x, top, w, bandH, "F");
  const cx = x + w / 2;
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(s.name.toUpperCase(), cx, top + 19, { align: "center", maxWidth: w - 30 });
  const sub = [s.registrationNo, s.address].filter(Boolean).join(" · ");
  if (sub) {
    ink(doc, [199, 210, 254]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.text(sub, cx, top + 32, { align: "center", maxWidth: w - 36 });
  }
  ink(doc, INK);
  return top + bandH;
}

/** Compact half-page bill box — same fields as the full bill, tighter. */
function drawBillBoxCompact(
  doc: jsPDF,
  data: LegacyBillData,
  x: number,
  top: number,
  w: number,
  h: number,
): number {
  const bottom = top + h;
  let cy = drawLetterheadCompact(doc, data.society, x, w, top) + 6;
  const labelX = x + w * 0.5;
  const valX = x + w - 12;

  // Title band — supplementary bills carry their own clear label.
  fill(doc, TINT);
  doc.rect(x, cy, w, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  ink(doc, ACCENT);
  doc.text(
    data.supplementary
      ? `SUPPLEMENTARY BILL${data.supplementary.category ? ` — ${data.supplementary.category.toUpperCase()}` : ""}`
      : `BILL FOR ${data.periodLabel.toUpperCase()}`,
    x + 12,
    cy + 13.5,
  );
  doc.text(`Bill No. ${String(data.billNo)}`, valX, cy + 13.5, { align: "right" });
  ink(doc, INK);
  doc.setFont("helvetica", "normal");
  cy += 20 + 10;

  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    ink(doc, MUTED);
    doc.text(label, x + 12, cy);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    ink(doc, INK);
    doc.text(value, labelX, cy, { maxWidth: valX - labelX - 6 });
    cy += 14;
  };
  line("Name:", data.memberName.toUpperCase(), true);
  if (data.flatNo) line("Flat:", data.flatNo);
  line("Bill Date:", formatDate(data.billDate));
  line("Due Date:", formatDate(data.dueDate));
  cy += 2;

  // Particulars rows (charges only — arrears shown in the totals block)
  const charges = data.lines;
  const rowH = 13;
  const maxRows = Math.max(1, Math.floor((bottom - cy - 64) / rowH) - 1);
  charges.slice(0, maxRows).forEach((l, i) => {
    if (i % 2 === 1) {
      fill(doc, TINT_ALT);
      doc.rect(x + 8, cy - 2, w - 16, rowH, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    ink(doc, INK);
    doc.text(`${l.serial ?? i + 1}. ${l.name.toUpperCase()}`, x + 12, cy + 7, {
      maxWidth: labelX - x - 26,
    });
    doc.text(money(l.amount), valX, cy + 7, { align: "right" });
    cy += rowH;
  });
  if (charges.length > maxRows) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    ink(doc, MUTED);
    doc.text(`+ ${charges.length - maxRows} more head(s) — see the full bill`, x + 12, cy + 5);
    cy += rowH;
  }

  // Totals pinned to the box foot
  const totY = bottom - 66;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Total:", labelX, totY, { align: "right" });
  doc.text(money(data.total), valX, totY, { align: "right" });
  doc.text(arrearsLabel(data.arrears), labelX, totY + 13, { align: "right" });
  doc.text(money(Math.abs(data.arrears)), valX, totY + 13, { align: "right" });
  fill(doc, ACCENT);
  doc.rect(labelX - 14, totY + 19, valX - labelX + 26, 20, "F");
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Total Due:", labelX, totY + 33, { align: "right" });
  doc.text(money(data.totalDue), valX, totY + 33, { align: "right" });
  ink(doc, INK);
  doc.setFont("helvetica", "normal");

  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x, top, w, h);
  return bottom;
}

/** Compact half-page voucher box — header band, lines table, signatures. */
export function drawVoucherBoxCompact(
  doc: jsPDF,
  data: VoucherDocData,
  x: number,
  top: number,
  w: number,
  h: number,
): number {
  const bottom = top + h;
  let cy = drawLetterheadCompact(doc, data.society, x, w, top) + 6;
  const valX = x + w - 12;

  fill(doc, TINT);
  doc.rect(x, cy, w, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  ink(doc, ACCENT);
  doc.text(data.title.toUpperCase(), x + 12, cy + 13.5);
  doc.text(`No. ${data.voucherNo}`, valX, cy + 13.5, { align: "right" });
  ink(doc, INK);
  doc.setFont("helvetica", "normal");
  cy += 20 + 10;

  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    ink(doc, MUTED);
    doc.text(label, x + 12, cy);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    ink(doc, INK);
    doc.text(value, x + 92, cy, { maxWidth: valX - x - 104 });
    cy += 14;
  };
  line("Voucher Date:", formatDate(data.voucherDate));
  const partyLabel = data.title.startsWith("Payment")
    ? "Paid to"
    : data.title.startsWith("Receipt")
      ? "Received from"
      : "Party";
  if (data.party) line(`${partyLabel}:`, data.party.toUpperCase(), true);
  const chequeBits = [
    data.chequeNo ? `Cheque No.~ ${data.chequeNo}` : "",
    data.chequeDate ? `dt ${formatDate(data.chequeDate)}` : "",
    data.bankName ?? "",
    data.mode ? `Mode: ${data.mode}` : "",
  ].filter(Boolean);
  if (chequeBits.length) line("Details:", chequeBits.join(" · "));
  cy += 2;

  // Lines table with TOTAL row
  const { rows } = voucherLinesTable(data);
  const colDebit = x + w - 130;
  const colCredit = valX;
  const rowH = 13;
  const maxRows = Math.max(1, Math.floor((bottom - cy - 40) / rowH) - 1);
  rows.slice(0, maxRows).forEach((r, i) => {
    const isTotal = String(r[1]) === "TOTAL";
    if (isTotal || i % 2 === 1) {
      fill(doc, isTotal ? TINT : TINT_ALT);
      doc.rect(x + 8, cy - 2, w - 16, rowH, "F");
    }
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.setFontSize(8.8);
    ink(doc, isTotal ? ACCENT : INK);
    const noteLines = String(r[1]).split("\n");
    doc.text([String(r[0] ?? ""), noteLines[0] ?? ""].filter(Boolean).join(" "), x + 12, cy + 7, {
      maxWidth: colDebit - x - 24,
    });
    doc.text(String(r[2] ?? ""), colDebit, cy + 7, { align: "right" });
    doc.text(String(r[3] ?? ""), colCredit, cy + 7, { align: "right" });
    cy += rowH;
  });
  if (rows.length > maxRows) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    ink(doc, MUTED);
    doc.text(`+ ${rows.length - maxRows} more line(s) — see the full voucher`, x + 12, cy + 5);
    cy += rowH;
  }
  doc.setFont("helvetica", "normal");

  // Signature block pinned to the box foot
  const sigY = bottom - 30;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, valX, sigY, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + 12, sigY + 16, x + w * 0.32, sigY + 16);
  doc.line(x + w * 0.58, sigY + 16, valX, sigY + 16);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  ink(doc, MUTED);
  doc.text("Receiver's signature", x + 12, sigY + 26);
  doc.text("Authorised signatory", x + w * 0.58, sigY + 26);

  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x, top, w, h);
  return bottom;
}

/**
 * Batch of bills in one PDF. With `twoUp` each A4 page carries two compact
 * bill boxes separated by a dashed cut line; otherwise one full bill per page.
 */
export function billsPdfBatch(
  items: BillBatchItem[],
  filename: string,
  twoUp = false,
  margins?: PageMargins,
) {
  downloadBytes(billsPdfBatchBytes(items, twoUp, margins), filename, "application/pdf");
}

/** `billsPdfBatch` without the download — the caller mails or stores the bytes. */
export function billsPdfBatchBytes(
  items: BillBatchItem[],
  twoUp = false,
  margins?: PageMargins,
): Uint8Array {
  const M = withMargins(margins);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = mmToPt(M.left);
  const w = W - x - mmToPt(M.right);
  const top = mmToPt(M.top);
  const usableH = H - top - mmToPt(M.bottom);
  const gap = mmToPt(M.centre);
  // Exact halves — no minimum clamp, so the cut line is always the true
  // midpoint of the printable area (A4 + the 0-50mm UI range keeps boxH ≥ 200pt).
  const boxH = twoUp ? (usableH - gap) / 2 : usableH;
  const perPage = twoUp ? 2 : 1;
  const yFor = (slot: number) =>
    twoUp ? (slot === 0 ? top : top + usableH / 2 + gap / 2) : top;
  let slot = 0;
  for (const item of items) {
    if (slot >= perPage) {
      doc.addPage();
      slot = 0;
    }
    if (twoUp && slot === 1) {
      const cutY = top + usableH / 2;
      stroke(doc, HAIRLINE);
      doc.setLineWidth(0.8);
      doc.setLineDashPattern([5, 4], 0);
      doc.line(x, cutY, x + w, cutY);
      doc.setLineDashPattern([], 0);
    }
    if (twoUp) drawBillBoxCompact(doc, item.data, x, yFor(slot), w, boxH);
    else drawBillBoxFor(doc, item.data, x, yFor(slot), w, boxH, 1);
    slot++;
  }
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/**
 * Bill + its receipt on ONE A4 page: full-width bill box on top, its matching
 * receipt box below, separated by a dashed cut line. Both are drawn compact
 * so the pair always fits a single sheet.
 */
/** Dashed placeholder shown when a bill has no matching receipt yet. */
function drawNoReceiptPlaceholder(
  doc: jsPDF,
  bill: LegacyBillData,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.9);
  doc.setLineDashPattern([4, 4], 0);
  doc.rect(x, top, w, h);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  ink(doc, MUTED);
  doc.text("NO RECEIPT ISSUED YET", x + w / 2, top + h / 2 - 12, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(
    `No receipt has been recorded against Bill No. ${bill.billNo} (${bill.memberName}) yet.`,
    x + w / 2,
    top + h / 2 + 6,
    { align: "center", maxWidth: w - 28 },
  );
  doc.text(
    "The bill above stands on its own until a receipt is issued.",
    x + w / 2,
    top + h / 2 + 20,
    { align: "center", maxWidth: w - 28 },
  );
}

/**
 * Bill + its receipt on ONE A4 page: full-width bill box on top, its matching
 * receipt box below, separated by a dashed cut line. Bills without a receipt
 * in the window still print — the bottom half becomes a clear placeholder.
 */
export function billWithReceiptPdfBytes(
  pairs: { bill: LegacyBillData; receipt?: LegacyReceiptData }[],
  margins?: PageMargins,
): Uint8Array {
  const M = withMargins(margins);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = mmToPt(M.left);
  const w = W - x - mmToPt(M.right);
  const top = mmToPt(M.top);
  const gap = mmToPt(Math.max(M.centre, 6));
  // Exact halves — the cut line below lands on the midpoint between the top
  // and bottom margins. The 6mm gap floor keeps a visible cut when centre=0;
  // the halves stay equal because the gap straddles the midpoint.
  const half = (H - top - mmToPt(M.bottom) - gap) / 2;
  let first = true;
  for (const p of pairs) {
    if (!first) doc.addPage();
    first = false;
    drawBillBoxCompact(doc, p.bill, x, top, w, half);
    const cutY = top + half + gap / 2;
    stroke(doc, HAIRLINE);
    doc.setLineWidth(0.8);
    doc.setLineDashPattern([5, 4], 0);
    doc.line(x, cutY, x + w, cutY);
    doc.setLineDashPattern([], 0);
    if (p.receipt) drawReceiptBoxCompact(doc, p.receipt, x, top + half + gap, w, half);
    else drawNoReceiptPlaceholder(doc, p.bill, x, top + half + gap, w, half);
  }
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/** Download the bill+receipt combo PDF. */
export function billWithReceiptPdf(
  pairs: { bill: LegacyBillData; receipt?: LegacyReceiptData }[],
  filename: string,
  margins?: PageMargins,
) {
  downloadBytes(billWithReceiptPdfBytes(pairs, margins), filename, "application/pdf");
}

/** One bordered receipt box drawn at (x, y); returns the box's bottom y. */
function drawReceiptBox(doc: jsPDF, data: LegacyReceiptData, x: number, y: number, w: number): number {
  const boxTop = y;
  let cy = drawLetterhead(doc, data.society, x, w, boxTop) + 20;

  if (data.copyLabel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    ink(doc, MUTED);
    doc.text(data.copyLabel.toUpperCase(), x + w - 12, cy, { align: "right" });
    cy += 14;
  }

  // Title with a gold underline
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.5);
  ink(doc, ACCENT);
  const title = "R E C E I P T";
  doc.text(title, x + w / 2, cy + 10, { align: "center" });
  const tw = doc.getTextWidth(title);
  fill(doc, GOLD);
  doc.rect(x + w / 2 - tw / 2, cy + 15, tw, 2, "F");
  ink(doc, INK);
  cy += 30;

  // Receipt no / date band
  fill(doc, TINT);
  doc.rect(x, cy, w, 22, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  ink(doc, MUTED);
  doc.text("Receipt No.:", x + 12, cy + 15);
  ink(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.text(String(data.receiptNo), x + 84, cy + 15);
  doc.setFont("helvetica", "normal");
  ink(doc, MUTED);
  doc.text("Receipt Date:", x + w - 168, cy + 15);
  ink(doc, INK);
  doc.text(formatDate(data.receiptDate), x + w - 12, cy + 15, { align: "right" });
  cy += 22 + 24;

  // Narrative body
  let ly = cy;
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "normal");
  ink(doc, MUTED);
  doc.text("Received with thanks from", x + 16, ly);
  doc.setFont("helvetica", "bold");
  ink(doc, INK);
  doc.text(data.memberName.toUpperCase(), x + 158, ly, { maxWidth: x + w - 20 - (x + 158) });
  ly += 20;

  doc.setFont("helvetica", "normal");
  ink(doc, MUTED);
  doc.text("the sum of", x + 16, ly);
  doc.setFont("helvetica", "bold");
  ink(doc, ACCENT);
  doc.text(`Rs. ${money(data.amount)}/-`, x + 78, ly);
  doc.setFont("helvetica", "normal");
  ink(doc, MUTED);
  doc.text("in words", x + 180, ly);
  ly += 8;

  // Amount-in-words band
  fill(doc, TINT);
  doc.rect(x + 16, ly, w - 32, 20, "F");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.2);
  ink(doc, ACCENT);
  doc.text(rupeesInWords(data.amount), x + 24, ly + 13.5, { maxWidth: w - 48 });
  ly += 34;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  ink(doc, MUTED);
  doc.text("in Part/Full Payment of", x + 16, ly);
  ink(doc, INK);
  doc.text(data.purpose, x + 162, ly, { maxWidth: x + w - 20 - (x + 162) });
  ly += 20;
  ink(doc, MUTED);
  doc.text("being the charges for the Flat", x + 16, ly);
  ink(doc, INK);
  const modeTxt = [data.reference, data.mode].filter(Boolean).join(" · ");
  doc.text(
    `${data.flatNo ?? "—"}${modeTxt ? `   Cheque No.~ ${modeTxt}` : ""}`,
    x + 176,
    ly,
    { maxWidth: x + w - 20 - (x + 176) },
  );
  ly += 36;

  // Amount chip, bottom-left
  const chipW = 178;
  fill(doc, TINT);
  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x + 16, ly - 14, chipW, 30, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  ink(doc, ACCENT);
  const amtTxt = `Rs. ${money(data.amount)} /-`;
  doc.text(amtTxt, x + 16 + (chipW - doc.getTextWidth(amtTxt)) / 2, ly + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  ink(doc, MUTED);
  doc.text("*Subject to realisation of cheque(s).", x + 16, ly + 28);

  // Signature, right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, x + w - 12, ly, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + w - 168, ly + 34, x + w - 12, ly + 34);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text("SECRETARY", x + w - 12, ly + 46, { align: "right" });

  const bottom = ly + 66;
  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x, boxTop, w, bottom - boxTop);
  return bottom;
}

/** Bordered legacy receipt byte producer for emailing — no download. */
function drawReceiptBoxFor(
  doc: jsPDF,
  data: LegacyReceiptData,
  x: number,
  top: number,
  w: number,
  h: number,
): number {
  switch (data.format ?? "classic") {
    case "modern":
      return drawReceiptBoxModern(doc, data, x, top, w, h);
    case "slip":
      drawReceiptBoxCompact(doc, data, x, top, w, h);
      return top + h;
    case "ledger":
      return drawReceiptBoxLedger(doc, data, x, top, w, h);
    default:
      return drawReceiptBox(doc, data, x, top, w);
  }
}

/**
 * MODERN receipt: white document with a heavy indigo left rule, "RECEIVED"
 * tag top-right, clean narrative lines and a large right-aligned amount chip.
 */
function drawReceiptBoxModern(
  doc: jsPDF,
  data: LegacyReceiptData,
  x: number,
  top: number,
  w: number,
  h: number,
): number {
  const boxTop = top;
  const boxBottom = top + h;
  fill(doc, WHITE);
  doc.rect(x, boxTop, w, 56, "F");
  fill(doc, ACCENT);
  doc.rect(x, boxTop, 5, 56, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  ink(doc, ACCENT);
  doc.text(data.society.name.toUpperCase(), x + 18, boxTop + 25, { maxWidth: w - 150 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  ink(doc, MUTED);
  doc.text(data.society.address ?? "", x + 18, boxTop + 38, { maxWidth: w - 150 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  ink(doc, ACCENT);
  doc.text("MONEY RECEIPT", x + w - 12, boxTop + 20, { align: "right" });
  if (data.copyLabel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    ink(doc, MUTED);
    doc.text(data.copyLabel.toUpperCase(), x + w - 12, boxTop + 34, { align: "right" });
  }
  stroke(doc, HAIRLINE);
  doc.setLineWidth(1);
  doc.line(x, boxTop + 56, x + w, boxTop + 56);

  let cy = boxTop + 56 + 18;
  fill(doc, TINT_ALT);
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.5);
  doc.rect(x, cy, w, 24, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  ink(doc, MUTED);
  doc.text("Receipt No.:", x + 12, cy + 16);
  doc.setFont("helvetica", "bold");
  ink(doc, INK);
  doc.text(String(data.receiptNo), x + 78, cy + 16);
  doc.setFont("helvetica", "normal");
  ink(doc, MUTED);
  doc.text("Receipt Date:", x + w - 168, cy + 16);
  ink(doc, INK);
  doc.text(formatDate(data.receiptDate), x + w - 12, cy + 16, { align: "right" });
  cy += 24 + 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  ink(doc, MUTED);
  doc.text("Received with thanks from", x + 16, cy);
  doc.setFont("helvetica", "bold");
  ink(doc, INK);
  doc.text(data.memberName.toUpperCase(), x + 148, cy, { maxWidth: x + w - 24 - (x + 148) });
  cy += 20;
  doc.setFont("helvetica", "normal");
  ink(doc, MUTED);
  doc.text("being payment of", x + 16, cy);
  doc.setFont("helvetica", "bold");
  ink(doc, ACCENT);
  doc.text(`Rs. ${money(data.amount)} /-  (${data.paymentKind === "part" ? "Part" : "Full"})`, x + 118, cy);
  cy += 22;
  fill(doc, TINT);
  doc.rect(x + 16, cy - 4, w - 32, 22, "F");
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.2);
  ink(doc, ACCENT);
  doc.text(rupeesInWords(data.amount), x + 24, cy + 10, { maxWidth: w - 48 });
  cy += 34;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  ink(doc, MUTED);
  doc.text("towards", x + 16, cy);
  ink(doc, INK);
  doc.text(data.purpose, x + 62, cy, { maxWidth: x + w - 24 - (x + 62) });
  cy += 18;
  ink(doc, MUTED);
  doc.text("for Flat", x + 16, cy);
  ink(doc, INK);
  const modeTxt = [data.reference, data.mode].filter(Boolean).join(" \u00b7 ");
  doc.text(
    `${data.flatNo ?? "-"}${modeTxt ? `   Mode: ${modeTxt}` : ""}`,
    x + 62,
    cy,
    { maxWidth: x + w - 24 - (x + 62) },
  );
  cy += 30;

  // Amount chip bottom-left, signature right
  fill(doc, ACCENT);
  doc.rect(x + 16, cy - 8, 168, 32, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  ink(doc, WHITE);
  const amt = `Rs. ${money(data.amount)} /-`;
  doc.text(amt, x + 16 + (168 - doc.getTextWidth(amt)) / 2, cy + 11);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, x + w - 16, cy, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + w - 128, cy + 24, x + w - 16, cy + 24);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text("AUTHORIZED SIGNATORY", x + w - 16, cy + 36, { align: "right" });

  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.rect(x, boxTop, w, boxBottom - boxTop);
  return boxBottom;
}

/**
 * LEDGER receipt: serif counterfoil styling — double rule, "RECEIVED WITH
 * THANKS" wording centred, ruled narrative and a gold-stamped amount box.
 */
function drawReceiptBoxLedger(
  doc: jsPDF,
  data: LegacyReceiptData,
  x: number,
  top: number,
  w: number,
  h: number,
): number {
  const boxTop = top;
  const boxBottom = top + h;
  stroke(doc, INK);
  doc.setLineWidth(1.4);
  doc.rect(x, boxTop, w, boxBottom - boxTop);
  doc.setLineWidth(0.5);
  doc.rect(x + 4, boxTop + 4, w - 8, boxBottom - boxTop - 8);
  doc.setFont("times", "bold");
  doc.setFontSize(16);
  ink(doc, INK);
  doc.text(data.society.name.toUpperCase(), x + w / 2, boxTop + 34, { align: "center", maxWidth: w - 40 });
  doc.setFont("times", "normal");
  doc.setFontSize(9.5);
  let cy = boxTop + 48;
  for (const line of [data.society.registrationNo, data.society.address].filter(Boolean) as string[]) {
    doc.text(line, x + w / 2, cy, { align: "center", maxWidth: w - 48 });
    cy += 12;
  }
  stroke(doc, INK);
  doc.setLineWidth(0.8);
  doc.line(x + 4, cy + 4, x + w - 4, cy + 4);
  cy += 24;
  doc.setFont("times", "bold");
  doc.setFontSize(12);
  doc.text("R E C E I P T", x + w / 2, cy, { align: "center" });
  cy += 18;
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.text(`No. ${String(data.receiptNo)}`, x + 14, cy);
  doc.text(`Date: ${formatDate(data.receiptDate)}`, x + w - 14, cy, { align: "right" });
  if (data.copyLabel) {
    doc.text(data.copyLabel.toUpperCase(), x + w / 2, cy, { align: "center" });
  }
  cy += 22;
  stroke(doc, INK);
  doc.line(x + 4, cy - 10, x + w - 4, cy - 10);

  doc.text("Received with thanks from", x + 14, cy);
  doc.setFont("times", "bold");
  doc.text(`${data.memberName.toUpperCase()}${data.flatNo ? `, Flat ${data.flatNo}` : ""}`, x + 152, cy, {
    maxWidth: x + w - 24 - (x + 152),
  });
  cy += 20;
  doc.setFont("times", "normal");
  doc.text("the sum of", x + 14, cy);
  doc.setFont("times", "bold");
  ink(doc, ACCENT);
  doc.text(`Rupees ${rupeesInWords(data.amount)} only`, x + 78, cy, { maxWidth: x + w - 24 - (x + 78) });
  ink(doc, INK);
  cy += 22;
  doc.setFont("times", "normal");
  doc.text(`Rs. ${money(data.amount)} /-`, x + w - 14, cy, { align: "right" });
  cy += 14;
  stroke(doc, INK);
  doc.setLineWidth(1);
  doc.line(x + 14, cy, x + w - 14, cy);
  doc.setLineWidth(0.5);
  doc.line(x + 14, cy + 2.5, x + w - 14, cy + 2.5);
  cy += 24;
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.text(`by ${data.mode ?? "cash"}${data.reference ? `, ref. ${data.reference}` : ""}, being the charges for`, x + 14, cy);
  cy += 18;
  doc.setFont("times", "bold");
  doc.text(data.purpose, x + 14, cy, { maxWidth: x + w - 28 });
  cy += 34;

  // Gold-stamped amount box + signature
  fill(doc, GOLD);
  doc.rect(x + 16, cy - 8, 176, 34, "F");
  doc.setFont("times", "bold");
  doc.setFontSize(12);
  ink(doc, WHITE);
  const amtL = `Rs. ${money(data.amount)} /-`;
  doc.text(amtL, x + 16 + (176 - doc.getTextWidth(amtL)) / 2, cy + 12);
  ink(doc, INK);
  doc.setFont("times", "normal");
  doc.setFontSize(9.5);
  doc.text(`For ${data.society.name}`, x + w - 14, cy, { align: "right" });
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + w - 140, cy + 26, x + w - 14, cy + 26);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(9);
  doc.text("SECRETARY", x + w - 14, cy + 38, { align: "right" });

  return boxBottom;
}

export function receiptPdfBytes(data: LegacyReceiptData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = 38;
  const w = W - x * 2;
  const classic = (data.format ?? "classic") === "classic";
  const bottom = classic
    ? drawReceiptBox(doc, data, x, 56, w)
    : drawReceiptBoxFor(doc, data, x, 56, w, H - 260);

  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.setLineDashPattern([5, 4], 0);
  doc.line(x, bottom + 30, x + w, bottom + 30);
  doc.setLineDashPattern([], 0);

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/** Bordered legacy receipt with amount box and tear line. */
export function receiptPdf(data: LegacyReceiptData, filename: string) {
  downloadBytes(receiptPdfBytes(data), filename, "application/pdf");
}

export type ReceiptBatchItem = { data: LegacyReceiptData; copyLabel?: string };

/**
 * Batch of receipts in one PDF. With `twoUp` each A4 page carries two compact
 * receipt boxes separated by a dashed cut line; otherwise one receipt per page.
 */
export function receiptsPdfBatch(
  items: ReceiptBatchItem[],
  filename: string,
  twoUp = false,
  margins?: PageMargins,
) {
  downloadBytes(receiptsPdfBatchBytes(items, twoUp, margins), filename, "application/pdf");
}

/** `receiptsPdfBatch` without the download — the caller mails the bytes. */
export function receiptsPdfBatchBytes(
  items: ReceiptBatchItem[],
  twoUp = false,
  margins?: PageMargins,
): Uint8Array {
  const M = withMargins(margins);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = mmToPt(M.left);
  const w = W - x - mmToPt(M.right);
  const top = mmToPt(M.top);
  const usableH = H - top - mmToPt(M.bottom);
  const gap = mmToPt(M.centre);
  // Exact halves — no minimum clamp, so the cut line is always the true
  // midpoint of the printable area (A4 + the 0-50mm UI range keeps boxH ≥ 200pt).
  const boxH = twoUp ? (usableH - gap) / 2 : usableH;
  const perPage = twoUp ? 2 : 1;
  const yFor = (slot: number) =>
    twoUp ? (slot === 0 ? top : top + usableH / 2 + gap / 2) : top;
  let slot = 0;
  for (const item of items) {
    if (slot >= perPage) {
      doc.addPage();
      slot = 0;
    }
    if (twoUp && slot === 1) {
      const cutY = top + usableH / 2;
      stroke(doc, HAIRLINE);
      doc.setLineWidth(0.8);
      doc.setLineDashPattern([5, 4], 0);
      doc.line(x, cutY, x + w, cutY);
      doc.setLineDashPattern([], 0);
    }
    const d = { ...item.data, copyLabel: item.copyLabel ?? item.data.copyLabel };
    if (twoUp) drawReceiptBoxCompact(doc, d, x, yFor(slot), w, boxH);
    else drawReceiptBoxFor(doc, d, x, yFor(slot), w, boxH);
    slot++;
  }
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

export type VoucherBatchItem = { data: VoucherDocData };

/**
 * Batch of vouchers in one PDF. With `twoUp` each A4 page carries two compact
 * voucher boxes separated by a dashed cut line; otherwise one voucher per page.
 */
export function vouchersPdfBatch(
  items: VoucherBatchItem[],
  filename: string,
  twoUp = false,
  margins?: PageMargins,
) {
  downloadBytes(vouchersPdfBatchBytes(items, twoUp, margins), filename, "application/pdf");
}

/** `vouchersPdfBatch` without the download — the caller mails the bytes. */
export function vouchersPdfBatchBytes(
  items: VoucherBatchItem[],
  twoUp = false,
  margins?: PageMargins,
): Uint8Array {
  const M = withMargins(margins);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = mmToPt(M.left);
  const w = W - x - mmToPt(M.right);
  const top = mmToPt(M.top);
  const usableH = H - top - mmToPt(M.bottom);
  const gap = mmToPt(M.centre);
  // Exact halves — no minimum clamp, so the cut line is always the true
  // midpoint of the printable area (A4 + the 0-50mm UI range keeps boxH ≥ 200pt).
  const boxH = twoUp ? (usableH - gap) / 2 : usableH;
  const perPage = twoUp ? 2 : 1;
  const yFor = (slot: number) =>
    twoUp ? (slot === 0 ? top : top + usableH / 2 + gap / 2) : top;
  let slot = 0;
  for (const item of items) {
    if (slot >= perPage) {
      doc.addPage();
      slot = 0;
    }
    if (twoUp && slot === 1) {
      const cutY = top + usableH / 2;
      stroke(doc, HAIRLINE);
      doc.setLineWidth(0.8);
      doc.setLineDashPattern([5, 4], 0);
      doc.line(x, cutY, x + w, cutY);
      doc.setLineDashPattern([], 0);
    }
    if (twoUp) drawVoucherBoxCompact(doc, item.data, x, yFor(slot), w, boxH);
    else drawVoucherBoxFull(doc, item.data, x, yFor(slot), w);
    slot++;
  }
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/** Base64 of bytes, chunked so String.fromCharCode stays off the call limit. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x2000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    let chunk = "";
    for (let j = i; j < Math.min(i + chunkSize, bytes.length); j++) {
      chunk += String.fromCharCode(bytes[j] ?? 0);
    }
    binary += chunk;
  }
  return btoa(binary);
}

/* ------------------------------------------------------------------ */
/* Word (HTML .doc)                                                   */
/* ------------------------------------------------------------------ */

const docCss = `
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; background:#ffffff; }
  .wrap { border:1.2pt solid #312e81; border-radius:6px; margin:0 auto; max-width:720px; overflow:hidden; background:#ffffff; }
  .hdr { text-align:center; padding:16px 12px 14px; background:#312e81; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; color:#ffffff; letter-spacing:0.4pt; }
  .hdr p { font-size:8.5pt; margin:3px 0 0; color:#c7d2fe; }
  .goldrule { height:3px; background:#b45309; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; background:#eef2ff; color:#312e81; padding:7px; letter-spacing:1.5px; }
  .meta { width:100%; font-size:10pt; border-collapse:collapse; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
  .meta td { padding:5px 8px; }
  .parthead { width:100%; border-collapse:collapse; }
  .parthead th { background:#312e81; color:#ffffff; font-size:10pt; padding:7px 10px; text-align:left; letter-spacing:2px; border:0; }
  .parthead th.r { text-align:right; }
  .lines { width:100%; border-collapse:collapse; }
  .lines td { font-size:10pt; padding:5px 10px; border-bottom:1px solid #eef2ff; }
  .lines tr:nth-child(even) td { background:#f8fafc; }
  .lines td.num { text-align:right; }
  .tot { width:100%; border-collapse:collapse; border-top:1px solid #cbd5e1; }
  .tot td { font-size:10pt; padding:5px 10px; }
  .tot .words { font-style:italic; color:#64748b; font-size:9pt; }
  .tot .lbl { text-align:right; }
  .tot .val { text-align:right; width:120px; }
  .tot tr.grand td { background:#312e81; color:#ffffff; font-weight:bold; }
  .foot { width:100%; border-top:1px solid #cbd5e1; font-size:8pt; border-collapse:collapse; background:#f8fafc; }
  .foot td { padding:10px; vertical-align:top; color:#64748b; }
  .foot .sig { text-align:right; font-weight:bold; font-size:9pt; color:#312e81; }
  .foot .sigspan { font-weight:normal; color:#64748b; }
  .receipt-body { padding:18px 16px; font-size:10.5pt; line-height:1.9; }
  .wordband { background:#eef2ff; color:#312e81; font-style:italic; font-size:9.5pt; padding:5px 10px; margin:8px 0; }
  .amtbox { background:#eef2ff; border:1pt solid #312e81; color:#312e81; display:inline-block; padding:7px 16px; font-weight:bold; margin-top:14px; }
  .tear { border-bottom:2px dashed #94a3b8; margin:26px auto; max-width:720px; }
  .copytag { text-align:right; font-size:8pt; margin:6px 12px 0; color:#64748b; letter-spacing:1px; }
  table.sign { width:100%; }
  .vsig td { vertical-align:top; }
  /* Compact (half-page) variant used by 2-up batch exports. */
  .compact .hdr { padding:7px 10px 6px; }
  .compact .hdr h1 { font-size:11pt; }
  .compact .hdr p { font-size:7pt; }
  .compact .goldrule { height:2px; }
  .compact .titlebar { font-size:8.5pt; padding:4px; }
  .compact .meta td { padding:2px 8px; font-size:8.5pt; }
  .compact .parthead th { font-size:8.5pt; padding:4px 10px; }
  .compact .lines td { padding:2px 10px; font-size:8.5pt; }
  .compact .tot td { padding:2px 10px; font-size:9pt; }
  .compact .tot .val { width:100px; }
  .compact .foot td { padding:4px 10px; font-size:7pt; }
  .compact .receipt-body { padding:8px 14px; font-size:9pt; line-height:1.55; }
  .compact .amtbox { padding:4px 10px; margin-top:4px; }
  .compact .wordband { font-size:8pt; padding:3px 8px; margin:4px 0; }
  .compact .copytag { margin:2px 12px 0; font-size:7pt; }
  .compact .vhead td { padding:2px 8px; font-size:8.5pt; }
  .compact .vtable th { font-size:8.5pt; padding:4px 8px; }
  .compact .vtable td { padding:2px 8px; font-size:8.5pt; }
  .compact .words { font-size:8pt; padding:4px 10px; }
  .compact .vsig td { padding-top:14px; font-size:8pt; }
  .compact .tear { margin:8px auto; }
`;

function societyHeaderHtml(s: SocietyHeader): string {
  return `<div class="hdr">
    <h1>${esc(s.name.toUpperCase())}</h1>
    ${s.registrationNo ? `<p>${esc(s.registrationNo)}</p>` : ""}
    ${s.address ? `<p>${esc(s.address)}</p>` : ""}
  </div><div class="goldrule"></div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function billHtml(data: LegacyBillData, compact = false): string {
  // Word/print export embeds a QR only when its image was preloaded via
  // preloadQrImage() — data URLs can't be produced synchronously here.
  // `compact` drops the empty filler rows so two bills fit half a page each.
  const upi = data.upi;
  const upiPayload = upi ? amountUpiUri(upi.uri, upi.amount) : null;
  const upiImg = upiPayload ? cachedQrDataUrl(upiPayload) : null;
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${esc(String(data.billNo))}</title><style>${docCss}</style></head>
<body><div class="wrap${compact ? " compact" : ""}">
  ${societyHeaderHtml(data.society)}
  <div class="titlebar">${data.supplementary ? `SUPPLEMENTARY BILL${data.supplementary.category ? ` — ${esc(data.supplementary.category.toUpperCase())}` : ""}` : `BILL FOR THE MONTH OF ${esc(data.periodLabel.toUpperCase())}`}</div>
  <table class="meta">
    <tr><td style="color:#64748b">Bill No:</td><td><b>${esc(String(data.billNo))}</b></td><td style="text-align:right;color:#64748b">Bill Date:</td><td style="text-align:right">${formatDate(data.billDate)}</td></tr>
    <tr><td style="color:#64748b">Name:</td><td><b>${esc(data.memberName.toUpperCase())}</b>${data.memberName2 ? `<br>${esc(data.memberName2.toUpperCase())}` : ""}</td><td style="text-align:right;color:#64748b">Area :</td><td style="text-align:right">${esc(data.area ?? "")}</td></tr>
    <tr><td style="color:#64748b">Flat</td><td>${esc(data.flatNo ?? "")}</td><td style="text-align:right;color:#64748b">Due Date:</td><td style="text-align:right">${formatDate(data.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>P A R T I C U L A R S</th><th class="r">A M O U N T</th></tr></table>
  <table class="lines">
    ${data.lines.map((l, i) => `<tr><td>${l.serial ?? i + 1}.&nbsp; ${esc(l.name.toUpperCase())}</td><td class="num">${money(l.amount)}</td></tr>`).join("")}
    ${Array.from({ length: compact ? 0 : Math.max(0, 7 - data.lines.length) }, () => `<tr><td>&nbsp;</td><td></td></tr>`).join("")}
  </table>
  <table class="tot">
    <tr><td class="words" rowspan="2" style="width:52%">${esc(rupeesInWords(data.totalDue))}</td><td class="lbl">Total:</td><td class="val">${money(data.total)}</td></tr>
    <tr><td class="lbl">${arrearsLabel(data.arrears)}</td><td class="val">${money(Math.abs(data.arrears))}</td></tr>
    <tr class="grand"><td></td><td class="lbl">Total Due:</td><td class="val">${money(data.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr>
      ${upiImg && upi ? `<td style="width:66px;vertical-align:middle;text-align:center"><img src="${upiImg}" style="width:60px;height:60px" alt="UPI QR"><br><span style="font-size:6.5pt;font-weight:bold;color:#312e81">SCAN TO PAY RS ${money(upi.amount)}</span></td>` : ""}
      <td style="width:50%">${footerNotesFor(data).map(esc).join("<br>")}</td>
    <td class="sig">For ${esc(data.society.name)}<br><br><br><span class="sigspan">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`;
}

export function billWord(data: LegacyBillData, filename: string): void {
  downloadDoc(billHtml(data), filename);
}

function receiptHtml(data: LegacyReceiptData, compact = false): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${esc(String(data.receiptNo))}</title><style>${docCss}</style></head>
<body><div class="wrap${compact ? " compact" : ""}">
  ${societyHeaderHtml(data.society)}
  <div class="titlebar" style="letter-spacing:4px;">RECEIPT</div>
  ${data.copyLabel ? `<p class="copytag">${esc(data.copyLabel.toUpperCase())}</p>` : ""}
  <table class="meta">
    <tr><td style="color:#64748b">Receipt No.:</td><td><b>${esc(String(data.receiptNo))}</b></td><td style="text-align:right;color:#64748b">Receipt Date:</td><td style="text-align:right">${formatDate(data.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    <span style="color:#64748b">Received with thanks from</span> <b>${esc(data.memberName.toUpperCase())}</b><br>
    <span style="color:#64748b">the sum of</span> <b style="color:#312e81">Rs. ${money(data.amount)}/-</b> <span style="color:#64748b">in words</span>
    <div class="wordband">${esc(rupeesInWords(data.amount))}</div>
    <span style="color:#64748b">in Part/Full Payment of</span> ${esc(data.purpose)}<br>
    <span style="color:#64748b">being the charges for the Flat</span> ${esc(data.flatNo ?? "—")}${data.reference ? ` &nbsp;<b>Cheque No.~ ${esc(data.reference)}</b>` : ""}
    <table class="sign"><tr>
      <td style="vertical-align:top"><span class="amtbox">Rs. ${money(data.amount)} /-</span><br><span style="font-size:7.5pt;color:#64748b">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b style="color:#312e81">For ${esc(data.society.name)}</b><br><br><br><span style="font-weight:normal;color:#64748b">SECRETARY</span></td>
    </tr></table>
  </div>
</div><div class="tear"></div></body></html>`;
}

export function receiptWord(data: LegacyReceiptData, filename: string): void {
  downloadDoc(receiptHtml(data), filename);
}

/** Inner markup of a full receiptHtml document (the bordered block + tear line). */
function receiptBodyInner(data: LegacyReceiptData, compact = false): string {
  const full = receiptHtml(data, compact);
  const start = full.indexOf("<body>");
  const end = full.lastIndexOf("</body>");
  if (start < 0 || end < 0) return full;
  return full.slice(start + "<body>".length, end);
}

function receiptHtmlCompact(data: LegacyReceiptData): string {
  // Compact half-page variant; batching adds its own separators.
  return receiptBodyInner(data, true).replace(/<div class="tear"><\/div>\s*$/, "");
}

export type ReceiptWordItem = { data: LegacyReceiptData; copyLabel?: string };

/** Batch of receipts in one Word document, two receipts per printed page. */
export function receiptsWordBatch(
  items: ReceiptWordItem[],
  filename: string,
  margins?: PageMargins,
  /** Two compact receipts per A4 page — mirrors the PDF/print layout. */
  twoUp = false,
): void {
  const M = withMargins(margins);
  const wrapW = Math.round((210 - M.left - M.right) * 3.7795);
  const blocks = items.map((it) =>
    receiptHtmlCompact({ ...it.data, copyLabel: it.copyLabel ?? it.data.copyLabel }),
  );
  const body = twoUp
    ? joinTwoUp(blocks.map(withHalfBox), exactTear(M))
    : blocks.join('<div class="tear"></div>');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipts</title><style>${docCss}
  @page { size: A4; margin: ${M.top}mm ${M.right}mm ${M.bottom}mm ${M.left}mm; }
  body { margin: 0; }
  /* Higher specificity than the docCss copy embedded in every block — those
   * later stylesheets would otherwise win the cascade and pin the width back
   * to 720px, ignoring custom left/right margins. */
  div.wrap { page-break-inside: avoid; max-width: ${wrapW}px; }${twoUp ? twoUpPageCss(M) : ""}
</style></head>
<body>${body}</body></html>`;
  downloadDoc(html, filename);
}

/** Word page break between printed pairs (two boxes per A4). */
const WORD_PAGE_BREAK =
  '<br clear=all style="mso-special-character:line-break;page-break-before:always">';

/** Remove a block's own trailing tear divider. Bills/vouchers end with
 *  `<div class="tear"></div></body></html>`, so the pattern must cover the
 *  closing tags too — otherwise batching adds a SECOND divider at every
 *  boundary and 2-up pages pick up the extra height. */
const stripTear = (html: string) =>
  html.replace(/(<div class="tear"><\/div>\s*)(<\/body>\s*<\/html>\s*)?$/, "$2");

/** Round to 2 decimals and format as a CSS mm length. */
const r2mm = (n: number) => `${Math.round(n * 100) / 100}mm`;

/**
 * Extra CSS for 2-up / combo HTML pages (mirrors the PDF geometry): each box
 * is pinned to the exact half of the printable area and the centre divider's
 * dashed cut line sits exactly on the midpoint between the top and bottom
 * margins. Browsers (the print path) honour the heights exactly; Word may
 * still grow an over-full box, but compact content fits the half height.
 * These classes are NEW (docCss never mentions them), so no per-block
 * stylesheet copy can override them — geometry that could conflict goes
 * INLINE on the divider instead (see exactTear).
 */
function twoUpPageCss(M: PageMargins): string {
  return `\n  .halfbox { height:${r2mm(halfPageGeometry(M))}; overflow:hidden; box-sizing:border-box; }\n  .teargap { height:${r2mm(M.centre / 2)}; }\n  .tearline { border-bottom:2px dashed #94a3b8; }`;
}

/** Centre divider for exact-half pages: an empty half-gap above the dashed
 *  cut line, so the line lands on the printable area's exact midpoint.
 *  Geometry is INLINE because every document block carries its own copy of
 *  docCss, and those later stylesheets would defeat an equal-specificity
 *  wrapper rule — re-inflating the gap and pushing 2-up pages apart. */
const exactTear = (M: PageMargins) =>
  `<div class="tear" style="height:${r2mm(M.centre)};margin:0 auto;border-bottom:0">` +
  '<div class="teargap"></div><div class="tearline"></div></div>';

/** Pin a document block to its exact half-page height (2-up / combo only). */
const withHalfBox = (block: string) =>
  block.replace('<div class="wrap', '<div class="wrap halfbox');

/** Join document blocks two-per-page: a hard page break after every 2nd.
 *  `midTear` separates the two halves inside a pair — pass exactTear(M) when
 *  the page must cut at the exact midpoint of the printable area. */
function joinTwoUp(blocks: string[], midTear = '<div class="tear"></div>'): string {
  // No separator after the LAST block — it would only stack on top of a
  // wrapper-level divider (Word) or dangle at the end of the print job.
  return blocks
    .map((b, i) => {
      if (i >= blocks.length - 1) return b;
      return b + ((i + 1) % 2 === 0 ? WORD_PAGE_BREAK : midTear);
    })
    .join("");
}

function batchWordDoc(title: string, body: string, margins?: PageMargins, extraCss?: string): void {
  const M = withMargins(margins);
  const wrapW = Math.round((210 - M.left - M.right) * 3.7795);
  downloadDoc(
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(title)}</title><style>${docCss}
  @page { size: A4; margin: ${M.top}mm ${M.right}mm ${M.bottom}mm ${M.left}mm; }
  body { margin: 0; }
  /* Higher specificity than the docCss copy embedded in every block. */
  div.wrap { page-break-inside: avoid; max-width: ${wrapW}px; }${extraCss ?? ""}
</style></head>
<body>${body}</body></html>`,
    `${title}.doc`,
  );
}

/** Batch of bills in one Word document (two compact bills per page when twoUp). */
export function billsWordBatch(
  items: BillBatchItem[],
  filename: string,
  twoUp = false,
  margins?: PageMargins,
): void {
  const blocks = items.map((it) => stripTear(billHtml(it.data, twoUp)));
  batchWordDoc(
    filename,
    twoUp
      ? joinTwoUp(blocks.map(withHalfBox), exactTear(withMargins(margins)))
      : blocks.join('<div class="tear"></div>'),
    margins,
    twoUp ? twoUpPageCss(withMargins(margins)) : undefined,
  );
}

/** Batch of vouchers in one Word document (two compact vouchers per page when twoUp). */
export function vouchersWordBatch(
  items: VoucherBatchItem[],
  filename: string,
  twoUp = false,
  margins?: PageMargins,
): void {
  const blocks = items.map((it) => stripTear(voucherHtml(it.data, twoUp)));
  batchWordDoc(
    filename,
    twoUp
      ? joinTwoUp(blocks.map(withHalfBox), exactTear(withMargins(margins)))
      : blocks.join('<div class="tear"></div>'),
    margins,
    twoUp ? twoUpPageCss(withMargins(margins)) : undefined,
  );
}

/**
 * Bill + its receipt together, one compact pair per page. Bills without a
 * receipt still print — the lower half becomes a clear placeholder box.
 */
export function billWithReceiptWord(
  pairs: { bill: LegacyBillData; receipt?: LegacyReceiptData }[],
  filename: string,
  margins?: PageMargins,
): void {
  const blocks = pairs.map((p) => {
    const bill = withHalfBox(stripTear(billHtml(p.bill, true)));
    const receipt = p.receipt
      ? withHalfBox(stripTear(receiptHtml(p.receipt, true)))
      : `<div class="wrap compact halfbox" style="border-style:dashed;padding:36px 16px;text-align:center;color:#64748b;font-size:9pt">No receipt issued yet for Bill No. ${esc(String(p.bill.billNo))} — the bill above stands on its own until a receipt is recorded.</div>`;
    return `${bill}${exactTear(withMargins(margins))}${receipt}`;
  });
  batchWordDoc(filename, blocks.join(WORD_PAGE_BREAK), margins, twoUpPageCss(withMargins(margins)));
}

function downloadDoc(html: string, filename: string): void {
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Print                                                              */
/* ------------------------------------------------------------------ */

export function billPrint(data: LegacyBillData): void {
  const w = window.open("", "_blank", "width=860,height=900");
  if (!w) return;
  w.document.write(
    billHtml(data).replace(/^<html[^>]*>/, "<html>").replace(/<meta[^>]*>/, ""),
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function receiptPrint(data: LegacyReceiptData): void {
  printReceiptWindows([data]);
}

/**
 * Print receipts — two boxes per A4 page, each pair separated by a dashed cut
 * line. Pass every selected receipt in a single call so the browser produces
 * one print job with the receipts flowing two-per-page.
 */
export function printReceiptWindows(items: (LegacyReceiptData & { copyLabel?: string })[]): void {
  const blocks = items
    .map((d) => receiptHtmlCompact(d))
    .join('<div class="cutline"></div>');
  const html = `<html><head><title>Receipts</title><style>
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; background:#fff; }
  .wrap { border:1.2pt solid #312e81; border-radius:6px; margin:0 auto; max-width:700px; overflow:hidden; background:#fff; page-break-inside:avoid; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr { text-align:center; padding:16px 12px 14px; background:#312e81; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; color:#fff; letter-spacing:0.4pt; }
  .hdr p { font-size:8.5pt; margin:3px 0 0; color:#c7d2fe; }
  .goldrule { height:3px; background:#b45309; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; background:#eef2ff; color:#312e81; padding:7px; letter-spacing:4px; }
  .copytag { text-align:right; font-size:8pt; margin:4px 12px 0; color:#64748b; letter-spacing:1px; }
  .meta { width:100%; font-size:10pt; border-collapse:collapse; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
  .meta td { padding:5px 8px; }
  .receipt-body { padding:18px 16px; font-size:10.5pt; line-height:1.9; }
  .wordband { background:#eef2ff; color:#312e81; font-style:italic; font-size:9.5pt; padding:5px 10px; margin:8px 0; }
  .amtbox { background:#eef2ff; border:1pt solid #312e81; color:#312e81; display:inline-block; padding:7px 16px; font-weight:bold; margin-top:14px; }
  table.sign { width:100%; }
  .cutline { border-top:2px dashed #94a3b8; margin:8px auto; max-width:700px; }
  @media print {
    body { margin: 10mm 12mm; }
    .cutline { margin: 6mm auto; }
  }
  </style></head><body>${blocks}</body></html>`;
  const w = window.open("", "_blank", "width=860,height=700");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/* ------------------------------------------------------------------ */
/* Vouchers (Receipt / Payment / Journal)                              */
/* ------------------------------------------------------------------ */

export type VoucherLine = {
  code?: string;
  name: string;
  debit: number;
  credit: number;
  note?: string;
};

export type VoucherDocData = {
  society: SocietyHeader;
  /** "Receipt Voucher" | "Payment Voucher" | "Journal Voucher" */
  title: string;
  voucherNo: string;
  voucherDate: string;
  bookCode?: string;
  /** Paid to / Received from / member name */
  party?: string;
  mode?: string;
  reference?: string;
  /** Cheque number / UTR */
  chequeNo?: string;
  chequeDate?: string;
  bankName?: string;
  narration?: string;
  amount: number;
  lines: VoucherLine[];
};

const VOUCHER_TITLES: Record<string, string> = {
  member_receipt: "Receipt Voucher",
  other_receipt: "Receipt Voucher",
  payment: "Payment Voucher",
  journal: "Journal Voucher",
};

export function voucherTitleFor(type: string): string {
  return VOUCHER_TITLES[type] ?? "Voucher";
}

function voucherLinesTable(data: VoucherDocData): { head: string[]; rows: string[][]; totDr: number; totCr: number } {
  const head = ["Code", "Ledger / Particulars", "Debit", "Credit"];
  const rows = data.lines.map((l) => [
    l.code ?? "",
    [l.name.toUpperCase(), l.note ? `    ${l.note}` : ""].filter(Boolean).join("\n"),
    money(l.debit),
    money(l.credit),
  ]);
  const totDr = data.lines.reduce((s, l) => s + l.debit, 0);
  const totCr = data.lines.reduce((s, l) => s + l.credit, 0);
  rows.push(["", "TOTAL", money(totDr), money(totCr)]);
  return { head, rows, totDr, totCr };
}

/** Full-page bordered voucher box (letterhead, lines, words, signatures). */
function drawVoucherBoxFull(doc: jsPDF, data: VoucherDocData, x: number, top: number, w: number): void {
  const boxTop = top;
  const H = doc.internal.pageSize.getHeight();
  const boxBottom = H - 130;
  const rightLabel = x + w * 0.6;
  const valX = x + w - 12;

  const afterBand = drawLetterhead(doc, data.society, x, w, boxTop);

  // Title band
  let cy = afterBand + 22;
  fill(doc, TINT);
  doc.rect(x, cy, w, 26, "F");
  ink(doc, ACCENT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(data.title.toUpperCase(), x + w / 2, cy + 17.5, { align: "center" });
  ink(doc, INK);
  cy += 26 + 18;

  // Voucher meta panel
  const partyLabel = data.title.startsWith("Payment")
    ? "Paid to"
    : data.title.startsWith("Receipt")
      ? "Received from"
      : "Party";
  const metaLines: string[] = [];
  if (data.party) metaLines.push(`${partyLabel}: ${data.party.toUpperCase()}`);
  const chequeBits = [
    data.chequeNo ? `Cheque No.~ ${data.chequeNo}` : "",
    data.chequeDate ? `dt ${formatDate(data.chequeDate)}` : "",
    data.bankName ?? "",
  ].filter(Boolean);
  if (chequeBits.length) metaLines.push(chequeBits.join("   ·   "));
  if (data.mode) metaLines.push(`Mode: ${data.mode}`);

  const metaH = 38 + metaLines.length * 15;
  fill(doc, TINT_ALT);
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.rect(x, cy, w, metaH, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  ink(doc, MUTED);
  doc.text("Voucher No.:", x + 12, cy + 20);
  ink(doc, INK);
  doc.setFont("helvetica", "bold");
  doc.text(data.voucherNo, x + 88, cy + 20);
  doc.setFont("helvetica", "normal");
  ink(doc, MUTED);
  doc.text("Voucher Date:", rightLabel, cy + 20);
  ink(doc, INK);
  doc.text(formatDate(data.voucherDate), valX, cy + 20, { align: "right" });

  let my = cy + 38;
  for (const line of metaLines) {
    doc.setFontSize(9);
    ink(doc, MUTED);
    doc.text(line, x + 12, my, { maxWidth: w - 24 });
    my += 15;
  }
  ink(doc, INK);
  cy += metaH + 18;

  // Lines table
  const { head, rows } = voucherLinesTable(data);
  const colCode = x + 12;
  const colLedger = x + 74;
  const colDebit = x + w - 190;
  const colCredit = x + w - 12;

  fill(doc, ACCENT);
  doc.rect(x, cy, w, 22, "F");
  ink(doc, WHITE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(head[0], colCode, cy + 15);
  doc.text(head[1], colLedger, cy + 15);
  doc.text(head[2], colDebit, cy + 15, { align: "right" });
  doc.text(head[3], colCredit, cy + 15, { align: "right" });
  ink(doc, INK);
  cy += 22;
  const tableTop = cy;

  let idx = 0;
  for (const r of rows) {
    const isTotal = String(r[1]) === "TOTAL";
    const noteLines = String(r[1]).split("\n");
    const rowH = noteLines[1] ? 26 : 17;
    if (isTotal) {
      fill(doc, TINT);
      doc.rect(x, cy, w, rowH, "F");
    } else if (idx % 2 === 1) {
      fill(doc, TINT_ALT);
      doc.rect(x, cy, w, rowH, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    ink(doc, isTotal ? ACCENT : INK);
    doc.text(String(r[0] ?? ""), colCode, cy + 12);
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.text(noteLines[0] ?? "", colLedger, cy + 12, {
      maxWidth: colDebit - colLedger - 56,
    });
    if (noteLines[1]) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.4);
      ink(doc, MUTED);
      doc.text(noteLines[1].trim(), colLedger + 10, cy + 23, {
        maxWidth: colDebit - colLedger - 66,
      });
      doc.setFontSize(9.5);
    }
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    ink(doc, isTotal ? ACCENT : INK);
    doc.text(String(r[2] ?? ""), colDebit, cy + 12, { align: "right" });
    doc.text(String(r[3] ?? ""), colCredit, cy + 12, { align: "right" });
    cy += rowH;
    idx++;
  }
  const tableBottom = cy;
  ink(doc, INK);
  doc.setFont("helvetica", "normal");

  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.5);
  doc.line(colDebit - 48, tableTop, colDebit - 48, tableBottom);
  doc.line(x, tableBottom, x + w, tableBottom);

  // Amount in words band
  cy = tableBottom + 8;
  fill(doc, TINT);
  doc.rect(x, cy, w, 22, "F");
  ink(doc, ACCENT);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.5);
  doc.text(rupeesInWords(data.amount), x + 12, cy + 15, { maxWidth: w - 24 });
  ink(doc, INK);
  cy += 22 + 14;

  if (data.narration) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    ink(doc, MUTED);
    doc.text("Narration:", x + 12, cy);
    ink(doc, INK);
    doc.text(data.narration, x + 76, cy, { maxWidth: w - 96 });
  }

  // Signature block, pinned to the foot of the voucher
  const sigY = boxBottom - 68;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ink(doc, ACCENT);
  doc.text(`For ${data.society.name}`, x + w - 12, sigY, { align: "right" });
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + 12, sigY + 36, x + w * 0.32, sigY + 36);
  doc.line(x + w * 0.58, sigY + 36, x + w - 12, sigY + 36);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  ink(doc, MUTED);
  doc.text("Receiver's signature", x + 12, sigY + 48);
  doc.text("Authorised signatory", x + w * 0.58, sigY + 48);

  stroke(doc, ACCENT);
  doc.setLineWidth(1);
  doc.rect(x, boxTop, w, boxBottom - boxTop);
}

/** `voucherPdf` without the download — the caller mails or stores the bytes. */
export function voucherPdfBytes(data: VoucherDocData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const x = 38;
  const w = W - x * 2;
  drawVoucherBoxFull(doc, data, x, 30, w);
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/** Bordered legacy voucher with lines table and signature block. */
export function voucherPdf(data: VoucherDocData, filename: string) {
  downloadBytes(voucherPdfBytes(data), filename, "application/pdf");
}

function voucherHtml(data: VoucherDocData, compact = false): string {
  const partyLabel = data.title.startsWith("Payment")
    ? "Paid to"
    : data.title.startsWith("Receipt")
      ? "Received from"
      : "Party";
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(data.title)} ${esc(data.voucherNo)}</title><style>${docCss}
  .vhead { width:100%; font-size:10pt; border-collapse:collapse; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
  .vhead td { padding:6px 10px; }
  .vhead .lbl { color:#64748b; }
  .vtable { width:100%; border-collapse:collapse; margin-top:0; }
  .vtable th { background:#312e81; color:#ffffff; font-size:10pt; padding:7px 10px; text-align:left; border:0; }
  .vtable th.r { text-align:right; }
  .vtable td { font-size:10pt; padding:5px 10px; border-bottom:1px solid #eef2ff; }
  .vtable tr:nth-child(even) td { background:#f8fafc; }
  .vtable td.num { text-align:right; }
  .vtable tr.total td { font-weight:bold; background:#eef2ff; color:#312e81; border-top:1px solid #cbd5e1; }
  .words { font-size:9.5pt; font-style:italic; color:#312e81; background:#eef2ff; padding:9px 12px; }
  .vsig { width:100%; padding:10px; border-collapse:collapse; }
  .vsig td { font-size:9pt; padding-top:36px; color:#64748b; }
  .sigline { border-top:1px dotted #94a3b8; margin:0 30px; }
</style></head>
<body><div class="wrap${compact ? " compact" : ""}">
  ${societyHeaderHtml(data.society)}
  <div class="titlebar" style="letter-spacing:3px;">${esc(data.title.toUpperCase())}</div>
  <table class="vhead">
    <tr><td class="lbl">Voucher No.:</td><td><b>${esc(data.voucherNo)}</b></td><td class="lbl" style="text-align:right">Voucher Date:</td><td style="text-align:right">${formatDate(data.voucherDate)}</td></tr>
    ${data.party ? `<tr><td colspan="4" class="lbl">${esc(partyLabel)}: <b style="color:#0f172a">${esc(data.party.toUpperCase())}</b></td></tr>` : ""}
    ${data.chequeNo ? `<tr><td colspan="4" class="lbl">Cheque No.~ <b style="color:#0f172a">${esc(data.chequeNo)}</b>${data.chequeDate ? ` dt ${formatDate(data.chequeDate)}` : ""}${data.bankName ? ` · ${esc(data.bankName)}` : ""}</td></tr>` : ""}
  </table>
  <table class="vtable">
    <thead><tr><th>Code</th><th>Ledger / Particulars</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
    <tbody>
      ${data.lines.map((l) => `<tr><td>${esc(l.code ?? "")}</td><td>${esc(l.name.toUpperCase())}${l.note ? `<br><span style="font-size:8.5pt;color:#64748b">&nbsp;&nbsp;&nbsp;${esc(l.note)}</span>` : ""}</td><td class="num">${money(l.debit)}</td><td class="num">${money(l.credit)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>TOTAL</td><td class="num">${money(data.lines.reduce((s, l) => s + l.debit, 0))}</td><td class="num">${money(data.lines.reduce((s, l) => s + l.credit, 0))}</td></tr>
    </tbody>
  </table>
  <div class="words">${esc(rupeesInWords(data.amount))}</div>
  ${data.narration ? `<div style="font-size:9.5pt;color:#64748b;padding:8px 12px">Narration: ${esc(data.narration)}</div>` : ""}
  <table class="vsig">
    <tr>
      <td style="width:50%"><div class="sigline"></div><div style="margin-top:4px">Receiver's signature</div></td>
      <td style="width:50%; text-align:right"><b style="color:#312e81">For ${esc(data.society.name)}</b><div class="sigline"></div><div style="margin-top:4px">Authorised signatory</div></td>
    </tr>
  </table>
</div><div class="tear"></div></body></html>`;
}

export function voucherWord(data: VoucherDocData, filename: string): void {
  downloadDoc(voucherHtml(data), filename);
}

export function voucherPrint(data: VoucherDocData): void {
  const w = window.open("", "_blank", "width=860,height=800");
  if (!w) return;
  w.document.write(
    voucherHtml(data).replace(/^<html[^>]*>/, "<html>").replace(/<meta[^>]*>/, ""),
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/** Shared print-window helper for batch/combo documents. */
function printWindowHtml(title: string, body: string, margins?: PageMargins, extraCss?: string) {
  const M = withMargins(margins);
  const wrapW = Math.round((210 - M.left - M.right) * 3.7795);
  const w = window.open("", "_blank", "width=860,height=900");
  if (!w) return;
  w.document.write(
    `<html><head><title>${esc(title)}</title><style>${docCss}
  @page { size: A4; margin: ${M.top}mm ${M.right}mm ${M.bottom}mm ${M.left}mm; }
  body { margin: 0; }
  /* Higher specificity than the docCss copy embedded in every block. */
  div.wrap { page-break-inside: avoid; max-width: ${wrapW}px; }${extraCss ?? ""}
  .tear { border-bottom:2px dashed #94a3b8; margin:14px auto; max-width:${wrapW}px; }
  </style></head><body>${body}</body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/** Print a batch of bills (two compact bills per A4 page when twoUp). */
export function billsPrintBatch(items: BillBatchItem[], twoUp = false, margins?: PageMargins): void {
  const blocks = items.map((it) => stripTear(billHtml(it.data, twoUp)));
  printWindowHtml(
    "Bills",
    twoUp
      ? joinTwoUp(blocks.map(withHalfBox), exactTear(withMargins(margins)))
      : blocks.join('<div class="tear"></div>'),
    margins,
    twoUp ? twoUpPageCss(withMargins(margins)) : undefined,
  );
}

/** Print a batch of receipts (two per A4 page when twoUp). */
export function receiptsPrintBatch(items: ReceiptBatchItem[], twoUp = false, margins?: PageMargins): void {
  const blocks = items.map((it) =>
    receiptHtmlCompact({ ...it.data, copyLabel: it.copyLabel ?? it.data.copyLabel }),
  );
  printWindowHtml(
    "Receipts",
    twoUp
      ? joinTwoUp(blocks.map(withHalfBox), exactTear(withMargins(margins)))
      : blocks.join('<div class="tear"></div>'),
    margins,
    twoUp ? twoUpPageCss(withMargins(margins)) : undefined,
  );
}

/** Print a batch of vouchers (two compact vouchers per A4 page when twoUp). */
export function vouchersPrintBatch(items: VoucherBatchItem[], twoUp = false, margins?: PageMargins): void {
  const blocks = items.map((it) => stripTear(voucherHtml(it.data, twoUp)));
  printWindowHtml(
    "Vouchers",
    twoUp
      ? joinTwoUp(blocks.map(withHalfBox), exactTear(withMargins(margins)))
      : blocks.join('<div class="tear"></div>'),
    margins,
    twoUp ? twoUpPageCss(withMargins(margins)) : undefined,
  );
}

/** Print bill + receipt pairs — one compact combo (bill above receipt) per
 *  page. Bills without a receipt print with a clear placeholder below. */
export function billWithReceiptPrint(
  pairs: { bill: LegacyBillData; receipt?: LegacyReceiptData }[],
  margins?: PageMargins,
): void {
  const blocks = pairs.map((p) => {
    const bill = withHalfBox(stripTear(billHtml(p.bill, true)));
    const receipt = p.receipt
      ? withHalfBox(stripTear(receiptHtml(p.receipt, true)))
      : `<div class="wrap compact halfbox" style="border-style:dashed;padding:36px 16px;text-align:center;color:#64748b;font-size:9pt">No receipt issued yet for Bill No. ${esc(String(p.bill.billNo))} — the bill above stands on its own until a receipt is recorded.</div>`;
    return `${bill}${exactTear(withMargins(margins))}${receipt}`;
  });
  printWindowHtml(
    "Bills with Receipts",
    blocks.join('<div style="page-break-before:always"></div>'),
    margins,
    twoUpPageCss(withMargins(margins)),
  );
}
