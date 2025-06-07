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

    let res;
    try {
        res = await fetch(url, {
            ...options,
            headers: mergedHeaders,
        });
    } catch (e: any) {
        // Network errors
        const networkError = new Error(
            e.message || 'Network error: Failed to fetch data. Please check your connection and the server status.'
        ) as any;
        networkError.isNetworkError = true;
        networkError.status = e.status || 0;
        networkError.originalError = e;
        throw networkError;
    }

    if (!res.ok) {
        let errorPayload;
        try {
            errorPayload = await res.json();
        } catch (e) {
            errorPayload = { message: res.statusText || 'An error occurred' };
        }
        const error = new Error(errorPayload.message || 'An error occurred while fetching the data.') as any;
        error.status = res.status;
        error.payload = errorPayload;
        throw error;
    }

    if (res.status === 204) {
        return null;
    }

    if (res.status === 201) {
        return res.json();
    }
    
    const responseText = await res.text();
    if (!responseText) {
        return null;
    }

    return JSON.parse(responseText);
}; 