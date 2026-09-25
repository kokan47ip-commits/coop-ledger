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

export type SocietyRole = "owner" | "editor" | "viewer" | "none";

type Society = {
  _id: Id<"societies">;
  name: string;
  fyStartMonth: number;
  fyYear?: string;
  fyStartDate?: string;
  receivableAccountId?: Id<"accounts">;
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

  const activeId =
    societies.find((s) => s._id === selectedId)?._id ?? societies[0]?._id ?? null;

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
  const isAdmin = menusResult?.admin === true;
  const role: SocietyRole = isGuest
    ? "owner" // guests act on their own device-scope societies
    : societies.some((s) => s._id === activeId && s.createdBy === user?._id)
      ? "owner"
      : isAdmin
        ? "editor" // admins act as editors everywhere
        : ((accessResult as SocietyRole | undefined) ?? "none");
  const canEdit = role === "owner" || role === "editor";
  // Guests and admins are never menu-restricted; admins can always open Users & Rights.
  const allowedMenus: string[] | null = isGuest || isAdmin
    ? null
    : ((menusResult?.menus as string[] | null | undefined) ?? null);

  // When a guest signs in with email afterwards, any societies they created as
  // a guest on this device are adopted into the email account automatically —
  // so nothing entered in guest mode is ever "lost on login". Email invites
  // issued before sign-up are bound to the account on first sign-in here too.
  useEffect(() => {
    if (isLoading || isGuest || !isAuthenticated || adoptingRef.current) return;
    if (!bindRef.current) {
      bindRef.current = true;
      void bindGrants().catch(() => {
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
  }, [isLoading, isGuest, isAuthenticated, adopt, bindGrants]);

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
  };

  return <SocietyContext.Provider value={value}>{children}</SocietyContext.Provider>;
}

export function useSociety() {
  const ctx = useContext(SocietyContext);
  if (!ctx) throw new Error("useSociety must be used inside SocietyProvider");
  return ctx;
}

export { saveClaimCode };
