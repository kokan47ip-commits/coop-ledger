import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Legacy Crystal-Reports-style preview: a toolbar strip with the report tab,
 * a grey viewport holding a white "paper" sheet, and the page-status footer.
 * The children render exactly the document that PDF / Word / Print produce.
 */
export function ReportPreview({
  title = "Main Report",
  children,
  onPrint,
}: {
  title?: string;
  children: ReactNode;
  onPrint?: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border shadow-sm">
      {/* Toolbar strip */}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/60 px-3 py-1.5">
        <span className="rounded-t border border-b-0 bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {title}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Report Preview
          </span>
          {onPrint && (
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={onPrint}>
              <Printer className="size-3" /> Print
            </Button>
          )}
        </div>
      </div>

      {/* Grey viewport with white paper */}
      <div className="max-h-[560px] overflow-auto bg-slate-200/70 px-6 py-6 dark:bg-slate-800/60">
        <div className="mx-auto min-h-[400px] w-full max-w-[794px] bg-white px-10 py-8 text-[13px] text-slate-900 shadow-md dark:bg-white">
          {children}
        </div>
      </div>

      {/* Status footer */}
      <div className="flex items-center justify-between border-t bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
        <span>Ledger</span>
        <span>Zoom: Fit width</span>
      </div>
    </div>
  );
}
