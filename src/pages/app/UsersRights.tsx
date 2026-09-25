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
import { EmptyHint, PageHeader } from "@/components/PageParts";
import { Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";

type Grant = {
  _id: Id<"membersAccess">;
  email: string;
  role: "editor" | "viewer";
  createdAt: number;
  joined: boolean;
  name: string | null;
};

type MemberRow = Doc<"members">;

function useUsersRightsData(societyId: Id<"societies"> | null, isOwner: boolean) {
  const grants = useQuery(
    api.access.listForSociety,
    societyId && isOwner ? { societyId } : "skip",
  ) as Grant[] | undefined;
  const members = useQuery(
    api.members.list,
    societyId && isOwner ? { societyId } : "skip",
  ) as MemberRow[] | undefined;
  return { grants, members };
}

const ROLE_HELP: Record<"editor" | "viewer", string> = {
  editor:
    "Can enter vouchers, bills, masters and upload Excel data — everything except society-level settings and user rights.",
  viewer:
    "Read-only: can open every register and report but cannot save or change any entry.",
};

export default function UsersRights() {
  const { societyId, role } = useSociety();
  const isOwner = role === "owner";
  const { grants, members } = useUsersRightsData(societyId, isOwner);

  const grantAccess = useMutation(api.access.grant);
  const grantFromMember = useMutation(api.access.grantFromMember);
  const setRole = useMutation(api.access.setRole);
  const revokeAccess = useMutation(api.access.revoke);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"member" | "email">("member");
  const [memberId, setMemberId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [email, setEmail] = useState("");
  const [formRole, setFormRole] = useState<"editor" | "viewer">("editor");
  const [editing, setEditing] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);

  const memberOptions = useMemo(() => {
    return [...(members ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);

  const openInvite = () => {
    setEditing(null);
    setMode("member");
    setMemberId("");
    setMemberEmail("");
    setEmail("");
    setFormRole("editor");
    setOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!societyId) return;
    setBusy(true);
    try {
      if (editing) {
        await setRole({ societyId, id: editing._id, role: formRole });
        toast.success(`${editing.email} is now ${formRole}`);
      } else if (mode === "member") {
        if (!memberId) throw new Error("Pick a member from the list.");
        const member = memberOptions.find((m) => m._id === memberId);
        const loginEmail = (memberEmail || member?.email || "").trim();
        if (!loginEmail)
          throw new Error(
            "Enter the email this member will sign in with.",
          );
        await grantFromMember({
          societyId,
          memberId: memberId as Id<"members">,
          email: loginEmail,
          role: formRole,
        });
        toast.success(
          `${member?.name ?? "Member"} can now sign in with ${loginEmail} as ${formRole}.`,
        );
      } else {
        await grantAccess({ societyId, email, role: formRole });
        toast.success(
          `Invitation saved — ${email} gets ${formRole} access on sign-in with this email.`,
        );
      }
      setOpen(false);
      setEditing(null);
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
            <Button className="rounded-lg" onClick={openInvite}>
              <Plus className="size-4" /> Add user
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
          No extra users yet. Add one of your society's members or invite your
          accountant by email — they get access the moment they sign in with
          the assigned email address.
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
            <DialogTitle>{editing ? "Change role" : "Add user"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            {!editing && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-1">
                <button
                  type="button"
                  onClick={() => setMode("member")}
                  className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    mode === "member"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  <Users className="size-4" /> Existing member
                </button>
                <button
                  type="button"
                  onClick={() => setMode("email")}
                  className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    mode === "email"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  <UserPlus className="size-4" /> Other email
                </button>
              </div>
            )}
            {!editing && mode === "member" && (
              <>
                <div className="space-y-2">
                  <Label>Member *</Label>
                  <Select
                    value={memberId || undefined}
                    onValueChange={(v) => {
                      setMemberId(v);
                      const m = memberOptions.find((x) => x._id === v);
                      setMemberEmail(m?.email ?? "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a member from the register" />
                    </SelectTrigger>
                    <SelectContent>
                      {memberOptions.map((m) => (
                        <SelectItem key={m._id} value={m._id}>
                          {m.flatNo ? `${m.flatNo} — ` : ""}
                          {m.name}
                          {m.code ? ` (${m.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {memberOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No members in the register yet — add members first, or use
                      “Other email” to invite by email.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="u-member-email">Login email *</Label>
                  <Input
                    id="u-member-email"
                    type="email"
                    required
                    value={memberEmail}
                    onChange={(e) => setMemberEmail(e.target.value)}
                    placeholder="member@example.com"
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    The member signs in with this email. If it differs from the
                    one on their profile, the profile is updated automatically.
                  </p>
                </div>
              </>
            )}
            {!editing && mode === "email" && (
              <div className="space-y-2">
                <Label htmlFor="u-email">Email *</Label>
                <Input
                  id="u-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="accountant@example.com"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  For staff who are not society members — they get access when
                  they sign in with this email.
                </p>
              </div>
            )}
            {editing && (
              <div className="space-y-2">
                <Label htmlFor="u-email-edit">Email</Label>
                <Input
                  id="u-email-edit"
                  type="email"
                  required
                  value={email}
                  disabled
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Email is fixed — remove and re-invite to change it.
                </p>
              </div>
            )}
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
                {editing ? "Save role" : mode === "member" ? "Grant access" : "Send invite"}
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
