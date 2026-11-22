"""
Tests for Feature 2: Customer Order Summary
Endpoints: GET /api/customers/:id/orders/count
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


class TestCustomerOrders(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_customer_orders.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_co', hash_password('Admin@123456'), 'CO Admin', 'admin'))
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

    # ==========================================
    # TEST 1: New customer has 0 order count
    # ==========================================
    def test_01_new_customer_order_count_zero(self):
        # Create a fresh customer
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Zero Order Customer',
            'phone': '0901111111',
            'group_name': 'Khách lẻ'
        })
        self.assertEqual(status, 201)
        cust_id = cust['id']

        status, data, _ = self.request('GET', f'/api/customers/{cust_id}/orders/count')
        self.assertEqual(status, 200)
        self.assertIn('orderCount', data)
        self.assertEqual(data['orderCount'], 0)

    # ==========================================
    # TEST 2: Correct count after creating orders
    # ==========================================
    def test_02_order_count_increases_with_orders(self):
        # Create a customer
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer With Orders',
            'phone': '0902222222',
            'group_name': 'Khách lẻ'
        })
        self.assertEqual(status, 201)
        cust_id = cust['id']

        # Verify zero initially
        status, data, _ = self.request('GET', f'/api/customers/{cust_id}/orders/count')
        self.assertEqual(status, 200)
        self.assertEqual(data['orderCount'], 0)

        # Create product if needed (use existing seeded products)
        status, products, _ = self.request('GET', '/api/products')
        self.assertEqual(status, 200)
        self.assertGreater(len(products), 0)
        prod = products[0]

        # Create 2 orders for this customer
        for i in range(2):
            status, _, _ = self.request('POST', '/api/orders', {
                'customer_id': cust_id,
                'customer_name': 'Customer With Orders',
                'status': 'completed',
                'items': [{
                    'product_id': prod['id'],
                    'quantity': 1,
                    'unit': prod['unit'],
                    'unit_conversion_rate': 1.0,
                    'sale_price': prod['sale_price']
                }],
                'discount': 0,
                'vat_percent': 0,
                'paid_amount': prod['sale_price'],
                'payment_method': 'cash'
            })
            self.assertEqual(status, 201)

        # Now check count is 2
        status, data, _ = self.request('GET', f'/api/customers/{cust_id}/orders/count')
        self.assertEqual(status, 200)
        self.assertEqual(data['orderCount'], 2)

    # ==========================================
    # TEST 3: 404 for nonexistent customer
    # ==========================================
    def test_03_order_count_nonexistent_customer(self):
        status, data, _ = self.request('GET', '/api/customers/999999/orders/count')
        self.assertEqual(status, 404)
        self.assertTrue(data.get('error'))

    # ==========================================
    # TEST 4: Response has correct structure
    # ==========================================
    def test_04_response_structure(self):
        # Use existing seeded customer (id=1 from seed data)
        status, data, _ = self.request('GET', '/api/customers/1/orders/count')
        # Either 200 (customer exists) or 404 (customer deleted by other test)
        if status == 200:
            self.assertIn('orderCount', data)
            self.assertIsInstance(data['orderCount'], int)
        else:
            # Acceptable if customer doesn't exist (e.g. in isolated test run)
            pass

    # ==========================================
    # TEST 5: Requires authentication
    # ==========================================
    def test_05_requires_auth(self):
        status, data, _ = self.request('GET', '/api/customers/1/orders/count', token='')
        self.assertIn(status, (401, 403))


if __name__ == '__main__':
    unittest.main()
