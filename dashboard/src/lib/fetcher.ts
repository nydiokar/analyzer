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

    const res = await fetch(url, {
        ...options, // Spread other options like method, body
        headers: mergedHeaders, // Use the merged headers
    });

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