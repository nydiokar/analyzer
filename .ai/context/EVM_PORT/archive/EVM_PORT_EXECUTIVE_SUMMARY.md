# EVM Port — Executive Summary
**Feasibility Assessment Complete**

> **ARCHIVED — 2026-05-22.** Implementation is complete on `feature/evm-ingestion`. Liquify API was not used — Alchemy `alchemy_getAssetTransfers` + DEX event decoding was used instead. This document is kept as a decision-history artifact. Do not use it to guide future work. See `EVM_PORT_PROGRESS.md` for ground truth and `EVM_CHAIN_AGNOSTIC_REFACTOR.md` for next steps.

---

## Thesis Validation

✅ **CONFIRMED:** Ingestion layer IS cleanly separable from intelligence layer.

- **Layer 1 (Ingestion):** 100% Solana-specific → REPLACE for EVM
- **Layer 2 (Intelligence):** 100% chain-agnostic → NO CHANGES
- **Layer 3 (Output):** Format-agnostic → NO CHANGES

---

## Go / No-Go

### **✅ CONDITIONAL GO**

**Success equation:**
- Liquify API available with swap value ✅ (makes mapping easy)
- 5-7 focused dev days ✅ (realistic timeline)
- Clear scope (MVP: 1 chain, core functionality) ✅
- Real wallet validation early ✅

**If Liquify unavailable:** Still feasible, but effort → 60-70 hours (adds oracle fallback complexity).

---

## Effort Estimate

| **Phase** | **Hours** | **Duration** |
|-----------|-----------|--------------|
| Schema refactor + foundation | 12h | 1-2 days |
| Layer 1 ingestion rewrite | 25-35h | 3-4 days |
| Testing + validation | 15h | 2 days |
| Polish | 10h | 1 day |
| **TOTAL** | **43.5-59.5h** | **5-7 dev days** |

---

## The Three Critical Blockers (And Solutions)

### **Blocker 1: "Is this a swap or a transfer?"**
**Challenge:** EVM has no native transaction classification.  
**Solution:** Heuristics (multi-leg detection, DEX program checks).  
**Effort:** 4-6 hours  
**Risk:** Medium (solvable, but requires validation)

### **Blocker 2: "How much ETH/AVAX was paid for this token?"**
**Challenge:** Solana's routing is complex; EVM has multi-hop swaps.  
**Solution:** Trust Liquify's `swapValue`, or fall back to oracle.  
**Effort:** 6-10 hours  
**Risk:** Medium-High (price staleness possible)

### **Blocker 3: "Which stablecoins?"**
**Challenge:** Hardcoded Solana USDC address doesn't work on Ethereum.  
**Solution:** Parameterize by chain (10 mins).  
**Effort:** 1 hour  
**Risk:** Low

---

## What Stays Exactly the Same

```
SwapAnalysisInput records (DB)
    ↓
SwapAnalyzer.analyze()
    ↓
PnL results + Behavior classification + Similarity metrics
    ↓
API endpoints (/wallet-hud, /wallet-pnl, /wallet-behavior, etc.)
```

**No changes to intelligence layer.** All downstream logic is chain-agnostic.

---

## Architecture Post-Port

```
┌─────────────────────────────────────────────────────────────┐
│                  LAYER 3: Output (Unchanged)                 │
│        API Endpoints, DTOs, Controller Logic                 │
├─────────────────────────────────────────────────────────────┤
│              LAYER 2: Intelligence (Unchanged)                │
│  PnL Analysis, Behavior Classification, Similarity Engine    │
├─────────────────────────────────────────────────────────────┤
│         LAYER 1: Ingestion (Replaced per-chain)              │
│                                                               │
│  Solana Path:              EVM Path:                          │
│  ├─ Helius API       →     ├─ Liquify API / RPC              │
│  ├─ Helius Mapper    →     ├─ EVM Mapper (new)              │
│  └─ SwapAnalysisInput →    └─ SwapAnalysisInput            │
└─────────────────────────────────────────────────────────────┘
```

---

## Known Limitations (First Version)

- ⚠️ Single-chain only (Ethereum primary, Arbitrum secondary)
- ⚠️ Bridge tokens excluded (would require cross-chain state)
- ⚠️ Complex DeFi treated as transfers (staking, liquidations, etc.)
- ⚠️ Gas fee handling simplified (all gas to initiator)
- ⚠️ Historical balance may be incomplete on light archive RPC

**None are blocking.** All document-able with clear UX warnings.

---

## Key Unknowns (Resolve Before Start)

1. **Liquify API contract:** Does it provide `swapValue`? (2h to test)
2. **Chain priority:** Ethereum only, or multi-chain day 1?
3. **Gas treatment:** Include in cost basis or separate metric?
4. **Fallback strategy:** If Liquify unavailable?

---

## Success Metrics (Hackathon)

**Minimal:**
- ✅ 1 EVM wallet ingested end-to-end
- ✅ PnL computed correctly
- ✅ No crashes, clear error messages

**Nice-to-have:**
- ✅ 2+ chains supported
- ✅ Behavior + Similarity working
- ✅ Side-by-side UI comparison

---

## Risk Summary

| **Risk** | **Severity** | **Mitigation** |
|----------|--------------|----------------|
| Swap detection fails silently | 🔴 HIGH | Anomaly alerts, test with known wallets early |
| Liquify unavailable | 🟠 MEDIUM | Have fallback (oracle + event decoding) ready |
| Value computation off by 10%+ | 🟠 MEDIUM | Validate against multiple sources, document bounds |
| Gas pricing wrong | 🟡 LOW-MEDIUM | Decide policy upfront, document |
| Schema refactor breaks code | 🟢 LOW | Full test suite after rename |

---

## Recommendation

**🟢 Proceed** with EVM port.

**Prerequisites:**
1. Validate Liquify API (2h spike)
2. Pick 1 target chain (Ethereum likely)
3. Allocate 6-7 focused dev days
4. Plan real wallet validation early (day 3-4)
5. Accept MVP scope (core features, known limitations)

**Expected outcome:** Working EVM ingestion + PnL by end of hackathon, architecture validated for multi-chain expansion post-event.

---

## Next Steps

1. **Now:** Review this assessment
2. **Day 1:** Spike Liquify API, resolve unknowns
3. **Days 2-4:** Build ingestion layer
4. **Days 5-7:** Test, validate, demo-ready

