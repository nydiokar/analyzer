import { useAuthStore } from '@/store/auth-store';
import { useUIStore } from '@/store/ui-store';
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

  // Double-check we still have a token before attempting refresh
  // (could have been cleared by another concurrent request)
  if (!authStore.token || authStore.isUsingApiKey) {
    const error = new Error('No valid session to refresh');
    Object.defineProperty(error, 'status', { value: 401 });
    Object.defineProperty(error, 'code', { value: 'NO_SESSION' });
    throw error;
  }

  console.log('Access token expired, attempting automatic refresh...');
  const refreshed = await authStore.refreshToken();

  if (!refreshed) {
    console.log('Automatic refresh failed - refresh token may be expired');
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
      // If refresh fails, show login modal instead of redirecting
      // Note: logout() is already called by refreshToken() in auth-store when it gets 401
      // We just need to show the UI feedback here
      if (typeof window !== 'undefined') {
        const uiStore = useUIStore.getState();

        // Only show modal if not already showing (prevent multiple modals from concurrent requests)
        if (!uiStore.showAuthModal) {
          uiStore.setShowAuthModal(true, 'session_expired');
          toast.error('Your session has expired. Please log in to continue.');
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

    const message = String(errorPayload.message || '');
    const isExpectedValidationError =
      res.status === 400 &&
      (message.startsWith('Invalid Solana address') || message.startsWith('Invalid token mint address'));
    const isExpectedNotFound =
      res.status === 404 && (
        message.startsWith('Token mint not found') ||
        message.includes('not found or has insufficient data for HUD')
      );

    // Don't emit session expired events - let automatic refresh handle it
    // Only log unexpected errors to avoid console spam during typing.
    if (res.status !== 401 && !isExpectedValidationError && !isExpectedNotFound) {
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
