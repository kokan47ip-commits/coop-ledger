import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

export type SocietyRole = "owner" | "editor" | "viewer" | "member" | "none";

type Society = {
  _id: Id<"societies">;
  name: string;
  fyStartMonth: number;
  fyYear?: string;
  fyStartDate?: string;
  receivableAccountId?: Id<"accounts">;
  /** Society UPI ID (VPA) — powers member QR codes and bill QRs. */
  upiVpa?: string;
  /** Stable late-fee / interest rate (% per month) charged on arrears. */
  lateFeePercent?: number;
  registrationNo?: string;
  registrationDate?: string;
  chairmanMemberId?: Id<"members">;
  secretaryMemberId?: Id<"members">;
  treasurerMemberId?: Id<"members">;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  email?: string;
  phone?: string;
  /** Set by societies.listMine for member-portal grants — no book access. */
  portalOnly?: boolean;
};

type SocietyContextValue = {
  societies: Society[];
  society: Society | null;
  societyId: Id<"societies"> | null;
  setActiveId: (id: Id<"societies">) => void;
  isLoading: boolean;
  /** True while signed in as a guest (anonymous) user — data is device-tied until email sign-in. */
  isGuest: boolean;
  /** Caller's effective rights over the active society. */
  role: SocietyRole;
  /** False for viewers — hide/disable entry & edit actions in the UI. */
  canEdit: boolean;
  /** True for software-level admins (cross-society control). */
  isAdmin: boolean;
  /** Menu keys the user may open; null = everything allowed. */
  allowedMenus: string[] | null;
  /** For flat-bound member logins: the flat they can see. */
  memberBinding: {
    memberId: Id<"members">;
    name: string;
    flatNo?: string;
    wing?: string;
    code: string;
  } | null;
};

const SocietyContext = createContext<SocietyContextValue | null>(null);

const STORAGE_KEY = "chs.activeSocietyId";
/** Maps society id -> claim code for societies created while in guest mode. */
const CLAIM_KEY = "chs.claimCodes";

function loadClaimCodes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CLAIM_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function persistClaimCodes(map: Record<string, string>) {
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function saveClaimCode(societyId: string, claimCode: string) {
  const map = loadClaimCodes();
  map[societyId] = claimCode;
  persistClaimCodes(map);
}

export function SocietyProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const isGuest = isAuthenticated && user?.isAnonymous === true;

  const societies = useQuery(api.societies.listMine) ?? [];
  const isLoading = societies === undefined;
  const adopt = useMutation(api.societies.adoptByClaimCode);
  const bindGrants = useMutation(api.access.bindPendingGrants);
  const stored = useMemo(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(stored);
  const adoptingRef = useRef(false);
  const bindRef = useRef(false);

  // Prefer a stored selection; otherwise skip portal-only societies so a
  // member login's first active society is never one they can't open.
  const activeId =
    societies.find((s) => s._id === selectedId)?._id ??
    societies.find((s) => !s.portalOnly)?._id ??
    societies[0]?._id ??
    null;

  // Resolve the caller's effective role over the active society. Owners are
  // detected from society.createdBy; invited users through access.myAccess.
  const accessResult = useQuery(
    api.access.myAccess,
    activeId && !isGuest ? { societyId: activeId } : "skip",
  );
  const menusResult = useQuery(
    api.access.myMenus,
    activeId && !isGuest ? { societyId: activeId } : "skip",
  );
  // Flat-bound member logins: which flat is this user linked to, if any.
  const bindingResult = useQuery(
    api.access.myMemberBinding,
    activeId && !isGuest ? { societyId: activeId } : "skip",
  );
  const isAdmin = menusResult?.admin === true;
  // The active society's portalOnly flag arrives with the societies list, one
  // round-trip before myAccess resolves — use it as the synchronous first
  // signal so portal logins get redirected before any book query can fire.
  const activeSociety = societies.find((s) => s._id === activeId) ?? null;
  const role: SocietyRole = isGuest
    ? "owner" // guests act on their own device-scope societies
    : societies.some((s) => s._id === activeId && s.createdBy === user?._id)
      ? "owner"
      : activeSociety?.portalOnly
        ? "member" // synchronous: flagged in listMine via the member-role grant
        : isAdmin
          ? "editor" // admins act as editors everywhere
          : ((accessResult as SocietyRole | undefined) ?? "none");
  const canEdit = role === "owner" || role === "editor";
  // Guests and admins are never menu-restricted; admins can always open Users & Rights.
  const allowedMenus: string[] | null = isGuest || isAdmin
    ? null
    : ((menusResult?.menus as string[] | null | undefined) ?? null);

  // When an email-backed session signs in, their societies are adopted into
  // the account — first server-side (bindGrants hands over every society
  // stamped with their email, plus any society still owned by a guest
  // identity carrying that same email, from any device), then any leftovers
  // via this device's stored claim codes. Email invites issued before
  // sign-up are bound to the account here too. Nothing entered while
  // browsing as a guest is ever "lost on login": the books live server-side
  // and follow the account to any PC, phone, tablet or laptop.
  //
  // Runs whenever the session has an email — including a guest session that
  // was given the owner's email (isAnonymous stays true after conversion),
  // so the same recovery fires on a fresh device or an expired session.
  const hasEmail = !!user?.email;
  useEffect(() => {
    if (isLoading || !hasEmail || !isAuthenticated || adoptingRef.current) return;
    if (!bindRef.current) {
      bindRef.current = true;
      void bindGrants()
        .then((claimed) => {
          if (typeof claimed === "number" && claimed > 0) {
            toast.success(
              `Claimed ${claimed} guest ${claimed === 1 ? "society" : "societies"} into your account`,
            );
          }
        })
        .catch(() => {
          bindRef.current = false;
        });
    }
    const codes = loadClaimCodes();
    const pending = Object.entries(codes);
    if (pending.length === 0) return;
    adoptingRef.current = true;
    void (async () => {
      for (const [sid, code] of pending) {
        const map = loadClaimCodes();
        try {
          await adopt({ claimCode: code });
          delete map[sid];
          persistClaimCodes(map);
          toast.success("Claimed a society into your account");
        } catch {
          // Already claimed (e.g. from another device) or invalid — drop it so
          // we never retry a dead code.
          delete map[sid];
          persistClaimCodes(map);
        }
      }
    })();
  }, [isLoading, hasEmail, isAuthenticated, adopt, bindGrants]);

  const setActiveId = useCallback((id: Id<"societies">) => {
    setSelectedId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value: SocietyContextValue = {
    societies,
    society: societies.find((s) => s._id === activeId) ?? null,
    societyId: activeId,
    setActiveId,
    isLoading,
    isGuest,
    role,
    canEdit,
    isAdmin,
    allowedMenus,
    memberBinding: bindingResult ?? null,
  };

  return <SocietyContext.Provider value={value}>{children}</SocietyContext.Provider>;
}

export function useSociety() {
  const ctx = useContext(SocietyContext);
  if (!ctx) throw new Error("useSociety must be used inside SocietyProvider");
  return ctx;
}

export { saveClaimCode };
