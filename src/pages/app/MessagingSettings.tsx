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
import { useSociety } from "@/components/SocietyContext";
import { IconTile, PageHeader } from "@/components/PageParts";
import {
  CircleCheck,
  CircleX,
  Info,
  KeyRound,
  Mail,
  MessageCircle,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
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
        title="Email & WhatsApp"
        description="Configure and test the channels that deliver bills and receipts to members."
      />

      {/* Channel status */}
      <div className="grid gap-4 sm:grid-cols-2">
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
  tone: "emerald" | "violet";
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
  tone: "emerald" | "violet";
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
