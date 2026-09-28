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

function headerLines(s: SocietyHeader): string[] {
  return [s.name, s.registrationNo ?? "", s.address ?? ""].filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

function drawSocietyHeader(doc: jsPDF, s: SocietyHeader, y: number): number {
  const w = doc.internal.pageSize.getWidth();
  const lines = headerLines(s);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(lines[0], w / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let cy = y + 14;
  for (const l of lines.slice(1)) {
    doc.text(l, w / 2, cy, { align: "center" });
    cy += 12;
  }
  return cy;
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
  const x = 40;
  const w = W - x * 2;
  const boxTop = 44;

  let cy = drawSocietyHeader(doc, data.society, boxTop + 20);
  cy += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Bill for the Month of ${data.periodLabel}`, W / 2, cy, { align: "center" });
  cy += 14;
  doc.setDrawColor(60);
  doc.setLineWidth(0.8);
  doc.line(x, cy, x + w, cy);
  cy += 16;

  const rightCol = x + w * 0.62;
  const boldName = (s: string) => s;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Bill No:", x + 6, cy);
  doc.setFont("helvetica", "bold");
  doc.text(boldName(String(data.billNo)), x + 70, cy);
  doc.setFont("helvetica", "normal");
  doc.text("Bill Date:", rightCol, cy);
  doc.text(formatDate(data.billDate), rightCol + 60, cy);
  cy += 16;
  doc.text("Name:", x + 6, cy);
  doc.setFont("helvetica", "bold");
  doc.text(data.memberName.toUpperCase(), x + 70, cy);
  if (data.memberName2) {
    cy += 14;
    doc.setFont("helvetica", "normal");
    doc.text(data.memberName2.toUpperCase(), x + 70, cy);
  }
  doc.setFont("helvetica", "normal");
  doc.text("Area :", rightCol, cy - (data.memberName2 ? 14 : 0));
  if (data.area) doc.text(data.area, rightCol + 60, cy - (data.memberName2 ? 14 : 0));
  cy += 16;
  doc.text("Flat", x + 6, cy);
  doc.text(data.flatNo ?? "", x + 70, cy);
  doc.text("Due Date:", rightCol, cy);
  doc.text(formatDate(data.dueDate), rightCol + 60, cy);
  cy += 8;

  const particularsTop = cy;
  const amountX = x + w - 120;
  doc.line(x, cy, x + w, cy);
  cy += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("P A R T I C U L A R S", x + 8, cy);
  doc.text("A M O U N T", x + w - 8, cy, { align: "right" });
  doc.line(x, cy + 5, x + w, cy + 5);
  doc.line(amountX, particularsTop, amountX, H - 240);
  cy += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  data.lines.forEach((l, i) => {
    const no = l.serial ?? String(i + 1);
    doc.text(`${no}. ${l.name.toUpperCase()}`, x + 14, cy);
    doc.text(money(l.amount), x + w - 10, cy, { align: "right" });
    cy += 15;
  });

  const totalsTop = H - 240;
  const labelX = x + w * 0.42;
  const valX = x + w - 10;
  doc.line(x, totalsTop, x + w, totalsTop);
  doc.line(labelX, totalsTop, labelX, totalsTop + 96);

  let ty = totalsTop + 18;
  doc.text(rupeesInWords(data.totalDue), x + 8, ty, { align: "left", maxWidth: labelX - x - 20 });
  doc.text("Total:", labelX + 110, ty, { align: "right" });
  doc.text(money(data.total), valX, ty, { align: "right" });
  ty += 18;
  doc.text("Arrears", labelX + 110, ty, { align: "right" });
  doc.text(money(data.arrears), valX, ty, { align: "right" });
  ty += 22;
  doc.setFont("helvetica", "bold");
  doc.text("Total Due:", labelX + 110, ty, { align: "right" });
  doc.text(money(data.totalDue), valX, ty, { align: "right" });
  doc.setFont("helvetica", "normal");

  const bottomTop = totalsTop + 96;
  doc.line(x, bottomTop, x + w, bottomTop);
  const notesX = x + w * 0.5;
  doc.line(notesX, bottomTop, notesX, bottomTop + 92);
  doc.line(x, bottomTop + 92, x + w, bottomTop + 92);
  doc.line(x, boxTop, x, bottomTop + 92);
  doc.line(x + w, boxTop, x + w, bottomTop + 92);
  doc.line(x, boxTop, x + w, boxTop);

  doc.setFontSize(8);
  let ny = bottomTop + 16;
  for (const note of FOOTER_NOTES) {
    doc.text(note, x + 6, ny);
    ny += 12;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`For ${data.society.name}`, x + w - 8, bottomTop + 16, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("SECRETARY", x + w - 8, bottomTop + 78, { align: "right" });

  doc.setDrawColor(120);
  doc.setLineDashPattern([6, 4], 0);
  doc.line(x, bottomTop + 120, x + w, bottomTop + 120);
  doc.setLineDashPattern([], 0);

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}

/** One bordered receipt box drawn at (x, y); returns the box's bottom y. */
function drawReceiptBox(doc: jsPDF, data: LegacyReceiptData, x: number, y: number, w: number): number {
  const boxTop = y;
  drawSocietyHeader(doc, data.society, boxTop + 22);
  if (data.copyLabel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(data.copyLabel.toUpperCase(), x + w - 8, boxTop + 12, { align: "right" });
    doc.setTextColor(30);
  }
  let cy = boxTop + 78;
  doc.setDrawColor(60);
  doc.setLineWidth(0.8);
  doc.line(x, cy, x + w, cy);
  cy += 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("R E C E I P T", x + w / 2, cy, { align: "center" });
  doc.setLineWidth(0.6);
  const tw = doc.getTextWidth("R E C E I P T");
  doc.line(x + w / 2 - tw / 2, cy + 4, x + w / 2 + tw / 2, cy + 4);
  cy += 30;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text("Receipt No.:", x + 8, cy);
  doc.text(String(data.receiptNo), x + 90, cy);
  doc.text("Receipt Date:", x + w - 150, cy);
  doc.text(formatDate(data.receiptDate), x + w - 60, cy, { align: "right" });
  cy += 22;
  doc.line(x, cy, x + w, cy);
  cy += 26;

  const lines: { pre?: string; bold?: string; post?: string; underline?: boolean }[] = [
    { pre: "Received with thanks from ", bold: data.memberName.toUpperCase() },
    { pre: "the sum of ", bold: `Rs. ${money(data.amount)}/-`, post: " in words ", underline: true, },
  ];
  let ly = cy;
  for (const ln of lines) {
    doc.setFont("helvetica", "normal");
    if (ln.pre) doc.text(ln.pre, x + 12, ly);
    const preW = ln.pre ? doc.getTextWidth(ln.pre) : 0;
    doc.setFont("helvetica", "bold");
    doc.text(ln.bold ?? "", x + 12 + preW, ly);
    if (ln.underline) {
      const bw = doc.getTextWidth(ln.bold ?? "");
      doc.setLineWidth(0.5);
      doc.line(x + 12 + preW, ly + 2.5, x + 12 + preW + bw, ly + 2.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(rupeesInWords(data.amount), x + 12 + preW + bw + 24, ly);
      doc.setFontSize(10.5);
    }
    ly += 20;
  }
  doc.setFont("helvetica", "normal");
  doc.text(`in Part/Full Payment of ${data.purpose}`, x + 12, ly);
  ly += 20;
  const modeTxt = [data.reference, data.mode].filter(Boolean).join(" · ");
  doc.text(`being the charges for the Flat ${data.flatNo ?? "—"}${modeTxt ? `   Cheque No.~ ${modeTxt}` : ""}`, x + 12, ly);
  ly += 34;

  // Amount box bottom-left
  doc.setLineWidth(0.8);
  doc.rect(x + 12, ly, 170, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Rs. ${money(data.amount)} /-`, x + 22, ly + 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("*Subject to realisation of cheque(s).", x + 12, ly + 42);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`For ${data.society.name}`, x + w - 8, ly + 6, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("SECRETARY", x + w - 8, ly + 62, { align: "right" });

  // Outer box
  doc.setLineWidth(0.8);
  doc.rect(x, boxTop, w, ly + 70 - boxTop);
  return ly + 70;
}

/** Bordered legacy receipt byte producer for emailing — no download. */
export function receiptPdfBytes(data: LegacyReceiptData): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const x = 40;
  const w = W - x * 2;
  const bottom = drawReceiptBox(doc, data, x, 60, w);

  doc.setDrawColor(120);
  doc.setLineDashPattern([6, 4], 0);
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
  const x = 40;
  const w = W - x * 2;
  const perPage = twoUp ? 2 : 1;
  const yFor = (slot: number) => (twoUp ? (slot === 0 ? 50 : 421) : 60);
  let slot = 0;
  let lastBottom = 0;
  for (const item of items) {
    if (slot >= perPage) {
      doc.addPage();
      slot = 0;
    }
    if (twoUp && slot === 1) {
      const cut = Math.round((lastBottom + yFor(1)) / 2);
      doc.setDrawColor(120);
      doc.setLineDashPattern([6, 4], 0);
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
  body { font-family: Arial, Helvetica, sans-serif; color:#111; }
  .wrap { border:1.5px solid #111; padding:0; margin:0 auto; max-width:720px; }
  .hdr { text-align:center; padding:14px 10px 10px; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; }
  .hdr p { font-size:9pt; margin:3px 0; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; border-top:1px solid #111; border-bottom:1px solid #111; padding:6px; }
  .meta { width:100%; font-size:10pt; padding:10px; border-collapse:collapse; }
  .meta td { padding:3px 6px; }
  .parthead { width:100%; border-collapse:collapse; }
  .parthead th { border-top:1px solid #111; border-bottom:1px solid #111; font-size:10.5pt; padding:6px 8px; text-align:left; letter-spacing:2px; }
  .parthead th.r { text-align:right; }
  .lines { width:100%; border-collapse:collapse; min-height:180px; }
  .lines td { font-size:10pt; padding:4px 8px; }
  .lines td.num { text-align:right; }
  .tot { width:100%; border-collapse:collapse; border-top:1px solid #111; }
  .tot td { font-size:10pt; padding:4px 8px; }
  .tot .lbl { text-align:right; }
  .tot .val { text-align:right; width:120px; }
  .tot .grand { font-weight:bold; border-top:1px solid #111; }
  .foot { width:100%; border-top:1px solid #111; font-size:8pt; border-collapse:collapse; }
  .foot td { padding:8px; vertical-align:top; }
  .foot .sig { text-align:right; font-weight:bold; font-size:9pt; }
  .receipt-body { padding:16px 14px; font-size:11pt; line-height:1.9; }
  .amtbox { border:1px solid #111; display:inline-block; padding:6px 14px; font-weight:bold; margin-top:14px; }
  .tear { border-bottom:2px dashed #888; margin:26px auto; max-width:720px; }
  table.sign { width:100%; }
`;

function societyHeaderHtml(s: SocietyHeader): string {
  return `<div class="hdr">
    <h1>${esc(s.name.toUpperCase())}</h1>
    ${s.registrationNo ? `<p>${esc(s.registrationNo)}</p>` : ""}
    ${s.address ? `<p>${esc(s.address)}</p>` : ""}
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function billHtml(data: LegacyBillData): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>Bill ${esc(String(data.billNo))}</title><style>${docCss}</style></head>
<body><div class="wrap">
  ${societyHeaderHtml(data.society)}
  <div class="titlebar">Bill for the Month of ${esc(data.periodLabel)}</div>
  <table class="meta">
    <tr><td>Bill No:</td><td><b>${esc(String(data.billNo))}</b></td><td style="text-align:right">Bill Date:</td><td>${formatDate(data.billDate)}</td></tr>
    <tr><td>Name:</td><td><b>${esc(data.memberName.toUpperCase())}</b>${data.memberName2 ? `<br>${esc(data.memberName2.toUpperCase())}` : ""}</td><td style="text-align:right">Area :</td><td>${esc(data.area ?? "")}</td></tr>
    <tr><td>Flat</td><td>${esc(data.flatNo ?? "")}</td><td style="text-align:right">Due Date:</td><td>${formatDate(data.dueDate)}</td></tr>
  </table>
  <table class="parthead"><tr><th>PARTICULARS</th><th class="r">AMOUNT</th></tr></table>
  <table class="lines">
    ${data.lines.map((l, i) => `<tr><td>${l.serial ?? i + 1}.&nbsp; ${esc(l.name.toUpperCase())}</td><td class="num">${money(l.amount)}</td></tr>`).join("")}
    ${Array.from({ length: Math.max(0, 6 - data.lines.length) }, () => `<tr><td>&nbsp;</td><td></td></tr>`).join("")}
  </table>
  <table class="tot">
    <tr><td rowspan="2" style="width:55%">${esc(rupeesInWords(data.totalDue))}</td><td class="lbl">Total:</td><td class="val">${money(data.total)}</td></tr>
    <tr><td class="lbl">Arrears</td><td class="val">${money(data.arrears)}</td></tr>
    <tr><td></td><td class="lbl grand">Total Due:</td><td class="val grand">${money(data.totalDue)}</td></tr>
  </table>
  <table class="foot">
    <tr><td style="width:50%">${FOOTER_NOTES.map(esc).join("<br>")}</td>
    <td class="sig">For ${esc(data.society.name)}<br><br><br><span style="font-weight:normal">SECRETARY</span></td></tr>
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
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">RECEIPT</div>
  ${data.copyLabel ? `<p class="copytag">${esc(data.copyLabel.toUpperCase())}</p>` : ""}
  <table class="meta">
    <tr><td>Receipt No.:</td><td>${esc(String(data.receiptNo))}</td><td style="text-align:right">Receipt Date:</td><td>${formatDate(data.receiptDate)}</td></tr>
  </table>
  <div class="receipt-body">
    Received with thanks from <b>${esc(data.memberName.toUpperCase())}</b><br>
    the sum of <b>Rs. ${money(data.amount)}/-</b> in words <b><u>${esc(rupeesInWords(data.amount))}</u></b><br>
    in Part/Full Payment of ${esc(data.purpose)}<br>
    being the charges for the Flat ${esc(data.flatNo ?? "—")}${data.reference ? ` &nbsp;<b>Cheque No.~ ${esc(data.reference)}</b>` : ""}
    <table class="sign"><tr>
      <td><span class="amtbox">Rs. ${money(data.amount)} /-</span><br><span style="font-size:7.5pt">*Subject to realisation of cheque(s).</span></td>
      <td style="text-align:right; vertical-align:top"><b>For ${esc(data.society.name)}</b><br><br><br><span style="font-weight:normal">SECRETARY</span></td>
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
  .copytag { text-align:right; font-size:8pt; margin:0 10px; color:#333; }
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
  body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; }
  .wrap { border:1.5px solid #111; padding:0; margin:0 auto; max-width:700px; page-break-inside:avoid; }
  .hdr { text-align:center; padding:14px 10px 10px; }
  .hdr h1 { font-size:15pt; margin:0; font-weight:bold; }
  .hdr p { font-size:9pt; margin:3px 0; }
  .titlebar { text-align:center; font-weight:bold; font-size:11pt; border-top:1px solid #111; border-bottom:1px solid #111; padding:6px; }
  .copytag { text-align:right; font-size:8pt; margin:2px 10px 0; color:#333; }
  .meta { width:100%; font-size:10pt; padding:10px; border-collapse:collapse; }
  .meta td { padding:3px 6px; }
  .receipt-body { padding:16px 14px; font-size:11pt; line-height:1.9; }
  .amtbox { border:1px solid #111; display:inline-block; padding:6px 14px; font-weight:bold; margin-top:14px; }
  table.sign { width:100%; }
  .cutline { border-top:2px dashed #888; margin:8px auto; max-width:700px; }
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
  const x = 40;
  const w = W - x * 2;
  const boxTop = 44;

  drawSocietyHeader(doc, data.society, boxTop + 20);
  let cy = boxTop + 78;
  doc.setDrawColor(60);
  doc.setLineWidth(0.8);
  doc.line(x, cy, x + w, cy);
  cy += 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const title = data.title.toUpperCase().split("").join(" ");
  doc.text(title, W / 2, cy, { align: "center" });
  doc.setLineWidth(0.6);
  const tw = doc.getTextWidth(title);
  doc.line(W / 2 - tw / 2, cy + 4, W / 2 + tw / 2, cy + 4);
  cy += 28;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text("Voucher No.:", x + 8, cy);
  doc.setFont("helvetica", "bold");
  doc.text(data.voucherNo, x + 90, cy);
  doc.setFont("helvetica", "normal");
  doc.text("Voucher Date:", W - 210, cy);
  doc.text(formatDate(data.voucherDate), W - 100, cy, { align: "right" });
  cy += 18;
  if (data.party) {
    doc.text(`${data.title.startsWith("Payment") ? "Paid to" : data.title.startsWith("Receipt") ? "Received from" : "Party"}:`, x + 8, cy);
    doc.setFont("helvetica", "bold");
    doc.text(data.party.toUpperCase(), x + 90, cy);
    doc.setFont("helvetica", "normal");
    cy += 18;
  }
  if (data.chequeNo) {
    doc.text(`Cheque No.~ ${data.chequeNo}${data.chequeDate ? `  dt ${formatDate(data.chequeDate)}` : ""}${data.bankName ? `  ·  ${data.bankName}` : ""}`, x + 8, cy);
    cy += 18;
  }
  cy += 6;
  doc.line(x, cy, x + w, cy);
  cy += 16;

  const { head, rows } = voucherLinesTable(data);
  const colCode = x + 8;
  const colLedger = x + 70;
  const colDebit = x + w - 190;
  const colCredit = x + w - 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(head[0], colCode, cy);
  doc.text(head[1], colLedger, cy);
  doc.text(head[2], colDebit, cy, { align: "right" });
  doc.text(head[3], colCredit, cy, { align: "right" });
  doc.line(x, cy + 5, x + w, cy + 5);
  cy += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const r of rows) {
    doc.text(String(r[0]), colCode, cy);
    doc.setFont("helvetica", r[1] === "TOTAL" ? "bold" : "normal");
    const noteLines = String(r[1]).split("\n");
    doc.text(noteLines[0], colLedger, cy);
    if (noteLines[1]) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(noteLines[1].trim(), colLedger + 10, cy + 11);
      doc.setFontSize(10);
    }
    doc.setFont("helvetica", r[1] === "TOTAL" ? "bold" : "normal");
    doc.text(r[2], colDebit, cy, { align: "right" });
    doc.text(r[3], colCredit, cy, { align: "right" });
    doc.setFont("helvetica", "normal");
    cy += r[1].includes("\n") ? 26 : 16;
  }
  doc.line(x, cy - 10, x + w, cy - 10);
  cy += 16;

  // Amount in words band
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.5);
  doc.text(`Rupees: ${rupeesInWords(data.amount)} Only`, x + 8, cy, { maxWidth: w - 16 });
  cy += 26;
  if (data.narration) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Narration: ${data.narration}`, x + 8, cy, { maxWidth: w - 120 });
    cy += 16;
  }

  // Signature block
  const sigY = Math.max(cy + 40, doc.internal.pageSize.getHeight() - 150);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`For ${data.society.name}`, x + w - 8, sigY, { align: "right" });
  doc.setDrawColor(60);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(x + 10, sigY + 40, x + w * 0.3, sigY + 40);
  doc.line(x + w * 0.45, sigY + 40, x + w - 10, sigY + 40);
  doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Receiver's signature", x + 10, sigY + 54);
  doc.text("Authorised signatory", x + w * 0.45, sigY + 54);

  doc.setLineWidth(0.8);
  doc.rect(x, boxTop, w, sigY + 66 - boxTop);
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
  .vhead { width:100%; font-size:10pt; border-collapse:collapse; padding:0 10px; }
  .vhead td { padding:3px 6px; }
  .vtable { width:100%; border-collapse:collapse; margin-top:8px; }
  .vtable th { border-top:1px solid #111; border-bottom:1px solid #111; font-size:10pt; padding:5px 8px; text-align:left; }
  .vtable th.r { text-align:right; }
  .vtable td { font-size:10pt; padding:4px 8px; border-bottom:1px solid #ddd; }
  .vtable td.num { text-align:right; }
  .vtable tr.total td { font-weight:bold; border-bottom:1px solid #111; border-top:1px solid #111; }
  .words { font-size:10pt; font-style:italic; padding:10px; }
  .vsig { width:100%; padding:10px; border-collapse:collapse; }
  .vsig td { font-size:9pt; padding-top:36px; }
  .sigline { border-top:1px dotted #555; margin:0 30px; }
</style></head>
<body><div class="wrap">
  ${societyHeaderHtml(data.society)}
  <div class="titlebar" style="text-decoration:underline; letter-spacing:3px;">${esc(data.title.toUpperCase())}</div>
  <table class="vhead">
    <tr><td>Voucher No.: <b>${esc(data.voucherNo)}</b></td><td style="text-align:right">Voucher Date: ${formatDate(data.voucherDate)}</td></tr>
    ${data.party ? `<tr><td colspan="2">${esc(partyLabel)}: <b>${esc(data.party.toUpperCase())}</b></td></tr>` : ""}
    ${data.chequeNo ? `<tr><td colspan="2">Cheque No.~ <b>${esc(data.chequeNo)}</b>${data.chequeDate ? ` dt ${formatDate(data.chequeDate)}` : ""}${data.bankName ? ` · ${esc(data.bankName)}` : ""}</td></tr>` : ""}
  </table>
  <table class="vtable">
    <thead><tr><th>Code</th><th>Ledger / Particulars</th><th class="r">Debit</th><th class="r">Credit</th></tr></thead>
    <tbody>
      ${data.lines.map((l) => `<tr><td>${esc(l.code ?? "")}</td><td>${esc(l.name.toUpperCase())}${l.note ? `<br><span style="font-size:8.5pt">&nbsp;&nbsp;&nbsp;${esc(l.note)}</span>` : ""}</td><td class="num">${money(l.debit)}</td><td class="num">${money(l.credit)}</td></tr>`).join("")}
      <tr class="total"><td></td><td>TOTAL</td><td class="num">${money(data.lines.reduce((s, l) => s + l.debit, 0))}</td><td class="num">${money(data.lines.reduce((s, l) => s + l.credit, 0))}</td></tr>
    </tbody>
  </table>
  <div class="words">Rupees: ${esc(rupeesInWords(data.amount))} Only</div>
  ${data.narration ? `<div class="words" style="font-style:normal">Narration: ${esc(data.narration)}</div>` : ""}
  <table class="vsig">
    <tr>
      <td style="width:50%"><div class="sigline"></div><div style="margin-top:4px">Receiver's signature</div></td>
      <td style="width:50%; text-align:right"><b>For ${esc(data.society.name)}</b><div class="sigline"></div><div style="margin-top:4px">Authorised signatory</div></td>
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
