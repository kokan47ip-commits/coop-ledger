import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CellHookData } from "jspdf-autotable";
import * as XLSX from "xlsx";
import { formatDate, formatMoney } from "./format";

export type ExportSignature = {
  /** Office, e.g. "Chairman" */
  label: string;
  /** Office-bearer's name, printed under the signature line */
  name: string;
};

export type ExportMeta = {
  societyName: string;
  societyAddress?: string;
  registrationNo?: string;
  title: string;
  subtitle?: string;
  /** Committee signature block, rendered at the foot of every exported document. */
  signatures?: ExportSignature[];
};

type TableSpec = {
  head: string[];
  /** Start this table on a fresh page (Skip Page After Ledger). */
  pageBreakBefore?: boolean;
  /**
   * Optional grouped header row rendered above `head` (Crystal-style column
   * bands). Each entry is a label with the number of columns it spans; entries
   * with span 0 render as an empty cell.
   */
  groupHead?: { label: string; span: number; align?: "left" | "center" | "right" }[];
  /** Crystal-style account section heading drawn above the table (e.g. "A01  THE … BANK"). */
  sectionTitle?: string;
  body: (string | number)[][];
  foot?: (string | number)[][];
  columnStyles?: Record<number, { halign?: "left" | "center" | "right"; cellWidth?: number | "auto" }>;
};

/* ------------------------------------------------------------------ */
/* Report palette — matches the bills / receipts / vouchers identity.  */
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

/** Height reserved at the top of every page for the report letterhead. */
const HEADER_TOP = 158;

/** Expand group definitions into a jsPDF head row with empty filler cells. */
function groupHeadRow(
  groups: NonNullable<TableSpec["groupHead"]>,
  totalColumns: number,
): string[] {
  const row: string[] = [];
  for (const g of groups) {
    row.push(g.label);
    for (let i = 1; i < g.span; i++) row.push("");
  }
  while (row.length < totalColumns) row.push("");
  return row.slice(0, totalColumns);
}

export function exportPDF(meta: ExportMeta, tables: TableSpec[], filename: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let cursorY = 56;

  const drawHeader = (): number => {
    // Indigo letterhead band with a gold rule, then a tinted title band.
    doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.rect(0, 0, pageWidth, 70, "F");
    doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
    doc.rect(0, 70, pageWidth, 3, "F");

    doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13.5);
    doc.text(meta.societyName.toUpperCase(), pageWidth / 2, 30, {
      align: "center",
      maxWidth: pageWidth - 80,
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    doc.setTextColor(199, 210, 254);
    let hy = 45;
    if (meta.societyAddress) {
      doc.text(meta.societyAddress, pageWidth / 2, hy, {
        align: "center",
        maxWidth: pageWidth - 80,
      });
      hy += 11;
    }
    if (meta.registrationNo) {
      doc.text(`Reg. No: ${meta.registrationNo}`, pageWidth / 2, hy, { align: "center" });
    }

    doc.setFillColor(TINT[0], TINT[1], TINT[2]);
    doc.rect(margin, 86, pageWidth - margin * 2, 26, "F");
    doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(meta.title.toUpperCase(), pageWidth / 2, 103.5, { align: "center" });

    let y = 128;
    if (meta.subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(meta.subtitle, pageWidth / 2, y, { align: "center" });
      y += 12;
    }
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.setFont("helvetica", "normal");
    return y + 16;
  };

  cursorY = drawHeader();

  for (const t of tables) {
    if (t.pageBreakBefore && cursorY > 56) {
      doc.addPage();
      cursorY = drawHeader();
    }
    if (t.sectionTitle) {
      doc.setFillColor(TINT[0], TINT[1], TINT[2]);
      doc.rect(margin, cursorY - 10, pageWidth - margin * 2, 19, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
      doc.text(t.sectionTitle, margin + 6, cursorY + 3.5);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      cursorY += 19;
    }
    const headRows: string[][] = t.groupHead
      ? [
          groupHeadRow(t.groupHead, t.head.length),
          t.head,
        ]
      : [t.head];
    autoTable(doc, {
      head: headRows,
      body: t.body.map((r) => r.map((c) => (typeof c === "number" ? formatMoney(c) : c))),
      foot: t.foot,
      startY: cursorY,
      margin: { left: margin, right: margin, top: HEADER_TOP },
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 5,
        textColor: INK,
        lineColor: HAIRLINE,
        lineWidth: 0.35,
      },
      headStyles: {
        fontStyle: "bold",
        fontSize: 9,
        fillColor: ACCENT,
        textColor: WHITE,
        lineWidth: 0,
      },
      footStyles: {
        fontStyle: "bold",
        fillColor: TINT,
        textColor: ACCENT,
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: TINT_ALT, lineColor: TINT },
      columnStyles: t.columnStyles,
      // Centre the group-band labels over their spans on the first head row.
      ...(t.groupHead
        ? {
            didParseCell: ((data: CellHookData) => {
              if (data.section === "head" && data.row.index === 0) {
                data.cell.styles.halign = "center";
              }
            }) as (data: CellHookData) => void,
          }
        : {}),
      didDrawPage: () => {
        if (doc.getCurrentPageInfo().pageNumber > 1) {
          cursorY = drawHeader();
        }
      },
    });
    const after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    cursorY = after + 24;
    if (cursorY > doc.internal.pageSize.getHeight() - 120) {
      doc.addPage();
      cursorY = drawHeader();
    }
  }

  // Committee signature block on the last page, drawn before page footers so
  // an added signatures page also receives its footer.
  if (meta.signatures && meta.signatures.length > 0) {
    if (cursorY > doc.internal.pageSize.getHeight() - 110) {
      doc.addPage();
      cursorY = drawHeader();
    }
    const sigs = meta.signatures.slice(0, 3);
    const usable = pageWidth - margin * 2;
    const slot = usable / 3;
    const lineY = cursorY + 34;
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.setLineWidth(0.6);
    sigs.forEach((s, i) => {
      const x = margin + slot * i;
      doc.setLineDashPattern([2, 2], 0);
      doc.line(x + 8, lineY, x + slot - 16, lineY);
      doc.setLineDashPattern([], 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
      doc.text(s.name, x + 8, lineY + 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(s.label, x + 8, lineY + 26);
    });
  }

  doc.setLineWidth(0.6);
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
    doc.line(margin, pageHeight - 46, pageWidth - margin, pageHeight - 46);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(
      `Generated ${formatDate(new Date().toISOString())}`,
      margin,
      pageHeight - 32,
    );
    doc.text(meta.societyName, pageWidth / 2, pageHeight - 32, { align: "center" });
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 32, {
      align: "right",
    });
  }

  doc.save(filename);
}

// ---------- Word (HTML .doc) export ----------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function signaturesHtml(meta: ExportMeta): string {
  if (!meta.signatures || meta.signatures.length === 0) return "";
  const cells = meta.signatures
    .slice(0, 3)
    .map(
      (s) => `<td><div class="sigline"></div><div class="signame">${escapeHtml(s.name)}</div><div class="siglabel">${escapeHtml(s.label)}</div></td>`,
    )
    .join("");
  return `<table class="signatures"><tr>${cells}</tr></table>`;
}

function tableToHtml(t: TableSpec): string {
  const section = t.sectionTitle
    ? `<p class="section">${escapeHtml(t.sectionTitle)}</p>`
    : "";
  const head = t.head
    .map((h, i) => {
      const align = t.columnStyles?.[i]?.halign;
      const style = `${align === "right" ? "text-align:right;" : align === "center" ? "text-align:center;" : ""}background:#312e81;color:#ffffff;`;
      return `<th style="${style}">${escapeHtml(String(h))}</th>`;
    })
    .join("");
  const groupHead = t.groupHead
    ? `<tr>${t.groupHead
        .map((g) => {
          const align =
            g.align === "right" ? "right" : g.align === "left" ? "left" : "center";
          return `<th colspan="${g.span || 1}" style="text-align:${align};background:#eef2ff;color:#312e81;">${escapeHtml(g.label)}</th>`;
        })
        .join("")}</tr>`
    : "";
  const body = t.body
    .map(
      (row, ri) =>
        `<tr>${row
          .map((c, i) => {
            const align = t.columnStyles?.[i]?.halign;
            const bg = ri % 2 === 1 ? "background:#f8fafc;" : "";
            const style = `${align === "right" ? "text-align:right;" : align === "center" ? "text-align:center;" : ""}${bg}`;
            const val = typeof c === "number" ? formatMoney(c) : escapeHtml(String(c)).replace(/\n/g, "<br/>");
            return `<td style="${style}">${val}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const foot = t.foot
    ? `<tfoot><tr>${t.foot
        .map((c, i) => {
          const align = t.columnStyles?.[i]?.halign;
          const style = `${align === "right" ? "text-align:right;" : align === "center" ? "text-align:center;" : ""}background:#eef2ff;color:#312e81;`;
          const val = typeof c === "number" ? formatMoney(c) : escapeHtml(String(c));
          return `<td style="${style}"><b>${val}</b></td>`;
        })
        .join("")}</tr></tfoot>`
    : "";
  return `${section}<table width="100%" style="border-collapse:collapse" cellspacing="0">
    <thead>${groupHead ? `<tr>${groupHead}</tr>` : ""}<tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

export function exportWord(meta: ExportMeta, tables: TableSpec[], filename: string) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; }
  .hdrband td { background:#312e81; padding:14pt 10pt 12pt; text-align:center; }
  h1 { font-size: 15pt; text-align:center; margin:0; color:#ffffff; letter-spacing:0.4pt; }
  .sub { text-align:center; font-size: 8.5pt; margin:3pt 0 0; color:#c7d2fe; }
  .goldrule { height:3px; background:#b45309; line-height:3px; font-size:1pt; }
  .title { text-align:center; font-size:11pt; font-weight:bold; margin:0; padding:6pt; background:#eef2ff; color:#312e81; letter-spacing:1px; }
  .sub2 { text-align:center; font-size: 9pt; margin:8pt 0 0; color:#64748b; }
  .section { font-weight:bold; font-size:10pt; margin:12pt 0 2pt; color:#312e81; }
  table { margin-top: 10pt; width:100%; border-collapse:collapse; }
  th { background:#312e81; color:#ffffff; font-size: 9pt; padding: 5pt 7pt; text-align:left; }
  td { font-size: 9pt; padding: 4pt 7pt; border-bottom:1px solid #eef2ff; }
  .signatures { margin-top: 48pt; width:100%; }
  .signatures td { border:none; text-align:center; font-size: 9pt; padding: 0 8pt; }
  .sigline { border-top: 1px dotted #cbd5e1; margin: 34pt 12pt 0; }
  .signame { font-weight: bold; margin-top: 5pt; color:#312e81; }
  .siglabel { color: #64748b; margin-top: 2pt; }
</style></head>
<body>
<table class="hdrband" width="100%" cellspacing="0" cellpadding="0"><tr><td>
<h1>${escapeHtml(meta.societyName)}</h1>
${meta.societyAddress ? `<p class="sub">${escapeHtml(meta.societyAddress)}</p>` : ""}
${meta.registrationNo ? `<p class="sub">Reg. No: ${escapeHtml(meta.registrationNo)}</p>` : ""}
</td></tr></table>
<div class="goldrule"></div>
<p class="title">${escapeHtml(meta.title)}</p>
${meta.subtitle ? `<p class="sub2">${escapeHtml(meta.subtitle)}</p>` : ""}
${tables
    .map((t, i) =>
      `${i > 0 && t.pageBreakBefore ? '<br style="page-break-before:always"/>' : ""}${tableToHtml(t)}`,
    )
    .join("<br/>")}
${signaturesHtml(meta)}
</body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Excel (.xlsx) export ----------

/** Rupees with Indian-style grouping; numbers stay real numbers in the sheet. */
const EXCEL_NUMBER_FORMAT = "#,##0.00";

/** Excel sheet names: max 31 chars, no \ / ? * [ ]. Unique within the book. */
function excelSheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  let i = 2;
  while (used.has(name)) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  used.add(name);
  return name;
}

/**
 * Excel workbook download: one sheet per table, each carrying the society
 * letterhead (name, address, reg. no, title, subtitle), the optional group
 * band (merged across its span), the column head, the body and the totals
 * foot. Money cells stay numbers formatted #,##0.00 so Excel can sum and
 * re-pivot the figures, and the committee signatures close each sheet.
 */
export function exportExcel(meta: ExportMeta, tables: TableSpec[], filename: string) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const t of tables) {
    const width = Math.max(
      t.head.length,
      ...t.body.map((r) => r.length),
      ...(t.foot ?? []).map((r) => r.length),
      1,
    );
    const rows: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];
    // Letterhead band, each line merged across the table's full width.
    const band = (label: string) => {
      rows.push([label]);
      if (width > 1) {
        merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: width - 1 } });
      }
    };
    band(meta.societyName.toUpperCase());
    if (meta.societyAddress) band(meta.societyAddress);
    if (meta.registrationNo) band(`Reg. No: ${meta.registrationNo}`);
    band(meta.title.toUpperCase());
    if (meta.subtitle) band(meta.subtitle);
    rows.push([]);
    if (t.sectionTitle) band(t.sectionTitle);
    // Group band above the head, each label merged over its column span.
    if (t.groupHead) {
      const grow: string[] = [];
      let col = 0;
      for (const g of t.groupHead) {
        grow.push(g.label);
        if (g.span > 1) {
          merges.push({
            s: { r: rows.length, c: col },
            e: { r: rows.length, c: Math.min(width - 1, col + g.span - 1) },
          });
          for (let i = 1; i < g.span; i++) grow.push("");
        }
        col += g.span;
      }
      while (grow.length < width) grow.push("");
      rows.push(grow.slice(0, width));
    }
    const norm = (r: (string | number)[]): (string | number)[] => {
      const out = r.slice(0, width);
      while (out.length < width) out.push("");
      return out;
    };
    rows.push(norm(t.head));
    for (const r of t.body) rows.push(norm(r));
    if (t.foot) for (const r of t.foot) rows.push(norm(r));
    if (meta.signatures && meta.signatures.length > 0) {
      rows.push([]);
      const sigs = meta.signatures.slice(0, 3);
      rows.push(norm(sigs.map((s) => s.name)));
      rows.push(norm(sigs.map((s) => s.label)));
    }
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(rows);
    const ref = ws["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      const widths: number[] = new Array<number>(width).fill(10);
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = 0; C < width; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[addr] as XLSX.CellObject | undefined;
          if (!cell) continue;
          if (cell.t === "n") {
            cell.z = EXCEL_NUMBER_FORMAT;
            widths[C] = Math.max(widths[C]!, String(cell.v).length + 2);
          } else if (cell.t === "s") {
            widths[C] = Math.max(widths[C]!, Math.min(55, String(cell.v ?? "").length + 2));
          }
        }
      }
      ws["!cols"] = widths.map((w) => ({ wch: w }));
    }
    ws["!merges"] = merges;
    XLSX.utils.book_append_sheet(wb, ws, excelSheetName(t.sectionTitle ?? meta.title, used));
  }
  XLSX.writeFile(wb, filename);
}

// ---------- Print (opens a styled window) ----------

export function printTables(meta: ExportMeta, tables: TableSpec[]) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  const html = `<html><head><title>${escapeHtml(meta.title)}</title><style>
    * { box-sizing: border-box; }
    body { font-family: Helvetica, Arial, sans-serif; color:#0f172a; margin: 0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .sheet { max-width: 820px; margin: 0 auto; border:1.2px solid #312e81; border-radius:6px; overflow:hidden; background:#fff; }
    .hdr { background:#312e81; color:#fff; text-align:center; padding: 18px 16px 14px; }
    h1 { font-size: 18px; text-align:center; margin:0; color:#fff; letter-spacing:0.02em; }
    .sub { text-align:center; font-size: 11px; color:#c7d2fe; margin:3px 0 0; }
    .goldrule { height:3px; background:#b45309; }
    .title { text-align:center; font-size: 13px; font-weight:700; margin:0; padding:9px; background:#eef2ff; color:#312e81; letter-spacing:1px; }
    .sub2 { text-align:center; font-size: 11px; color:#64748b; margin:10px 0 0; }
    .body { padding: 18px 20px 26px; }
    .section { font-weight:700; font-size: 12px; margin: 14px 0 2px; color:#312e81; }
    table { width:100%; border-collapse: collapse; margin-bottom: 18px; }
    th { background:#312e81; color:#fff; text-align:left; font-size: 11px; padding: 7px 9px; }
    td { font-size: 11px; padding: 6px 9px; border-bottom: 1px solid #eef2ff; }
    tr:nth-child(even) td { background:#f8fafc; }
    tfoot td { background:#eef2ff; color:#312e81; font-weight: 700; }
    .signatures { margin-top: 56px; width: 100%; }
    .signatures td { border: none !important; background: transparent !important; text-align: center; padding: 0 10px; }
    .sigline { border-top: 1px dotted #cbd5e1; margin: 44px 12px 0; }
    .signame { font-weight: 700; margin-top: 5px; font-size: 11px; color:#312e81; }
    .siglabel { color: #64748b; margin-top: 2px; font-size: 10px; }
    @media print { body { margin: 12px; } }
  </style></head><body>
  <div class="sheet">
  <div class="hdr">
  <h1>${escapeHtml(meta.societyName)}</h1>
  ${meta.societyAddress ? `<p class="sub">${escapeHtml(meta.societyAddress)}</p>` : ""}
  ${meta.registrationNo ? `<p class="sub">Reg. No: ${escapeHtml(meta.registrationNo)}</p>` : ""}
  </div>
  <div class="goldrule"></div>
  <p class="title">${escapeHtml(meta.title)}</p>
  ${meta.subtitle ? `<p class="sub2">${escapeHtml(meta.subtitle)}</p>` : ""}
  <div class="body">
  ${tables
    .map((t, ti) => {
      const head = t.head
        .map((h, i) => {
          const align = t.columnStyles?.[i]?.halign;
          const style = align === "right" ? ' style="text-align:right"' : "";
          return `<th${style}>${escapeHtml(String(h))}</th>`;
        })
        .join("");
      const body = t.body
        .map(
          (row) =>
            `<tr>${row
              .map((c, i) => {
                const align = t.columnStyles?.[i]?.halign;
                const style = align === "right" ? ' style="text-align:right"' : "";
                const val = typeof c === "number" ? formatMoney(c) : escapeHtml(String(c));
                return `<td${style}>${val}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("");
      const foot = t.foot
        ? `<tfoot><tr>${t.foot
            .map((c, i) => {
              const align = t.columnStyles?.[i]?.halign;
              const style = align === "right" ? ' style="text-align:right"' : "";
              const val = typeof c === "number" ? formatMoney(c) : escapeHtml(String(c)).replace(/\n/g, "<br/>");
              return `<td${style}>${val}</td>`;
            })
            .join("")}</tr></tfoot>`
        : "";
      const brk = ti > 0 && t.pageBreakBefore ? '<div style="page-break-before:always"></div>' : "";
      return `${brk}${t.sectionTitle ? `<p class="section">${escapeHtml(t.sectionTitle)}</p>` : ""}<table><thead>${
        t.groupHead
          ? `<tr>${t.groupHead
              .map((g) => {
                const align =
                  g.align === "right" ? "right" : g.align === "left" ? "left" : "center";
                return `<th colspan="${g.span || 1}" style="text-align:${align}">${escapeHtml(g.label)}</th>`;
              })
              .join("")}</tr>`
          : ""
      }<tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
    })
    .join("")}
  ${signaturesHtml(meta)}
  </div>
  </div>
  </body></html>`;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export type { TableSpec };
