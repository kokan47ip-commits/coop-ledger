import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IconTile } from "@/components/PageParts";
import { memberUpiUri, qrToCanvas } from "@/lib/upiQr";
import { formatMoney } from "@/lib/format";
import { Download, Printer, QrCode, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

/** Minimal HTML escape for the print window (names/VPA are user-controlled). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The member's personal UPI QR. Every member of a society pays into the same
 * society UPI ID (VPA); the QR is dynamic per member because the payee note
 * carries the flat, so the office can match bank statements to members.
 * Rendered to a canvas client-side — no gateway, no per-member storage.
 */
export default function MemberQrCard({
  societyName,
  vpa,
  memberName,
  flatLabel,
  memberCode,
  outstanding,
}: {
  societyName: string;
  vpa?: string;
  memberName: string;
  flatLabel: string;
  memberCode: string;
  outstanding: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uri = useMemo(
    () =>
      memberUpiUri({
        payeeName: societyName,
        vpa: vpa ?? "",
        flat: flatLabel,
        code: memberCode,
      }),
    [societyName, vpa, flatLabel, memberCode],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!vpa || !canvas) return;
    qrToCanvas(uri, canvas, 220).catch(() => {
      // Leave the canvas blank on failure; the note below still shows the VPA.
    });
  }, [uri, vpa]);

  if (!vpa) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <IconTile tone="teal" size="sm">
              <QrCode />
            </IconTile>
            <CardTitle className="text-base tracking-tight">
              Pay by UPI — my QR code
            </CardTitle>
          </div>
          <CardDescription>
            The society office hasn't added a UPI ID yet. Once they do, your
            personal payment QR will appear here and on your bills.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Deep-link into the device's UPI chooser: navigating to the upi:// URI
  // makes Android/iOS pop up every INSTALLED UPI app (GPay, PhonePe, Paytm…)
  // with the society's VPA and the member's flat note pre-filled — the member
  // just picks an app and enters the amount. Desktop browsers have no UPI
  // handler, so the QR above stays the way to pay there.
  const openUpiApp = () => {
    window.location.href = uri;
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `upi-qr-${(memberCode || flatLabel || "member").replace(/[^A-Za-z0-9-]/g, "")}.png`;
    a.click();
  };

  const print = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = canvas.toDataURL("image/png");
    const w = window.open("", "_blank", "width=440,height=600");
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>UPI QR — ${esc(flatLabel)}</title>` +
        `<style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#111827}` +
        `h1{font-size:18px;margin:0 0 4px}p{margin:4px 0;font-size:13px;color:#4b5563}` +
        `img{margin:16px 0;width:280px;height:280px}</style></head><body>` +
        `<h1>${esc(societyName)}</h1><p>${esc(memberName)} · Flat ${esc(flatLabel)}</p>` +
        `<img src="${img}" alt="UPI QR for ${esc(flatLabel)}" />` +
        `<p>Scan with any UPI app to pay maintenance</p><p>UPI ID: ${esc(vpa)}</p>` +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      w.close();
    }, 250);
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <IconTile tone="teal" size="sm">
              <QrCode />
            </IconTile>
            <div>
              <CardTitle className="text-base tracking-tight">
                Pay by UPI — my QR code
              </CardTitle>
              <CardDescription>
                Scan with GPay, PhonePe, Paytm or any UPI app.
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" onClick={openUpiApp} title="Opens your installed UPI apps on mobile">
              <Smartphone className="size-4" />
              Pay via UPI app
            </Button>
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="size-4" />
              Download
            </Button>
            <Button variant="outline" size="sm" onClick={print}>
              <Printer className="size-4" />
              Print
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <canvas
          ref={canvasRef}
          width={220}
          height={220}
          className="size-[220px] shrink-0 rounded-lg border bg-white p-1 shadow-sm"
          aria-label={`UPI QR code for flat ${flatLabel}`}
        />
        <div className="min-w-0 space-y-2 text-sm">
          <p className="font-medium">
            {memberName} · Flat {flatLabel}
          </p>
          <p className="text-muted-foreground">
            The flat is embedded in the payment note, so the society office can
            match your payment automatically.
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {uri}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            On a phone or tablet, tapping <span className="font-medium text-foreground">Pay via UPI app</span>
            {" "}pops up all your installed UPI apps — pick one and confirm the payment. On a
            computer, scan the QR instead.
          </p>
          {outstanding > 0.005 && (
            <p className="text-xs text-muted-foreground">
              Current outstanding:{" "}
              <span className="font-medium text-foreground">
                {formatMoney(outstanding)}
              </span>{" "}
              — or scan a bill's QR to pay its exact amount.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
