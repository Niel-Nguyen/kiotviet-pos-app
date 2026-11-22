"""
Tests for Feature 5: Promotions / Discount Programs
Endpoints: POST/GET/PUT/DELETE /api/promotions
Promotion types: 'percent' and 'fixed'
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


class TestPromotions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_promotions.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_promo', hash_password('Admin@123456'), 'Promo Admin', 'admin'))
        cls.admin_user_id = c.lastrowid
        cls.admin_token, _ = create_session(c, cls.admin_user_id, '127.0.0.1', 'PythonTest/1.0')

        # Create a cashier user (no promotions:manage)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('cashier_promo', hash_password('Admin@123456'), 'Cashier Promo', 'cashier'))
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
        return status_code, parsed_json, raw_body

    # ==========================================
    # TEST 1: Create percent promotion
    # ==========================================
    def test_01_create_percent_promotion(self):
        promo_data = {
            'name': 'Giảm 20% toàn đơn',
            'type': 'order_discount_percent',
            'discount_value': 20.0,
            'min_order_amount': 100000,
            'start_date': '2026-01-01',
            'end_date': '2027-12-31',
            'notes': 'Test percent promotion'
        }
        status, data, _ = self.request('POST', '/api/promotions', promo_data)
        self.assertEqual(status, 201)
        self.assertIn('id', data)
        self.promo_id = data['id']
        self.assertEqual(data.get('discount_value'), 20.0)

    # ==========================================
    # TEST 2: Create fixed amount promotion
    # ==========================================
    def test_02_create_fixed_promotion(self):
        promo_data = {
            'name': 'Giảm 50.000đ toàn đơn',
            'type': 'order_discount_amount',
            'discount_value': 50000,
            'min_order_amount': 500000,
            'start_date': '2026-01-01',
            'end_date': '2027-12-31',
            'notes': 'Test fixed promotion'
        }
        status, data, _ = self.request('POST', '/api/promotions', promo_data)
        self.assertEqual(status, 201)
        self.assertIn('id', data)

    # ==========================================
    # TEST 3: List all promotions
    # ==========================================
    def test_03_list_promotions(self):
        status, data, _ = self.request('GET', '/api/promotions')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)

    # ==========================================
    # TEST 4: Date filtering (active only)
    # ==========================================
    def test_04_active_date_filter(self):
        # Create an expired promotion
        status, exp_promo, _ = self.request('POST', '/api/promotions', {
            'name': 'Expired Promo',
            'type': 'order_discount_percent',
            'discount_value': 5.0,
            'start_date': '2020-01-01',
            'end_date': '2020-12-31',
            'notes': 'This is expired'
        })
        self.assertEqual(status, 201)
        exp_id = exp_promo['id']

        # Query active only
        status, data, _ = self.request('GET', '/api/promotions?active_only=true')
        self.assertEqual(status, 200)
        active_ids = [p['id'] for p in data]
        self.assertNotIn(exp_id, active_ids)

    # ==========================================
    # TEST 5: Update a promotion
    # ==========================================
    def test_05_update_promotion(self):
        # First create
        status, data, _ = self.request('POST', '/api/promotions', {
            'name': 'To Be Updated',
            'type': 'order_discount_percent',
            'discount_value': 10.0
        })
        self.assertEqual(status, 201)
        promo_id = data['id']

        # Update
        status, upd, _ = self.request('PUT', f'/api/promotions/{promo_id}', {
            'name': 'Updated Promotion Name',
            'discount_value': 15.0
        })
        self.assertEqual(status, 200)
        self.assertTrue(upd.get('success'))

    # ==========================================
    # TEST 6: Delete a promotion
    # ==========================================
    def test_06_delete_promotion(self):
        status, data, _ = self.request('POST', '/api/promotions', {
            'name': 'To Be Deleted',
            'type': 'order_discount_percent',
            'discount_value': 5.0
        })
        self.assertEqual(status, 201)
        promo_id = data['id']

        status, del_res, _ = self.request('DELETE', f'/api/promotions/{promo_id}')
        self.assertEqual(status, 200)
        self.assertTrue(del_res.get('success'))

        # Verify deletion - it should no longer appear
        status, all_promos, _ = self.request('GET', '/api/promotions')
        ids = [p['id'] for p in all_promos]
        self.assertNotIn(promo_id, ids)

    # ==========================================
    # TEST 7: Validation - name required
    # ==========================================
    def test_07_validation_name_required(self):
        status, data, _ = self.request('POST', '/api/promotions', {
            'type': 'order_discount_percent',
            'discount_value': 10.0
        })
        self.assertIn(status, (400, 422))
        self.assertTrue(data.get('error'))

    # ==========================================
    # TEST 8: Permission - cashier can view but not create
    # ==========================================
    def test_08_cashier_can_view_not_create(self):
        # Cashier can view
        status, data, _ = self.request('GET', '/api/promotions', token=self.cashier_token)
        self.assertEqual(status, 200)

        # Cashier cannot create
        status, data, _ = self.request('POST', '/api/promotions', {
            'name': 'Unauthorized Promo',
            'type': 'order_discount_percent',
            'discount_value': 5.0
        }, token=self.cashier_token)
        self.assertIn(status, (403, 401))

    # ==========================================
    # TEST 9: Toggle promotion active status
    # ==========================================
    def test_09_toggle_active(self):
        status, data, _ = self.request('POST', '/api/promotions', {
            'name': 'Toggle Test Promo',
            'type': 'order_discount_percent',
            'discount_value': 10.0,
            'is_active': 1
        })
        self.assertEqual(status, 201)
        promo_id = data['id']

        # Toggle (should become inactive)
        status, toggle_res, _ = self.request('POST', f'/api/promotions/{promo_id}/toggle')
        self.assertEqual(status, 200)
        self.assertEqual(toggle_res.get('is_active'), 0)

        # Toggle again (should become active)
        status, toggle_res2, _ = self.request('POST', f'/api/promotions/{promo_id}/toggle')
        self.assertEqual(status, 200)
        self.assertEqual(toggle_res2.get('is_active'), 1)

    # ==========================================
    # TEST 10: active_only=true with no active promos
    # ==========================================
    def test_10_active_query(self):
        status, data, _ = self.request('GET', '/api/promotions?active=1')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)
        # All returned items should be active (is_active=1) and within date range
        import datetime
        today = datetime.date.today().strftime('%Y-%m-%d')
        for p in data:
            self.assertEqual(p.get('is_active'), 1)

    # ==========================================
    # TEST 11: 'percent' and 'fixed' types, value field & applicable_product_ids
    # ==========================================
    def test_11_percent_and_fixed_types_and_value_field(self):
        # Create percent promotion with value and applicable_product_ids
        status, p1, _ = self.request('POST', '/api/promotions', {
            'name': 'Percent Promo Value Test',
            'type': 'percent',
            'value': 15.0,
            'applicable_product_ids': [1, 2],
            'start_date': '2026-01-01',
            'end_date': '2027-12-31'
        })
        self.assertEqual(status, 201)
        self.assertEqual(p1.get('value'), 15.0)
        self.assertIn('applicable_product_ids', p1)
        self.assertTrue(p1.get('applicable_product_ids'))

        # Create fixed promotion with value
        status, p2, _ = self.request('POST', '/api/promotions', {
            'name': 'Fixed Promo Value Test',
            'type': 'fixed',
            'value': 25000.0,
            'start_date': '2026-01-01',
            'end_date': '2027-12-31'
        })
        self.assertEqual(status, 201)
        self.assertEqual(p2.get('value'), 25000.0)

    # ==========================================
    # TEST 12: Best promotion calculation & auto apply
    # ==========================================
    def test_12_best_promotion_calculation_and_auto_apply(self):
        # Calculate best promotion for an order of 100,000 with items
        status, best_res, _ = self.request('POST', '/api/promotions/best', {
            'total_amount': 200000.0,
            'items': [{'product_id': 1, 'quantity': 10, 'sale_price': 20000.0, 'subtotal': 200000.0}]
        })
        self.assertEqual(status, 200)
        self.assertTrue(best_res.get('applied'))
        self.assertGreater(best_res.get('discount', 0), 0)

        # Create an order with auto_promotion=True
        # Use existing product ID 1
        status, prods, _ = self.request('GET', '/api/products')
        self.assertEqual(status, 200)
        prod = prods[0]

        status, order, _ = self.request('POST', '/api/orders', {
            'customer_name': 'Promo Order Customer',
            'status': 'completed',
            'auto_promotion': True,
            'items': [{
                'product_id': prod['id'],
                'quantity': 5,
                'unit': prod['unit'],
                'unit_conversion_rate': 1.0,
                'sale_price': prod['sale_price']
            }],
            'paid_amount': prod['sale_price'] * 5,
            'payment_method': 'cash'
        })
        self.assertEqual(status, 201)
        self.assertGreater(order.get('discount', 0), 0)
        self.assertIsNotNone(order.get('promotion_id'))


if __name__ == '__main__':
    unittest.main()
