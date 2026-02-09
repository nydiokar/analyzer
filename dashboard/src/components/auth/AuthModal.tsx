'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { Eye, EyeOff, Mail, Lock, Check } from 'lucide-react';
import { toast } from 'sonner';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: 'login' | 'register';
  onSuccess?: () => void;
  reason?: 'session_expired' | 'unauthorized' | 'manual';
}

export function AuthModal({ open, onOpenChange, defaultTab = 'login', onSuccess, reason }: AuthModalProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '', confirmPassword: '', registrationCode: '' });
  const { login, register, forgotPassword, loading } = useAuth();

  const isSessionExpired = reason === 'session_expired';

  const handleSubmit = async (e: React.FormEvent, isLogin: boolean) => {
    e.preventDefault();
    
    if (!formData.email || !formData.password) {
      return;
    }

    if (!isLogin) {
      if (!formData.confirmPassword) {
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        toast.error('Passwords do not match');
        return;
      }
    }

    const credentials = {
      email: formData.email,
      password: formData.password,
      ...((!isLogin && formData.registrationCode) && { registrationCode: formData.registrationCode }),
    };

    const success = isLogin
      ? await login(credentials)
      : await register(credentials);

    if (success) {
      onOpenChange(false);
      setFormData({ email: '', password: '', confirmPassword: '', registrationCode: '' });
      
      // Show email verification notice for new registrations
      if (!isLogin) {
        setTimeout(() => {
          toast.success('Account created! Please check your email and click the verification link to get started.', {
            duration: 8000,
          });
        }, 1000);
      }
      
      onSuccess?.();
    }
  };

  const handleInputChange = (field: 'email' | 'password' | 'confirmPassword' | 'registrationCode', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const isValidPassword = (password: string) => {
    return password.length >= 8 && /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password);
  };

  const canSubmitLogin = Boolean(formData.email && formData.password && isValidEmail(formData.email));
  const canSubmitRegister = Boolean(
    canSubmitLogin &&
    formData.confirmPassword &&
    formData.password === formData.confirmPassword &&
    isValidPassword(formData.password) &&
    formData.registrationCode
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {isSessionExpired
              ? 'Session Expired'
              : activeTab === 'login' ? 'Welcome Back' : 'Create Account'}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400">
            {isSessionExpired
              ? 'Your session has expired. Please log in again to continue.'
              : activeTab === 'login'
                ? 'Sign in to access wallet analytics'
                : 'Sign up to start analyzing wallets'}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <Tabs value={activeTab} onValueChange={(tab) => setActiveTab(tab as 'login' | 'register')}>
            <TabsList className="grid w-full grid-cols-2 mb-3">
              <TabsTrigger value="login">Log In</TabsTrigger>
              <TabsTrigger value="register">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-2.5 mt-0">
              <form onSubmit={(e) => handleSubmit(e, true)} className="space-y-2.5">
                <div className="space-y-1">
                  <Label htmlFor="login-email" className="text-xs text-slate-400">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="Enter your email"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      className="pl-9 h-9 text-sm"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="login-password" className="text-xs text-slate-400">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={(e) => handleInputChange('password', e.target.value)}
                      className="pl-9 pr-9 h-9 text-sm"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-9 text-sm bg-blue-600 hover:bg-blue-700 mt-3"
                  disabled={loading || !canSubmitLogin}
                >
                  {loading ? 'Signing in...' : 'Log In'}
                </Button>

                {!showForgotPassword && (
                  <div className="text-center mt-2">
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(true)}
                      className="text-xs text-blue-400 hover:text-blue-300 underline"
                    >
                      Forgot your password?
                    </button>
                  </div>
                )}

                {showForgotPassword && (
                  <div className="mt-2 p-3 border border-slate-700 rounded-lg bg-slate-800/50">
                    <p className="text-xs text-slate-400 mb-2">
                      Enter your email and we&apos;ll send you a reset link.
                    </p>
                    <Button
                      type="button"
                      onClick={async () => {
                        if (!formData.email || !isValidEmail(formData.email)) {
                          toast.error('Please enter a valid email address');
                          return;
                        }
                        const success = await forgotPassword(formData.email);
                        if (success) {
                          setShowForgotPassword(false);
                        }
                      }}
                      className="w-full h-8 text-sm bg-slate-700 hover:bg-slate-600"
                      disabled={loading || !formData.email}
                    >
                      {loading ? 'Sending...' : 'Send Reset Link'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setShowForgotPassword(false)}
                      className="w-full mt-1.5 text-xs text-slate-400 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </form>
            </TabsContent>

            <TabsContent value="register" className="space-y-2.5 mt-0">
              <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-2.5">
                <div className="space-y-1">
                  <Label htmlFor="register-email" className="text-xs text-slate-400">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="register-email"
                      type="email"
                      placeholder="Enter your email"
                      value={formData.email}
                      onChange={(e) => handleInputChange('email', e.target.value)}
                      className="pl-9 h-9 text-sm"
                      required
                    />
                  </div>
                  {formData.email && !isValidEmail(formData.email) && (
                    <p className="text-xs text-red-400">Please enter a valid email address</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="register-password" className="text-xs text-slate-400">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="register-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Create a strong password"
                      value={formData.password}
                      onChange={(e) => handleInputChange('password', e.target.value)}
                      className="pl-9 pr-9 h-9 text-sm"
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {formData.password && (
                    <div className="space-y-0.5 mt-1">
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          formData.password.length >= 8 ? 'bg-green-500' : 'bg-slate-500'
                        }`} />
                        <span className={formData.password.length >= 8 ? 'text-green-400' : 'text-slate-500'}>
                          8+ characters
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password) ? 'bg-green-500' : 'bg-slate-500'
                        }`} />
                        <span className={/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password) ? 'text-green-400' : 'text-slate-500'}>
                          Upper, lower & number
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="register-confirm-password" className="text-xs text-slate-400">Confirm Password</Label>
                  <div className="relative">
                    <Check className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      id="register-confirm-password"
                      type="password"
                      placeholder="Re-enter your password"
                      value={formData.confirmPassword}
                      onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                      className="pl-9 h-9 text-sm"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                    <p className="text-xs text-red-400">Passwords do not match</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="registration-code" className="text-xs text-slate-400">Registration Code</Label>
                  <Input
                    id="registration-code"
                    type="text"
                    placeholder="Enter your invite code"
                    value={formData.registrationCode}
                    onChange={(e) => handleInputChange('registrationCode', e.target.value)}
                    className="h-9 text-sm font-mono"
                    required
                  />
                  <p className="text-xs text-slate-500">Invite code required</p>
                </div>

                <Button
                  type="submit"
                  className="w-full h-9 text-sm bg-blue-600 hover:bg-blue-700 mt-3"
                  disabled={loading || !canSubmitRegister}
                >
                  {loading ? 'Creating account...' : 'Create Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-4 text-center">
            <p className="text-xs text-slate-600">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
