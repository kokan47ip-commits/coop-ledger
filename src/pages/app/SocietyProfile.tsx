import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import { saveClaimCode, useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { effectiveFyPeriod, fyYearLabel, todayISO } from "@/lib/format";
import { CheckCircle2, Circle, Save, TriangleAlert, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type MemberOption = {
  _id: string;
  code: string;
  name: string;
  flatNo?: string;
  wing?: string;
};

const ROLES = [
  { key: "chairmanMemberId", label: "Chairman" },
  { key: "secretaryMemberId", label: "Secretary" },
  { key: "treasurerMemberId", label: "Treasurer" },
] as const;

export default function SocietyProfile() {
  const { society, setActiveId, role } = useSociety();
  const accounts = useQuery(
    api.accounts.list,
    society ? { societyId: society._id } : "skip",
  );
  const members = useQuery(
    api.members.list,
    society ? { societyId: society._id } : "skip",
  ) as MemberOption[] | undefined;

  const createSociety = useMutation(api.societies.create);
  const updateSociety = useMutation(api.societies.update);
  const deleteSociety = useMutation(api.societies.remove);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = params.get("new") === "1" || !society;

  const [form, setForm] = useState({
    name: "",
    registrationNo: "",
    registrationDate: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    email: "",
    phone: "",
    fyStartMonth: 4,
    fyYear: fyYearLabel(4),
    fyStartDate: "",
    receivableAccountId: "",
    upiVpa: "",
    chairmanMemberId: "",
    secretaryMemberId: "",
    treasurerMemberId: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (society && !isNew) {
      setForm({
        name: society.name ?? "",
        registrationNo: society.registrationNo ?? "",
        registrationDate: society.registrationDate ?? "",
        address: society.address ?? "",
        city: society.city ?? "",
        state: society.state ?? "",
        pincode: society.pincode ?? "",
        email: society.email ?? "",
        phone: society.phone ?? "",
        fyStartMonth: society.fyStartMonth ?? 4,
        fyYear: society.fyYear ?? fyYearLabel(society.fyStartMonth ?? 4),
        fyStartDate: society.fyStartDate ?? "",
        receivableAccountId: society.receivableAccountId ?? "",
        upiVpa: society.upiVpa ?? "",
        chairmanMemberId: society.chairmanMemberId ?? "",
        secretaryMemberId: society.secretaryMemberId ?? "",
        treasurerMemberId: society.treasurerMemberId ?? "",
      });
    }
  }, [society, isNew]);

  // Auto-fill the financial-year label when the start month changes on a new society.
  useEffect(() => {
    if (isNew) {
      setForm((f) => ({ ...f, fyYear: fyYearLabel(f.fyStartMonth) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.fyStartMonth]);

  const period = useMemo(
    () => effectiveFyPeriod(society ?? null),
    [society],
  );

  const receivableOptions = (accounts ?? []).filter(
    (a) => a.kind === "bank_cash" || a.kind === "receivable" || a.type === "asset",
  );

  const memberOptions = useMemo(
    () =>
      [...(members ?? [])].sort((a, b) => a.code.localeCompare(b.code)),
    [members],
  );

  const committeeFilled = ROLES.filter(
    (r) => form[r.key] !== "",
  ).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) {
        const { societyId: id, claimCode } = await createSociety({
          name: form.name.trim(),
          registrationNo: form.registrationNo || undefined,
          registrationDate: form.registrationDate || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          pincode: form.pincode || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          fyStartMonth: form.fyStartMonth,
          fyYear: form.fyYear || undefined,
          fyStartDate: form.fyStartDate || undefined,
        });
        // Guest-created societies get a claim code kept on this device; after
        // email sign-in the society is adopted automatically into the account.
        if (claimCode) saveClaimCode(id, claimCode);
        setActiveId(id);
        toast.success("Society onboarded — chart of accounts generated");
        navigate("/app/society");
      } else if (society) {
        await updateSociety({
          id: society._id,
          name: form.name.trim(),
          registrationNo: form.registrationNo || undefined,
          registrationDate: form.registrationDate || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          pincode: form.pincode || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          fyStartMonth: form.fyStartMonth,
          fyYear: form.fyYear || undefined,
          fyStartDate: form.fyStartDate || undefined,
          chairmanMemberId: form.chairmanMemberId
            ? (form.chairmanMemberId as never)
            : undefined,
          secretaryMemberId: form.secretaryMemberId
            ? (form.secretaryMemberId as never)
            : undefined,
          treasurerMemberId: form.treasurerMemberId
            ? (form.treasurerMemberId as never)
            : undefined,
          receivableAccountId: form.receivableAccountId
            ? (form.receivableAccountId as never)
            : undefined,
          upiVpa: form.upiVpa.trim() || undefined,
        });
        toast.success("Society profile updated");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Deletion is always explicit and user-initiated — societies are never
  // removed automatically on login or by any other action.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const deleteThisSociety = async () => {
    if (!society) return;
    setDeleting(true);
    try {
      await deleteSociety({ id: society._id });
      try {
        localStorage.removeItem("chs.activeSocietyId");
      } catch {
        /* ignore */
      }
      toast.success("Society deleted");
      navigate("/app/society?new=1");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete society");
    } finally {
      setDeleting(false);
    }
  };

  const memberSelect = (key: (typeof ROLES)[number]["key"], label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={form[key] || "none"}
        onValueChange={(v) =>
          setForm({ ...form, [key]: v === "none" ? "" : v })
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Not assigned —</SelectItem>
          {memberOptions.map((m) => (
            <SelectItem key={m._id} value={m._id}>
              {m.code} — {m.name}
              {[m.wing, m.flatNo].filter(Boolean).length > 0 &&
                ` (${[m.wing, m.flatNo].filter(Boolean).join("-")})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Chosen from the member register.
      </p>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={isNew ? "Onboard a client society" : "Society Profile"}
        description={
          isNew
            ? "Register a client society to open its books. The standard chart of accounts is generated automatically, ready for tariffs, bills and vouchers."
            : "Identity, financial period, committee office-bearers and accounting defaults — used across bills, vouchers and statements."
        }
      />
      <form onSubmit={submit}>
        <Tabs defaultValue="society">
          <TabsList className="mb-8 w-full justify-start overflow-x-auto rounded-lg border-b bg-transparent p-0">
            <TabsTrigger
              value="society"
              className="rounded-lg border-b-2 border-transparent px-5 py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Society
            </TabsTrigger>
            <TabsTrigger
              value="period"
              className="rounded-lg border-b-2 border-transparent px-5 py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Financial Period
            </TabsTrigger>
            <TabsTrigger
              value="committee"
              className="rounded-lg border-b-2 border-transparent px-5 py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <span className="flex items-center gap-2">
                Committee Members
                <span className="text-[10px] text-muted-foreground">
                  {committeeFilled}/3
                </span>
              </span>
            </TabsTrigger>
            {!isNew && (
              <TabsTrigger
                value="accounting"
                className="rounded-lg border-b-2 border-transparent px-5 py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                Accounting
              </TabsTrigger>
            )}
          </TabsList>

          {/* --- Society tab --- */}
          <TabsContent value="society" className="mt-2 space-y-8">
            <section className="space-y-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Identity
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="name">Society name *</Label>
                  <Input
                    id="name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Silverwood Co-operative Housing Society Ltd."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reg">Registration number</Label>
                  <Input
                    id="reg"
                    value={form.registrationNo}
                    onChange={(e) => setForm({ ...form, registrationNo: e.target.value })}
                    placeholder="e.g. HSG/1234/2008"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="regdate">Registration date</Label>
                  <Input
                    id="regdate"
                    type="date"
                    value={form.registrationDate}
                    onChange={(e) => setForm({ ...form, registrationDate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Date of registration with the registrar of co-operative societies.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Registered address & contact
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="Plot 12, Silverwood Road"
                  />
                </div>
                <div className="space-y-2"><Label htmlFor="city">City</Label>
                  <Input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="state">State</Label>
                  <Input id="state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="pincode">PIN code</Label>
                  <Input id="pincode" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
            </section>
          </TabsContent>

          {/* --- Financial Period tab --- */}
          <TabsContent value="period" className="mt-2 space-y-8">
            <section className="space-y-4">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Financial period
              </h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="fystart">Financial year starts</Label>
                  <Select
                    value={String(form.fyStartMonth)}
                    onValueChange={(v) => setForm({ ...form, fyStartMonth: Number(v) })}
                  >
                    <SelectTrigger id="fystart"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    April is standard for Indian co-operative societies.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fyear">Financial year</Label>
                  <Input
                    id="fyear"
                    value={form.fyYear}
                    onChange={(e) => setForm({ ...form, fyYear: e.target.value })}
                    placeholder="2025-26"
                  />
                  <p className="text-xs text-muted-foreground">
                    Display label for the current period, e.g. 2025-26.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fystartdate">Start date</Label>
                  <Input
                    id="fystartdate"
                    type="date"
                    value={form.fyStartDate}
                    onChange={(e) => setForm({ ...form, fyStartDate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to follow the start month automatically.
                  </p>
                </div>
              </div>
            </section>

            {!isNew && society && (
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Effective period
                </h3>
                <div className="panel grid gap-4 p-5 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Financial year</p>
                    <p className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums">
                      {form.fyYear || period.label}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Runs from</p>
                    <p className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums">
                      {form.fyStartDate ? form.fyStartDate : period.from}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Through</p>
                    <p className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums">
                      {form.fyStartDate ? endOfPeriod(form.fyStartDate) : period.to}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  New ledgers, reports and the dashboard default to this period. Saving applies it
                  immediately.
                </p>
              </section>
            )}
          </TabsContent>

          {/* --- Committee Members tab --- */}
          <TabsContent value="committee" className="mt-2 space-y-8">
            <section className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Office-bearers
                  </h3>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                    Select the managing committee from the society's member register. Office-bearers
                    appear on bills, receipts and statements.
                  </p>
                </div>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  <Users className="size-3.5" />
                  {memberOptions.length} member{memberOptions.length === 1 ? "" : "s"} available
                </span>
              </div>

              {memberOptions.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm font-medium">No members yet</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
                    Add members first — committee positions are chosen from the register. Use the
                    Members page or import them from Excel.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  {ROLES.map((r) => (
                    <div key={r.key} className="space-y-2">
                      {memberSelect(r.key, r.label)}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {memberOptions.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Current assignments
                </h3>
                <div className="panel">
                  <ul className="divide-y">
                    {ROLES.map((r) => {
                      const id = form[r.key];
                      const member = memberOptions.find((m) => m._id === id);
                      return (
                        <li key={r.key} className="flex items-center gap-3 px-5 py-3.5 text-sm">
                          {member ? (
                            <CheckCircle2 className="size-4 text-foreground" strokeWidth={1.5} />
                          ) : (
                            <Circle className="size-4 text-muted-foreground/40" strokeWidth={1.5} />
                          )}
                          <span className="w-24 font-medium">{r.label}</span>
                          <span className="text-muted-foreground">
                            {member
                              ? `${member.name}${[member.wing, member.flatNo].filter(Boolean).length ? ` · ${[member.wing, member.flatNo].filter(Boolean).join("-")}` : ""}`
                              : "Not assigned"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            )}
          </TabsContent>

          {/* --- Accounting tab --- */}
          {!isNew && (
            <TabsContent value="accounting" className="mt-2 space-y-8">
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Accounting defaults
                </h3>
                {receivableOptions.length > 0 ? (
                  <div className="max-w-md space-y-2">
                    <Label>Members Receivable account</Label>
                    <Select
                      value={form.receivableAccountId || undefined}
                      onValueChange={(v) => setForm({ ...form, receivableAccountId: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                      <SelectContent>
                        {receivableOptions.map((a) => (
                          <SelectItem key={a._id} value={a._id}>
                            {a.code} — {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Credited automatically by member receipts and debited by generated bills.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Add accounts in the Chart of Accounts to configure defaults.
                  </p>
                )}
              </section>
              <section className="space-y-4">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Member UPI payments
                </h3>
                <div className="max-w-md space-y-2">
                  <Label htmlFor="upi-vpa">UPI ID (VPA) for member payments</Label>
                  <Input
                    id="upi-vpa"
                    value={form.upiVpa}
                    onChange={(e) => setForm({ ...form, upiVpa: e.target.value })}
                    placeholder="e.g. greenmeadowschs@hdfcbank"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    Once saved, every member gets a personal QR code in their portal and each
                    bill carries a scannable QR that pays straight into this UPI ID. No gateway
                    or fees — money lands directly in your society's bank account. Verify with
                    a ₹1 transfer first.
                  </p>
                </div>
              </section>
            </TabsContent>
          )}
        </Tabs>

        {/* Danger zone — the only place a society can be erased, always manual. */}
        {!isNew && society && (
          <div className="mt-10 rounded-lg border border-destructive/40 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 size-4 text-destructive" />
                <div>
                  <p className="text-sm font-medium">Delete this society</p>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                    Societies are permanent records — nothing is deleted by logging in or out,
                    and your books follow your account to any PC. Deletion happens only here,
                    by you, and removes every member, bill and voucher permanently.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={role !== "owner"}
                className="shrink-0 rounded-lg border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setDeleteConfirmText("");
                  setDeleteOpen(true);
                }}
              >
                Delete society
              </Button>
            </div>
          </div>
        )}

        <div className="mt-10 flex items-center justify-end gap-3 border-t pt-6">
          <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
            {todayISO() && <span>Changes apply to this society's books immediately.</span>}
          </p>
          <Button type="submit" disabled={saving || (!isNew && role !== "owner")} className="rounded-lg px-8">
            <Save className="size-4" />
            {saving ? "Saving…" : isNew ? "Onboard society" : "Save changes"}
          </Button>
        </div>
      </form>

      {/* Typed-confirmation delete dialog. */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{society?.name}”?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              This permanently erases the society together with its members, chart of
              accounts, tariffs, member tariff overrides, bills, vouchers and claim
              state. It cannot be undone.
            </p>
            <div className="space-y-2">
              <Label htmlFor="del-confirm">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                id="del-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting || deleteConfirmText !== "DELETE"}
              onClick={deleteThisSociety}
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function endOfPeriod(startDate: string): string {
  const d = new Date(startDate + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
