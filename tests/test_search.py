"""
Tests for Feature 4: Rich Search (by Code, Name, or Both)
Endpoints: GET /api/products?search=&searchBy=, GET /api/customers?search=&searchBy=,
           GET /api/suppliers?search=&searchBy=
"""

import unittest
import tempfile
import os
import json
import io
import sys

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


class TestSearch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_search.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_srch', hash_password('Admin@123456'), 'Search Admin', 'admin'))
        cls.admin_user_id = c.lastrowid
        cls.admin_token, _ = create_session(c, cls.admin_user_id, '127.0.0.1', 'PythonTest/1.0')
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
        return status_code, parsed_json, raw_body

    def setUp(self):
        """Create test products and customers with specific codes/names for searching once."""
        if getattr(self.__class__, '_search_seeded', False):
            return
        self.__class__._search_seeded = True
        # Create products with distinct codes/names
        self.request('POST', '/api/products', {
            'code': 'SRCH_CODE001',
            'name': 'Alpha Product NameOnly',
            'unit': 'cái',
            'cost_price': 1000,
            'sale_price': 2000,
            'stock': 10,
            'min_stock': 2
        })
        self.request('POST', '/api/products', {
            'code': 'DISTINCT_002',
            'name': 'Beta Product SRCH_NAME',
            'unit': 'cái',
            'cost_price': 1000,
            'sale_price': 2000,
            'stock': 10,
            'min_stock': 2
        })
        # Create customers
        self.request('POST', '/api/customers', {
            'code': 'CUST_SRCH001',
            'name': 'SearchTest Customer Alpha',
            'phone': '0901111112',
            'group_name': 'Khách lẻ'
        })
        self.request('POST', '/api/customers', {
            'code': 'CUST_OTHER',
            'name': 'NoMatch Customer',
            'phone': '0901111113',
            'group_name': 'Khách lẻ'
        })

    # ==========================================
    # TEST 1: Search by code only returns code matches
    # ==========================================
    def test_01_product_search_by_code(self):
        status, data, _ = self.request('GET', '/api/products?search=SRCH_CODE001&searchBy=code')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        # Should find products with code matching SRCH_CODE001
        codes = [p['code'] for p in data]
        self.assertIn('SRCH_CODE001', codes)
        # Should NOT find DISTINCT_002 (different code, name doesn't match SRCH_CODE001)
        self.assertNotIn('DISTINCT_002', codes)

    # ==========================================
    # TEST 2: Search by name only returns name matches
    # ==========================================
    def test_02_product_search_by_name(self):
        status, data, _ = self.request('GET', '/api/products?search=SRCH_NAME&searchBy=name')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        names = [p['name'] for p in data]
        # Should find products with SRCH_NAME in name
        self.assertTrue(any('SRCH_NAME' in n for n in names))
        # Should NOT return products where only code matches
        # SRCH_CODE001 code doesn't have SRCH_NAME in its name
        for p in data:
            self.assertIn('SRCH_NAME', p['name'])

    # ==========================================
    # TEST 3: Search by both returns union of code and name matches
    # ==========================================
    def test_03_product_search_by_both(self):
        status, data, _ = self.request('GET', '/api/products?search=SRCH&searchBy=both')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        # Should find SRCH_CODE001 (code has SRCH) AND product with SRCH_NAME in name
        codes = [p['code'] for p in data]
        self.assertIn('SRCH_CODE001', codes)
        self.assertIn('DISTINCT_002', codes)  # has SRCH_NAME in name

    # ==========================================
    # TEST 4: Default (no searchBy) works like 'both'
    # ==========================================
    def test_04_product_search_default(self):
        status, data, _ = self.request('GET', '/api/products?search=SRCH')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        codes = [p['code'] for p in data]
        # Should find at least one of the SRCH- prefixed items
        self.assertTrue(any('SRCH' in c or 'SRCH' in p.get('name', '') for c, p in
                            zip(codes, data)))

    # ==========================================
    # TEST 5: Customer search by code
    # ==========================================
    def test_05_customer_search_by_code(self):
        status, data, _ = self.request('GET', '/api/customers?search=CUST_SRCH001&searchBy=code')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        codes = [c['code'] for c in data]
        self.assertIn('CUST_SRCH001', codes)
        self.assertNotIn('CUST_OTHER', codes)

    # ==========================================
    # TEST 6: Customer search by name
    # ==========================================
    def test_06_customer_search_by_name(self):
        status, data, _ = self.request('GET', '/api/customers?search=SearchTest&searchBy=name')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        names = [c['name'] for c in data]
        self.assertTrue(any('SearchTest' in n for n in names))

    # ==========================================
    # TEST 7: Special characters don't break queries
    # ==========================================
    def test_07_special_characters_safe(self):
        # SQL injection attempt via search params should be safe
        status, data, _ = self.request('GET', "/api/products?search='; DROP TABLE products; --&searchBy=both")
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        # DB should still be intact - check normal products still returned
        status2, all_prods, _ = self.request('GET', '/api/products')
        self.assertEqual(status2, 200)
        self.assertGreater(len(all_prods), 0)

    # ==========================================
    # TEST 8: Empty search returns all results
    # ==========================================
    def test_08_empty_search_returns_all(self):
        status, data, _ = self.request('GET', '/api/products?search=&searchBy=both')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        # Should return all products
        status2, all_prods, _ = self.request('GET', '/api/products')
        self.assertEqual(len(data), len(all_prods))

    # ==========================================
    # TEST 9: Search by code only - no name matches returned
    # ==========================================
    def test_09_code_search_excludes_name_only_matches(self):
        # DISTINCT_002 has SRCH_NAME in name but not in code
        status, data, _ = self.request('GET', '/api/products?search=SRCH_NAME&searchBy=code')
        self.assertEqual(status, 200)
        # Should NOT find DISTINCT_002 since searching by code only
        codes = [p['code'] for p in data]
        self.assertNotIn('DISTINCT_002', codes)

    # ==========================================
    # TEST 10: Supplier search by both
    # ==========================================
    def test_10_supplier_search_by_both(self):
        # Create a supplier for testing
        self.request('POST', '/api/suppliers', {
            'code': 'SUP_SRCH99',
            'name': 'SearchTest Supplier SRCH',
            'phone': '0909090909',
            'notes': 'test supplier'
        })
        status, data, _ = self.request('GET', '/api/suppliers?search=SRCH&searchBy=both')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        codes = [s['code'] for s in data]
        self.assertIn('SUP_SRCH99', codes)


if __name__ == '__main__':
    unittest.main()
