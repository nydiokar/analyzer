import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

type HttpMethod = 'GET' | 'POST';

type Endpoint = {
  method: HttpMethod;
  path: string;
  handlerName: string;
};

type SdkMethod = {
  name: string;
  returnType: string;
  body: string;
};

type CoverageRule = {
  endpoint: string;
  sdkMethods: string[];
  directEndpointRequired?: boolean;
  notes?: string;
};

type ContractRule = {
  sdkMethod: string;
  returnType: string;
  requiredFields: string[];
  notes?: string;
};

type DocFile = {
  label: string;
  path: string;
  content: string;
};

type AuditReport = {
  generatedAt: string;
  sources: {
    intelController: string;
    walletHudDto: string;
    sdkClient: string;
    sdkTypes: string;
    generatedSdkContract?: string;
    sdkReadme: string;
    agentSkill: string;
    publicDocsRepo?: string;
    docusaurusDocsPresent: boolean;
  };
  intelEndpoints: Endpoint[];
  endpointCoverage: Array<{
    endpoint: string;
    sdkMethodsExpected: string[];
    sdkMethodsFound: string[];
    directPathPresentInSdk: boolean;
    status: 'ok' | 'partial' | 'missing';
    notes?: string;
  }>;
  contractCoverage: Array<{
    sdkMethod: string;
    returnType: string;
    missingFields: string[];
    status: 'ok' | 'missing_fields' | 'missing_method' | 'missing_type';
    notes?: string;
  }>;
  generatedContractParity: Array<{
    returnType: string;
    missingInSdk: string[];
    missingInGenerated: string[];
    status: 'ok' | 'sdk_missing_fields' | 'generated_missing_fields' | 'type_missing';
  }>;
  hudFieldCoverage: {
    dtoFields: string[];
    sdkFields: string[];
    missingInSdk: string[];
    missingInDocs: string[];
  };
  walletBehaviorCoverage: {
    apiFields: string[];
    sdkFields: string[];
    missingInSdk: string[];
    missingInDocs: string[];
  };
  docsCoverage: Array<{
    endpoint: string;
    filesPresentIn: string[];
    filesMissingFrom: string[];
  }>;
  findings: {
    missingSdkCoverage: string[];
    sdkContractDrift: string[];
    generatedContractDrift: string[];
    docsCoverageGaps: string[];
    docsSemanticNotes: string[];
    walletBehaviorDocsGaps: string[];
  };
};

const ROOT: string = process.cwd();

const INTEL_CONTROLLER_PATH = resolve(ROOT, 'src/api/controllers/intel.controller.ts');
const WALLET_HUD_DTO_PATH = resolve(ROOT, 'src/api/shared/dto/wallet-hud.dto.ts');
const SDK_CLIENT_PATH = resolve(ROOT, 'packages/sdk/src/client.ts');
const SDK_TYPES_PATH = resolve(ROOT, 'packages/sdk/src/types.ts');
const GENERATED_SDK_CONTRACT_PATH = resolve(ROOT, 'packages/sdk/src/generated-intel-contract.ts');
const SDK_README_PATH = resolve(ROOT, 'packages/sdk/README.md');
const AGENT_SKILL_PATH = resolve(ROOT, 'documentation/agent-skill/SKILL.md');
const DOCUSAURUS_ROOT = resolve(ROOT, 'submodules/sova-intel');
const PUBLIC_DOCS_ROOT = process.env.INTEL_PUBLIC_DOCS_ROOT
  ? resolve(process.env.INTEL_PUBLIC_DOCS_ROOT)
  : resolve(ROOT, '..', 'sova-intel');
const STRICT_MODE = process.argv.includes('--strict');
const JSON_ONLY = process.argv.includes('--json');

const WALLET_BEHAVIOR_FIELDS = [
  'tradingStyle',
  'speedCategory',
  'avgHoldTimeHours',
  'medianHoldTimeHours',
  'buySellRatio',
  'exitPattern',
  'avgEntryMcapUsd',
  'typicalEntryMcapUsd',
  'entryMcapP25Usd',
  'entryMcapP75Usd',
  'dominantEntryMcapBucket',
  'dominantEntryMcapBucketShare',
];

const COVERAGE_RULES: CoverageRule[] = [
  { endpoint: 'GET /intel/wallet/:addr', sdkMethods: ['getWalletProfile'] },
  { endpoint: 'GET /intel/wallet/:addr/similar', sdkMethods: ['getSimilarWallets'] },
  { endpoint: 'GET /intel/wallet/:addr/cluster', sdkMethods: ['getWalletCluster'] },
  { endpoint: 'GET /intel/wallet/:addr/hud', sdkMethods: ['getWalletHud'] },
  { endpoint: 'GET /intel/wallet/:addr/tokens', sdkMethods: ['getWalletTokens'] },
  { endpoint: 'POST /intel/wallets/batch-hud', sdkMethods: ['batchHud'] },
  { endpoint: 'POST /intel/token/:mint/holders', sdkMethods: ['queueHolderProfiles', 'pollHolderProfiles'] },
  { endpoint: 'POST /intel/wallets/similarity', sdkMethods: ['queueSimilarity', 'pollSimilarity'] },
  { endpoint: 'POST /intel/token/:mint/holders/agent', sdkMethods: ['queueTokenHoldersAgent', 'pollTokenHoldersAgent'] },
  {
    endpoint: 'GET /intel/jobs/result/agent/holder-profiles/:jobId',
    sdkMethods: ['pollTokenHoldersAgent'],
    directEndpointRequired: false,
    notes: 'SDK currently fetches agent results via resultKey and /jobs/result/by-key instead of this hydration endpoint.',
  },
  { endpoint: 'POST /intel/wallets/similarity/agent', sdkMethods: ['queueWalletSimilarityAgent', 'pollWalletSimilarityAgent'] },
  {
    endpoint: 'GET /intel/jobs/result/agent/similarity/:requestId',
    sdkMethods: ['pollWalletSimilarityAgent'],
    directEndpointRequired: false,
    notes: 'SDK currently fetches agent results via resultKey and /jobs/result/by-key instead of this hydration endpoint.',
  },
  { endpoint: 'POST /intel/token/:mint/holders/deep', sdkMethods: ['queueDeepAnalysis', 'pollDeepAnalysis'] },
];

const CONTRACT_RULES: ContractRule[] = [
  {
    sdkMethod: 'queueHolderProfiles',
    returnType: 'HolderProfilesJobAcceptedResponse',
    requiredFields: ['status', 'tokenMint', 'topN', 'jobId', 'requestId', 'monitoringUrl', 'resultKey', 'message'],
  },
  {
    sdkMethod: 'queueSimilarity',
    returnType: 'SimilarityJobAcceptedResponse',
    requiredFields: ['status', 'jobId', 'requestId', 'walletCount', 'monitoringUrl', 'resultKey', 'message'],
  },
  {
    sdkMethod: 'queueDeepAnalysis',
    returnType: 'DeepJobAcceptedResponse',
    requiredFields: ['status', 'tokenMint', 'topN', 'holderProfiles', 'similarity', 'message'],
  },
  {
    sdkMethod: 'queueTokenHoldersAgent',
    returnType: 'HolderProfilesAgentJobAcceptedResponse',
    requiredFields: ['status', 'tokenMint', 'topN', 'jobId', 'requestId', 'monitoringUrl', 'resultKey', 'agentResultKey', 'message'],
  },
  {
    sdkMethod: 'queueWalletSimilarityAgent',
    returnType: 'SimilarityAgentJobAcceptedResponse',
    requiredFields: ['status', 'jobId', 'requestId', 'walletCount', 'monitoringUrl', 'resultKey', 'agentResultKey', 'message'],
  },
  {
    sdkMethod: 'batchHud',
    returnType: 'BatchHudResponse',
    requiredFields: ['huds', 'queued', 'skipped', 'calculatedAt'],
  },
];

function main(): void {
  const intelController = read(INTEL_CONTROLLER_PATH);
  const walletHudDto = read(WALLET_HUD_DTO_PATH);
  const sdkClient = read(SDK_CLIENT_PATH);
  const sdkTypes = read(SDK_TYPES_PATH);
  const generatedSdkContract = existsSync(GENERATED_SDK_CONTRACT_PATH) ? read(GENERATED_SDK_CONTRACT_PATH) : null;
  const sdkReadme = read(SDK_README_PATH);
  const agentSkill = read(AGENT_SKILL_PATH);

  const docsFiles: DocFile[] = [
    { label: 'packages/sdk/README.md', path: SDK_README_PATH, content: sdkReadme },
    { label: 'documentation/agent-skill/SKILL.md', path: AGENT_SKILL_PATH, content: agentSkill },
    ...loadPublicDocs(),
  ];

  const intelEndpoints = extractIntelEndpoints(intelController);
  const sdkMethods = extractSdkMethods(sdkClient);
  const sdkTypeFields = extractTypeFields(sdkTypes);
  const generatedTypeFields = generatedSdkContract ? extractTypeFields(generatedSdkContract) : new Map<string, Set<string>>();
  const walletHudFields = extractDtoFields(walletHudDto, 'WalletHudDto');
  const sdkHudFields = [...(sdkTypeFields.get('WalletHud') ?? new Set<string>())].sort();
  const sdkWalletBehaviorFields = [...(sdkTypeFields.get('WalletBehavior') ?? new Set<string>())].sort();

  const endpointCoverage = COVERAGE_RULES.map((rule) => {
    const foundMethods = rule.sdkMethods.filter((name) => sdkMethods.some((method) => method.name === name));
    const endpointPattern = endpointToPattern(rule.endpoint);
    const directPathPresent = endpointPattern.test(sdkClient);
    const directSatisfied = rule.directEndpointRequired === false ? true : directPathPresent;
    const status: 'ok' | 'partial' | 'missing' =
      foundMethods.length === rule.sdkMethods.length && directSatisfied
        ? 'ok'
        : foundMethods.length > 0 || directSatisfied
          ? 'partial'
          : 'missing';

    return {
      endpoint: rule.endpoint,
      sdkMethodsExpected: rule.sdkMethods,
      sdkMethodsFound: foundMethods,
      directPathPresentInSdk: directPathPresent,
      status,
      notes: rule.notes,
    };
  });

  const contractCoverage = CONTRACT_RULES.map((rule) => {
    const sdkMethod = sdkMethods.find((method) => method.name === rule.sdkMethod);
    if (!sdkMethod) {
      return {
        sdkMethod: rule.sdkMethod,
        returnType: rule.returnType,
        missingFields: rule.requiredFields,
        status: 'missing_method' as const,
        notes: rule.notes,
      };
    }

    const fields = sdkTypeFields.get(rule.returnType);
    if (!fields) {
      return {
        sdkMethod: rule.sdkMethod,
        returnType: rule.returnType,
        missingFields: rule.requiredFields,
        status: 'missing_type' as const,
        notes: rule.notes,
      };
    }

    const missingFields = rule.requiredFields.filter((field) => !fields.has(field));
    return {
      sdkMethod: rule.sdkMethod,
      returnType: rule.returnType,
      missingFields,
      status: missingFields.length === 0 ? 'ok' as const : 'missing_fields' as const,
      notes: rule.notes,
    };
  });

  const generatedContractParity = CONTRACT_RULES
    .filter((rule) =>
      rule.returnType === 'HolderProfilesJobAcceptedResponse' ||
      rule.returnType === 'SimilarityJobAcceptedResponse',
    )
    .map((rule) => {
      const sdkFields = sdkTypeFields.get(rule.returnType);
      const generatedFields = generatedTypeFields.get(rule.returnType);

      if (!sdkFields || !generatedFields) {
        return {
          returnType: rule.returnType,
          missingInSdk: generatedFields ? [...generatedFields].sort() : [],
          missingInGenerated: sdkFields ? [...sdkFields].sort() : [],
          status: 'type_missing' as const,
        };
      }

      const missingInSdk = [...generatedFields].filter((field) => !sdkFields.has(field)).sort();
      const missingInGenerated = [...sdkFields].filter((field) => !generatedFields.has(field)).sort();
      return {
        returnType: rule.returnType,
        missingInSdk,
        missingInGenerated,
        status:
          missingInSdk.length === 0 && missingInGenerated.length === 0
            ? 'ok' as const
            : missingInSdk.length > 0
              ? 'sdk_missing_fields' as const
              : 'generated_missing_fields' as const,
      };
    });

  const hudDocChecks = [
    'signalType',
    'currentHoldingsUsd',
    'typicalEntryMcapUsd',
    'dominantEntryMcapBucket',
    'provenance',
  ];
  const missingHudInDocs = hudDocChecks.filter((field) => {
    return !docsFiles.some((file) => file.content.includes(field));
  });

  const missingWalletBehaviorInDocs = WALLET_BEHAVIOR_FIELDS.filter((field) => {
    return !docsFiles.some((file) => file.content.includes(field));
  });

  const docsCoverage = intelEndpoints.map((endpoint) => {
    const full = `${endpoint.method} /intel/${endpoint.path}`;
    const matches = docsFiles
      .filter((file) => file.content.includes(full) || file.content.includes(`/intel/${endpoint.path}`))
      .map((file) => file.label);
    return {
      endpoint: full,
      filesPresentIn: matches,
      filesMissingFrom: docsFiles.filter((file) => !matches.includes(file.label)).map((file) => file.label),
    };
  });

  const findings = {
    missingSdkCoverage: endpointCoverage
      .filter((entry) => entry.status !== 'ok')
      .map((entry) => `${entry.endpoint}: methods=${entry.sdkMethodsFound.join(', ') || 'none'} directPath=${entry.directPathPresentInSdk}`),
    sdkContractDrift: contractCoverage
      .filter((entry) => entry.status !== 'ok')
      .map((entry) => `${entry.sdkMethod} -> ${entry.returnType}: missing ${entry.missingFields.join(', ')}`),
    generatedContractDrift: generatedContractParity
      .filter((entry) => entry.status !== 'ok')
      .map((entry) => `${entry.returnType}: sdkMissing=${entry.missingInSdk.join(', ') || 'none'} generatedMissing=${entry.missingInGenerated.join(', ') || 'none'}`),
    docsCoverageGaps: docsCoverage
      .filter((entry) => entry.filesMissingFrom.length > 0)
      .map((entry) => `${entry.endpoint}: missing from ${entry.filesMissingFrom.join(', ')}`),
    docsSemanticNotes: buildSemanticNotes(sdkReadme, agentSkill),
    walletBehaviorDocsGaps: missingWalletBehaviorInDocs,
  };

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    sources: {
      intelController: rel(INTEL_CONTROLLER_PATH),
      walletHudDto: rel(WALLET_HUD_DTO_PATH),
      sdkClient: rel(SDK_CLIENT_PATH),
      sdkTypes: rel(SDK_TYPES_PATH),
      generatedSdkContract: generatedSdkContract ? rel(GENERATED_SDK_CONTRACT_PATH) : undefined,
      sdkReadme: rel(SDK_README_PATH),
      agentSkill: rel(AGENT_SKILL_PATH),
      publicDocsRepo: hasVisibleFiles(PUBLIC_DOCS_ROOT) ? PUBLIC_DOCS_ROOT.replace(/\\/g, '/') : undefined,
      docusaurusDocsPresent: hasVisibleFiles(DOCUSAURUS_ROOT),
    },
    intelEndpoints,
    endpointCoverage,
    contractCoverage,
    generatedContractParity,
    hudFieldCoverage: {
      dtoFields: walletHudFields,
      sdkFields: sdkHudFields,
      missingInSdk: walletHudFields.filter((field) => !sdkHudFields.includes(field)),
      missingInDocs: missingHudInDocs,
    },
    walletBehaviorCoverage: {
      apiFields: WALLET_BEHAVIOR_FIELDS,
      sdkFields: sdkWalletBehaviorFields,
      missingInSdk: WALLET_BEHAVIOR_FIELDS.filter((field) => !sdkWalletBehaviorFields.includes(field)),
      missingInDocs: missingWalletBehaviorInDocs,
    },
    docsCoverage,
    findings,
  };

  if (!JSON_ONLY) {
    printSummary(report);
  }
  console.log(JSON.stringify(report, null, 2));

  if (STRICT_MODE && hasBlockingDrift(report)) {
    process.exitCode = 1;
  }
}

function buildSemanticNotes(sdkReadme: string, agentSkill: string): string[] {
  const notes: string[] = [];

  if (sdkReadme.includes('console.log(hud.behaviorCode);') && sdkReadme.includes('"SWING_TRADER"')) {
    notes.push('packages/sdk/README.md shows behaviorCode example "SWING_TRADER", but WalletHudDto documents behaviorCode as the compact single-letter code.');
  }

  if (agentSkill.includes('`behaviorCode` values:') && agentSkill.includes('`SNIPER`')) {
    notes.push('documentation/agent-skill/SKILL.md documents behaviorCode values as full labels, but WalletHudDto documents behaviorCode as the compact single-letter code.');
  }

  if (!sdkReadme.includes('queueDeepAnalysis') || !sdkReadme.includes('queueTokenHoldersAgent') || !sdkReadme.includes('queueWalletSimilarityAgent')) {
    notes.push('packages/sdk/README.md method docs do not mention the deep-analysis and agent queue/poll helpers that exist in the SDK client.');
  }

  return notes;
}

function extractIntelEndpoints(source: string): Endpoint[] {
  const lines = source.split(/\r?\n/);
  const cleanedLines = stripBlockComments(lines);
  const endpoints: Endpoint[] = [];

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i]?.trim();
    const methodMatch = line.match(/^@(Get|Post)\('([^']+)'\)/);
    if (!methodMatch) continue;

    const method = methodMatch[1].toUpperCase() as HttpMethod;
    const path = methodMatch[2];

    let handlerName = 'unknown';
    for (let j = i + 1; j < Math.min(cleanedLines.length, i + 25); j++) {
      const handlerMatch = cleanedLines[j]?.match(/^\s*async\s+([A-Za-z0-9_]+)\s*\(/);
      if (handlerMatch) {
        handlerName = handlerMatch[1];
        break;
      }
    }

    endpoints.push({ method, path, handlerName });
  }

  return endpoints;
}

function extractSdkMethods(source: string): SdkMethod[] {
  const methods: SdkMethod[] = [];
  const regex = /async\s+([A-Za-z0-9_]+)\s*(?:<[^>]+>)?\s*\(([\s\S]*?)\)\s*:\s*Promise<([^>]+(?:>[^)]*)?)>\s*\{([\s\S]*?)^\s*\}/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    methods.push({
      name: match[1],
      returnType: match[3].trim(),
      body: match[4],
    });
  }
  return methods;
}

function extractTypeFields(source: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const regex = /export interface\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields = new Set<string>();
    for (const line of body.split(/\r?\n/)) {
      const propMatch = line.match(/^  ([A-Za-z0-9_]+)\??:/);
      if (propMatch) {
        fields.add(propMatch[1]);
      }
    }
    map.set(name, fields);
  }
  return map;
}

function extractDtoFields(source: string, className: string): string[] {
  const match = source.match(new RegExp(`export class\\s+${className}\\s*\\{([\\s\\S]*?)^\\}`, 'm'));
  if (!match) return [];

  const fields = new Set<string>();
  for (const line of match[1].split(/\r?\n/)) {
    const propMatch = line.match(/^  ([A-Za-z0-9_]+)\??:\s/);
    if (propMatch) {
      fields.add(propMatch[1]);
    }
  }

  return [...fields].sort();
}

function stripBlockComments(lines: string[]): string[] {
  const result: string[] = [];
  let inBlockComment = false;
  for (const line of lines) {
    let current = line;
    if (inBlockComment) {
      const endIndex = current.indexOf('*/');
      if (endIndex >= 0) {
        current = current.slice(endIndex + 2);
        inBlockComment = false;
      } else {
        result.push('');
        continue;
      }
    }

    while (true) {
      const startIndex = current.indexOf('/*');
      if (startIndex < 0) break;
      const endIndex = current.indexOf('*/', startIndex + 2);
      if (endIndex >= 0) {
        current = `${current.slice(0, startIndex)}${current.slice(endIndex + 2)}`;
      } else {
        current = current.slice(0, startIndex);
        inBlockComment = true;
        break;
      }
    }

    result.push(current);
  }
  return result;
}

function endpointToPattern(endpoint: string): RegExp {
  const rawPath = endpoint.replace(/^(GET|POST)\s+/, '');
  const escaped = rawPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withTemplateWildcards = escaped.replace(/:([A-Za-z0-9_]+)/g, '\\$\\{[^}]+\\}');
  return new RegExp(withTemplateWildcards);
}

function hasVisibleFiles(target: string): boolean {
  if (!existsSync(target)) return false;
  try {
    return readdirSync(target, { withFileTypes: true }).some((entry) => {
      if (entry.name.startsWith('.')) return false;
      return true;
    });
  } catch {
    return false;
  }
}

function loadPublicDocs(): DocFile[] {
  if (!hasVisibleFiles(PUBLIC_DOCS_ROOT)) return [];

  const candidatePaths = [
    resolve(PUBLIC_DOCS_ROOT, 'README.md'),
    resolve(PUBLIC_DOCS_ROOT, 'docs/sdk.md'),
    resolve(PUBLIC_DOCS_ROOT, 'docs/introduction.md'),
    resolve(PUBLIC_DOCS_ROOT, 'docs/endpoints/wallet-intel.md'),
    resolve(PUBLIC_DOCS_ROOT, 'docs/endpoints/batch-token.md'),
    resolve(PUBLIC_DOCS_ROOT, 'docs/endpoints/async-jobs.md'),
  ];

  return candidatePaths
    .filter((path) => existsSync(path))
    .map((path) => ({
      label: path.replace(`${ROOT}\\`, '').replace(/\\/g, '/'),
      path,
      content: read(path),
    }));
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function rel(path: string): string {
  return path.replace(`${ROOT}\\`, '').replace(/\\/g, '/');
}

function hasBlockingDrift(report: AuditReport): boolean {
  return (
    report.findings.missingSdkCoverage.length > 0 ||
    report.findings.sdkContractDrift.length > 0 ||
    report.findings.generatedContractDrift.length > 0 ||
    report.hudFieldCoverage.missingInSdk.length > 0 ||
    report.hudFieldCoverage.missingInDocs.length > 0 ||
    report.walletBehaviorCoverage.missingInSdk.length > 0 ||
    report.walletBehaviorCoverage.missingInDocs.length > 0 ||
    report.findings.docsSemanticNotes.length > 0
  );
}

function printSummary(report: AuditReport): void {
  const summary = [
    `Intel endpoints: ${report.intelEndpoints.length}`,
    `SDK contract drift: ${report.findings.sdkContractDrift.length}`,
    `Generated parity drift: ${report.findings.generatedContractDrift.length}`,
    `HUD docs gaps: ${report.hudFieldCoverage.missingInDocs.length}`,
    `Wallet behavior docs gaps: ${report.walletBehaviorCoverage.missingInDocs.length}`,
    `Docs semantic notes: ${report.findings.docsSemanticNotes.length}`,
  ];
  console.error(summary.join(' | '));
}

main();
