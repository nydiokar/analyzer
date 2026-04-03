import type { Auth, X402Accept, X402ErrorBody } from "./types.js";

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
  query?: Record<string, string | number | boolean | undefined>;
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
    }
    return this.requestWithX402<T>(url, method, opts.body, opts.headers);
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async requestWithApiKey<T>(
    url: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        ...(headers ?? {}),
        "X-Api-Key": this.auth.kind === "apikey" ? this.auth.apiKey : "",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.parseResponse<T>(response);
  }

  private async requestWithX402<T>(
    url: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const probe = await fetch(url, {
      method,
      headers: {
        ...(headers ?? {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (probe.status !== 402) {
      return this.parseResponse<T>(probe);
    }

    const x402Body = await this.parseX402ErrorBody(probe);
    const paymentRequired = this.parsePaymentRequiredHeader(
      probe.headers.get("PAYMENT-REQUIRED"),
    );
    const accept = paymentRequired?.accepts?.[0] ?? x402Body.accepts?.[0];
    if (!accept) {
      throw new X402PaymentError(x402Body, "402: no payment instructions");
    }

    if (this.auth.kind !== "x402") {
      throw new X402PaymentError(x402Body, "402 received but client auth is not x402");
    }

    const paymentHeader = await this.auth.buildPayment(
      accept.payTo,
      BigInt(accept.amount),
    );

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

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 402) {
      const body = await this.parseX402ErrorBody(response);
      throw new X402PaymentError(body, "402: payment required");
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
      throw new SovaHttpError(response.status, body, `HTTP ${response.status}: ${response.url}`);
    }

    return response.json() as Promise<T>;
  }

  private async parseX402ErrorBody(response: Response): Promise<X402ErrorBody> {
    let body: X402ErrorBody = {
      error: "Payment required",
      required: 0,
    };

    try {
      body = (await response.json()) as X402ErrorBody;
    } catch {
      // Ignore non-JSON payment responses.
    }

    const paymentRequired = this.parsePaymentRequiredHeader(
      response.headers.get("PAYMENT-REQUIRED"),
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
    accepts: X402Accept[];
  } | null {
    if (!value) return null;
    try {
      const decoded = decodeBase64(value);
      const parsed = JSON.parse(decoded) as {
        x402Version?: number;
        accepts?: X402Accept[];
      };
      if (!parsed.accepts?.length) return null;
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

  const runtime = globalThis as unknown as { atob?: (value: string) => string };
  if (runtime.atob) {
    return runtime.atob(input);
  }

  throw new Error("No base64 decoder available in this runtime");
}
