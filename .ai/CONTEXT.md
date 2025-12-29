# Current State

**Project**: Sova Intel - Wallet Analysis System  
**Branch**: `feat/job-history`  
**Status**: Job history feature (Sprint 1) in progress  
**Last Updated**: 2025-12-22  

---

## What's Working

- User job history endpoint: `GET /api/v1/users/me/jobs` (paginated, filtered to job types)
- Admin job history endpoint: `GET /api/v1/admin/job-history` (paginated, filterable)
- User job types in scope: `similarity-analysis-flow`, `analyze-holder-profiles`
- Ownership enforcement on job status/progress/result (non-admins can only access their jobs)
- Admin-only direct submit endpoints are hidden from Swagger and remain admin-locked

---

## Roadmap (Job History Sprint 1)

**Done**
- ✅ Add user job history endpoint with pagination and filtering
- ✅ Add admin job history endpoint with pagination and filtering
- ✅ Enforce job ownership for `/jobs/:jobId`, `/jobs/:jobId/progress`, `/jobs/:jobId/result`
- ✅ Hide unused admin submit endpoints from Swagger

**In Progress**
- ⏳ Update frontend to surface Job History in profile dropdown + modal (table, pagination, rerun)

**Next**
- ⏭️ Confirm UI only shows the two job types and excludes `dashboard-wallet-analysis`
- ⏭️ Verify rerun flow re-queues with `userId` and surfaces new job at top
- ⏭️ Add minimal admin UI or reuse existing admin surface for job history

---

## Notes

- Direct job submission endpoints under `/jobs/*` are admin-only and not part of user flow.
- User history is scoped by `job.data.userId` with Redis fallback for lookup.
