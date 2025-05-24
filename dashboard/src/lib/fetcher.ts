export const fetcher = async (url: string) => {
    // In a real scenario, you might have a base URL configured
    // For now, we assume the Next.js dev server might proxy /api calls if set up,
    // or this would fail gracefully until the API is live.
    const apiKey = process.env.NEXT_PUBLIC_API_KEY;
    let headers: HeadersInit = {};

    if (apiKey) {
        headers['X-API-Key'] = apiKey;
    } else {
        console.warn(
            'API key (NEXT_PUBLIC_API_KEY) is not set. API requests might fail if authentication is required.'
        );
        // Depending on API setup, you might want to throw an error here or allow requests without the key
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({ message: res.statusText }));
        const error = new Error(errorPayload.message || 'An error occurred while fetching the data.') as any;
        // Attach extra info to the error object
        error.status = res.status;
        error.payload = errorPayload;
        throw error;
    }

    return res.json();
}; 