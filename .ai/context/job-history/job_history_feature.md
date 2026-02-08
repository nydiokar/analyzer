# Job History Feature - Implementation Guide

**Status**: 🚧 Sprint 1 - In Progress
**Last Updated**: 2025-12-22
**Feature Owner**: User Job Management & Admin Monitoring

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
- Recent holder profile jobs
- Job status (completed/failed/active)
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
- ✅ User sees their own jobs in modal (max 20 recent)
- ✅ Admin endpoint to see all jobs (for debugging)
- ✅ Simple table UI with job details
- ✅ Rerun button (calls existing API)

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
- Pagination (beyond 20 jobs)
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
   ├─ My Jobs ← NEW
   ├─ Help & About
   └─ Logout

4. Clicks "My Jobs"
5. Modal opens showing table:

   ┌─ My Jobs ──────────────────────────────────────────┐
   │                                                     │
   │ Job                    Token     Status    Time    │
   │ ───────────────────── ───────── ──────── ───────── │
   │ Holder Profiles: EPj  [SOL]     Done     2m ago   │
   │   • 50 holders                           [Rerun]   │
   │                                                     │
   │ Holder Profiles: 7Qh  [USDC]    Active   5m ago   │
   │   • 10 holders                           [...]     │
   │                                                     │
   │ Holder Profile: 4nv   -         Failed   1h ago   │
   │   • Wallet mode                          [Rerun]   │
   └─────────────────────────────────────────────────────┘

6. User clicks "Rerun" → New job queued
7. Modal stays open, list auto-refreshes (SWR)
8. User sees new job appear at top as "Active"
```

**Security**: Only sees jobs where `job.data.userId === user.id`

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

**Security**: Only accessible with `@UseGuards(AdminGuard)`

---

### Flow 3: Sharing Job Results (Sprint 2 - FUTURE)

```
1. User opens "My Jobs" modal
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
       │ GET /jobs/my-jobs
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
│  getUserJobs()      │
│  - Query BullMQ     │ ← Filter by userId
│  - Filter by name   │
│  - Sort by time     │
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
  status: "completed",
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
 * Get jobs for a specific user
 * Used by: User job history modal
 */
async getUserJobs(
  userId: string,
  options: {
    jobName?: string;
    limit?: number;
    status?: string[];
  } = {}
): Promise<JobStatusResponseDto[]> {
  const queue = this.analysisOperationsQueue.getQueue();
  const limit = options.limit || 20;

  // Query BullMQ for jobs (completed, failed, active)
  const [completed, failed, active] = await Promise.all([
    queue.getCompleted(0, limit),
    queue.getFailed(0, limit),
    queue.getActive(0, limit),
  ]);

  // Filter by userId and optionally by job name
  const allJobs = [...completed, ...failed, ...active]
    .filter(job =>
      job.data?.userId === userId &&
      (!options.jobName || job.name === options.jobName)
    )
    .sort((a, b) => b.timestamp - a.timestamp) // Newest first
    .slice(0, limit);

  return allJobs.map(job =>
    this.formatJobResponse(job, 'analysis-operations')
  );
}

/**
 * Get all jobs (admin only)
 * Used by: Admin monitoring dashboard
 */
async getAdminJobs(filters: {
  userId?: string;
  status?: string;
  queue?: string;
  limit?: number;
}): Promise<JobStatusResponseDto[]> {
  const limit = Math.min(filters.limit || 50, 100);
  const queueName = filters.queue || 'analysis-operations';
  const queue = this.getQueueByName(queueName)?.getQueue();

  if (!queue) {
    throw new BadRequestException('Invalid queue');
  }

  // Get jobs by status or all
  let jobs: Job[] = [];
  if (filters.status === 'completed') {
    jobs = await queue.getCompleted(0, limit);
  } else if (filters.status === 'failed') {
    jobs = await queue.getFailed(0, limit);
  } else if (filters.status === 'active') {
    jobs = await queue.getActive(0, limit);
  } else {
    // Get mixed (no status filter)
    const [c, f, a] = await Promise.all([
      queue.getCompleted(0, limit / 3),
      queue.getFailed(0, limit / 3),
      queue.getActive(0, limit / 3),
    ]);
    jobs = [...c, ...f, ...a];
  }

  // Optional: Filter by userId
  if (filters.userId) {
    jobs = jobs.filter(j => j.data?.userId === filters.userId);
  }

  return jobs
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map(job => this.formatJobResponse(job, queueName));
}
```

**File 2**: `src/api/controllers/jobs.controller.ts` (or create new)

```typescript
import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';
import { JobsService } from '../services/jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * GET /api/v1/jobs/my-jobs
   * Returns current user's recent jobs
   */
  @Get('my-jobs')
  @UseGuards(JwtAuthGuard)
  async getMyJobs(@Req() request: any) {
    const userId = request.user.id; // From JWT token

    const jobs = await this.jobsService.getUserJobs(userId, {
      jobName: 'analyze-holder-profiles', // Only holder profiles for now
      limit: 20,
    });

    // Simplify response for frontend
    return jobs.map(job => ({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      processingTime: job.finishedAt && job.processedAt
        ? new Date(job.finishedAt).getTime() - new Date(job.processedAt).getTime()
        : 0,

      // Job-specific data
      mode: job.data?.mode,
      tokenMint: job.data?.tokenMint,
      walletAddress: job.data?.walletAddress,

      // Result summary
      totalHolders: job.result?.metadata?.totalHoldersAnalyzed || 0,
    }));
  }

  /**
   * GET /api/v1/jobs/admin/all-jobs
   * Returns all jobs (admin only)
   */
  @Get('admin/all-jobs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAdminJobs(
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('queue') queue?: string,
    @Query('limit') limit?: string,
  ) {
    return this.jobsService.getAdminJobs({
      userId,
      status,
      queue,
      limit: limit ? parseInt(limit) : 50,
    });
  }
}
```

**File 3**: Register controller in module

```typescript
// src/api.module.ts or src/api/modules/jobs.module.ts
import { JobsController } from './controllers/jobs.controller';

@Module({
  controllers: [JobsController], // Add this
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
            My Jobs
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
  status: 'completed' | 'failed' | 'active';
  createdAt: string;
  finishedAt?: string;
  processingTime: number;
  mode: 'token' | 'wallet';
  tokenMint?: string;
  walletAddress?: string;
  totalHolders: number;
}

export function JobHistoryModal({ open, onOpenChange }: JobHistoryModalProps) {
  const { data: jobs, error, isLoading, mutate } = useSWR<UserJob[]>(
    open ? '/jobs/my-jobs' : null,
    fetcher,
    {
      refreshInterval: open ? 5000 : 0, // Auto-refresh every 5s when open
    }
  );

  const [rerunningJobId, setRerunningJobId] = useState<string | null>(null);

  const getStatusBadge = (status: string) => {
    const config = {
      completed: { variant: 'default' as const, label: 'Done' },
      failed: { variant: 'destructive' as const, label: 'Failed' },
      active: { variant: 'secondary' as const, label: 'Running' },
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
    return 'Holder Profile Analysis';
  };

  const handleRerun = async (job: UserJob) => {
    setRerunningJobId(job.id);
    try {
      // Determine endpoint based on mode
      const endpoint =
        job.mode === 'token'
          ? '/analyses/holder-profiles/token'
          : '/analyses/holder-profiles/wallet';

      // Submit new job with same params
      await fetcher(endpoint, {
        method: 'POST',
        body: JSON.stringify(
          job.mode === 'token'
            ? { tokenMint: job.tokenMint, topN: 50 }
            : { walletAddress: job.walletAddress }
        ),
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
          <DialogTitle>My Jobs</DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
}
```

---

## 📋 Sprint 1 Checklist

### Backend Tasks
- [ ] Add `getUserJobs()` method to `JobsService`
- [ ] Add `getAdminJobs()` method to `JobsService`
- [ ] Create `JobsController` with endpoints:
  - [ ] `GET /jobs/my-jobs` (user)
  - [ ] `GET /jobs/admin/all-jobs` (admin)
- [ ] Register controller in module
- [ ] Test with Postman/curl

### Frontend Tasks
- [ ] Add "My Jobs" menu item to `UserMenu.tsx`
- [ ] Create `JobHistoryModal.tsx` component
- [ ] Add state management for modal open/close
- [ ] Test modal opening from dropdown
- [ ] Test job list loading
- [ ] Test rerun functionality
- [ ] Test auto-refresh (5s interval)

### Testing
- [ ] User can see only their jobs
- [ ] Admin can see all jobs
- [ ] Rerun button queues new job
- [ ] Modal auto-refreshes when open
- [ ] Status badges show correct colors
- [ ] Token badges render correctly
- [ ] Time displays "X minutes ago" format
- [ ] Empty state shows when no jobs
- [ ] Error state shows on API failure

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
- Pagination beyond 20 jobs
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
  - Tradeoff: None

- **Real-time updates**: SWR with 5s polling
  - Reason: Simple, no new WS subscriptions
  - Tradeoff: Not instant (good enough for this feature)

### Security Model
- User endpoint: Filters by `request.user.id` from JWT
- Admin endpoint: Protected by `AdminGuard`
- Share endpoint (future): Public but read-only

---

## 📝 Notes for Future LLMs

1. **Don't over-engineer**: Keep Sprint 1 simple (just list + rerun)
2. **Reuse existing code**: HolderProfilesCacheService, TokenBadge, etc.
3. **Security first**: Always filter by userId from JWT, never from request params
4. **Mobile-friendly**: Table should be responsive (consider Card view on mobile)
5. **Performance**: 20 jobs limit is intentional (fast queries)
6. **Future-proof**: Structure allows easy addition of sharing, filters, etc.

---

## 🔗 Related Documentation

- Main implementation plan: `.ai/JOB_HISTORY_PLAN.md`
- Job types: `src/queues/jobs/types/index.ts`
- Jobs service: `src/api/services/jobs.service.ts`
- Holder profiles cache: `src/api/services/holder-profiles-cache.service.ts`
- User authentication: `src/api/modules/auth.module.ts`

---

**Current Status**: Ready for Sprint 1 implementation
**Next Action**: Implement backend `getUserJobs()` method
**Estimated Completion**: 4.5 hours from start
