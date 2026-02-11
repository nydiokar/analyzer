# Manual Database Restoration Guide

Run these commands **one at a time** in PowerShell. Test each step before moving to the next.

## Configuration

```powershell
$env:PGPASSWORD = "fc9f381f6fe53fa4abf649760ff0938354f547938b6d8cf766de87ae4ccb23cd"
$DB_NAME = "sova_db"
$DB_USER = "postgres"
$DB_HOST = "localhost"
$DB_PORT = "5433"
$DUMP_FILE = "C:\Users\solastic\prj\analyzer-backup-20260209.dump"
```

## Step 1: Verify Dump File

```powershell
Test-Path $DUMP_FILE
# Should return: True
```

## Step 2: Terminate Connections

```powershell
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"
```

## Step 3: Drop and Recreate Database

```powershell
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;"
```

## Step 4: Restore Dump

```powershell
pg_restore -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME --no-owner --no-acl $DUMP_FILE
```

**Note:** You will see warnings - this is normal. As long as it doesn't error out completely, you're good.

## Step 5: Apply Migrations

```powershell
npx prisma migrate deploy
```

## Step 6: Run Backfill

```powershell
npx ts-node -r tsconfig-paths/register scripts/backfill-production-data.ts
```

## Step 7: Verify Data

```powershell
npx ts-node -r tsconfig-paths/register scripts/verify-restored-data.ts
```

## Cleanup

```powershell
$env:PGPASSWORD = $null
```

---

## If Any Step Fails

- Check the error message
- Make sure PostgreSQL is running on port 5433
- Verify the DATABASE_URL in .env matches the credentials above
- Ensure you have disk space for the 517MB restore
