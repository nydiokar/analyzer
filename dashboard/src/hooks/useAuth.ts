import { useState, useCallback } from 'react';
import { useAuthStore } from '@/store/auth-store';
import { toast } from 'sonner';
interface LoginCredentials {
  email: string;
  password: string;
}

interface RegisterCredentials {
  email: string;
  password: string;
  registrationCode?: string;
}

interface AuthError {
  message: string;
  status?: number;
}

export const useAuth = () => {
  const [loading, setLoading] = useState(false);
  const authStore = useAuthStore();
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

  const register = useCallback(async (credentials: RegisterCredentials): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        let errorMessage = 'Registration failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          // Use default error message
        }
        
        if (response.status === 409) {
          errorMessage = 'An account with this email already exists';
        } else if (response.status === 429) {
          errorMessage = 'Too many registration attempts. Please try again later.';
        }
        
        toast.error(errorMessage);
        return false;
      }

      const data = await response.json();

      // Login the user immediately after successful registration
      authStore.login(
        data.access_token,
        {
          id: data.user.id,
          email: data.user.email,
          isDemo: data.user.isDemo,
          emailVerified: data.user.emailVerified,
          isAdmin: data.user.isAdmin || false,
          isAnalyst: data.user.isAnalyst || false,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
        data.refresh_token // ✅ Store refresh token
      );

      toast.success('Account created successfully!');
      return true;
    } catch (error) {
      console.error('Registration error:', error);
      toast.error('Registration failed. Please check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStore]);

  const login = useCallback(async (credentials: LoginCredentials): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        let errorMessage = 'Login failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          // Use default error message
        }

        if (response.status === 401) {
          errorMessage = 'Invalid email or password';
        } else if (response.status === 429) {
          errorMessage = 'Too many login attempts. Please try again later.';
        }

        toast.error(errorMessage);
        return false;
      }

      const data = await response.json();

      authStore.login(
        data.access_token,
        {
          id: data.user.id,
          email: data.user.email,
          isDemo: data.user.isDemo,
          emailVerified: data.user.emailVerified,
          isAdmin: data.user.isAdmin || false,
          isAnalyst: data.user.isAnalyst || false,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
        data.refresh_token // ✅ Store refresh token
      );

      toast.success('Successfully logged in!');
      return true;
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Login failed. Please check your connection and try again.');
      return false;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStore]);

  const logout = useCallback(async () => {
    // Store handles API call with refresh token
    authStore.logout();
    toast.success('Successfully logged out');
  }, [authStore]);

  const refreshUserProfile = useCallback(async (): Promise<boolean> => {
    try {
      const authHeader = authStore.getAuthHeader();
      if (!authHeader) return false;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (authHeader.startsWith('Bearer ')) {
        headers['Authorization'] = authHeader;
      } else {
        headers['X-API-Key'] = authHeader;
      }

      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers,
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token/key is invalid, logout user
          authStore.logout();
          toast.error('Your session has expired. Please log in again.');
        }
        return false;
      }

      const userData = await response.json();
      authStore.updateUser(userData);
      return true;
    } catch (error) {
      console.error('Failed to refresh user profile:', error);
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStore]);

  const requestEmailVerification = useCallback(async (): Promise<boolean> => {
    try {
      const authHeader = authStore.getAuthHeader();
      if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

      const response = await fetch(`${API_BASE_URL}/auth/request-verification`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.message || 'Failed to request email verification');
        return false;
      }

      const data = await response.json();
      toast.success(data.message, { duration: 10000 });
      return true;
    } catch (error) {
      console.error('Failed to request email verification:', error);
      toast.error('Failed to request email verification. Please try again.');
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStore]);

  const verifyEmail = useCallback(async (token: string): Promise<boolean> => {
    try {
      const authHeader = authStore.getAuthHeader();
      if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

      const response = await fetch(`${API_BASE_URL}/auth/verify-email`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.message || 'Failed to verify email');
        return false;
      }

      const data = await response.json();
      toast.success(data.message || 'Email verified successfully!');

      // Refresh user profile to get updated verification status
      await refreshUserProfile();
      return true;
    } catch (error) {
      console.error('Failed to verify email:', error);
      toast.error('Failed to verify email. Please try again.');
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStore, refreshUserProfile]);

  const forgotPassword = useCallback(async (email: string): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Special handling for rate limiting (429)
        if (response.status === 429) {
          toast.error(errorData.message || 'Too many password reset requests. Please wait a few minutes.', {
            duration: 6000, // Show for 6 seconds for rate limit errors
          });
        } else {
          toast.error(errorData.message || 'Failed to request password reset');
        }
        return false;
      }

      const data = await response.json();
      toast.success(data.message || 'If this email is registered, you will receive a password reset link.', {
        duration: 8000,
      });
      return true;
    } catch (error) {
      console.error('Failed to request password reset:', error);
      toast.error('Failed to request password reset. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetPassword = useCallback(async (email: string, token: string, newPassword: string): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, token, newPassword }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Special handling for rate limiting (429) with longer toast duration
        if (response.status === 429) {
          toast.error(errorData.message || 'Too many attempts. Please wait a moment.', {
            duration: 5000, // Show for 5 seconds for rate limit errors
          });
        } else {
          toast.error(errorData.message || 'Failed to reset password');
        }
        return false;
      }

      const data = await response.json();
      toast.success(data.message || 'Password reset successfully! Please log in with your new password.');
      return true;
    } catch (error) {
      console.error('Failed to reset password:', error);
      toast.error('Failed to reset password. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // Auth state from store
    user: authStore.user,
    token: authStore.token,
    apiKey: authStore.apiKey,
    isAuthenticated: authStore.isAuthenticated,
    isUsingApiKey: authStore.isUsingApiKey,
    isInitialized: authStore.isInitialized,
    isDemoMode: authStore.isDemoMode(),

    // Auth actions
    register,
    login,
    logout,
    setApiKey: authStore.setApiKey,
    setDemoMode: authStore.setDemoMode,
    clearAuth: authStore.clearAuth,
    refreshUserProfile,
    requestEmailVerification,
    verifyEmail,
    forgotPassword,
    resetPassword,
    getAuthHeader: authStore.getAuthHeader,

    // Loading state
    loading,
  };
};
