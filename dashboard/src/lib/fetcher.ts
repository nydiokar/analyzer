import { useApiKeyStore } from '@/store/api-key-store';

export const fetcher = async (url: string, options?: RequestInit) => {
    // Get the key directly from the Zustand store's state
    const apiKey = useApiKeyStore.getState().apiKey;
    
    const baseHeaders: HeadersInit = {
        'Content-Type': 'application/json',
    };

    if (apiKey) {
        baseHeaders['X-API-Key'] = apiKey;
    }
    // No warning if key is missing, as the backend will handle unauthorized requests.

    // Merge base headers with any headers provided in the specific fetch call
    const mergedHeaders = {
        ...baseHeaders,
        ...(options?.headers || {}),
    };

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
    // The baseUrl from env variables is now the single source of truth.
    // All calls from components should start with a '/', e.g. /wallets/summary
    const absoluteUrl = `${baseUrl}${url}`;

    let res;
    try {
        res = await fetch(absoluteUrl, {
            ...options,
            headers: mergedHeaders,
        });
    } catch (e: unknown) {
        // Network errors - using built-in Error type
        const errorMessage = e instanceof Error ? e.message : 'Network error: Failed to fetch data. Please check your connection and the server status.';
        const networkError = new Error(errorMessage);
        // Using built-in Error properties
        Object.defineProperty(networkError, 'isNetworkError', { value: true });
        Object.defineProperty(networkError, 'status', { value: (e as any).status || 0 });
        Object.defineProperty(networkError, 'originalError', { value: e });
        throw networkError;
    }

    if (!res.ok) {
        let errorPayload;
        try {
            errorPayload = await res.json();
        } catch {
            errorPayload = { message: res.statusText || 'An error occurred' };
        }
        const error = new Error(errorPayload.message || 'An error occurred while fetching the data.');
        // Using built-in Error properties
        Object.defineProperty(error, 'status', { value: res.status });
        Object.defineProperty(error, 'payload', { value: errorPayload });
        throw error;
    }

    // Handle responses that are successful but have no content body.
    // This is common for DELETE (204) or sometimes POST (201) requests.
    const contentLength = res.headers.get('content-length');
    

    
    // Handle responses that are successful but have no content body.
    // This is common for DELETE (204) or sometimes POST (201) requests.
    if (res.status === 204 || res.status === 201 || (contentLength && parseInt(contentLength, 10) === 0)) {
        return null;
    }

    // For any other successful response, try to parse JSON.
    try {
        return await res.json();
    } catch (e) {
        // This handles cases where the server returns a successful status
        // but the body is not valid JSON.
        const jsonError = new Error('Failed to parse JSON response from server.');
        // Using built-in Error properties
        Object.defineProperty(jsonError, 'status', { value: res.status });
        Object.defineProperty(jsonError, 'originalError', { value: e });
        throw jsonError;
    }
}; 