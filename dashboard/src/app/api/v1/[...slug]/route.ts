import { NextResponse } from 'next/server';

const NEST_API_URL = process.env.NEST_API_URL || 'http://localhost:3001/api/v1';

async function handler(req: Request) {
  const url = new URL(req.url);
  const slug = url.pathname.replace('/api/v1/', ''); // Get the path part after /api/v1/
  const nestJsBackendUrl = `${NEST_API_URL}/${slug}${url.search}`;

  console.log(`Proxying request: ${req.method} ${url.pathname} -> ${nestJsBackendUrl}`);

  try {
    const backendResponse = await fetch(nestJsBackendUrl, {
      method: req.method,
      headers: req.headers, // Forward all headers, including X-API-Key, Content-Type etc.
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
      // IMPORTANT: For Next.js App Router route handlers, you might need to set duplex if streaming bodies.
      // For simple proxying of JSON/text bodies, this should be okay.
      // If you encounter issues with streaming or larger bodies, you might need `(req as any).duplex = 'half'` 
      // or to use a more robust proxy library.
    });

    // Create a new Headers object for the response, copying from backendResponse
    const responseHeaders = new Headers();
    backendResponse.headers.forEach((value, key) => {
      responseHeaders.append(key, value);
    });

    // If the backend sends a 204, Next.js should also send a 204 with no body.
    if (backendResponse.status === 204) {
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    // Get the response body as text or blob depending on content type
    // For simplicity, let's assume text/json for now. Blob/Buffer might be needed for other types.
    const responseBody = await backendResponse.text();
    
    // console.log(`Backend response status: ${backendResponse.status}`);
    // console.log(`Backend response headers:`, Object.fromEntries(responseHeaders.entries()));
    // console.log(`Backend response body (first 100 chars): ${responseBody.substring(0,100)}`);

    return new Response(responseBody, {
      status: backendResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Error proxying request to NestJS:', error);
    return NextResponse.json({ message: 'Error proxying request to backend.' }, { status: 502 }); // 502 Bad Gateway
  }
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD, handler as OPTIONS };

// Opt-out of caching for API routes by default if they are dynamic
export const dynamic = 'force-dynamic'; 