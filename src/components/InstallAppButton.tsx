import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/PageParts";
import { Download, Share, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "chs.installDismissed";

/**
 * "Install this app" card for phones and tablets. Chromium browsers (Android,
 * desktop) get the native install prompt via beforeinstallprompt; iOS Safari
 * shows the Add-to-Home-Screen steps (Apple exposes no install API). Once the
 * app is installed its home-screen icon opens it standalone — the card hides
 * itself when already running installed, or after the user dismisses it.
 */
export default function InstallAppButton() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep our own install UX instead of Chrome's mini-infobar.
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setHidden(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Already running as an installed app (Android/desktop standalone or the
  // iOS home-screen web app) — nothing to offer.
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
  if (standalone || hidden) return null;

  const isIos =
    typeof navigator !== "undefined" &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

  const install = async () => {
    if (installEvent) {
      await installEvent.prompt();
      await installEvent.userChoice;
      setInstallEvent(null);
      return;
    }
    setShowSteps((s) => !s);
  };

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private browsing — the card just comes back next visit.
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3 text-sm text-indigo-900 shadow-sm dark:border-primary/25 dark:from-indigo-950/50 dark:to-violet-950/40 dark:text-indigo-200 sm:flex-row sm:items-center">
      <IconTile tone="indigo" size="sm">
        <Smartphone />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Install Imamm Chsl on your phone or tablet</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          Add it to your home screen — the app gets its own icon and opens
          full-screen, just like a native app.
        </p>
        {showSteps && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {isIos
              ? "In Safari: tap the Share icon (square with an arrow) → “Add to Home Screen” → Add. An Imamm Chsl icon appears on your home screen."
              : "Open the browser menu (⋮) and choose “Install app” or “Add to Home screen”."}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" onClick={install}>
          {installEvent ? <Download className="size-4" /> : <Share className="size-4" />}
          {installEvent ? "Install app" : "How to install"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-current opacity-60 hover:opacity-100"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
