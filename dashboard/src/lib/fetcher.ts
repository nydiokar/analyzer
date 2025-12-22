import { useAuthStore } from '@/store/auth-store';
import { toast } from 'sonner';

// Build auth headers from stores (JWT preferred, API key fallback)
const buildAuthHeaders = () => {
  const authState = useAuthStore.getState();
  const authHeader = authState.getAuthHeader?.();
  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  if (authHeader?.startsWith('Bearer ')) {
    headers['Authorization'] = authHeader;
  } else if (authHeader) {
    headers['X-API-Key'] = authHeader;
  }

  return headers;
};

// If access token expired, try refreshing once and retry the original request
const attemptRefreshAndRetry = async (
  absoluteUrl: string,
  options: RequestInit | undefined
) => {
  const authStore = useAuthStore.getState();

  console.log('Access token expired, attempting automatic refresh...');
  const refreshed = await authStore.refreshToken();

  if (!refreshed) {
    console.log('Automatic refresh failed - refresh token may be expired');
    // Don't throw error immediately - let the 401 propagate naturally
    // The logout will be handled by the auth store if refresh token is truly expired
    const error = new Error('Unable to refresh session. Please log in again.');
    Object.defineProperty(error, 'status', { value: 401 });
    Object.defineProperty(error, 'code', { value: 'REFRESH_FAILED' });
    throw error;
  }

  console.log('Access token refreshed, retrying request...');

  // Rebuild headers with new token and retry once
  const retryHeaders = {
    ...buildAuthHeaders(),
    ...(options?.headers || {}),
  };

  const retryRes = await fetch(absoluteUrl, { ...options, headers: retryHeaders });
  return retryRes;
};

export const fetcher = async (url: string, options?: RequestInit) => {
  const baseHeaders = buildAuthHeaders();
  const mergedHeaders = {
    ...baseHeaders,
    ...(options?.headers || {}),
  };

  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const absoluteUrl = `${baseUrl}${url}`;

  let res;
  try {
    res = await fetch(absoluteUrl, {
      ...options,
      headers: mergedHeaders,
    });
  } catch (e: unknown) {
    const errorMessage =
      e instanceof Error
        ? e.message
        : 'Network error: Failed to fetch data. Please check your connection and the server status.';
    const networkError = new Error(errorMessage);
    Object.defineProperty(networkError, 'isNetworkError', { value: true });
    Object.defineProperty(networkError, 'status', { value: (e as any).status || 0 });
    Object.defineProperty(networkError, 'originalError', { value: e });
    throw networkError;
  }

  // Handle expired JWT: attempt silent refresh once, then retry
  if (res.status === 401 && useAuthStore.getState().token && !useAuthStore.getState().isUsingApiKey) {
    try {
      res = await attemptRefreshAndRetry(absoluteUrl, options);
    } catch (refreshError) {
      // If refresh fails, show a user-friendly toast and redirect to login
      const authStore = useAuthStore.getState();
      if (!authStore.isAuthenticated) {
        // Already logged out by refresh logic, just redirect
        toast.error('Your session has expired. Please log in again.');
        if (typeof window !== 'undefined') {
          window.location.href = '/';
        }
      }
      throw refreshError;
    }
  }

  if (!res.ok) {
    let errorPayload;
    try {
      errorPayload = await res.json();
    } catch {
      errorPayload = { message: res.statusText || 'An error occurred' };
    }

    const error = new Error(errorPayload.message || 'An error occurred while fetching the data.');
    Object.defineProperty(error, 'status', { value: res.status });
    Object.defineProperty(error, 'payload', { value: errorPayload });
    if (errorPayload.code) {
      Object.defineProperty(error, 'code', { value: errorPayload.code });
      if (errorPayload.code === 'EMAIL_VERIFICATION_REQUIRED') {
        Object.defineProperty(error, 'requiresEmailVerification', { value: true });
      }
    }

    // Don't emit session expired events - let automatic refresh handle it
    // Only show user-facing error for non-auth issues
    if (res.status !== 401) {
      console.error('API Error:', error);
    }

    throw error;
  }

  const contentLength = res.headers.get('content-length');
  if (res.status === 204 || (contentLength && parseInt(contentLength, 10) === 0)) {
    return null;
  }

  try {
    return await res.json();
  } catch (e) {
    const jsonError = new Error('Failed to parse JSON response from server.');
    Object.defineProperty(jsonError, 'status', { value: res.status });
    Object.defineProperty(jsonError, 'originalError', { value: e });
    throw jsonError;
  }
};
