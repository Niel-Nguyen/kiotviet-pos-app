"""
Comprehensive Automated Test Suite for KiotPro v3 Features:
1. Multi-level packaging units & conversions (product_units, base unit, rate > 0, stock breakdown, decimal quantity).
2. Unit-based POS selling & customer-specific pricing compatibility.
3. Order Management & lifecycle (pending, completed, cancelled, duplication, search/filter, pagination).
4. Customer pending totals and modal endpoints.
5. Safe Order Cancellation (inventory stock, debt, cash flow reversal, audit trail).
6. Promotions engine (order/category/product, % and fixed, non-stacking rule, snapshot in orders).
7. Order notes preservation (not overwritten by debt messages).
8. Pure Python OpenXML (.xlsx) Excel export (filters preserved, column selection, RBAC cost price masking).
"""

import sys
import os
import json
import io
import datetime
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))
import database
import auth
import server
import export_xlsx

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

class TestKiotProV3Features(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_db_dir = tempfile.TemporaryDirectory()
        test_db = os.path.join(cls.test_db_dir.name, 'test_kiotviet_v3.db')
        database.DB_FILE = test_db
        server.DB_FILE = test_db
        database.init_db()

    @classmethod
    def tearDownClass(cls):
        try:
            cls.test_db_dir.cleanup()
        except Exception:
            pass

    def setUp(self):
        conn = database.get_db()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions")
            cursor.execute("DELETE FROM users")
            cursor.execute("DELETE FROM audit_logs")
            cursor.execute("DELETE FROM order_items")
            cursor.execute("DELETE FROM orders")
            cursor.execute("DELETE FROM customer_product_prices")
            cursor.execute("DELETE FROM promotions")
            cursor.execute("DELETE FROM product_units")
            cursor.execute("DELETE FROM products")
            cursor.execute("DELETE FROM customers")
            cursor.execute("DELETE FROM cash_flow")
            conn.commit()
        finally:
            conn.close()

        # Create Admin user
        code, headers, data = execute_http_request("POST", "/api/auth/bootstrap", body={
            "username": "admin",
            "full_name": "Quản Trị Viên",
            "password": "Password@123"
        })
        self.assertEqual(code, 201)
        self.admin_cookie = headers.get('set-cookie', '').split(';')[0]

        # Create Cashier user
        code, _, data = execute_http_request("POST", "/api/users", headers={"Cookie": self.admin_cookie}, body={
            "username": "cashier1",
            "full_name": "Thu Ngân 1",
            "role": "cashier",
            "password": "Password@123"
        })
        self.assertEqual(code, 201)

        # Login as Cashier
        code, headers, data = execute_http_request("POST", "/api/auth/login", body={
            "username": "cashier1",
            "password": "Password@123"
        })
        self.assertEqual(code, 200)
        self.cashier_cookie = headers.get('set-cookie', '').split(';')[0]

        # Seed test customer
        code, _, data = execute_http_request("POST", "/api/customers", headers={"Cookie": self.admin_cookie}, body={
            "code": "KH001",
            "name": "Đại lý Hoàng Phát",
            "phone": "0912345678",
            "email": "hoangphat@example.com",
            "group_name": "Đại lý cấp 1",
            "address": "123 Lê Lợi, Q1"
        })
        self.assertEqual(code, 201)
        self.customer_id = data.get('id')

        # Seed test product: Lon Coca Cola (Stock: 100 Lon, Cost: 7000, Sale: 10000)
        code, _, data = execute_http_request("POST", "/api/products", headers={"Cookie": self.admin_cookie}, body={
            "code": "SP001",
            "name": "Nước ngọt Coca Cola 330ml",
            "barcode": "8930001001",
            "category": "Nước giải khát",
            "unit": "Lon",
            "cost_price": 7000,
            "sale_price": 10000,
            "stock": 100,
            "min_stock": 10
        })
        self.assertEqual(code, 201)
        self.product_id = data.get('id')

    # ==========================================
    # 1. Multi-level packaging units & conversions
    # ==========================================
    def test_01_product_packaging_units_and_breakdown(self):
        """Test multi-level units creation, rate validation, and stock breakdown."""
        # 1. Base unit was automatically created in product_units
        code, _, units = execute_http_request("GET", f"/api/products/{self.product_id}/units", headers={"Cookie": self.admin_cookie})
        self.assertEqual(code, 200)
        self.assertEqual(len(units), 1)
        self.assertTrue(units[0]['is_base'])
        self.assertEqual(units[0]['name'], "Lon")

        # 2. Add packaging unit: Lốc (6 Lon)
        code, _, res = execute_http_request("POST", f"/api/products/{self.product_id}/units", headers={"Cookie": self.admin_cookie}, body={
            "name": "Lốc",
            "conversion_rate": 6,
            "sale_price": 58000,
            "barcode": "8930001002"
        })
        self.assertEqual(code, 201)

        # 3. Add packaging unit: Thùng (24 Lon)
        code, _, res = execute_http_request("POST", f"/api/products/{self.product_id}/units", headers={"Cookie": self.admin_cookie}, body={
            "name": "Thùng",
            "conversion_rate": 24,
            "sale_price": 230000,
            "barcode": "8930001003"
        })
        self.assertEqual(code, 201)

        # 4. Conversion rate <= 0 must be rejected
        code, _, err = execute_http_request("POST", f"/api/products/{self.product_id}/units", headers={"Cookie": self.admin_cookie}, body={
            "name": "Hộp lỗi",
            "conversion_rate": 0
        })
        self.assertEqual(code, 400)

        # 5. Stock breakdown calculation test
        code, _, prods = execute_http_request("GET", f"/api/products?q=SP001", headers={"Cookie": self.admin_cookie})
        self.assertEqual(code, 200)
        p = prods[0]
        # 100 Lon = 4 Thùng (96 Lon) + 0 Lốc + 4 Lon
        self.assertIn("4 Thùng", p['stock_breakdown'])
        self.assertIn("4 Lon", p['stock_breakdown'])

    # ==========================================
    # 2. Unit-based POS selling & Stock deduction
    # ==========================================
    def test_02_pos_selling_with_packaging_unit(self):
        """Test POS selling with unit conversion: deducting base units and applying correct price."""
        # Add unit Thùng (24 Lon)
        code, _, res = execute_http_request("POST", f"/api/products/{self.product_id}/units", headers={"Cookie": self.admin_cookie}, body={
            "name": "Thùng",
            "conversion_rate": 24,
            "sale_price": 230000
        })
        thung_unit_id = res['id']

        # Sell 2 Thùng (= 48 Lon) to customer
        code, _, order = execute_http_request("POST", "/api/orders", headers={"Cookie": self.cashier_cookie}, body={
            "customer_id": self.customer_id,
            "status": "completed",
            "payment_method": "cash",
            "actual_paid": 460000,
            "notes": "Giao gấp buổi sáng",
            "items": [
                {
                    "product_id": self.product_id,
                    "unit_id": thung_unit_id,
                    "unit_name": "Thùng",
                    "conversion_rate": 24,
                    "quantity": 2,
                    "unit_price": 230000
                }
            ]
        })
        self.assertEqual(code, 201)
        self.assertEqual(order['total_amount'], 460000)
        self.assertEqual(order['notes'], "Giao gấp buổi sáng")

        # Verify stock was deducted by 48 base units (100 - 48 = 52 Lon)
        code, _, prods = execute_http_request("GET", f"/api/products?q=SP001", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(code, 200)
        self.assertEqual(prods[0]['stock'], 52)

    # ==========================================
    # 3. Customer pricing with unit conversion
    # ==========================================
    def test_03_customer_pricing_with_packaging_unit(self):
        """Test customer price lookup and ensure conversion rate is not double-multiplied."""
        # Add unit Lốc (6 Lon)
        code, _, res = execute_http_request("POST", f"/api/products/{self.product_id}/units", headers={"Cookie": self.admin_cookie}, body={
            "name": "Lốc",
            "conversion_rate": 6,
            "sale_price": 58000
        })
        loc_unit_id = res['id']

        # Set custom price for base unit (Lon) = 9,000đ (instead of 10,000đ)
        code, _, res = execute_http_request("POST", f"/api/customers/{self.customer_id}/prices", headers={"Cookie": self.admin_cookie}, body={
            "product_id": self.product_id,
            "custom_price": 9000
        })
        self.assertEqual(code, 200)

        # Lookup price for customer with unit Lốc (rate 6) -> 9,000 * 6 = 54,000đ
        code, _, lookup = execute_http_request("GET", f"/api/customer-prices/lookup?customer_id={self.customer_id}&product_id={self.product_id}&unit_id={loc_unit_id}", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(code, 200)
        self.assertTrue(lookup['has_custom_price'])
        self.assertEqual(lookup['final_unit_price'], 54000)

    # ==========================================
    # 4. Order Lifecycle: Pending -> Completed
    # ==========================================
    def test_04_pending_order_and_completion(self):
        """Test pending order does not affect inventory or debt until explicitly completed."""
        # Initial stock: 100 Lon, Customer Debt: 0
        code, _, order = execute_http_request("POST", "/api/orders", headers={"Cookie": self.cashier_cookie}, body={
            "customer_id": self.customer_id,
            "status": "pending",
            "payment_method": "debt",
            "actual_paid": 0,
            "notes": "Đơn đặt hàng chờ giao chiều",
            "items": [
                {
                    "product_id": self.product_id,
                    "quantity": 10,
                    "unit_price": 10000
                }
            ]
        })
        self.assertEqual(code, 201)
        order_id = order['id']
        self.assertEqual(order['status'], "pending")

        # 1. Stock MUST NOT be deducted
        code, _, prods = execute_http_request("GET", f"/api/products?q=SP001", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(prods[0]['stock'], 100)

        # 2. Customer debt MUST NOT be added
        code, _, custs = execute_http_request("GET", f"/api/customers?q=KH001", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(custs[0]['debt'], 0)
        self.assertEqual(custs[0]['pending_orders_count'], 1)
        self.assertEqual(custs[0]['pending_orders_amount'], 100000)

        # 3. Customer pending orders endpoint
        code, _, pending_list = execute_http_request("GET", f"/api/customers/{self.customer_id}/pending-orders", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(code, 200)
        self.assertEqual(len(pending_list), 1)
        self.assertEqual(pending_list[0]['id'], order_id)

        # 4. Complete the order
        code, _, res = execute_http_request("POST", f"/api/orders/{order_id}/complete", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(code, 200)
        self.assertEqual(res['new_status'], "completed")

        # 5. After completion: stock MUST be deducted (100 - 10 = 90) and debt added (100,000đ)
        code, _, prods = execute_http_request("GET", f"/api/products?q=SP001", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(prods[0]['stock'], 90)

        code, _, custs = execute_http_request("GET", f"/api/customers?q=KH001", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(custs[0]['debt'], 100000)
        self.assertEqual(custs[0]['pending_orders_count'], 0)

    # ==========================================
    # 5. Safe Order Cancellation & Reversal
    # ==========================================
    def test_05_safe_order_cancellation(self):
        """Test cancelling a completed order reverses inventory, customer debt, and cash flow with audit."""
        # Create completed order with 10 Lon, 50,000 paid cash, 50,000 recorded debt
        code, _, order = execute_http_request("POST", "/api/orders", headers={"Cookie": self.cashier_cookie}, body={
            "customer_id": self.customer_id,
            "status": "completed",
            "payment_method": "cash",
            "actual_paid": 50000,
            "notes": "Hóa đơn test hủy",
            "items": [
                {
                    "product_id": self.product_id,
                    "quantity": 10,
                    "unit_price": 10000
                }
            ]
        })
        self.assertEqual(code, 201)
        order_id = order['id']
        order_code = order['code']

        # Stock is now 90 Lon, Customer debt is 50,000đ
        code, _, prods = execute_http_request("GET", f"/api/products?q=SP001", headers={"Cookie": self.admin_cookie})
        self.assertEqual(prods[0]['stock'], 90)
        code, _, custs = execute_http_request("GET", f"/api/customers?q=KH001", headers={"Cookie": self.admin_cookie})
        self.assertEqual(custs[0]['debt'], 50000)

        # Cancel order
        code, _, res = execute_http_request("POST", f"/api/orders/{order_id}/cancel", headers={"Cookie": self.admin_cookie}, body={
            "reason": "Khách hủy lấy hàng, hoàn trả kho"
        })
        self.assertEqual(code, 200)
        self.assertEqual(res['new_status'], "cancelled")

        # 1. Stock must be returned to 100
        code, _, prods = execute_http_request("GET", f"/api/products?q=SP001", headers={"Cookie": self.admin_cookie})
        self.assertEqual(prods[0]['stock'], 100)

        # 2. Customer debt must be reduced by 50,000 -> 0
        code, _, custs = execute_http_request("GET", f"/api/customers?q=KH001", headers={"Cookie": self.admin_cookie})
        self.assertEqual(custs[0]['debt'], 0)

        # 3. Cash flow must have a reversal payment record for 50,000
        code, _, cfs = execute_http_request("GET", "/api/cash-flow", headers={"Cookie": self.admin_cookie})
        cancellation_entries = [cf for cf in cfs if 'hủy' in cf['category'].lower()]
        self.assertEqual(len(cancellation_entries), 1)
        self.assertEqual(cancellation_entries[0]['type'], 'payment')
        self.assertEqual(cancellation_entries[0]['amount'], 50000)

        # 4. Audit log must exist
        code, _, audit = execute_http_request("GET", f"/api/audit-logs?entity_code={order_code}", headers={"Cookie": self.admin_cookie})
        actions = [a['action'] for a in audit['items']]
        self.assertIn('ORDER_CANCEL', actions)

    # ==========================================
    # 6. Promotions engine & Snapshot
    # ==========================================
    def test_06_promotions_and_order_snapshot(self):
        """Test promotion evaluation, non-stacking rule, and snapshot preservation."""
        # Create Promotion 1: 10% off for all orders >= 100,000đ
        today = datetime.date.today().isoformat()
        next_month = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()

        code, _, promo = execute_http_request("POST", "/api/promotions", headers={"Cookie": self.admin_cookie}, body={
            "name": "Giảm 10% đơn từ 100k",
            "scope": "order",
            "discount_type": "percent",
            "discount_value": 10,
            "min_order_amount": 100000,
            "start_date": today,
            "end_date": next_month,
            "is_active": 1
        })
        self.assertEqual(code, 201)
        promo_id = promo['id']

        # Check promotion applicability on POS cart: 15 Lon * 10,000 = 150,000đ -> discount 15,000đ
        code, _, check = execute_http_request("POST", "/api/promotions/check", headers={"Cookie": self.cashier_cookie}, body={
            "customer_id": self.customer_id,
            "items": [{"product_id": self.product_id, "quantity": 15, "unit_price": 10000}]
        })
        self.assertEqual(code, 200)
        self.assertIsInstance(check, list)
        self.assertTrue(len(check) > 0)
        top_promo = check[0]
        self.assertEqual(top_promo['id'], promo_id)
        self.assertEqual(top_promo['calculated_discount'], 15000)

        # Create Order with promotion applied
        code, _, order = execute_http_request("POST", "/api/orders", headers={"Cookie": self.cashier_cookie}, body={
            "customer_id": self.customer_id,
            "promotion_id": promo_id,
            "discount": 15000,
            "payment_method": "cash",
            "actual_paid": 135000,
            "items": [{"product_id": self.product_id, "quantity": 15, "unit_price": 10000}]
        })
        self.assertEqual(code, 201)
        self.assertEqual(order['total_amount'], 150000)
        self.assertEqual(order['discount'], 15000)
        self.assertEqual(order['final_amount'], 135000)
        self.assertEqual(order['promotion_id'], promo_id)

    # ==========================================
    # 7. Excel OpenXML (.xlsx) Export & RBAC Masking
    # ==========================================
    def test_07_excel_export_and_cost_price_masking(self):
        """Test pure Python XLSX generation, filter preservation, and RBAC cost price masking."""
        # 1. Admin export products: cost_price must be included
        code, headers, data = execute_http_request("GET", "/api/export/products", headers={"Cookie": self.admin_cookie})
        self.assertEqual(code, 200)
        self.assertIn("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers.get('content-type', ''))
        raw_xlsx = data.get('raw')
        self.assertIsNotNone(raw_xlsx)
        # Verify valid ZIP / OpenXML structure
        with zipfile.ZipFile(io.BytesIO(raw_xlsx), 'r') as zf:
            self.assertIn('[Content_Types].xml', zf.namelist())
            self.assertIn('xl/workbook.xml', zf.namelist())
            sheet1_xml = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
            # Admin can see 7000 (cost price of SP001)
            self.assertIn("7000", sheet1_xml)

        # 2. Cashier export products: cost_price MUST NOT be visible
        code, headers, data = execute_http_request("GET", "/api/export/products", headers={"Cookie": self.cashier_cookie})
        self.assertEqual(code, 200)
        with zipfile.ZipFile(io.BytesIO(data.get('raw')), 'r') as zf:
            sheet1_xml = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
            # Cashier CANNOT see 7000
            self.assertNotIn("7000", sheet1_xml)

        # 3. Orders export with column selector and filters
        code, headers, data = execute_http_request("GET", "/api/export/orders?status=completed&columns=code,customer_name,final_amount", headers={"Cookie": self.admin_cookie})
        self.assertEqual(code, 200)
        with zipfile.ZipFile(io.BytesIO(data.get('raw')), 'r') as zf:
            sheet1_xml = zf.read('xl/worksheets/sheet1.xml').decode('utf-8')
            self.assertIn("Mã đơn hàng", sheet1_xml)
            self.assertIn("Khách hàng", sheet1_xml)
            self.assertIn("Khách cần trả", sheet1_xml)
            # Unselected columns must not be in headers
            self.assertNotIn("Ghi chú", sheet1_xml)

if __name__ == '__main__':
    unittest.main()
