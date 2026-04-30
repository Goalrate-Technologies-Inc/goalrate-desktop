/**
 * Register Page for Desktop App
 *
 * Registration form with email, password, display name, and username.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@goalrate-app/ui/utils';
import { Button, Input, Label, Card, CardContent, CardHeader, CardTitle, CardDescription } from '@goalrate-app/ui/primitives';
import { Logo } from '@goalrate-app/ui/brand';
import { Mail, Lock, User, AtSign, Loader2, AlertCircle, CheckCircle, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

/**
 * Password strength requirements
 */
const PASSWORD_REQUIREMENTS = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
];

/**
 * Desktop registration page component
 */
export default function RegisterPage(): React.ReactElement {
  const navigate = useNavigate();
  const { register, continueWithoutLogin, isLoading, error, clearError, isOnline } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showPasswordRequirements, setShowPasswordRequirements] = useState(false);

  const passwordStrength = PASSWORD_REQUIREMENTS.filter((req) => req.test(password)).length;
  const isPasswordValid = passwordStrength === PASSWORD_REQUIREMENTS.length;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    // Validation
    if (!email.trim()) {
      setLocalError('Please enter your email address');
      return;
    }
    if (!displayName.trim()) {
      setLocalError('Please enter your display name');
      return;
    }
    if (!username.trim()) {
      setLocalError('Please enter a username');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setLocalError('Username can only contain letters, numbers, and underscores');
      return;
    }
    if (username.length < 3) {
      setLocalError('Username must be at least 3 characters');
      return;
    }
    if (!isPasswordValid) {
      setLocalError('Please choose a stronger password');
      return;
    }

    try {
      await register(email, password, displayName, username);
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
              <CardTitle className="text-2xl font-bold">Create Account</CardTitle>
              <CardDescription className="text-base">
                Create a GoalRate account
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
                  <span>Offline - Registration unavailable</span>
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

            {/* Registration form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Display name field */}
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="displayName"
                    type="text"
                    placeholder="Your Name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="pl-10"
                    disabled={isLoading || !isOnline}
                    autoComplete="name"
                  />
                </div>
              </div>

              {/* Username field */}
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    className="pl-10"
                    disabled={isLoading || !isOnline}
                    autoComplete="username"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Letters, numbers, and underscores only
                </p>
              </div>

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
                    placeholder="Create a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setShowPasswordRequirements(true)}
                    className="pl-10"
                    disabled={isLoading || !isOnline}
                    autoComplete="new-password"
                  />
                </div>

                {/* Password strength indicator */}
                {showPasswordRequirements && password.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((level) => (
                        <div
                          key={level}
                          className={cn(
                            'h-1 flex-1 rounded-full transition-colors',
                            passwordStrength >= level
                              ? passwordStrength === 4
                                ? 'bg-green-500'
                                : passwordStrength >= 3
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              : 'bg-muted'
                          )}
                        />
                      ))}
                    </div>
                    <div className="space-y-1">
                      {PASSWORD_REQUIREMENTS.map((req, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center gap-2 text-xs',
                            req.test(password) ? 'text-green-600' : 'text-muted-foreground'
                          )}
                        >
                          {req.test(password) ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <div className="h-3 w-3 rounded-full border border-current" />
                          )}
                          <span>{req.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                    Creating account...
                  </>
                ) : (
                  'Create Account'
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
              Continue Without Account
            </Button>

            {/* Login link */}
            <div className="text-center pt-4 border-t border-divider">
              <p className="text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="font-medium text-primary hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
