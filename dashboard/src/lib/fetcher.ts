import { useAuthStore } from '@/store/auth-store';
import { useApiKeyStore } from '@/store/api-key-store';
import { sessionEvents } from '@/lib/session-events';

// Stash last failed request to optionally replay after re-auth
let lastFailedRequest: { url: string; options?: RequestInit } | null = null;

export const replayLastFailedRequest = async () => {
  if (!lastFailedRequest) return null;
  const { url, options } = lastFailedRequest;
  lastFailedRequest = null;
  const baseHeaders = buildAuthHeaders();
  const mergedHeaders = { ...baseHeaders, ...(options?.headers || {}) };
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const absoluteUrl = `${baseUrl}${url}`;
  const res = await fetch(absoluteUrl, { ...options, headers: mergedHeaders });
  if (!res.ok) throw new Error('Failed to replay request');
  const contentLength = res.headers.get('content-length');
  if (res.status === 204 || (contentLength && parseInt(contentLength, 10) === 0)) {
    return null;
  }
  return res.json();
};

// Build auth headers from stores (JWT preferred, API key fallback)
const buildAuthHeaders = () => {
  const authState = useAuthStore.getState();
  const legacyApiKeyState = useApiKeyStore.getState();
  const authHeader = authState.getAuthHeader?.();
  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  if (authHeader?.startsWith('Bearer ')) {
    headers['Authorization'] = authHeader;
  } else if (authHeader) {
    headers['X-API-Key'] = authHeader;
  } else if (legacyApiKeyState.apiKey) {
    headers['X-API-Key'] = legacyApiKeyState.apiKey;
  }

  return headers;
};

// If access token expired, try refreshing once and retry the original request
const attemptRefreshAndRetry = async (
  absoluteUrl: string,
  options: RequestInit | undefined
) => {
  const authStore = useAuthStore.getState();
  const refreshed = await authStore.refreshToken();
  if (!refreshed) {
    const error = new Error('Session expired. Please sign in again.');
    Object.defineProperty(error, 'status', { value: 401 });
    Object.defineProperty(error, 'code', { value: 'SESSION_EXPIRED' });
    throw error;
  }

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
    res = await attemptRefreshAndRetry(absoluteUrl, options);
  }

  if (!res.ok) {
    let errorPayload;
    try {
      errorPayload = await res.json();
    } catch {
      errorPayload = { message: res.statusText || 'An error occurred' };
    }
    // Capture last failed request to allow replay after re-auth
    lastFailedRequest = { url, options };
    const error = new Error(errorPayload.message || 'An error occurred while fetching the data.');
    Object.defineProperty(error, 'status', { value: res.status });
    Object.defineProperty(error, 'payload', { value: errorPayload });
    if (errorPayload.code) {
      Object.defineProperty(error, 'code', { value: errorPayload.code });
      if (errorPayload.code === 'EMAIL_VERIFICATION_REQUIRED') {
        Object.defineProperty(error, 'requiresEmailVerification', { value: true });
      }
    }
    if (res.status === 401 || errorPayload.code === 'SESSION_EXPIRED') {
      sessionEvents.emitExpired();
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
