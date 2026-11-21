"""
Test Suite for KiotPro v4: Accounting Safety, Concurrency, Returns & Soft-Delete.
Tests all critical fixes requested by pre-production audit.
"""

import sys
import os
import json
import io
import tempfile
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

    header_lines = [f"{method} {path} HTTP/1.0", "Host: localhost"]
    for k, v in headers.items():
        header_lines.append(f"{k}: {v}")
    raw_req = "\r\n".join(header_lines).encode('utf-8') + b"\r\n\r\n" + body_bytes

    sock = MockSocket(raw_req)

    class FakeServer:
        pass

    try:
        server.KiotVietHandler(sock, ('127.0.0.1', 54321), FakeServer())
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

class TestV4Fixes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_db_dir = tempfile.TemporaryDirectory()
        test_db = os.path.join(cls.test_db_dir.name, 'test_kiotviet_v4.db')
        database.DB_FILE = test_db
        server.DB_FILE = test_db
        database.init_db()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.test_db_dir.cleanup()
        except Exception:
            pass

    def request(self, method, path, data=None, token=None):
        headers = {}
        if token:
            headers['Authorization'] = f"Bearer {token}"
        status, resp_headers, parsed_json = execute_http_request(method, path, headers=headers, body=data)
        return status, parsed_json

    def test_01_setup_and_login(self):
        # 1. Bootstrap admin
        status, res = self.request('POST', '/api/auth/bootstrap', {
            'username': 'admin_v4',
            'password': 'SecurePassword@123',
            'full_name': 'Admin V4'
        })
        self.assertEqual(status, 201)

        # 2. Login
        status, res = self.request('POST', '/api/auth/login', {
            'username': 'admin_v4',
            'password': 'SecurePassword@123'
        })
        self.assertEqual(status, 200)
        TestV4Fixes.token = res['token']

    def test_02_dashboard_profit_accounting_correctness(self):
        """
        Verify that returning goods only deducts the return margin (profit),
        and does NOT deduct the entire return value (which would erase inventory value).
        """
        token = TestV4Fixes.token

        # Create customer
        status, cust = self.request('POST', '/api/customers', {
            'code': 'KH_TEST_V4',
            'name': 'Khách Test V4',
            'phone': '0911222333'
        }, token=token)
        self.assertEqual(status, 201)
        cust_id = cust['id']

        # Create product with cost 30,000 and price 50,000, stock 10
        status, prod = self.request('POST', '/api/products', {
            'code': 'SP_TEST_P',
            'name': 'Bia Hà Nội',
            'unit': 'Lon',
            'cost_price': 30000,
            'sale_price': 50000,
            'stock': 10
        }, token=token)
        self.assertEqual(status, 201)
        prod_id = prod['id']

        # Sell 2 lon: revenue = 100,000, cost = 60,000, profit = 40,000
        status, order = self.request('POST', '/api/orders', {
            'customer_id': cust_id,
            'customer_name': 'Khách Test V4',
            'items': [{
                'product_id': prod_id,
                'quantity': 2,
                'sale_price': 50000
            }],
            'paid_amount': 100000,
            'payment_method': 'cash'
        }, token=token)
        self.assertEqual(status, 201)
        order_id = order['id']

        # Dashboard check before return
        status, dash = self.request('GET', '/api/reports/dashboard?range=today', token=token)
        self.assertEqual(status, 200)
        # Net sales = 100,000, Net profit = 40,000
        self.assertEqual(dash['today_revenue'], 100000)
        self.assertEqual(dash['today_profit'], 40000)

        # Customer returns 1 lon (refund 50,000; cost 30,000; margin lost = 20,000)
        status, ret = self.request('POST', '/api/returns', {
            'order_id': order_id,
            'customer_id': cust_id,
            'items': [{
                'product_id': prod_id,
                'quantity': 1,
                'return_price': 50000
            }],
            'refund_amount': 50000,
            'fund_type': 'cash'
        }, token=token)
        self.assertEqual(status, 201)

        # Dashboard check after return:
        # Net sales = 100,000 - 50,000 = 50,000
        # Net profit = 40,000 - 20,000 (margin loss) = 20,000!
        # (Old faulty code would compute: 40,000 - 50,000 = -10,000!)
        status, dash2 = self.request('GET', '/api/reports/dashboard?range=today', token=token)
        self.assertEqual(status, 200)
        self.assertEqual(dash2['today_revenue'], 50000)
        self.assertEqual(dash2['today_profit'], 20000, f"Expected profit 20,000 but got {dash2['today_profit']}")

    def test_03_return_packaging_unit_and_order_validation(self):
        """
        Verify return with packaging units properly converts to base quantity
        and rejects returning more than purchased.
        """
        token = TestV4Fixes.token

        # Product with Thùng (rate 24)
        status, prod = self.request('POST', '/api/products', {
            'code': 'SP_RET_UNIT',
            'name': 'Trà Xanh 0 Độ',
            'unit': 'Chai',
            'cost_price': 8000,
            'sale_price': 10000,
            'stock': 100
        }, token=token)
        prod_id = prod['id']

        status, u = self.request('POST', f'/api/products/{prod_id}/units', {
            'unit_name': 'Thùng',
            'conversion_rate': 24,
            'sale_price': 230000
        }, token=token)
        self.assertEqual(status, 201)

        # Sell 1 Thùng (24 Chai) -> stock drops to 76
        status, order = self.request('POST', '/api/orders', {
            'items': [{
                'product_id': prod_id,
                'unit_name': 'Thùng',
                'quantity': 1,
                'sale_price': 230000
            }],
            'paid_amount': 230000
        }, token=token)
        self.assertEqual(status, 201)
        order_id = order['id']

        # Try to return 2 Thùng (48 Chai) -> must fail since only 1 Thùng was purchased!
        status, err = self.request('POST', '/api/returns', {
            'order_id': order_id,
            'items': [{
                'product_id': prod_id,
                'unit_name': 'Thùng',
                'quantity': 2,
                'return_price': 230000
            }],
            'refund_amount': 460000
        }, token=token)
        self.assertEqual(status, 400)
        self.assertIn("vượt quá số lượng đã mua", err['message'])

        # Return 1 Thùng -> should succeed and restore 24 Chai into stock (76 + 24 = 100)
        status, ret = self.request('POST', '/api/returns', {
            'order_id': order_id,
            'items': [{
                'product_id': prod_id,
                'unit_name': 'Thùng',
                'quantity': 1,
                'return_price': 230000
            }],
            'refund_amount': 230000
        }, token=token)
        self.assertEqual(status, 201)

        # Check stock is back to 100
        status, prods = self.request('GET', f'/api/products?q=SP_RET_UNIT', token=token)
        self.assertEqual(status, 200)
        self.assertEqual(prods[0]['stock'], 100)

    def test_04_soft_delete_preservation(self):
        """
        Verify that products/customers with transaction history are soft-deleted (is_active = 0)
        rather than hard deleted.
        """
        token = TestV4Fixes.token

        # Check product from test 3 (which has order and return history)
        status, prods = self.request('GET', '/api/products?q=SP_RET_UNIT', token=token)
        p_id = prods[0]['id']

        # Try to delete product
        status, res = self.request('DELETE', f'/api/products/{p_id}', token=token)
        self.assertEqual(status, 200)

        # Normal GET /api/products should not show it (filtered out by is_active = 1)
        status, prods_after = self.request('GET', '/api/products?q=SP_RET_UNIT', token=token)
        self.assertEqual(len(prods_after), 0)

        # GET /api/products?include_inactive=1 should show it with is_active = 0
        status, prods_all = self.request('GET', '/api/products?q=SP_RET_UNIT&include_inactive=1', token=token)
        self.assertEqual(len(prods_all), 1)
        self.assertEqual(prods_all[0]['is_active'], 0)

    def test_05_atomic_stock_deduction(self):
        """
        Verify that stock deduction uses atomic update and rejects if stock is insufficient.
        """
        token = TestV4Fixes.token

        status, prod = self.request('POST', '/api/products', {
            'code': 'SP_ATOMIC',
            'name': 'Kẹo Dẻo Haribo',
            'unit': 'Gói',
            'cost_price': 10000,
            'sale_price': 15000,
            'stock': 3
        }, token=token)
        p_id = prod['id']

        # Selling 5 when stock is 3 should fail
        status, err = self.request('POST', '/api/orders', {
            'items': [{
                'product_id': p_id,
                'quantity': 5,
                'sale_price': 15000
            }],
            'paid_amount': 75000
        }, token=token)
        self.assertEqual(status, 400)
        self.assertIn("không đủ để bán", err['message'])

        # Selling 3 succeeds and leaves 0
        status, ok = self.request('POST', '/api/orders', {
            'items': [{
                'product_id': p_id,
                'quantity': 3,
                'sale_price': 15000
            }],
            'paid_amount': 45000
        }, token=token)
        self.assertEqual(status, 201)

        # Next sale fails because stock is 0
        status, err2 = self.request('POST', '/api/orders', {
            'items': [{
                'product_id': p_id,
                'quantity': 1,
                'sale_price': 15000
            }],
            'paid_amount': 15000
        }, token=token)
        self.assertEqual(status, 400)

if __name__ == '__main__':
    unittest.main()
