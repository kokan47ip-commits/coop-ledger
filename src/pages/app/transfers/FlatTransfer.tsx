import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { exportPDF, exportWord, printTables, type ExportMeta, type TableSpec } from "@/lib/export";
import { formatMoney } from "@/lib/format";
import { ArrowRightLeft, FileDown, FileText, Printer } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type MemberRow = {
  _id: Id<"members">;
  code: string;
  name: string;
  flatNo?: string;
  wing?: string;
  building?: string;
  unitType?: string;
  floor?: string;
  buildupArea?: number;
  carpetArea?: number;
  phone?: string;
  email?: string;
  ownershipType?: "owner" | "tenant";
  isActive: boolean;
  openingBalance: number;
};

type TransferRow = {
  _id: Id<"flatTransfers">;
  transferNo: string;
  transferDate: string;
  flatNo: string;
  wing?: string;
  building?: string;
  outstandingAtTransfer: number;
  duesHandling: "settled" | "carry_forward";
  events: { at: number; byName: string; action: string; details: string }[];
  note?: string;
  outgoingName: string;
  outgoingCode?: string;
  incomingName: string;
  incomingCode?: string;
};

export default function FlatTransfer() {
  const { societyId, society, canEdit } = useSociety();
  const members = useQuery(
    api.members.list,
    societyId ? { societyId } : "skip",
  ) as MemberRow[] | undefined;
  const transfers = useQuery(
    api.transfers.list,
    societyId ? { societyId } : "skip",
  ) as TransferRow[] | undefined;

  const performTransfer = useMutation(api.transfers.perform);

  const [outgoingId, setOutgoingId] = useState("");
  const [duesHandling, setDuesHandling] = useState<"settled" | "carry_forward">(
    "settled",
  );
  const [transferDate, setTransferDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingId, setExistingId] = useState("");
  const [nm, setNm] = useState({
    code: "",
    name: "",
    phone: "",
    email: "",
    familyInfo: "",
    vehicleNo: "",
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const activeMembers = (members ?? []).filter((m) => m.isActive);
  const outgoing = activeMembers.find((m) => m._id === outgoingId);

  // Guidance only — the authoritative net outstanding (unpaid bills +
  // opening) is computed server-side at transfer time.
  const outgoingOutstanding = outgoing ? outgoing.openingBalance : null;

  const submit = async () => {
    if (!societyId) return;
    setBusy(true);
    try {
      const res = await performTransfer({
        societyId,
        outgoingMemberId: outgoingId as Id<"members">,
        duesHandling,
        transferDate,
        newMemberId:
          mode === "existing" && existingId
            ? (existingId as Id<"members">)
            : undefined,
        newMember:
          mode === "new"
            ? {
                code: nm.code,
                name: nm.name,
                phone: nm.phone || undefined,
                email: nm.email || undefined,
                familyInfo: nm.familyInfo || undefined,
                vehicleNo: nm.vehicleNo || undefined,
                joinDate: transferDate,
              }
            : undefined,
        note: note || undefined,
      });
      toast.success(
        `Transfer ${res.transferNo} completed — ${outgoing ? `${outgoing.name} archived` : "done"}${res.carryForward ? `, ₹${res.carryForward.toLocaleString("en-IN")} carried to the new member` : ", dues settled"}.`,
      );
      setOutgoingId("");
      setExistingId("");
      setNm({ code: "", name: "", phone: "", email: "", familyInfo: "", vehicleNo: "" });
      setNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const meta: ExportMeta | null =
    society && societyId
      ? {
          societyName: society.name,
          societyAddress: society.address,
          registrationNo: society.registrationNo,
          title: "Flat Ownership Transfer Certificate",
        }
      : null;

  const certificateTable = (t: TransferRow): TableSpec => ({
    head: ["Particulars", "Outgoing owner", "New owner"],
    body: [
      ["Name", t.outgoingName, t.incomingName],
      ["Member code", t.outgoingCode ?? "—", t.incomingCode ?? "—"],
      ["Flat / Unit", `${t.wing ?? ""}-${t.flatNo}`.replace(/^-/, "") || "—", "Same unit"],
      ["Transfer date", t.transferDate, t.transferDate],
      [
        "Dues at transfer",
        formatMoney(t.outstandingAtTransfer),
        t.duesHandling === "carry_forward"
          ? `Carried forward: ${formatMoney(t.outstandingAtTransfer)}`
          : "Settled before transfer",
      ],
      ["Status", "Archived (records preserved)", "Active member"],
    ],
  });

  const auditTable = (t: TransferRow): TableSpec => ({
    head: ["Date & time", "Action", "Details"],
    body: t.events.map((e) => [
      new Date(e.at).toLocaleString("en-IN"),
      e.action,
      e.details,
    ]),
  });

  const exportCert = (t: TransferRow, kind: "pdf" | "word" | "print") => {
    if (!meta) return;
    const tables = [certificateTable(t), auditTable(t)];
    const filename = `transfer-${t.transferNo}`;
    if (kind === "pdf") exportPDF(meta, tables, filename);
    else if (kind === "word") exportWord(meta, tables, filename);
    else printTables(meta, tables);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Flat Transfer"
        description="Transfer a flat's ownership: the outgoing member is archived with full financial history preserved, dues are settled or carried forward, and a compliance-ready audit trail with an ownership certificate is produced."
      />

      {canEdit && societyId ? (
        <Card className="space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Flat / outgoing member</Label>
              <Select value={outgoingId} onValueChange={setOutgoingId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select member leaving" />
                </SelectTrigger>
                <SelectContent>
                  {activeMembers.map((m) => (
                    <SelectItem key={m._id} value={m._id}>
                      {m.wing ?? ""}-{m.flatNo ?? "?"} — {m.name} ({m.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Transfer date</Label>
              <Input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Input
                placeholder="e.g. Sale deed no. 421/2026"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Dues handling</Label>
            <RadioGroup
              value={duesHandling}
              onValueChange={(v) =>
                setDuesHandling(v as "settled" | "carry_forward")
              }
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="settled" id="dues-settled" />
                <Label htmlFor="dues-settled" className="font-normal">
                  Settle before transfer (block while dues remain)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="carry_forward" id="dues-carry" />
                <Label htmlFor="dues-carry" className="font-normal">
                  Carry outstanding dues to the new member
                </Label>
              </div>
            </RadioGroup>
            {outgoingOutstanding !== null && duesHandling === "carry_forward" ? (
              <p className="text-xs text-muted-foreground">
                Guidance: this member's opening balance is{" "}
                {formatMoney(outgoingOutstanding)}; the authoritative net
                outstanding (unpaid bills + opening) is computed at transfer.
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "new" | "existing")}
              className="flex gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="new" id="mode-new" />
                <Label htmlFor="mode-new" className="font-normal">
                  Admit a new owner
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="existing" id="mode-existing" />
                <Label htmlFor="mode-existing" className="font-normal">
                  Existing member moves in
                </Label>
              </div>
            </RadioGroup>

            {mode === "new" ? (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Member code *</Label>
                  <Input
                    value={nm.code}
                    onChange={(e) => setNm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="e.g. 42"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Full name *</Label>
                  <Input
                    value={nm.name}
                    onChange={(e) => setNm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Sunita Deshmukh"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    value={nm.phone}
                    onChange={(e) => setNm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={nm.email}
                    onChange={(e) => setNm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Vehicle no.</Label>
                  <Input
                    value={nm.vehicleNo}
                    onChange={(e) =>
                      setNm((f) => ({ ...f, vehicleNo: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <Label>Family members</Label>
                  <Input
                    value={nm.familyInfo}
                    onChange={(e) =>
                      setNm((f) => ({ ...f, familyInfo: e.target.value }))
                    }
                    placeholder="e.g. Spouse Rohit, daughter Aarohi"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Moving-in member</Label>
                <Select value={existingId} onValueChange={setExistingId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select existing member" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMembers
                      .filter((m) => m._id !== outgoingId)
                      .map((m) => (
                        <SelectItem key={m._id} value={m._id}>
                          {m.name} ({m.code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={submit}
              disabled={
                busy ||
                !outgoingId ||
                (mode === "new" ? !nm.code.trim() || !nm.name.trim() : !existingId)
              }
            >
              <ArrowRightLeft className="mr-1 size-4" />
              {busy ? "Transferring…" : "Complete flat transfer"}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Transfer register</h3>
          <p className="text-xs text-muted-foreground">
            Every transfer with its audit trail — export the ownership
            certificate for records.
          </p>
        </div>
        {transfers === undefined ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : transfers.length === 0 ? (
          <div className="p-4">
            <EmptyHint>
              No transfers recorded yet — the register fills in as flats change
              hands.
            </EmptyHint>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Flat</TableHead>
                <TableHead>Outgoing</TableHead>
                <TableHead>New owner</TableHead>
                <TableHead>Dues</TableHead>
                <TableHead className="text-right">Certificate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((t) => (
                <TableRow key={t._id}>
                  <TableCell className="font-mono text-xs">{t.transferNo}</TableCell>
                  <TableCell className="text-xs">{t.transferDate}</TableCell>
                  <TableCell>
                    {[t.wing, t.flatNo].filter(Boolean).join("-") || "—"}
                  </TableCell>
                  <TableCell>
                    {t.outgoingName}{" "}
                    <Badge variant="outline" className="ml-1">
                      archived
                    </Badge>
                  </TableCell>
                  <TableCell>{t.incomingName}</TableCell>
                  <TableCell className="text-xs">
                    {t.duesHandling === "carry_forward"
                      ? `Carried ${formatMoney(t.outstandingAtTransfer)}`
                      : "Settled"}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCert(t, "pdf")}
                      title="PDF"
                    >
                      <FileDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCert(t, "word")}
                      title="Word"
                    >
                      <FileText className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => exportCert(t, "print")}
                      title="Print"
                    >
                      <Printer className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
