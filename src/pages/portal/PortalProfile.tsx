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
import { useAuth } from "@/hooks/use-auth";
import { KeyRound, Save, UserCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

export default function PortalProfile() {
  const { societyId } = useSociety();
  const { user } = useAuth();
  const info = useQuery(
    api.memberPortal.myInfo,
    societyId ? { societyId } : "skip",
  );

  const updateContact = useMutation(api.memberPortal.updateMyContact);
  const changePassword = useMutation(api.memberPortal.changePassword);

  const [phone, setPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (info?.member.phone) setPhone(info.member.phone);
  }, [info?.member.phone]);

  const saveContact = async () => {
    setSavingContact(true);
    try {
      await updateContact({ societyId: societyId!, phone });
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
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Profile / flat details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCircle className="size-4 text-primary" /> My details
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
            <Label htmlFor="phone">Contact number</Label>
            <div className="flex gap-2">
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Your phone number"
              />
              <Button
                variant="outline"
                onClick={saveContact}
                disabled={savingContact || phone === (info.member.phone ?? "")}
              >
                <Save className="mr-2 size-4" />
                {savingContact ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Login email: {info.member.email ?? user?.email} (managed by the
              society office)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" /> Change password
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
          >
            {savingPw ? "Updating..." : "Update password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
