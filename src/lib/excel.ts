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
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
          raw: false,
        });
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
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
      FlatNo: "A-101",
      Wing: "A",
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
};

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
  downloadWorkbook(
    [{ name: "Payments", rows: rows as Record<string, unknown>[] }],
    filename,
  );
}
