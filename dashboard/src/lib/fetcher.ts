export const fetcher = async (url: string, options?: RequestInit) => {
    // In a real scenario, you might have a base URL configured
    // For now, we assume the Next.js dev server might proxy /api calls if set up,
    // or this would fail gracefully until the API is live.
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    let baseHeaders: HeadersInit = {};

    if (apiKey) {
        baseHeaders['X-API-Key'] = apiKey;
    } else {
        console.warn(
            'API key (NEXT_PUBLIC_API_KEY) is not set. API requests might fail if authentication is required.'
        );
        // Depending on API setup, you might want to throw an error here or allow requests without the key
    }

    // Merge base headers with any headers provided in options
    const mergedHeaders = {
        ...baseHeaders,
        ...(options?.headers || {}),
    };

    let res;
    try {
        res = await fetch(url, {
            ...options, // Spread other options like method, body
            headers: mergedHeaders, // Use the merged headers
        });
    } catch (e: any) {
        // Network errors (like ECONNREFUSED) often manifest as TypeErrors in the browser's fetch API
        // or might have specific properties depending on the environment.
        // A common message for a true network failure is "Failed to fetch".
        const networkError = new Error(
            e.message || 'Network error: Failed to fetch data. Please check your connection and ensure the server is running.'
        ) as any;
        networkError.isNetworkError = true;
        networkError.status = e.status || 0; // No HTTP status for true network errors, use 0 or a specific code
        networkError.originalError = e; // Store original error for debugging
        throw networkError;
    }

    if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({ message: res.statusText }));
        const error = new Error(errorPayload.message || 'An error occurred while fetching the data.') as any;
        // Attach extra info to the error object
        error.status = res.status;
        error.payload = errorPayload;
        throw error;
    }

    // Handle 204 No Content responses specifically
    if (res.status === 204) {
        return null; // Or undefined, or { success: true }, depending on how you want to signal success
    }

    return res.json();
}; 