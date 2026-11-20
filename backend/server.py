"""
REST API and Multi-threaded HTTP Server for KiotPro POS & Distribution Management.
Engineered for accounting precision, weighted average cost, multi-client LAN access,
strict input validation, and sales returns.
"""

import http.server
import socketserver
import json
import urllib.parse
import os
import sys
import socket
import mimetypes
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, init_db, DB_FILE

PORT = 8080
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend')

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

def get_now_str():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def generate_code(prefix, table_name, cursor):
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    count = cursor.fetchone()[0] + 1
    return f"{prefix}{count:04d}"

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class ThreadedHTTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

class KiotVietHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, data, status_code=200):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def send_error_json(self, message, status_code=400):
        self.send_json({"error": True, "message": message}, status_code)

    def parse_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        try:
            return json.loads(body.decode('utf-8'))
        except Exception:
            return {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path.startswith('/api/'):
            self.handle_api_get(path, query)
        else:
            self.handle_static_get(path)

    def handle_static_get(self, path):
        if path == '/' or not path:
            path = '/index.html'

        clean_path = path.lstrip('/')
        file_path = os.path.join(STATIC_DIR, clean_path)

        if not os.path.exists(file_path) or os.path.isdir(file_path):
            file_path = os.path.join(STATIC_DIR, 'index.html')

        mime_type, _ = mimetypes.guess_type(file_path)
        if mime_type is None:
            mime_type = 'application/octet-stream'

        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', f"{mime_type}; charset=utf-8" if 'text' in mime_type or 'javascript' in mime_type else mime_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(404, f"File not found: {e}")

    def handle_api_get(self, path, query):
        conn = get_db()
        cursor = conn.cursor()

        try:
            # 1. DATABASE BACKUP DOWNLOAD
            if path == '/api/backup/download':
                if os.path.exists(DB_FILE):
                    with open(DB_FILE, 'rb') as f:
                        db_bytes = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/x-sqlite3')
                    self.send_header('Content-Disposition', f'attachment; filename="kiotpro_backup_{datetime.datetime.now().strftime("%Y%m%d_%H%M%S")}.db"')
                    self.send_header('Content-Length', str(len(db_bytes)))
                    self.end_headers()
                    self.wfile.write(db_bytes)
                    return
                else:
                    self.send_error_json("Database file not found", 404)
                    return

            # 2. DASHBOARD OVERVIEW & REPORTS (with date filter)
            if path == '/api/reports/dashboard':
                date_filter = query.get('range', ['today'])[0] # today, yesterday, 7days, this_month, all
                now = datetime.datetime.now()
                
                date_sql = ""
                params = []

                if date_filter == 'today':
                    d_str = now.strftime("%Y-%m-%d")
                    date_sql = "AND created_at LIKE ?"
                    params = [f"{d_str}%"]
                elif date_filter == 'yesterday':
                    d_str = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                    date_sql = "AND created_at LIKE ?"
                    params = [f"{d_str}%"]
                elif date_filter == '7days':
                    d_str = (now - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
                    date_sql = "AND created_at >= ?"
                    params = [f"{d_str} 00:00:00"]
                elif date_filter == 'this_month':
                    d_str = now.strftime("%Y-%m")
                    date_sql = "AND created_at LIKE ?"
                    params = [f"{d_str}%"]

                # Sales Stats: Net Revenue, VAT, Profit, Orders
                cursor.execute(f"""
                SELECT 
                    COALESCE(SUM(final_amount), 0) as today_revenue,
                    COALESCE(SUM(net_revenue), 0) as today_net_revenue,
                    COALESCE(SUM(vat_amount), 0) as today_vat,
                    COALESCE(SUM(profit), 0) as today_profit,
                    COUNT(id) as today_orders
                FROM orders 
                WHERE status = 'completed' {date_sql}
                """, params)
                today_stats = row_to_dict(cursor.fetchone())

                # Total Inventory Value & Count
                cursor.execute("""
                SELECT 
                    COUNT(id) as total_products,
                    COALESCE(SUM(stock * cost_price), 0) as total_inventory_cost,
                    COALESCE(SUM(stock * sale_price), 0) as total_inventory_retail,
                    COALESCE(SUM(stock), 0) as total_stock_items
                FROM products
                """)
                inv_stats = row_to_dict(cursor.fetchone())

                # Receivables & Payables
                cursor.execute("SELECT COALESCE(SUM(debt), 0) FROM customers WHERE debt > 0")
                total_receivables = cursor.fetchone()[0]

                cursor.execute("SELECT COALESCE(SUM(debt), 0) FROM suppliers WHERE debt > 0")
                total_payables = cursor.fetchone()[0]

                # Cash Balances
                cursor.execute("""
                SELECT 
                    COALESCE(SUM(CASE WHEN type='receipt' THEN amount ELSE -amount END), 0) as total_balance,
                    COALESCE(SUM(CASE WHEN fund_type='cash' THEN (CASE WHEN type='receipt' THEN amount ELSE -amount END) ELSE 0 END), 0) as cash_balance,
                    COALESCE(SUM(CASE WHEN fund_type='bank' THEN (CASE WHEN type='receipt' THEN amount ELSE -amount END) ELSE 0 END), 0) as bank_balance
                FROM cash_flow
                """)
                funds = row_to_dict(cursor.fetchone())

                # Low Stock Items
                cursor.execute("""
                SELECT id, code, name, category, unit, sub_unit, sub_unit_ratio, stock, min_stock, cost_price, sale_price 
                FROM products 
                WHERE stock <= min_stock 
                ORDER BY (stock - min_stock) ASC 
                LIMIT 10
                """)
                low_stock_products = rows_to_list(cursor.fetchall())

                # 7-day revenue trend
                days = []
                for i in range(6, -1, -1):
                    day_d = (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
                    cursor.execute("""
                    SELECT 
                        COALESCE(SUM(final_amount), 0) as revenue,
                        COALESCE(SUM(profit), 0) as profit,
                        COUNT(id) as order_count
                    FROM orders
                    WHERE status = 'completed' AND created_at LIKE ?
                    """, (f"{day_d}%",))
                    row = cursor.fetchone()
                    days.append({
                        "date": day_d,
                        "display_date": (now - datetime.timedelta(days=i)).strftime("%d/%m"),
                        "revenue": row[0],
                        "profit": row[1],
                        "orders": row[2]
                    })

                # Top 5 Selling Products
                cursor.execute("""
                SELECT 
                    p.id, p.code, p.name, p.unit,
                    COALESCE(SUM(oi.quantity), 0) as total_quantity,
                    COALESCE(SUM(oi.subtotal), 0) as total_sales
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.id
                JOIN products p ON oi.product_id = p.id
                WHERE o.status = 'completed'
                GROUP BY p.id
                ORDER BY total_quantity DESC
                LIMIT 5
                """)
                top_products = rows_to_list(cursor.fetchall())

                self.send_json({
                    "today": today_stats,
                    "inventory": inv_stats,
                    "debt": {
                        "receivables": total_receivables,
                        "payables": total_payables
                    },
                    "funds": funds,
                    "low_stock": low_stock_products,
                    "revenue_trend": days,
                    "top_products": top_products
                })
                return

            # 3. PRODUCTS API
            if path == '/api/products':
                q = query.get('q', [''])[0].strip().lower()
                category = query.get('category', [''])[0].strip()
                low_stock = query.get('low_stock', ['false'])[0].lower() == 'true'

                sql = "SELECT * FROM products WHERE 1=1"
                params = []

                if q:
                    sql += " AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR barcode LIKE ?)"
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

                if category and category != 'all':
                    sql += " AND category = ?"
                    params.append(category)

                if low_stock:
                    sql += " AND stock <= min_stock"

                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                products = rows_to_list(cursor.fetchall())
                self.send_json(products)
                return

            # Stock Logs for a Product
            if path.startswith('/api/products/') and path.endswith('/logs'):
                prod_id = int(path.split('/')[3])
                cursor.execute("""
                SELECT l.*, p.name as product_name, p.code as product_code, p.unit
                FROM inventory_logs l
                JOIN products p ON l.product_id = p.id
                WHERE l.product_id = ?
                ORDER BY l.id DESC
                """, (prod_id,))
                logs = rows_to_list(cursor.fetchall())
                self.send_json(logs)
                return

            # Categories
            if path == '/api/categories':
                cursor.execute("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''")
                cats = [r[0] for r in cursor.fetchall()]
                self.send_json(cats)
                return

            # 4. CUSTOMERS API
            if path == '/api/customers':
                q = query.get('q', [''])[0].strip().lower()
                sql = "SELECT * FROM customers WHERE 1=1"
                params = []
                if q:
                    sql += " AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR phone LIKE ?)"
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                customers = rows_to_list(cursor.fetchall())
                self.send_json(customers)
                return

            # Customer Specific Prices List
            if path.startswith('/api/customers/') and path.endswith('/prices'):
                cust_id = int(path.split('/')[3])
                cursor.execute("""
                SELECT 
                    cpp.id, cpp.customer_id, cpp.product_id, cpp.custom_price, cpp.notes, cpp.updated_at,
                    p.code as product_code, p.name as product_name, p.unit, p.cost_price, p.sale_price as default_sale_price
                FROM customer_product_prices cpp
                JOIN products p ON cpp.product_id = p.id
                WHERE cpp.customer_id = ?
                ORDER BY p.name ASC
                """, (cust_id,))
                custom_prices = rows_to_list(cursor.fetchall())
                self.send_json(custom_prices)
                return

            # Quick Customer-Product Price Lookup
            if path == '/api/customer-prices/lookup':
                cust_id = query.get('customer_id', [None])[0]
                prod_id = query.get('product_id', [None])[0]
                if not cust_id or not prod_id:
                    self.send_error_json("Thiếu customer_id hoặc product_id")
                    return

                cursor.execute("SELECT sale_price FROM products WHERE id = ?", (prod_id,))
                prod = cursor.fetchone()
                if not prod:
                    self.send_error_json("Sản phẩm không tồn tại", 404)
                    return

                default_price = prod['sale_price']
                cursor.execute("""
                SELECT custom_price, notes FROM customer_product_prices
                WHERE customer_id = ? AND product_id = ?
                """, (cust_id, prod_id))
                custom = cursor.fetchone()

                if custom:
                    self.send_json({
                        "price": custom['custom_price'],
                        "is_custom": True,
                        "notes": custom['notes'],
                        "default_price": default_price
                    })
                else:
                    self.send_json({
                        "price": default_price,
                        "is_custom": False,
                        "notes": "",
                        "default_price": default_price
                    })
                return

            # 5. SUPPLIERS API
            if path == '/api/suppliers':
                q = query.get('q', [''])[0].strip().lower()
                sql = "SELECT * FROM suppliers WHERE 1=1"
                params = []
                if q:
                    sql += " AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR phone LIKE ?)"
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                suppliers = rows_to_list(cursor.fetchall())
                self.send_json(suppliers)
                return

            # 6. SALES ORDERS API
            if path == '/api/orders':
                cursor.execute("""
                SELECT o.*, 
                       (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
                FROM orders o
                ORDER BY o.id DESC
                """)
                orders = rows_to_list(cursor.fetchall())
                self.send_json(orders)
                return

            if path.startswith('/api/orders/') and not path.endswith('/items'):
                order_id = int(path.split('/')[3])
                cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                order = row_to_dict(cursor.fetchone())
                if not order:
                    self.send_error_json("Đơn hàng không tồn tại", 404)
                    return

                cursor.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
                order['items'] = rows_to_list(cursor.fetchall())
                self.send_json(order)
                return

            # 7. PURCHASES API
            if path == '/api/purchases':
                cursor.execute("""
                SELECT p.*,
                       (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) as item_count
                FROM purchases p
                ORDER BY p.id DESC
                """)
                purchases = rows_to_list(cursor.fetchall())
                self.send_json(purchases)
                return

            if path.startswith('/api/purchases/') and not path.endswith('/items'):
                purch_id = int(path.split('/')[3])
                cursor.execute("SELECT * FROM purchases WHERE id = ?", (purch_id,))
                purch = row_to_dict(cursor.fetchone())
                if not purch:
                    self.send_error_json("Phiếu nhập không tồn tại", 404)
                    return

                cursor.execute("SELECT * FROM purchase_items WHERE purchase_id = ?", (purch_id,))
                purch['items'] = rows_to_list(cursor.fetchall())
                self.send_json(purch)
                return

            # 8. RETURNS API (Khách trả hàng)
            if path == '/api/returns':
                cursor.execute("""
                SELECT r.*,
                       (SELECT COUNT(*) FROM return_items WHERE return_id = r.id) as item_count
                FROM returns r
                ORDER BY r.id DESC
                """)
                returns = rows_to_list(cursor.fetchall())
                self.send_json(returns)
                return

            # 9. CASH FLOW API
            if path == '/api/cash-flow':
                ftype = query.get('type', ['all'])[0]
                fund = query.get('fund', ['all'])[0]

                sql = "SELECT * FROM cash_flow WHERE 1=1"
                params = []
                if ftype in ['receipt', 'payment']:
                    sql += " AND type = ?"
                    params.append(ftype)
                if fund in ['cash', 'bank']:
                    sql += " AND fund_type = ?"
                    params.append(fund)

                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                items = rows_to_list(cursor.fetchall())

                cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM cash_flow WHERE type='receipt'")
                total_receipts = cursor.fetchone()[0]

                cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM cash_flow WHERE type='payment'")
                total_payments = cursor.fetchone()[0]

                cursor.execute("""
                SELECT 
                    COALESCE(SUM(CASE WHEN fund_type='cash' THEN (CASE WHEN type='receipt' THEN amount ELSE -amount END) ELSE 0 END), 0) as cash,
                    COALESCE(SUM(CASE WHEN fund_type='bank' THEN (CASE WHEN type='receipt' THEN amount ELSE -amount END) ELSE 0 END), 0) as bank
                FROM cash_flow
                """)
                fund_row = cursor.fetchone()

                self.send_json({
                    "items": items,
                    "summary": {
                        "total_receipts": total_receipts,
                        "total_payments": total_payments,
                        "current_balance": total_receipts - total_payments,
                        "cash_balance": fund_row[0],
                        "bank_balance": fund_row[1]
                    }
                })
                return

            # 10. STORE SETTINGS API
            if path == '/api/settings':
                cursor.execute("SELECT key, value FROM store_settings")
                settings = {r['key']: r['value'] for r in cursor.fetchall()}
                self.send_json(settings)
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            self.send_error_json(str(e), 500)
        finally:
            conn.close()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_body()
        conn = get_db()
        cursor = conn.cursor()

        try:
            now = get_now_str()

            # 1. CREATE PRODUCT
            if path == '/api/products':
                name = body.get('name', '').strip()
                if not name:
                    self.send_error_json("Tên sản phẩm không được để trống")
                    return

                code = body.get('code', '').strip() or generate_code('SP', 'products', cursor)
                barcode = body.get('barcode', '').strip() or code
                category = body.get('category', 'Chung').strip() or 'Chung'
                unit = body.get('unit', 'Cái').strip() or 'Cái'
                sub_unit = body.get('sub_unit', '').strip() or None
                sub_unit_ratio = float(body.get('sub_unit_ratio', 1))
                cost_price = float(body.get('cost_price', 0))
                sale_price = float(body.get('sale_price', 0))
                stock = float(body.get('stock', 0))
                min_stock = float(body.get('min_stock', 5))

                if cost_price < 0 or sale_price < 0 or min_stock < 0:
                    self.send_error_json("Giá vốn, giá bán và tồn tối thiểu không thể là số âm")
                    return

                cursor.execute("""
                INSERT INTO products (code, barcode, name, category, unit, sub_unit, sub_unit_ratio, cost_price, sale_price, stock, min_stock, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, barcode, name, category, unit, sub_unit, sub_unit_ratio, cost_price, sale_price, stock, min_stock, now, now))
                prod_id = cursor.lastrowid

                if stock > 0:
                    cursor.execute("""
                    INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at)
                    VALUES (?, 'input', 'KHOI-TAO', ?, 0, ?, 'Tạo mới sản phẩm', ?)
                    """, (prod_id, stock, stock, now))

                conn.commit()
                self.send_json({"success": True, "id": prod_id, "code": code})
                return

            # 2. CREATE CUSTOMER
            if path == '/api/customers':
                name = body.get('name', '').strip()
                if not name:
                    self.send_error_json("Tên khách hàng không được để trống")
                    return

                code = body.get('code', '').strip() or generate_code('KH', 'customers', cursor)
                phone = body.get('phone', '').strip()
                email = body.get('email', '').strip()
                address = body.get('address', '').strip()
                group_name = body.get('group_name', 'Khách lẻ').strip() or 'Khách lẻ'
                debt = float(body.get('debt', 0))
                notes = body.get('notes', '').strip()

                if debt < 0:
                    self.send_error_json("Số dư nợ ban đầu không thể là số âm")
                    return

                cursor.execute("""
                INSERT INTO customers (code, name, phone, email, address, group_name, debt, total_spent, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                """, (code, name, phone, email, address, group_name, debt, notes, now))
                cust_id = cursor.lastrowid

                conn.commit()
                self.send_json({"success": True, "id": cust_id, "code": code})
                return

            # 3. SET CUSTOMER-PRODUCT CUSTOM PRICE
            if path.startswith('/api/customers/') and path.endswith('/prices'):
                cust_id = int(path.split('/')[3])
                product_id = int(body.get('product_id'))
                custom_price = float(body.get('custom_price', 0))
                notes = body.get('notes', '').strip()

                if custom_price < 0:
                    self.send_error_json("Giá thỏa thuận riêng không thể là số âm")
                    return

                cursor.execute("""
                INSERT INTO customer_product_prices (customer_id, product_id, custom_price, notes, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(customer_id, product_id) DO UPDATE SET
                    custom_price = excluded.custom_price,
                    notes = excluded.notes,
                    updated_at = excluded.updated_at
                """, (cust_id, product_id, custom_price, notes, now))

                conn.commit()
                self.send_json({"success": True, "customer_id": cust_id, "product_id": product_id, "custom_price": custom_price})
                return

            # 4. CUSTOMER DEBT PAYMENT (Thu nợ khách) - WITH STRICT OVERPAYMENT CHECK
            if path.startswith('/api/customers/') and path.endswith('/pay-debt'):
                cust_id = int(path.split('/')[3])
                cursor.execute("SELECT * FROM customers WHERE id = ?", (cust_id,))
                cust = cursor.fetchone()
                if not cust:
                    self.send_error_json("Khách hàng không tồn tại", 404)
                    return

                amount = float(body.get('amount', 0))
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', f"Thu nợ từ khách hàng {cust['name']}").strip()

                if amount <= 0:
                    self.send_error_json("Số tiền thu nợ phải lớn hơn 0")
                    return

                current_debt = float(cust['debt'])
                if current_debt <= 0:
                    self.send_error_json("Khách hàng này hiện không còn nợ để thu!")
                    return

                if amount > current_debt + 0.01:
                    self.send_error_json(f"Số tiền thu nợ ({amount:,.0f} đ) không được vượt quá số nợ hiện tại ({current_debt:,.0f} đ)!")
                    return

                new_debt = max(0.0, current_debt - amount)
                cursor.execute("UPDATE customers SET debt = ? WHERE id = ?", (new_debt, cust_id))

                pt_code = generate_code('PT', 'cash_flow', cursor)
                cursor.execute("""
                INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at)
                VALUES (?, 'receipt', 'Thu nợ khách hàng', ?, 'customer', ?, ?, ?, ?, ?, ?)
                """, (pt_code, amount, cust_id, cust['name'], fund_type, cust['code'], notes, now))

                conn.commit()
                self.send_json({"success": True, "new_debt": new_debt, "receipt_code": pt_code})
                return

            # 5. CREATE SUPPLIER
            if path == '/api/suppliers':
                name = body.get('name', '').strip()
                if not name:
                    self.send_error_json("Tên nhà cung cấp không được để trống")
                    return

                code = body.get('code', '').strip() or generate_code('NCC', 'suppliers', cursor)
                phone = body.get('phone', '').strip()
                email = body.get('email', '').strip()
                address = body.get('address', '').strip()
                debt = float(body.get('debt', 0))
                notes = body.get('notes', '').strip()

                if debt < 0:
                    self.send_error_json("Số nợ phải trả NCC ban đầu không thể âm")
                    return

                cursor.execute("""
                INSERT INTO suppliers (code, name, phone, email, address, debt, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, name, phone, email, address, debt, notes, now))
                supp_id = cursor.lastrowid

                conn.commit()
                self.send_json({"success": True, "id": supp_id, "code": code})
                return

            # 6. SUPPLIER DEBT PAYMENT (Chi trả nợ NCC) - WITH STRICT OVERPAYMENT CHECK
            if path.startswith('/api/suppliers/') and path.endswith('/pay-debt'):
                supp_id = int(path.split('/')[3])
                cursor.execute("SELECT * FROM suppliers WHERE id = ?", (supp_id,))
                supp = cursor.fetchone()
                if not supp:
                    self.send_error_json("Nhà cung cấp không tồn tại", 404)
                    return

                amount = float(body.get('amount', 0))
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', f"Chi trả nợ cho NCC {supp['name']}").strip()

                if amount <= 0:
                    self.send_error_json("Số tiền trả nợ phải lớn hơn 0")
                    return

                current_debt = float(supp['debt'])
                if current_debt <= 0:
                    self.send_error_json("Hiện không có dư nợ với nhà cung cấp này!")
                    return

                if amount > current_debt + 0.01:
                    self.send_error_json(f"Số tiền chi trả ({amount:,.0f} đ) không được vượt quá số nợ NCC hiện tại ({current_debt:,.0f} đ)!")
                    return

                new_debt = max(0.0, current_debt - amount)
                cursor.execute("UPDATE suppliers SET debt = ? WHERE id = ?", (new_debt, supp_id))

                pc_code = generate_code('PC', 'cash_flow', cursor)
                cursor.execute("""
                INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at)
                VALUES (?, 'payment', 'Chi trả nợ NCC', ?, 'supplier', ?, ?, ?, ?, ?, ?)
                """, (pc_code, amount, supp_id, supp['name'], fund_type, supp['code'], notes, now))

                conn.commit()
                self.send_json({"success": True, "new_debt": new_debt, "payment_code": pc_code})
                return

            # 7. CREATE SALES ORDER (Output / Bán hàng)
            # WITH ACCOUNTING PRECISION:
            # - Net revenue vs VAT separation (VAT does NOT inflate gross profit)
            # - Cash drawer receives only actual payment (change returned to customer is deducted from drawer)
            # - Prevent negative stock if disabled in settings
            if path == '/api/orders':
                items = body.get('items', [])
                if not items:
                    self.send_error_json("Đơn hàng chưa có sản phẩm")
                    return

                # Check allow_negative_stock setting
                cursor.execute("SELECT value FROM store_settings WHERE key = 'allow_negative_stock'")
                setting_row = cursor.fetchone()
                allow_negative = setting_row and setting_row['value'].lower() == 'true'

                customer_id = body.get('customer_id')
                customer_name = body.get('customer_name', 'Khách lẻ')
                discount = max(0.0, float(body.get('discount', 0)))
                vat_percent = max(0.0, float(body.get('vat_percent', 0)))
                customer_paid = max(0.0, float(body.get('paid_amount', 0)))
                payment_method = body.get('payment_method', 'cash')
                notes = body.get('notes', '')

                order_code = generate_code('HD', 'orders', cursor)
                total_amount = 0.0
                total_cost = 0.0
                processed_items = []

                # First pass: validate all items and stock
                for item in items:
                    prod_id = int(item['product_id'])
                    qty = float(item.get('quantity', 0))
                    sale_price = float(item.get('sale_price', 0))
                    is_custom_price = 1 if item.get('is_custom_price') else 0

                    if qty <= 0:
                        self.send_error_json(f"Số lượng sản phẩm phải lớn hơn 0")
                        return
                    if sale_price < 0:
                        self.send_error_json(f"Đơn giá không thể là số âm")
                        return

                    cursor.execute("SELECT * FROM products WHERE id = ?", (prod_id,))
                    prod = cursor.fetchone()
                    if not prod:
                        self.send_error_json(f"Sản phẩm ID {prod_id} không tồn tại")
                        return

                    stock_before = float(prod['stock'])
                    if not allow_negative and stock_before < qty:
                        self.send_error_json(f"Sản phẩm '{prod['name']}' không đủ tồn kho (Còn: {stock_before} {prod['unit']}, yêu cầu: {qty} {prod['unit']}). Hệ thống đang bật chế độ chặn bán âm kho!")
                        return

                    subtotal = round(qty * sale_price, 2)
                    item_cost = round(qty * float(prod['cost_price']), 2)
                    total_amount += subtotal
                    total_cost += item_cost

                    processed_items.append({
                        "product_id": prod_id,
                        "product_code": prod['code'],
                        "product_name": prod['name'],
                        "unit": prod['unit'],
                        "quantity": qty,
                        "cost_price": float(prod['cost_price']),
                        "sale_price": sale_price,
                        "is_custom_price": is_custom_price,
                        "subtotal": subtotal,
                        "stock_before": stock_before,
                        "save_as_custom_price": item.get('save_as_custom_price', False)
                    })

                # Calculate accounting totals
                net_revenue = max(0.0, total_amount - discount)
                vat_amount = round(net_revenue * (vat_percent / 100.0), 2)
                final_amount = round(net_revenue + vat_amount, 2)

                # Accurate Cash Accounting:
                # actual_paid: amount credited towards the bill (cannot exceed final_amount)
                # change_amount: cash thối trả lại khách tại quầy (NOT retained in cash flow drawer!)
                # debt_amount: unpaid portion added to customer accounts receivable
                actual_paid = min(customer_paid, final_amount)
                change_amount = max(0.0, customer_paid - final_amount)
                debt_amount = max(0.0, final_amount - actual_paid)

                # Gross Profit = Net Revenue (excluding VAT) - Total Cost of Goods Sold
                profit = round(net_revenue - total_cost, 2)

                # Check customer debt restriction
                if debt_amount > 0 and (not customer_id or customer_id == 1):
                    self.send_error_json("Khách lẻ không thể ghi nợ! Vui lòng chọn khách hàng có danh tính để ghi nhận công nợ.")
                    return

                # Insert Order
                cursor.execute("""
                INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, customer_paid, paid_amount, change_amount, debt_amount, payment_method, status, total_cost, profit, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)
                """, (order_code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, customer_paid, actual_paid, change_amount, debt_amount, payment_method, total_cost, profit, notes, now))
                order_id = cursor.lastrowid

                # Deduct inventory & insert items
                for pi in processed_items:
                    stock_after = pi['stock_before'] - pi['quantity']
                    cursor.execute("UPDATE products SET stock = ? WHERE id = ?", (stock_after, pi['product_id']))

                    cursor.execute("""
                    INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at)
                    VALUES (?, 'output', ?, ?, ?, ?, ?, ?)
                    """, (pi['product_id'], order_code, -pi['quantity'], pi['stock_before'], stock_after, f"Xuất bán cho {customer_name}", now))

                    cursor.execute("""
                    INSERT INTO order_items (order_id, product_id, product_code, product_name, unit, quantity, cost_price, sale_price, is_custom_price, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (order_id, pi['product_id'], pi['product_code'], pi['product_name'], pi['unit'], pi['quantity'], pi['cost_price'], pi['sale_price'], pi['is_custom_price'], pi['subtotal']))

                    if customer_id and pi['save_as_custom_price']:
                        cursor.execute("""
                        INSERT INTO customer_product_prices (customer_id, product_id, custom_price, notes, updated_at)
                        VALUES (?, ?, ?, 'Giá lưu tự động từ đơn bán hàng', ?)
                        ON CONFLICT(customer_id, product_id) DO UPDATE SET
                            custom_price = excluded.custom_price,
                            updated_at = excluded.updated_at
                        """, (customer_id, pi['product_id'], pi['sale_price'], now))

                # Update customer debt & spent
                if customer_id:
                    cursor.execute("""
                    UPDATE customers 
                    SET debt = debt + ?, total_spent = total_spent + ?
                    WHERE id = ?
                    """, (debt_amount, final_amount, customer_id))

                # Cash flow: ONLY actual_paid enters the drawer (change is immediately returned to customer)
                if actual_paid > 0:
                    pt_code = generate_code('PT', 'cash_flow', cursor)
                    cursor.execute("""
                    INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at)
                    VALUES (?, 'receipt', 'Thu tiền bán hàng', ?, 'customer', ?, ?, ?, ?, ?, ?)
                    """, (pt_code, actual_paid, customer_id, customer_name, payment_method if payment_method in ['cash', 'bank'] else 'cash', order_code, f"Thu tiền đơn {order_code} (Khách đưa {customer_paid:,.0f} đ, thối lại {change_amount:,.0f} đ)", now))

                conn.commit()
                self.send_json({
                    "success": True,
                    "order_id": order_id,
                    "code": order_code,
                    "final_amount": final_amount,
                    "net_revenue": net_revenue,
                    "vat_amount": vat_amount,
                    "customer_paid": customer_paid,
                    "paid_amount": actual_paid,
                    "change_amount": change_amount,
                    "debt_amount": debt_amount,
                    "profit": profit
                })
                return

            # 8. CREATE PURCHASE ORDER (Input / Nhập hàng)
            # WITH WEIGHTED AVERAGE COST (MAC - Moving Average Cost):
            # new_cost = (old_stock * old_cost + import_qty * import_price) / (old_stock + import_qty)
            if path == '/api/purchases':
                items = body.get('items', [])
                if not items:
                    self.send_error_json("Phiếu nhập chưa có sản phẩm")
                    return

                supplier_id = body.get('supplier_id')
                supplier_name = body.get('supplier_name', 'Nhà cung cấp')
                discount = max(0.0, float(body.get('discount', 0)))
                paid_amount = max(0.0, float(body.get('paid_amount', 0)))
                payment_method = body.get('payment_method', 'cash')
                notes = body.get('notes', '')

                purchase_code = generate_code('PN', 'purchases', cursor)
                total_amount = 0.0
                processed_items = []

                for item in items:
                    prod_id = int(item['product_id'])
                    qty = float(item.get('quantity', 0))
                    import_price = float(item.get('import_price', 0))

                    if qty <= 0:
                        self.send_error_json("Số lượng nhập phải lớn hơn 0")
                        return
                    if import_price < 0:
                        self.send_error_json("Giá nhập không thể là số âm")
                        return

                    cursor.execute("SELECT * FROM products WHERE id = ?", (prod_id,))
                    prod = cursor.fetchone()
                    if not prod:
                        self.send_error_json(f"Sản phẩm ID {prod_id} không tồn tại")
                        return

                    subtotal = round(qty * import_price, 2)
                    total_amount += subtotal

                    # Standard Weighted Average Cost Formula
                    stock_before = float(prod['stock'])
                    cost_before = float(prod['cost_price'])

                    if stock_before > 0:
                        new_cost_price = round(((stock_before * cost_before) + (qty * import_price)) / (stock_before + qty), 2)
                    else:
                        new_cost_price = import_price

                    stock_after = stock_before + qty

                    cursor.execute("""
                    UPDATE products 
                    SET stock = ?, cost_price = ?, updated_at = ?
                    WHERE id = ?
                    """, (stock_after, new_cost_price, now, prod_id))

                    cursor.execute("""
                    INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at)
                    VALUES (?, 'input', ?, ?, ?, ?, ?, ?)
                    """, (prod_id, purchase_code, qty, stock_before, stock_after, f"Nhập kho từ {supplier_name} (Giá vốn MAC: {new_cost_price:,.0f} đ)", now))

                    processed_items.append({
                        "product_id": prod_id,
                        "product_code": prod['code'],
                        "product_name": prod['name'],
                        "unit": prod['unit'],
                        "quantity": qty,
                        "import_price": import_price,
                        "subtotal": subtotal
                    })

                final_amount = max(0.0, total_amount - discount)
                actual_paid = min(paid_amount, final_amount)
                debt_amount = max(0.0, final_amount - actual_paid)

                cursor.execute("""
                INSERT INTO purchases (code, supplier_id, supplier_name, total_amount, discount, final_amount, paid_amount, debt_amount, payment_method, status, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
                """, (purchase_code, supplier_id, supplier_name, total_amount, discount, final_amount, actual_paid, debt_amount, payment_method, notes, now))
                purch_id = cursor.lastrowid

                for pi in processed_items:
                    cursor.execute("""
                    INSERT INTO purchase_items (purchase_id, product_id, product_code, product_name, unit, quantity, import_price, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (purch_id, pi['product_id'], pi['product_code'], pi['product_name'], pi['unit'], pi['quantity'], pi['import_price'], pi['subtotal']))

                # Update supplier debt
                if supplier_id:
                    cursor.execute("UPDATE suppliers SET debt = debt + ? WHERE id = ?", (debt_amount, supplier_id))

                # Cash flow expense voucher
                if actual_paid > 0:
                    pc_code = generate_code('PC', 'cash_flow', cursor)
                    cursor.execute("""
                    INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at)
                    VALUES (?, 'payment', 'Chi nhập hàng', ?, 'supplier', ?, ?, ?, ?, ?, ?)
                    """, (pc_code, actual_paid, supplier_id, supplier_name, payment_method if payment_method in ['cash', 'bank'] else 'cash', purchase_code, f"Chi tiền nhập đơn {purchase_code}", now))

                conn.commit()
                self.send_json({
                    "success": True,
                    "purchase_id": purch_id,
                    "code": purchase_code,
                    "final_amount": final_amount,
                    "paid_amount": actual_paid,
                    "debt_amount": debt_amount
                })
                return

            # 9. SALES RETURN (Khách trả hàng)
            if path == '/api/returns':
                items = body.get('items', [])
                if not items:
                    self.send_error_json("Phiếu trả hàng chưa có sản phẩm")
                    return

                order_id = body.get('order_id')
                customer_id = body.get('customer_id')
                customer_name = body.get('customer_name', 'Khách lẻ')
                refund_amount = max(0.0, float(body.get('refund_amount', 0)))
                debt_deduct_amount = max(0.0, float(body.get('debt_deduct_amount', 0)))
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', 'Khách trả hàng')

                return_code = generate_code('TH', 'returns', cursor)
                total_return_amount = 0.0

                for item in items:
                    prod_id = int(item['product_id'])
                    qty = float(item['quantity'])
                    return_price = float(item['return_price'])

                    cursor.execute("SELECT * FROM products WHERE id = ?", (prod_id,))
                    prod = cursor.fetchone()
                    if not prod:
                        self.send_error_json(f"Sản phẩm ID {prod_id} không tồn tại")
                        return

                    subtotal = qty * return_price
                    total_return_amount += subtotal

                    # Restore inventory stock
                    stock_before = float(prod['stock'])
                    stock_after = stock_before + qty
                    cursor.execute("UPDATE products SET stock = ? WHERE id = ?", (stock_after, prod_id))

                    cursor.execute("""
                    INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at)
                    VALUES (?, 'return', ?, ?, ?, ?, ?, ?)
                    """, (prod_id, return_code, qty, stock_before, stock_after, f"Khách {customer_name} trả hàng", now))

                cursor.execute("""
                INSERT INTO returns (code, order_id, customer_id, customer_name, total_amount, refund_amount, debt_deduct_amount, fund_type, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (return_code, order_id, customer_id, customer_name, total_return_amount, refund_amount, debt_deduct_amount, fund_type, notes, now))
                return_id = cursor.lastrowid

                for item in items:
                    cursor.execute("SELECT name, unit, cost_price FROM products WHERE id = ?", (item['product_id'],))
                    p_info = cursor.fetchone()
                    cursor.execute("""
                    INSERT INTO return_items (return_id, product_id, product_name, unit, quantity, return_price, cost_price, subtotal)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (return_id, item['product_id'], p_info['name'], p_info['unit'], item['quantity'], item['return_price'], p_info['cost_price'], item['quantity'] * item['return_price']))

                # Deduct customer debt if applicable
                if customer_id and debt_deduct_amount > 0:
                    cursor.execute("UPDATE customers SET debt = MAX(0, debt - ?) WHERE id = ?", (debt_deduct_amount, customer_id))

                # Refund cash out of drawer
                if refund_amount > 0:
                    pc_code = generate_code('PC', 'cash_flow', cursor)
                    cursor.execute("""
                    INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at)
                    VALUES (?, 'payment', 'Chi tiền hoàn trả hàng', ?, 'customer', ?, ?, ?, ?, ?, ?)
                    """, (pc_code, refund_amount, customer_id, customer_name, fund_type, return_code, f"Hoàn tiền trả hàng {return_code}", now))

                conn.commit()
                self.send_json({"success": True, "return_id": return_id, "code": return_code, "total_amount": total_return_amount})
                return

            # 10. INVENTORY AUDIT / ADJUSTMENT (Kiểm kho)
            if path == '/api/inventory/adjust':
                prod_id = int(body.get('product_id'))
                actual_stock = float(body.get('actual_stock', 0))
                notes = body.get('notes', 'Kiểm kho / Điều chỉnh tồn')

                if actual_stock < 0:
                    self.send_error_json("Số lượng tồn kiểm đếm thực tế không thể âm")
                    return

                cursor.execute("SELECT * FROM products WHERE id = ?", (prod_id,))
                prod = cursor.fetchone()
                if not prod:
                    self.send_error_json("Sản phẩm không tồn tại", 404)
                    return

                stock_before = float(prod['stock'])
                diff = actual_stock - stock_before

                cursor.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", (actual_stock, now, prod_id))

                adj_code = generate_code('KK', 'inventory_logs', cursor)
                cursor.execute("""
                INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at)
                VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?)
                """, (prod_id, adj_code, diff, stock_before, actual_stock, notes, now))

                conn.commit()
                self.send_json({"success": True, "stock_before": stock_before, "actual_stock": actual_stock, "diff": diff})
                return

            # 11. MANUAL CASH FLOW VOUCHER
            if path == '/api/cash-flow':
                vtype = body.get('type')
                if vtype not in ['receipt', 'payment']:
                    self.send_error_json("Loại phiếu không hợp lệ (receipt/payment)")
                    return

                category = body.get('category', 'Thu khác' if vtype == 'receipt' else 'Chi khác').strip()
                amount = float(body.get('amount', 0))
                target_name = body.get('target_name', 'Khác').strip()
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', '').strip()

                if amount <= 0:
                    self.send_error_json("Số tiền phải lớn hơn 0")
                    return

                code_prefix = 'PT' if vtype == 'receipt' else 'PC'
                code = generate_code(code_prefix, 'cash_flow', cursor)

                cursor.execute("""
                INSERT INTO cash_flow (code, type, category, amount, target_type, target_name, fund_type, reference_code, notes, created_at)
                VALUES (?, ?, ?, ?, 'other', ?, ?, 'THU-CONG', ?, ?)
                """, (code, vtype, category, amount, target_name, fund_type, notes, now))

                conn.commit()
                self.send_json({"success": True, "code": code})
                return

            # 12. UPDATE STORE SETTINGS
            if path == '/api/settings':
                for k, v in body.items():
                    cursor.execute("INSERT OR REPLACE INTO store_settings (key, value) VALUES (?, ?)", (k, str(v)))
                conn.commit()
                self.send_json({"success": True})
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            self.send_error_json(str(e), 500)
        finally:
            conn.close()

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_body()
        conn = get_db()
        cursor = conn.cursor()

        try:
            now = get_now_str()

            # UPDATE PRODUCT
            if path.startswith('/api/products/'):
                prod_id = int(path.split('/')[3])
                name = body.get('name', '').strip()
                barcode = body.get('barcode', '').strip()
                category = body.get('category', 'Chung').strip()
                unit = body.get('unit', 'Cái').strip()
                sub_unit = body.get('sub_unit', '').strip() or None
                sub_unit_ratio = float(body.get('sub_unit_ratio', 1))
                cost_price = float(body.get('cost_price', 0))
                sale_price = float(body.get('sale_price', 0))
                min_stock = float(body.get('min_stock', 5))

                if cost_price < 0 or sale_price < 0:
                    self.send_error_json("Giá không thể là số âm")
                    return

                cursor.execute("""
                UPDATE products 
                SET name = ?, barcode = ?, category = ?, unit = ?, sub_unit = ?, sub_unit_ratio = ?, cost_price = ?, sale_price = ?, min_stock = ?, updated_at = ?
                WHERE id = ?
                """, (name, barcode, category, unit, sub_unit, sub_unit_ratio, cost_price, sale_price, min_stock, now, prod_id))
                conn.commit()
                self.send_json({"success": True})
                return

            # UPDATE CUSTOMER
            if path.startswith('/api/customers/'):
                cust_id = int(path.split('/')[3])
                name = body.get('name', '').strip()
                phone = body.get('phone', '').strip()
                email = body.get('email', '').strip()
                address = body.get('address', '').strip()
                group_name = body.get('group_name', 'Khách lẻ').strip()
                notes = body.get('notes', '').strip()

                cursor.execute("""
                UPDATE customers 
                SET name = ?, phone = ?, email = ?, address = ?, group_name = ?, notes = ?
                WHERE id = ?
                """, (name, phone, email, address, group_name, notes, cust_id))
                conn.commit()
                self.send_json({"success": True})
                return

            # UPDATE SUPPLIER
            if path.startswith('/api/suppliers/'):
                supp_id = int(path.split('/')[3])
                name = body.get('name', '').strip()
                phone = body.get('phone', '').strip()
                email = body.get('email', '').strip()
                address = body.get('address', '').strip()
                notes = body.get('notes', '').strip()

                cursor.execute("""
                UPDATE suppliers 
                SET name = ?, phone = ?, email = ?, address = ?, notes = ?
                WHERE id = ?
                """, (name, phone, email, address, notes, supp_id))
                conn.commit()
                self.send_json({"success": True})
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            self.send_error_json(str(e), 500)
        finally:
            conn.close()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        conn = get_db()
        cursor = conn.cursor()

        try:
            if path.startswith('/api/customer-prices/'):
                price_id = int(path.split('/')[3])
                cursor.execute("DELETE FROM customer_product_prices WHERE id = ?", (price_id,))
                conn.commit()
                self.send_json({"success": True})
                return

            if path.startswith('/api/products/'):
                prod_id = int(path.split('/')[3])
                cursor.execute("DELETE FROM products WHERE id = ?", (prod_id,))
                conn.commit()
                self.send_json({"success": True})
                return

            if path.startswith('/api/customers/'):
                cust_id = int(path.split('/')[3])
                cursor.execute("DELETE FROM customers WHERE id = ?", (cust_id,))
                conn.commit()
                self.send_json({"success": True})
                return

            if path.startswith('/api/suppliers/'):
                supp_id = int(path.split('/')[3])
                cursor.execute("DELETE FROM suppliers WHERE id = ?", (supp_id,))
                conn.commit()
                self.send_json({"success": True})
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            self.send_error_json(str(e), 500)
        finally:
            conn.close()

def run_server(port=PORT):
    init_db()
    lan_ip = get_lan_ip()
    server_address = ('0.0.0.0', port)
    
    httpd = ThreadedHTTPServer(server_address, KiotVietHandler)
    print(f"======================================================")
    print(f"🚀 KiotPro POS & Distribution Server is RUNNING")
    print(f"📍 Local access:      http://localhost:{port}")
    print(f"🌐 LAN/Wi-Fi access:   http://{lan_ip}:{port}")
    print(f"📦 Web Directory:      {STATIC_DIR}")
    print(f"⚡ Multi-threaded:     Ready for multiple cashiers & devices")
    print(f"⚡ Press Ctrl+C to stop the server")
    print(f"======================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
