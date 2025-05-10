## This script is used to analyze the storage of the database.
## It uses the dbstat virtual table to get the size of the tables.
## If dbstat is not available, it uses a fallback method to estimate the size of the tables. 
## It also provides a list of potential high storage candidates.

import sqlite3
import os
import sys

# Assuming the script is in the prisma directory with dev.db
DB_PATH: str = "dev.db"

# Schema information for size estimation
# HeliusTransactionCache.rawData is Json
# SwapAnalysisInput has several String and Float fields
TABLE_CONFIG: dict[str, dict] = {
    "HeliusTransactionCache": {
        "json_fields": ["rawData"],
        "fixed_fields_estimate_bytes": 0 # Other fields like signature, timestamp, fetchedAt are considered separately or minor
    },
    "SwapAnalysisInput": {
        "string_fields": ["walletAddress", "signature", "mint", "direction", "interactionType"],
        # id (INT PK ~8), timestamp (INT ~4), amount (FLOAT ~8), associatedSolValue (FLOAT ~8),
        # associatedUsdcValue (FLOAT? ~8), feeAmount (FLOAT? ~8), feePercentage (FLOAT? ~8)
        "fixed_fields_estimate_bytes": 8 + 4 + (8 * 5), # 52 bytes
    }
}


def get_db_file_size(db_path: str) -> float | None:
    """Gets the total size of the database file in MB."""
    try:
        size_bytes: int = os.path.getsize(db_path)
        return size_bytes / (1024 * 1024)
    except OSError as e:
        print(f"Error getting file size for {db_path}: {e}", file=sys.stderr)
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

def analyze_with_dbstat(conn: sqlite3.Connection) -> list[tuple[str, int]] | None:
    """Attempts to analyze database storage using the dbstat virtual table. Returns list of (table_name, size_bytes)."""
    print("\nAttempting analysis with dbstat (more accurate size estimation)...")
    try:
        cursor = conn.cursor()
        query = """
        SELECT
            m.name AS table_name,
            SUM(s.pgsize) AS total_bytes
        FROM sqlite_master m
        JOIN dbstat s ON s.name = m.name
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
        GROUP BY m.name
        ORDER BY total_bytes DESC;
        """
        cursor.execute(query)
        results = cursor.fetchall()
        if not results:
            print("dbstat query returned no results. This might happen on an empty DB or if dbstat has limited info.")
            return None # Fallback will be triggered

        print("\n--- Table Sizes (from dbstat) ---")
        print(f"{'Table Name':<30} | {'Estimated Size':<20}")
        print("-" * 53)
        for table_name, total_bytes in results:
            print(f"{table_name:<30} | {format_bytes(total_bytes):<20}")
        return results # Indicate success by returning data
    except sqlite3.OperationalError as e:
        if "no such table: dbstat" in str(e):
            print("dbstat virtual table not available in this SQLite build.")
        else:
            print(f"An SQL error occurred with dbstat: {e}", file=sys.stderr)
        return None # Fallback will be triggered
    except Exception as e:
        print(f"An unexpected error occurred during dbstat analysis: {e}", file=sys.stderr)
        return None # Fallback will be triggered

def estimate_table_sizes_fallback(conn: sqlite3.Connection) -> list[tuple[str, int, int, str]]:
    """Estimates table sizes by summing column lengths or using row counts."""
    print("\nFallback to analysis by estimating column sizes and row counts...")
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in cursor.fetchall()]
    
    table_details: list[tuple[str, int, int, str]] = [] # name, row_count, estimated_size_bytes, notes

    for table_name in tables:
        try:
            # Get row count
            cursor.execute(f'SELECT COUNT(*) FROM "{table_name}";')
            row_count: int = cursor.fetchone()[0]
            if row_count == 0:
                table_details.append((table_name, 0, 0, "Empty table"))
                continue

            estimated_size_bytes: int = 0
            notes: str = f"{row_count:,} rows"

            if table_name in TABLE_CONFIG:
                config = TABLE_CONFIG[table_name]
                current_table_data_size: int = 0

                # Estimate JSON field sizes
                if "json_fields" in config:
                    for field in config["json_fields"]:
                        # Sum the length of the JSON data stored as text
                        # Ensure column exists before querying
                        cursor.execute(f"PRAGMA table_info('{table_name}');")
                        columns_info = {info[1]: info for info in cursor.fetchall()}
                        if field not in columns_info:
                            print(f"Warning: JSON field '{field}' not found in table '{table_name}'. Skipping its size calculation.", file=sys.stderr)
                            continue
                        
                        json_size_query = f'SELECT SUM(LENGTH(CAST("{field}" AS TEXT))) FROM "{table_name}";'
                        cursor.execute(json_size_query)
                        size_result = cursor.fetchone()
                        if size_result and size_result[0] is not None:
                            current_table_data_size += int(size_result[0])
                            notes += f"; {field} (JSON) total: {format_bytes(int(size_result[0]))}"
                
                # Estimate String field sizes
                if "string_fields" in config:
                    str_fields_query_parts = [f'LENGTH("{field}")' for field in config["string_fields"]]
                    # Validate string fields exist
                    valid_str_fields_query_parts = []
                    cursor.execute(f"PRAGMA table_info('{table_name}');")
                    columns_info = {info[1]: info for info in cursor.fetchall()}
                    for field in config["string_fields"]:
                         if field not in columns_info:
                            print(f"Warning: String field '{field}' not found in table '{table_name}'. Skipping its size calculation.", file=sys.stderr)
                         else:
                            valid_str_fields_query_parts.append(f'LENGTH("{field}")')
                    
                    if valid_str_fields_query_parts:
                        str_size_query = f'SELECT SUM({ " + ".join(valid_str_fields_query_parts) }) FROM "{table_name}";'
                        cursor.execute(str_size_query)
                        size_result = cursor.fetchone()
                        if size_result and size_result[0] is not None:
                            current_table_data_size += int(size_result[0])
                
                # Add fixed field estimates
                if "fixed_fields_estimate_bytes" in config:
                    current_table_data_size += config["fixed_fields_estimate_bytes"] * row_count
                
                estimated_size_bytes = current_table_data_size
            else:
                # For tables not in config, we can't easily estimate size beyond row count.
                # We could try to guess an average row size, but it's very rough.
                # For now, mark size as -1 to indicate it's primarily row count info.
                estimated_size_bytes = -1 # Indicates not directly estimated, rely on row count
                notes += " (size not specifically estimated)"


            table_details.append((table_name, row_count, estimated_size_bytes, notes))

        except sqlite3.Error as e:
            print(f"Error processing table {table_name}: {e}", file=sys.stderr)
            table_details.append((table_name, 0, 0, f"Error: {e}"))

    # Sort by estimated size (descending), putting -1 (not estimated) at the end or sort by row count for them
    table_details.sort(key=lambda x: (x[2] if x[2] != -1 else float('-inf'), x[1] if x[2] == -1 else 0) , reverse=True)
    
    print("\n--- Estimated Table Sizes (Fallback Method) ---")
    print(f"{'Table Name':<30} | {'Est. Size':<15} | {'Row Count':<15} | {'Notes'}")
    print("-" * 100)
    for name, count, est_size, note_text in table_details:
        size_str = format_bytes(est_size) if est_size != -1 else "N/A"
        print(f"{name:<30} | {size_str:<15} | {count:<15,} | {note_text}")
    
    return table_details


def main() -> None:
    """Main function to analyze database storage."""
    if not os.path.exists(DB_PATH):
        print(f"Error: Database file '{DB_PATH}' not found in current directory ({os.getcwd()}).", file=sys.stderr)
        print(f"Please ensure the script is in the same directory as '{DB_PATH}', or update DB_PATH.", file=sys.stderr)
        sys.exit(1)

    db_size_mb: float | None = get_db_file_size(DB_PATH)
    if db_size_mb is not None:
        print(f"Total database file size ('{DB_PATH}'): {db_size_mb:.2f} MB")

    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(DB_PATH)
        
        dbstat_results = analyze_with_dbstat(conn)
        
        if dbstat_results is None: # dbstat failed or not available
            estimate_table_sizes_fallback(conn)

        print("\n--- Potential High Storage Candidates (from schema knowledge) ---")
        if "HeliusTransactionCache" in TABLE_CONFIG:
             print(f"- Table 'HeliusTransactionCache' with its '{TABLE_CONFIG['HeliusTransactionCache']['json_fields'][0]}' Json field is a primary suspect for high storage.")
        if "SwapAnalysisInput" in TABLE_CONFIG:
             print(f"- Table 'SwapAnalysisInput' can also be large due to high row counts and multiple string/float fields.")
        
        print("\nAnalysis complete.")

    except sqlite3.Error as e:
        print(f"SQLite connection error to '{DB_PATH}': {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main() 