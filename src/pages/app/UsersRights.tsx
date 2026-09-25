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
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

type Grant = {
  _id: Id<"membersAccess">;
  email: string;
  role: "editor" | "viewer";
  createdAt: number;
  joined: boolean;
  name: string | null;
};

const ROLE_HELP: Record<"editor" | "viewer", string> = {
  editor:
    "Can enter vouchers, bills, masters and upload Excel data — everything except society-level settings and user rights.",
  viewer:
    "Read-only: can open every register and report but cannot save or change any entry.",
};

export default function UsersRights() {
  const { societyId, role } = useSociety();
  const isOwner = role === "owner";
  const grants = useQuery(
    api.access.listForSociety,
    societyId && isOwner ? { societyId } : "skip",
  ) as Grant[] | undefined;

  const grantAccess = useMutation(api.access.grant);
  const setRole = useMutation(api.access.setRole);
  const revokeAccess = useMutation(api.access.revoke);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [formRole, setFormRole] = useState<"editor" | "viewer">("editor");
  const [editing, setEditing] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    setBusy(true);
    try {
      if (editing) {
        await setRole({ societyId, id: editing._id, role: formRole });
        toast.success(`${editing.email} is now ${formRole}`);
      } else {
        await grantAccess({ societyId, email, role: formRole });
        toast.success(
          `Invitation saved — ${email} gets ${formRole} access on sign-in with this email.`,
        );
      }
      setOpen(false);
      setEditing(null);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const del = async (g: Grant) => {
    if (!societyId) return;
    if (!confirm(`Remove access for ${g.email}?`)) return;
    try {
      await revokeAccess({ societyId, id: g._id });
      toast.success("Access removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  return (
    <div>
      <PageHeader
        title="Users & Rights"
        description="Invite colleagues by email and control what they can do in this society's books. The society owner always keeps full control."
        actions={
          isOwner ? (
            <Button
              className="rounded-lg"
              onClick={() => {
              setEditing(null);
              setEmail("");
              setFormRole("editor");
              setOpen(true);
              }}
            >
              <Plus className="size-4" /> Invite user
            </Button>
          ) : undefined
        }
      />

      {!isOwner ? (
        <EmptyHint>
          Only the society owner can manage user rights.
        </EmptyHint>
      ) : (
      <>
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border/80 bg-card p-5 shadow-md shadow-slate-950/[0.05]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <p className="text-sm font-semibold">Owner (you)</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Full control — everything an editor can do, plus society settings,
            user rights and deletion.
          </p>
        </div>
        <div className="rounded-lg border border-border/80 bg-card p-5 shadow-md shadow-slate-950/[0.05]">
          <p className="text-sm font-semibold">Editor</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {ROLE_HELP.editor}
          </p>
        </div>
        <div className="rounded-lg border border-border/80 bg-card p-5 shadow-md shadow-slate-950/[0.05]">
          <p className="text-sm font-semibold">Viewer</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {ROLE_HELP.viewer}
          </p>
        </div>
      </div>

      {!grants ? null : grants.length === 0 ? (
        <EmptyHint>
          No extra users yet. Invite your accountant or secretary by email —
          they get access the moment they sign in with that email address.
        </EmptyHint>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={g._id}>
                  <TableCell>
                    <p className="font-medium">{g.name ?? g.email}</p>
                    {g.name && (
                      <p className="text-xs text-muted-foreground">{g.email}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        g.joined
                          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                          : "border-amber-500/40 text-amber-600 dark:text-amber-400"
                      }
                    >
                      {g.joined ? "Active" : "Invited"}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{g.role}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(g.createdAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => {
                          setEditing(g);
                          setEmail(g.email);
                          setFormRole(g.role);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        onClick={() => del(g)}
                      >
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

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Change role" : "Invite user"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="u-email">Email *</Label>
              <Input
                id="u-email"
                type="email"
                required
                value={email}
                disabled={!!editing}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="accountant@example.com"
              />
              {editing && (
                <p className="text-xs text-muted-foreground">
                  Email is fixed — remove and re-invite to change it.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={formRole}
                onValueChange={(v) => setFormRole(v as "editor" | "viewer")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor — enter & edit data</SelectItem>
                  <SelectItem value="viewer">Viewer — read-only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                {ROLE_HELP[formRole]}
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {editing ? "Save role" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}
