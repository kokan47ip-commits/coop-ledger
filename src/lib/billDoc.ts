import jsPDF from "jspdf";
import { formatDate } from "./format";
import { rupeesInWords } from "./amountWords";

/** Society header block shared by the bill and the receipt documents. */
export type SocietyHeader = {
  name: string;
  address?: string;
  registrationNo?: string;
};

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
};

const FOOTER_NOTES = [
  "PLEASE PAY BY CROSSED A/C. PAYEE CHEQUE ONLY.",
  "THIS BILL IS PAYABLE ON OR BEFORE LAST DAY OF THE MONTH",
  "LATEFEES @18% WILL BE CHARGED ON OVERDUE MONTH",
];

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

/** `billPdf` without the download — the caller mails or stores the bytes. */
export function billPdfBytes(data: LegacyBillData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = 38;
  const w = W - x * 2;
  const boxTop = 30;
  const footerH = 68;
  const totalsH = 84;
  const boxBottom = H - 138;
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
    `BILL FOR THE MONTH OF ${data.periodLabel.toUpperCase()}`,
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
  doc.text("Arrears:", labelX, ty, { align: "right" });
  ink(doc, INK);
  doc.text(money(data.arrears), valX, ty, { align: "right" });
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
  let ny = footerTop + 19;
  for (const note of FOOTER_NOTES) {
    doc.text(note, x + 12, ny);
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
  stroke(doc, HAIRLINE);
  doc.setLineWidth(0.8);
  doc.setLineDashPattern([5, 4], 0);
  doc.line(x, boxBottom + 30, x + w, boxBottom + 30);
  doc.setLineDashPattern([], 0);

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
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
export function receiptPdfBytes(data: LegacyReceiptData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const x = 38;
  const w = W - x * 2;
  const bottom = drawReceiptBox(doc, data, x, 56, w);

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
 * Batch of receipts in one PDF. With `twoUp` each A4 page carries two receipt
 * boxes separated by a dashed cut line; otherwise one receipt per page.
 */
export function receiptsPdfBatch(items: ReceiptBatchItem[], filename: string, twoUp = false) {
  downloadBytes(receiptsPdfBatchBytes(items, twoUp), filename, "application/pdf");
}

/** `receiptsPdfBatch` without the download — the caller mails the bytes. */
export function receiptsPdfBatchBytes(items: ReceiptBatchItem[], twoUp = false): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const x = 38;
  const w = W - x * 2;
  const perPage = twoUp ? 2 : 1;
  const yFor = (slot: number) => (twoUp ? (slot === 0 ? 44 : 424) : 56);
  let slot = 0;
  let lastBottom = 0;
  for (const item of items) {
    if (slot >= perPage) {
      doc.addPage();
      slot = 0;
    }
    if (twoUp && slot === 1) {
      const cut = Math.round((lastBottom + yFor(1)) / 2);
      stroke(doc, HAIRLINE);
      doc.setLineWidth(0.8);
      doc.setLineDashPattern([5, 4], 0);
      doc.line(x, cut, x + w, cut);
      doc.setLineDashPattern([], 0);
    }
    lastBottom = drawReceiptBox(
      doc,
      { ...item.data, copyLabel: item.copyLabel ?? item.data.copyLabel },
      x,
      yFor(slot),
      w,
    );
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

function billHtml(data: LegacyBillData): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${esc(String(data.billNo))}</title><style>${docCss}</style></head>
<body><div class="wrap">
  ${societyHeaderHtml(data.society)}
  <div class="titlebar">BILL FOR THE MONTH OF ${esc(data.periodLabel.toUpperCase())}</div>
  <table class="meta">
    <tr><td style="color:#64748b">Bill No:</td><td><b>${esc(String(data.billNo))}</b></td><td style="text-align:right;color:#64748b">Bill Date:</td><td style="text-align:right">${formatDate(data.billDate)}</td></tr>
    <tr><td style="color:#64748b">Name:</td><td><b>${esc(data.memberName.toUpperCase())}</b>${data.memberName2 ? `<br>${esc(data.memberName2.toUpperCase())}` : ""}</td><td style="text-align:right;color:#64748b">Area :</td><td style="text-align:right">${esc(data.area ?? "")}</td></tr>
    <tr><td style="color:#64748b">Flat</td><td>${esc(data.flatNo ?? "")}</td><td style="text-align:right;color:#64748b">Due Date:</td><td style="text-align:right">${formatDate(data.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>P A R T I C U L A R S</th><th class="r">A M O U N T</th></tr></table>
  <table class="lines">
    ${data.lines.map((l, i) => `<tr><td>${l.serial ?? i + 1}.&nbsp; ${esc(l.name.toUpperCase())}</td><td class="num">${money(l.amount)}</td></tr>`).join("")}
    ${Array.from({ length: Math.max(0, 7 - data.lines.length) }, () => `<tr><td>&nbsp;</td><td></td></tr>`).join("")}
  </table>
  <table class="tot">
    <tr><td class="words" rowspan="2" style="width:52%">${esc(rupeesInWords(data.totalDue))}</td><td class="lbl">Total:</td><td class="val">${money(data.total)}</td></tr>
    <tr><td class="lbl">Arrears:</td><td class="val">${money(data.arrears)}</td></tr>
    <tr class="grand"><td></td><td class="lbl">Total Due:</td><td class="val">${money(data.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr><td style="width:50%">${FOOTER_NOTES.map(esc).join("<br>")}</td>
    <td class="sig">For ${esc(data.society.name)}<br><br><br><span class="sigspan">SECRETARY</span></td></tr>
  </table>
</div><div class="tear"></div></body></html>`;
}

export function billWord(data: LegacyBillData, filename: string): void {
  downloadDoc(billHtml(data), filename);
}

function receiptHtml(data: LegacyReceiptData): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipt ${esc(String(data.receiptNo))}</title><style>${docCss}</style></head>
<body><div class="wrap">
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
function receiptBodyInner(data: LegacyReceiptData): string {
  const full = receiptHtml(data);
  const start = full.indexOf("<body>");
  const end = full.lastIndexOf("</body>");
  if (start < 0 || end < 0) return full;
  return full.slice(start + "<body>".length, end);
}

function receiptHtmlCompact(data: LegacyReceiptData): string {
  // Strip the trailing tear line; batching adds its own separators.
  return receiptBodyInner(data).replace(/<div class="tear"><\/div>\s*$/, "");
}

export type ReceiptWordItem = { data: LegacyReceiptData; copyLabel?: string };

/** Batch of receipts in one Word document, two receipts per printed page. */
export function receiptsWordBatch(items: ReceiptWordItem[], filename: string): void {
  const blocks = items
    .map((it) => receiptHtmlCompact({ ...it.data, copyLabel: it.copyLabel ?? it.data.copyLabel }))
    .join('<div class="tear"></div>');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Receipts</title><style>${docCss}
  @page { size: A4; margin: 1cm; }
  .wrap { page-break-inside: avoid; }
</style></head>
<body>${blocks}<div class="tear"></div></body></html>`;
  downloadDoc(html, filename);
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

/** `voucherPdf` without the download — the caller mails or stores the bytes. */
export function voucherPdfBytes(data: VoucherDocData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = 38;
  const w = W - x * 2;
  const boxTop = 30;
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
  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/** Bordered legacy voucher with lines table and signature block. */
export function voucherPdf(data: VoucherDocData, filename: string) {
  downloadBytes(voucherPdfBytes(data), filename, "application/pdf");
}

function voucherHtml(data: VoucherDocData): string {
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
<body><div class="wrap">
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
