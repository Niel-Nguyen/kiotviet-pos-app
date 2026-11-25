"""
Tests for Feature 1: Invoice (Order) Management CRUD + Duplicate
Endpoints: GET/PUT/DELETE /api/invoices/:id, POST /api/invoices/:id/duplicate
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


class TestInvoiceCRUD(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_invoice_crud.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_inv', hash_password('Admin@123456'), 'Invoice Admin', 'admin'))
        cls.admin_user_id = c.lastrowid
        cls.admin_token, _ = create_session(c, cls.admin_user_id, '127.0.0.1', 'PythonTest/1.0')

        # Create a cashier user (no invoice:manage)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('cashier_inv', hash_password('Admin@123456'), 'Cashier User', 'cashier'))
        cls.cashier_id = c.lastrowid
        cls.cashier_token, _ = create_session(c, cls.cashier_id, '127.0.0.1', 'PythonTest/1.0')

        conn.commit()

        # Create a sample product
        status, _, inv_prod_resp, _ = execute_http_request('POST', '/api/products', headers={
            'Authorization': f'Bearer {cls.admin_token}',
            'Content-Type': 'application/json',
            'Content-Length': '0'
        }, body={
            'code': 'INV_SP01',
            'name': 'Test Product for Invoice',
            'unit': 'cái',
            'cost_price': 10000,
            'sale_price': 20000,
            'stock': 100,
            'min_stock': 5
        })
        cls.order_product_id = inv_prod_resp.get('id')

        # Create a sample order/invoice
        status, _, order_resp, _ = execute_http_request('POST', '/api/orders', headers={
            'Authorization': f'Bearer {cls.admin_token}',
            'Content-Type': 'application/json',
            'Content-Length': '0'
        }, body={
            'customer_name': 'Test Customer',
            'status': 'completed',
            'items': [{
                'product_id': cls.order_product_id,
                'quantity': 2,
                'unit': 'cái',
                'unit_conversion_rate': 1.0,
                'sale_price': 20000
            }],
            'discount': 0,
            'vat_percent': 0,
            'paid_amount': 40000,
            'payment_method': 'cash'
        })
        cls.order_id = order_resp.get('id', 1)
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
    # TEST 1: GET /api/invoices/:id returns invoice with items
    # ==============================================================
    def test_01_get_invoice_by_id(self):
        status, data, _ = self.request('GET', f'/api/invoices/{self.order_id}')
        self.assertEqual(status, 200)
        # Must return header fields
        self.assertIn('id', data)
        self.assertEqual(data['id'], self.order_id)
        self.assertIn('customer_name', data)
        self.assertIn('status', data)
        self.assertIn('final_amount', data)
        self.assertIn('created_at', data)
        # Must include items
        self.assertIn('items', data)
        self.assertIsInstance(data['items'], list)
        self.assertGreater(len(data['items']), 0)

    # ==============================================================
    # TEST 2: GET /api/invoices/:id - 404 for nonexistent
    # ==============================================================
    def test_02_get_invoice_not_found(self):
        status, data, _ = self.request('GET', '/api/invoices/999999')
        self.assertEqual(status, 404)
        self.assertTrue(data.get('error'))

    # ==============================================================
    # TEST 3: PUT /api/invoices/:id - update notes/customer_name
    # ==============================================================
    def test_03_update_invoice(self):
        status, data, _ = self.request('PUT', f'/api/invoices/{self.order_id}', {
            'notes': 'Updated by test',
            'customer_name': 'Updated Customer',
            'status': 'completed'
        })
        self.assertEqual(status, 200)
        self.assertTrue(data.get('success') or 'id' in data)

        # Verify the update
        status, invoice, _ = self.request('GET', f'/api/invoices/{self.order_id}')
        self.assertEqual(status, 200)
        self.assertEqual(invoice.get('notes'), 'Updated by test')

    # ==============================================================
    # TEST 4: POST /api/invoices/:id/duplicate - clone invoice
    # ==============================================================
    def test_04_duplicate_invoice(self):
        status, data, _ = self.request('POST', f'/api/invoices/{self.order_id}/duplicate')
        self.assertEqual(status, 201)
        # Must return new id
        self.assertIn('id', data)
        new_id = data['id']
        self.assertNotEqual(new_id, self.order_id)

        # Verify the duplicate has items
        status, dup_inv, _ = self.request('GET', f'/api/invoices/{new_id}')
        self.assertEqual(status, 200)
        self.assertIn('items', dup_inv)
        self.assertEqual(len(dup_inv['items']), 1)
        # Status of duplicate should be 'draft' or 'completed' depending on implementation
        self.assertIn(dup_inv.get('status'), ('draft', 'completed', 'ordered'))

    # ==============================================================
    # TEST 5: DELETE /api/invoices/:id - soft-delete or hard-delete
    # ==============================================================
    def test_05_delete_invoice(self):
        # First create a new order to delete
        status, order_resp, _ = self.request('POST', '/api/orders', {
            'customer_name': 'Delete Test Customer',
            'status': 'completed',
            'items': [{
                'product_id': self.order_product_id,
                'quantity': 1,
                'unit': 'cái',
                'unit_conversion_rate': 1.0,
                'sale_price': 20000
            }],
            'discount': 0,
            'vat_percent': 0,
            'paid_amount': 20000,
            'payment_method': 'cash'
        })
        self.assertEqual(status, 201)
        del_id = order_resp.get('id')
        self.assertIsNotNone(del_id)

        # Delete it via invoice endpoint
        status, data, _ = self.request('DELETE', f'/api/invoices/{del_id}')
        self.assertEqual(status, 200)
        self.assertTrue(data.get('success'))

    # ==============================================================
    # TEST 6: Permission - cashier without invoice:manage is blocked
    # ==============================================================
    def test_06_permission_required(self):
        # Cashiers don't have invoice:manage, so PUT/DELETE/duplicate should be 403
        status, data, _ = self.request('DELETE', f'/api/invoices/{self.order_id}', token=self.cashier_token)
        self.assertIn(status, (403, 401))

    # ==============================================================
    # TEST 7: Duplicate of nonexistent invoice returns 404
    # ==============================================================
    def test_07_duplicate_not_found(self):
        status, data, _ = self.request('POST', '/api/invoices/999999/duplicate')
        self.assertEqual(status, 404)
        self.assertTrue(data.get('error'))

    # ==============================================================
    # TEST 8: Totals are correct in GET response
    # ==============================================================
    def test_08_invoice_totals_correct(self):
        status, data, _ = self.request('GET', f'/api/invoices/{self.order_id}')
        self.assertEqual(status, 200)
        # total_amount, net_revenue, final_amount should all be numeric
        self.assertIsInstance(data.get('total_amount'), (int, float))
        self.assertIsInstance(data.get('final_amount'), (int, float))
        self.assertGreater(data.get('final_amount', 0), 0)

    # ==============================================================
    # TEST 9: PUT /api/invoices/:id updates line-items & recalculates totals
    # ==============================================================
    def test_09_update_line_items_recalculates_totals(self):
        # Create an order with 1 item of quantity 2 (subtotal 40000)
        status, order_resp, _ = self.request('POST', '/api/orders', {
            'customer_name': 'Recalc Test Customer',
            'status': 'completed',
            'items': [{
                'product_id': self.order_product_id,
                'quantity': 2,
                'unit': 'cái',
                'unit_conversion_rate': 1.0,
                'sale_price': 20000
            }],
            'discount': 0,
            'vat_percent': 0,
            'paid_amount': 40000,
            'payment_method': 'cash'
        })
        self.assertEqual(status, 201)
        inv_id = order_resp['id']

        # Now update line items to quantity 5, discount 10000, vat 10%
        status, upd_res, _ = self.request('PUT', f'/api/invoices/{inv_id}', {
            'items': [{
                'product_id': self.order_product_id,
                'quantity': 5,
                'unit': 'cái',
                'unit_conversion_rate': 1.0,
                'sale_price': 20000
            }],
            'discount': 10000,
            'vat_percent': 10
        })
        self.assertEqual(status, 200)

        # Verify updated totals via GET
        status, inv, _ = self.request('GET', f'/api/invoices/{inv_id}')
        self.assertEqual(status, 200)
        # total_amount: 5 * 20000 = 100,000
        self.assertEqual(inv['total_amount'], 100000.0)
        # discount: 10,000 -> net_revenue: 90,000
        self.assertEqual(inv['discount'], 10000.0)
        self.assertEqual(inv['net_revenue'], 90000.0)
        # vat_amount: 9,000 -> final_amount: 99,000
        self.assertEqual(inv['vat_amount'], 9000.0)
        self.assertEqual(inv['final_amount'], 99000.0)
        # items updated
        self.assertEqual(len(inv['items']), 1)
        self.assertEqual(inv['items'][0]['quantity'], 5.0)

    # ==============================================================
    # TEST 10: Duplicating and deleting duplicate does NOT corrupt debt
    # ==============================================================
    def test_10_duplicate_and_delete_does_not_corrupt_debt(self):
        # Create a customer with known debt
        conn = database.get_db()
        c = conn.cursor()
        c.execute("INSERT INTO customers (code, name, debt, total_spent) VALUES ('CUST_TEST_DEBT', 'Debt Protection', 300000, 500000)")
        cust_id = c.lastrowid
        conn.commit()
        conn.close()

        # Create an order with debt for this customer
        status, order, _ = self.request('POST', '/api/orders', {
            'customer_id': cust_id,
            'customer_name': 'Debt Protection',
            'status': 'completed',
            'items': [{
                'product_id': self.order_product_id,
                'quantity': 1,
                'unit': 'cái',
                'unit_conversion_rate': 1.0,
                'sale_price': 20000
            }],
            'paid_amount': 0,
            'payment_method': 'debt'
        })
        self.assertEqual(status, 201)

        # Check customer debt after completed order: 300,000 + 20,000 = 320,000
        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT debt, total_spent FROM customers WHERE id = ?", (cust_id,))
        row = c.fetchone()
        self.assertEqual(row['debt'], 320000.0)
        self.assertEqual(row['total_spent'], 520000.0)
        conn.close()

        # Duplicate the invoice -> creates DRAFT invoice
        status, dup, _ = self.request('POST', f'/api/invoices/{order["id"]}/duplicate')
        self.assertEqual(status, 201)
        dup_id = dup['id']

        # Delete the duplicated (draft) invoice
        status, del_res, _ = self.request('DELETE', f'/api/invoices/{dup_id}')
        self.assertEqual(status, 200)

        # Debt and total_spent must remain 320,000 and 520,000!
        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT debt, total_spent FROM customers WHERE id = ?", (cust_id,))
        row_after = c.fetchone()
        self.assertEqual(row_after['debt'], 320000.0)
        self.assertEqual(row_after['total_spent'], 520000.0)
        conn.close()

    # ==============================================================
    # TEST 11: GET /api/orders without query params returns list
    # ==============================================================
    def test_11_get_orders_list_structure(self):
        status, data, _ = self.request('GET', '/api/orders')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, list)

    # ==============================================================
    # TEST 12: GET /api/orders with query params returns dict with total and orders
    # ==============================================================
    def test_12_get_orders_filtered_structure(self):
        status, data, _ = self.request('GET', '/api/orders?period=all&status=all')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)
        self.assertIn('total', data)
        self.assertIn('orders', data)
        self.assertIsInstance(data['orders'], list)

    # ==============================================================
    # TEST 13: GET /api/invoices with query params also returns dict with total and orders
    # ==============================================================
    def test_13_get_invoices_filtered_structure(self):
        status, data, _ = self.request('GET', '/api/invoices?period=all&status=completed')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)
        self.assertIn('total', data)
        self.assertIn('orders', data)
        self.assertIsInstance(data['orders'], list)

    # ==============================================================
    # TEST 14: GET /api/orders?status=draft filters draft invoices correctly
    # ==============================================================
    def test_14_get_orders_draft_status_filter(self):
        status, data, _ = self.request('GET', '/api/orders?status=draft')
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)
        self.assertIn('total', data)
        self.assertIn('orders', data)
        self.assertIsInstance(data['orders'], list)


if __name__ == '__main__':
    unittest.main()
