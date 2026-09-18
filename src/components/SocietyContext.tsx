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

  const stored = useMemo(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(stored);
  const adoptingRef = useRef(false);

  // When a guest signs in with email afterwards, any societies they created as
  // a guest on this device are adopted into the email account automatically —
  // so nothing entered in guest mode is ever "lost on login".
  useEffect(() => {
    if (isLoading || isGuest || !isAuthenticated || adoptingRef.current) return;
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
  }, [isLoading, isGuest, isAuthenticated, adopt]);

  const activeId =
    societies.find((s) => s._id === selectedId)?._id ?? societies[0]?._id ?? null;

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
  };

  return <SocietyContext.Provider value={value}>{children}</SocietyContext.Provider>;
}

export function useSociety() {
  const ctx = useContext(SocietyContext);
  if (!ctx) throw new Error("useSociety must be used inside SocietyProvider");
  return ctx;
}

export { saveClaimCode };
