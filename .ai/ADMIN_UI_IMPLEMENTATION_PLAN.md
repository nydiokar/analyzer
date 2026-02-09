# Admin UI Implementation Plan

**Date:** 2026-02-09
**Status:** Planning Phase
**Estimated Time:** 3-4 hours

---

## Overview

Create a comprehensive admin management panel at `/admin` (or `/admin/registration`) that provides a clean UI for:
1. Registration code management
2. Registration kill-switch control
3. User account management

This builds on the existing `/admin/api-keys` page pattern and provides full access to all admin endpoints.

---

## Page Structure

### Route: `/admin` (Main Admin Hub)

**Layout Option 1: Tabbed Interface (Recommended)**
```
┌─────────────────────────────────────────────────────────────┐
│  Admin Panel                                                │
│  ─────────────────────────────────────────────────────      │
│  [API Keys] [Registration] [Users] [Settings]               │
│  ─────────────────────────────────────────────────────      │
│  │ Active tab content here                                  │
│  └─────────────────────────────────────────────────────     │
└─────────────────────────────────────────────────────────────┘
```

**Layout Option 2: Separate Routes**
- `/admin/api-keys` (existing)
- `/admin/registration` (new)
- `/admin/users` (new)

**Recommendation:** Use Option 1 (tabbed) - keeps everything in one place, better UX.

---

## Tab 1: Registration Management

### Section A: Kill-Switch Control (Top Priority)
**Visual Design:**
- Large toggle switch with danger styling
- Clear status indicator (ENABLED/DISABLED)
- Warning message when enabled

**Components:**
```tsx
<Card className="border-red-500"> {/* if enabled */}
  <CardHeader>
    <div className="flex items-center justify-between">
      <div>
        <CardTitle>Registration Kill-Switch</CardTitle>
        <CardDescription>Emergency control to halt all new registrations</CardDescription>
      </div>
      <Switch
        checked={isKillSwitchEnabled}
        onCheckedChange={handleKillSwitchToggle}
        className="scale-150"
      />
    </div>
  </CardHeader>
  <CardContent>
    {isKillSwitchEnabled ? (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>ALL REGISTRATIONS BLOCKED</AlertTitle>
        <AlertDescription>
          New user registrations are currently disabled. Existing users can still login.
        </AlertDescription>
      </Alert>
    ) : (
      <p className="text-sm text-muted-foreground">
        Registrations are currently allowed with valid codes.
      </p>
    )}
  </CardContent>
</Card>
```

### Section B: Registration Code Statistics
**Visual Design:**
- 4-card grid showing key metrics
- Real-time stats

**Components:**
```tsx
<div className="grid grid-cols-4 gap-4">
  <StatsCard title="Total Codes" value={stats.total} />
  <StatsCard title="Active" value={stats.active} variant="success" />
  <StatsCard title="Used" value={stats.used} variant="warning" />
  <StatsCard title="Revoked" value={stats.revoked} variant="destructive" />
</div>
```

### Section C: Code Management
**Visual Design:**
- "Create Code" button + "Create Bulk" button
- Expandable form on click
- Table/list of codes with status badges

**Features:**
1. **Create Single Code Form**
   - Description (optional)
   - Max Uses (default: 1, range: 1-1000)
   - Expiration Date (optional, date picker)
   - Submit → Show created code with copy button (one-time display)

2. **Create Bulk Codes Form**
   - Count (range: 1-100)
   - Description (optional)
   - Max Uses (default: 1)
   - Expiration Date (optional)
   - Submit → Download CSV or show codes in modal

3. **Codes List**
   - Columns: Code (truncated), Status, Description, Uses (X/Y), Expires, Created
   - Actions: Revoke, Delete (with confirmation)
   - Filters: Status dropdown (All, Active, Used, Revoked, Expired)
   - Pagination (20 per page)

**Table Schema:**
```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Code</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Description</TableHead>
      <TableHead>Uses</TableHead>
      <TableHead>Expires</TableHead>
      <TableHead>Created</TableHead>
      <TableHead>Actions</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {codes.map(code => (
      <TableRow key={code.id}>
        <TableCell>
          <code className="text-xs">{code.code.substring(0, 8)}...</code>
          <Button size="icon" onClick={() => copyCode(code.code)}>
            <Copy />
          </Button>
        </TableCell>
        <TableCell>
          <Badge variant={getBadgeVariant(code.status)}>
            {code.status}
          </Badge>
        </TableCell>
        <TableCell>{code.description || '-'}</TableCell>
        <TableCell>{code.usedCount} / {code.maxUses || '∞'}</TableCell>
        <TableCell>
          {code.expiresAt ? formatDate(code.expiresAt) : 'Never'}
        </TableCell>
        <TableCell>{formatDate(code.createdAt)}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuItem onClick={() => handleRevoke(code.code)}>
              Revoke
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDelete(code.code)} className="text-red-600">
              Delete
            </DropdownMenuItem>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

---

## Tab 2: User Management

### Section A: User Search/Filter
**Components:**
- Search input (email/ID)
- Filter dropdowns (Status: All/Active/Disabled, Admin: All/Yes/No)

### Section B: Users List
**Table Columns:**
- Email
- Display Name (if set)
- Status (Active/Disabled badge)
- Is Admin (badge)
- Email Verified (checkmark)
- Registered At
- Last Login
- Actions

**Actions:**
- Enable/Disable toggle
- Set/Remove Admin (optional - might want to keep this CLI-only)
- View Details (modal with full user info)

**Table Schema:**
```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Email</TableHead>
      <TableHead>Display Name</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Admin</TableHead>
      <TableHead>Verified</TableHead>
      <TableHead>Registered</TableHead>
      <TableHead>Actions</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {users.map(user => (
      <TableRow key={user.id}>
        <TableCell>{user.email}</TableCell>
        <TableCell>{user.displayName || '-'}</TableCell>
        <TableCell>
          <Badge variant={user.isActive ? 'default' : 'secondary'}>
            {user.isActive ? 'Active' : 'Disabled'}
          </Badge>
        </TableCell>
        <TableCell>
          {user.isAdmin && <Badge variant="destructive">Admin</Badge>}
        </TableCell>
        <TableCell>
          {user.emailVerifiedAt ? <Check className="text-green-500" /> : <X className="text-gray-400" />}
        </TableCell>
        <TableCell>{formatDate(user.createdAt)}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuItem onClick={() => toggleUserStatus(user)}>
              {user.isActive ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => viewUserDetails(user)}>
              View Details
            </DropdownMenuItem>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

---

## Tab 3: API Keys (Existing)

- Keep existing `/admin/api-keys` content
- Embed as tab content or link to separate route

---

## Implementation Phases

### Phase 1: Foundation (30 min)
**File:** `dashboard/src/app/admin/page.tsx`

1. Create main admin page with tab navigation
2. Add admin guard (redirect if not admin)
3. Set up basic layout structure
4. Wire up shadcn Tabs component

**Result:** Empty tabbed interface with navigation

### Phase 2: Kill-Switch + Stats (45 min)
**Files:**
- `dashboard/src/app/admin/page.tsx` (main logic)
- `dashboard/src/hooks/useAdminRegistration.ts` (data fetching hook)

1. Implement kill-switch toggle
2. Implement stats cards
3. Add confirmation modal for kill-switch enable
4. Wire up API endpoints

**Result:** Working kill-switch control + live statistics

### Phase 3: Code Management UI (90 min)
**Files:**
- `dashboard/src/app/admin/page.tsx`
- `dashboard/src/components/admin/CreateCodeForm.tsx` (optional extraction)

1. Create code form (single)
2. Create bulk code form
3. Implement codes table with status badges
4. Add revoke/delete actions with confirmations
5. Add copy-to-clipboard for codes
6. Implement status filter

**Result:** Full code management UI

### Phase 4: User Management (60 min)
**Files:**
- `dashboard/src/app/admin/page.tsx`
- `dashboard/src/hooks/useAdminUsers.ts`

1. Implement user list table
2. Add search/filter functionality
3. Add enable/disable actions
4. Add user details modal
5. Wire up API endpoints

**Result:** Complete user management UI

### Phase 5: Polish + Testing (30 min)
1. Loading states
2. Error handling toasts
3. Responsive design checks
4. Accessibility (keyboard nav, screen readers)
5. Manual testing of all actions

**Result:** Production-ready admin panel

---

## API Endpoints Reference

### Registration Codes
- `POST /admin/registration-codes` - Create single code
- `POST /admin/registration-codes/bulk` - Create bulk codes
- `GET /admin/registration-codes?status={status}&limit={limit}` - List codes
- `GET /admin/registration-codes/stats` - Get statistics
- `PATCH /admin/registration-codes/:code/revoke` - Revoke code
- `DELETE /admin/registration-codes/:code` - Delete code

### Kill-Switch
- `GET /admin/registration/kill-switch` - Get status
- `POST /admin/registration/kill-switch/enable` - Enable
- `POST /admin/registration/kill-switch/disable` - Disable

### User Management
- `PATCH /admin/users/:userId/disable` - Disable user
- `PATCH /admin/users/:userId/enable` - Enable user

### Missing Endpoints (Need to Add)
- `GET /admin/users?search={query}&status={status}&limit={limit}` - List users

---

## Component Architecture

### File Structure
```
dashboard/src/
├── app/
│   └── admin/
│       └── page.tsx                    # Main admin hub (tabbed interface)
├── components/
│   └── admin/
│       ├── RegistrationTab.tsx         # Registration codes + kill-switch
│       ├── UsersTab.tsx                # User management
│       ├── CreateCodeForm.tsx          # Code creation form
│       ├── CodesList.tsx               # Codes table
│       └── UsersList.tsx               # Users table
└── hooks/
    ├── useAdminRegistration.ts         # SWR hooks for codes/kill-switch
    └── useAdminUsers.ts                # SWR hooks for user management
```

### Shared Hooks Pattern
```tsx
// hooks/useAdminRegistration.ts
export function useRegistrationStats() {
  return useSWR('/admin/registration-codes/stats', fetcher);
}

export function useRegistrationCodes(status?: string, limit = 20) {
  return useSWR(
    `/admin/registration-codes?${new URLSearchParams({ status, limit: String(limit) })}`,
    fetcher
  );
}

export function useKillSwitch() {
  const { data, mutate } = useSWR('/admin/registration/kill-switch', fetcher);

  const toggle = async (enable: boolean) => {
    const endpoint = enable ? '/enable' : '/disable';
    await fetcher(`/admin/registration/kill-switch${endpoint}`, { method: 'POST' });
    mutate();
  };

  return { isEnabled: data?.enabled, toggle };
}
```

---

## Key Decisions

### 1. Component Extraction
**Decision:** Start monolithic, extract only if complex.
- Phase 2-3: Keep logic in `page.tsx`
- Phase 4+: Extract if file >800 lines

### 2. Data Fetching
**Decision:** Use SWR with custom hooks.
- Auto-refresh for stats (15s interval)
- Manual refresh for codes/users (after mutations)
- Optimistic UI updates where possible

### 3. Confirmation Modals
**Decision:** Use native `confirm()` for MVP, upgrade to AlertDialog later.
- Faster implementation
- Good enough for admin tools
- Easy to upgrade later

### 4. Code Display
**Decision:** Show codes in table, full code on copy hover.
- Truncate to first 8 chars + "..."
- Copy button reveals full code
- One-time display after creation (modal with big warning)

### 5. User Endpoint
**Decision:** Need to add `GET /admin/users` endpoint.
- Backend doesn't have user listing yet
- Quick to add: Prisma query with filters
- Keep it simple: no pagination for MVP (add if >100 users)

---

## Security Considerations

1. **Admin Guard:** Already handled by `user?.isAdmin` check + redirect
2. **Confirmation Prompts:** All destructive actions require confirmation
3. **Kill-Switch Warning:** Big red warning when enabling
4. **Code Display:** One-time display with explicit "I've copied" button
5. **Audit Logs:** Backend already logs admin actions (keep using)

---

## Testing Checklist

### Registration Tab
- [ ] Kill-switch toggle works
- [ ] Stats update after code creation
- [ ] Single code creation works
- [ ] Bulk code creation works (download CSV)
- [ ] Code copy-to-clipboard works
- [ ] Revoke code works
- [ ] Delete code works
- [ ] Status filter works
- [ ] Created code is displayed once (modal closes after copy)

### Users Tab
- [ ] User list loads
- [ ] Search filters users
- [ ] Status filter works
- [ ] Enable/disable user works
- [ ] User details modal shows correct info
- [ ] Non-admin cannot access (403)

### General
- [ ] Mobile responsive
- [ ] Loading states show correctly
- [ ] Error toasts on API failures
- [ ] Keyboard navigation works
- [ ] Tab switching preserves state

---

## Future Enhancements (Post-MVP)

1. **Code Usage History**
   - Show who used each code (link to user)
   - Usage timestamp

2. **Bulk Actions**
   - Select multiple codes → bulk revoke
   - Select multiple users → bulk disable

3. **Advanced Filters**
   - Date range for code creation
   - "Expires soon" filter

4. **Analytics Dashboard**
   - Registration graph over time
   - Code usage patterns
   - Active users over time

5. **Audit Log Viewer**
   - Show admin actions history
   - Filter by admin, action type, date

---

## Estimated Timeline

- **Phase 1 (Foundation):** 30 min
- **Phase 2 (Kill-Switch + Stats):** 45 min
- **Phase 3 (Code Management):** 90 min
- **Phase 4 (User Management):** 60 min
- **Phase 5 (Polish):** 30 min

**Total:** ~4 hours

**Note:** User management requires adding `GET /admin/users` endpoint first (~15 min backend work).

---

## Implementation Order (Recommended)

1. Run test script to verify backend works
2. Add `GET /admin/users` endpoint to backend
3. Implement Phases 1-2 (Foundation + Kill-Switch)
4. Test kill-switch in production (toggle on/off)
5. Implement Phase 3 (Code Management)
6. Test code creation/revocation
7. Implement Phase 4 (User Management)
8. Test user enable/disable
9. Phase 5 (Polish + final testing)

---

**Status:** Ready for implementation after test script verification ✅
