export const fetcher = async (url: string, options?: RequestInit) => {
    let apiKey: string | null = null;
    
    // 1. Prioritize key from localStorage (user-provided)
    if (typeof window !== 'undefined') {
        apiKey = localStorage.getItem('apiKey');
    }

    // 2. Fallback to environment variable (default/demo key)
    if (!apiKey) {
        apiKey = process.env.NEXT_PUBLIC_DEMO_API_KEY || null;
    }

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
        const errorPayload = await res.json().catch(() => ({ message: res.statusText }));
        const error = new Error(errorPayload.message || 'An error occurred while fetching the data.') as any;
        error.status = res.status;
        error.payload = errorPayload;
        throw error;
    }

    if (res.status === 204) {
        return null;
    }

    return res.json();
}; 