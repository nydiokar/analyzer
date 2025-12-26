# Job History Feature - Implementation Guide

**Status**: 🚧 Sprint 1 - In Progress
**Last Updated**: 2025-12-22
**Feature Owner**: User Job Management & Admin Monitoring

---

## ✅ Plan Updates (Post-Review)

**Key decisions**:
- **New endpoints**: avoid `/jobs/*` collisions by introducing `/users/me/jobs` + `/admin/job-history`.
- **All job states**: include `waiting`, `active`, `delayed`, `completed`, `failed`, `paused` with explicit UI labels.
- **Job types (initial)**: **include** `similarity-analysis-flow`, `analyze-holder-profiles`; **exclude** `dashboard-wallet-analysis` (high-frequency).
- **Pagination required**: both user and admin endpoints support `limit` + `offset`.
- **BullMQ range fix**: always use inclusive range `start..end` where `end = offset + limit - 1`.

---

## 🎯 Vision & Goals

### Problem Statement
Users run holder profile analyses but lose access if they:
- Refresh the page
- Navigate away
- Close the browser
- Want to reference past analyses

### Solution
Persistent job history accessible from profile dropdown showing:
- Recent holder profile + similarity jobs
- Job status (waiting/active/delayed/completed/failed/paused)
- Token context (if token mode)
- Ability to rerun jobs
- Admin view for monitoring

---

## 📊 Feature Stages

### ✅ Sprint 1: Core Access (CURRENT)
**Scope**: User job list + Admin monitoring
**Effort**: ~4.5 hours
**Status**: Planning Complete

**Deliverables**:
- ✅ User sees their own jobs in modal (paginated, default 20)
- ✅ Admin endpoint to see all jobs with pagination
- ✅ Simple table UI with job details
- ✅ Rerun button (calls existing API)
- ✅ Initial job types: holder profiles + similarity (dashboard excluded)

### 🔮 Sprint 2: Public Sharing (FUTURE)
**Scope**: Share job results publicly
**Effort**: ~3 hours
**Status**: Planned, Not Started

**Deliverables**:
- Share button generates public link
- Anyone can view cached results (no auth)
- Download CSV/JSON export
- Optional: Logged-in users can rerun shared jobs

### 🌟 Sprint 3+: Advanced Features (BACKLOG)
**Scope**: Power user features
**Status**: Ideas Only

**Potential Features**:
- Result preview modal (full holder profiles data)
- Filter/search jobs
- Job favoriting/tagging
- Team/org sharing (way future)

---

## 👥 User Flows

### Flow 1: User Viewing Their Jobs (Sprint 1)

```
1. User logs in (authenticated with JWT)
2. Clicks profile avatar (top right)
3. Dropdown shows:
   ├─ Account
   ├─ Settings
   ├─ Job History ← NEW
   ├─ Help & About
   └─ Logout

4. Clicks "Job History"
5. Modal opens showing table:

   ┌─ Job History ──────────────────────────────────────┐
   │                                                     │
   │ Job                    Token     Status    Time    │
   │ ───────────────────── ───────── ──────── ───────── │
   │ Holder Profiles: EPj  [SOL]     Done     2m ago   │
   │   • 50 holders                           [Rerun]   │
   │                                                     │
   │ Holder Profiles: 7Qh  [USDC]    Queued   5m ago   │
   │   • 10 holders                           [...]     │
   │                                                     │
   │ Holder Profile: 4nv   -         Failed   1h ago   │
   │   • Wallet mode                          [Rerun]   │
   └─────────────────────────────────────────────────────┘

6. User clicks "Rerun" → New job queued
7. Modal stays open, list auto-refreshes (SWR)
8. User sees new job appear at top as "Queued"
```

**Security**: Only sees jobs where `job.data.userId === user.id` (filter out `dashboard-wallet-analysis` by name)

---

### Flow 2: Admin Monitoring Jobs (Sprint 1)

```
1. Admin logs in (has admin role)
2. Navigates to /admin/jobs (or future admin panel)
3. Sees table of ALL jobs across ALL users:

   ┌─ All Jobs (Admin) ──────────────────────────────────┐
   │ Filters: [User: All ▼] [Status: All ▼] [Queue ▼]   │
   │                                                      │
   │ User        Job              Status   Time          │
   │ ────────── ──────────────── ──────── ────────────   │
   │ user@ex.com Holder Profiles Done     1m ago        │
   │ admin@...   Similarity Lab   Active   3m ago        │
   │ test@...    Holder Profiles  Failed   5m ago        │
   │                                                      │
   │ [50 per page] [< 1 2 3 >]                           │
   └──────────────────────────────────────────────────────┘

4. Admin can:
   - Filter by user, status, queue
   - Click job to see details
   - Debug failed jobs
   - Monitor system health
```

**Security**: Only accessible with `@UseGuards(CompositeAuthGuard)` + `assertAdmin`

---

### Flow 3: Sharing Job Results (Sprint 2 - FUTURE)

```
1. User opens "Job History" modal
2. Clicks "Share" button on completed job
3. System generates: https://app.com/shared/HP-abc123
4. User copies link and shares on Twitter/Discord

5. Anyone clicks link (even logged out):
   ┌─ Shared Holder Profiles ────────────────────────┐
   │ Shared by: user@example.com                     │
   │ Token: SOL (EPjFW...) • Analyzed 2 hours ago    │
   │                                                  │
   │ [Table showing 50 holder profiles]              │
   │                                                  │
   │ [Download CSV] [Download JSON]                  │
   │                                                  │
   │ Want fresh data? [Login to Run Your Own →]      │
   └──────────────────────────────────────────────────┘

6. Logged-in user can click "Run Your Own"
   → Pre-fills holder profiles form with same params
   → Creates new job for them
```

---

## 🏗️ Technical Architecture

### Data Flow

```
┌─────────────┐
│   Browser   │
│ (JWT Token) │
└──────┬──────┘
       │ GET /users/me/jobs?limit=20&offset=0
       │ Authorization: Bearer <jwt>
       ▼
┌─────────────────────┐
│  Jobs Controller    │
│  - Extract userId   │ ← From JWT token (secure)
│  - Call service     │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   Jobs Service      │
│  getUserJobHistory()│
│  - Query BullMQ     │ ← All states
│  - Filter by userId │
│  - Filter by name   │ (exclude dashboard)
│  - Sort by time     │
│  - Paginate         │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  BullMQ / Redis     │
│  - Job storage      │
│  - Job metadata     │ ← userId, tokenMint, status
│  - Job results      │
└─────────────────────┘
```

### Job Data Structure

**Stored in BullMQ** (Redis):
```typescript
{
  id: "1234567890",
  name: "analyze-holder-profiles",
  queue: "analysis-operations",

  // Input data
  data: {
    mode: "token",
    userId: "usr_abc123",        // ← Used for filtering
    tokenMint: "EPjFW...",
    topN: 50,
    requestId: "req_xyz"
  },

  // Job state
  status: "completed", // waiting | active | delayed | completed | failed | paused
  progress: 100,
  timestamp: 1703260800000,
  processedOn: 1703260850000,
  finishedOn: 1703260920000,

  // Result
  returnvalue: {
    success: true,
    mode: "token",
    tokenMint: "EPjFW...",
    profiles: [...],              // Array of holder profiles
    metadata: {
      totalHoldersRequested: 50,
      totalHoldersAnalyzed: 48,
      totalProcessingTimeMs: 70000
    }
  }
}
```

**Cached Results** (HolderProfilesCacheService):
- Token mode: `holder-profiles:token:{mint}:{topN}`
- Wallet mode: `holder-profiles:wallet:{address}`
- Used for fast retrieval and sharing

---

## 🛠️ Implementation Details

### Sprint 1: Core Implementation

#### Backend Changes

**File 1**: `src/api/services/jobs.service.ts`

```typescript
/**
 * Get job history for a specific user
 * Used by: User job history modal
 */
async getUserJobHistory(
  userId: string,
  options: {
    limit?: number;
    offset?: number;
    status?: string[];
    jobNames?: string[]; // allowlist
    queueName?: string;
  } = {}
): Promise<JobStatusResponseDto[]> {
  const limit = Math.min(options.limit || 20, 100);
  const offset = options.offset || 0;
  const queueName = options.queueName || 'analysis-operations';
  const queue = this.getQueueByName(queueName)?.getQueue();
  if (!queue) {
    throw new BadRequestException('Invalid queue');
  }

  const states = options.status?.length
    ? options.status
    : ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'];

  // BullMQ range is inclusive -> end = offset + limit - 1
  const jobs = await queue.getJobs(states as JobState[], offset, offset + limit - 1);

  return jobs
    .filter(job => job.data?.userId === userId)
    .filter(job => !options.jobNames || options.jobNames.includes(job.name))
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(job => this.formatJobResponse(job, queueName));
}

/**
 * Get job history across queues (admin only)
 * Used by: Admin monitoring dashboard (paginated)
 */
async getAdminJobHistory(filters: {
  userId?: string;
  status?: string;
  queue?: string;
  limit?: number;
  offset?: number;
  jobNames?: string[];
}): Promise<JobStatusResponseDto[]> {
  const limit = Math.min(filters.limit || 50, 100);
  const offset = filters.offset || 0;
  const queueName = filters.queue || 'analysis-operations';
  const queue = this.getQueueByName(queueName)?.getQueue();
  if (!queue) {
    throw new BadRequestException('Invalid queue');
  }

  const states = filters.status
    ? [filters.status]
    : ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'];

  const jobs = await queue.getJobs(states as JobState[], offset, offset + limit - 1);

  return jobs
    .filter(job => !filters.userId || job.data?.userId === filters.userId)
    .filter(job => !filters.jobNames || filters.jobNames.includes(job.name))
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(job => this.formatJobResponse(job, queueName));
}
```

**File 2**: `src/api/controllers/users.controller.ts` (ADD endpoint)

```typescript
import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { JobsService } from '../services/jobs.service';

@Controller('users')
export class UsersController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * GET /api/v1/users/me/jobs
   * Returns current user's recent jobs
   */
  @Get('me/jobs')
  @UseGuards(CompositeAuthGuard)
  async getMyJobs(@Req() request: any) {
    const userId = request.user.id; // From JWT token

    const jobs = await this.jobsService.getUserJobHistory(userId, {
      jobNames: ['analyze-holder-profiles', 'similarity-analysis-flow'], // exclude dashboard
      limit: 20,
      offset: 0,
    });

    // Simplify response for frontend
    return jobs.map(job => ({
      id: job.id,
      name: job.name,
      queue: job.queue,
      status: job.status, // waiting | active | delayed | completed | failed | paused
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      processingTime: job.finishedAt && job.processedAt
        ? new Date(job.finishedAt).getTime() - new Date(job.processedAt).getTime()
        : 0,

      // Job-specific data
      mode: job.data?.mode,
      tokenMint: job.data?.tokenMint,
      walletAddress: job.data?.walletAddress,
      walletAddresses: job.data?.walletAddresses,
      topN: job.data?.topN,
      requestId: job.data?.requestId,
      similarityConfig: job.data?.similarityConfig,
      timeoutMinutes: job.data?.timeoutMinutes,
      failureThreshold: job.data?.failureThreshold,
      enrichMetadata: job.data?.enrichMetadata,

      // Result summary
      totalHolders: job.result?.metadata?.totalHoldersAnalyzed || 0,
    }));
  }

}
```

**File 3**: `src/api/controllers/admin-job-history.controller.ts` (NEW)

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { AdminOnly } from '../shared/decorators/admin-only.decorator';
import { JobsService } from '../services/jobs.service';

@Controller('admin/job-history')
@AdminOnly()
export class AdminJobHistoryController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * GET /api/v1/admin/job-history
   * Returns job history for admin (paginated)
   */
  @Get()
  async getAdminJobHistory(
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('queue') queue?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.jobsService.getAdminJobHistory({
      userId,
      status,
      queue,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });
  }
}
```

**File 4**: Register controller in module

```typescript
// src/api.module.ts or src/api/modules/admin.module.ts
import { AdminJobHistoryController } from './controllers/admin-job-history.controller';

@Module({
  controllers: [AdminJobHistoryController], // Add this
  // ...
})
```

---

#### Frontend Changes

**File 1**: `dashboard/src/components/auth/UserMenu.tsx`

```typescript
import { History } from 'lucide-react'; // Add import
import { JobHistoryModal } from './JobHistoryModal'; // Add import

export function UserMenu({ className }: UserMenuProps) {
  // Add state
  const [showJobHistoryModal, setShowJobHistoryModal] = useState(false);

  return (
    <>
      <DropdownMenu>
        {/* ... existing code ... */}

        <DropdownMenuContent align="end" className="w-56">
          {/* ... existing items ... */}

          {/* ADD THIS after Settings */}
          <DropdownMenuItem
            onClick={() => setShowJobHistoryModal(true)}
            className="cursor-pointer"
          >
            <History className="w-4 h-4 mr-2" />
            Job History
          </DropdownMenuItem>

          {/* ... rest of items ... */}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ADD THIS modal */}
      <JobHistoryModal
        open={showJobHistoryModal}
        onOpenChange={setShowJobHistoryModal}
      />

      {/* ... existing modals ... */}
    </>
  );
}
```

**File 2**: `dashboard/src/components/auth/JobHistoryModal.tsx` (NEW FILE)

```typescript
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetcher } from '@/lib/fetcher';
import { RotateCw, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface JobHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface UserJob {
  id: string;
  name: string;
  queue: string;
  status: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'paused';
  createdAt: string;
  finishedAt?: string;
  processingTime: number;
  mode: 'token' | 'wallet';
  tokenMint?: string;
  walletAddress?: string;
  walletAddresses?: string[];
  topN?: number;
  requestId?: string;
  similarityConfig?: Record<string, unknown>;
  timeoutMinutes?: number;
  failureThreshold?: number;
  enrichMetadata?: boolean;
  totalHolders: number;
}

export function JobHistoryModal({ open, onOpenChange }: JobHistoryModalProps) {
  const limit = 20;
  const [page, setPage] = useState(0);
  const offset = page * limit;

  const { data: jobs, error, isLoading, mutate } = useSWR<UserJob[]>(
    open ? `/users/me/jobs?limit=${limit}&offset=${offset}` : null,
    fetcher,
    {
      refreshInterval: open ? 5000 : 0, // Auto-refresh every 5s when open
    }
  );

  const [rerunningJobId, setRerunningJobId] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    const config = {
      waiting: { variant: 'secondary' as const, label: 'Queued' },
      active: { variant: 'secondary' as const, label: 'Running' },
      delayed: { variant: 'secondary' as const, label: 'Delayed' },
      completed: { variant: 'default' as const, label: 'Done' },
      failed: { variant: 'destructive' as const, label: 'Failed' },
      paused: { variant: 'outline' as const, label: 'Paused' },
    };
    const { variant, label } = config[status as keyof typeof config];
    return <Badge variant={variant}>{label}</Badge>;
  };

  const getJobName = (job: UserJob) => {
    if (job.mode === 'token' && job.tokenMint) {
      return `Holder Profiles: ${job.tokenMint.slice(0, 8)}...`;
    }
    if (job.mode === 'wallet' && job.walletAddress) {
      return `Holder Profile: ${job.walletAddress.slice(0, 8)}...`;
    }
    if (job.name === 'similarity-analysis-flow' && job.walletAddresses?.length) {
      return `Similarity: ${job.walletAddresses.length} wallets`;
    }
    return 'Holder Profile Analysis';
  };

  const handleRerun = async (job: UserJob) => {
    setRerunningJobId(job.id);
    try {
      const isSimilarity = job.name === 'similarity-analysis-flow';
      const endpoint = isSimilarity
        ? '/analyses/similarity/queue'
        : job.mode === 'token'
          ? '/analyses/holder-profiles/token'
          : '/analyses/holder-profiles/wallet';

      const body = isSimilarity
        ? {
            walletAddresses: job.walletAddresses,
            similarityConfig: job.similarityConfig,
            timeoutMinutes: job.timeoutMinutes,
            failureThreshold: job.failureThreshold,
            enrichMetadata: job.enrichMetadata,
          }
        : job.mode === 'token'
          ? { tokenMint: job.tokenMint, topN: job.topN }
          : { walletAddress: job.walletAddress };

      // Submit new job with same params
      await fetcher(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      toast.success('Job queued successfully!');
      await mutate(); // Refresh list
    } catch (error) {
      console.error('Failed to rerun job:', error);
      toast.error('Failed to queue job. Please try again.');
    } finally {
      setRerunningJobId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job History</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <p className="text-destructive mb-2">Failed to load jobs</p>
            <Button variant="outline" onClick={() => mutate()}>
              Retry
            </Button>
          </div>
        )}

        {jobs && jobs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              No jobs found. Run a holder profile analysis to see it here!
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Job</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Holders</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm">{getJobName(job)}</span>
                        <span className="text-xs text-muted-foreground">
                          {job.mode === 'token' ? 'Token Mode' : 'Wallet Mode'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {job.mode === 'token' && job.tokenMint && (
                        <TokenBadge mint={job.tokenMint} layout="inline" />
                      )}
                      {job.mode === 'wallet' && <span className="text-muted-foreground">-</span>}
                      {job.name === 'similarity-analysis-flow' && (
                        <span className="text-muted-foreground">
                          {job.walletAddresses?.length ?? 0} wallets
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {job.totalHolders > 0 ? (
                        <span className="text-sm">{job.totalHolders}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(job.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                        {job.processingTime > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({(job.processingTime / 1000).toFixed(1)}s)
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRerun(job)}
                        disabled={
                          rerunningJobId === job.id || job.status === 'active'
                        }
                      >
                        {rerunningJobId === job.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <RotateCw className="w-4 h-4 mr-1" />
                            Rerun
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="flex justify-end gap-2 pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={jobs.length < limit}
            >
              Next
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

---

## 📋 Sprint 1 Checklist

### Backend Tasks
- [x] Add `getUserJobHistory()` method to `JobsService` (all states + pagination)
- [x] Add `getAdminJobHistory()` method to `JobsService` (all states + pagination)
- [x] Add `GET /users/me/jobs` to `UsersController`
- [x] Create `AdminJobHistoryController` with endpoint:
  - [x] `GET /admin/job-history` (admin)
- [x] Register admin controller in module
- [ ] Test with Postman/curl

### Frontend Tasks
- [x] Add "Job History" menu item to `UserMenu.tsx`
- [x] Create `JobHistoryModal.tsx` component
- [x] Add state management for modal open/close
- [ ] Test modal opening from dropdown
- [ ] Test job list loading
- [ ] Test rerun functionality
- [ ] Test auto-refresh (5s interval)
- [x] Add pagination controls (next/prev or load-more)

### Testing
- [ ] User can see only their jobs
- [ ] Admin can see all jobs with pagination
- [ ] Rerun button queues new job
- [ ] Modal auto-refreshes when open
- [ ] Status badges show correct labels/colors for all states
- [ ] Token badges render correctly
- [ ] Time displays "X minutes ago" format
- [ ] Empty state shows when no jobs
- [ ] Error state shows on API failure
- [ ] Similarity + holder profile jobs appear; dashboard jobs do not
- [ ] Pagination returns stable ordering

---

## 🔮 Future Enhancements (Sprint 2+)

### Public Sharing (Sprint 2)

**New Files**:
- `src/api/controllers/shared.controller.ts`
- `dashboard/src/app/shared/[token]/page.tsx`

**Database**:
```sql
CREATE TABLE job_shares (
  share_token VARCHAR(16) PRIMARY KEY,
  job_id VARCHAR(255) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  view_count INT DEFAULT 0
);
```

**Features**:
- Share button in job history modal
- Generate public link: `/shared/HP-abc123`
- Public page showing cached results
- Download CSV/JSON buttons
- Optional: "Run your own" for logged-in users

### Advanced Features (Sprint 3+)
- Result preview modal (show full holder profiles)
- Filter by status, date range
- Search by wallet/token address
- Job favoriting/pinning
- Export job history to CSV
- Scheduled/recurring jobs

---

## 🎓 Key Learnings

### What Works Well
- ✅ BullMQ already stores all job data (no new DB tables needed)
- ✅ userId already in job data (from WS user rooms refactor)
- ✅ Existing cache service can support sharing
- ✅ UI components already exist (TokenBadge, Table, Dialog)

### Technical Decisions
- **Storage**: BullMQ/Redis (not PostgreSQL)
  - Reason: Job data already there, fast queries
  - Tradeoff: Limited history (configurable retention)

- **Filtering**: Server-side by userId
  - Reason: Security (can't fake userId from JWT)
  - Tradeoff: Requires job data to carry `userId`

- **Job selection**: Allowlist by job name (exclude `dashboard-wallet-analysis`)
  - Reason: Avoid noise from high-frequency single-wallet jobs
  - Tradeoff: Some jobs won't appear until added to allowlist

- **Endpoints**: `/users/me/jobs` + `/admin/job-history` (separate from `/jobs/*`)
  - Reason: Avoid collisions with existing job status endpoints
  - Tradeoff: New controller + route to document

- **Real-time updates**: SWR with 5s polling
  - Reason: Simple, no new WS subscriptions
  - Tradeoff: Not instant (good enough for this feature)

### Security Model
- User endpoint: Filters by `request.user.id` from JWT
- Admin endpoint: Protected by `CompositeAuthGuard` + `assertAdmin`
- Share endpoint (future): Public but read-only

---

## 📝 Notes for Future LLMs

1. **Don't over-engineer**: Keep Sprint 1 simple (just list + rerun)
2. **Reuse existing code**: HolderProfilesCacheService, TokenBadge, etc.
3. **Security first**: Always filter by userId from JWT, never from request params
4. **Routing**: Use `/users/me/jobs` + `/admin/job-history`, keep `/jobs/*` for job status
5. **Statuses**: Always include waiting/active/delayed/completed/failed/paused
6. **Filtering**: Exclude `dashboard-wallet-analysis` unless explicitly enabled
7. **Pagination**: Use `limit` + `offset`, BullMQ end index is inclusive
8. **Mobile-friendly**: Table should be responsive (consider Card view on mobile)

---

## 🔗 Related Documentation

- Main implementation plan: `.ai/JOB_HISTORY_PLAN.md`
- Job types: `src/queues/jobs/types/index.ts`
- Jobs service: `src/api/services/jobs.service.ts`
- Holder profiles cache: `src/api/services/holder-profiles-cache.service.ts`
- User authentication: `src/api/modules/auth.module.ts`

---

**Current Status**: Ready for Sprint 1 implementation
**Next Action**: Smoke-test `/users/me/jobs` + `/admin/job-history` and verify modal behavior
**Estimated Completion**: 4.5 hours from start
