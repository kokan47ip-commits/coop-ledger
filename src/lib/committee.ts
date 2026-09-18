import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSociety } from "@/components/SocietyContext";
import type { ExportSignature } from "./export";

/**
 * Resolves the society's committee (Chairman / Secretary / Treasurer) into a
 * signature block for every exported document — bills, receipts, vouchers,
 * ledgers and final accounts. Unassigned offices are omitted.
 */
export function useCommitteeSignatures(): ExportSignature[] {
  const { societyId, society } = useSociety();
  const members =
    useQuery(api.members.list, societyId ? { societyId } : "skip") ?? [];

  if (!society) return [];

  const nameOf = (id?: typeof members[number]["_id"]): string | null => {
    if (!id) return null;
    const m = members.find((x) => x._id === id);
    if (!m) return null;
    const flat = [m.wing, m.flatNo].filter(Boolean).join("-");
    return flat ? `${m.name} (${flat})` : m.name;
  };

  const sigs: ExportSignature[] = [];
  const chairman = nameOf(society.chairmanMemberId);
  const secretary = nameOf(society.secretaryMemberId);
  const treasurer = nameOf(society.treasurerMemberId);
  if (treasurer) sigs.push({ label: "Treasurer", name: treasurer });
  if (secretary) sigs.push({ label: "Secretary", name: secretary });
  if (chairman) sigs.push({ label: "Chairman", name: chairman });
  return sigs;
}
