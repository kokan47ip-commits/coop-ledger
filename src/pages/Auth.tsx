import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Loader2,
  Mail,
  MailCheck,
  UserX,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

type PasswordStep =
  | "signIn"
  | "signUp"
  | "forgot"
  | "reset";

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  // Which sign-in method is on screen: one-time code or password.
  const [method, setMethod] = useState<"otp" | "password">("password");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email OTP flow state.
  const [otpStep, setOtpStep] = useState<"signIn" | { email: string }>(
    "signIn",
  );
  const [otp, setOtp] = useState("");

  // Password flow state.
  const [pwStep, setPwStep] = useState<PasswordStep>("signIn");
  const [pwEmail, setPwEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const runSignIn = async (fn: () => Promise<unknown>) => {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      navigate(redirect);
    } catch (err) {
      console.error("Sign-in error:", err);
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      setError(
        msg.includes("Invalid credentials") || msg.includes("InvalidAccountId") || msg.includes("InvalidSecret")
          ? "Incorrect email or password. If the society office set this password for you, ask them to re-save it — and check for typos or an extra space."
          : msg.includes("TooManyFailedAttempts")
            ? "Too many wrong attempts — sign-in is locked for a while. Ask the society office to re-save your password (this unlocks it), or reset it below."
            : msg.includes("Invalid code")
              ? "That code is incorrect or has expired."
              : msg.includes("Account ") && msg.includes("already exists")
                ? "An account with this email already exists. Sign in instead — or reset the password if you forgot it."
                : msg,
      );
      setIsLoading(false);
    }
  };

  /* ------------------------- Email OTP (code) flow ------------------------ */

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setOtpStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runSignIn(async () => {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
    });
    setOtp("");
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Failed to sign in as guest: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      setIsLoading(false);
    }
  };

  /* --------------------------- Password flow ----------------------------- */

  const handlePasswordSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = (formData.get("email") as string)?.toLowerCase().trim() ?? "";
    const flow = pwStep === "signUp" ? "signUp" : "signIn";
    setPwEmail(email);
    await runSignIn(async () => {
      formData.set("flow", flow);
      // Without a `verify` provider this resolves signed-in immediately for
      // both flows — a fresh sign-up goes straight to the dashboard with the
      // user-defined password, no emailed code required.
      await signIn("password", formData);
    });
  };

  const handleForgotSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData(event.currentTarget);
      const email = (formData.get("email") as string)?.toLowerCase().trim();
      setPwEmail(email);
      formData.set("flow", "reset");
      await signIn("password", formData);
      setPwStep("reset");
      setNotice(`Reset code sent to ${email}.`);
      setIsLoading(false);
    } catch (err) {
      console.error("Password reset request error:", err);
      setError("Could not send a reset code to that email.");
      setIsLoading(false);
    }
  };

  const handleResetSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    await runSignIn(async () => {
      const formData = new FormData(event.currentTarget);
      formData.set("flow", "reset-verification");
      await signIn("password", formData);
    });
  };

  /* ------------------------------- Render -------------------------------- */

  return (
    <div className="min-h-screen flex flex-col">
      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">
          <Card className="min-w-[350px] pb-0 border shadow-md">
            {method === "password" ? (
              pwStep === "signIn" || pwStep === "signUp" ? (
                <>
                  <CardHeader className="text-center">
                    <BrandMark onClick={() => navigate("/")} />
                    <CardTitle className="text-xl tracking-tight">
                      Imamm Accounting Solutions
                    </CardTitle>
                    <CardDescription>
                      {pwStep === "signUp"
                        ? "Create your account with an email and password."
                        : "Sign in with your email and password."}
                    </CardDescription>
                  </CardHeader>
                  <form onSubmit={handlePasswordSubmit}>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="relative">
                          <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            name="email"
                            placeholder="name@example.com"
                            type="email"
                            className="pl-9"
                            autoComplete="email"
                            disabled={isLoading}
                            required
                          />
                        </div>
                        <div className="relative">
                          <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            name="password"
                            placeholder={
                              pwStep === "signUp"
                                ? "Create a password (8+ chars, 1 number)"
                                : "Password"
                            }
                            type="password"
                            className="pl-9"
                            autoComplete={
                              pwStep === "signUp" ? "new-password" : "current-password"
                            }
                            disabled={isLoading}
                            required
                          />
                        </div>
                        {notice && (
                          <p className="text-sm text-emerald-600 dark:text-emerald-400">
                            {notice}
                          </p>
                        )}
                        {error && <p className="text-sm text-red-500">{error}</p>}
                      </div>
                      <div className="mt-4 space-y-2">
                        <Button
                          type="submit"
                          variant="outline"
                          className="w-full rounded-lg"
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {pwStep === "signUp" ? "Create account" : "Sign in"}
                          {pwStep === "signUp" ? null : (
                            <ArrowRight className="ml-2 h-4 w-4" />
                          )}
                        </Button>
                        <div className="flex items-center justify-between text-xs">
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-muted-foreground"
                            onClick={() => {
                              setPwStep(pwStep === "signUp" ? "signIn" : "signUp");
                              setError(null);
                            }}
                            disabled={isLoading}
                          >
                            {pwStep === "signUp"
                              ? "Have an account? Sign in"
                              : "New here? Create an account"}
                          </Button>
                          {pwStep === "signIn" && (
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto p-0 text-muted-foreground"
                              onClick={() => {
                                setPwStep("forgot");
                                setError(null);
                              }}
                              disabled={isLoading}
                            >
                              Forgot password?
                            </Button>
                          )}
                        </div>
                      </div>
                      <Divider />
                      <MethodSwitch
                        method={method}
                        setMethod={setMethod}
                        isLoading={isLoading}
                      />
                      <GuestButton
                        onClick={handleGuestLogin}
                        isLoading={isLoading}
                      />
                    </CardContent>
                  </form>
                </>
              ) : pwStep === "forgot" ? (
                <>
                  <CardHeader className="text-center mt-4">
                    <CardTitle className="tracking-tight">Reset password</CardTitle>
                    <CardDescription>
                      We'll email you a code to set a new password.
                    </CardDescription>
                  </CardHeader>
                  <form onSubmit={handleForgotSubmit}>
                    <CardContent>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          name="email"
                          placeholder="name@example.com"
                          type="email"
                          className="pl-9"
                          disabled={isLoading}
                          required
                        />
                      </div>
                      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                      <SubmitButton
                        label="Send reset code"
                        loadingLabel="Sending..."
                        disabled={isLoading}
                        isLoading={isLoading}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        onClick={() => {
                          setPwStep("signIn");
                          setError(null);
                        }}
                        disabled={isLoading}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                      </Button>
                    </CardFooter>
                  </form>
                </>
              ) : (
                <>
                  <CardHeader className="text-center mt-4">
                    <CardTitle className="tracking-tight">Set new password</CardTitle>
                    <CardDescription>
                      Enter the code sent to {pwEmail} and choose a new password.
                    </CardDescription>
                  </CardHeader>
                  <form onSubmit={handleResetSubmit}>
                    <CardContent className="pb-4">
                      <input type="hidden" name="email" value={pwEmail} />
                      <input type="hidden" name="code" value={resetCode} />
                      <div className="flex justify-center">
                        <InputOTP
                          value={resetCode}
                          onChange={setResetCode}
                          maxLength={6}
                          disabled={isLoading}
                        >
                          <InputOTPGroup>
                            {Array.from({ length: 6 }).map((_, index) => (
                              <InputOTPSlot key={index} index={index} />
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      <div className="relative mt-4">
                        <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          name="newPassword"
                          placeholder="New password (8+ chars, 1 number)"
                          type="password"
                          className="pl-9"
                          autoComplete="new-password"
                          disabled={isLoading}
                          required
                        />
                      </div>
                      {error && (
                        <p className="mt-2 text-sm text-red-500 text-center">{error}</p>
                      )}
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                      <SubmitButton
                        label="Set password & sign in"
                        loadingLabel="Setting..."
                        disabled={isLoading || resetCode.length !== 6}
                        isLoading={isLoading}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full"
                        onClick={() => {
                          setPwStep("forgot");
                          setError(null);
                        }}
                        disabled={isLoading}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" /> Resend / change email
                      </Button>
                    </CardFooter>
                  </form>
                </>
              )
            ) : otpStep === "signIn" ? (
              <>
                <CardHeader className="text-center">
                  <BrandMark onClick={() => navigate("/")} />
                  <CardTitle className="text-xl tracking-tight">
                    Imamm Accounting Solutions
                  </CardTitle>
                  <CardDescription>
                    Sign in with your email — we'll send a one-time code. Or use
                    the password tab.
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleEmailSubmit}>
                  <CardContent>
                    <div className="relative flex items-center gap-2">
                      <div className="relative flex-1">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          name="email"
                          placeholder="name@example.com"
                          type="email"
                          className="pl-9"
                          disabled={isLoading}
                          required
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="outline"
                        size="icon"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRight className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                    <Divider />
                    <MethodSwitch
                      method={method}
                      setMethod={setMethod}
                      isLoading={isLoading}
                    />
                    <GuestButton
                      onClick={handleGuestLogin}
                      isLoading={isLoading}
                    />
                  </CardContent>
                </form>
              </>
            ) : (
              <>
                <CardHeader className="text-center mt-4">
                  <CardTitle className="tracking-tight">Check your email</CardTitle>
                  <CardDescription>
                    A six-digit verification code was sent to {otpStep.email}.
                    It expires in fifteen minutes.
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleOtpSubmit}>
                  <CardContent className="pb-4">
                    <input type="hidden" name="email" value={otpStep.email} />
                    <input type="hidden" name="code" value={otp} />
                    <OtpInput value={otp} onChange={setOtp} isLoading={isLoading} />
                    {error && (
                      <p className="mt-2 text-sm text-red-500 text-center">{error}</p>
                    )}
                    <p className="text-sm text-muted-foreground text-center mt-4">
                      Didn't receive a code?{" "}
                      <Button
                        variant="link"
                        className="p-0 h-auto"
                        onClick={() => setOtpStep("signIn")}
                      >
                        Try again
                      </Button>
                    </p>
                  </CardContent>
                  <CardFooter className="flex-col gap-2">
                    <SubmitButton
                      label="Verify code"
                      loadingLabel="Verifying..."
                      disabled={isLoading || otp.length !== 6}
                      isLoading={isLoading}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setOtpStep("signIn")}
                      disabled={isLoading}
                      className="w-full"
                    >
                      Use different email
                    </Button>
                  </CardFooter>
                </form>
              </>
            )}
            <div className="py-4 px-6 text-xs text-center text-muted-foreground bg-muted border-t rounded-b-lg">
              Private workspace · Imamm Accounting Solutions
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BrandMark({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center">
      <span
        className="brand-gradient mb-4 mt-4 flex size-14 cursor-pointer items-center justify-center rounded-xl text-xs font-semibold tracking-widest text-white shadow-lg shadow-primary/40"
        onClick={onClick}
        title="Imamm Accounting Solutions"
      >
        IAS
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div className="mt-4">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-[0.2em]">
          <span className="bg-background px-2 text-muted-foreground">Or</span>
        </div>
      </div>
    </div>
  );
}

function MethodSwitch({
  method,
  setMethod,
  isLoading,
}: {
  method: "otp" | "password";
  setMethod: (m: "otp" | "password") => void;
  isLoading: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="mt-2 w-full rounded-lg"
      onClick={() => setMethod(method === "password" ? "otp" : "password")}
      disabled={isLoading}
    >
      {method === "password" ? (
        <>
          <MailCheck className="mr-2 h-4 w-4" /> Sign in with an emailed code
        </>
      ) : (
        <>
          <KeyRound className="mr-2 h-4 w-4" /> Sign in with a password
        </>
      )}
    </Button>
  );
}

function GuestButton({
  onClick,
  isLoading,
}: {
  onClick: () => void;
  isLoading: boolean;
}) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full rounded-lg"
        onClick={onClick}
        disabled={isLoading}
      >
        <UserX className="mr-2 h-4 w-4" />
        Preview as guest
      </Button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Guest data is saved safely on the server. Sign in with the society's
        profile email — from any PC, mobile, tablet or laptop — and your
        societies and books come with your account.
      </p>
    </>
  );
}

function OtpInput({
  value,
  onChange,
  isLoading,
}: {
  value: string;
  onChange: (v: string) => void;
  isLoading: boolean;
}) {
  return (
    <div className="flex justify-center">
      <InputOTP
        value={value}
        onChange={onChange}
        maxLength={6}
        disabled={isLoading}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.length === 6 && !isLoading) {
            const form = (e.target as HTMLElement).closest("form");
            if (form) {
              form.requestSubmit();
            }
          }
        }}
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }).map((_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}

function SubmitButton({
  label,
  loadingLabel,
  disabled,
  isLoading,
}: {
  label: string;
  loadingLabel: string;
  disabled?: boolean;
  isLoading: boolean;
}) {
  return (
    <Button type="submit" className="w-full" disabled={disabled}>
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="ml-2 h-4 w-4" />
        </>
      )}
    </Button>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
