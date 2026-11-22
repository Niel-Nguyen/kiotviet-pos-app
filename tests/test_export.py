"""
Tests for Feature 3: Excel Export for All Data Tables
Endpoints: GET /api/export/<table>
"""

import unittest
import tempfile
import os
import json
import io
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))

import database
import auth
import server
from auth import hash_password, create_session


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
    headers = headers or {}
    body_bytes = b""
    if body is not None:
        if isinstance(body, (dict, list)):
            body_bytes = json.dumps(body).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        elif isinstance(body, bytes):
            body_bytes = body
        else:
            body_bytes = str(body).encode('utf-8')
        headers['Content-Length'] = str(len(body_bytes))

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
        return 500, {}, {}, b""

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

    return status_code, resp_headers, parsed_json, body_block


class TestExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_export.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_exp', hash_password('Admin@123456'), 'Export Admin', 'admin'))
        cls.admin_user_id = c.lastrowid
        cls.admin_token, _ = create_session(c, cls.admin_user_id, '127.0.0.1', 'PythonTest/1.0')

        # Create a manager user
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('mgr_exp', hash_password('Admin@123456'), 'Export Manager', 'manager'))
        cls.mgr_id = c.lastrowid
        cls.mgr_token, _ = create_session(c, cls.mgr_id, '127.0.0.1', 'PythonTest/1.0')

        # Create a cashier user (no export permission)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('cashier_exp', hash_password('Admin@123456'), 'Cashier User', 'cashier'))
        cls.cashier_id = c.lastrowid
        cls.cashier_token, _ = create_session(c, cls.cashier_id, '127.0.0.1', 'PythonTest/1.0')

        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def request(self, method, path, data=None, token=None):
        headers = {}
        use_token = token if token is not None else self.admin_token
        if use_token:
            headers['Authorization'] = f"Bearer {use_token}"
        status_code, resp_headers, parsed_json, raw_body = execute_http_request(
            method, path, headers=headers, body=data)
        return status_code, resp_headers, parsed_json, raw_body

    # ==========================================
    # TEST 1: Export products - 200, correct MIME, xlsx bytes
    # ==========================================
    def test_01_export_products_success(self):
        status, headers, _, raw = self.request('GET', '/api/export/products')
        self.assertEqual(status, 200)
        # Must be xlsx MIME type
        content_type = headers.get('content-type', '')
        self.assertIn('spreadsheetml', content_type)
        # Must be non-empty valid zip/xlsx (PK magic bytes)
        self.assertTrue(len(raw) > 0)
        self.assertTrue(raw.startswith(b'PK\x03\x04'), f"Response did not start with PK magic: {raw[:10]!r}")

    # ==========================================
    # TEST 2: Export customers
    # ==========================================
    def test_02_export_customers_success(self):
        status, headers, _, raw = self.request('GET', '/api/export/customers')
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b'PK\x03\x04'))

    # ==========================================
    # TEST 3: Export invoices/orders
    # ==========================================
    def test_03_export_invoices_success(self):
        status, headers, _, raw = self.request('GET', '/api/export/invoices')
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b'PK\x03\x04'))

    # ==========================================
    # TEST 4: Export suppliers
    # ==========================================
    def test_04_export_suppliers_success(self):
        status, headers, _, raw = self.request('GET', '/api/export/suppliers')
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b'PK\x03\x04'))

    # ==========================================
    # TEST 5: Invalid table name returns 400
    # ==========================================
    def test_05_invalid_table_name_rejected(self):
        status, _, data, _ = self.request('GET', '/api/export/secret_passwords')
        self.assertIn(status, (400, 404))
        self.assertTrue(data.get('error'))

    # ==========================================
    # TEST 6: SQL injection in table name blocked
    # ==========================================
    def test_06_sql_injection_blocked(self):
        status, _, data, _ = self.request('GET', '/api/export/products%3BDROP%20TABLE%20users')
        self.assertIn(status, (400, 404))

    # ==========================================
    # TEST 7: Xlsx output is a valid zip with xlsx structure
    # ==========================================
    def test_07_xlsx_structure_valid(self):
        status, headers, _, raw = self.request('GET', '/api/export/products')
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(raw), 'r') as z:
            names = z.namelist()
            self.assertIn('[Content_Types].xml', names)
            self.assertIn('xl/workbook.xml', names)
            self.assertIn('xl/worksheets/sheet1.xml', names)

    # ==========================================
    # TEST 8: Content-Disposition header present
    # ==========================================
    def test_08_content_disposition_header(self):
        status, headers, _, raw = self.request('GET', '/api/export/products')
        self.assertEqual(status, 200)
        content_disp = headers.get('content-disposition', '')
        self.assertIn('attachment', content_disp)
        self.assertIn('.xlsx', content_disp)

    # ==========================================
    # TEST 9: Manager can also export
    # ==========================================
    def test_09_manager_can_export(self):
        status, headers, _, raw = self.request('GET', '/api/export/products', token=self.mgr_token)
        self.assertEqual(status, 200)
        self.assertTrue(raw.startswith(b'PK\x03\x04'))

    # ==========================================
    # TEST 10: Requires authentication
    # ==========================================
    def test_10_requires_auth(self):
        status, _, data, _ = self.request('GET', '/api/export/products', token='')
        self.assertIn(status, (401, 403))


if __name__ == '__main__':
    unittest.main()
