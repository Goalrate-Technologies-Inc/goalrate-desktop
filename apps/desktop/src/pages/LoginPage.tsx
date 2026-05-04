/**
 * Login Page for Desktop App
 *
 * Hosted browser sign-in with an option to continue locally.
 */

import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@goalrate-app/ui/utils";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@goalrate-app/ui/primitives";
import { Logo } from "@goalrate-app/ui/brand";
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  LogIn,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";

/**
 * Desktop login page component
 */
export default function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const {
    startSignIn,
    continueWithoutLogin,
    isAuthenticated,
    isLoading,
    error,
    clearError,
    isOnline,
    mode,
  } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSignIn = async (): Promise<void> => {
    clearError();
    try {
      await startSignIn("sign-in");
    } catch {
      // Error is already set in auth context.
    }
  };

  const handleContinueWithoutLogin = (): void => {
    continueWithoutLogin();
    navigate("/");
  };

  const connectionBadgeClass = isOnline
    ? "border-success/30 bg-success/10 text-foreground"
    : "border-warning/35 bg-warning/10 text-foreground";
  const connectionIconClass = isOnline ? "text-success" : "text-warning";
  const waitingForBrowser = mode === "authenticating" && !isLoading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-muted/25 p-4">
      <div className="w-full max-w-md">
        <Card className="rounded-2xl border-divider bg-gradient-to-b from-card to-muted/20 shadow-sm">
          <CardHeader className="space-y-4 pb-6 text-center">
            <div className="flex justify-center">
              <Logo size={48} showText />
            </div>

            <div className="space-y-2">
              <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
              <CardDescription className="text-base">
                Sign in with your GoalRate account
              </CardDescription>
            </div>

            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
                connectionBadgeClass,
              )}
            >
              {isOnline ? (
                <>
                  <Wifi className={cn("h-3 w-3", connectionIconClass)} />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className={cn("h-3 w-3", connectionIconClass)} />
                  <span>Offline - Sign in unavailable</span>
                </>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              onClick={() => {
                void handleSignIn();
              }}
              disabled={isLoading || !isOnline}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening browser...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign In
                  <ExternalLink className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            {waitingForBrowser && (
              <p className="text-center text-sm text-muted-foreground">
                Complete sign-in in your browser to continue.
              </p>
            )}

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-divider" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleContinueWithoutLogin}
              disabled={isLoading}
            >
              Continue Without Signing In
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Local vault workflows stay available either way.
            </p>

            <div className="border-t border-divider pt-4 text-center">
              <p className="text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link
                  to="/register"
                  className="font-medium text-primary hover:underline"
                >
                  Create one
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
