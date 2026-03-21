# Sova Playbook Manager -- Session Memory

## Playbook State
- **Start date:** 2026-03-19
- **Current day:** Day 3 (W1D3) -- first post published, behind on post volume
- **Branch:** feature/token-dash-v2

## Key Decisions
- Day 1 guide targets "Solana AI Agent" audience, NOT the Telegram bot guide the playbook specified. Founder must decide.
- Sub-agents cannot write files directly; main Claude Code session handles writes.

## VERIFIED SDK GROUND TRUTH (from @sova-intel/sdk@0.1.1 types.d.ts)
- Class: `SovaIntelClient` (NOT SovaIntel)
- Constructor: `new SovaIntelClient({ baseUrl, auth: { kind: "apikey", apiKey } })`
- Methods: `getWalletHud(addr)`, `getWalletProfile(addr)`, `getWalletTokens(addr, params?)`, `batchHud(wallets[])`, `pollHolderProfiles(mint, topN?)`, `queueHolderProfiles(mint, topN?)`, `pollSimilarity(wallets[])`, `queueSimilarity(wallets[])`
- HUD field: `behaviorCode`. Holders field: `behaviorType` (DIFFERENT).
- HUD has NO: speedCategory, totalPnlUsd, exitPattern. Uses: trimmedMeanPnl, medianHoldTimeHours.
- Holders: array is `profiles` not `holders`. No `distribution` summary object. Has `confidence`, `completedCycleCount`, `walletPnlSol`.
- Similarity: array is `pairwiseSimilarities` not `pairs`. `binarySharedTokenCount` not `sharedTokenCount`. NO `clusterCount`. Has `mostSimilarPairs` in globalMetrics.
- SDK types extracted to: /tmp/package/dist/cjs/types.d.ts
- Full reference: .claude/agent-progress/honest-state-assessment.md Appendix

## Critical Founder Blockers
- ~~No real API responses needed~~ — live docs + SDK types.d.ts are sufficient. technical-content-writer can fix guide response examples using verified SDK ground truth from this file. NOT a founder task.
- Wallet profile card format not designed. Still outstanding Day 1 task.
- SDK field name ground truth is confirmed (see VERIFIED SDK GROUND TRUTH below). skill.md was wrong; SDK is correct.

## File Locations
- Master playbook: documentation/sova-intel-playbook-complete.md
- Campaign doc: .claude/agent-progress/solana-agent-builder-campaign.md
- System manifest: .claude/agent-progress/system-manifest.md
- Day 1 review: .claude/agent-progress/manager-review-day1.md
- Honest assessment: .claude/agent-progress/honest-state-assessment.md
- SDK types (extracted): /tmp/package/dist/cjs/types.d.ts and client.d.ts

## Patterns
- ALWAYS provide SDK types.d.ts content when dispatching technical-content-writer or integration-engineer.
- Campaign doc Section 3 contains fabricated SDK patterns -- never use as code reference.
- Agent word/char counts are approximate -- verify independently.
- Social Drafts 1+2 verified postable. Draft 3 needs "454 agents" replaced.
- 5 of 10 outreach targets solid (sendaifun, elizaos, thearyanag, scriptscrypt, michaelessiet); 5 weak.
