import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSociety } from "@/components/SocietyContext";
import { IconTile, PageHeader } from "@/components/PageParts";
import { formatMoney } from "@/lib/format";
import { qrDataUrl, memberUpiUri } from "@/lib/upiQr";
import {
  CircleCheck,
  CircleX,
  Copy,
  Info,
  KeyRound,
  Mail,
  MessageCircle,
  Send,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

/**
 * Email & WhatsApp settings — the office's single place to see whether the
 * outbound channels are configured, try them with a real test send, and keep
 * per-society messaging preferences (reply-to, WhatsApp mode, sender name).
 * API keys are managed in the platform's Keys / API keys tab; this page
 * reports their status without ever showing the values.
 */
export default function MessagingSettings() {
  const { societyId, society, canEdit } = useSociety();

  const status = useQuery(api.settings.getChannelStatus, {});
  const settings = useQuery(
    api.settings.getMessagingSettings,
    societyId ? { societyId } : "skip",
  );

  const saveSettings = useMutation(api.settings.saveMessagingSettings);
  const sendTestEmail = useAction(api.emailer.sendTest);
  const sendTestWhatsapp = useAction(api.whatsapp.sendTest);

  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);

  // ---- Payments (UPI gateway) ----
  const upiSettings = useQuery(
    api.settings.getUpiSettings,
    societyId ? { societyId } : "skip",
  );
  const officePayments = useQuery(
    api.payments.listOfficeUpiPayments,
    societyId ? { societyId } : "skip",
  );
  const saveUpi = useMutation(api.settings.saveUpiSettings);
  const [settlementChoice, setSettlementChoice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ---- Society UPI ID (VPA) → dynamic QR on member bills ----
  // Draft starts from the saved value and re-syncs when the query lands.
  const [vpaDraft, setVpaDraft] = useState("");
  const [vpaSynced, setVpaSynced] = useState(false);
  const [vpaQrUrl, setVpaQrUrl] = useState<string | null>(null);
  if (!vpaSynced && upiSettings !== undefined) {
    setVpaSynced(true);
    setVpaDraft(upiSettings.upiVpa ?? "");
  }
  // Preview QR mirrors the DRAFT, so the office can sanity-scan before saving.
  const societyUpiUri = vpaDraft.includes("@")
    ? memberUpiUri({
        payeeName: upiSettings?.upiPayeeName ?? "Society",
        vpa: vpaDraft.trim(),
      })
    : null;
  useEffect(() => {
    let alive = true;
    if (societyUpiUri) {
      // Async subscribe to the external QR renderer; setState happens in the
      // callback (allowed), not synchronously in the effect body.
      qrDataUrl(societyUpiUri).then((url) => {
        if (alive) setVpaQrUrl(url);
      });
    }
    return () => {
      alive = false;
    };
  }, [societyUpiUri]);

  const saveVpa = async () => {
    if (!societyId) return;
    try {
      await saveUpi({ societyId, upiVpa: vpaDraft.trim() || null });
      toast.success(
        vpaDraft.trim()
          ? "UPI ID saved — every member bill now prints a scannable payment QR."
          : "UPI ID cleared — bills will print without the payment QR.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the UPI ID.");
    }
  };

  const settlementValue =
    settlementChoice ?? upiSettings?.settlementAccountId ?? "__default__";

  const saveSettlement = async () => {
    if (!societyId) return;
    try {
      await saveUpi({
        societyId,
        settlementAccountId:
          settlementValue === "__default__"
            ? null
            : (settlementValue as Id<"accounts">),
      });
      setSettlementChoice(null);
      toast.success("UPI settlement account saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  };

  const copyWebhook = async () => {
    if (!upiSettings?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(upiSettings.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select the text and copy it manually.");
    }
  };

  // Preferences form: the server value is the base; edits are a sparse draft
  // overlay (derived state — no effect-synced copies of server data).
  type Draft = {
    replyTo: string;
    senderName: string;
    waMode: "template" | "session";
  };
  const [draft, setDraft] = useState<Partial<Draft>>({});
  const base: Draft = {
    replyTo: settings?.replyTo ?? "",
    senderName: settings?.senderName ?? "",
    waMode: settings?.whatsappMode ?? "template",
  };
  const prefs: Draft = { ...base, ...draft };

  const savePrefs = async () => {
    if (!societyId) return;
    try {
      await saveSettings({
        societyId,
        replyTo: prefs.replyTo,
        senderName: prefs.senderName,
        whatsappMode: prefs.waMode,
      });
      setDraft({});
      toast.success("Messaging preferences saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  };

  const doTestEmail = async () => {
    if (!societyId || !testEmail.trim()) return;
    setEmailBusy(true);
    try {
      await sendTestEmail({ societyId, to: testEmail.trim() });
      toast.success(`Test email sent to ${testEmail.trim()} — check the inbox (and spam folder).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test email failed.");
    } finally {
      setEmailBusy(false);
    }
  };

  const doTestWhatsapp = async () => {
    if (!societyId || !testPhone.trim()) return;
    setWaBusy(true);
    try {
      await sendTestWhatsapp({ societyId, phone: testPhone.trim() });
      toast.success(`Test WhatsApp message sent to ${testPhone.trim()}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test WhatsApp failed.");
    } finally {
      setWaBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messaging & Payments"
        description="Configure the channels that deliver bills and receipts, and online UPI payments that credit member ledgers automatically."
      />

      {/* Channel status */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ChannelCard
          icon={<Mail />}
          tone="emerald"
          title="Email (Resend)"
          envKey="RESEND_API_KEY"
          ready={status?.email}
        />
        <ChannelCard
          icon={<MessageCircle />}
          tone="violet"
          title="WhatsApp (Meta Cloud API)"
          envKey="WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID"
          ready={status?.whatsapp}
        />
        <ChannelCard
          icon={<Smartphone />}
          tone="sky"
          title="UPI payments (Razorpay)"
          envKey="RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET + RAZORPAY_WEBHOOK_SECRET"
          ready={upiSettings?.ready}
        />
      </div>

      <Tabs defaultValue="email" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 sm:w-auto">
          <TabsTrigger value="email" className="gap-1.5">
            <Mail className="size-4" /> Email
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5">
            <MessageCircle className="size-4" /> WhatsApp
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-1.5">
            <SlidersHorizontal className="size-4" /> Preferences
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5">
            <Smartphone className="size-4" /> Payments
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------ EMAIL ------------------------------ */}
        <TabsContent value="email" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Send a test email</CardTitle>
              <CardDescription>
                Sends a real email from{" "}
                <span className="font-medium text-foreground">
                  {society?.name ?? "your society"} &lt;onboarding@resend.dev&gt;
                </span>
                . Bills and receipts will use the same sender.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1"
                />
              </div>
              <Button
                onClick={doTestEmail}
                disabled={emailBusy || !testEmail.trim() || !canEdit}
                className="gap-1.5"
              >
                <Send className="size-4" />
                {emailBusy ? "Sending…" : "Send test email"}
              </Button>
            </CardContent>
          </Card>

          <SetupSteps
            tone="emerald"
            steps={[
              "Create a free account at resend.com and verify your email address.",
              "Open API Keys → Create API Key → copy the key (starts with re_).",
              "Paste it into this project's Keys / API keys tab as RESEND_API_KEY.",
              "While onboarding@resend.dev is the sender, emails can only go to your own Resend account's address — verify your society's domain in Resend to email any member.",
            ]}
          />
        </TabsContent>

        {/* ----------------------------- WHATSAPP ---------------------------- */}
        <TabsContent value="whatsapp" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Send a test WhatsApp</CardTitle>
              <CardDescription>
                Fires the approved template <span className="font-medium text-foreground">{status?.whatsappTemplate ?? "bill_notification"}</span>{" "}
                ({status?.whatsappTemplateLang ?? "en"}) with test text — confirms the
                token, phone number ID and template are live.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <Label className="text-xs text-muted-foreground">
                  Member phone (10-digit Indian mobile)
                </Label>
                <Input
                  inputMode="numeric"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="9876543210"
                  className="mt-1"
                />
              </div>
              <Button
                onClick={doTestWhatsapp}
                disabled={waBusy || !testPhone.trim() || !canEdit}
                className="gap-1.5"
              >
                <Send className="size-4" />
                {waBusy ? "Sending…" : "Send test WhatsApp"}
              </Button>
            </CardContent>
          </Card>

          <SetupSteps
            tone="violet"
            steps={[
              "In Meta Business Suite, create a WhatsApp Business App and note the Phone Number ID (WhatsApp → API Setup).",
              "Create a System User (Business Settings → Users → System users) with the whatsapp_business_messaging + whatsapp_business_management permissions and generate a permanent token.",
              "Create the message template bill_notification (category Utility, language English): body “Dear {{1}}, your {{2}} is attached.” with a DOCUMENT header sample. Wait for Meta's approval.",
              "Paste WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID into this project's Keys / API keys tab. Optional: WHATSAPP_TEMPLATE_NAME / WHATSAPP_TEMPLATE_LANG to override the defaults.",
              "The business number must not be an ordinary WhatsApp app number — use a dedicated business number (the free test number works for up to 5 verified recipients).",
            ]}
          />
        </TabsContent>

        {/* --------------------------- PREFERENCES --------------------------- */}
        <TabsContent value="preferences" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Messaging preferences</CardTitle>
              <CardDescription>
                Applied to every bill/receipt email and WhatsApp message sent for{" "}
                {society?.name ?? "this society"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Email reply-to address (optional)
                  </Label>
                  <Input
                    type="email"
                    value={prefs.replyTo}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, replyTo: e.target.value }))
                    }
                    placeholder="office@yoursociety.in"
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    WhatsApp send mode
                  </Label>
                  <Select
                    value={prefs.waMode}
                    onValueChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        waMode: v as "template" | "session",
                      }))
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="template">
                        Approved template (works any time)
                      </SelectItem>
                      <SelectItem value="session">
                        Free-form document (24h window only)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Sender display name (optional)
                  </Label>
                  <Input
                    value={prefs.senderName}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, senderName: e.target.value }))
                    }
                    placeholder={society?.name ?? "Society name"}
                    disabled={!canEdit}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={savePrefs} disabled={!canEdit} className="gap-1.5">
                  <CircleCheck className="size-4" /> Save preferences
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.05] p-4 text-sm text-sky-900 dark:text-sky-200">
            <IconTile tone="sky">
              <Info />
            </IconTile>
            <p className="leading-6">
              <strong>How billing uses these channels:</strong> open the Bill
              Register (or Vouchers → a receipt), select bills, then use the
              Email or WhatsApp buttons — members receive the same PDF that
              downloads here.
            </p>
          </div>
        </TabsContent>

        {/* ----------------------------- PAYMENTS ---------------------------- */}
        <TabsContent value="payments" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Where online payments land</CardTitle>
              <CardDescription>
                Members pay by UPI (GPay / PhonePe / Paytm) from their portal.
                Money settles into your Razorpay-settled bank account — record
                that account here so receipts debit the right ledger.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Settlement account (cash/bank)
                  </Label>
                  <Select
                    value={settlementValue}
                    onValueChange={setSettlementChoice}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        Default — first cash/bank account
                      </SelectItem>
                      {upiSettings?.bankCashAccounts.map((a) => (
                        <SelectItem key={a._id} value={a._id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {upiSettings?.settlementAccountName && settlementChoice === null && (
                    <p className="text-xs text-muted-foreground">
                      Current: {upiSettings.settlementAccountName}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Webhook URL (paste into Razorpay → Webhooks)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={upiSettings?.webhookUrl ?? ""}
                      className="font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={copyWebhook}
                      disabled={!upiSettings?.webhookUrl}
                      title="Copy webhook URL"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  {copied && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Copied to clipboard.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={saveSettlement}
                  disabled={!canEdit || settlementChoice === null}
                  className="gap-1.5"
                >
                  <CircleCheck className="size-4" /> Save settlement account
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* -------- Society UPI ID → dynamic QR on member bills --------
              The saved VPA drives the per-bill QR (pays the bill's exact
              amount, tagged with the flat) and each member's portal QR. */}
          <Card id="society-upi">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Society UPI ID (no gateway)</CardTitle>
              <CardDescription>
                Paste the society's UPI ID (VPA). Every member bill then prints a
                scannable QR that opens GPay / PhonePe / Paytm with the society as
                payee, the flat tagged in the note and the bill's exact amount
                prefilled — money lands directly in the society's bank account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Society UPI ID (VPA)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={vpaDraft}
                      onChange={(e) => setVpaDraft(e.target.value)}
                      disabled={!canEdit}
                      placeholder="e.g. shamachsl@hdfcbank"
                      autoComplete="off"
                      className="font-mono text-xs"
                    />
                    <Button
                      onClick={saveVpa}
                      disabled={!canEdit || vpaDraft.trim() === (upiSettings?.upiVpa ?? "")}
                      className="gap-1.5 shrink-0"
                    >
                      <CircleCheck className="size-4" /> Save UPI ID
                    </Button>
                  </div>
                  {upiSettings?.upiVpa ? (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Saved — bills print the QR below for every member.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Not set yet — bills print without a payment QR until a VPA is saved.
                    </p>
                  )}
                </div>
                {societyUpiUri && vpaQrUrl && (
                  <div className="flex flex-col items-center gap-1 rounded-lg border bg-white p-2 dark:bg-white">
                    <img src={vpaQrUrl} className="size-32" alt="Society UPI QR" />
                    <span className="text-[9px] font-bold tracking-wide text-indigo-900 dark:text-indigo-700">
                      SCAN TO PAY · SOCIETY UPI
                    </span>
                  </div>
                )}
              </div>
              <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300">
                Verify with a ₹1 transfer first — a wrong UPI ID sends money to the wrong bank
                account. The QR is “dynamic”: scanning it opens the payer's UPI app with the
                society pre-filled; the payer confirms the amount there.
              </p>
            </CardContent>
          </Card>

          <SetupSteps
            tone="sky"
            steps={[
              "Create an account at dashboard.razorpay.com and complete KYC (bank account + PAN). Test mode is available immediately.",
              "Account & Settings → API Keys → Generate Key. Copy the Key Id and Key Secret.",
              "Paste them into this project's Keys / API keys tab as RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Also add RAZORPAY_WEBHOOK_SECRET with any strong random text you choose.",
              "Account & Settings → Webhooks → Add New Webhook: paste the webhook URL above, tick the events payment.captured and payment.failed, and set the same secret you saved as RAZORPAY_WEBHOOK_SECRET.",
              "Members then see \u201cPay online with UPI\u201d on their payment page — GPay, PhonePe or Paytm opens right on their phone, and the receipt posts to the books automatically.",
            ]}
          />

          {officePayments && officePayments.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recent online payments</CardTitle>
                <CardDescription>
                  Received money normally posts itself to the books within
                  seconds. Anything marked “received” here still needs a
                  receipt entry from the office.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {officePayments.map((p) => (
                    <li
                      key={p._id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      {p.status === "posted" ? (
                        <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                          <CircleCheck className="size-3" /> Posted · {p.voucherNo}
                        </Badge>
                      ) : p.status === "captured" ? (
                        <Badge className="gap-1 border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                          <Info className="size-3" /> Received — needs entry
                        </Badge>
                      ) : p.status === "created" ? (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          Processing
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          Cancelled
                        </Badge>
                      )}
                      <span className="font-medium tabular-nums">
                        {formatMoney(p.amount)}
                      </span>
                      <span>
                        {p.memberName}
                        {p.flatLabel ? ` · ${p.flatLabel}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString()}
                      </span>
                      {p.failureReason && (
                        <span className="w-full text-xs text-amber-700 dark:text-amber-300">
                          {p.failureReason}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {!status && (
        <p className="text-xs text-muted-foreground">
          <KeyRound className="mr-1 inline size-3.5" />
          Checking key configuration…
        </p>
      )}
      {status && !status.email && (
        <p className="text-xs text-muted-foreground">
          Email keys are missing — the Email buttons will show a clear error
          until <span className="font-mono">RESEND_API_KEY</span> is added in the
          Keys / API keys tab.
        </p>
      )}
      {status && !status.whatsapp && (
        <p className="text-xs text-muted-foreground">
          WhatsApp keys are missing — the WhatsApp buttons will show a clear
          error until <span className="font-mono">WHATSAPP_TOKEN</span> and{" "}
          <span className="font-mono">WHATSAPP_PHONE_NUMBER_ID</span> are added.
        </p>
      )}
      {upiSettings && !upiSettings.ready && (
        <p className="text-xs text-muted-foreground">
          UPI gateway keys are missing — the “Pay online with UPI” button stays
          switched off for members until <span className="font-mono">RAZORPAY_KEY_ID</span>,{" "}
          <span className="font-mono">RAZORPAY_KEY_SECRET</span> and{" "}
          <span className="font-mono">RAZORPAY_WEBHOOK_SECRET</span> are added in the
          Keys / API keys tab.
        </p>
      )}
    </div>
  );
}

function ChannelCard({
  icon,
  tone,
  title,
  envKey,
  ready,
}: {
  icon: React.ReactNode;
  tone: "emerald" | "violet" | "sky";
  title: string;
  envKey: string;
  ready?: boolean;
}) {
  return (
    <Card className="shadow-md shadow-slate-950/[0.04] dark:shadow-black/20">
      <CardContent className="flex items-center gap-4">
        <IconTile tone={tone} size="lg">
          {icon}
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {envKey}
          </p>
        </div>
        {ready === undefined ? (
          <Skeleton className="h-6 w-20" />
        ) : ready ? (
          <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <CircleCheck className="size-3.5" /> Ready
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            <CircleX className="size-3.5" /> Not set
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function SetupSteps({
  steps,
  tone,
}: {
  steps: string[];
  tone: "emerald" | "violet" | "sky";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Setup checklist</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-sm leading-6">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  tone === "emerald"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : tone === "sky"
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                      : "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                }`}
              >
                {i + 1}
              </span>
              <span className="text-muted-foreground">{s}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
