# Social Content Generator — Persistent Memory

## Tokens/Wallets Already Featured
- $DOWNALDTWUMP (EiqNgtwFzHqTEa3UV57s2x4svjJF59URgBqnG3sCpump) — full 7-post forensics thread, 2026-03-21

## Founder Preferences (confirmed)
- No emojis except when explicitly serving a viral/playful moment (e.g., the Lowskii side-wallet callout used 👀 by founder request)
- Numbers must be exact from source data — never round or approximate unless the founder has provided an approximated figure
- Use short address format: first 8 chars + "..." (e.g. uEHssPuf...)
- "Notes for Founder Review" section at end of thread files is welcome — flag sourcing edge cases, publish risks, and split-tweet suggestions

## Data Source Workflow (on-chain forensic threads)
- Source files: `analyses/<token>-analysis.json` (raw wallet data) and `analyses/<token>-briefs.txt` (signal briefs)
- Cross-check key numbers from briefs against JSON before writing — entryRank in JSON is a decimal (0.087 = top 8.7% = "top 9%")
- If a cluster output file exists, check with founder before using — it may have classification errors
- Smart money wallets identified outside the briefs file should be flagged in the notes section

## Content Type: Weekly Forensics Thread
- Structure: Hook → Insider → LP/Structural → Smart Money → Social call-out → Cohort pattern → Takeaway/CTA
- LP harvester post is typically the most novel finding — lead with the biggest headline number (e.g., DicCKYqk 8 SOL → 165 SOL)
- "Rotating cohort" post (shared tokens across wallets) requires similarity analysis data — get exact wallet counts and percentages
- Social call-outs (known Twitter handles) should include a publish risk note — verify handle is still active before posting
