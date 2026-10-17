import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { Building2 } from "lucide-react";
import { useQuery } from "convex/react";
import { useSearchParams } from "react-router";

/**
 * The selected flat of a multi-flat member login: one username may open
 * several linked flats. The choice lives in the URL (?flat=<memberId>) so it
 * survives refreshes, links and every portal page — pages pass it into the
 * portal queries, which verify server-side that the login is authorised for
 * that flat. Single-flat logins never see the selector.
 */
export function usePortalFlatId(): Id<"members"> | undefined {
  const [params] = useSearchParams();
  const raw = params.get("flat");
  return raw && raw !== "" ? (raw as Id<"members">) : undefined;
}

/**
 * The identity of the flat currently in view: the login's primary binding by
 * default, or the selected linked flat's own member row. Receipt/bill/ledger
 * headers (and the per-member QR) must always name the flat being viewed,
 * not the login's default flat.
 */
export function usePortalFlatIdentity() {
  const { societyId, memberBinding } = useSociety();
  const flat = usePortalFlatId();
  const info = useFlatInfo(societyId, flat);
  if (!flat) return memberBinding;
  if (!info) return memberBinding;
  return {
    memberId: info.member._id,
    name: info.member.name,
    flatNo: info.member.flatNo,
    wing: info.member.wing,
    code: info.member.code,
  };
}

function useFlatInfo(
  societyId: Id<"societies"> | null,
  flat: Id<"members"> | undefined,
) {
  return useQuery(
    api.memberPortal.myInfo,
    societyId && flat ? { societyId, memberId: flat } : "skip",
  ) as
    | null
    | {
        member: {
          _id: Id<"members">;
          name: string;
          flatNo?: string;
          wing?: string;
          code: string;
        };
      }
    | undefined;
}

/** Flat selector shown only when the login holds more than one flat. */
export default function PortalFlatSelect() {
  const { societyId } = useSociety();
  const [params, setParams] = useSearchParams();
  const flats = useQuery(
    api.memberPortal.myFlats,
    societyId ? { societyId } : "skip",
  );
  if (!flats || flats.length <= 1) return null;

  const current = params.get("flat") ?? "";
  // Unknown/stale flat id → fall back to the primary flat (first row).
  const known = flats.some((f) => f.memberId === current);

  const choose = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === "__primary") next.delete("flat");
    else next.set("flat", v);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <Building2 className="size-3.5" /> Flat
      </span>
      <Select value={known ? current : "__primary"} onValueChange={choose}>
        <SelectTrigger className="h-9 w-56">
          <SelectValue placeholder="Your flats" />
        </SelectTrigger>
        <SelectContent>
          {flats.map((f, i) => (
            <SelectItem key={f.memberId} value={f.memberId}>
              {f.flatLabel} — {f.name}
              {i === 0 ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
