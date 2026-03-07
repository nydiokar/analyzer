// ---------------------------------------------------------------------------
// Sova Intel SDK — minimal HTTP layer (no external deps beyond fetch)
// ---------------------------------------------------------------------------

import type { Auth, X402ErrorBody } from "./types.js";

export class SovaHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "SovaHttpError";
  }
}

export class X402PaymentError extends Error {
  constructor(
    public readonly body: X402ErrorBody,
    message: string,
  ) {
    super(message);
    this.name = "X402PaymentError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
};

export class HttpClient {
  private readonly baseUrl: string;
  private readonly auth: Auth;

  constructor(baseUrl: string, auth: Auth) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = auth;
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const method = opts.method ?? "GET";

    if (this.auth.kind === "apikey") {
      return this.requestWithApiKey<T>(url, method, opts.body, opts.headers);
    } else {
      return this.requestWithX402<T>(url, method, opts.body, opts.headers);
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private authHeaders(): Record<string, string> {
    if (this.auth.kind === "apikey") {
      return { "X-Api-Key": this.auth.apiKey };
    }
    return {};
  }

  private async requestWithApiKey<T>(
    url: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
        ...(headers ?? {}),
        ...this.authHeaders(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.parseResponse<T>(res);
  }

  private async requestWithX402<T>(
    url: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    // Step 1: probe — no auth
    const probe = await fetch(url, {
      method,
      headers: {
        ...(headers ?? {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (probe.status === 402) {
      const x402Body = await this.parseX402ErrorBody(probe);
      const paymentRequired = this.parsePaymentRequiredHeader(
        probe.headers.get("PAYMENT-REQUIRED"),
      );
      const accept = paymentRequired?.accepts?.[0] ?? x402Body.accepts?.[0];
      if (!accept) {
        throw new X402PaymentError(x402Body, "402: no payment instructions");
      }
      const paymentHeader = await (this.auth as import("./types.js").X402Auth).buildPayment(
        accept.payTo,
        BigInt(accept.amount),
      );
      // Step 2: retry with payment-signature header (x402 v2)
      const paid = await fetch(url, {
        method,
        headers: {
          ...(headers ?? {}),
          "payment-signature": paymentHeader,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return this.parseResponse<T>(paid);
    }

    return this.parseResponse<T>(probe);
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    if (res.status === 402) {
      const body = await this.parseX402ErrorBody(res);
      throw new X402PaymentError(body, `402: payment required`);
    }
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      throw new SovaHttpError(res.status, body, `HTTP ${res.status}: ${res.url}`);
    }
    return res.json() as Promise<T>;
  }

  private async parseX402ErrorBody(res: Response): Promise<X402ErrorBody> {
    let body: X402ErrorBody = {
      error: "Payment required",
      required: 0,
    };
    try {
      body = (await res.json()) as X402ErrorBody;
    } catch {
      // Keep default body for non-JSON 402 responses.
    }

    const paymentRequired = this.parsePaymentRequiredHeader(
      res.headers.get("PAYMENT-REQUIRED"),
    );
    if (paymentRequired?.accepts?.length) {
      body = {
        ...body,
        x402Version: paymentRequired.x402Version,
        accepts: paymentRequired.accepts,
      };
    }
    return body;
  }

  private parsePaymentRequiredHeader(value: string | null): {
    x402Version: number;
    accepts: import("./types.js").X402Accept[];
  } | null {
    if (!value) return null;
    try {
      const decoded = decodeBase64(value);
      const parsed = JSON.parse(decoded) as {
        x402Version?: number;
        accepts?: import("./types.js").X402Accept[];
      };
      if (!parsed?.accepts?.length) return null;
      return {
        x402Version: parsed.x402Version ?? 2,
        accepts: parsed.accepts,
      };
    } catch {
      return null;
    }
  }
}

function decodeBase64(input: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "base64").toString("utf8");
  }
  const g = globalThis as unknown as { atob?: (value: string) => string };
  if (g.atob) {
    return g.atob(input);
  }
  throw new Error("No base64 decoder available in this runtime");
}
