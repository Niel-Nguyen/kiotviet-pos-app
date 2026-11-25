"""
Tests for Dashboard Overview & Reports Endpoint:
- GET /api/reports/dashboard
Verifies:
1. RBAC permissions (401 unauthenticated, 403 cashier, 200 admin/accountant)
2. Point-in-time system balances:
   - Inventory value (MAC), product count, total stock units
   - Customer receivables (debt)
   - Supplier payables (debt)
   - Cash / Bank fund balances (TM & NH)
   - Low stock products warning
3. Transactional metrics across date ranges:
   - range='today'
   - range='yesterday'
   - range='7days'
   - range='this_month'
   - Deduct returns from revenue and profit
4. 7-day revenue & profit trend chart data (revenue_trend)
5. Top 5 selling products (with total_quantity, total_sales, sold_qty, sold_amount)
6. Backward compatibility for flat and nested JSON structures
"""

import unittest
import tempfile
import os
import json
import io
import sys
import datetime

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


class TestDashboardReports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_dashboard.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()

        # Clear existing seeded operational tables for deterministic test data
        c.execute("DELETE FROM order_items")
        c.execute("DELETE FROM orders")
        c.execute("DELETE FROM return_items")
        c.execute("DELETE FROM returns")
        c.execute("DELETE FROM cash_flow")
        c.execute("DELETE FROM customer_product_prices")
        c.execute("DELETE FROM product_units")
        c.execute("DELETE FROM inventory_logs")
        c.execute("DELETE FROM products")
        c.execute("DELETE FROM customers")
        c.execute("DELETE FROM suppliers")

        # Admin user (reports:view)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_dash', hash_password('Admin@123456'), 'Dashboard Admin', 'admin'))
        cls.admin_user_id = c.lastrowid
        cls.admin_token, _ = create_session(c, cls.admin_user_id, '127.0.0.1', 'PythonTest/1.0')

        # Accountant user (reports:view)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('accountant_dash', hash_password('Accountant@123456'), 'Dashboard Accountant', 'accountant'))
        cls.accountant_user_id = c.lastrowid
        cls.accountant_token, _ = create_session(c, cls.accountant_user_id, '127.0.0.1', 'PythonTest/1.0')

        # Cashier user (NO reports:view)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('cashier_dash', hash_password('Cashier@123456'), 'Dashboard Cashier', 'cashier'))
        cls.cashier_user_id = c.lastrowid
        cls.cashier_token, _ = create_session(c, cls.cashier_user_id, '127.0.0.1', 'PythonTest/1.0')

        # Setup test data
        now = datetime.datetime.now()
        cls.now = now
        cls.today_str = now.strftime("%Y-%m-%d")
        cls.yesterday_str = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        cls.days3_ago_str = (now - datetime.timedelta(days=3)).strftime("%Y-%m-%d")
        cls.days20_ago_str = (now - datetime.timedelta(days=20)).strftime("%Y-%m-%d")

        # Products
        # Product 1: normal stock
        c.execute("""
            INSERT INTO products (code, barcode, name, category, unit, cost_price, sale_price, stock, min_stock, created_at, updated_at)
            VALUES ('SP001', '893001', 'Nước ngọt Pepsi 330ml', 'Nước giải khát', 'Lon', 8000, 12000, 100, 10, datetime('now'), datetime('now'))
        """)
        cls.prod1_id = c.lastrowid

        # Product 2: low stock (stock=4 <= min_stock=10)
        c.execute("""
            INSERT INTO products (code, barcode, name, category, unit, cost_price, sale_price, stock, min_stock, created_at, updated_at)
            VALUES ('SP002', '893002', 'Mì Omachi Xốt Bò Hầm', 'Mì ăn liền', 'Gói', 6500, 9000, 4, 10, datetime('now'), datetime('now'))
        """)
        cls.prod2_id = c.lastrowid

        # Product 3: normal stock
        c.execute("""
            INSERT INTO products (code, barcode, name, category, unit, cost_price, sale_price, stock, min_stock, created_at, updated_at)
            VALUES ('SP003', '893003', 'Bột giặt OMO 3kg', 'Chăm sóc nhà cửa', 'Túi', 120000, 150000, 20, 5, datetime('now'), datetime('now'))
        """)
        cls.prod3_id = c.lastrowid

        # Customers (with debt)
        c.execute("""
            INSERT INTO customers (code, name, phone, debt, total_spent, created_at)
            VALUES ('KH001', 'Đại lý Mai Linh', '0912345678', 4840000, 20000000, datetime('now'))
        """)
        cls.cust1_id = c.lastrowid

        # Suppliers (with debt)
        c.execute("""
            INSERT INTO suppliers (code, name, phone, debt, created_at)
            VALUES ('NCC001', 'Công ty PepsiCo Việt Nam', '0987654321', 12500000, datetime('now'))
        """)
        cls.supp1_id = c.lastrowid

        # Cash Flow
        # Cash receipt: 100,000,000
        c.execute("""
            INSERT INTO cash_flow (code, type, category, amount, fund_type, created_at)
            VALUES ('PT001', 'receipt', 'Số dư đầu kỳ', 100000000, 'cash', datetime('now'))
        """)
        # Cash payment: 30,000,000
        c.execute("""
            INSERT INTO cash_flow (code, type, category, amount, fund_type, created_at)
            VALUES ('PC001', 'payment', 'Chi phí bán hàng', 30000000, 'cash', datetime('now'))
        """)
        # Bank receipt: 80,000,000
        c.execute("""
            INSERT INTO cash_flow (code, type, category, amount, fund_type, created_at)
            VALUES ('PT002', 'receipt', 'Tiền gửi ngân hàng', 80000000, 'bank', datetime('now'))
        """)
        # Bank payment: 9,000,000
        c.execute("""
            INSERT INTO cash_flow (code, type, category, amount, fund_type, created_at)
            VALUES ('PC002', 'payment', 'Chi tiền nhà cung cấp', 9000000, 'bank', datetime('now'))
        """)

        # Orders & Order Items across periods
        # Order 1: TODAY - 50x Pepsi (final_amount=600000, net_revenue=600000, profit=200000)
        c.execute("""
            INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, paid_amount, status, total_cost, profit, created_at)
            VALUES ('HD001', ?, 'Đại lý Mai Linh', 600000, 0, 600000, 0, 0, 600000, 600000, 'completed', 400000, 200000, ?)
        """, (cls.cust1_id, f"{cls.today_str} 10:30:00"))
        ord1_id = c.lastrowid
        c.execute("""
            INSERT INTO order_items (order_id, product_id, product_code, product_name, unit, quantity, cost_price, sale_price, subtotal)
            VALUES (?, ?, 'SP001', 'Nước ngọt Pepsi 330ml', 'Lon', 50, 8000, 12000, 600000)
        """, (ord1_id, cls.prod1_id))

        # Return TODAY: 100,000
        c.execute("""
            INSERT INTO returns (code, order_id, customer_id, customer_name, total_amount, refund_amount, debt_deduct_amount, fund_type, created_at)
            VALUES ('TH001', ?, ?, 'Đại lý Mai Linh', 100000, 100000, 0, 'cash', ?)
        """, (ord1_id, cls.cust1_id, f"{cls.today_str} 11:00:00"))

        # Order 2: YESTERDAY - 10x OMO (final_amount=1500000, net_revenue=1500000, profit=300000)
        c.execute("""
            INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, paid_amount, status, total_cost, profit, created_at)
            VALUES ('HD002', ?, 'Đại lý Mai Linh', 1500000, 0, 1500000, 0, 0, 1500000, 1500000, 'completed', 1200000, 300000, ?)
        """, (cls.cust1_id, f"{cls.yesterday_str} 14:00:00"))
        ord2_id = c.lastrowid
        c.execute("""
            INSERT INTO order_items (order_id, product_id, product_code, product_name, unit, quantity, cost_price, sale_price, subtotal)
            VALUES (?, ?, 'SP003', 'Bột giặt OMO 3kg', 'Túi', 10, 120000, 150000, 1500000)
        """, (ord2_id, cls.prod3_id))

        # Order 3: 3 DAYS AGO - 20x Omachi (final_amount=180000, net_revenue=180000, profit=50000)
        c.execute("""
            INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, paid_amount, status, total_cost, profit, created_at)
            VALUES ('HD003', ?, 'Đại lý Mai Linh', 180000, 0, 180000, 0, 0, 180000, 180000, 'completed', 130000, 50000, ?)
        """, (cls.cust1_id, f"{cls.days3_ago_str} 09:15:00"))
        ord3_id = c.lastrowid
        c.execute("""
            INSERT INTO order_items (order_id, product_id, product_code, product_name, unit, quantity, cost_price, sale_price, subtotal)
            VALUES (?, ?, 'SP002', 'Mì Omachi Xốt Bò Hầm', 'Gói', 20, 6500, 9000, 180000)
        """, (ord3_id, cls.prod2_id))

        # Order 4: CANCELLED order (should be excluded from reports)
        c.execute("""
            INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, paid_amount, status, total_cost, profit, created_at)
            VALUES ('HD004', ?, 'Đại lý Mai Linh', 999999, 0, 999999, 0, 0, 999999, 0, 'cancelled', 500000, 499999, ?)
        """, (cls.cust1_id, f"{cls.today_str} 15:00:00"))

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
        return status_code, parsed_json

    # ========================================================
    # 1. RBAC & PERMISSION TESTS
    # ========================================================
    def test_01_dashboard_unauthorized(self):
        code, data = self.request("GET", "/api/reports/dashboard", token="")
        self.assertEqual(code, 401)
        self.assertEqual(data.get("code"), "UNAUTHORIZED")

    def test_02_dashboard_cashier_forbidden(self):
        code, data = self.request("GET", "/api/reports/dashboard", token=self.cashier_token)
        self.assertEqual(code, 403)
        self.assertEqual(data.get("code"), "FORBIDDEN")

    def test_03_dashboard_accountant_allowed(self):
        code, data = self.request("GET", "/api/reports/dashboard", token=self.accountant_token)
        self.assertEqual(code, 200)
        self.assertIn("inventory", data)
        self.assertIn("funds", data)

    def test_04_dashboard_admin_allowed(self):
        code, data = self.request("GET", "/api/reports/dashboard", token=self.admin_token)
        self.assertEqual(code, 200)

    # ========================================================
    # 2. POINT-IN-TIME METRICS (INVENTORY, DEBT, FUNDS)
    # ========================================================
    def test_05_inventory_point_in_time_metrics(self):
        code, data = self.request("GET", "/api/reports/dashboard?range=today")
        self.assertEqual(code, 200)

        inv = data.get("inventory", {})
        # Total inventory value: 100*8000 + 4*6500 + 20*120000 = 800000 + 26000 + 2400000 = 3,226,000
        expected_cost = 100 * 8000 + 4 * 6500 + 20 * 120000
        self.assertEqual(inv.get("total_inventory_cost"), expected_cost)
        self.assertEqual(inv.get("total_products"), 3)
        # Total stock units: 100 + 4 + 20 = 124
        self.assertEqual(inv.get("total_stock_items"), 124)
        # Low stock count: 1 (Omachi has stock 4 <= min_stock 10)
        self.assertEqual(inv.get("low_stock_count"), 1)

        # Backward compatibility flat keys
        self.assertEqual(data.get("inventory_value"), expected_cost)
        self.assertEqual(data.get("total_products"), 3)
        self.assertEqual(data.get("total_stock_items"), 124)
        self.assertEqual(data.get("low_stock_count"), 1)

    def test_06_debt_point_in_time_metrics(self):
        code, data = self.request("GET", "/api/reports/dashboard?range=today")
        self.assertEqual(code, 200)

        debt = data.get("debt", {})
        self.assertEqual(debt.get("receivables"), 4840000)
        self.assertEqual(debt.get("payables"), 12500000)

        # Backward compatibility flat keys
        self.assertEqual(data.get("customer_debt"), 4840000)
        self.assertEqual(data.get("supplier_debt"), 12500000)

    def test_07_funds_point_in_time_metrics(self):
        code, data = self.request("GET", "/api/reports/dashboard?range=today")
        self.assertEqual(code, 200)

        funds = data.get("funds", {})
        # Cash: 100m rec - 30m pay = 70m
        # Bank: 80m rec - 9m pay = 71m
        # Total: 141m
        self.assertEqual(funds.get("total_balance"), 141000000)
        self.assertEqual(funds.get("cash_balance"), 70000000)
        self.assertEqual(funds.get("bank_balance"), 71000000)

        # Backward compatibility flat keys
        self.assertEqual(data.get("cash_balance"), 141000000)
        self.assertEqual(data.get("drawer_cash"), 70000000)
        self.assertEqual(data.get("bank_balance"), 71000000)

    def test_08_point_in_time_metrics_independent_of_period(self):
        """Point-in-time metrics must remain identical across all range options."""
        ranges = ['today', 'yesterday', '7days', 'this_month']
        snapshots = []
        for r in ranges:
            code, data = self.request("GET", f"/api/reports/dashboard?range={r}")
            self.assertEqual(code, 200)
            snapshots.append((
                data['inventory']['total_inventory_cost'],
                data['debt']['receivables'],
                data['debt']['payables'],
                data['funds']['total_balance']
            ))

        # All snapshots must be identical
        for i in range(1, len(snapshots)):
            self.assertEqual(snapshots[0], snapshots[i], f"Range {ranges[i]} gave different point-in-time metrics!")

    # ========================================================
    # 3. TRANSACTIONAL PERIOD METRICS
    # ========================================================
    def test_09_period_today(self):
        code, data = self.request("GET", "/api/reports/dashboard?range=today")
        self.assertEqual(code, 200)
        today = data.get("today", {})

        # Order 1 today: sales=600000, profit=200000. Return today: 100000.
        # Net revenue = 600000 - 100000 = 500000
        # Net profit = 200000 - 100000 = 100000
        self.assertEqual(today.get("today_revenue"), 500000)
        self.assertEqual(today.get("today_profit"), 100000)
        self.assertEqual(today.get("today_orders"), 1)
        self.assertEqual(today.get("returns_total"), 100000)

        # Backward compatibility flat keys
        self.assertEqual(data.get("today_revenue"), 500000)
        self.assertEqual(data.get("today_profit"), 100000)
        self.assertEqual(data.get("today_orders"), 1)
        self.assertEqual(data.get("today_returns"), 100000)

        # Top products today: Pepsi with 50 units
        top = data.get("top_products", [])
        self.assertTrue(len(top) >= 1)
        self.assertEqual(top[0]['code'], 'SP001')
        self.assertEqual(top[0]['total_quantity'], 50)
        self.assertEqual(top[0]['sold_qty'], 50)
        self.assertEqual(top[0]['total_sales'], 600000)
        self.assertEqual(top[0]['sold_amount'], 600000)

    def test_10_period_yesterday(self):
        code, data = self.request("GET", "/api/reports/dashboard?range=yesterday")
        self.assertEqual(code, 200)
        today = data.get("today", {})

        # Order 2 yesterday: sales=1500000, profit=300000, returns=0
        self.assertEqual(today.get("today_revenue"), 1500000)
        self.assertEqual(today.get("today_profit"), 300000)
        self.assertEqual(today.get("today_orders"), 1)
        self.assertEqual(today.get("returns_total"), 0)

        # Top products yesterday: OMO with 10 units
        top = data.get("top_products", [])
        self.assertTrue(len(top) >= 1)
        self.assertEqual(top[0]['code'], 'SP003')
        self.assertEqual(top[0]['total_quantity'], 10)

    def test_11_period_7days(self):
        code, data = self.request("GET", "/api/reports/dashboard?range=7days")
        self.assertEqual(code, 200)
        today = data.get("today", {})

        # 7days includes Order 1 (today: 600k), Order 2 (yesterday: 1500k), Order 3 (3 days ago: 180k)
        # Returns: 100k
        # Net sales = 600k + 1500k + 180k - 100k = 2,180,000
        # Net profit = 200k + 300k + 50k - 100k = 450,000
        self.assertEqual(today.get("today_revenue"), 2180000)
        self.assertEqual(today.get("today_profit"), 450000)
        self.assertEqual(today.get("today_orders"), 3)
        self.assertEqual(today.get("returns_total"), 100000)

        # Top products: Pepsi (50) > Omachi (20) > OMO (10)
        top = data.get("top_products", [])
        self.assertEqual(len(top), 3)
        self.assertEqual(top[0]['code'], 'SP001')
        self.assertEqual(top[0]['total_quantity'], 50)
        self.assertEqual(top[1]['code'], 'SP002')
        self.assertEqual(top[1]['total_quantity'], 20)
        self.assertEqual(top[2]['code'], 'SP003')
        self.assertEqual(top[2]['total_quantity'], 10)

    # ========================================================
    # 4. 7-DAY REVENUE & PROFIT TREND CHART
    # ========================================================
    def test_12_revenue_trend_data(self):
        code, data = self.request("GET", "/api/reports/dashboard")
        self.assertEqual(code, 200)

        trend = data.get("revenue_trend", [])
        self.assertEqual(len(trend), 7, "revenue_trend must have exactly 7 daily entries")

        # Must be in chronological order
        dates = [d['date'] for d in trend]
        self.assertEqual(dates, sorted(dates))

        # Check today's entry (last item)
        today_entry = trend[-1]
        self.assertEqual(today_entry['date'], self.today_str)
        self.assertEqual(today_entry['display_date'], self.now.strftime("%d/%m"))
        self.assertEqual(today_entry['revenue'], 500000)  # 600k - 100k
        self.assertEqual(today_entry['profit'], 100000)   # 200k - 100k

        # Check yesterday's entry (2nd to last)
        yesterday_entry = trend[-2]
        self.assertEqual(yesterday_entry['date'], self.yesterday_str)
        self.assertEqual(yesterday_entry['revenue'], 1500000)
        self.assertEqual(yesterday_entry['profit'], 300000)

    # ========================================================
    # 5. LOW STOCK PRODUCTS LIST
    # ========================================================
    def test_13_low_stock_products_list(self):
        code, data = self.request("GET", "/api/reports/dashboard")
        self.assertEqual(code, 200)

        low_stock = data.get("low_stock", [])
        self.assertEqual(len(low_stock), 1)
        self.assertEqual(low_stock[0]['code'], 'SP002')
        self.assertEqual(low_stock[0]['name'], 'Mì Omachi Xốt Bò Hầm')
        self.assertEqual(low_stock[0]['stock'], 4)
        self.assertEqual(low_stock[0]['min_stock'], 10)

        # Also available in low_stock_products alias
        self.assertEqual(data.get("low_stock_products"), low_stock)

    def test_14_invalid_range_defaults_to_today(self):
        code, data = self.request("GET", "/api/reports/dashboard?range=invalid_param")
        self.assertEqual(code, 200)
        self.assertEqual(data.get("date_filter"), "today")
        self.assertIn("today", data)
        self.assertIn("inventory", data)
        self.assertIn("debt", data)
        self.assertIn("funds", data)
        self.assertIn("revenue_trend", data)

    @classmethod
    def tearDownClass(cls):
        import shutil
        database.DB_FILE = os.path.join(database.DATA_DIR, 'kiotviet.db')
        server.DB_FILE = database.DB_FILE
        shutil.rmtree(cls.temp_dir, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
