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
import { JarvisLogo, JarvisMark } from "@/components/jarvis-logo";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mail,
  MessageCircle,
  UserX,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

type AuthStep =
  | "signIn"
  | "phoneEntry"
  | { email: string }
  | { phone: string };

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[^\d+]/g, "");
  return compact.startsWith("+") ? compact : `+${compact}`;
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

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<AuthStep>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otpStep = typeof step === "object" ? step : null;
  const isPhoneStep = otpStep !== null && "phone" in otpStep;
  const otpTarget =
    otpStep === null
      ? ""
      : "phone" in otpStep
        ? otpStep.phone
        : otpStep.email;

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
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

  const handlePhoneSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const phone = normalizePhone(String(formData.get("phone") ?? ""));
      if (!PHONE_PATTERN.test(phone)) {
        throw new Error(
          "Enter a mobile number with its country code, e.g. +14155550123.",
        );
      }
      formData.set("phone", phone);
      await signIn("whatsapp-otp", formData);
      setOtp("");
      setStep({ phone });
      setIsLoading(false);
    } catch (err) {
      console.error("WhatsApp sign-in error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not send the WhatsApp code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn(isPhoneStep ? "whatsapp-otp" : "email-otp", formData);

      console.log("signed in");

      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);

      setError("The verification code you entered is incorrect.");
      setIsLoading(false);

      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      console.log("Attempting anonymous sign in...");
      await signIn("anonymous");
      console.log("Anonymous sign in successful");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      setError(`Failed to sign in as guest: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="hud-grid-bg flex min-h-screen flex-col">
      {/* Slim product header so /auth still reads as part of Jarvis and is
          never a dead end: home and terms are both one tap away. */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <JarvisLogo />
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            to="/"
            aria-label="Back to home"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            <span className="hidden sm:inline">Back to home</span>
          </Link>
          <Link
            to="/terms"
            className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Terms
          </Link>
        </nav>
      </header>

      {/* Auth Content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center justify-center h-full flex-col">              {/* w-[min(...)] rather than a fixed min-width: 350px pushes the
                  card off-screen on a 360px phone and leaves no margin. */}
              <Card className="hud-panel hud-corners w-[min(24rem,calc(100vw-2rem))] pb-0">
          {step === "signIn" ? (
            <>
              <CardHeader className="text-center">
              <div className="flex justify-center">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label="Back to home"
                      onClick={() => navigate("/")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") navigate("/");
                      }}
                      className="hud-panel hud-corners mb-4 mt-4 flex size-16 cursor-pointer items-center justify-center rounded-2xl"
                    >
                      <JarvisMark className="size-9" animate />
                      <span className="hud-dot absolute -top-1 -right-1" data-tone="cyan" />
                    </div>
                  </div>
                <CardTitle className="text-xl tracking-tight">Get started</CardTitle>
                <CardDescription>
                  Enter your email and we&apos;ll send you a code
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
                  {error && (
                    <p className="mt-2 text-sm text-destructive">{error}</p>
                  )}
                  
                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="hud-label bg-background px-2">
                          Or
                        </span>
                      </div>
                    </div>
                    
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full mt-4"
                      onClick={handleGuestLogin}
                      disabled={isLoading}
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      Continue as guest
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full mt-2"
                      onClick={() => {
                        setError(null);
                        setStep("phoneEntry");
                      }}
                      disabled={isLoading}
                    >
                      <MessageCircle className="mr-2 h-4 w-4" />
                      Continue with WhatsApp
                    </Button>
                  </div>
                </CardContent>
              </form>
            </>
          ) : step === "phoneEntry" ? (
            <>
              <CardHeader className="text-center mt-4">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full border border-border/60 bg-muted/40">
                  <MessageCircle className="size-5 text-muted-foreground" />
                </div>
                <CardTitle>Continue with WhatsApp</CardTitle>
                <CardDescription>
                  Enter your mobile number with its country code. We&apos;ll
                  send a 6-digit code on WhatsApp.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handlePhoneSubmit}>
                <CardContent className="pb-4">
                  <div className="relative">
                    <MessageCircle className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      name="phone"
                      placeholder="+1 415 555 0123"
                      type="tel"
                      className="pl-9"
                      disabled={isLoading}
                      required
                    />
                  </div>
                  {error && (
                    <p className="mt-2 text-sm text-destructive">{error}</p>
                  )}
                  <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                    This signs you in with your number. Standard WhatsApp
                    message rates may apply.
                  </p>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <MessageCircle className="mr-2 h-4 w-4" />
                    )}
                    Send code on WhatsApp
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setError(null);
                      setStep("signIn");
                    }}
                    disabled={isLoading}
                  >
                    Use email instead
                  </Button>
                </CardFooter>
              </form>
            </>
          ) : (
            <>
              <CardHeader className="text-center mt-4">
                <CardTitle>
                  {isPhoneStep ? "Check WhatsApp" : "Check your email"}
                </CardTitle>
                <CardDescription>
                  We've sent a code to{" "}
                  {isPhoneStep ? `WhatsApp at ${otpTarget}` : otpTarget}
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleOtpSubmit}>
                <CardContent className="pb-4">
                  {otpStep && "email" in otpStep ? (
                    <input
                      type="hidden"
                      name="email"
                      value={otpStep.email}
                    />
                  ) : null}
                  {otpStep && "phone" in otpStep ? (
                    <input
                      type="hidden"
                      name="phone"
                      value={otpStep.phone}
                    />
                  ) : null}
                  <input type="hidden" name="code" value={otp} />

                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          // Find the closest form and submit it
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
                  {error && (
                    <p className="mt-2 text-sm text-red-500 text-center">
                      {error}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground text-center mt-4">
                    {isPhoneStep
                      ? "Need a different number?"
                      : "Didn't receive a code?"}{" "}
                    <Button
                      variant="link"
                      className="p-0 h-auto"
                      onClick={() => {
                        setError(null);
                        setStep(isPhoneStep ? "phoneEntry" : "signIn");
                      }}
                    >
                      {isPhoneStep ? "Use a different number" : "Try again"}
                    </Button>
                  </p>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setError(null);
                      setStep(isPhoneStep ? "phoneEntry" : "signIn");
                    }}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isPhoneStep
                      ? "Use a different number"
                      : "Use different email"}
                  </Button>
                </CardFooter>
              </form>
            </>
          )}

          <div className="rounded-b-lg border-t bg-muted px-6 py-4 text-center text-xs text-muted-foreground">
            By continuing you agree to the{" "}
            <Link
              to="/terms"
              className="underline transition-colors hover:text-primary"
            >
              terms
            </Link>
            .
            <span className="mt-1 block text-[11px] text-muted-foreground/70">
              Secured by{" "}
              <a
                href="https://freebuff.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline transition-colors hover:text-primary"
              >
                freebuff.com
              </a>
            </span>
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
