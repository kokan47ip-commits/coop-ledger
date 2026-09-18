import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
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
  body: (string | number)[][];
  foot?: (string | number)[][];
  columnStyles?: Record<number, { halign?: "left" | "center" | "right"; cellWidth?: number | "auto" }>;
};

function headerLines(meta: ExportMeta): string[] {
  const lines = [meta.societyName];
  if (meta.societyAddress) lines.push(meta.societyAddress);
  if (meta.registrationNo) lines.push(`Reg. No: ${meta.registrationNo}`);
  return lines;
}

export function exportPDF(meta: ExportMeta, tables: TableSpec[], filename: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let cursorY = 56;

  const drawHeader = () => {
    const lines = headerLines(meta);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(lines[0], pageWidth / 2, cursorY, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let y = cursorY + 16;
    for (const line of lines.slice(1)) {
      doc.text(line, pageWidth / 2, y, { align: "center" });
      y += 12;
    }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(meta.title, pageWidth / 2, y + 10, { align: "center" });
    let afterTitle = y + 24;
    if (meta.subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(meta.subtitle, pageWidth / 2, afterTitle, { align: "center" });
      afterTitle += 14;
    }
    doc.setDrawColor(30);
    doc.setLineWidth(0.8);
    doc.line(margin, afterTitle, pageWidth - margin, afterTitle);
    return afterTitle + 18;
  };

  cursorY = drawHeader();

  for (const t of tables) {
    autoTable(doc, {
      head: [t.head],
      body: t.body.map((r) => r.map((c) => (typeof c === "number" ? formatMoney(c) : c))),
      foot: t.foot,
      startY: cursorY,
      margin: { left: margin, right: margin, top: 100 },
      theme: "plain",
      styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: [30, 30, 30] },
      headStyles: { fontStyle: "bold", fontSize: 9, lineWidth: { bottom: 0.6 }, lineColor: [30, 30, 30] },
      footStyles: { fontStyle: "bold", lineWidth: { top: 0.6 }, lineColor: [30, 30, 30] },
      columnStyles: t.columnStyles,
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
    doc.setDrawColor(30);
    doc.setLineWidth(0.6);
    sigs.forEach((s, i) => {
      const x = margin + slot * i;
      doc.setLineDashPattern([2, 2], 0);
      doc.line(x + 8, lineY, x + slot - 16, lineY);
      doc.setLineDashPattern([], 0);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(30);
      doc.text(s.name, x + 8, lineY + 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(s.label, x + 8, lineY + 26);
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 28,
      { align: "center" },
    );
    doc.text(
      `Generated ${formatDate(new Date().toISOString())}`,
      margin,
      doc.internal.pageSize.getHeight() - 28,
    );
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
  const head = t.head
    .map((h, i) => {
      const align = t.columnStyles?.[i]?.halign;
      const style = align === "right" ? "text-align:right;" : align === "center" ? "text-align:center;" : "";
      return `<th style="${style}">${escapeHtml(String(h))}</th>`;
    })
    .join("");
  const body = t.body
    .map(
      (row) =>
        `<tr>${row
          .map((c, i) => {
            const align = t.columnStyles?.[i]?.halign;
            const style = align === "right" ? "text-align:right;" : align === "center" ? "text-align:center;" : "";
            const val = typeof c === "number" ? formatMoney(c) : escapeHtml(String(c));
            return `<td style="${style}">${val}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const foot = t.foot
    ? `<tfoot><tr>${t.foot
        .map((c, i) => {
          const align = t.columnStyles?.[i]?.halign;
          const style = align === "right" ? "text-align:right;" : align === "center" ? "text-align:center;" : "";
          const val = typeof c === "number" ? formatMoney(c) : escapeHtml(String(c));
          return `<td style="${style}"><b>${val}</b></td>`;
        })
        .join("")}</tr></tfoot>`
    : "";
  return `<table width="100%" style="border-collapse:collapse" cellspacing="0">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

export function exportWord(meta: ExportMeta, tables: TableSpec[], filename: string) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color:#1a1a1a; }
  h1 { font-size: 16pt; text-align:center; margin:0 0 4pt; }
  .sub { text-align:center; font-size: 9pt; margin:0; color:#444; }
  .title { text-align:center; font-size:12pt; font-weight:bold; margin:14pt 0 2pt; text-decoration:underline; }
  table { margin-top: 10pt; }
  th { border-bottom: 1px solid #1a1a1a; font-size: 9pt; padding: 4pt 6pt; text-align:left; }
  td { font-size: 9pt; padding: 3pt 6pt; }
  hr { border:none; border-top:1px solid #1a1a1a; margin: 8pt 0 12pt; }
  .signatures { margin-top: 48pt; width:100%; }
  .signatures td { border:none; text-align:center; font-size: 9pt; padding: 0 8pt; }
  .sigline { border-top: 1px dotted #555; margin: 34pt 12pt 0; }
  .signame { font-weight: bold; margin-top: 5pt; }
  .siglabel { color: #555; margin-top: 2pt; }
</style></head>
<body>
<h1>${escapeHtml(meta.societyName)}</h1>
${meta.societyAddress ? `<p class="sub">${escapeHtml(meta.societyAddress)}</p>` : ""}
${meta.registrationNo ? `<p class="sub">Reg. No: ${escapeHtml(meta.registrationNo)}</p>` : ""}
<p class="title">${escapeHtml(meta.title)}</p>
${meta.subtitle ? `<p class="sub">${escapeHtml(meta.subtitle)}</p>` : ""}
<hr/>
${tables.map(tableToHtml).join("<br/>")}
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

// ---------- Print (opens a styled window) ----------

export function printTables(meta: ExportMeta, tables: TableSpec[]) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  const html = `<html><head><title>${escapeHtml(meta.title)}</title><style>
    body { font-family: Helvetica, Arial, sans-serif; color:#111; margin: 40px; }
    h1 { font-size: 18px; text-align:center; margin:0; letter-spacing:0.02em; }
    .sub { text-align:center; font-size: 11px; color:#555; margin:2px 0; }
    .title { text-align:center; font-size: 14px; font-weight:700; margin: 18px 0 2px; }
    hr { border:none; border-top: 1.5px solid #111; margin: 10px 0 16px; }
    table { width:100%; border-collapse: collapse; margin-bottom: 18px; }
    th { border-bottom: 1.5px solid #111; text-align:left; font-size: 11px; padding: 6px 8px; }
    td { font-size: 11px; padding: 5px 8px; border-bottom: 1px solid #e5e5e5; }
    tfoot td { border-top: 1.5px solid #111; border-bottom: none; font-weight: 700; }
    .signatures { margin-top: 56px; width: 100%; }
    .signatures td { border: none !important; text-align: center; padding: 0 10px; }
    .sigline { border-top: 1px dotted #555; margin: 44px 12px 0; }
    .signame { font-weight: 700; margin-top: 5px; font-size: 11px; }
    .siglabel { color: #555; margin-top: 2px; font-size: 10px; }
    @media print { body { margin: 24px; } }
  </style></head><body>
  <h1>${escapeHtml(meta.societyName)}</h1>
  ${meta.societyAddress ? `<p class="sub">${escapeHtml(meta.societyAddress)}</p>` : ""}
  ${meta.registrationNo ? `<p class="sub">Reg. No: ${escapeHtml(meta.registrationNo)}</p>` : ""}
  <p class="title">${escapeHtml(meta.title)}</p>
  ${meta.subtitle ? `<p class="sub">${escapeHtml(meta.subtitle)}</p>` : ""}
  <hr/>
  ${tables
    .map((t) => {
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
              const val = typeof c === "number" ? formatMoney(c) : escapeHtml(String(c));
              return `<td${style}>${val}</td>`;
            })
            .join("")}</tr></tfoot>`
        : "";
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
    })
    .join("")}
  ${signaturesHtml(meta)}
  </body></html>`;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export type { TableSpec };
