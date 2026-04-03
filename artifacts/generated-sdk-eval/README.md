# @sova-intel/sdk-generated

One-off generated SDK package derived from `artifacts/intel-openapi.json`.

Purpose:
- compare a fully artifact-driven client package against the curated analyzer SDK
- evaluate whether SDK ownership can move into the public docs repo cleanly

Generated methods:
- `getWalletProfile()` -> `GET /intel/wallet/{addr}`
- `getWalletTokens()` -> `GET /intel/wallet/{addr}/tokens`
- `getWalletHud()` -> `GET /intel/wallet/{addr}/hud`
- `queueHolderProfiles()` -> `POST /intel/token/{mint}/holders`
- `queueSimilarity()` -> `POST /intel/wallets/similarity`
- `queueTokenHoldersAgent()` -> `POST /intel/token/{mint}/holders/agent`
- `getAgentHolderProfilesResult()` -> `GET /intel/jobs/result/agent/holder-profiles/{jobId}`
- `queueWalletSimilarityAgent()` -> `POST /intel/wallets/similarity/agent`
- `getAgentSimilarityResult()` -> `GET /intel/jobs/result/agent/similarity/{requestId}`
- `queueDeepAnalysis()` -> `POST /intel/token/{mint}/holders/deep`
- `batchHud()` -> `POST /intel/wallets/batch-hud`
