/**
 * Login Page for Desktop App
 *
 * Email/password login form with option to continue without signing in.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@goalrate-app/ui/utils';
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@goalrate-app/ui/primitives';
import { Logo } from '@goalrate-app/ui/brand';
import { Mail, Lock, Loader2, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

/**
 * Desktop login page component
 */
export default function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const { login, continueWithoutLogin, isLoading, error, clearError, isOnline } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    // Basic validation
    if (!email.trim()) {
      setLocalError('Please enter your email address');
      return;
    }
    if (!password) {
      setLocalError('Please enter your password');
      return;
    }

    try {
      await login(email, password);
      navigate('/');
    } catch {
      // Error is already set in auth context
    }
  };

  const handleContinueWithoutLogin = (): void => {
    continueWithoutLogin();
    navigate('/');
  };

  const displayError = localError || error;
  const connectionBadgeClass = isOnline
    ? 'border-success/30 bg-success/10 text-foreground'
    : 'border-warning/35 bg-warning/10 text-foreground';
  const connectionIconClass = isOnline ? 'text-success' : 'text-warning';

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/25 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="rounded-2xl border-divider bg-gradient-to-b from-card to-muted/20 shadow-sm">
          <CardHeader className="text-center space-y-4 pb-6">
            {/* Logo */}
            <div className="flex justify-center">
              <Logo size={48} showText />
            </div>

            {/* Title */}
            <div className="space-y-2">
              <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
              <CardDescription className="text-base">
                Sign in to your GoalRate account
              </CardDescription>
            </div>

            {/* Online status indicator */}
            <div
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
                connectionBadgeClass
              )}
            >
              {isOnline ? (
                <>
                  <Wifi className={cn('h-3 w-3', connectionIconClass)} />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className={cn('h-3 w-3', connectionIconClass)} />
                  <span>Offline - Sign in unavailable</span>
                </>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Error message */}
            {displayError && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{displayError}</p>
              </div>
            )}

            {/* Login form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email field */}
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    disabled={isLoading || !isOnline}
                    autoComplete="email"
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    disabled={isLoading || !isOnline}
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {/* Submit button */}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !isOnline}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-divider" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            {/* Continue without login */}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleContinueWithoutLogin}
              disabled={isLoading}
            >
              Continue Without Signing In
            </Button>

            {/* Help text */}
            <p className="text-center text-xs text-muted-foreground">
              You can use the app offline without signing in.
              <br />
              Local vault workflows stay available either way.
            </p>

            {/* Register link */}
            <div className="text-center pt-4 border-t border-divider">
              <p className="text-sm text-muted-foreground">
                Don&apos;t have an account?{' '}
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
