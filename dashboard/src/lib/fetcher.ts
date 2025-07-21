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

    // Handle responses that are successful but have no content body.
    // This is common for DELETE (204) or sometimes POST (201) requests.
    const contentLength = res.headers.get('content-length');
    
    // Debug: Log the actual contentLength value
    if (res.status === 200) {
        console.log('🔍 Debug: Response details:', {
            url: absoluteUrl,
            status: res.status,
            contentLength,
            contentLengthType: typeof contentLength,
            contentLengthParsed: contentLength ? parseInt(contentLength, 10) : null,
            method: options?.method || 'GET'
        });
    }
    
    // Debug: Check if condition should trigger
    const shouldReturnNull = res.status === 204 || res.status === 201 || (contentLength && parseInt(contentLength, 10) === 0);
    if (res.status === 200 && contentLength === '0') {
        console.log('🔍 Debug: Should return null?', {
            url: absoluteUrl,
            shouldReturnNull,
            condition1: false, // res.status === 204 is always false for 200
            condition2: false, // res.status === 201 is always false for 200
            condition3: (contentLength && parseInt(contentLength, 10) === 0),
            contentLength,
            contentLengthParsed: parseInt(contentLength, 10)
        });
    }
    
    if (shouldReturnNull) {
        console.log('🔍 Debug: Returning null for:', absoluteUrl);
        return null;
    }

    // For any other successful response, try to parse JSON.
    try {
        return await res.json();
    } catch (e) {
        // This handles cases where the server returns a successful status
        // but the body is not valid JSON.
        const jsonError = new Error('Failed to parse JSON response from server.') as any;
        jsonError.status = res.status;
        jsonError.originalError = e;
        throw jsonError;
    }
}; 