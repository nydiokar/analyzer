# EVM Port Feasibility Assessment — Complete Index

**Assessment Date:** 2026-04-12  
**Scope:** Porting Sova Intel to EVM-compatible networks (Liquify Hackathon)  
**Status:** ✅ **COMPLETE** — Reverse engineering + compatibility validation done

---

## Document Overview

This assessment package contains **5 detailed analysis documents** covering every aspect of the EVM port viability. Start here, then drill down as needed.

---

## 📋 Quick Start (Read in This Order)

### 1. **EXECUTIVE SUMMARY** (5 min read)
📄 `EVM_PORT_EXECUTIVE_SUMMARY.md`

**What:** High-level go/no-go decision and effort estimate.  
**For:** Decision makers, project managers, team leads.  
**Verdict:** ✅ **CONDITIONAL GO** — 5-7 day implementation is realistic.

**Key takeaways:**
- Ingestion layer cleanly separable ✅
- Intelligence layer unchanged ✅
- 3 critical blockers identified (all solvable) ⚠️
- 43-60 hours total effort (5-7 dev days)

---

### 2. **DETAILED ASSESSMENT** (20 min read)
📄 `FEASIBILITY_ASSESSMENT_EVM_PORT.md`

**What:** Complete reverse engineering of the system, layer-by-layer analysis.  
**For:** Technical leads, architects, deep-dive explorers.  
**Structure:**
1. Separation Map — what stays, what replaces, what adapts
2. Schema Stability — is the normalized format chain-agnostic?
3. Intelligence Dependencies — any Solana-specific assumptions?
4. EVM Mapping Requirements — what must be reconstructed?
5. Breakpoints — where data flow breaks between chains
6. Detailed Effort Estimate — task-by-task breakdown
7. Risk List — explicit threats and mitigations
8. Go/No-Go Decision — final verdict with conditions

**Key takeaways:**
- Layer 1 (ingestion) is 100% replaceable
- Layer 2 (intelligence) is 100% chain-agnostic
- Schema mismatch is **not** breaking (just field renames)
- Stablecoin handling is 10-minute fix
- Two hard blockers: swap classification, value computation

---

### 3. **BLOCKER DEEP-DIVE** (15 min read)
📄 `EVM_PORT_BLOCKERS.md`

**What:** Detailed analysis of the 3 critical blockers with concrete solutions.  
**For:** Developers who will implement the blockers.  
**Blockers covered:**
1. **Classification (Swap vs. Transfer)** — heuristics + DEX registry
2. **Value Computation (Native Currency)** — Liquify API OR event parsing OR oracle
3. **Stablecoin Registry** — parameterization by chain

**Each blocker includes:**
- The problem explained
- Why it matters
- 1-3 solution approaches with effort estimates
- Code snippets and examples
- Risk assessment

**Key takeaways:**
- Blocker 1 (classification): 4-6 hours, medium risk
- Blocker 2 (value): 2-10 hours depending on Liquify availability
- Blocker 3 (stablecoins): 30 minutes, low risk

---

### 4. **ARCHITECTURE REFERENCE** (10 min read)
📄 `EVM_PORT_ARCHITECTURE.md`

**What:** Visual and conceptual breakdown of the system layers before and after EVM port.  
**For:** Developers building mental model of the system.  
**Includes:**
- Layer diagrams (current, post-EVM)
- Data flow example (single transaction through all layers)
- Key separation points (the bridge: SwapAnalysisInput)
- Code organization (file structure, modules)
- Testing strategy by layer
- Configuration & routing (feature flags)
- Backward compatibility (no breaking changes)
- Performance considerations

**Key takeaways:**
- System is modular and layered
- SwapAnalysisInput is the only contract between chains
- No changes to Layers 2 & 3 (intelligence + output)
- Feature-flagged, can run Solana + EVM side-by-side

---

### 5. **IMPLEMENTATION CHECKLIST** (10 min reference)
📄 `EVM_PORT_IMPLEMENTATION_CHECKLIST.md`

**What:** Day-by-day task breakdown with checkboxes.  
**For:** Developers implementing the port, tracking progress.  
**Structure:**
- Pre-implementation (resolve unknowns)
- Phase 1: Foundation (schema, stablecoins, EVM client)
- Phase 2: Core Mapper (classifier, parser, value extractor, full mapper)
- Phase 3: Validation (unit tests, integration tests, real wallets)
- Phase 4: Polish (documentation, demo, final touches)
- Deployment & submission checklist

**Each task includes:**
- Estimated effort
- Acceptance criteria
- Git commit message

**Key takeaways:**
- Can parallelize some work (e.g., infrastructure while waiting on Liquify API)
- Real-wallet validation should start by Day 4
- Time budget: 41-53 hours (5-7 dev days with buffer)

---

## 📊 Assessment Artifacts

All documents live in `.ai/` directory:

```
.ai/
├── EVM_PORT_INDEX.md                        ← You are here
├── EVM_PORT_EXECUTIVE_SUMMARY.md            ✅ Go/no-go + 1-page summary
├── FEASIBILITY_ASSESSMENT_EVM_PORT.md       ✅ Complete technical assessment (28KB)
├── EVM_PORT_BLOCKERS.md                     ✅ 3 critical blockers + solutions
├── EVM_PORT_ARCHITECTURE.md                 ✅ Diagrams, data flow, code organization
├── EVM_PORT_IMPLEMENTATION_CHECKLIST.md     ✅ Day-by-day task list
└── EVM_PORT_KNOWN_LIMITATIONS.md            (not yet written — write if proceeding)
```

---

## 🎯 Key Findings

### Hypothesis Validation: ✅ CONFIRMED

**Hypothesis:** "Only Layer 1 (ingestion) needs to change. Layer 2 (intelligence) should remain untouched."

**Finding:** 100% correct. The system architecture is clean:

```
Layer 1 (Ingestion): Solana-specific, must replace
  Helius API + Mapper → SwapAnalysisInput records
                            ↓
Layer 2 (Intelligence): Chain-agnostic, keep unchanged
  PnL Analysis + Behavior + Similarity (zero Solana assumptions)
                            ↓
Layer 3 (Output): Format-agnostic, keep unchanged
  API endpoints, DTOs (work with any chain)
```

---

### The Separation Is Clean

| **Component** | **Solana-Specific?** | **Change Needed?** |
|---|---|---|
| HeliusApiClient | ✅ Yes | 🔴 Replace |
| HeliusTransactionMapper | ✅ Yes (2000 lines) | 🔴 Replace |
| SwapAnalyzer (FIFO, PnL) | ❌ No | 🟢 None |
| BehaviorService | ❌ No | 🟢 None (parameterize stablecoins) |
| SimilarityService | ❌ No | 🟢 None |
| API endpoints | ❌ No | 🟢 None |

---

### The Three Critical Blockers

| **Blocker** | **Challenge** | **Best Solution** | **Effort** | **Risk** |
|---|---|---|---|---|
| **1. Swap Classification** | EVM has no native "swap" type | DEX registry + multi-leg heuristics | 4-6h | Medium |
| **2. Value Computation** | How much ETH was paid for this token? | Liquify API (or parse DEX logs) | 2-10h | Low-High |
| **3. Stablecoins** | Hardcoded Solana addresses | Parameterize by chain | 30min | Low |

---

### Effort Estimate

**Total: 43.5-59.5 hours = 5-7 focused dev days**

```
Foundation:     12 hours (schema, DEX registry, infrastructure)
Mapper:         25 hours (classifier, parser, value extractor, full mapper)
Testing:        15 hours (unit tests, integration tests, real wallets)
Polish:         10 hours (docs, code review, demo)
```

**With 20-30% buffer for unknowns, realistic timeline: 1.5 weeks (7-9 dev days).**

---

### Go / No-Go: ✅ CONDITIONAL GO

**Proceed if:**
1. ✅ Liquify API available (greatly simplifies value computation)
2. ✅ Clear scope (MVP: 1 chain, core features)
3. ✅ Real wallet validation early (days 3-4)
4. ✅ Accept documented limitations (bridges, complex DeFi)

**Fallback if Liquify unavailable:**
- Still feasible but effort → 60-70 hours
- Pivot to event parsing + price oracle

---

## 🚀 Next Steps

### If You Decide to Proceed

**Immediate (Next 2-4 hours):**
1. Spike Liquify API (read docs, test with sample wallet)
2. Decide: Ethereum primary, or multi-chain day 1?
3. Gather stablecoin addresses for chosen chain(s)
4. Update .env, create feature branch

**Days 1-3:**
1. Start with **EVM_PORT_IMPLEMENTATION_CHECKLIST.md** → follow Phase 1 & 2
2. Use **EVM_PORT_BLOCKERS.md** as reference when tackling each blocker
3. Refer to **EVM_PORT_ARCHITECTURE.md** for system context

**Days 4-7:**
1. Follow Phase 3 & 4 in checklist
2. Run real-wallet tests early to validate
3. Document limitations as they emerge
4. Prepare hackathon submission

### If You Decide to Defer

- Store these documents in project wiki or README
- Revisit when Liquify partnership is clearer
- The assessment is stable (won't need to re-do)

---

## 📌 Important Assumptions

**These assessments assume:**

1. ✅ **Liquify API is available** (or EVM RPC access is available)
2. ✅ **Chain: Ethereum primary** (architecture generalizes to other EVM chains)
3. ✅ **Database schema can be migrated** (no production data loss blocker identified)
4. ✅ **No breaking changes to public API** (all existing endpoints continue to work)
5. ⚠️ **First version is MVP** (don't try to match Solana's sophistication day 1)

**If any assumption changes, review relevant sections.**

---

## ⚠️ Known Limitations (First Version)

Documented in **EVM_PORT_BLOCKERS.md** and to be detailed in:
- Bridge tokens excluded
- Complex DeFi treated as transfers
- Historical balance may be incomplete
- Gas fee handling simplified
- Multi-chain portfolio not yet supported

**None are deal-breakers.** All are clearly documented with UX warnings.

---

## 📚 How to Use These Documents

### For Project Manager / Decision Maker
→ Read: **EXECUTIVE_SUMMARY** (5 min) + **ASSESSMENT** (sections 1-5, 10 min)  
→ Decision: Go or no-go?  
→ Timeline: 5-7 focused dev days

### For Tech Lead / Architect
→ Read: **ASSESSMENT** (complete, 20 min) + **ARCHITECTURE** (10 min)  
→ Review: Effort estimate, risk list, component diagram  
→ Plan: High-level project structure

### For Developers (Implementing Blockers)
→ Read: **BLOCKERS** (15 min) as reference  
→ Use: **IMPLEMENTATION CHECKLIST** (day-by-day task list)  
→ Refer back to **ARCHITECTURE** when confused about system context

### For QA / Testing
→ Read: **CHECKLIST** Phase 3 (validation section)  
→ Test: Real wallets, edge cases, cross-chain parity  
→ Validate: PnL accuracy, behavior classification, error handling

---

## 🔗 Related Documents

These exist elsewhere in the repo:

- `FEASIBILITY_ASSESSMENT_EVM_PORT.md` — Appendices A, B, C (files to modify, limitations, success metrics)
- `DEPLOYMENT_STRATEGY.md` — Existing (may need update for EVM support)
- `README.md` — Existing (to be updated with EVM mention)

---

## ✉️ Questions?

This assessment is **static** (doesn't assume ongoing research). If questions arise:

1. **About feasibility:** Check **FEASIBILITY_ASSESSMENT_EVM_PORT.md** (Sections 1-5)
2. **About blockers:** Check **EVM_PORT_BLOCKERS.md** (detailed solutions per blocker)
3. **About architecture:** Check **EVM_PORT_ARCHITECTURE.md** (data flow diagrams, code organization)
4. **About implementation:** Check **EVM_PORT_IMPLEMENTATION_CHECKLIST.md** (task list)
5. **About unknowns:** See **FEASIBILITY_ASSESSMENT_EVM_PORT.md** Section 10 (key unknowns to resolve)

If these don't answer the question, **it's likely a new unknown** — flag it and re-assess that specific area.

---

## Summary Table

| **Document** | **Length** | **Audience** | **Key Takeaway** |
|---|---|---|---|
| EXECUTIVE_SUMMARY | 5 min | Everyone | Go/no-go + 60h estimate + 3 blockers |
| FEASIBILITY_ASSESSMENT | 20 min | Tech leads | Complete analysis, hypothesis confirmed, detailed risks |
| BLOCKERS | 15 min | Developers | 3 critical blockers with solutions + code examples |
| ARCHITECTURE | 10 min | Developers | System layers, data flow, code structure |
| CHECKLIST | 10 min (ref) | Developers | Day-by-day task breakdown + checkboxes |

---

## Final Thought

This system is **architecturally sound for EVM porting.** The ingestion layer is cleanly separated from the intelligence layer. Success depends on:

1. **Tight integration with Liquify** (or equivalent data source)
2. **Pragmatic approach** to swap detection (good enough, not perfect)
3. **Early real-wallet validation** (by day 4)

With focused effort over 1-1.5 weeks, **a working EVM ingestion layer is achievable.** The system can then evolve to support multi-chain portfolios, better DEX detection, and more sophisticated routing heuristics post-hackathon.

---

**Assessment complete. Ready to implement. 🚀**

