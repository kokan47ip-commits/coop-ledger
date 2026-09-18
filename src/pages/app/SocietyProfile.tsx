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
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import { PageHeader } from "@/components/PageParts";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function SocietyProfile() {
  const { society, setActiveId } = useSociety();
  const accounts = useQuery(
    api.accounts.list,
    society ? { societyId: society._id } : "skip",
  );
  const createSociety = useMutation(api.societies.create);
  const updateSociety = useMutation(api.societies.update);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isNew = params.get("new") === "1" || !society;

  const [form, setForm] = useState({
    name: "",
    registrationNo: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    email: "",
    phone: "",
    fyStartMonth: 4,
    receivableAccountId: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (society && !isNew) {
      setForm({
        name: society.name ?? "",
        registrationNo: society.registrationNo ?? "",
        address: society.address ?? "",
        city: society.city ?? "",
        state: society.state ?? "",
        pincode: society.pincode ?? "",
        email: society.email ?? "",
        phone: society.phone ?? "",
        fyStartMonth: society.fyStartMonth ?? 4,
        receivableAccountId: society.receivableAccountId ?? "",
      });
    }
  }, [society, isNew]);

  const receivableOptions = (accounts ?? []).filter(
    (a) => a.kind === "bank_cash" || a.kind === "receivable" || a.type === "asset",
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) {
        const id = await createSociety({
          name: form.name.trim(),
          registrationNo: form.registrationNo || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          pincode: form.pincode || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          fyStartMonth: form.fyStartMonth,
        });
        setActiveId(id);
        toast.success("Society created with default chart of accounts");
        navigate("/app/society");
      } else if (society) {
        await updateSociety({
          id: society._id,
          name: form.name.trim(),
          registrationNo: form.registrationNo || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          pincode: form.pincode || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          fyStartMonth: form.fyStartMonth,
          receivableAccountId: form.receivableAccountId
            ? (form.receivableAccountId as never)
            : undefined,
        });
        toast.success("Society profile updated");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={isNew ? "Onboard a client society" : "Society Profile"}
        description={
          isNew
            ? "Register a client society to open its books. The standard chart of accounts is generated automatically, ready for tariffs, bills and vouchers."
            : "These details appear on every bill, voucher and statement issued for this society."
        }
      />
      <form onSubmit={submit} className="space-y-8">
        <section className="space-y-4">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Identity</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">Society name *</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Silverwood CHS Ltd."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg">Registration no.</Label>
              <Input
                id="reg"
                value={form.registrationNo}
                onChange={(e) => setForm({ ...form, registrationNo: e.target.value })}
                placeholder="e.g. HSG/1234/2008"
              />
            </div>
            <div className="space-y-2">
              <Label>FY starts</Label>
              <Select
                value={String(form.fyStartMonth)}
                onValueChange={(v) => setForm({ ...form, fyStartMonth: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Address & contact</h3>
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

        {!isNew && receivableOptions.length > 0 && (
          <section className="space-y-4">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Accounting defaults</h3>
            <div className="space-y-2">
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
                Credited automatically by member receipts; debited by generated bills.
              </p>
            </div>
          </section>
        )}

        <div className="flex justify-end gap-2 border-t pt-6">
        <Button type="submit" disabled={saving} className="rounded-none px-6">
          {saving ? "Saving…" : isNew ? "Onboard society" : "Save changes"}
        </Button>
        </div>
      </form>
    </div>
  );
}
