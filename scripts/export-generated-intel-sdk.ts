import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type OpenApiSchema = {
  type?: string;
  format?: string;
  enum?: Array<string | number | null>;
  nullable?: boolean;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  $ref?: string;
  allOf?: OpenApiSchema[];
};

type OpenApiMediaType = {
  schema?: OpenApiSchema;
};

type OpenApiParameter = {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  schema?: OpenApiSchema;
};

type OpenApiOperation = {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, { content?: Record<string, OpenApiMediaType> }>;
};

type OpenApiDocument = {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
};

type Endpoint = {
  method: 'GET' | 'POST';
  path: string;
  operationId: string;
  responseType: string;
  bodyType: string | null;
  pathParams: OpenApiParameter[];
  queryParams: OpenApiParameter[];
};

const ROOT = process.cwd();
const OPENAPI_PATH = resolve(ROOT, 'artifacts/intel-openapi.json');
const SDK_PACKAGE_ROOT = resolve(ROOT, 'packages/sdk');
const DEFAULT_OUTPUT_PATH = resolve(ROOT, 'artifacts/generated-sdk-eval');

const METHOD_NAME_OVERRIDES: Record<string, string> = {
  IntelController_getWalletIntel: 'getWalletProfile',
  IntelController_getWalletTokens: 'getWalletTokens',
  IntelController_getWalletHud: 'getWalletHud',
  IntelController_queueTokenHolders: 'queueHolderProfiles',
  IntelController_queueWalletSimilarity: 'queueSimilarity',
  IntelController_queueTokenHoldersAgent: 'queueTokenHoldersAgent',
  IntelController_getAgentHolderProfilesResult: 'getAgentHolderProfilesResult',
  IntelController_queueWalletSimilarityAgent: 'queueWalletSimilarityAgent',
  IntelController_getAgentSimilarityResult: 'getAgentSimilarityResult',
  IntelController_queueTokenHoldersDeep: 'queueDeepAnalysis',
  IntelController_batchWalletHud: 'batchHud',
};

const BUILTIN_IMPORT_TYPES = new Set([
  'SovaIntelGeneratedClientConfig',
  'Record<string, string | number | boolean | undefined>',
  'unknown',
]);

function main(): void {
  const outputRoot = process.argv[2]
    ? resolve(process.argv[2])
    : DEFAULT_OUTPUT_PATH;

  const document = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiDocument;
  const schemas = document.components?.schemas ?? {};
  const endpoints = collectEndpoints(document);

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(join(outputRoot, 'src'), { recursive: true });

  copyStaticFile('package.json', outputRoot, updatePackageJson);
  copyStaticFile('tsconfig.json', outputRoot);
  copyStaticFile('tsconfig.cjs.json', outputRoot);
  copyStaticFile('tsconfig.esm.json', outputRoot);
  copyStaticFile('README.md', outputRoot, () => buildReadme(endpoints));

  writeFile(join(outputRoot, 'src', 'contracts.ts'), renderContractsFile(schemas));
  writeFile(join(outputRoot, 'src', 'types.ts'), renderSharedTypesFile());
  writeFile(join(outputRoot, 'src', 'http.ts'), renderHttpFile());
  writeFile(join(outputRoot, 'src', 'poller.ts'), renderPollerFile());
  writeFile(join(outputRoot, 'src', 'client.ts'), renderClientFile(endpoints, schemas));
  writeFile(join(outputRoot, 'src', 'index.ts'), renderIndexFile());

  console.log(`Wrote generated Intel SDK package to ${outputRoot}`);
}

function collectEndpoints(document: OpenApiDocument): Endpoint[] {
  const paths = document.paths ?? {};
  const endpoints: Endpoint[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const [methodName, operation] of Object.entries(methods)) {
      const method = methodName.toUpperCase();
      if (method !== 'GET' && method !== 'POST') continue;
      const operationId = operation.operationId;
      if (!operationId) continue;

      const parameters = operation.parameters ?? [];
      const responseType = resolvePrimaryResponseType(operation) ?? 'unknown';
      const bodyType = resolveBodyType(operation);

      endpoints.push({
        method,
        path: path.replace(/^\/api\/v1/, ''),
        operationId,
        responseType,
        bodyType,
        pathParams: parameters.filter((parameter) => parameter.in === 'path'),
        queryParams: parameters.filter((parameter) => parameter.in === 'query'),
      });
    }
  }

  return endpoints;
}

function resolvePrimaryResponseType(operation: OpenApiOperation): string | null {
  const preferredStatusCodes = ['200', '202'];
  for (const statusCode of preferredStatusCodes) {
    const schema = operation.responses?.[statusCode]?.content?.['application/json']?.schema;
    const typeName = schemaToTypeName(schema);
    if (typeName) return typeName;
  }
  return null;
}

function resolveBodyType(operation: OpenApiOperation): string | null {
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  return schemaToTypeName(schema);
}

function schemaToTypeName(schema: OpenApiSchema | undefined): string | null {
  if (!schema) return null;
  if (schema.$ref) return refName(schema.$ref);
  return null;
}

function renderContractsFile(schemas: Record<string, OpenApiSchema>): string {
  const blocks = Object.keys(schemas)
    .sort()
    .map((schemaName) => {
      const schema = requireSchema(schemas, schemaName);
      const resolved = resolveSchema(schemas, schema);
      return `export interface ${schemaName} ${renderObjectType(schemas, resolved, 0)}\n`;
    });

  return `// AUTO-GENERATED by scripts/export-generated-intel-sdk.ts
// Source: artifacts/intel-openapi.json
// Do not edit manually.

${blocks.join('\n')}`;
}

function renderSharedTypesFile(): string {
  return `// Shared non-OpenAPI SDK types

export interface ApiKeyAuth {
  kind: "apikey";
  apiKey: string;
}

export interface X402Auth {
  kind: "x402";
  buildPayment: (payTo: string, amountBaseUnits: bigint) => Promise<string>;
}

export type Auth = ApiKeyAuth | X402Auth;

export interface JobStatus {
  status: "waiting" | "active" | "delayed" | "completed" | "failed" | string;
  progress?: number;
}

export interface X402Accept {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
}

export interface X402ErrorBody {
  error: string;
  required: number;
  x402Version?: number;
  accepts?: X402Accept[];
}

export interface SovaIntelGeneratedClientConfig {
  baseUrl: string;
  auth: Auth;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}
`;
}

function renderHttpFile(): string {
  return `import type { Auth, X402Accept, X402ErrorBody } from "./types.js";

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
    this.baseUrl = baseUrl.replace(/\\/$/, "");
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
    const url = new URL(\`\${this.baseUrl}\${path}\`);
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
      throw new SovaHttpError(response.status, body, \`HTTP \${response.status}: \${response.url}\`);
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
`;
}

function renderPollerFile(): string {
  return `import type { JobStatus } from "./types.js";
import { HttpClient, SovaHttpError } from "./http.js";

export class JobPollerError extends Error {
  constructor(
    public readonly jobId: string,
    message: string,
  ) {
    super(message);
    this.name = "JobPollerError";
  }
}

export async function pollAndFetch<T>(
  http: HttpClient,
  jobId: string,
  resultKey: string,
  options: { intervalMs: number; maxAttempts: number },
): Promise<T> {
  const { intervalMs, maxAttempts } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await http.request<JobStatus>({
      path: \`/jobs/\${jobId}\`,
    });

    if (status.status === "completed") {
      return http.request<T>({
        path: "/jobs/result/by-key",
        query: { key: resultKey },
      });
    }

    if (status.status === "failed") {
      throw new JobPollerError(jobId, \`Job \${jobId} failed\`);
    }

    await sleep(intervalMs);
  }

  throw new JobPollerError(jobId, \`Job \${jobId} timed out\`);
}

export async function pollResultKey<T>(
  http: HttpClient,
  resultKey: string,
  options: { intervalMs: number; maxAttempts: number },
): Promise<T> {
  const { intervalMs, maxAttempts } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await http.request<T>({
        path: "/jobs/result/by-key",
        query: { key: resultKey },
      });
    } catch (error) {
      if (error instanceof SovaHttpError && error.status === 404) {
        await sleep(intervalMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error(\`Result key "\${resultKey}" did not appear within \${maxAttempts} attempts\`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;
}

function renderClientFile(endpoints: Endpoint[], schemas: Record<string, OpenApiSchema>): string {
  const imports = collectClientImports(endpoints);
  const methods = endpoints
    .map((endpoint) => renderMethod(endpoint, schemas))
    .join('\n\n');

  return `import { HttpClient } from "./http.js";
import type {
  SovaIntelGeneratedClientConfig,
${imports.map((name) => `  ${name},`).join('\n')}
} from "./index.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;

export class SovaIntelGeneratedClient {
  private readonly http: HttpClient;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(config: SovaIntelGeneratedClientConfig) {
    this.http = new HttpClient(config.baseUrl, config.auth);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = config.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

${indent(methods, 2)}
}
`;
}

function renderMethod(endpoint: Endpoint, schemas: Record<string, OpenApiSchema>): string {
  const methodName = METHOD_NAME_OVERRIDES[endpoint.operationId] ?? fallbackMethodName(endpoint.operationId);
  const args: string[] = [];

  for (const param of endpoint.pathParams) {
    args.push(`${param.name}: ${parameterType(param)}`);
  }
  if (endpoint.queryParams.length > 0) {
    const queryTypeName = findQueryTypeName(endpoint);
    args.push(`query${endpoint.queryParams.some((param) => !param.required) ? '?' : ''}: ${queryTypeName ?? 'Record<string, string | number | boolean | undefined>'}`);
  }
  if (endpoint.bodyType) {
    args.push(`body${isBodyOptional(endpoint.bodyType, schemas) ? '?' : ''}: ${endpoint.bodyType}`);
  }

  const queryArg = endpoint.queryParams.length > 0 ? 'query' : 'undefined';
  const bodyArg = endpoint.bodyType ? 'body' : 'undefined';
  const path = endpoint.path.replace(/\{([^}]+)\}/g, '${$1}');

  return `async ${methodName}(${args.join(', ')}): Promise<${endpoint.responseType}> {
    return this.http.request<${endpoint.responseType}>({
      method: "${endpoint.method}",
      path: \`${path}\`,
      query: ${queryArg},
      body: ${bodyArg},
    });
  }`;
}

function renderIndexFile(): string {
  return `export { SovaIntelGeneratedClient } from "./client.js";
export { HttpClient, SovaHttpError, X402PaymentError } from "./http.js";
export { JobPollerError, pollAndFetch, pollResultKey } from "./poller.js";
export type {
  Auth,
  ApiKeyAuth,
  X402Auth,
  X402Accept,
  X402ErrorBody,
  JobStatus,
  SovaIntelGeneratedClientConfig,
} from "./types.js";
export type * from "./contracts.js";
`;
}

function buildReadme(endpoints: Endpoint[]): string {
  const methodList = endpoints
    .map((endpoint) => `- \`${METHOD_NAME_OVERRIDES[endpoint.operationId] ?? fallbackMethodName(endpoint.operationId)}()\` -> \`${endpoint.method} ${endpoint.path}\``)
    .join('\n');

  return `# @sova-intel/sdk-generated

One-off generated SDK package derived from \`artifacts/intel-openapi.json\`.

Purpose:
- compare a fully artifact-driven client package against the curated analyzer SDK
- evaluate whether SDK ownership can move into the public docs repo cleanly

Generated methods:
${methodList}
`;
}

function copyStaticFile(
  relativePath: string,
  outputRoot: string,
  transform?: (content: string) => string,
): void {
  const source = readFileSync(resolve(SDK_PACKAGE_ROOT, relativePath), 'utf8');
  const next = transform ? transform(source) : source;
  writeFile(resolve(outputRoot, relativePath), next);
}

function updatePackageJson(content: string): string {
  const json = JSON.parse(content) as {
    name: string;
    description: string;
    repository?: { url?: string };
    homepage?: string;
  };
  json.name = '@sova-intel/sdk-generated';
  json.description = 'Generated evaluation SDK for the Sova Intel API, derived from the Intel OpenAPI artifact.';
  return `${JSON.stringify(json, null, 2)}\n`;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function requireSchema(schemas: Record<string, OpenApiSchema>, name: string): OpenApiSchema {
  const schema = schemas[name];
  if (!schema) {
    throw new Error(`Schema ${name} not found in Intel OpenAPI artifact`);
  }
  return schema;
}

function resolveSchema(schemas: Record<string, OpenApiSchema>, schema: OpenApiSchema): OpenApiSchema {
  if (schema.$ref) {
    return resolveSchema(schemas, requireSchema(schemas, refName(schema.$ref)));
  }

  if (schema.allOf?.length) {
    return schema.allOf.reduce<OpenApiSchema>((acc, part) => {
      const resolvedPart = resolveSchema(schemas, part);
      return {
        type: acc.type ?? resolvedPart.type ?? 'object',
        nullable: acc.nullable ?? resolvedPart.nullable,
        properties: {
          ...(acc.properties ?? {}),
          ...(resolvedPart.properties ?? {}),
        },
        required: [...new Set([...(acc.required ?? []), ...(resolvedPart.required ?? [])])],
      };
    }, { type: 'object', properties: {}, required: [] });
  }

  return schema;
}

function renderObjectType(
  schemas: Record<string, OpenApiSchema>,
  schema: OpenApiSchema,
  indentLevel: number,
): string {
  const resolved = resolveSchema(schemas, schema);
  const properties = resolved.properties ?? {};
  const required = new Set(resolved.required ?? []);
  const indentText = '  '.repeat(indentLevel);
  const innerIndent = '  '.repeat(indentLevel + 1);

  const lines = Object.entries(properties).map(([name, value]) => {
    const optional = required.has(name) ? '' : '?';
    return `${innerIndent}${renderPropertyName(name)}${optional}: ${renderType(schemas, value, indentLevel + 1)};`;
  });

  if (lines.length === 0) {
    return '{}';
  }

  return `{\n${lines.join('\n')}\n${indentText}}`;
}

function renderType(
  schemas: Record<string, OpenApiSchema>,
  schema: OpenApiSchema,
  indentLevel: number,
): string {
  if (schema.$ref || schema.allOf) {
    return renderType(schemas, resolveSchema(schemas, schema), indentLevel);
  }
  if (schema.enum?.length) {
    return applyNullability(schema.enum.map((value) => JSON.stringify(value)).join(' | '), schema.nullable);
  }
  if (schema.type === 'array') {
    const itemType = schema.items ? renderType(schemas, schema.items, indentLevel) : 'unknown';
    return applyNullability(`${itemType}[]`, schema.nullable);
  }
  if (schema.type === 'object') {
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      return applyNullability(renderObjectType(schemas, schema, indentLevel), schema.nullable);
    }
    if (schema.additionalProperties && schema.additionalProperties !== true) {
      const valueType = renderType(schemas, schema.additionalProperties, indentLevel);
      return applyNullability(`Record<string, ${valueType}>`, schema.nullable);
    }
    return applyNullability('Record<string, unknown>', schema.nullable);
  }
  if (schema.type === 'integer' || schema.type === 'number') return applyNullability('number', schema.nullable);
  if (schema.type === 'boolean') return applyNullability('boolean', schema.nullable);
  if (schema.type === 'string') return applyNullability('string', schema.nullable);
  return applyNullability('unknown', schema.nullable);
}

function applyNullability(baseType: string, nullable?: boolean): string {
  return nullable ? `${baseType} | null` : baseType;
}

function refName(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}

function renderPropertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function fallbackMethodName(operationId: string): string {
  const last = operationId.split('_').pop() ?? operationId;
  return last.charAt(0).toLowerCase() + last.slice(1);
}

function parameterType(parameter: OpenApiParameter): string {
  const type = parameter.schema?.type;
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string';
}

function isBodyOptional(typeName: string, schemas: Record<string, OpenApiSchema>): boolean {
  const schema = schemas[typeName];
  return !!schema && (schema.required?.length ?? 0) === 0;
}

function findQueryTypeName(endpoint: Endpoint): string | null {
  return null;
}

function collectClientImports(endpoints: Endpoint[]): string[] {
  const names = new Set<string>(['SovaIntelGeneratedClientConfig']);
  for (const endpoint of endpoints) {
    if (!BUILTIN_IMPORT_TYPES.has(endpoint.responseType)) {
      names.add(endpoint.responseType);
    }
    if (endpoint.bodyType && !BUILTIN_IMPORT_TYPES.has(endpoint.bodyType)) {
      names.add(endpoint.bodyType);
    }
  }
  names.delete('SovaIntelGeneratedClientConfig');
  return [...names].sort();
}

function indent(content: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return content
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

main();
