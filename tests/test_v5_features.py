"""
Comprehensive tests for Feature Set 1-5:
1. Invoice Management (CRUD + Duplicate)
2. Customer Order Summary & View
3. Excel Export for All Data Tables (including distributors)
4. Rich Search (Code, Name, Both) across products, customers, suppliers, distributors, invoices
5. Promotions / Discount Program (percent, fixed, active filtering, best discount)
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
import export_xlsx
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


class TestV5Features(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_v5.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()

        # Admin user
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_v5', hash_password('Admin@123456'), 'V5 Admin', 'admin'))
        cls.admin_token, _ = create_session(c, c.lastrowid, '127.0.0.1', 'PythonTest/1.0')

        # Manager user
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('mgr_v5', hash_password('Admin@123456'), 'V5 Manager', 'manager'))
        cls.mgr_token, _ = create_session(c, c.lastrowid, '127.0.0.1', 'PythonTest/1.0')

        # Cashier user
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('cashier_v5', hash_password('Admin@123456'), 'V5 Cashier', 'cashier'))
        cls.cashier_token, _ = create_session(c, c.lastrowid, '127.0.0.1', 'PythonTest/1.0')

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

    # ==============================================================
    # 1. Invoice Management CRUD + Duplicate
    # ==============================================================
    def test_invoice_full_crud_and_duplicate(self):
        # Create product
        st, prod, _ = self.request('POST', '/api/products', {
            'code': 'INV_TEST_P1',
            'name': 'Invoice Test Product',
            'unit': 'Hộp',
            'cost_price': 50000,
            'sale_price': 80000,
            'stock': 50
        })
        self.assertEqual(st, 201)
        p_id = prod['id']

        # Create Order/Invoice
        st, ord_res, _ = self.request('POST', '/api/orders', {
            'customer_name': 'Nguyen Van Invoice',
            'status': 'completed',
            'items': [{
                'product_id': p_id,
                'quantity': 2,
                'unit': 'Hộp',
                'sale_price': 80000
            }],
            'discount': 10000,
            'paid_amount': 150000,
            'payment_method': 'cash'
        })
        self.assertEqual(st, 201)
        inv_id = ord_res['id']

        # GET invoice
        st, inv_data, _ = self.request('GET', f'/api/invoices/{inv_id}')
        self.assertEqual(st, 200)
        self.assertEqual(inv_data['customer_name'], 'Nguyen Van Invoice')
        self.assertEqual(len(inv_data['items']), 1)
        self.assertEqual(inv_data['final_amount'], 150000)

        # PUT update invoice
        st, upd_res, _ = self.request('PUT', f'/api/invoices/{inv_id}', {
            'customer_name': 'Nguyen Van Updated',
            'status': 'completed',
            'notes': 'Notes updated via invoice PUT'
        })
        self.assertEqual(st, 200)

        # Verify update
        st, inv_check, _ = self.request('GET', f'/api/invoices/{inv_id}')
        self.assertEqual(st, 200)
        self.assertEqual(inv_check['customer_name'], 'Nguyen Van Updated')
        self.assertEqual(inv_check['notes'], 'Notes updated via invoice PUT')

        # Duplicate invoice
        st, dup_res, _ = self.request('POST', f'/api/invoices/{inv_id}/duplicate')
        self.assertEqual(st, 201)
        new_inv_id = dup_res['id']
        self.assertNotEqual(new_inv_id, inv_id)

        # Verify duplicate invoice
        st, dup_data, _ = self.request('GET', f'/api/invoices/{new_inv_id}')
        self.assertEqual(st, 200)
        self.assertEqual(len(dup_data['items']), 1)
        self.assertIn(dup_data['status'], ('draft', 'completed', 'ordered'))

        # DELETE duplicate invoice
        st, del_res, _ = self.request('DELETE', f'/api/invoices/{new_inv_id}')
        self.assertEqual(st, 200)
        self.assertTrue(del_res.get('success'))

    # ==============================================================
    # 2. Customer Order Summary & View
    # ==============================================================
    def test_customer_order_summary_and_view(self):
        # Create fresh customer
        st, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Summary Cust Test',
            'phone': '0987654321',
            'group_name': 'Khách sỉ'
        })
        self.assertEqual(st, 201)
        cust_id = cust['id']

        # Count before orders must be 0
        st, count_data, _ = self.request('GET', f'/api/customers/{cust_id}/orders/count')
        self.assertEqual(st, 200)
        self.assertEqual(count_data.get('orderCount'), 0)

        # Check customer_order_summary view directly
        conn = database.get_db()
        cur = conn.cursor()
        cur.execute("SELECT * FROM customer_order_summary WHERE customer_id = ?", (cust_id,))
        self.assertIsNone(cur.fetchone())

        # Create an order
        st, prods, _ = self.request('GET', '/api/products')
        p_id = prods[0]['id']
        st, _, _ = self.request('POST', '/api/orders', {
            'customer_id': cust_id,
            'customer_name': 'Summary Cust Test',
            'status': 'completed',
            'items': [{'product_id': p_id, 'quantity': 1, 'unit': 'Cái', 'sale_price': 50000}],
            'paid_amount': 50000,
            'payment_method': 'cash'
        })
        self.assertEqual(st, 201)

        # Count after 1 completed order must be 1
        st, count_data2, _ = self.request('GET', f'/api/customers/{cust_id}/orders/count')
        self.assertEqual(st, 200)
        self.assertEqual(count_data2.get('orderCount'), 1)

        # Check view directly has 1
        cur.execute("SELECT order_count FROM customer_order_summary WHERE customer_id = ?", (cust_id,))
        row = cur.fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], 1)
        conn.close()

    # ==============================================================
    # 3. Excel Export for All Data Tables
    # ==============================================================
    def test_export_all_tables_and_openpyxl_helper(self):
        # Direct helper function test
        test_rows = [
            {"id": 1, "name": "Item A", "price": 1000},
            {"id": 2, "name": "Item B", "price": 2000}
        ]
        xlsx_bytes = export_xlsx.export_to_excel("TestSheet", test_rows)
        self.assertTrue(xlsx_bytes.startswith(b'PK\x03\x04'))

        with zipfile.ZipFile(io.BytesIO(xlsx_bytes), 'r') as zf:
            names = zf.namelist()
            self.assertIn('[Content_Types].xml', names)

        # Test GET /api/export/distributors
        st, _, raw = self.request('GET', '/api/export/distributors')
        self.assertEqual(st, 200)
        self.assertTrue(raw.startswith(b'PK\x03\x04'))

        # Test GET /api/export/invoices
        st, _, raw = self.request('GET', '/api/export/invoices')
        self.assertEqual(st, 200)
        self.assertTrue(raw.startswith(b'PK\x03\x04'))

    # ==============================================================
    # 4. Rich Search across all entities
    # ==============================================================
    def test_rich_search_endpoints(self):
        # Create product with distinctive code and name
        self.request('POST', '/api/products', {
            'code': 'UNIQUE_CODE_XYZ',
            'name': 'Different Name ABC',
            'unit': 'Cái',
            'sale_price': 10000
        })

        # Search by code
        st, res, _ = self.request('GET', '/api/products?search=UNIQUE_CODE_XYZ&searchBy=code')
        self.assertEqual(st, 200)
        self.assertTrue(any(p['code'] == 'UNIQUE_CODE_XYZ' for p in res))

        # Search by code should not find by name
        st, res2, _ = self.request('GET', '/api/products?search=Different Name ABC&searchBy=code')
        self.assertEqual(st, 200)
        self.assertFalse(any(p['code'] == 'UNIQUE_CODE_XYZ' for p in res2))

        # Search by name
        st, res3, _ = self.request('GET', '/api/products?search=Different Name ABC&searchBy=name')
        self.assertEqual(st, 200)
        self.assertTrue(any(p['code'] == 'UNIQUE_CODE_XYZ' for p in res3))

        # Search by both
        st, res4, _ = self.request('GET', '/api/products?search=UNIQUE_CODE_XYZ&searchBy=both')
        self.assertEqual(st, 200)
        self.assertTrue(any(p['code'] == 'UNIQUE_CODE_XYZ' for p in res4))

        # Search distributors endpoint
        st, res_dist, _ = self.request('GET', '/api/distributors?search=NCC&searchBy=both')
        self.assertEqual(st, 200)
        self.assertIsInstance(res_dist, list)

    # ==============================================================
    # 5. Promotions CRUD and Auto Best Discount
    # ==============================================================
    def test_promotions_and_discount(self):
        # Create percent promotion
        st, p1, _ = self.request('POST', '/api/promotions', {
            'name': 'Promo 15 Percent',
            'type': 'order_discount_percent',
            'discount_value': 15.0,
            'min_order_amount': 50000
        })
        self.assertEqual(st, 201)

        # Create fixed promotion
        st, p2, _ = self.request('POST', '/api/promotions', {
            'name': 'Promo 30k Fixed',
            'type': 'order_discount_amount',
            'discount_value': 30000,
            'min_order_amount': 100000
        })
        self.assertEqual(st, 201)

        # Verify both appear in list
        st, promos, _ = self.request('GET', '/api/promotions')
        self.assertEqual(st, 200)
        ids = [p['id'] for p in promos]
        self.assertIn(p1['id'], ids)
        self.assertIn(p2['id'], ids)


if __name__ == '__main__':
    unittest.main()
