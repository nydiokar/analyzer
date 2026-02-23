# 🚀 How to Start the PFT Oracle Bot

## Prerequisites
1. Make sure the analyzer API is running at `http://localhost:3001`
2. Verify your `.env` file has correct values (BOT_SEED, ANALYZER_API_KEY)

## Start the Bot

### Option 1: Development Mode (Recommended for Testing)
```bash
cd pft-bot_v2
pnpm dev
```

This uses `tsx` to run TypeScript directly with hot-reload.

### Option 2: Production Mode
```bash
cd pft-bot_v2
pnpm build
pnpm start
```

This compiles to JavaScript first, then runs the compiled code.

## What to Expect

### On First Run (No cursor.json exists):
```
[SCAN] loadCursor: attempting to read C:\Users\solastic\prj\analyzer\pft-bot_v2\data\cursor.json
[SCAN]   → File does not exist, starting fresh
[JOBS] loadPending: attempting to read C:\Users\solastic\prj\analyzer\pft-bot_v2\data\pending-jobs.json
[JOBS]   → File does not exist, starting fresh
[BOOT] Starting Sova Intel bot...
[PFT] MCP client connected
[PFT] Bot registered: Sova Intel
[SCAN] Bot address: rEMrwTNtpjgoPgRZ1nTLS6oak5RpU4oQaL
[SCAN] Starting scan loop (interval: 5000ms, cursor: none)
[BOOT] Sova Intel bot running. Scanning for messages...
[JOBS] Starting poll loop (interval: 15000ms)
[SCAN] Tick: cursor=undefined, processedHashes=0
[SCAN] Scan result: count=X, next_cursor=XXXXXX
```

### When Messages Are Found:
```
[SCAN] Received 4 messages
[SCAN] Msg 9A55C337...: duplicate=false, direction=inbound, ledger=458200
[SCAN]   → Processing...
[SCAN] Processing /profile from rGGodJFqgreLgXKVGspkZ68dqBH8RBGCJr (5 PFT)
[SCAN]   → SUCCESS, hash added to set (total: 1)
...
[SCAN] Advancing cursor: undefined → 458239
[SCAN] saveCursor called: cursor=458239, file=C:\Users\solastic\prj\analyzer\pft-bot_v2\data\cursor.json
[SCAN]   → Creating directory: C:\Users\solastic\prj\analyzer\pft-bot_v2\data
[SCAN]   → Writing file: 4 hashes
[SCAN]   → ✅ File saved successfully!
[SCAN]   → ✅ File verified: XXX bytes
```

### On Subsequent Runs (cursor.json exists):
```
[SCAN] loadCursor: attempting to read C:\Users\solastic\prj\analyzer\pft-bot_v2\data\cursor.json
[SCAN]   → ✅ Loaded cursor: 458239
[SCAN]   → ✅ Restored 4 processed hashes
[SCAN]   → First hash: 9A55C33737CBD50B...
...
[SCAN] Tick: cursor=458239, processedHashes=4
[SCAN] Scan result: count=4, next_cursor=458239
[SCAN] Received 4 messages
[SCAN] Msg 9A55C337...: duplicate=true, direction=inbound, ledger=458200
[SCAN]   → SKIPPED (duplicate hash)
```

## Stop the Bot
Press `Ctrl+C` - the bot will shut down gracefully.

## Check if Files Were Created
```bash
ls pft-bot_v2/data/
```

You should see:
- `cursor.json` - Contains cursor position and processed tx hashes
- `pending-jobs.json` - Contains jobs waiting for analyzer results (if any)

## View cursor.json Contents
```bash
cat pft-bot_v2/data/cursor.json
```

Should show:
```json
{
  "cursor": 458239,
  "processedHashes": [
    "9A55C33737CBD50B6D280E503AB907DE7FCA15C4B0020506525124CC48F4EE6C",
    "BD8CF52E34B18453C4B6CBE4FF3EE358127675E372574B207271E99A79A83EBF",
    "F4D199301871EF761FDDC6C81707734636F8421CAA717AAF62F7FFF1D6173EB8",
    "9141880ECB25D3E68C311F8CDB4496B72C7F6371B4F771C0E4B0C2E32CBBE1DA"
  ],
  "updatedAt": 1740236400000
}
```

## Troubleshooting

### If files are NOT created:
The new verbose logging will show exactly where the failure occurs:
- `❌ ERROR: File not found after write!` - Permission issue
- `❌ EXCEPTION in saveCursor:` - Unexpected error (will show stack trace)

### If messages are reprocessed on restart:
Look for:
- `duplicate=true` but still processing → Hash mismatch issue
- `duplicate=false` when should be true → Hashes not being loaded correctly

The logging will reveal the exact problem!
