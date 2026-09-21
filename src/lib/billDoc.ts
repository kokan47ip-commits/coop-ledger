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
  lines: { name: string; amount: number }[];
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
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = 40;
  const w = W - x * 2;
  const boxTop = 44;

  let cy = drawSocietyHeader(doc, data.society, boxTop + 20);
  cy += 6;

  // Bill-for line inside the same box
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Bill for the Month of ${data.periodLabel}`, W / 2, cy, { align: "center" });
  cy += 14;
  doc.setDrawColor(60);
  doc.setLineWidth(0.8);
  doc.line(x, cy, x + w, cy);
  cy += 16;

  // Bill meta rows
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

  // Particulars header band
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
    doc.text(`${i + 1}. ${l.name.toUpperCase()}`, x + 14, cy);
    doc.text(money(l.amount), x + w - 10, cy, { align: "right" });
    cy += 15;
  });

  // Totals block (bottom-aligned above the notes band)
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

  // Bottom band: notes + For society / signature
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

  // Tear line
  doc.setDrawColor(120);
  doc.setLineDashPattern([6, 4], 0);
  doc.line(x, bottomTop + 120, x + w, bottomTop + 120);
  doc.setLineDashPattern([], 0);

  doc.save(filename);
}

/** Bordered legacy receipt with amount box and tear line. */
export function receiptPdf(data: LegacyReceiptData, filename: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const x = 40;
  const w = W - x * 2;
  const boxTop = 60;

  drawSocietyHeader(doc, data.society, boxTop + 22);
  let cy = boxTop + 78;
  doc.setDrawColor(60);
  doc.setLineWidth(0.8);
  doc.line(x, cy, x + w, cy);
  cy += 26;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("R E C E I P T", W / 2, cy, { align: "center" });
  doc.setLineWidth(0.6);
  const tw = doc.getTextWidth("R E C E I P T");
  doc.line(W / 2 - tw / 2, cy + 4, W / 2 + tw / 2, cy + 4);
  cy += 30;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text("Receipt No.:", x + 8, cy);
  doc.text(String(data.receiptNo), x + 90, cy);
  doc.text("Receipt Date:", W - 190, cy);
  doc.text(formatDate(data.receiptDate), W - 100, cy, { align: "right" });
  cy += 22;
  doc.line(x, cy, x + w, cy);
  cy += 26;

  const colW = 150;
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

  doc.setDrawColor(120);
  doc.setLineDashPattern([6, 4], 0);
  doc.line(x, ly + 100, x + w, ly + 100);
  doc.setLineDashPattern([], 0);
  void H;
  doc.save(filename);
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
    ${data.lines.map((l, i) => `<tr><td>${i + 1}.&nbsp; ${esc(l.name.toUpperCase())}</td><td class="num">${money(l.amount)}</td></tr>`).join("")}
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
  const w = window.open("", "_blank", "width=860,height=700");
  if (!w) return;
  w.document.write(
    receiptHtml(data).replace(/^<html[^>]*>/, "<html>").replace(/<meta[^>]*>/, ""),
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
