import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import PortalFlatSelect, { usePortalFlatId } from "@/components/PortalFlatSelect";
import { IconTile, PageHeader } from "@/components/PageParts";
import { useAuth } from "@/hooks/use-auth";
import {
  BadgeCheck,
  KeyRound,
  Phone,
  Save,
  UserCircle,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

export default function PortalProfile() {
  const { societyId } = useSociety();
  const { user } = useAuth();
  // Multi-flat logins pick the flat in the selector (?flat=…) — the profile
  // shown (and the contact details updated) belong to THAT flat's member row.
  const flat = usePortalFlatId();
  const info = useQuery(
    api.memberPortal.myInfo,
    societyId ? { societyId, memberId: flat } : "skip",
  );

  const updateContact = useMutation(api.memberPortal.updateMyContact);
  const changePassword = useMutation(api.memberPortal.changePassword);

  const [phoneDraft, setPhone] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Derived: the saved phone wins until the member types a new value.
  const phone = phoneDraft ?? info?.member.phone ?? "";

  const saveContact = async () => {
    setSavingContact(true);
    try {
      await updateContact({ societyId: societyId!, memberId: flat, phone });
      toast.success("Contact number updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSavingContact(false);
    }
  };

  const savePassword = async () => {
    if (newPw !== confirmPw) {
      toast.error("New password and confirmation do not match.");
      return;
    }
    setSavingPw(true);
    try {
      await changePassword({ currentPassword: currentPw, newPassword: newPw });
      toast.success("Password changed successfully.");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Password change failed.");
    } finally {
      setSavingPw(false);
    }
  };

  if (info === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Your login is not linked to a flat in this society.
      </p>
    );
  }
  if (!info) {
    return <Skeleton className="h-64 w-full" />;
  }

  const flatLabel =
    [info.member.wing, info.member.flatNo].filter(Boolean).join("-") ||
    info.member.code;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Your registered details and login security."
      />
      <PortalFlatSelect />
      <div className="grid gap-6 lg:grid-cols-2">
      {/* Profile / flat details */}
      <Card className="shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-base">
            <IconTile tone="sky">
              <UserCircle />
            </IconTile>
            My details
          </CardTitle>
          <CardDescription>
            Registered details of your flat as maintained by the society office.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{info.member.name}</dd>
            <dt className="text-muted-foreground">Flat</dt>
            <dd className="font-medium">{flatLabel}</dd>
            {info.member.building && (
              <>
                <dt className="text-muted-foreground">Building</dt>
                <dd>{info.member.building}</dd>
              </>
            )}
            {info.member.unitType && (
              <>
                <dt className="text-muted-foreground">Unit type</dt>
                <dd>{info.member.unitType}</dd>
              </>
            )}
            {info.member.floor && (
              <>
                <dt className="text-muted-foreground">Floor</dt>
                <dd>{info.member.floor}</dd>
              </>
            )}
            {(info.member.buildupArea ?? info.member.carpetArea) && (
              <>
                <dt className="text-muted-foreground">Area (sq ft)</dt>
                <dd>
                  {info.member.buildupArea
                    ? `Built-up ${info.member.buildupArea}`
                    : ""}
                  {info.member.buildupArea && info.member.carpetArea ? " · " : ""}
                  {info.member.carpetArea ? `Carpet ${info.member.carpetArea}` : ""}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Ownership</dt>
            <dd className="capitalize">
              {info.member.ownershipType ?? "—"}
            </dd>
            {info.member.joinDate && (
              <>
                <dt className="text-muted-foreground">Member since</dt>
                <dd>{info.member.joinDate}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Society</dt>
            <dd>{info.society.name}</dd>
          </dl>

          <div className="space-y-2 border-t pt-4">
            <Label
              htmlFor="phone"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <Phone className="size-3.5" /> Contact number
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Your phone number"
                  className="pl-9"
                />
              </div>
              <Button
                variant="outline"
                onClick={saveContact}
                disabled={savingContact || phone === (info.member.phone ?? "")}
                className="shrink-0 border-teal-500/40 text-teal-700 hover:bg-teal-500/10 hover:text-teal-800 dark:text-teal-300 dark:hover:text-teal-200"
              >
                <Save className="size-4" />
                {savingContact ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BadgeCheck className="size-3.5 text-emerald-500" />
              Login email: {info.member.email ?? user?.email} (managed by the
              society office)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card className="shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5 text-base">
            <IconTile tone="amber">
              <KeyRound />
            </IconTile>
            Change password
          </CardTitle>
          <CardDescription>
            Use at least 8 characters with one number. Password sign-ins only —
            if you sign in with emailed codes, use "Forgot password?" on the
            sign-in screen to set one first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="curpw">Current password</Label>
            <Input
              id="curpw"
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newpw">New password</Label>
            <Input
              id="newpw"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cnewpw">Confirm new password</Label>
            <Input
              id="cnewpw"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <Button
            onClick={savePassword}
            disabled={
              savingPw ||
              !currentPw ||
              !newPw ||
              !confirmPw ||
              newPw !== confirmPw
            }
            className="gap-2 bg-gradient-to-r from-primary to-violet-500 shadow-md shadow-primary/25"
          >
            <KeyRound className="size-4" />
            {savingPw ? "Updating..." : "Update password"}
          </Button>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
