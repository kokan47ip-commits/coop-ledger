import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { downloadTemplate, parseExcelFile } from "@/lib/excel";
import { fyStartISO } from "@/lib/format";
import { CheckCircle2, Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Result = { inserted: number; updated: number; skipped: number; errors: string[] };
type UploadKind = "members" | "tariffs" | "receipts" | "payments";

const KINDS: {
  kind: UploadKind;
  title: string;
  description: string;
  columns: string;
}[] = [
  {
    kind: "members",
    title: "Member register & openings",
    description: "Import the client's member register with opening receivable balances.",
    columns: "Code, Name, FlatNo, Wing, Phone, Email, OwnershipType, JoinDate, OpeningBalance, OpeningDate",
  },
  {
    kind: "tariffs",
    title: "Tariff schedule",
    description: "Import recurring charges. The Account column accepts either the account code or its name.",
    columns: "Name, Amount, Account, Unit",
  },
  {
    kind: "receipts",
    title: "Member & other receipts",
    description: "Import collection scrolls. Each row becomes a receipt voucher, settled against outstanding bills oldest-first.",
    columns: "Date, MemberCode, Amount, Mode, Reference, Narration",
  },
  {
    kind: "payments",
    title: "Payment register",
    description: "Import expense payments. The Account column must match an existing ledger name or code.",
    columns: "Date, Account, Amount, Bank, Reference, Narration",
  },
];

function UploadCard({
  kind,
  title,
  description,
  columns,
  onDone,
}: {
  kind: UploadKind;
  title: string;
  description: string;
  columns: string;
  onDone: (r: Result) => void;
}) {
  const { societyId } = useSociety();
  const accounts = useQuery(
    api.accounts.list,
    societyId ? { societyId } : "skip",
  ) as Doc<"accounts">[] | undefined;
  const doMembers = useMutation(api.uploads.uploadMembers);
  const doTariffs = useMutation(api.uploads.uploadTariffs);
  const doReceipts = useMutation(api.uploads.uploadReceipts);
  const doPayments = useMutation(api.uploads.uploadPayments);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Result | null>(null);

  const run = async (file: File) => {
    if (!societyId) return;
    setBusy(true);
    try {
      const { rows } = await parseExcelFile(file);
      if (rows.length === 0) {
        toast.error("No rows found in the first sheet.");
        return;
      }
      let res: Result;
      if (kind === "members") {
        res = await doMembers({ societyId, rows, defaultOpeningDate: fyStartISO() });
      } else if (kind === "tariffs") {
        res = await doTariffs({ societyId, rows });
      } else {
        const bank = accounts?.find((a) => a.kind === "bank_cash");
        if (!bank) {
          toast.error("Create a bank/cash account first (Chart of Accounts).");
          return;
        }
        if (kind === "receipts") {
          res = await doReceipts({ societyId, rows, defaultAccountId: bank._id });
        } else {
          res = await doPayments({ societyId, rows, defaultBankCashAccountId: bank._id });
        }
      }
      setLast(res);
      onDone(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="pt-1 font-mono text-[11px] text-muted-foreground">{columns}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => downloadTemplate(kind)} title="Download template">
          <Download className="size-4" /> Template
        </Button>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) run(f);
            e.target.value = "";
          }}
        />
        <Button disabled={busy} onClick={() => inputRef.current?.click()} className="rounded-lg">
          <Upload className="size-4" /> {busy ? "Uploading…" : "Upload Excel"}
        </Button>
        {last && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-foreground" />
            {last.inserted} added · {last.updated} updated
            {last.errors.length > 0 && ` · ${last.errors.length} row errors`}
          </span>
        )}
      </div>
      {last && last.errors.length > 0 && (
        <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-md bg-accent/50 p-3 text-xs text-muted-foreground">
          {last.errors.slice(0, 20).map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Uploads() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Excel Uploads"
        description="Bring client records across from spreadsheets in bulk. Download a template to see the expected columns — headers are matched flexibly, so order and capitalisation don't matter."
      />
      <div className="space-y-4">
        {KINDS.map((k) => (
          <UploadCard
            key={k.kind}
            kind={k.kind}
            title={k.title}
            description={k.description}
            columns={k.columns}
            onDone={(r) =>
              toast.success(
                `Upload complete: ${r.inserted} added, ${r.updated} updated` +
                  (r.errors.length ? `, ${r.errors.length} rows skipped` : ""),
              )
            }
          />
        ))}
      </div>
      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Dates accept <span className="font-mono">YYYY-MM-DD</span> or <span className="font-mono">DD/MM/YYYY</span>.
        Amounts may include commas and the ₹ symbol. Member codes in receipt uploads must already exist —
        import members first. Zero-amount rows are ignored.
      </p>
    </div>
  );
}
