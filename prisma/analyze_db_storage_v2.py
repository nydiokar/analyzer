## This script is used to analyze the storage of the PostgreSQL database.
## It uses PostgreSQL system catalogs and functions to get accurate table sizes.
## It also provides a list of potential high storage candidates.
## Run with: python analyze_db_storage_v2.py

import psycopg2
import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection from environment
DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("Error: DATABASE_URL environment variable not found.", file=sys.stderr)
    sys.exit(1)

# PostgreSQL provides accurate table sizes, so we don't need size estimation configs


def get_db_size(conn) -> float | None:
    """Gets the total size of the PostgreSQL database in MB."""
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT pg_database_size(current_database()) / (1024.0 * 1024.0) as size_mb;")
        result = cursor.fetchone()
        return float(result[0]) if result else None
    except Exception as e:
        print(f"Error getting database size: {e}", file=sys.stderr)
        return None

def format_bytes(size_bytes: int) -> str:
    """Formats byte size into KB, MB, GB."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024**2:
        return f"{size_bytes/1024:.2f} KB"
    elif size_bytes < 1024**3:
        return f"{size_bytes/(1024**2):.2f} MB"
    else:
        return f"{size_bytes/(1024**3):.2f} GB"

def analyze_table_sizes(conn) -> list[tuple[str, int, int]] | None:
    """Analyzes database storage using PostgreSQL system functions. Returns list of (table_name, size_bytes, total_size_bytes)."""
    print("\nAnalyzing table sizes using PostgreSQL system catalogs...")
    try:
        cursor = conn.cursor()

        # First, let's see what schemas and tables exist
        cursor.execute("""
            SELECT schemaname, tablename
            FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY schemaname, tablename;
        """)
        all_tables = cursor.fetchall()
        print(f"Found {len(all_tables)} user tables:")
        for schema, table in all_tables[:10]:  # Show first 10
            print(f"  {schema}.{table}")
        if len(all_tables) > 10:
            print(f"  ... and {len(all_tables) - 10} more")

        # Use pg_class for more reliable size information
        query = """
        SELECT
            n.nspname as schemaname,
            c.relname as tablename,
            pg_table_size(c.oid) as table_size_bytes,
            pg_total_relation_size(c.oid) as total_size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'  -- regular tables
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY total_size_bytes DESC;
        """
        cursor.execute(query)
        results = cursor.fetchall()

        if not results:
            print("No tables found in the database.")
            return None

        print("\n--- Table Sizes (PostgreSQL) ---")
        print(f"{'Schema.Table Name':<40} | {'Table Size':<15} | {'Total Size':<15} | {'Indexes/TOAST'}")
        print("-" * 90)
        formatted_results = []
        for schema, table_name, table_size, total_size in results:
            index_toast_size = total_size - table_size
            full_name = f"{schema}.{table_name}"
            print(f"{full_name:<40} | {format_bytes(table_size):<15} | {format_bytes(total_size):<15} | {format_bytes(index_toast_size)}")
            formatted_results.append((full_name, table_size, total_size))

        return formatted_results
    except Exception as e:
        print(f"An error occurred during PostgreSQL analysis: {e}", file=sys.stderr)
        return None

def analyze_table_details(conn) -> list[tuple[str, int, str]]:
    """Analyzes table details using PostgreSQL system catalogs."""
    print("\nAnalyzing table details using PostgreSQL...")
    cursor = conn.cursor()

    # Get all user tables with their row counts and basic info
    query = """
    SELECT
        n.nspname as table_schema,
        c.relname as table_name,
        c.reltuples::bigint as estimated_count,
        pg_table_size(c.oid) as table_size,
        pg_total_relation_size(c.oid) as total_size
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'  -- regular tables
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY total_size DESC;
    """

    cursor.execute(query)
    results = cursor.fetchall()

    print("\n--- Table Details (PostgreSQL) ---")
    print(f"{'Table Name':<35} | {'Est. Rows':<12} | {'Table Size':<15} | {'Total Size':<15}")
    print("-" * 85)

    table_details = []
    for table_name, schema, row_count, table_size, total_size in results:
        print(f"{table_name:<35} | {row_count:<12,} | {format_bytes(table_size):<15} | {format_bytes(total_size):<15}")
        table_details.append((table_name, row_count, f"Schema: {schema}, Total: {format_bytes(total_size)}"))

    return table_details


def main() -> None:
    """Main function to analyze PostgreSQL database storage."""
    print(f"Connecting to PostgreSQL database...")
    print(f"DATABASE_URL: {DATABASE_URL[:50]}..." if DATABASE_URL else "Not found")

    conn = None
    try:
        conn = psycopg2.connect(DATABASE_URL)

        # Get database size
        db_size_mb = get_db_size(conn)
        if db_size_mb is not None:
            print(f"Total database size: {db_size_mb:.2f} MB")

        # Analyze table sizes using PostgreSQL system catalogs
        table_results = analyze_table_sizes(conn)

        if table_results is None or len(table_results) == 0:
            print("No tables found to analyze.")
            analyze_table_details(conn)

        # Show database statistics
        cursor = conn.cursor()
        print("\n--- Database Statistics ---")

        # Get database info
        cursor.execute("""
            SELECT
                datname as database_name,
                numbackends as active_connections,
                xact_commit + xact_rollback as transactions,
                tup_inserted + tup_updated + tup_deleted as total_operations
            FROM pg_stat_database
            WHERE datname = current_database();
        """)

        db_stats = cursor.fetchone()
        if db_stats:
            db_name, connections, transactions, operations = db_stats
            print(f"Database: {db_name}")
            print(f"Active connections: {connections}")
            print(f"Total transactions: {transactions:,}")
            print(f"Total row operations: {operations:,}")

        print("\n--- Potential High Storage Candidates ---")
        print("- 'SwapAnalysisInput': High row counts with multiple string/float fields")
        print("- 'AnalysisResult': Per-token analysis data across many wallets")
        print("- 'HeliusTransactionCache': Transaction signatures (can be large)")
        print("- 'WalletBehaviorProfile': JSON fields for behavioral analysis")
        print("- 'MappingActivityLog': Detailed logging data")
        print("- 'ActivityLog': User activity tracking")

        print("\nAnalysis complete.")

    except psycopg2.Error as e:
        print(f"PostgreSQL connection error: {e}", file=sys.stderr)
        print("Make sure DATABASE_URL is set and the database is accessible.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main() 