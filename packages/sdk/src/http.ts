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
      return this.requestWithApiKey<T>(url, method, opts.body);
    } else {
      return this.requestWithX402<T>(url, method, opts.body);
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
  ): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: {
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
  ): Promise<T> {
    // Step 1: probe — no auth
    const probe = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    if (probe.status === 402) {
      const x402Body = (await probe.json()) as X402ErrorBody;
      const accept = x402Body.accepts?.[0];
      if (!accept) {
        throw new X402PaymentError(x402Body, "402: no payment instructions");
      }
      const paymentHeader = await (this.auth as import("./types.js").X402Auth).buildPayment(
        accept.payTo,
        BigInt(accept.maxAmountRequired),
      );
      // Step 2: retry with X-Payment header
      const paid = await fetch(url, {
        method,
        headers: {
          "X-Payment": paymentHeader,
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
      const body = (await res.json()) as X402ErrorBody;
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
}
