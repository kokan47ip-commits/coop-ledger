import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { EmptyHint, PageHeader, RightMoney } from "@/components/PageParts";
import { formatDate, formatINR, fyStartISO } from "@/lib/format";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type MemberRow = {
  _id: Id<"members">;
  code: string;
  name: string;
  flatNo?: string;
  wing?: string;
  phone?: string;
  email?: string;
  ownershipType?: "owner" | "tenant";
  joinDate?: string;
  openingBalance: number;
  openingDate?: string;
  isActive: boolean;
};

const emptyForm = {
  id: "" as Id<"members"> | "",
  code: "",
  name: "",
  flatNo: "",
  wing: "",
  phone: "",
  email: "",
  ownershipType: "owner",
  joinDate: "",
  openingBalance: "0",
  openingDate: fyStartISO(),
  isActive: true,
};

export default function Members() {
  const { societyId } = useSociety();
  const members = useQuery(
    api.members.list,
    societyId ? { societyId } : "skip",
  ) as MemberRow[] | undefined;
  const upsert = useMutation(api.members.upsert);
  const remove = useMutation(api.members.remove);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const filtered = useMemo(() => {
    const list = members ?? [];
    const q = query.trim().toLowerCase();
    const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code));
    if (!q) return sorted;
    return sorted.filter((m) =>
      [m.code, m.name, m.flatNo ?? "", m.wing ?? "", m.phone ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [members, query]);

  const openNew = () => {
    setForm({ ...emptyForm, openingDate: fyStartISO() });
    setOpen(true);
  };

  const openEdit = (m: MemberRow) => {
    setForm({
      id: m._id,
      code: m.code,
      name: m.name,
      flatNo: m.flatNo ?? "",
      wing: m.wing ?? "",
      phone: m.phone ?? "",
      email: m.email ?? "",
      ownershipType: m.ownershipType ?? "owner",
      joinDate: m.joinDate ?? "",
      openingBalance: String(m.openingBalance),
      openingDate: m.openingDate ?? fyStartISO(),
      isActive: m.isActive,
    });
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    try {
      await upsert({
        societyId,
        id: form.id || undefined,
        code: form.code.trim(),
        name: form.name.trim(),
        flatNo: form.flatNo || undefined,
        wing: form.wing || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        ownershipType: form.ownershipType as "owner" | "tenant",
        joinDate: form.joinDate || undefined,
        openingBalance: Number(form.openingBalance) || 0,
        openingDate: form.openingDate || undefined,
        isActive: form.isActive,
      });
      toast.success(form.id ? "Member updated" : "Member added");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save member");
    }
  };

  const del = async (m: MemberRow) => {
    if (!societyId) return;
    if (!confirm(`Delete member ${m.code} — ${m.name}?`)) return;
    try {
      await remove({ societyId, id: m._id });
      toast.success("Member deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div>
      <PageHeader
        title="Members"
        description="Member register with opening receivable balances. Opening balances flow into member ledgers and the balance sheet."
        actions={
          <Button onClick={openNew} className="rounded-full">
            <Plus className="size-4" /> Add member
          </Button>
        }
      />

      <div className="mb-4 relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search code, name, flat…"
          className="pl-9"
        />
      </div>

      {!members ? null : filtered.length === 0 ? (
        <EmptyHint>
          No members yet. Add members manually or use Excel upload.
        </EmptyHint>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Flat</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m._id}>
                  <TableCell className="font-medium">{m.code}</TableCell>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>
                    {[m.wing, m.flatNo].filter(Boolean).join("-") || "—"}
                  </TableCell>
                  <TableCell className="capitalize">{m.ownershipType ?? "—"}</TableCell>
                  <TableCell>{m.phone ?? "—"}</TableCell>
                  <TableCell className="text-right"><RightMoney value={m.openingBalance} /></TableCell>
                  <TableCell>
                    <Badge variant={m.isActive ? "secondary" : "outline"}>
                      {m.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(m)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => del(m)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit member" : "Add member"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-code">Member code *</Label>
                <Input id="m-code" required value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="M001" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-name">Name *</Label>
                <Input id="m-name" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-wing">Wing / Building</Label>
                <Input id="m-wing" value={form.wing}
                  onChange={(e) => setForm({ ...form, wing: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-flat">Flat no.</Label>
                <Input id="m-flat" value={form.flatNo}
                  onChange={(e) => setForm({ ...form, flatNo: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-phone">Phone</Label>
                <Input id="m-phone" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-email">Email</Label>
                <Input id="m-email" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Ownership</Label>
                <Select value={form.ownershipType}
                  onValueChange={(v) => setForm({ ...form, ownershipType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="tenant">Tenant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-join">Join date</Label>
                <Input id="m-join" type="date" value={form.joinDate}
                  onChange={(e) => setForm({ ...form, joinDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-open">Opening balance (₹)</Label>
                <Input id="m-open" type="number" step="0.01" value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-open-date">Opening as on</Label>
                <Input id="m-open-date" type="date" value={form.openingDate}
                  onChange={(e) => setForm({ ...form, openingDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.isActive ? "active" : "inactive"}
                  onValueChange={(v) => setForm({ ...form, isActive: v === "active" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">{form.id ? "Save changes" : "Add member"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
