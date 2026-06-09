import sqlite3
conn = sqlite3.connect('health_connect_export.db')
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cursor.fetchall()]
print(f"Total tables: {len(tables)}")
for t in tables:
    cursor.execute(f"SELECT COUNT(*) FROM [{t}]")
    count = cursor.fetchone()[0]
    cursor.execute(f"PRAGMA table_info([{t}])")
    cols = [r[1] for r in cursor.fetchall()]
    print(f"\n{t} ({count} rows)")
    print(f"  cols: {', '.join(cols)}")
conn.close()
