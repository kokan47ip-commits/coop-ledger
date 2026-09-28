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
import { MENU_REGISTRY } from "@/lib/menus";
import { KeyRound, Pencil, Plus, ShieldCheck, SlidersHorizontal, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { Checkbox } from "@/components/ui/checkbox";

type Grant = {
  _id: Id<"membersAccess">;
  email: string;
  role: "editor" | "viewer" | "member";
  menus: string[] | null;
  createdAt: number;
  joined: boolean;
  name: string | null;
  memberId: Id<"members"> | null;
  memberName: string | null;
  memberFlat: string | null;
};

type MemberRow = Doc<"members">;

function useUsersRightsData(societyId: Id<"societies"> | null, canManage: boolean) {
  const grants = useQuery(
    api.access.listForSociety,
    societyId && canManage ? { societyId } : "skip",
  ) as Grant[] | undefined;
  const members = useQuery(
    api.members.list,
    societyId && canManage ? { societyId } : "skip",
  ) as MemberRow[] | undefined;
  return { grants, members };
}

const ROLE_HELP: Record<"editor" | "viewer" | "member", string> = {
  editor:
    "Can enter vouchers, bills, masters and upload Excel data — everything except society-level settings and user rights.",
  viewer:
    "Read-only: can open every register and report but cannot save or change any entry.",
  member:
    "Flat-bound portal login: sees only their own ledger, bills and receipts, can make payments and manage their profile. No access to the society's books.",
};

export default function UsersRights() {
  const { societyId, role, isAdmin } = useSociety();
  const canManage = role === "owner" || isAdmin;
  const { grants, members } = useUsersRightsData(societyId, canManage);

  const grantAccess = useMutation(api.access.grant);
  const grantFromMember = useMutation(api.access.grantFromMember);
  const setRole = useMutation(api.access.setRole);
  const setMenus = useMutation(api.access.setMenus);
  const revokeAccess = useMutation(api.access.revoke);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"member" | "email">("member");
  const [memberId, setMemberId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [email, setEmail] = useState("");
  const [formRole, setFormRole] = useState<"editor" | "viewer" | "member">("editor");
  const [formMenus, setFormMenus] = useState<string[]>([]); // empty = all menus
  const [editing, setEditing] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuTarget, setMenuTarget] = useState<Grant | null>(null);
  const [menuPicks, setMenuPicks] = useState<string[]>([]);

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
    setFormMenus([]);
    setOpen(true);
  };

  const openMenus = (g: Grant) => {
    setMenuTarget(g);
    setMenuPicks(g.menus ?? []);
  };

  const saveMenus = async () => {
    if (!societyId || !menuTarget) return;
    setBusy(true);
    try {
      await setMenus({ societyId, id: menuTarget._id, menus: menuPicks });
      toast.success(
        menuPicks.length === 0
          ? `${menuTarget.email} now sees all menus`
          : `${menuTarget.email} menu access updated`,
      );
      setMenuTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusy(false);
    }
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
          menus: formMenus.length > 0 ? formMenus : undefined,
        });
        toast.success(
          formRole === "member"
            ? `${member?.name ?? "Member"} gets a portal login with ${loginEmail} — they will see only their own flat.`
            : `${member?.name ?? "Member"} can now sign in with ${loginEmail} as ${formRole}.`,
        );
      } else {
        await grantAccess({
          societyId,
          email,
          role: formRole,
          menus: formMenus.length > 0 ? formMenus : undefined,
        });
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
        description="Add users, set their role and choose exactly which menus they can open. The society owner and software admins keep full control."
        actions={
          canManage ? (
            <Button className="rounded-lg" onClick={openInvite}>
              <Plus className="size-4" /> Add user
            </Button>
          ) : undefined
        }
      />

      {!canManage ? (
        <EmptyHint>
          Only the society owner or a software admin can manage user rights.
        </EmptyHint>
      ) : (
      <>
      <div className="mb-6 grid gap-4 md:grid-cols-4">
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
        <div className="rounded-lg border border-border/80 bg-card p-5 shadow-md shadow-slate-950/[0.05]">
          <p className="text-sm font-semibold">Member portal</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {ROLE_HELP.member}
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
                <TableHead>Menus</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
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
                  <TableCell className="capitalize">
                    {g.role === "member" ? (
                      <span title="Flat-bound portal login">
                        Member portal
                        {g.memberFlat ? ` — ${g.memberFlat}` : ""}
                      </span>
                    ) : (
                      g.role
                    )}
                  </TableCell>
                  <TableCell>
                    {g.role === "member" ? (
                      <span
                        className="cursor-default text-xs text-muted-foreground"
                        title="Portal members always see their own flat only"
                      >
                        My flat only
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openMenus(g)}
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        title="Choose which menus this user can open"
                      >
                        {g.menus && g.menus.length > 0
                          ? `${g.menus.length} menu${g.menus.length > 1 ? "s" : ""}`
                          : "All menus"}
                      </button>
                    )}
                  </TableCell>
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
                        title="Menu access"
                        onClick={() => openMenus(g)}
                        disabled={g.role === "member"}
                      >
                        <SlidersHorizontal className="size-3.5" />
                      </Button>
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
                    The member signs in with this email — via a password or an
                    emailed one-time code. If it differs from the one on their
                    profile, the profile is updated automatically.
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
                onValueChange={(v) => setFormRole(v as "editor" | "viewer" | "member")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor — enter & edit data</SelectItem>
                  <SelectItem value="viewer">Viewer — read-only</SelectItem>
                  <SelectItem value="member">Member portal — only their flat</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                {ROLE_HELP[formRole]}
              </p>
            </div>
            {!editing && formRole !== "member" && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <p className="text-xs font-medium">Menu access</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {formMenus.length === 0
                    ? "All menus will be visible. Use the sliders button on the user's row after saving to restrict which menus they can open."
                    : `${formMenus.length} menu(s) selected — they will see only those.`}
                </p>
                <div className="max-h-36 space-y-1 overflow-y-auto">
                  {MENU_REGISTRY.filter((m) => m.key !== "users").map((m) => {
                    const checked = formMenus.includes(m.key);
                    return (
                      <label
                        key={m.key}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            setFormMenus((prev) =>
                              v === true
                                ? [...prev, m.key]
                                : prev.filter((k) => k !== m.key),
                            )
                          }
                        />
                        <m.icon className="size-3.5 text-muted-foreground" />
                        {m.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
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

      {/* Menu-permission dialog */}
      <Dialog open={!!menuTarget} onOpenChange={(o) => !o && setMenuTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Menu access — {menuTarget?.email}</DialogTitle>
          </DialogHeader>
          <p className="text-xs leading-5 text-muted-foreground">
            Tick the menus this user may open. Leave everything unticked to allow
            all menus (except administration). Changes apply the next time they
            load a page.
          </p>
          <div className="max-h-[50vh] space-y-4 overflow-y-auto rounded-lg border p-4">
            {(Object.keys(MENU_SECTIONS) as MenuSectionKey[]).map((section) => (
              <div key={section}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {section}
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {MENU_REGISTRY.filter((m) => m.section === section && m.key !== "users").map((m) => {
                    const checked = menuPicks.includes(m.key);
                    return (
                      <label
                        key={m.key}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            setMenuPicks((prev) =>
                              v === true
                                ? [...prev, m.key]
                                : prev.filter((k) => k !== m.key),
                            )
                          }
                        />
                        <m.icon className="size-3.5 text-muted-foreground" />
                        {m.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-muted-foreground"
              onClick={() => setMenuPicks(MENU_REGISTRY.map((m) => m.key).filter((k) => k !== "users"))}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-muted-foreground"
              onClick={() => setMenuPicks([])}
            >
              Clear (allow all)
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMenuTarget(null)}>
              Cancel
            </Button>
            <Button onClick={saveMenus} disabled={busy}>
              Save menu access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
      )}

      {/* Software administrators — visible only to software admins. */}
      {isAdmin && <SoftwareAdminsSection />}
      {isAdmin && <AdminResetPasswordSection />}

      {/* Office-side portal diagnosis — answers "why does a member's portal show nothing?" */}
      {canManage && <PortalDiagnosis canManage={canManage} />}
    </div>
  );
}

const MENU_SECTIONS = {
  Overview: null,
  Masters: null,
  Transactions: null,
  Reports: null,
  Data: null,
} as const;
type MenuSectionKey = keyof typeof MENU_SECTIONS;

type PortalBindingRow = {
  email: string | null;
  grant: { id: Id<"membersAccess">; email: string; memberId: Id<"members"> | null } | null;
  bound: { name: string; flatNo?: string; wing?: string; code?: string; isActive: boolean; bills: number } | null;
  emailMatch: { name: string; flatNo?: string; wing?: string; code?: string; isActive: boolean; bills: number } | null;
  flatMatch: { name: string; flatNo?: string; wing?: string; code?: string; isActive: boolean; bills: number } | null;
  resolved: { name: string; flatNo?: string; wing?: string; code?: string; isActive: boolean; bills: number } | null;
  resolvedBy: string | null;
  activeMemberCount: number;
  activeMembersWithBills: number;
  totalBillsOnActiveMembers: number;
  accountExists: boolean;
  allEmailGrants: { role: string; memberId: Id<"members"> | null }[];
  verdict: string[];
};

const flatLabel = (m: { wing?: string; flatNo?: string; code?: string }) =>
  [m.wing, m.flatNo].filter(Boolean).join("-") || m.code || "?";

/**
 * "Member portal shows nothing" triage. The office types the member's login
 * email and gets exactly where the portal resolver points, where the bills
 * actually sit, and a concrete fix — without touching the member's data.
 */
function PortalDiagnosis({ canManage }: { canManage: boolean }) {
  const { societyId } = useSociety();
  const [email, setEmail] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const result = useQuery(
    api.access.debugPortalBinding,
    canManage && societyId && checked ? { societyId, email: checked } : "skip",
  ) as PortalBindingRow | undefined;

  const runCheck = (e: React.FormEvent) => {
    e.preventDefault();
    setChecked(email.trim());
  };

  return (
    <section className="mt-10 border-t pt-8">
      <div className="mb-4 flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-emerald-600" /> Portal login diagnosis
        </h3>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          If a member says their portal shows no bills or receipts, enter the
          email they sign in with. This shows which flat the login is linked
          to, where the bills actually sit, and exactly what to fix.
        </p>
      </div>
      <form onSubmit={runCheck} className="mb-4 flex max-w-md gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="member-login@example.com"
        />
        <Button type="submit" className="shrink-0">
          <ShieldCheck className="size-4" /> Check
        </Button>
      </form>

      {!result ? null : (
        <div className="max-w-2xl space-y-3 rounded-lg border bg-card p-4 shadow-sm">
          <div className="grid gap-2 text-xs leading-5">
            <p>
              <span className="font-medium">Account:</span>{" "}
              {result.accountExists
                ? `${checked} — exists and has signed in (or office set a password)`
                : `${checked} — no account yet; the member must sign in once, or set their password in Members to create it`}
            </p>
            <p>
              <span className="font-medium">Portal grant:</span>{" "}
              {result.grant
                ? `member role, linked to ${result.bound ? flatLabel(result.bound) : "(no flat)"}`
                : result.allEmailGrants.length > 0
                  ? `none — this email holds a ${result.allEmailGrants[0].role} grant instead`
                  : "none for this email"}
            </p>
            <p>
              <span className="font-medium">Portal resolves to:</span>{" "}
              {result.resolved
                ? `${result.resolved.name} (flat ${flatLabel(result.resolved)}) — ${result.resolved.bills} bill(s). ${result.resolvedBy ?? ""}`
                : "nothing — no usable member row for this login"}
            </p>
            <p>
              <span className="font-medium">Bills in society:</span>{" "}
              {result.totalBillsOnActiveMembers} across {result.activeMembersWithBills} of {result.activeMemberCount} active member(s)
            </p>
            {result.emailMatch && result.emailMatch.bills > 0 && result.resolved?.bills === 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                A member row carrying this email (flat {flatLabel(result.emailMatch)}) holds {result.emailMatch.bills} bill(s) — re-grant the login onto that flat.
              </p>
            )}
          </div>
          <div className="space-y-1.5 border-t pt-3">
            {result.verdict.map((v, i) => (
              <p key={i} className="text-xs leading-5 text-muted-foreground">{v}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AdminResetPasswordSection() {
  const adminSetPassword = useMutation(api.users.adminSetPassword);
  const [email, setEmail] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !newPw) return;
    if (
      !confirm(
        `Set a new password for ${email}? They will sign in with this password immediately.`,
      )
    )
      return;
    setBusy(true);
    try {
      await adminSetPassword({ email, newPassword: newPw });
      toast.success(
        `Password reset — ${email} can now sign in with the new password.`,
      );
      setEmail("");
      setNewPw("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 border-t pt-8">
      <div className="mb-4 flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-violet-600" /> Reset any account's
          password
        </h3>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          Locked out, or a member's sign-in isn't accepting their password? As a
          software admin you can set a fresh password for any account by email —
          no current password needed. 8+ characters with at least 1 number.
        </p>
      </div>
      <form onSubmit={submit} className="flex max-w-lg flex-wrap gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          className="min-w-56 flex-1"
        />
        <Input
          type="text"
          required
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          placeholder="New password (8+ chars, 1 number)"
          className="min-w-56 flex-1"
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          <KeyRound className="size-4" />
          {busy ? "Resetting…" : "Reset password"}
        </Button>
      </form>
    </section>
  );
}

function SoftwareAdminsSection() {
  const admins = useQuery(api.access.listSoftwareAdmins) as
    | { _id: Id<"users">; email: string; name: string | null }[]
    | undefined;
  const setSoftwareAdmin = useMutation(api.access.setSoftwareAdmin);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const promote = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await setSoftwareAdmin({ email, admin: true });
      toast.success(`${email} is now a software admin`);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const demote = async (a: { email: string; _id: Id<"users"> }) => {
    if (!confirm(`Remove software admin rights from ${a.email}?`)) return;
    try {
      await setSoftwareAdmin({ email: a.email, admin: false });
      toast.success("Admin rights removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <section className="mt-10 border-t pt-8">
      <div className="mb-4 flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-amber-600" /> Software administrators
        </h3>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
          Software admins can open every society in the system, manage each
          society's user rights and decide which menus every user can see.
          Promote an account that already exists (they must have signed in once).
        </p>
      </div>
      <form onSubmit={promote} className="mb-4 flex max-w-md gap-2">
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="existing-user@example.com"
        />
        <Button type="submit" disabled={busy} className="shrink-0">
          <Plus className="size-4" /> Make admin
        </Button>
      </form>
      {!admins ? null : admins.length === 0 ? (
        <p className="text-xs text-muted-foreground">No other software admins.</p>
      ) : (
        <div className="max-w-md space-y-1">
          {admins.map((a) => (
            <div
              key={a._id}
              className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{a.name ?? a.email}</p>
                {a.name && <p className="text-xs text-muted-foreground">{a.email}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => demote(a)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
