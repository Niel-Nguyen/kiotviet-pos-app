import sys, os
sys.path.insert(0, r"C:\Users\DELL\.gemini\antigravity\scratch\kiotviet-pos-app\backend")
import database

database.init_db()
conn = database.get_db()
cursor = conn.cursor()

cursor.execute("SELECT * FROM schema_migrations")
print("Migrations applied:")
for r in cursor.fetchall():
    print(" ", dict(r))

cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cursor.fetchall()]
print("Tables in DB:", tables)
assert 'users' in tables
assert 'sessions' in tables
assert 'audit_logs' in tables
assert 'schema_migrations' in tables

cursor.execute("PRAGMA table_info(orders)")
order_cols = [r['name'] for r in cursor.fetchall()]
assert 'user_id' in order_cols
assert 'user_name' in order_cols

cursor.execute("PRAGMA table_info(cash_flow)")
cf_cols = [r['name'] for r in cursor.fetchall()]
assert 'user_id' in cf_cols
assert 'user_name' in cf_cols

cursor.execute("SELECT id, code, user_name FROM cash_flow LIMIT 3")
print("Legacy cash_flow rows updated:")
for r in cursor.fetchall():
    print(" ", dict(r))
    assert r['user_name'] == 'Hệ thống / Dữ liệu cũ'

conn.close()
print("Migration test successfully PASSED!")
