# PFT Oracle Bot - Message Deduplication Issue

## Context
We have a working PFT Oracle Bot ("Sova Intel") registered on the Post Fiat testnet that:
- ✅ Receives PFT payments with commands
- ✅ Processes commands via analyzer API
- ✅ Posts formatted replies on-chain
- ❌ **REPROCESSES the same 4 messages on every restart**

## The Problem
The bot keeps seeing and processing the same 4 messages despite:
1. Cursor being saved and loaded correctly (458239)
2. Processed tx hashes being persisted to file (4 hashes saved)
3. Hash deduplication check in place

**Symptoms:**
```
[SCAN] Loaded cursor: 458239
[SCAN] Restored 4 processed hashes
[SCAN] Received 4 messages  ← THESE ARE OLD MESSAGES WE ALREADY PROCESSED!
[SCAN] Processing /profile from rGGodJFqgreLgXKVGspkZ68dqBH8RBGCJr (5 PFT)
```

## Current Implementation

**File:** `pft-bot_v2/src/scanner.ts`

```typescript
private async tick(): Promise<void> {
  const scan = await this.pft.scanMessages({
    since_ledger: this.cursor,  // ← Cursor is 458239
    direction: 'inbound',
  });

  if (scan.count === 0) return;

  for (const msg of scan.messages) {
    if (this.processedHashes.has(msg.tx_hash)) continue;  // ← Should skip!
    // ... process message
    this.processedHashes.add(msg.tx_hash);
  }

  this.cursor = scan.next_cursor;  // ← Save next_cursor for next scan
  this.saveCursor(this.cursor);
}
```

**Cursor persistence:**
```typescript
private saveCursor(cursor: number): void {
  fs.writeFileSync(config.CURSOR_FILE, JSON.stringify({
    cursor,
    processedHashes: Array.from(this.processedHashes).slice(-100),
    updatedAt: Date.now()
  }));
}
```

**Cursor file content:**
```json
{
  "cursor": 458239,
  "processedHashes": [
    "9A55C33737CBD50B6D280E503AB907DE7FCA15C4B0020506525124CC48F4EE6C",
    "BD8CF52E34B18453C4B6CBE4FF3EE358127675E372574B207271E99A79A83EBF",
    "F4D199301871EF761FDDC6C81707734636F8421CAA717AAF62F7FFF1D6173EB8",
    "9141880ECB25D3E68C311F8CDB4496B72C7F6371B4F771C0E4B0C2E32CBBE1DA"
  ]
}
```

## MCP Tool Documentation

**From:** https://github.com/postfiatorg/pft-chatbot-mcp/blob/master/README.md

### scan_messages

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `since_ledger` | `number` | No | - | Only return messages from this ledger index **onwards** (use `next_cursor` from previous scan) |
| `limit` | `number` | No | `100` | Max transactions to scan (1-200) |
| `direction` | `string` | No | `"inbound"` | Filter: `"inbound"`, `"outbound"`, or `"both"` |

**Returns:**
- `messages` -- array of message objects with `tx_hash`, `sender`, `recipient`, `direction`, `amount_drops`, `ledger_index`, etc.
- `count` -- number of messages found
- `next_cursor` -- **ledger index to pass as `since_ledger` on the next call (for deduplication)**

## Questions to Answer

1. **Is `since_ledger` inclusive or exclusive?**
   - When we call `scan_messages({ since_ledger: 458239 })`, does it return messages FROM ledger 458239 (inclusive) or AFTER 458239 (exclusive)?
   - If inclusive, should we save `next_cursor + 1` instead?

2. **What exactly is `next_cursor`?**
   - Is it the highest ledger index scanned?
   - Is it the next ledger to scan from?
   - Should it be used as-is or incremented?

3. **Why is hash deduplication failing?**
   - We load processed hashes on startup
   - We check `if (this.processedHashes.has(msg.tx_hash)) continue;`
   - Yet logs show messages being processed
   - Is the hash check being skipped somehow?

4. **Is there a better pattern?**
   - Should we use a different deduplication strategy?
   - Should we store more metadata (ledger_index, timestamp)?
   - Is there an MCP best practice we're missing?

## To Debug

Please:
1. Read the MCP README carefully for `scan_messages` behavior
2. Check if `since_ledger` is inclusive/exclusive
3. Verify the hash deduplication logic is correct
4. Test with actual MCP to understand cursor behavior
5. Provide a fix that ensures messages are processed exactly once

## Bot Details

- **Wallet:** rEMrwTNtpjgoPgRZ1nTLS6oak5RpU4oQaL
- **Network:** PFTL testnet
- **MCP Version:** @postfiatorg/pft-chatbot-mcp v0.3.0
- **Working directory:** `pft-bot_v2/`
- **Analyzer API:** http://localhost:3001/api/v1

## Expected Behavior

1. Bot starts, loads cursor (458239) and 4 processed hashes
2. Calls `scan_messages({ since_ledger: 458239 })`
3. Should get 0 messages (or only NEW messages)
4. New message arrives → process once → save hash + cursor
5. Restart → should NOT see that message again

## Actual Behavior

1. Bot starts, loads cursor (458239) and 4 processed hashes
2. Calls `scan_messages({ since_ledger: 458239 })`
3. Gets the same 4 OLD messages again! ❌
4. Hash check somehow doesn't prevent processing ❌
5. Messages processed multiple times ❌
