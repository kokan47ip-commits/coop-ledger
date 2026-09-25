import * as XLSX from "xlsx";

export type ParsedSheet = {
  rows: Record<string, unknown>[];
  headers: string[];
};

export function parseExcelFile(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // Read with the header off so we can locate the real header row first —
        // exported sheets often carry a title banner above the headers.
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
          blankrows: false,
          raw: false,
        });
        const filled = (r: unknown[]) => r.filter((c) => String(c ?? "").trim() !== "").length;
        // Header detection: title banners ("Shanti CHS — Opening Details as on
        // 01/04/2025") can also have 2+ filled cells, so prefer rows that look
        // like real column headers — cells equal to known header words
        // (Flat No, Name, Code, Date, Amount …) score far higher than width
        // alone. Ties keep the earliest row.
        const headerWords = new Set([
          "flatno", "flat", "flatnumber", "unit", "house", "shop", "premises",
          "name", "membername", "nameofmember", "ownername", "member",
          "code", "membercode", "memberid", "memberno", "srno", "srlno", "printno",
          "date", "joindate", "openingdate", "amount", "openingbalance", "balance",
          "voucher", "voucherno", "vouchertype", "vouchers", "ledger", "ledgercode",
          "ledgername", "account", "accountcode", "accountname", "tariff", "tariffname",
          "head", "bank", "bankname", "mode", "cashbank", "reference", "chequeno",
          "narration", "remarks", "particulars", "wing", "building", "floor",
          "unittype", "type", "status", "unitamount", "tariffamount",
        ]);
        let headerIdx = -1;
        let bestScore = -1;
        for (let i = 0; i < Math.min(matrix.length, 10); i++) {
          const r = matrix[i];
          const f = filled(r);
          if (f < 2) continue;
          const tokens = r.filter((c) => {
            const t = String(c ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
            return t !== "" && headerWords.has(t);
          }).length;
          const score = tokens * 100 + f;
          if (score > bestScore) {
            bestScore = score;
            headerIdx = i;
          }
        }
        if (headerIdx === -1) headerIdx = 0;
        const rawHeaders = (matrix[headerIdx] ?? []).map((h) => String(h ?? "").trim());
        // Drop trailing empties and de-duplicate repeated headers (Col, Col.1…).
        while (rawHeaders.length > 0 && rawHeaders[rawHeaders.length - 1] === "") rawHeaders.pop();
        const seen = new Map<string, number>();
        const headers = rawHeaders.map((h) => {
          const key = h || "Column";
          const count = seen.get(key) ?? 0;
          seen.set(key, count + 1);
          return count === 0 ? h : `${h || "Column"}.${count}`;
        });
        const rows: Record<string, unknown>[] = [];
        for (const r of matrix.slice(headerIdx + 1)) {
          if (r.every((c) => String(c ?? "").trim() === "")) continue; // blank row
          const row: Record<string, unknown> = {};
          headers.forEach((h, i) => {
            if (h) row[h] = r[i] ?? "";
          });
          rows.push(row);
        }
        resolve({ rows, headers });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to parse Excel."));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function downloadWorkbook(
  sheets: { name: string; rows: Record<string, unknown>[] }[],
  filename: string,
) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows.length > 0 ? s.rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const TEMPLATES = {
  members: [
    {
      Code: "M001",
      Name: "Ramesh Kumar",
      FlatNo: "101",
      Wing: "", // optional — leave blank for single-building societies
      Phone: "9820012345",
      Email: "ramesh@example.com",
      OwnershipType: "owner",
      JoinDate: "2020-04-01",
      OpeningBalance: 2500,
      OpeningDate: "2025-04-01",
    },
  ],
  tariffs: [
    {
      Name: "Maintenance Charges",
      Amount: 2500,
      Account: "3000",
      Unit: "flat",
    },
    {
      Name: "Sinking Fund Contribution",
      Amount: 500,
      Account: "Sinking Fund Contribution",
      Unit: "flat",
    },
  ],
  receipts: [
    {
      Date: "2025-04-05",
      MemberCode: "M001",
      Amount: 3000,
      Mode: "Bank",
      Reference: "UTR001122",
      Narration: "April maintenance",
    },
  ],
  payments: [
    {
      Date: "2025-04-10",
      Account: "Electricity Charges",
      Amount: 18500,
      Bank: "Bank Account",
      Reference: "BILL-2201",
      Narration: "MSEB April",
    },
  ],
  transactions: [
    {
      "Voucher No.": "860",
      Date: "25/08/2026",
      Vouchers: "Receipts",
      "Ledger Code": "B703",
      "Ledger Name": "",
      Amount: 1257,
      "Cash/Bank": "1020",
      Narration: "OF AUG-2026",
      "Cheque No.": "RTGS",
      "Chq. Date": "25/08/2026",
      "Bank Name": "",
      ChqClearDate: "25/08/2026",
    },
    {
      "Voucher No.": "861",
      Date: "26/08/2026",
      Vouchers: "Payments",
      "Ledger Code": "4000",
      "Ledger Name": "",
      Amount: 18500,
      "Cash/Bank": "1010",
      Narration: "MSEB August",
      "Cheque No.": "100100",
      "Chq. Date": "26/08/2026",
      "Bank Name": "",
      ChqClearDate: "26/08/2026",
    },
  ],
};

export function downloadMemberTariffTemplate(
  tariffs: { name: string; amount?: number }[],
  sampleMembers: { flatNo?: string; name: string }[],
) {
  const cols = ["Flat No", "Name of Member", ...tariffs.map((t) => t.name)];
  const rows: Record<string, unknown>[] =
    sampleMembers.length > 0
      ? sampleMembers.map((m, i) => {
          const row: Record<string, unknown> = {
            "Flat No": m.flatNo ?? "",
            "Name of Member": m.name,
          };
          tariffs.forEach((t, j) => {
            // First sample row carries the schedule amounts as a starting
            // point; later rows stay blank (blank = use schedule amount).
            row[t.name] = i === 0 ? (t.amount ?? [2500, 500, 300][j % 3]) : "";
          });
          return row;
        })
      : [
          {
            "Flat No": "A-101",
            "Name of Member": "Ramesh Kumar",
            ...Object.fromEntries(tariffs.map((t) => [t.name, t.amount ?? 2500])),
          },
        ];
  downloadWorkbook([{ name: "Custom Tariffs", rows }], "template-member-tariffs.xlsx");
}

export function downloadTemplate(kind: keyof typeof TEMPLATES) {
  const rows = TEMPLATES[kind];
  const filename = `template-${kind}.xlsx`;
  if (kind === "members") {
    downloadWorkbook(
      [{ name: "Members", rows: rows as Record<string, unknown>[] }],
      filename,
    );
    return;
  }
  if (kind === "tariffs") {
    downloadWorkbook(
      [{ name: "Tariffs", rows: rows as Record<string, unknown>[] }],
      filename,
    );
    return;
  }
  if (kind === "receipts") {
    downloadWorkbook(
      [{ name: "Receipts", rows: rows as Record<string, unknown>[] }],
      filename,
    );
    return;
  }
  if (kind === "transactions") {
    downloadWorkbook(
      [{ name: "Transactions", rows: rows as Record<string, unknown>[] }],
      filename,
    );
    return;
  }
  downloadWorkbook(
    [{ name: "Payments", rows: rows as Record<string, unknown>[] }],
    filename,
  );
}
