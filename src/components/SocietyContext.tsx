import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createContext, useContext, useMemo, useState } from "react";
import { useQuery } from "convex/react";

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
};

const SocietyContext = createContext<SocietyContextValue | null>(null);

const STORAGE_KEY = "chs.activeSocietyId";

export function SocietyProvider({ children }: { children: React.ReactNode }) {
  const societies = useQuery(api.societies.listMine) ?? [];
  const isLoading = societies === undefined;
  const stored = useMemo(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(stored);

  const activeId =
    societies.find((s) => s._id === selectedId)?._id ?? societies[0]?._id ?? null;

  const value: SocietyContextValue = {
    societies,
    society: societies.find((s) => s._id === activeId) ?? null,
    societyId: activeId,
    setActiveId: (id) => {
      setSelectedId(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
    },
    isLoading,
  };

  return <SocietyContext.Provider value={value}>{children}</SocietyContext.Provider>;
}

export function useSociety() {
  const ctx = useContext(SocietyContext);
  if (!ctx) throw new Error("useSociety must be used inside SocietyProvider");
  return ctx;
}
