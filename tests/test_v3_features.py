"""
Automated Test Suite for KiotPro v3 Features:
1. Multi-tier packaging unit conversion & breakdown (e.g. 10 Thùng 3 Lốc 5 Lon)
2. POS sales with selected unit conversion & inventory deduction
3. Pre-orders ('ordered') & Customer pending orders count and amount
4. Order adjustment (PUT), cancellation with rollback (DELETE), and clone (POST /clone)
5. Promotion CRUD, active toggle, and discount calculation
6. Server-side zero-dependency Excel (.xlsx) file generation & export endpoint
"""

import unittest
import tempfile
import os
import json
import zipfile
import io
import sys
import base64

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))

import database
import auth
import server
from database import format_stock_breakdown
from auth import hash_password, create_session
from export_xlsx import create_xlsx


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


class TestV3Features(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_kiotviet_v3.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        # Initialize fresh DB
        database.init_db()

        # Seed initial admin user
        conn = database.get_db()
        c = conn.cursor()
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_v3', hash_password('Admin@123456'), 'V3 Admin', 'admin'))
        cls.admin_user_id = c.lastrowid
        cls.admin_token, _ = create_session(c, cls.admin_user_id, '127.0.0.1', 'PythonTest/1.0')
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        import shutil
        try:
            shutil.rmtree(cls.temp_dir, ignore_errors=True)
        except Exception:
            pass

    def request(self, method, path, data=None, token=None):
        headers = {}
        use_token = token if token is not None else self.admin_token
        if use_token:
            headers['Authorization'] = f"Bearer {use_token}"
        status_code, resp_headers, parsed_json, raw_body = execute_http_request(method, path, headers=headers, body=data)
        return status_code, parsed_json, raw_body

    # ==========================================
    # TEST 1: Stock breakdown helper
    # ==========================================
    def test_01_stock_breakdown_calculation(self):
        units = [
            {'unit_name': 'Lon', 'conversion_rate': 1.0, 'is_base': 1},
            {'unit_name': 'Lốc', 'conversion_rate': 6.0, 'is_base': 0},
            {'unit_name': 'Thùng', 'conversion_rate': 36.0, 'is_base': 0}
        ]
        # 383 base units:
        # 383 // 36 = 10 Thùng (leaves 23)
        # 23 // 6 = 3 Lốc (leaves 5)
        # 5 Lon
        res = format_stock_breakdown(383, units)
        self.assertEqual(res, "10 Thùng 3 Lốc 5 Lon")

        # Exact multiple
        res_exact = format_stock_breakdown(72, units)
        self.assertEqual(res_exact, "2 Thùng")

        # Zero stock
        res_zero = format_stock_breakdown(0, units)
        self.assertEqual(res_zero, "0 Lon")

        # Decimal support
        res_dec = format_stock_breakdown(36.5, units)
        self.assertEqual(res_dec, "1 Thùng 0.5 Lon")

    # ==========================================
    # TEST 2: Product Creation with Multi-units
    # ==========================================
    def test_02_product_create_and_units_query(self):
        new_prod = {
            'code': 'SP_BIA01',
            'barcode': '893500112233',
            'name': 'Bia Heineken Sleek Lon 330ml',
            'category': 'Đồ uống có cồn',
            'unit': 'Lon',
            'cost_price': 15000,
            'sale_price': 22000,
            'stock': 125,
            'min_stock': 10,
            'units': [
                {'unit_name': 'Lon', 'conversion_rate': 1.0, 'is_base': 1, 'sale_price': 22000},
                {'unit_name': 'Thùng', 'conversion_rate': 24.0, 'is_base': 0, 'sale_price': 510000}
            ]
        }
        status, data, _ = self.request('POST', '/api/products', new_prod)
        self.assertEqual(status, 201)
        prod_id = data['id']

        # Query products
        status, products, _ = self.request('GET', '/api/products')
        self.assertEqual(status, 200)
        found = next((p for p in products if p['id'] == prod_id), None)
        self.assertIsNotNone(found)
        self.assertEqual(found['stock'], 125)
        self.assertEqual(found['stock_breakdown'], '5 Thùng 5 Lon')
        self.assertGreaterEqual(len(found['units']), 2)

    # ==========================================
    # TEST 3: POS sale with Unit Conversion
    # ==========================================
    def test_03_pos_sale_with_unit_conversion(self):
        # Pepsi SP0011 has Lon (1), Lốc (6), Thùng (36), initial stock = 383 Lon
        status, products, _ = self.request('GET', '/api/products')
        pepsi = next((p for p in products if p['code'] == 'SP0011'), None)
        self.assertIsNotNone(pepsi)
        initial_stock = pepsi['stock']

        # Sell 2 Lốc of Pepsi (2 * 6 = 12 Lon)
        order_data = {
            'customer_id': 2,
            'customer_name': 'Đại lý Minh Phát',
            'status': 'completed',
            'items': [
                {
                    'product_id': pepsi['id'],
                    'quantity': 2,
                    'unit': 'Lốc',
                    'unit_conversion_rate': 6.0,
                    'sale_price': 58000
                }
            ],
            'discount': 0,
            'vat_percent': 0,
            'paid_amount': 116000,
            'payment_method': 'cash'
        }
        status, res, _ = self.request('POST', '/api/orders', order_data)
        self.assertEqual(status, 201)
        order_id = res['id']

        # Check stock deduction: initial_stock - 12
        status, products_after, _ = self.request('GET', '/api/products')
        pepsi_after = next((p for p in products_after if p['id'] == pepsi['id']), None)
        self.assertEqual(pepsi_after['stock'], initial_stock - 12)

        # Check order detail
        status, order_detail, _ = self.request('GET', f"/api/orders/{order_id}")
        self.assertEqual(status, 200)
        item = order_detail['items'][0]
        self.assertEqual(item['unit'], 'Lốc')
        self.assertEqual(item['unit_conversion_rate'], 6.0)
        self.assertEqual(item['quantity'], 2)

    # ==========================================
    # TEST 4: Pre-orders ('ordered') & Customer pending stats
    # ==========================================
    def test_04_preorder_and_customer_pending_stats(self):
        status, customers_before, _ = self.request('GET', '/api/customers')
        cust3_before = next((c for c in customers_before if c['id'] == 3), None)
        initial_pending_count = cust3_before.get('pending_orders_count', 0)
        initial_pending_amount = cust3_before.get('pending_orders_amount', 0)

        # SP0011 stock before pre-order
        status, prods_before, _ = self.request('GET', '/api/products')
        pepsi_before = next((p for p in prods_before if p['code'] == 'SP0011'), None)
        stock_before = pepsi_before['stock']

        preorder_data = {
            'customer_id': 3,
            'customer_name': 'Siêu thị Mini Mart 24h',
            'status': 'ordered', # Pre-order!
            'items': [
                {
                    'product_id': pepsi_before['id'],
                    'quantity': 3,
                    'unit': 'Thùng',
                    'unit_conversion_rate': 36.0,
                    'sale_price': 330000
                }
            ],
            'discount': 0,
            'vat_percent': 0,
            'paid_amount': 0,
            'payment_method': 'debt',
            'notes': 'Khách hẹn giao sáng mai'
        }
        status, pre_res, _ = self.request('POST', '/api/orders', preorder_data)
        self.assertEqual(status, 201)
        preorder_id = pre_res['id']

        # Stock should NOT be deducted yet!
        status, prods_after, _ = self.request('GET', '/api/products')
        pepsi_after = next((p for p in prods_after if p['id'] == pepsi_before['id']), None)
        self.assertEqual(pepsi_after['stock'], stock_before)
        # But ordered_qty should reflect 3 Thùng * 36 = 108 Lon!
        self.assertGreaterEqual(pepsi_after['ordered_qty'], 108)

        # Customer pending orders count and amount should increase
        status, customers_after, _ = self.request('GET', '/api/customers')
        cust3_after = next((c for c in customers_after if c['id'] == 3), None)
        self.assertEqual(cust3_after['pending_orders_count'], initial_pending_count + 1)
        self.assertEqual(cust3_after['pending_orders_amount'], initial_pending_amount + 990000)

        # Transition preorder from 'ordered' -> 'completed' via PUT
        status, update_res, _ = self.request('PUT', f"/api/orders/{preorder_id}", {
            'status': 'completed',
            'notes': 'Đã xuất kho giao cho khách'
        })
        self.assertEqual(status, 200)

        # Now stock must be deducted by 108 Lon!
        status, prods_done, _ = self.request('GET', '/api/products')
        pepsi_done = next((p for p in prods_done if p['id'] == pepsi_before['id']), None)
        self.assertEqual(pepsi_done['stock'], stock_before - 108)

        # Customer pending stats should be reset
        status, cust_done, _ = self.request('GET', '/api/customers')
        cust3_done = next((c for c in cust_done if c['id'] == 3), None)
        self.assertEqual(cust3_done['pending_orders_count'], initial_pending_count)

    # ==========================================
    # TEST 5: Order Clone & Order Cancel with Rollback
    # ==========================================
    def test_05_order_clone_and_cancel_rollback(self):
        # Create completed order
        status, prods, _ = self.request('GET', '/api/products')
        p1 = prods[0]
        initial_stock = p1['stock']

        order_data = {
            'customer_id': 1,
            'customer_name': 'Khách lẻ',
            'status': 'completed',
            'items': [
                {
                    'product_id': p1['id'],
                    'quantity': 5,
                    'unit': p1['unit'],
                    'unit_conversion_rate': 1.0,
                    'sale_price': p1['sale_price']
                }
            ],
            'discount': 0,
            'vat_percent': 0,
            'paid_amount': 5 * p1['sale_price'],
            'payment_method': 'cash'
        }
        status, res, _ = self.request('POST', '/api/orders', order_data)
        self.assertEqual(status, 201)
        order_id = res['id']

        # Verify stock decreased by 5
        status, prods_bought, _ = self.request('GET', '/api/products')
        self.assertEqual(prods_bought[0]['stock'], initial_stock - 5)

        # Test Clone
        status, clone_res, _ = self.request('POST', f"/api/orders/{order_id}/clone")
        self.assertEqual(status, 200)
        self.assertIn('order', clone_res)
        self.assertEqual(len(clone_res['order']['items']), 1)
        self.assertEqual(clone_res['order']['items'][0]['quantity'], 5)

        # Test Cancel (DELETE)
        status, del_res, _ = self.request('DELETE', f"/api/orders/{order_id}")
        self.assertEqual(status, 200)

        # Verify stock is restored!
        status, prods_restored, _ = self.request('GET', '/api/products')
        self.assertEqual(prods_restored[0]['stock'], initial_stock)

        # Verify order status is 'cancelled'
        status, order_detail, _ = self.request('GET', f"/api/orders/{order_id}")
        self.assertEqual(order_detail['status'], 'cancelled')

    # ==========================================
    # TEST 6: Promotion CRUD & Active Toggle
    # ==========================================
    def test_06_promotions_management(self):
        promo_data = {
            'code': 'TEST_GIAM20',
            'name': 'Tri ân khách hàng giảm 20%',
            'type': 'order_discount_percent',
            'discount_value': 20.0,
            'min_order_amount': 200000,
            'notes': 'Áp dụng cho mọi đơn từ 200k'
        }
        status, res, _ = self.request('POST', '/api/promotions', promo_data)
        self.assertEqual(status, 201)
        promo_id = res['id']

        # Query promotions
        status, promos, _ = self.request('GET', '/api/promotions')
        self.assertEqual(status, 200)
        found = next((p for p in promos if p['id'] == promo_id), None)
        self.assertIsNotNone(found)
        self.assertEqual(found['discount_value'], 20.0)
        self.assertEqual(found['is_active'], 1)

        # Toggle inactive
        status, toggle_res, _ = self.request('POST', f"/api/promotions/{promo_id}/toggle")
        self.assertEqual(status, 200)
        self.assertEqual(toggle_res['is_active'], 0)

        # Active-only query should not include it
        status, active_promos, _ = self.request('GET', '/api/promotions?active=true')
        self.assertEqual(status, 200)
        active_found = next((p for p in active_promos if p['id'] == promo_id), None)
        self.assertIsNone(active_found)

        # Toggle back active
        status, toggle_res, _ = self.request('POST', f"/api/promotions/{promo_id}/toggle")
        self.assertEqual(status, 200)
        self.assertEqual(toggle_res['is_active'], 1)

    # ==========================================
    # TEST 7: Excel (.xlsx) Generation & API Endpoint
    # ==========================================
    def test_07_excel_export_endpoint(self):
        payload = {
            'title': 'Báo Cáo Thử Nghiệm',
            'sheet_name': 'TestSheet',
            'filename': 'test_export.xlsx',
            'headers': ['Mã đơn', 'Khách hàng', 'Tổng tiền', 'Trạng thái'],
            'rows': [
                ['HD0001', 'Nguyễn Văn A', 350000, 'Đã hoàn thành'],
                ['HD0002', 'Công ty ABC', 1250000, 'Khách đang đặt'],
                ['HD0003', 'Trần Thị B', 45000, 'Đã hủy']
            ]
        }
        status, _, raw_bytes = self.request('POST', '/api/export/xlsx', payload)
        self.assertEqual(status, 200)
        self.assertTrue(raw_bytes.startswith(b'PK\x03\x04'))

        # Inspect ZIP structure
        with zipfile.ZipFile(io.BytesIO(raw_bytes), 'r') as z:
            names = z.namelist()
            self.assertIn('[Content_Types].xml', names)
            self.assertIn('xl/workbook.xml', names)
            self.assertIn('xl/styles.xml', names)
            self.assertIn('xl/worksheets/sheet1.xml', names)

    # ==========================================
    # TEST 8: Multi-unit Purchases, Base Stock & Weighted Average Cost (MAC)
    # ==========================================
    def test_08_multi_unit_purchase_and_mac(self):
        # 1. Fetch SP0011 (Pepsi)
        status, prods, _ = self.request('GET', '/api/products')
        self.assertEqual(status, 200)
        pepsi = next(p for p in prods if p['code'] == 'SP0011')
        orig_stock = pepsi['stock']
        orig_cost = pepsi['cost_price']

        # 2. Receive 2 Thùng (each Thùng = 36 Lon, price = 324,000đ/thùng -> 9,000đ/lon)
        purchase_payload = {
            'supplier_id': 1,
            'supplier_name': 'Công ty Nước Giải Khát Suntory Pepsico',
            'items': [{
                'product_id': pepsi['id'],
                'unit': 'thùng',
                'unit_conversion_rate': 36.0,
                'quantity': 2,
                'import_price': 324000.0
            }],
            'paid_amount': 648000.0,
            'payment_method': 'bank',
            'notes': 'Nhập 2 thùng Pepsi có tính quy đổi đơn vị'
        }
        status, p_res, _ = self.request('POST', '/api/purchases', purchase_payload)
        self.assertEqual(status, 201)
        p_code = p_res['code']

        # 3. Verify stock increased by 2 * 36 = 72 base units
        status, prods, _ = self.request('GET', '/api/products')
        self.assertEqual(status, 200)
        updated_pepsi = next(p for p in prods if p['code'] == 'SP0011')
        expected_stock = orig_stock + 72
        self.assertEqual(updated_pepsi['stock'], expected_stock)

        # 4. Verify MAC cost price calculation
        expected_cost = round(((orig_stock * orig_cost) + (72 * 9000.0)) / expected_stock, 2)
        self.assertAlmostEqual(updated_pepsi['cost_price'], expected_cost, places=1)

        # 5. Verify GET /api/purchases/{id} returns voucher details and unit
        status, p_detail, _ = self.request('GET', f"/api/purchases/{p_res['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(p_detail['code'], p_code)
        self.assertEqual(len(p_detail['items']), 1)
        self.assertEqual(p_detail['items'][0]['unit'], 'thùng')
        self.assertEqual(p_detail['items'][0]['quantity'], 2.0)

        # 6. Verify audit timeline for purchase
        status, tl, _ = self.request('GET', f"/api/timeline/purchase/{p_code}")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(tl['timeline']), 1)

    # ==========================================
    # TEST 9: Multi-unit Sales Return & Single Return Detail API
    # ==========================================
    def test_09_multi_unit_return_and_get(self):
        status, prods, _ = self.request('GET', '/api/products')
        pepsi = next(p for p in prods if p['code'] == 'SP0011')
        stock_before = pepsi['stock']

        # Customer returns 1 Lốc (1 Lốc = 6 Lon)
        return_payload = {
            'customer_id': 1,
            'customer_name': 'Khách lẻ',
            'items': [{
                'product_id': pepsi['id'],
                'unit': 'lốc',
                'unit_conversion_rate': 6.0,
                'quantity': 1,
                'return_price': 60000.0
            }],
            'refund_amount': 60000.0,
            'debt_deduct_amount': 0.0,
            'fund_type': 'cash',
            'notes': 'Khách hoàn trả 1 lốc Pepsi'
        }
        status, r_res, _ = self.request('POST', '/api/returns', return_payload)
        self.assertEqual(status, 201)
        r_code = r_res['code']
        r_id = r_res['id']

        # Verify stock increased by 6 base units
        status, prods, _ = self.request('GET', '/api/products')
        updated_pepsi = next(p for p in prods if p['code'] == 'SP0011')
        self.assertEqual(updated_pepsi['stock'], stock_before + 6)

        # Verify GET /api/returns/{id}
        status, ret_detail, _ = self.request('GET', f"/api/returns/{r_id}")
        self.assertEqual(status, 200)
        self.assertEqual(ret_detail['code'], r_code)
        self.assertEqual(ret_detail['items'][0]['unit'], 'lốc')
        self.assertEqual(ret_detail['items'][0]['quantity'], 1.0)

        # Verify audit timeline for return
        status, tl, _ = self.request('GET', f"/api/timeline/return/{r_code}")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(tl['timeline']), 1)

    # ==========================================
    # TEST 10: Supplier, Customer, and Product Full Management (Update & Delete)
    # ==========================================
    def test_10_supplier_customer_product_management(self):
        # 1. Supplier Update & Delete
        supp_data = {
            'code': 'NCC9999',
            'name': 'Nhà Cung Cấp Thử Nghiệm',
            'phone': '0901234567',
            'address': 'Hà Nội',
            'debt': 0,
            'notes': 'Test NCC'
        }
        status, s_res, _ = self.request('POST', '/api/suppliers', supp_data)
        self.assertEqual(status, 201)
        s_id = s_res['id']

        # Update supplier
        status, _, _ = self.request('PUT', f"/api/suppliers/{s_id}", {
            'name': 'Nhà Cung Cấp Thử Nghiệm (Đã Sửa)',
            'phone': '0988776655',
            'address': 'TP.HCM',
            'debt': 0,
            'notes': 'Updated'
        })
        self.assertEqual(status, 200)

        # Delete supplier
        status, _, _ = self.request('DELETE', f"/api/suppliers/{s_id}")
        self.assertEqual(status, 200)
        status, supps, _ = self.request('GET', '/api/suppliers')
        self.assertIsNone(next((s for s in supps if s['id'] == s_id), None))

        # 2. Customer Delete
        cust_data = {
            'code': 'KH9999',
            'name': 'Khách Hàng Thử Nghiệm',
            'phone': '0912345678',
            'email': 'kh_test@example.com',
            'address': 'Đà Nẵng',
            'group_name': 'Khách lẻ',
            'debt': 0,
            'notes': 'Test KH'
        }
        status, c_res, _ = self.request('POST', '/api/customers', cust_data)
        self.assertEqual(status, 201)
        c_id = c_res['id']

        status, _, _ = self.request('DELETE', f"/api/customers/{c_id}")
        self.assertEqual(status, 200)
        status, custs, _ = self.request('GET', '/api/customers')
        self.assertIsNone(next((c for c in custs if c['id'] == c_id), None))

        # 3. Product Delete with Units cleanup
        prod_data = {
            'code': 'SP9999',
            'name': 'Sản Phẩm Thử Nghiệm',
            'unit': 'gói',
            'cost_price': 10000,
            'sale_price': 15000,
            'stock': 100,
            'min_stock': 10,
            'units': [
                {'unit_name': 'thùng', 'conversion_rate': 20.0, 'sale_price': 280000.0, 'cost_price': 190000.0}
            ]
        }
        status, p_res, _ = self.request('POST', '/api/products', prod_data)
        self.assertEqual(status, 201)
        p_id = p_res['id']

        status, _, _ = self.request('DELETE', f"/api/products/{p_id}")
        self.assertEqual(status, 200)
        status, prods, _ = self.request('GET', '/api/products')
        self.assertIsNone(next((p for p in prods if p['id'] == p_id), None))

    # ==========================================
    # TEST 11: Database Backup Download & Safe Restore
    # ==========================================
    def test_11_backup_restore_integrity(self):
        # 1. Download valid backup
        status, _, db_bytes = self.request('GET', '/api/backup/download')
        self.assertEqual(status, 200)
        self.assertTrue(db_bytes.startswith(b"SQLite format 3\x00"))

        # 2. Reject corrupt backup file
        corrupt_b64 = base64.b64encode(b"this is definitely not a sqlite database file").decode('utf-8')
        status, err_res, _ = self.request('POST', '/api/backup/restore', {'database_base64': corrupt_b64})
        self.assertEqual(status, 400)
        self.assertIn('INVALID_SQLITE_FILE', str(err_res))

        # 3. Accept and safely restore valid backup
        valid_b64 = base64.b64encode(db_bytes).decode('utf-8')
        status, restore_res, _ = self.request('POST', '/api/backup/restore', {'database_base64': valid_b64})
        self.assertEqual(status, 200)
        self.assertTrue(restore_res['success'])
        self.assertIn('safety_backup', restore_res)


if __name__ == '__main__':
    unittest.main()
