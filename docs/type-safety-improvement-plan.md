# Type Safety Improvement Plan

## Overview
This document outlines a comprehensive plan to eliminate `@typescript-eslint/no-explicit-any` warnings and improve type safety across the dashboard codebase. The plan is organized by priority, implementation effort, and impact.

## Current Status
- **Total `any` types identified**: 50+ instances
- **Critical risk areas**: Error handling, API responses, WebSocket communication
- **Estimated total effort**: 6-8 hours
- **Priority**: High (prevents runtime errors and improves maintainability)

---

## Phase 1: Critical Fixes (4-5 hours)

### 1.1 ECharts Component Types (1 hour)
**File**: `dashboard/src/components/charts/EChartComponent.tsx`

**Current Issues**:
- Line 40: `onEvents?: Record<string, (params: any) => void>;`

**Built-in Types Available**:
```typescript
import type { ECElementEvent } from 'echarts/types/src/util/types';
import type { EChartsOption } from 'echarts';
```

**Changes Needed**:
```typescript
// Before
onEvents?: Record<string, (params: any) => void>;

// After
onEvents?: Record<string, (params: ECElementEvent) => void>;
```

**Impact**: Prevents chart interaction bugs, enables full autocomplete

---

### 1.2 Error Handling & API Responses (1.5 hours)
**Files**: 
- `dashboard/src/lib/fetcher.ts`
- `dashboard/src/types/api.ts`
- `dashboard/src/hooks/useJobProgress.ts`

**Current Issues**:
- Line 33: `const handleError = (error: any) => {`
- Line 37: `const handleResponse = (response: any) => {`
- Line 51: `const handleApiError = (error: any) => {`
- Line 85: `const handleNetworkError = (error: any) => {`

**Built-in Types Available**:
```typescript
// For API responses
import type { SWRResponse } from 'swr';

// For errors
type ApiError = {
  message: string;
  status?: number;
  code?: string;
};

// For network errors
type NetworkError = Error & {
  status?: number;
  response?: Response;
};
```

**Changes Needed**:
```typescript
// Before
const handleError = (error: any) => {

// After
const handleError = (error: ApiError | NetworkError) => {
  if ('status' in error) {
    // Handle API error
  } else {
    // Handle network error
  }
};
```

**Impact**: Prevents crashes, improves error handling

---

### 1.3 WebSocket Communication (1 hour)
**Files**:
- `dashboard/src/types/websockets.ts`
- `dashboard/src/hooks/useJobProgress.ts`

**Current Issues**:
- Line 72: `data: any`
- Line 59: `error: any`
- Line 110: `handleError: (error: any) => void`
- Line 115: `handleMessage: (data: any) => void`
- Line 133: `handleProgress: (data: any) => void`
- Line 208: `handleCompletion: (data: any) => void`

**Built-in Types Available**:
```typescript
import type { Socket } from 'socket.io-client';

// Define message types
interface JobProgressMessage {
  jobId: string;
  progress: number;
  message: string;
  status: 'running' | 'completed' | 'failed';
}

interface JobCompletionMessage {
  jobId: string;
  result: any; // Will be typed based on job type
  completedAt: string;
}

interface JobErrorMessage {
  jobId: string;
  error: string;
  errorCode?: string;
}
```

**Changes Needed**:
```typescript
// Before
const handleMessage = (data: any) => {

// After
const handleMessage = (data: JobProgressMessage | JobCompletionMessage | JobErrorMessage) => {
  if ('progress' in data) {
    // Handle progress message
  } else if ('result' in data) {
    // Handle completion message
  } else {
    // Handle error message
  }
};
```

**Impact**: Prevents communication failures, data loss

---

### 1.4 API Response Types (1.5 hours)
**Files**:
- `dashboard/src/types/api.ts`
- `dashboard/src/lib/swr-config.ts`

**Current Issues**:
- Line 59: `data: any`
- Line 128: `response: any`
- Line 129: `data: any`
- Line 227: `result: any`
- Line 248: `data: any`
- Line 259: `result: any`
- Line 260: `data: any`

**Built-in Types Available**:
```typescript
// SWR response types
import type { SWRResponse } from 'swr';

// API response patterns
interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
```

**Changes Needed**:
```typescript
// Before
const { data, error }: SWRResponse<any> = useSWR(...);

// After
interface WalletData {
  address: string;
  balance: number;
  transactions: Transaction[];
  // ... other properties
}

const { data, error }: SWRResponse<WalletData> = useSWR(...);
```

**Impact**: Prevents data corruption, improves data handling

---

## Phase 2: Medium Priority (2-3 hours)

### 2.1 Form & Event Handlers (30 minutes)
**Files**:
- `dashboard/src/components/layout/QuickAddForm.tsx`
- `dashboard/src/components/sidebar/WalletSearch.tsx`
- `dashboard/src/components/similarity-lab/WalletInputForm.tsx`

**Current Issues**:
- Line 57: `error: any`
- Line 108: `data: any`
- Line 23: `progressMessage: any`

**Built-in Types Available**:
```typescript
import type { 
  ChangeEvent, 
  FormEvent, 
  MouseEvent,
  KeyboardEvent 
} from 'react';

import type { 
  SelectChangeEvent 
} from '@mui/material';
```

**Changes Needed**:
```typescript
// Before
const handleInputChange = (event: any) => {

// After
const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
  const value = event.target.value;
  // Type-safe value access
};
```

**Impact**: Better UX, prevents form submission errors

---

### 2.2 Utility Functions (30 minutes)
**Files**:
- `dashboard/src/lib/cache-provider.ts`
- `dashboard/src/lib/swr-config.ts`

**Current Issues**:
- Line 6: `data: any`
- Line 11: `key: any`
- Line 37: `value: any`
- Line 47: `data: any`
- Line 50: `key: any`
- Line 54: `key: any`
- Line 58: `key: any`
- Line 67: `data: any`
- Line 69: `data: any`
- Line 78: `mutate: any`

**Built-in Types Available**:
```typescript
// Cache types
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// SWR cache types
import type { Cache, MutatorCallback } from 'swr';
```

**Changes Needed**:
```typescript
// Before
const setCache = (key: any, data: any) => {

// After
const setCache = <T>(key: string, data: T, ttl: number = 300000) => {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttl
  };
  // Type-safe cache operations
};
```

**Impact**: Performance optimization, prevents cache corruption

---

### 2.3 Component Props & State (1-2 hours)
**Files**:
- `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`
- `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`
- `dashboard/src/components/similarity-lab/results/`

**Current Issues**:
- Multiple `any` types in component props
- Unused variables that should be typed
- Event handler parameters

**Built-in Types Available**:
```typescript
// React component types
import type { 
  ComponentProps, 
  ReactElement, 
  ReactNode 
} from 'react';

// Tremor component types
import type { 
  CardProps, 
  MetricProps, 
  TextProps 
} from '@tremor/react';
```

**Changes Needed**:
```typescript
// Before
interface ComponentProps {
  data: any;
  onEvent: (event: any) => void;
}

// After
interface ComponentProps<T> {
  data: T;
  onEvent: (event: EventType) => void;
  loading?: boolean;
  error?: Error;
}
```

**Impact**: Better component reusability, type safety

---

## Phase 3: Low Priority (30 minutes)

### 3.1 Remaining Utilities
**Files**:
- `dashboard/src/lib/similarity-report-parser.ts`
- `dashboard/src/types/websockets.ts`

**Current Issues**:
- Line 28: `uniqueTokensPerWallet: any`
- Line 31: `sharedTokens: any`
- Line 72: `data: any`

**Changes Needed**:
- Define specific types for similarity data
- Type WebSocket message structures
- Remove unused variables

---

## Implementation Strategy

### Step 1: Install Missing Type Definitions
```bash
npm install --save-dev @types/echarts
npm install --save-dev @types/socket.io-client
```

### Step 2: Create Type Definition Files
Create `dashboard/src/types/` files for:
- `api-responses.ts` - API response interfaces
- `websocket-messages.ts` - WebSocket message types
- `chart-events.ts` - Chart event types
- `form-events.ts` - Form event types

### Step 3: Implement Changes in Order
1. **Critical fixes first** (Phase 1)
2. **Medium priority** (Phase 2)
3. **Low priority** (Phase 3)

### Step 4: Testing Strategy
- Run `npm run lint` after each file
- Test functionality after each phase
- Ensure no runtime errors

---

## Risk Assessment

### High Risk Areas
- **Error handling**: Could cause crashes if not properly typed
- **API responses**: Could cause data corruption
- **WebSocket messages**: Could cause communication failures

### Medium Risk Areas
- **Form handlers**: Could cause UX issues
- **Chart events**: Could cause interaction bugs

### Low Risk Areas
- **Utility functions**: Performance impact only
- **Component props**: Maintainability impact

---

## Success Metrics

### Before Implementation
- 50+ `@typescript-eslint/no-explicit-any` warnings
- Potential runtime errors
- Poor IDE support

### After Implementation
- 0 `@typescript-eslint/no-explicit-any` warnings
- Full type safety
- Complete IDE autocomplete
- Better maintainability

---

## Timeline

### Week 1: Critical Fixes
- Day 1-2: ECharts and Error Handling
- Day 3-4: WebSocket and API Types
- Day 5: Testing and validation

### Week 2: Medium Priority
- Day 1-2: Form handlers and utilities
- Day 3-4: Component props
- Day 5: Testing and cleanup

### Week 3: Low Priority
- Day 1: Remaining utilities
- Day 2: Final testing and documentation

---

## Notes

1. **Built-in types should be used whenever available** - no need to reinvent the wheel
2. **Custom types should be created for domain-specific data** - API responses, business logic
3. **Gradual implementation** - implement phase by phase to avoid breaking changes
4. **Testing is crucial** - each change should be tested to ensure functionality
5. **Documentation updates** - update component documentation with new types

---

## Next Steps

1. **Review this plan** and approve the approach
2. **Start with Phase 1** (Critical fixes)
3. **Implement one file at a time** with testing
4. **Run linting after each change** to track progress
5. **Update this document** as implementation progresses 