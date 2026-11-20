"""
Comprehensive Automated Test Suite for KiotPro:
Authentication, Role-Based Access Control (RBAC), Session Invalidation,
Database Migrations, and Atomic Audit Trails.
"""

import sys
import os
import json
import io
import datetime
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))
import database
import auth
import server

class MockSocket:
    def __init__(self, data=b""):
        self.rfile = io.BytesIO(data)
        self.output_buffer = io.BytesIO()

    def makefile(self, mode, *args, **kwargs):
        if 'r' in mode:
            return self.rfile
        return self.output_buffer

    def sendall(self, data):
        self.output_buffer.write(data)

    def close(self):
        pass

def execute_http_request(method, path, headers=None, body=None):
    """
    Directly execute an HTTP request through KiotVietHandler using in-memory streams.
    Zero network sockets required - 100% immune to OS loopback sandbox restrictions.
    """
    headers = headers or {}
    body_bytes = b""
    if body is not None:
        if isinstance(body, (dict, list)):
            body_bytes = json.dumps(body).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        elif isinstance(body, str):
            body_bytes = body.encode('utf-8')
        else:
            body_bytes = body
        headers['Content-Length'] = str(len(body_bytes))

    # Construct raw HTTP request with HTTP/1.0 to disable keep-alive loop
    header_lines = [f"{method} {path} HTTP/1.0", "Host: localhost"]
    for k, v in headers.items():
        header_lines.append(f"{k}: {v}")
    raw_req = "\r\n".join(header_lines).encode('utf-8') + b"\r\n\r\n" + body_bytes

    sock = MockSocket(raw_req)

    class FakeServer:
        pass

    try:
        handler = server.KiotVietHandler(sock, ('127.0.0.1', 54321), FakeServer())
    except Exception:
        pass

    response_data = sock.output_buffer.getvalue()
    if not response_data:
        return 500, {}, {}

    parts = response_data.split(b"\r\n\r\n", 1)
    header_block = parts[0].decode('utf-8', errors='ignore')
    body_block = parts[1] if len(parts) > 1 else b""

    lines = header_block.split("\r\n")
    status_line = lines[0]
    status_code = int(status_line.split()[1])

    resp_headers = {}
    for line in lines[1:]:
        if ":" in line:
            hk, hv = line.split(":", 1)
            resp_headers[hk.strip().lower()] = hv.strip()

    parsed_json = {}
    if body_block:
        try:
            parsed_json = json.loads(body_block.decode('utf-8'))
        except Exception:
            parsed_json = {"raw": body_block}

    return status_code, resp_headers, parsed_json

class TestKiotProAuthAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Use dedicated isolated test database to protect production data
        test_db = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'test_kiotviet.db')
        database.DB_FILE = test_db
        server.DB_FILE = test_db
        if os.path.exists(test_db):
            try:
                os.remove(test_db)
            except Exception:
                pass
        database.init_db()

    def setUp(self):
        # Reset users and sessions before running tests
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions")
        cursor.execute("DELETE FROM users")
        cursor.execute("DELETE FROM audit_logs")
        conn.commit()
        conn.close()

    def test_01_bootstrap_and_lockdown(self):
        """Test bootstrap status, initial admin creation, and subsequent lockdown."""
        # Check bootstrap status
        code, _, data = execute_http_request("GET", "/api/auth/bootstrap-status")
        self.assertEqual(code, 200)
        self.assertTrue(data.get("need_bootstrap"))

        # Create initial admin
        code, headers, data = execute_http_request("POST", "/api/auth/bootstrap", body={
            "username": "admin",
            "full_name": "Nguyễn Quản Trị",
            "password": "Password@123"
        })
        self.assertEqual(code, 201)
        self.assertIn("token", data)
        self.assertEqual(data["user"]["role"], "admin")
        admin_token = data["token"]

        # Check bootstrap status again (must be False now)
        code, _, data = execute_http_request("GET", "/api/auth/bootstrap-status")
        self.assertEqual(code, 200)
        self.assertFalse(data.get("need_bootstrap"))

        # Second bootstrap attempt must be REJECTED (403)
        code, _, data = execute_http_request("POST", "/api/auth/bootstrap", body={
            "username": "hacker",
            "full_name": "Intruder",
            "password": "Password@123"
        })
        self.assertEqual(code, 403)

        # Audit log must record BOOTSTRAP_INITIAL_ADMIN
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM audit_logs WHERE action = 'BOOTSTRAP_INITIAL_ADMIN'")
        audit_row = cursor.fetchone()
        self.assertIsNotNone(audit_row)
        self.assertEqual(audit_row['user_name'], "Nguyễn Quản Trị")
        conn.close()

    def test_02_unauthenticated_requests_blocked(self):
        """Unauthenticated requests to business endpoints must return HTTP 401."""
        # Set up admin so bootstrap is closed
        conn = database.get_db()
        cursor = conn.cursor()
        auth.bootstrap_admin(cursor, "admin", "Admin System", "Password@123")
        conn.commit()
        conn.close()

        # Try accessing protected endpoints without token
        code, _, data = execute_http_request("GET", "/api/reports/dashboard")
        self.assertEqual(code, 401)
        self.assertEqual(data.get("code"), "UNAUTHORIZED")

        code, _, data = execute_http_request("POST", "/api/orders", body={"items": []})
        self.assertEqual(code, 401)
        self.assertEqual(data.get("code"), "UNAUTHORIZED")

        code, _, data = execute_http_request("GET", "/api/users")
        self.assertEqual(code, 401)

        code, _, data = execute_http_request("GET", "/api/backup/download")
        self.assertEqual(code, 401)

    def test_03_rbac_permissions_enforced(self):
        """Verify role permissions are strictly enforced on backend (deny by default)."""
        conn = database.get_db()
        cursor = conn.cursor()
        admin_id = auth.bootstrap_admin(cursor, "admin", "Admin User", "Password@123")
        admin_token, _ = auth.create_session(cursor, admin_id)
        conn.commit()
        conn.close()

        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 1. Admin creates a cashier user
        code, _, data = execute_http_request("POST", "/api/users", headers=admin_headers, body={
            "username": "cashier1",
            "full_name": "Lê Thu Ngân",
            "role": "cashier",
            "password": "Password@123"
        })
        self.assertEqual(code, 201)

        # 2. Admin creates a warehouse user
        code, _, data = execute_http_request("POST", "/api/users", headers=admin_headers, body={
            "username": "kho1",
            "full_name": "Trần Thủ Kho",
            "role": "warehouse",
            "password": "Password@123"
        })
        self.assertEqual(code, 201)

        # 3. Cashier logs in
        code, _, data = execute_http_request("POST", "/api/auth/login", body={
            "username": "cashier1",
            "password": "Password@123"
        })
        self.assertEqual(code, 200)
        cashier_token = data["token"]
        cashier_headers = {"Authorization": f"Bearer {cashier_token}"}

        # Cashier CAN view products
        code, _, prods = execute_http_request("GET", "/api/products", headers=cashier_headers)
        self.assertEqual(code, 200)
        # Cashier CANNOT view cost price (must be masked to 0)
        for p in prods:
            self.assertEqual(p.get("cost_price"), 0)

        # Cashier CANNOT call purchase endpoint (403 Forbidden)
        code, _, data = execute_http_request("POST", "/api/purchases", headers=cashier_headers, body={"items": []})
        self.assertEqual(code, 403)
        self.assertEqual(data.get("code"), "FORBIDDEN")

        # Cashier CANNOT view financial dashboard (403 Forbidden)
        code, _, data = execute_http_request("GET", "/api/reports/dashboard", headers=cashier_headers)
        self.assertEqual(code, 403)

        # Cashier CANNOT adjust inventory (403 Forbidden)
        code, _, data = execute_http_request("POST", "/api/inventory/adjust", headers=cashier_headers, body={"product_id": 1, "actual_stock": 100})
        self.assertEqual(code, 403)

        # Cashier CANNOT access user management (403 Forbidden)
        code, _, data = execute_http_request("GET", "/api/users", headers=cashier_headers)
        self.assertEqual(code, 403)

        # 4. Warehouse logs in
        code, _, data = execute_http_request("POST", "/api/auth/login", body={
            "username": "kho1",
            "password": "Password@123"
        })
        self.assertEqual(code, 200)
        warehouse_token = data["token"]
        warehouse_headers = {"Authorization": f"Bearer {warehouse_token}"}

        # Warehouse CAN view cost price
        code, _, prods = execute_http_request("GET", "/api/products", headers=warehouse_headers)
        self.assertEqual(code, 200)
        has_positive_cost = any(p.get("cost_price", 0) > 0 for p in prods)
        self.assertTrue(has_positive_cost)

        # Warehouse CANNOT access cash flow (403 Forbidden)
        code, _, data = execute_http_request("GET", "/api/cash-flow", headers=warehouse_headers)
        self.assertEqual(code, 403)

        # Warehouse CANNOT create sales orders (403 Forbidden)
        code, _, data = execute_http_request("POST", "/api/orders", headers=warehouse_headers, body={"items": []})
        self.assertEqual(code, 403)

    def test_04_business_audit_trail_and_timeline(self):
        """Operations write audit logs in same transaction and show in timeline."""
        conn = database.get_db()
        cursor = conn.cursor()
        admin_id = auth.bootstrap_admin(cursor, "admin", "Admin Audit", "Password@123")
        admin_token, _ = auth.create_session(cursor, admin_id)

        # Create cashier
        cashier_id = cursor.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES ('cashier_pos', ?, 'Thu Ngân POS', 'cashier', 1, '2026-11-21 00:00:00', '2026-11-21 00:00:00')
        """, (auth.hash_password("Password@123"),)).lastrowid
        cashier_token, _ = auth.create_session(cursor, cashier_id)

        # Ensure a product has stock
        cursor.execute("UPDATE products SET stock = 50 WHERE id = 1")
        conn.commit()
        conn.close()

        cashier_headers = {"Authorization": f"Bearer {cashier_token}"}
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Cashier creates sales order
        code, _, order_res = execute_http_request("POST", "/api/orders", headers=cashier_headers, body={
            "customer_id": 2,
            "customer_name": "Đại lý Tạp hóa Mai Linh",
            "items": [{"product_id": 1, "quantity": 2, "sale_price": 10000}],
            "discount": 0,
            "vat_percent": 10,
            "paid_amount": 22000,
            "payment_method": "cash"
        })
        self.assertEqual(code, 201)
        order_code = order_res["code"]

        # Verify audit log entry for this order
        conn = database.get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM audit_logs WHERE entity_code = ? AND action = 'ORDER_CREATE'", (order_code,))
        audit = cursor.fetchone()
        self.assertIsNotNone(audit)
        self.assertEqual(audit['user_name'], "Thu Ngân POS")
        self.assertEqual(audit['entity_type'], "order")
        details = json.loads(audit['details'])
        self.assertEqual(details['customer_name'], "Đại lý Tạp hóa Mai Linh")
        self.assertEqual(details['final_amount'], 22000)

        # Check order record user fields
        cursor.execute("SELECT user_id, user_name FROM orders WHERE code = ?", (order_code,))
        ord_db = cursor.fetchone()
        self.assertEqual(ord_db['user_id'], cashier_id)
        self.assertEqual(ord_db['user_name'], "Thu Ngân POS")
        conn.close()

        # Query timeline for this order
        code, _, timeline_data = execute_http_request("GET", f"/api/timeline/order/{order_code}", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertTrue(len(timeline_data.get("timeline", [])) >= 1)
        first_event = timeline_data["timeline"][0]
        self.assertEqual(first_event["action"], "ORDER_CREATE")
        self.assertEqual(first_event["user_name"], "Thu Ngân POS")

    def test_05_account_lock_instant_session_revocation(self):
        """Locking a user account must immediately terminate sessions and block future calls."""
        conn = database.get_db()
        cursor = conn.cursor()
        admin_id = auth.bootstrap_admin(cursor, "admin", "Admin Boss", "Password@123")
        admin_token, _ = auth.create_session(cursor, admin_id)

        target_id = cursor.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES ('victim', ?, 'Nhân Viên Sắp Khóa', 'cashier', 1, '2026-11-21 00:00:00', '2026-11-21 00:00:00')
        """, (auth.hash_password("Password@123"),)).lastrowid
        victim_token, _ = auth.create_session(cursor, target_id)
        conn.commit()
        conn.close()

        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        victim_headers = {"Authorization": f"Bearer {victim_token}"}

        # Victim can currently make requests
        code, _, _ = execute_http_request("GET", "/api/products", headers=victim_headers)
        self.assertEqual(code, 200)

        # Admin locks victim
        code, _, lock_res = execute_http_request("POST", f"/api/users/{target_id}/lock", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertTrue(lock_res.get("success"))

        # Victim's active session is NOW DEAD (401)
        code, _, _ = execute_http_request("GET", "/api/products", headers=victim_headers)
        self.assertEqual(code, 401)

        # Victim tries to log in again -> 403 ACCOUNT_LOCKED
        code, _, login_res = execute_http_request("POST", "/api/auth/login", body={
            "username": "victim",
            "password": "Password@123"
        })
        self.assertEqual(code, 403)
        self.assertEqual(login_res.get("code"), "ACCOUNT_LOCKED")

    def test_06_audit_logs_immutability(self):
        """Audit logs cannot be updated or deleted via API."""
        conn = database.get_db()
        cursor = conn.cursor()
        admin_id = auth.bootstrap_admin(cursor, "admin", "Admin Master", "Password@123")
        admin_token, _ = auth.create_session(cursor, admin_id)
        conn.commit()
        conn.close()

        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Try to modify audit log
        code, _, _ = execute_http_request("PUT", "/api/audit-logs/1", headers=admin_headers, body={"details": "tampered"})
        self.assertEqual(code, 403)

        # Try to delete audit log
        code, _, _ = execute_http_request("DELETE", "/api/audit-logs/1", headers=admin_headers)
        self.assertEqual(code, 403)

    def test_07_transaction_rollback_on_audit_failure(self):
        """If audit logging fails, the business operation must roll back completely."""
        conn = database.get_db()
        cursor = conn.cursor()
        admin_id = auth.bootstrap_admin(cursor, "admin", "Admin Rollback", "Password@123")
        admin_token, _ = auth.create_session(cursor, admin_id)
        cursor.execute("SELECT COUNT(*) FROM products")
        init_prod_count = cursor.fetchone()[0]
        conn.commit()
        conn.close()

        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Monkeypatch auth.log_audit temporarily to raise an exception
        original_log_audit = auth.log_audit
        def broken_log_audit(*args, **kwargs):
            raise RuntimeError("Mô phỏng lỗi ghi audit log trong transaction!")

        auth.log_audit = broken_log_audit
        try:
            code, _, data = execute_http_request("POST", "/api/products", headers=admin_headers, body={
                "name": "Sản phẩm test rollback",
                "sale_price": 50000,
                "cost_price": 30000,
                "stock": 10
            })
            # Must return 500
            self.assertEqual(code, 500)
            self.assertIn("Mô phỏng lỗi", data.get("message", ""))

            # Verify that database rolled back: product count is unchanged!
            conn = database.get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM products")
            self.assertEqual(cursor.fetchone()[0], init_prod_count)
            conn.close()
        finally:
            auth.log_audit = original_log_audit

    def test_08_sales_return_linked_to_order_timeline(self):
        """Returns linked to original order appear in both return and order audit timeline."""
        conn = database.get_db()
        cursor = conn.cursor()
        admin_id = auth.bootstrap_admin(cursor, "admin", "Admin Timeline", "Password@123")
        admin_token, _ = auth.create_session(cursor, admin_id)
        cursor.execute("UPDATE products SET stock = 100 WHERE id = 1")
        conn.commit()
        conn.close()

        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 1. Create order
        code, _, ord_res = execute_http_request("POST", "/api/orders", headers=admin_headers, body={
            "customer_id": 1,
            "customer_name": "Khách lẻ",
            "items": [{"product_id": 1, "quantity": 5, "sale_price": 10000}],
            "discount": 0,
            "vat_percent": 0,
            "paid_amount": 50000,
            "payment_method": "cash"
        })
        self.assertEqual(code, 201)
        order_id = ord_res["id"]
        order_code = ord_res["code"]

        # 2. Create return referencing this order
        code, _, ret_res = execute_http_request("POST", "/api/returns", headers=admin_headers, body={
            "order_id": order_id,
            "customer_id": 1,
            "customer_name": "Khách lẻ",
            "items": [{"product_id": 1, "quantity": 2, "return_price": 10000}],
            "refund_amount": 20000,
            "debt_deduct_amount": 0,
            "fund_type": "cash",
            "notes": "Khách đổi ý trả lại 2 cái"
        })
        self.assertEqual(code, 201)
        return_code = ret_res["code"]

        # 3. Query timeline of the order
        code, _, timeline = execute_http_request("GET", f"/api/timeline/order/{order_code}", headers=admin_headers)
        self.assertEqual(code, 200)
        actions = [ev["action"] for ev in timeline.get("timeline", [])]
        self.assertIn("ORDER_CREATE", actions)
        self.assertIn("ORDER_RETURN_PROCESSED", actions)

if __name__ == '__main__':
    unittest.main()
