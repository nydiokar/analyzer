import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Config } from './config.js';

// ============================================================================
// Types — derived from @postfiatorg/pft-chatbot-mcp Zod schemas (v0.3.0)
//
// All 13 MCP tools are wrapped below. Parameter names match the MCP server
// exactly so there's a 1:1 mapping with no translation layer to break.
// ============================================================================

// --- scan_messages ---
export interface ScanMessage {
  tx_hash: string;
  sender: string;
  recipient: string;
  direction: 'inbound' | 'outbound';
  amount_drops: string;
  amount_pft: string;
  cid: string;
  thread_id?: string;
  is_encrypted: boolean;
  ledger_index: number;
  timestamp_iso: string;
}

export interface ScanResult {
  messages: ScanMessage[];
  count: number;
  next_cursor: number;
}

// --- get_message ---
export interface DecryptedMessage {
  tx_hash: string;
  cid: string;
  sender: string;
  recipient: string;
  message: string;
  content_type: string;
  amount_drops: string;
  amount_pft?: string;
  thread_id?: string;
  timestamp: string;
}

// --- send_message ---
export interface Attachment {
  cid: string;
  content_type: string;
  filename?: string;
}

export interface SendResult {
  tx_hash: string;
}

// --- upload_content ---
export interface UploadResult {
  cid: string;
  uri: string;
  size?: number;
}

// --- register_bot ---
export interface BotCommand {
  command: string;
  description: string;
  example: string;
  min_cost_drops?: string;
}

export interface BotRegistration {
  name: string;
  description: string;
  capabilities: string[];
  url?: string;
  commands?: BotCommand[];
  icon_emoji?: string;
  icon_color_hex?: string;
  min_cost_first_message_drops?: string;
}

// --- search_bots ---
export interface BotInfo {
  agent_id: string;
  name: string;
  description: string;
  capabilities: string[];
  commands?: BotCommand[];
  icon_emoji?: string;
}

export interface SearchBotsResult {
  bots: BotInfo[];
  count: number;
}

// --- check_balance ---
export interface BalanceInfo {
  address: string;
  pft_balance: string;
  xrp_balance: string;
  trust_lines?: unknown[];
}

// --- get_wallet_info ---
export interface WalletInfo {
  address: string;
  public_key: string;
  encryption_key?: string;
  trust_line_status?: string;
  rpc_endpoints?: string[];
}

// --- create_wallet ---
export interface CreatedWallet {
  address: string;
  seed: string;
  public_key: string;
}

// --- get_thread ---
export interface ThreadMessage {
  tx_hash: string;
  sender: string;
  recipient: string;
  message?: string;
  content_type?: string;
  amount_drops: string;
  thread_id?: string;
  timestamp: string;
}

export interface ThreadResult {
  messages: ThreadMessage[];
  count: number;
}

// ============================================================================
// PFTClient — typed wrapper around all 13 MCP tools
// ============================================================================

export class PFTClient {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(private cfg: Config) {
    this.transport = new StdioClientTransport({
      command: 'npx',
      args: ['@postfiatorg/pft-chatbot-mcp'],
      env: {
        ...process.env,
        BOT_SEED: cfg.BOT_SEED,
      },
    });
    this.client = new Client({ name: 'pft-oracle-bot', version: '1.0.0' }, {});
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    console.log('[PFT] MCP client connected');
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /** Low-level tool call — parses JSON text from MCP result content. */
  private async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    if (!content?.[0]?.text) {
      throw new Error(`Empty response from MCP tool: ${name}`);
    }
    return JSON.parse(content[0].text) as T;
  }

  // ---- 1. create_wallet ----

  async createWallet(algorithm?: 'ed25519' | 'secp256k1'): Promise<CreatedWallet> {
    const args: Record<string, unknown> = {};
    if (algorithm) args.algorithm = algorithm;
    return this.callTool<CreatedWallet>('create_wallet', args);
  }

  // ---- 2. scan_messages ----

  async scanMessages(opts?: {
    since_ledger?: number;
    limit?: number;
    direction?: 'inbound' | 'outbound' | 'both';
  }): Promise<ScanResult> {
    const args: Record<string, unknown> = {};
    if (opts?.since_ledger !== undefined) args.since_ledger = opts.since_ledger;
    if (opts?.limit !== undefined) args.limit = opts.limit;
    if (opts?.direction) args.direction = opts.direction;
    return this.callTool<ScanResult>('scan_messages', args);
  }

  // ---- 3. get_message ----

  async getMessage(opts: { tx_hash?: string; cid?: string }): Promise<DecryptedMessage> {
    return this.callTool<DecryptedMessage>('get_message', opts as Record<string, unknown>);
  }

  // ---- 4. send_message ----

  async sendMessage(params: {
    recipient: string;
    message: string;
    content_type?: string;
    amount_pft?: string;
    amount_drops?: string;
    attachments?: Attachment[];
    reply_to_tx?: string;
    thread_id?: string;
  }): Promise<SendResult> {
    return this.callTool<SendResult>('send_message', params as unknown as Record<string, unknown>);
  }

  // ---- 5. register_bot ----

  async registerBot(registration: BotRegistration): Promise<void> {
    await this.callTool('register_bot', registration as unknown as Record<string, unknown>);
    console.log(`[PFT] Bot registered: ${registration.name}`);
  }

  // ---- 6. search_bots ----

  async searchBots(opts?: {
    query?: string;
    capabilities?: string[];
    limit?: number;
  }): Promise<SearchBotsResult> {
    const args: Record<string, unknown> = {};
    if (opts?.query) args.query = opts.query;
    if (opts?.capabilities) args.capabilities = opts.capabilities;
    if (opts?.limit !== undefined) args.limit = opts.limit;
    return this.callTool<SearchBotsResult>('search_bots', args);
  }

  // ---- 7. get_bot ----

  async getBot(agentId: string): Promise<BotInfo> {
    return this.callTool<BotInfo>('get_bot', { agent_id: agentId });
  }

  // ---- 8. delete_bot ----

  async deleteBot(agentId: string): Promise<void> {
    await this.callTool('delete_bot', { agent_id: agentId });
    console.log(`[PFT] Bot deleted: ${agentId}`);
  }

  // ---- 9. upload_content ----

  async uploadContent(params: {
    content: string;
    content_type: string;
    encoding?: 'utf8' | 'base64';
  }): Promise<UploadResult> {
    return this.callTool<UploadResult>('upload_content', params as Record<string, unknown>);
  }

  // ---- 10. get_thread ----

  async getThread(opts: {
    thread_id?: string;
    contact_address?: string;
    limit?: number;
    decrypt?: boolean;
  }): Promise<ThreadResult> {
    return this.callTool<ThreadResult>('get_thread', opts as Record<string, unknown>);
  }

  // ---- 11. check_balance ----

  async checkBalance(): Promise<BalanceInfo> {
    return this.callTool<BalanceInfo>('check_balance');
  }

  // ---- 12. send_pft ----

  async sendPft(params: {
    recipient: string;
    amount_pft?: string;
    amount_drops?: string;
  }): Promise<SendResult> {
    return this.callTool<SendResult>('send_pft', params as Record<string, unknown>);
  }

  // ---- 13. get_wallet_info ----

  async getWalletInfo(): Promise<WalletInfo> {
    return this.callTool<WalletInfo>('get_wallet_info');
  }
}
