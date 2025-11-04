# Cache Management - Quick Reference Card

**⚠️ Print this and keep it next to your desk ⚠️**

---

## 🚨 The Golden Rules

1. **NEVER use global mutate with filter functions** → Use Direct Mutate Pattern instead
2. **ALWAYS set `keepPreviousData: false`** for frequently changing data
3. **ALWAYS set `dedupingInterval` ≤ 5000ms** for real-time updates
4. **ALWAYS set `revalidateIfStale: true`** to allow cache updates
5. **ALWAYS pass ALL metadata fields to TokenBadge** (let it decide priority)

---

## ⚡ Quick Fixes

### Problem: Data doesn't refresh after analysis
```typescript
// ❌ DON'T
await globalMutate((key) => key.includes('/wallets/'));

// ✅ DO - Use Direct Mutate Pattern
const mutateRef = useRef(null);
await mutateRef.current();
```

### Problem: Images don't appear or Token metadata not updating
```typescript
// ❌ DON'T - Merge fields yourself
<TokenBadge metadata={{ imageUrl: item.imageUrl || item.onchainImageUrl }} />

// ✅ DO - Pass ALL fields raw, let TokenBadge decide
<TokenBadge metadata={{
  imageUrl: item.imageUrl,
  onchainImageUrl: item.onchainImageUrl,
  name: item.name,
  onchainName: item.onchainName,
  // ... pass all fields
}} />
```

**Why:** TokenBadge is the single source of truth for metadata priority. It knows which field to show first (DexScreener image preferred, onchain fallback).

### Problem: Scope changes show old data
```typescript
// ❌ DON'T
useSWR(key, fetcher, { keepPreviousData: true });

// ✅ DO
useSWR(key, fetcher, { keepPreviousData: false });
```

---

## 📋 SWR Config Template

```typescript
useSWR(key, fetcher, {
  dedupingInterval: 3000,        // ✅ 3 seconds
  keepPreviousData: false,       // ✅ No stale data
  revalidateIfStale: true,       // ✅ Allow updates
  revalidateOnFocus: false,      // ✅ No focus revalidation
  revalidateOnReconnect: false,  // ✅ No reconnect revalidation
  onSuccess: (data) => {
    console.log('[Component] Data received:', data);
  },
});
```

---

## 🔧 Direct Mutate Pattern (Copy-Paste Ready)

### Child Component
```typescript
const ChildComponent = ({ onMutateReady }) => {
  const { data, mutate } = useSWR(key, fetcher);

  useEffect(() => {
    if (onMutateReady) {
      onMutateReady(mutate);
    }
  }, [onMutateReady, mutate]);

  return <div>{data}</div>;
};
```

### Parent Component
```typescript
const ParentComponent = () => {
  const childMutateRef = useRef(null);

  const handleDataUpdate = async () => {
    if (childMutateRef.current) {
      await childMutateRef.current();
    }
  };

  return (
    <ChildComponent
      onMutateReady={(mutate) => { childMutateRef.current = mutate; }}
    />
  );
};
```

---

## 🐛 Debug Checklist

When cache doesn't work:

- [ ] Check console for `[Component] 🔄 Fetching data:` logs
- [ ] Verify `dedupingInterval` ≤ 5000ms
- [ ] Verify `keepPreviousData: false`
- [ ] Verify `revalidateIfStale: true`
- [ ] Check if using global mutate with filter (❌ don't do this)
- [ ] Check if mutate function is registered (`[WalletProfile] 📌 TokenPerformance mutate function registered`)

---

## 📖 Full Documentation

For complete details, see: `documentation/technical/frontend/CACHE_MANAGEMENT.md`

---

**Remember:** Cache issues are subtle. When in doubt, add console logs and check this reference card!
