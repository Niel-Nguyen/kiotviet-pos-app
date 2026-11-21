"""
REST API and Multi-threaded HTTP Server for KiotPro POS & Distribution Management.
Engineered for accounting precision, weighted average cost, multi-client LAN access,
strict input validation, sales returns, RBAC user authorization, and atomic business audit trails.
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
import hmac
from http import cookies

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from database import get_db, init_db, DB_FILE
import auth

PORT = int(os.environ.get('PORT', '8080'))
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend')

def row_to_dict(row):
    return dict(row) if row else None

def use_secure_cookies():
    return os.environ.get('KIOTPRO_COOKIE_SECURE', '').strip().lower() in ('1', 'true', 'yes')

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
        origin = self.headers.get('Origin')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Credentials', 'true')
        else:
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie')
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

    def send_error_json(self, message, status_code=400, code=None):
        payload = {"error": True, "message": message}
        if code:
            payload["code"] = code
        self.send_json(payload, status_code)

    def parse_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        try:
            return json.loads(body.decode('utf-8'))
        except Exception:
            return {}

    def get_client_ip(self):
        xff = self.headers.get('X-Forwarded-For')
        if xff:
            return xff.split(',')[0].strip()
        return self.client_address[0] if self.client_address else '127.0.0.1'

    def get_session_token(self):
        # 1. Check Cookie header: kiotpro_session=<token>
        cookie_header = self.headers.get('Cookie', '')
        if cookie_header:
            c = cookies.SimpleCookie()
            try:
                c.load(cookie_header)
                if 'kiotpro_session' in c:
                    return c['kiotpro_session'].value
            except Exception:
                pass
        # 2. Check Authorization: Bearer <token>
        auth_header = self.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            return auth_header[7:].strip()
        return None

    def set_session_cookie(self, token, max_age=86400):
        secure = '; Secure' if use_secure_cookies() else ''
        cookie = f"kiotpro_session={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}"
        self.send_header('Set-Cookie', cookie)

    def clear_session_cookie(self):
        secure = '; Secure' if use_secure_cookies() else ''
        cookie = f"kiotpro_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{secure}"
        self.send_header('Set-Cookie', cookie)

    def authenticate(self, conn=None):
        """Returns user dict if valid session, else None."""
        token = self.get_session_token()
        if not token:
            return None
        should_close = False
        if conn is None:
            conn = get_db()
            should_close = True
        try:
            cursor = conn.cursor()
            user = auth.get_session_user(cursor, token)
            if should_close:
                conn.commit()
            return user
        finally:
            if should_close:
                conn.close()

    def require_auth(self, permission=None, conn=None):
        """
        Enforce authentication and role permissions (deny by default).
        Returns (user, True) on success.
        Sends 401/403 and returns (user or None, False) on denial.
        """
        user = self.authenticate(conn=conn)
        if not user:
            self.send_error_json("Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại.", 401, "UNAUTHORIZED")
            return None, False

        if permission and not auth.has_permission(user['role'], permission):
            role_title = auth.ROLES.get(user['role'], {}).get('name', user['role'])
            self.send_error_json(
                f"Tài khoản của bạn ({user['full_name']} - {role_title}) không có quyền thực hiện chức năng này.",
                403,
                "FORBIDDEN"
            )
            return user, False

        return user, True

    # ------------------ ROUTING ------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        if path == '/healthz':
            self.send_json({"status": "ok"})
            return

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
            # 1. PUBLIC: BOOTSTRAP STATUS
            if path == '/api/auth/bootstrap-status':
                need = auth.is_bootstrap_needed(cursor)
                self.send_json({
                    "need_bootstrap": need,
                    "bootstrap_token_required": bool(os.environ.get('KIOTPRO_BOOTSTRAP_TOKEN'))
                })
                return

            # 2. AUTHENTICATION: CURRENT USER PROFILE & PERMISSIONS
            if path == '/api/auth/me':
                user, ok = self.require_auth(conn=conn)
                if not ok:
                    return
                perms = list(auth.ROLE_PERMISSIONS.get(user['role'], set()))
                self.send_json({
                    "user": user,
                    "roles": auth.ROLES,
                    "permissions": perms
                })
                return

            # 3. USERS MANAGEMENT (Admin only)
            if path == '/api/users':
                user, ok = self.require_auth('users:manage', conn=conn)
                if not ok:
                    return
                cursor.execute("""
                    SELECT id, username, full_name, role, is_active, created_at, updated_at, last_login_at
                    FROM users
                    ORDER BY id ASC
                """)
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            # 4. DATABASE BACKUP DOWNLOAD (Admin only)
            if path == '/api/backup/download':
                user, ok = self.require_auth('backup:download', conn=conn)
                if not ok:
                    return
                if os.path.exists(DB_FILE):
                    with open(DB_FILE, 'rb') as f:
                        db_bytes = f.read()
                    
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='BACKUP_DOWNLOAD',
                        entity_type='system',
                        entity_id=None,
                        entity_code='backup',
                        details={'message': 'Tải bản sao lưu cơ sở dữ liệu SQLite'},
                        ip_address=self.get_client_ip()
                    )
                    conn.commit()

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

            # 5. AUDIT LOGS QUERY (Admin & Manager)
            if path == '/api/audit-logs':
                user, ok = self.require_auth('audit:view', conn=conn)
                if not ok:
                    return

                entity_type = query.get('entity_type', [''])[0].strip()
                entity_code = query.get('entity_code', [''])[0].strip()
                action = query.get('action', [''])[0].strip()
                user_id = query.get('user_id', [''])[0].strip()
                date_from = query.get('date_from', [''])[0].strip()
                date_to = query.get('date_to', [''])[0].strip()
                q = query.get('q', [''])[0].strip()
                limit = min(int(query.get('limit', [50])[0]), 200)
                offset = max(int(query.get('offset', [0])[0]), 0)

                conditions = ["1=1"]
                params = []

                if entity_type:
                    conditions.append("entity_type = ?")
                    params.append(entity_type)
                if entity_code:
                    conditions.append("entity_code LIKE ?")
                    params.append(f"%{entity_code}%")
                if action:
                    conditions.append("action = ?")
                    params.append(action)
                if user_id:
                    conditions.append("user_id = ?")
                    params.append(user_id)
                if date_from:
                    conditions.append("created_at >= ?")
                    params.append(f"{date_from} 00:00:00")
                if date_to:
                    conditions.append("created_at <= ?")
                    params.append(f"{date_to} 23:59:59")
                if q:
                    conditions.append("(entity_code LIKE ? OR user_name LIKE ? OR details LIKE ?)")
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

                where_clause = " AND ".join(conditions)
                
                cursor.execute(f"SELECT COUNT(*) FROM audit_logs WHERE {where_clause}", params)
                total_count = cursor.fetchone()[0]

                cursor.execute(f"""
                    SELECT id, user_id, user_name, action, entity_type, entity_id, entity_code, details, ip_address, created_at
                    FROM audit_logs
                    WHERE {where_clause}
                    ORDER BY id DESC
                    LIMIT ? OFFSET ?
                """, params + [limit, offset])
                
                logs = rows_to_list(cursor.fetchall())
                for l in logs:
                    if l.get('details'):
                        try:
                            l['details_parsed'] = json.loads(l['details'])
                        except Exception:
                            l['details_parsed'] = l['details']

                self.send_json({
                    "total": total_count,
                    "limit": limit,
                    "offset": offset,
                    "items": logs
                })
                return

            # 6. VOUCHER / ENTITY TIMELINE
            if path.startswith('/api/timeline/'):
                parts = path.split('/')[3:]
                if len(parts) >= 2:
                    entity_type = parts[0]
                    target_identifier = urllib.parse.unquote(parts[1])
                    
                    perm_map = {
                        'order': 'orders:view',
                        'purchase': 'purchases:view',
                        'return': 'returns:view',
                        'product': 'products:view',
                        'cash_flow': 'cash_flow:view',
                        'customer': 'customers:view',
                        'supplier': 'suppliers:view',
                        'user': 'users:manage'
                    }
                    perm = perm_map.get(entity_type)
                    user, ok = self.require_auth(perm, conn=conn)
                    if not ok:
                        return

                    cursor.execute("""
                        SELECT id, user_id, user_name, action, entity_type, entity_id, entity_code, details, ip_address, created_at
                        FROM audit_logs
                        WHERE (entity_type = ? AND (entity_code = ? OR entity_id = ?))
                           OR (details LIKE ?)
                        ORDER BY id ASC
                    """, (entity_type, target_identifier, target_identifier, f"%{target_identifier}%"))
                    
                    events = rows_to_list(cursor.fetchall())
                    for ev in events:
                        if ev.get('details'):
                            try:
                                ev['details_parsed'] = json.loads(ev['details'])
                            except Exception:
                                ev['details_parsed'] = ev['details']

                    self.send_json({
                        "entity_type": entity_type,
                        "identifier": target_identifier,
                        "timeline": events
                    })
                    return

            # 7. DASHBOARD OVERVIEW & REPORTS (Admin, Manager, Accountant)
            if path == '/api/reports/dashboard':
                user, ok = self.require_auth('reports:view', conn=conn)
                if not ok:
                    return

                date_filter = query.get('range', ['today'])[0]
                now = datetime.datetime.now()
                
                date_sql = ""
                params = []

                if date_filter == 'today':
                    d_str = now.strftime("%Y-%m-%d")
                    date_sql = "AND created_at LIKE ?"
                    params = [f"{d_str}%"]
                elif date_filter == 'yesterday':
                    y_str = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
                    date_sql = "AND created_at LIKE ?"
                    params = [f"{y_str}%"]
                elif date_filter == '7days':
                    d_str = (now - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
                    date_sql = "AND created_at >= ?"
                    params = [f"{d_str} 00:00:00"]
                elif date_filter == 'this_month':
                    m_str = now.strftime("%Y-%m")
                    date_sql = "AND created_at LIKE ?"
                    params = [f"{m_str}%"]

                cursor.execute(f"""
                    SELECT 
                        COALESCE(SUM(final_amount), 0) as total_sales,
                        COALESCE(SUM(net_revenue), 0) as total_net_revenue,
                        COALESCE(SUM(profit), 0) as total_profit,
                        COUNT(id) as total_orders
                    FROM orders 
                    WHERE status = 'completed' {date_sql}
                """, params)
                sales_row = cursor.fetchone()

                cursor.execute(f"""
                    SELECT COALESCE(SUM(total_amount), 0) as total_returns
                    FROM returns
                    WHERE 1=1 {date_sql}
                """, params)
                ret_row = cursor.fetchone()
                total_returns = ret_row['total_returns'] if ret_row else 0

                net_sales = sales_row['total_sales'] - total_returns
                net_profit = sales_row['total_profit'] - total_returns

                cursor.execute("SELECT COALESCE(SUM(stock * cost_price), 0) as total_val, COUNT(id) as total_prods FROM products")
                inv_row = cursor.fetchone()

                cursor.execute("SELECT COUNT(id) as low_stock FROM products WHERE stock <= min_stock")
                low_stock = cursor.fetchone()['low_stock']

                cursor.execute("SELECT COALESCE(SUM(debt), 0) as total_cust_debt FROM customers")
                cust_debt = cursor.fetchone()['total_cust_debt']

                cursor.execute("SELECT COALESCE(SUM(debt), 0) as total_sup_debt FROM suppliers")
                sup_debt = cursor.fetchone()['total_sup_debt']

                cursor.execute("SELECT COALESCE(SUM(amount), 0) as total_rec FROM cash_flow WHERE type = 'receipt'")
                total_rec = cursor.fetchone()['total_rec']
                cursor.execute("SELECT COALESCE(SUM(amount), 0) as total_pay FROM cash_flow WHERE type = 'payment'")
                total_pay = cursor.fetchone()['total_pay']
                cash_balance = total_rec - total_pay

                cursor.execute("SELECT COALESCE(SUM(amount), 0) as total FROM cash_flow WHERE type = 'receipt' AND fund_type = 'cash'")
                rec_cash = cursor.fetchone()['total']
                cursor.execute("SELECT COALESCE(SUM(amount), 0) as total FROM cash_flow WHERE type = 'payment' AND fund_type = 'cash'")
                pay_cash = cursor.fetchone()['total']
                drawer_cash = rec_cash - pay_cash

                cursor.execute("SELECT COALESCE(SUM(amount), 0) as total FROM cash_flow WHERE type = 'receipt' AND fund_type = 'bank'")
                rec_bank = cursor.fetchone()['total']
                cursor.execute("SELECT COALESCE(SUM(amount), 0) as total FROM cash_flow WHERE type = 'payment' AND fund_type = 'bank'")
                pay_bank = cursor.fetchone()['total']
                bank_balance = rec_bank - pay_bank

                cursor.execute(f"""
                    SELECT p.id, p.name, p.code, p.unit, SUM(oi.quantity) as sold_qty, SUM(oi.subtotal) as sold_amount
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    JOIN products p ON oi.product_id = p.id
                    WHERE o.status = 'completed' {date_sql.replace('created_at', 'o.created_at')}
                    GROUP BY p.id
                    ORDER BY sold_qty DESC
                    LIMIT 5
                """, params)
                top_products = rows_to_list(cursor.fetchall())

                cursor.execute("""
                    SELECT id, code, name, category, unit, stock, min_stock, cost_price, sale_price
                    FROM products
                    WHERE stock <= min_stock
                    ORDER BY stock ASC
                    LIMIT 10
                """)
                low_stock_products = rows_to_list(cursor.fetchall())

                self.send_json({
                    "date_filter": date_filter,
                    "today_revenue": net_sales,
                    "today_profit": net_profit,
                    "today_orders": sales_row['total_orders'],
                    "today_returns": total_returns,
                    "inventory_value": inv_row['total_val'],
                    "total_products": inv_row['total_prods'],
                    "low_stock_count": low_stock,
                    "customer_debt": cust_debt,
                    "supplier_debt": sup_debt,
                    "cash_balance": cash_balance,
                    "drawer_cash": drawer_cash,
                    "bank_balance": bank_balance,
                    "top_products": top_products,
                    "low_stock_products": low_stock_products
                })
                return

            # 8. PRODUCTS & INVENTORY
            if path == '/api/products':
                user, ok = self.require_auth('products:view', conn=conn)
                if not ok:
                    return

                q = query.get('q', [''])[0].strip()
                category = query.get('category', [''])[0].strip()
                sql = "SELECT * FROM products WHERE 1=1"
                params = []
                if q:
                    sql += " AND (name LIKE ? OR code LIKE ? OR barcode LIKE ?)"
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
                if category and category != 'all':
                    sql += " AND category = ?"
                    params.append(category)
                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                items = rows_to_list(cursor.fetchall())

                # Strict Cost Price Protection: if role lacks 'products:view_cost', mask cost_price!
                can_view_cost = auth.has_permission(user['role'], 'products:view_cost')
                if not can_view_cost:
                    for item in items:
                        item['cost_price'] = 0

                self.send_json(items)
                return

            if path.startswith('/api/products/') and path.endswith('/logs'):
                user, ok = self.require_auth('inventory:view', conn=conn)
                if not ok:
                    return
                prod_id = path.split('/')[3]
                cursor.execute("""
                    SELECT il.*, p.name as product_name, p.code as product_code, p.unit
                    FROM inventory_logs il
                    JOIN products p ON il.product_id = p.id
                    WHERE il.product_id = ?
                    ORDER BY il.id DESC
                """, (prod_id,))
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            if path == '/api/categories':
                user, ok = self.require_auth('products:view', conn=conn)
                if not ok:
                    return
                cursor.execute("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''")
                cats = [r['category'] for r in cursor.fetchall()]
                self.send_json(cats)
                return

            # 9. CUSTOMERS & CUSTOM PRICING
            if path == '/api/customers':
                user, ok = self.require_auth('customers:view', conn=conn)
                if not ok:
                    return
                q = query.get('q', [''])[0].strip()
                if q:
                    cursor.execute("SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR code LIKE ? ORDER BY id DESC",
                                   (f"%{q}%", f"%{q}%", f"%{q}%"))
                else:
                    cursor.execute("SELECT * FROM customers ORDER BY id DESC")
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            if path.startswith('/api/customers/') and path.endswith('/prices'):
                user, ok = self.require_auth('customers:view', conn=conn)
                if not ok:
                    return
                cust_id = path.split('/')[3]
                cursor.execute("""
                    SELECT cpp.*, p.code as product_code, p.name as product_name, p.unit, p.sale_price as default_sale_price
                    FROM customer_product_prices cpp
                    JOIN products p ON cpp.product_id = p.id
                    WHERE cpp.customer_id = ?
                    ORDER BY cpp.id DESC
                """, (cust_id,))
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            if path == '/api/customer-prices/lookup':
                user, ok = self.require_auth('customers:view', conn=conn)
                if not ok:
                    return
                cust_id = query.get('customer_id', [None])[0]
                prod_id = query.get('product_id', [None])[0]
                if not cust_id or not prod_id:
                    self.send_error_json("customer_id and product_id required")
                    return
                cursor.execute("""
                    SELECT cpp.custom_price, p.sale_price as default_sale_price
                    FROM products p
                    LEFT JOIN customer_product_prices cpp ON cpp.product_id = p.id AND cpp.customer_id = ?
                    WHERE p.id = ?
                """, (cust_id, prod_id))
                row = cursor.fetchone()
                if not row:
                    self.send_error_json("Product not found", 404)
                    return
                res = {
                    "product_id": int(prod_id),
                    "customer_id": int(cust_id),
                    "custom_price": row['custom_price'],
                    "default_price": row['default_sale_price'],
                    "effective_price": row['custom_price'] if row['custom_price'] is not None else row['default_sale_price'],
                    "has_custom_price": row['custom_price'] is not None
                }
                self.send_json(res)
                return

            # 10. SUPPLIERS
            if path == '/api/suppliers':
                user, ok = self.require_auth('suppliers:view', conn=conn)
                if not ok:
                    return
                q = query.get('q', [''])[0].strip()
                if q:
                    cursor.execute("SELECT * FROM suppliers WHERE name LIKE ? OR phone LIKE ? OR code LIKE ? ORDER BY id DESC",
                                   (f"%{q}%", f"%{q}%", f"%{q}%"))
                else:
                    cursor.execute("SELECT * FROM suppliers ORDER BY id DESC")
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            # 11. ORDERS
            if path == '/api/orders':
                user, ok = self.require_auth('orders:view', conn=conn)
                if not ok:
                    return
                cursor.execute("SELECT * FROM orders ORDER BY id DESC LIMIT 100")
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            if path.startswith('/api/orders/') and not path.endswith('/items'):
                user, ok = self.require_auth('orders:view', conn=conn)
                if not ok:
                    return
                order_id = path.split('/')[3]
                cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                order = row_to_dict(cursor.fetchone())
                if not order:
                    self.send_error_json("Order not found", 404)
                    return
                cursor.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
                order['items'] = rows_to_list(cursor.fetchall())
                self.send_json(order)
                return

            # 12. PURCHASES
            if path == '/api/purchases':
                user, ok = self.require_auth('purchases:view', conn=conn)
                if not ok:
                    return
                cursor.execute("SELECT * FROM purchases ORDER BY id DESC LIMIT 100")
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            if path.startswith('/api/purchases/') and not path.endswith('/items'):
                user, ok = self.require_auth('purchases:view', conn=conn)
                if not ok:
                    return
                pid = path.split('/')[3]
                cursor.execute("SELECT * FROM purchases WHERE id = ?", (pid,))
                purchase = row_to_dict(cursor.fetchone())
                if not purchase:
                    self.send_error_json("Purchase not found", 404)
                    return
                cursor.execute("SELECT * FROM purchase_items WHERE purchase_id = ?", (pid,))
                purchase['items'] = rows_to_list(cursor.fetchall())
                self.send_json(purchase)
                return

            # 13. RETURNS
            if path == '/api/returns':
                user, ok = self.require_auth('returns:view', conn=conn)
                if not ok:
                    return
                cursor.execute("SELECT * FROM returns ORDER BY id DESC LIMIT 100")
                returns = rows_to_list(cursor.fetchall())
                for r in returns:
                    cursor.execute("SELECT * FROM return_items WHERE return_id = ?", (r['id'],))
                    r['items'] = rows_to_list(cursor.fetchall())
                self.send_json(returns)
                return

            # 14. CASH FLOW
            if path == '/api/cash-flow':
                user, ok = self.require_auth('cash_flow:view', conn=conn)
                if not ok:
                    return
                flow_type = query.get('type', ['all'])[0]
                sql = "SELECT * FROM cash_flow WHERE 1=1"
                params = []
                if flow_type in ('receipt', 'payment'):
                    sql += " AND type = ?"
                    params.append(flow_type)
                sql += " ORDER BY id DESC LIMIT 150"
                cursor.execute(sql, params)
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            # 15. SETTINGS
            if path == '/api/settings':
                user, ok = self.require_auth(conn=conn)
                if not ok:
                    return
                cursor.execute("SELECT key, value FROM store_settings")
                settings = {r['key']: r['value'] for r in cursor.fetchall()}
                self.send_json(settings)
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            self.send_error_json(f"Internal server error: {str(e)}", 500)
        finally:
            conn.close()

    # ------------------ POST HANDLERS ------------------
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_body()
        client_ip = self.get_client_ip()

        conn = get_db()
        cursor = conn.cursor()

        try:
            # 1. INITIAL BOOTSTRAP (SAFE FIRST RUN SETUP)
            if path == '/api/auth/bootstrap':
                if not auth.is_bootstrap_needed(cursor):
                    self.send_error_json("Hệ thống đã có tài khoản quản trị. Chức năng bootstrap đã đóng vĩnh viễn.", 403, "BOOTSTRAP_LOCKED")
                    return

                bootstrap_token = os.environ.get('KIOTPRO_BOOTSTRAP_TOKEN', '')
                provided_token = str(body.get('bootstrap_token', ''))
                if bootstrap_token and not hmac.compare_digest(provided_token, bootstrap_token):
                    self.send_error_json("Mã thiết lập ban đầu không hợp lệ.", 403, "INVALID_BOOTSTRAP_TOKEN")
                    return
                
                username = body.get('username', '').strip()
                full_name = body.get('full_name', '').strip()
                password = body.get('password', '').strip()

                try:
                    user_id = auth.bootstrap_admin(cursor, username, full_name, password, client_ip)
                    token, expires_at = auth.create_session(cursor, user_id, client_ip, self.headers.get('User-Agent', ''))
                    conn.commit()

                    self.send_response(201)
                    self.set_session_cookie(token)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    user_payload = {
                        "id": user_id,
                        "username": username.lower(),
                        "full_name": full_name,
                        "role": "admin",
                        "is_active": 1
                    }
                    resp = json.dumps({"user": user_payload, "token": token}, ensure_ascii=False).encode('utf-8')
                    self.send_header('Content-Length', str(len(resp)))
                    self.end_headers()
                    self.wfile.write(resp)
                    return
                except ValueError as ve:
                    conn.rollback()
                    self.send_error_json(str(ve), 400)
                    return

            # 2. LOGIN
            if path == '/api/auth/login':
                username = body.get('username', '').strip().lower()
                password = body.get('password', '').strip()

                if not username or not password:
                    self.send_error_json("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu", 400)
                    return

                cursor.execute("SELECT * FROM users WHERE LOWER(username) = ?", (username,))
                user_row = cursor.fetchone()

                if not user_row or not auth.verify_password(password, user_row['password_hash']):
                    auth.log_audit(
                        cursor=cursor,
                        user_id=None,
                        user_name=username,
                        action='USER_LOGIN_FAILED',
                        entity_type='user',
                        entity_id=None,
                        entity_code=username,
                        details={'message': 'Đăng nhập thất bại: sai tên đăng nhập hoặc mật khẩu'},
                        ip_address=client_ip
                    )
                    conn.commit()
                    self.send_error_json("Tên đăng nhập hoặc mật khẩu không chính xác", 400)
                    return

                if not user_row['is_active']:
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user_row['id'],
                        user_name=user_row['full_name'],
                        action='USER_LOGIN_BLOCKED',
                        entity_type='user',
                        entity_id=user_row['id'],
                        entity_code=username,
                        details={'message': 'Đăng nhập thất bại: tài khoản đã bị khóa'},
                        ip_address=client_ip
                    )
                    conn.commit()
                    self.send_error_json("Tài khoản của bạn đã bị khóa. Vui lòng liên hệ Quản trị viên.", 403, "ACCOUNT_LOCKED")
                    return

                # Success: update last login and create session
                now_str = get_now_str()
                cursor.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_str, user_row['id']))
                token, expires_at = auth.create_session(cursor, user_row['id'], client_ip, self.headers.get('User-Agent', ''))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user_row['id'],
                    user_name=user_row['full_name'],
                    action='USER_LOGIN',
                    entity_type='user',
                    entity_id=user_row['id'],
                    entity_code=username,
                    details={'message': 'Đăng nhập thành công', 'role': user_row['role']},
                    ip_address=client_ip
                )
                conn.commit()

                user_data = {
                    "id": user_row['id'],
                    "username": user_row['username'],
                    "full_name": user_row['full_name'],
                    "role": user_row['role'],
                    "is_active": user_row['is_active']
                }

                self.send_response(200)
                self.set_session_cookie(token)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                resp = json.dumps({"user": user_data, "token": token}, ensure_ascii=False).encode('utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            # 3. LOGOUT
            if path == '/api/auth/logout':
                user = self.authenticate(conn=conn)
                token = self.get_session_token()
                if token:
                    auth.revoke_session(cursor, token)
                if user:
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='USER_LOGOUT',
                        entity_type='user',
                        entity_id=user['id'],
                        entity_code=user['username'],
                        details={'message': 'Đăng xuất khỏi hệ thống'},
                        ip_address=client_ip
                    )
                conn.commit()
                self.send_response(200)
                self.clear_session_cookie()
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                resp = json.dumps({"success": True, "message": "Đăng xuất thành công"}, ensure_ascii=False).encode('utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return

            # 4. CHANGE OWN PASSWORD
            if path == '/api/auth/change-password':
                user, ok = self.require_auth(conn=conn)
                if not ok:
                    return

                old_pw = body.get('old_password', '')
                new_pw = body.get('new_password', '')

                cursor.execute("SELECT password_hash FROM users WHERE id = ?", (user['id'],))
                pw_row = cursor.fetchone()

                if not pw_row or not auth.verify_password(old_pw, pw_row['password_hash']):
                    self.send_error_json("Mật khẩu hiện tại không đúng", 400)
                    return

                try:
                    new_hash = auth.hash_password(new_pw)
                    now_str = get_now_str()
                    cursor.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", (new_hash, now_str, user['id']))
                    
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='USER_PASSWORD_CHANGE',
                        entity_type='user',
                        entity_id=user['id'],
                        entity_code=user['username'],
                        details={'message': 'Người dùng tự đổi mật khẩu thành công'},
                        ip_address=client_ip
                    )
                    conn.commit()
                    self.send_json({"success": True, "message": "Đổi mật khẩu thành công"})
                    return
                except ValueError as ve:
                    self.send_error_json(str(ve), 400)
                    return

            # 5. USER MANAGEMENT (Admin only: users:manage)
            if path == '/api/users':
                user, ok = self.require_auth('users:manage', conn=conn)
                if not ok:
                    return

                username = body.get('username', '').strip().lower()
                full_name = body.get('full_name', '').strip()
                role = body.get('role', 'viewer')
                password = body.get('password', '').strip()

                if not username or len(username) < 3:
                    self.send_error_json("Tên đăng nhập phải có ít nhất 3 ký tự", 400)
                    return
                if not full_name:
                    self.send_error_json("Họ và tên không được để trống", 400)
                    return
                if role not in auth.ROLES:
                    self.send_error_json(f"Vai trò '{role}' không hợp lệ", 400)
                    return

                cursor.execute("SELECT id FROM users WHERE LOWER(username) = ?", (username,))
                if cursor.fetchone():
                    self.send_error_json("Tên đăng nhập đã tồn tại trên hệ thống", 400)
                    return

                try:
                    pw_hash = auth.hash_password(password)
                    now_str = get_now_str()
                    cursor.execute("""
                        INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
                        VALUES (?, ?, ?, ?, 1, ?, ?)
                    """, (username, pw_hash, full_name, role, now_str, now_str))
                    new_uid = cursor.lastrowid

                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='USER_CREATE',
                        entity_type='user',
                        entity_id=new_uid,
                        entity_code=username,
                        details={'username': username, 'full_name': full_name, 'role': role},
                        ip_address=client_ip
                    )
                    conn.commit()

                    self.send_json({
                        "id": new_uid,
                        "username": username,
                        "full_name": full_name,
                        "role": role,
                        "is_active": 1,
                        "created_at": now_str
                    }, 201)
                    return
                except ValueError as ve:
                    self.send_error_json(str(ve), 400)
                    return

            # 6. USER LOCK / UNLOCK / RESET-PASSWORD / REVOKE-SESSIONS
            if path.startswith('/api/users/') and path.endswith('/lock'):
                user, ok = self.require_auth('users:manage', conn=conn)
                if not ok:
                    return
                target_uid = int(path.split('/')[3])
                if target_uid == user['id']:
                    self.send_error_json("Bạn không thể tự khóa tài khoản của chính mình", 400)
                    return

                cursor.execute("SELECT username, full_name FROM users WHERE id = ?", (target_uid,))
                target_row = cursor.fetchone()
                if not target_row:
                    self.send_error_json("Không tìm thấy người dùng", 404)
                    return

                now_str = get_now_str()
                cursor.execute("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?", (now_str, target_uid))
                auth.revoke_user_sessions(cursor, target_uid)

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='USER_LOCK',
                    entity_type='user',
                    entity_id=target_uid,
                    entity_code=target_row['username'],
                    details={'message': f"Đã khóa tài khoản {target_row['username']} và thu hồi tất cả phiên đăng nhập"},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": f"Đã khóa tài khoản {target_row['username']}"})
                return

            if path.startswith('/api/users/') and path.endswith('/unlock'):
                user, ok = self.require_auth('users:manage', conn=conn)
                if not ok:
                    return
                target_uid = int(path.split('/')[3])

                cursor.execute("SELECT username, full_name FROM users WHERE id = ?", (target_uid,))
                target_row = cursor.fetchone()
                if not target_row:
                    self.send_error_json("Không tìm thấy người dùng", 404)
                    return

                now_str = get_now_str()
                cursor.execute("UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?", (now_str, target_uid))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='USER_UNLOCK',
                    entity_type='user',
                    entity_id=target_uid,
                    entity_code=target_row['username'],
                    details={'message': f"Đã mở khóa tài khoản {target_row['username']}"},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": f"Đã mở khóa tài khoản {target_row['username']}"})
                return

            if path.startswith('/api/users/') and path.endswith('/reset-password'):
                user, ok = self.require_auth('users:manage', conn=conn)
                if not ok:
                    return
                target_uid = int(path.split('/')[3])
                new_pw = body.get('new_password', '').strip()

                cursor.execute("SELECT username, full_name FROM users WHERE id = ?", (target_uid,))
                target_row = cursor.fetchone()
                if not target_row:
                    self.send_error_json("Không tìm thấy người dùng", 404)
                    return

                try:
                    pw_hash = auth.hash_password(new_pw)
                    now_str = get_now_str()
                    cursor.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", (pw_hash, now_str, target_uid))
                    auth.revoke_user_sessions(cursor, target_uid)

                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='USER_RESET_PASSWORD',
                        entity_type='user',
                        entity_id=target_uid,
                        entity_code=target_row['username'],
                        details={'message': f"Quản trị viên đã đặt lại mật khẩu cho tài khoản {target_row['username']}"},
                        ip_address=client_ip
                    )
                    conn.commit()
                    self.send_json({"success": True, "message": f"Đặt lại mật khẩu cho {target_row['username']} thành công"})
                    return
                except ValueError as ve:
                    self.send_error_json(str(ve), 400)
                    return

            if path.startswith('/api/users/') and path.endswith('/revoke-sessions'):
                user, ok = self.require_auth('users:manage', conn=conn)
                if not ok:
                    return
                target_uid = int(path.split('/')[3])

                cursor.execute("SELECT username FROM users WHERE id = ?", (target_uid,))
                target_row = cursor.fetchone()
                if not target_row:
                    self.send_error_json("Không tìm thấy người dùng", 404)
                    return

                auth.revoke_user_sessions(cursor, target_uid)
                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='USER_REVOKE_SESSIONS',
                    entity_type='user',
                    entity_id=target_uid,
                    entity_code=target_row['username'],
                    details={'message': f"Đã thu hồi tất cả phiên đăng nhập của {target_row['username']}"},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": f"Đã thu hồi phiên đăng nhập của {target_row['username']}"})
                return

            # 7. BUSINESS: PRODUCTS (Kho / Quản lý / Quản trị)
            if path == '/api/products':
                user, ok = self.require_auth('products:manage', conn=conn)
                if not ok:
                    return

                code = body.get('code') or generate_code('SP', 'products', cursor)
                name = body.get('name')
                if not name:
                    self.send_error_json("Tên sản phẩm không được để trống")
                    return

                category = body.get('category', 'Chung')
                unit = body.get('unit', 'Cái')
                sub_unit = body.get('sub_unit')
                sub_unit_ratio = float(body.get('sub_unit_ratio') or 1)
                cost_price = float(body.get('cost_price', 0))
                sale_price = float(body.get('sale_price', 0))
                stock = float(body.get('stock', 0))
                min_stock = float(body.get('min_stock', 5))
                barcode = body.get('barcode', '')

                if cost_price < 0 or sale_price < 0 or stock < 0 or min_stock < 0:
                    self.send_error_json("Giá trị số lượng hoặc đơn giá không được âm", 400)
                    return

                now = get_now_str()

                cursor.execute("""
                    INSERT INTO products (code, barcode, name, category, unit, sub_unit, sub_unit_ratio, cost_price, sale_price, stock, min_stock, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, barcode, name, category, unit, sub_unit, sub_unit_ratio, cost_price, sale_price, stock, min_stock, now, now))
                pid = cursor.lastrowid

                if stock > 0:
                    cursor.execute("""
                        INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                        VALUES (?, 'adjustment', 'INIT', ?, 0, ?, 'Tồn đầu kỳ khởi tạo', ?, ?, ?)
                    """, (pid, stock, stock, now, user['id'], user['full_name']))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PRODUCT_CREATE',
                    entity_type='product',
                    entity_id=pid,
                    entity_code=code,
                    details={'name': name, 'category': category, 'sale_price': sale_price, 'stock': stock},
                    ip_address=client_ip
                )
                conn.commit()

                cursor.execute("SELECT * FROM products WHERE id = ?", (pid,))
                self.send_json(row_to_dict(cursor.fetchone()), 201)
                return

            # 8. BUSINESS: CUSTOMERS
            if path == '/api/customers':
                user, ok = self.require_auth('customers:manage', conn=conn)
                if not ok:
                    return

                code = body.get('code') or generate_code('KH', 'customers', cursor)
                name = body.get('name')
                if not name:
                    self.send_error_json("Tên khách hàng không được để trống")
                    return

                phone = body.get('phone', '')
                email = body.get('email', '')
                address = body.get('address', '')
                group_name = body.get('group_name', 'Khách lẻ')
                debt = float(body.get('debt', 0))
                notes = body.get('notes', '')
                now = get_now_str()

                cursor.execute("""
                    INSERT INTO customers (code, name, phone, email, address, group_name, debt, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, name, phone, email, address, group_name, debt, notes, now))
                cid = cursor.lastrowid

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='CUSTOMER_CREATE',
                    entity_type='customer',
                    entity_id=cid,
                    entity_code=code,
                    details={'name': name, 'phone': phone, 'group_name': group_name, 'initial_debt': debt},
                    ip_address=client_ip
                )
                conn.commit()

                cursor.execute("SELECT * FROM customers WHERE id = ?", (cid,))
                self.send_json(row_to_dict(cursor.fetchone()), 201)
                return

            if path.startswith('/api/customers/') and path.endswith('/prices'):
                user, ok = self.require_auth('customers:manage', conn=conn)
                if not ok:
                    return

                cust_id = int(path.split('/')[3])
                prod_id = body.get('product_id')
                custom_price = float(body.get('custom_price', 0))
                notes = body.get('notes', '')

                if not prod_id or custom_price < 0:
                    self.send_error_json("Sản phẩm và đơn giá riêng hợp lệ là bắt buộc")
                    return

                now = get_now_str()
                cursor.execute("""
                    INSERT INTO customer_product_prices (customer_id, product_id, custom_price, notes, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(customer_id, product_id) DO UPDATE SET
                        custom_price = excluded.custom_price,
                        notes = excluded.notes,
                        updated_at = excluded.updated_at
                """, (cust_id, prod_id, custom_price, notes, now))

                cursor.execute("SELECT name, code FROM customers WHERE id = ?", (cust_id,))
                cust_info = cursor.fetchone()

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='CUSTOMER_PRICE_SET',
                    entity_type='customer',
                    entity_id=cust_id,
                    entity_code=cust_info['code'] if cust_info else str(cust_id),
                    details={'product_id': prod_id, 'custom_price': custom_price},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": "Đã lưu giá riêng cho khách hàng"})
                return

            if path.startswith('/api/customers/') and path.endswith('/pay-debt'):
                user, ok = self.require_auth('debt:manage', conn=conn)
                if not ok:
                    return

                cust_id = int(path.split('/')[3])
                amount = float(body.get('amount', 0))
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', 'Thu nợ khách hàng')

                if amount <= 0:
                    self.send_error_json("Số tiền thanh toán nợ phải lớn hơn 0", 400)
                    return

                cursor.execute("SELECT * FROM customers WHERE id = ?", (cust_id,))
                customer = cursor.fetchone()
                if not customer:
                    self.send_error_json("Khách hàng không tồn tại", 404)
                    return

                current_debt = customer['debt']
                if amount > current_debt:
                    self.send_error_json(f"Số tiền thu ({amount:,.0f} đ) không được vượt quá số dư nợ hiện tại ({current_debt:,.0f} đ)", 400)
                    return

                new_debt = max(0, current_debt - amount)
                now = get_now_str()
                cursor.execute("UPDATE customers SET debt = ? WHERE id = ?", (new_debt, cust_id))

                receipt_code = generate_code('PT', 'cash_flow', cursor)
                cursor.execute("""
                    INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, notes, created_at, user_id, user_name)
                    VALUES (?, 'receipt', 'Thu nợ khách hàng', ?, 'customer', ?, ?, ?, ?, ?, ?, ?)
                """, (receipt_code, amount, cust_id, customer['name'], fund_type, notes, now, user['id'], user['full_name']))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='DEBT_PAY_CUSTOMER',
                    entity_type='customer',
                    entity_id=cust_id,
                    entity_code=customer['code'],
                    details={'amount': amount, 'fund_type': fund_type, 'debt_before': current_debt, 'debt_after': new_debt, 'receipt_code': receipt_code},
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({
                    "success": True,
                    "receipt_code": receipt_code,
                    "paid_amount": amount,
                    "remaining_debt": new_debt
                })
                return

            # 9. BUSINESS: SUPPLIERS
            if path == '/api/suppliers':
                user, ok = self.require_auth('suppliers:manage', conn=conn)
                if not ok:
                    return

                code = body.get('code') or generate_code('NCC', 'suppliers', cursor)
                name = body.get('name')
                if not name:
                    self.send_error_json("Tên nhà cung cấp không được để trống")
                    return

                phone = body.get('phone', '')
                email = body.get('email', '')
                address = body.get('address', '')
                debt = float(body.get('debt', 0))
                notes = body.get('notes', '')
                now = get_now_str()

                cursor.execute("""
                    INSERT INTO suppliers (code, name, phone, email, address, debt, notes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, name, phone, email, address, debt, notes, now))
                sid = cursor.lastrowid

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='SUPPLIER_CREATE',
                    entity_type='supplier',
                    entity_id=sid,
                    entity_code=code,
                    details={'name': name, 'phone': phone, 'initial_debt': debt},
                    ip_address=client_ip
                )
                conn.commit()

                cursor.execute("SELECT * FROM suppliers WHERE id = ?", (sid,))
                self.send_json(row_to_dict(cursor.fetchone()), 201)
                return

            if path.startswith('/api/suppliers/') and path.endswith('/pay-debt'):
                user, ok = self.require_auth('debt:manage', conn=conn)
                if not ok:
                    return

                sup_id = int(path.split('/')[3])
                amount = float(body.get('amount', 0))
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', 'Trả nợ nhà cung cấp')

                if amount <= 0:
                    self.send_error_json("Số tiền trả nợ phải lớn hơn 0", 400)
                    return

                cursor.execute("SELECT * FROM suppliers WHERE id = ?", (sup_id,))
                supplier = cursor.fetchone()
                if not supplier:
                    self.send_error_json("Nhà cung cấp không tồn tại", 404)
                    return

                current_debt = supplier['debt']
                if amount > current_debt:
                    self.send_error_json(f"Số tiền trả ({amount:,.0f} đ) không được vượt quá số dư nợ hiện tại ({current_debt:,.0f} đ)", 400)
                    return

                new_debt = max(0, current_debt - amount)
                now = get_now_str()
                cursor.execute("UPDATE suppliers SET debt = ? WHERE id = ?", (new_debt, sup_id))

                payment_code = generate_code('PC', 'cash_flow', cursor)
                cursor.execute("""
                    INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, notes, created_at, user_id, user_name)
                    VALUES (?, 'payment', 'Trả nợ nhà cung cấp', ?, 'supplier', ?, ?, ?, ?, ?, ?, ?)
                """, (payment_code, amount, sup_id, supplier['name'], fund_type, notes, now, user['id'], user['full_name']))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='DEBT_PAY_SUPPLIER',
                    entity_type='supplier',
                    entity_id=sup_id,
                    entity_code=supplier['code'],
                    details={'amount': amount, 'fund_type': fund_type, 'debt_before': current_debt, 'debt_after': new_debt, 'payment_code': payment_code},
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({
                    "success": True,
                    "payment_code": payment_code,
                    "paid_amount": amount,
                    "remaining_debt": new_debt
                })
                return

            # 10. BUSINESS: ORDERS / POS (Thu ngân, Quản lý, Quản trị)
            if path == '/api/orders':
                user, ok = self.require_auth('orders:create', conn=conn)
                if not ok:
                    return

                items = body.get('items', [])
                if not items:
                    self.send_error_json("Đơn hàng phải có ít nhất một sản phẩm", 400)
                    return

                cursor.execute("SELECT value FROM store_settings WHERE key = 'allow_negative_stock'")
                allow_neg_row = cursor.fetchone()
                allow_negative_stock = (allow_neg_row['value'].lower() == 'true') if allow_neg_row else False

                for item in items:
                    qty = float(item.get('quantity', 0))
                    if qty <= 0:
                        self.send_error_json("Số lượng sản phẩm trong đơn phải lớn hơn 0", 400)
                        return
                    if not allow_negative_stock:
                        cursor.execute("SELECT stock, name FROM products WHERE id = ?", (item['product_id'],))
                        p = cursor.fetchone()
                        if p and p['stock'] < qty:
                            self.send_error_json(f"Sản phẩm '{p['name']}' chỉ còn tồn {p['stock']}, không đủ để bán {qty}", 400)
                            return

                customer_id = body.get('customer_id')
                customer_name = body.get('customer_name', 'Khách lẻ')
                discount = max(0, float(body.get('discount', 0)))
                vat_percent = max(0, float(body.get('vat_percent', 0)))
                customer_paid = max(0, float(body.get('paid_amount', 0)))
                payment_method = body.get('payment_method', 'cash')
                notes = body.get('notes', '')
                now = get_now_str()

                total_amount = 0
                total_cost = 0
                processed_items = []

                for item in items:
                    cursor.execute("SELECT * FROM products WHERE id = ?", (item['product_id'],))
                    p = cursor.fetchone()
                    if not p:
                        self.send_error_json(f"Sản phẩm ID {item['product_id']} không tồn tại", 400)
                        return

                    sale_price = float(item.get('sale_price', p['sale_price']))
                    if sale_price < 0:
                        self.send_error_json("Đơn giá sản phẩm không được âm", 400)
                        return

                    qty = float(item['quantity'])
                    subtotal = qty * sale_price
                    total_amount += subtotal

                    cost_price = p['cost_price']
                    total_cost += qty * cost_price

                    processed_items.append({
                        "product_id": p['id'],
                        "product_code": p['code'],
                        "product_name": p['name'],
                        "unit": p['unit'],
                        "quantity": qty,
                        "cost_price": cost_price,
                        "sale_price": sale_price,
                        "is_custom_price": item.get('is_custom_price', 0),
                        "save_as_custom": item.get('save_as_custom_price', False),
                        "subtotal": subtotal,
                        "current_stock": p['stock']
                    })

                net_revenue = max(0, total_amount - discount)
                vat_amount = round(net_revenue * (vat_percent / 100))
                final_amount = net_revenue + vat_amount

                actual_paid = min(customer_paid, final_amount)
                change_amount = max(0, customer_paid - final_amount)
                debt_amount = max(0, final_amount - customer_paid)
                profit = net_revenue - total_cost

                if debt_amount > 0 and (not customer_id or customer_id == 1):
                    self.send_error_json("Khách lẻ không thể ghi nợ. Vui lòng chọn khách hàng cụ thể hoặc thanh toán đủ.", 400)
                    return

                code = generate_code('HD', 'orders', cursor)

                cursor.execute("""
                    INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, customer_paid, paid_amount, change_amount, debt_amount, payment_method, status, total_cost, profit, notes, created_at, user_id, user_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
                """, (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, customer_paid, actual_paid, change_amount, debt_amount, payment_method, total_cost, profit, notes, now, user['id'], user['full_name']))
                order_id = cursor.lastrowid

                for it in processed_items:
                    cursor.execute("""
                        INSERT INTO order_items (order_id, product_id, product_code, product_name, unit, quantity, cost_price, sale_price, is_custom_price, subtotal)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (order_id, it['product_id'], it['product_code'], it['product_name'], it['unit'], it['quantity'], it['cost_price'], it['sale_price'], 1 if it['is_custom_price'] else 0, it['subtotal']))

                    new_stock = it['current_stock'] - it['quantity']
                    cursor.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, it['product_id']))

                    cursor.execute("""
                        INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                        VALUES (?, 'output', ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (it['product_id'], code, -it['quantity'], it['current_stock'], new_stock, f"Xuất bán theo hóa đơn {code}", now, user['id'], user['full_name']))

                    if it.get('save_as_custom') and customer_id and customer_id != 1:
                        cursor.execute("""
                            INSERT INTO customer_product_prices (customer_id, product_id, custom_price, notes, updated_at)
                            VALUES (?, ?, ?, 'Lưu tự động từ quầy POS', ?)
                            ON CONFLICT(customer_id, product_id) DO UPDATE SET
                                custom_price = excluded.custom_price,
                                updated_at = excluded.updated_at
                        """, (customer_id, it['product_id'], it['sale_price'], now))

                if actual_paid > 0 and payment_method != 'debt':
                    rec_code = generate_code('PT', 'cash_flow', cursor)
                    cursor.execute("""
                        INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at, user_id, user_name)
                        VALUES (?, 'receipt', 'Bán hàng', ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (rec_code, actual_paid, customer_id, customer_name, payment_method, code, f"Thu tiền bán hàng hóa đơn {code}", now, user['id'], user['full_name']))

                if customer_id and customer_id != 1:
                    cursor.execute("""
                        UPDATE customers 
                        SET debt = debt + ?, total_spent = total_spent + ?
                        WHERE id = ?
                    """, (debt_amount, final_amount, customer_id))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='ORDER_CREATE',
                    entity_type='order',
                    entity_id=order_id,
                    entity_code=code,
                    details={
                        'customer_name': customer_name,
                        'items_count': len(processed_items),
                        'total_amount': total_amount,
                        'discount': discount,
                        'vat_amount': vat_amount,
                        'final_amount': final_amount,
                        'actual_paid': actual_paid,
                        'change_amount': change_amount,
                        'debt_amount': debt_amount,
                        'payment_method': payment_method
                    },
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({
                    "id": order_id,
                    "code": code,
                    "total_amount": total_amount,
                    "net_revenue": net_revenue,
                    "vat_amount": vat_amount,
                    "final_amount": final_amount,
                    "paid_amount": actual_paid,
                    "change_amount": change_amount,
                    "debt_amount": debt_amount
                }, 201)
                return

            # 11. BUSINESS: PURCHASES (Kho / Quản lý / Quản trị)
            if path == '/api/purchases':
                user, ok = self.require_auth('purchases:create', conn=conn)
                if not ok:
                    return

                items = body.get('items', [])
                if not items:
                    self.send_error_json("Phiếu nhập hàng phải có ít nhất một sản phẩm", 400)
                    return

                supplier_id = body.get('supplier_id')
                supplier_name = body.get('supplier_name', 'Nhà cung cấp')
                discount = max(0, float(body.get('discount', 0)))
                paid_amount = max(0, float(body.get('paid_amount', 0)))
                payment_method = body.get('payment_method', 'cash')
                notes = body.get('notes', '')
                now = get_now_str()

                total_amount = 0
                for it in items:
                    qty = float(it.get('quantity', 0))
                    price = float(it.get('import_price', 0))
                    if qty <= 0 or price < 0:
                        self.send_error_json("Số lượng hoặc giá nhập không hợp lệ", 400)
                        return
                    total_amount += qty * price

                final_amount = max(0, total_amount - discount)
                debt_amount = max(0, final_amount - paid_amount)

                code = generate_code('PN', 'purchases', cursor)

                cursor.execute("""
                    INSERT INTO purchases (code, supplier_id, supplier_name, total_amount, discount, final_amount, paid_amount, debt_amount, payment_method, status, notes, created_at, user_id, user_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)
                """, (code, supplier_id, supplier_name, total_amount, discount, final_amount, paid_amount, debt_amount, payment_method, notes, now, user['id'], user['full_name']))
                pid = cursor.lastrowid

                for it in items:
                    qty = float(it['quantity'])
                    import_price = float(it['import_price'])
                    subtotal = qty * import_price

                    cursor.execute("SELECT * FROM products WHERE id = ?", (it['product_id'],))
                    p = cursor.fetchone()
                    if not p:
                        continue

                    old_stock = p['stock']
                    old_cost = p['cost_price']
                    new_stock = old_stock + qty

                    if new_stock > 0 and old_stock >= 0:
                        new_cost = ((old_stock * old_cost) + (qty * import_price)) / new_stock
                    else:
                        new_cost = import_price

                    cursor.execute("""
                        INSERT INTO purchase_items (purchase_id, product_id, product_code, product_name, unit, quantity, import_price, subtotal)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (pid, p['id'], p['code'], p['name'], p['unit'], qty, import_price, subtotal))

                    cursor.execute("""
                        UPDATE products
                        SET stock = ?, cost_price = ?, updated_at = ?
                        WHERE id = ?
                    """, (new_stock, round(new_cost, 2), now, p['id']))

                    cursor.execute("""
                        INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                        VALUES (?, 'input', ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (p['id'], code, qty, old_stock, new_stock, f"Nhập kho theo phiếu {code} (Giá vốn MAC: {new_cost:,.0f} đ)", now, user['id'], user['full_name']))

                if paid_amount > 0:
                    pay_code = generate_code('PC', 'cash_flow', cursor)
                    cursor.execute("""
                        INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at, user_id, user_name)
                        VALUES (?, 'payment', 'Nhập hàng', ?, 'supplier', ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (pay_code, paid_amount, supplier_id, supplier_name, payment_method, code, f"Chi tiền nhập hàng theo phiếu {code}", now, user['id'], user['full_name']))

                if supplier_id and debt_amount > 0:
                    cursor.execute("UPDATE suppliers SET debt = debt + ? WHERE id = ?", (debt_amount, supplier_id))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PURCHASE_CREATE',
                    entity_type='purchase',
                    entity_id=pid,
                    entity_code=code,
                    details={'supplier_name': supplier_name, 'items_count': len(items), 'final_amount': final_amount, 'paid_amount': paid_amount, 'debt_amount': debt_amount},
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({
                    "id": pid,
                    "code": code,
                    "final_amount": final_amount,
                    "paid_amount": paid_amount,
                    "debt_amount": debt_amount
                }, 201)
                return

            # 12. BUSINESS: RETURNS (Thu ngân, Quản lý, Quản trị)
            if path == '/api/returns':
                user, ok = self.require_auth('returns:create', conn=conn)
                if not ok:
                    return

                items = body.get('items', [])
                if not items:
                    self.send_error_json("Phiếu trả hàng phải có ít nhất một sản phẩm", 400)
                    return

                order_id = body.get('order_id')
                customer_id = body.get('customer_id')
                customer_name = body.get('customer_name', 'Khách hàng')
                refund_amount = max(0, float(body.get('refund_amount', 0)))
                debt_deduct_amount = max(0, float(body.get('debt_deduct_amount', 0)))
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', 'Khách trả lại hàng')
                now = get_now_str()

                order_code = None
                if order_id:
                    cursor.execute("SELECT code FROM orders WHERE id = ?", (order_id,))
                    ord_r = cursor.fetchone()
                    if ord_r:
                        order_code = ord_r['code']

                total_amount = 0
                for it in items:
                    qty = float(it.get('quantity', 0))
                    price = float(it.get('return_price', 0))
                    if qty <= 0 or price < 0:
                        self.send_error_json("Số lượng hoặc giá trả hàng không hợp lệ", 400)
                        return
                    total_amount += qty * price

                if (refund_amount + debt_deduct_amount) > total_amount:
                    self.send_error_json("Tổng tiền hoàn lại và cấn trừ nợ không được vượt quá giá trị hàng trả", 400)
                    return

                if customer_id and debt_deduct_amount > 0:
                    cursor.execute("SELECT debt FROM customers WHERE id = ?", (customer_id,))
                    cust = cursor.fetchone()
                    if cust and debt_deduct_amount > cust['debt']:
                        self.send_error_json(f"Số tiền cấn trừ nợ ({debt_deduct_amount:,.0f} đ) không được vượt quá số dư nợ của khách ({cust['debt']:,.0f} đ)", 400)
                        return

                code = generate_code('TH', 'returns', cursor)

                cursor.execute("""
                    INSERT INTO returns (code, order_id, customer_id, customer_name, total_amount, refund_amount, debt_deduct_amount, fund_type, notes, created_at, user_id, user_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, order_id, customer_id, customer_name, total_amount, refund_amount, debt_deduct_amount, fund_type, notes, now, user['id'], user['full_name']))
                ret_id = cursor.lastrowid

                for it in items:
                    cursor.execute("SELECT * FROM products WHERE id = ?", (it['product_id'],))
                    p = cursor.fetchone()
                    if not p:
                        continue

                    qty = float(it['quantity'])
                    ret_price = float(it['return_price'])
                    cost_price = p['cost_price']
                    subtotal = qty * ret_price

                    cursor.execute("""
                        INSERT INTO return_items (return_id, product_id, product_name, unit, quantity, return_price, cost_price, subtotal)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (ret_id, p['id'], p['name'], p['unit'], qty, ret_price, cost_price, subtotal))

                    old_stock = p['stock']
                    new_stock = old_stock + qty
                    cursor.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, p['id']))

                    cursor.execute("""
                        INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                        VALUES (?, 'return', ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (p['id'], code, qty, old_stock, new_stock, f"Khách trả hàng theo phiếu {code}" + (f" (HĐ gốc: {order_code})" if order_code else ""), now, user['id'], user['full_name']))

                if refund_amount > 0:
                    pay_code = generate_code('PC', 'cash_flow', cursor)
                    cursor.execute("""
                        INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at, user_id, user_name)
                        VALUES (?, 'payment', 'Hoàn tiền trả hàng', ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (pay_code, refund_amount, customer_id, customer_name, fund_type, code, f"Hoàn tiền khách trả hàng theo phiếu {code}", now, user['id'], user['full_name']))

                if customer_id and debt_deduct_amount > 0:
                    cursor.execute("UPDATE customers SET debt = MAX(0, debt - ?) WHERE id = ?", (debt_deduct_amount, customer_id))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='RETURN_CREATE',
                    entity_type='return',
                    entity_id=ret_id,
                    entity_code=code,
                    details={
                        'order_code': order_code,
                        'customer_name': customer_name,
                        'total_amount': total_amount,
                        'refund_amount': refund_amount,
                        'debt_deduct_amount': debt_deduct_amount
                    },
                    ip_address=client_ip
                )

                if order_id and order_code:
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='ORDER_RETURN_PROCESSED',
                        entity_type='order',
                        entity_id=order_id,
                        entity_code=order_code,
                        details={
                            'return_code': code,
                            'total_returned': total_amount,
                            'refund_amount': refund_amount
                        },
                        ip_address=client_ip
                    )

                conn.commit()

                self.send_json({
                    "id": ret_id,
                    "code": code,
                    "total_amount": total_amount,
                    "refund_amount": refund_amount,
                    "debt_deduct_amount": debt_deduct_amount
                }, 201)
                return

            # 13. BUSINESS: INVENTORY ADJUSTMENT / COUNT (Kho / Quản lý / Quản trị)
            if path == '/api/inventory/adjust':
                user, ok = self.require_auth('inventory:adjust', conn=conn)
                if not ok:
                    return

                prod_id = body.get('product_id')
                new_stock = float(body.get('actual_stock', 0))
                reason = body.get('reason', 'Kiểm kho định kỳ')

                cursor.execute("SELECT * FROM products WHERE id = ?", (prod_id,))
                p = cursor.fetchone()
                if not p:
                    self.send_error_json("Sản phẩm không tồn tại", 404)
                    return

                old_stock = p['stock']
                diff = new_stock - old_stock
                now = get_now_str()

                cursor.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, prod_id))

                adj_code = generate_code('KK', 'inventory_logs', cursor)
                cursor.execute("""
                    INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                    VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?)
                """, (prod_id, adj_code, diff, old_stock, new_stock, f"Kiểm kho: {reason} (Chênh lệch: {diff:+g} {p['unit']})", now, user['id'], user['full_name']))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='STOCK_ADJUST',
                    entity_type='product',
                    entity_id=prod_id,
                    entity_code=p['code'],
                    details={'product_name': p['name'], 'old_stock': old_stock, 'new_stock': new_stock, 'diff': diff, 'reason': reason},
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({
                    "product_id": prod_id,
                    "product_name": p['name'],
                    "old_stock": old_stock,
                    "new_stock": new_stock,
                    "difference": diff
                })
                return

            # 14. BUSINESS: CASH FLOW (Kế toán / Quản lý / Quản trị)
            if path == '/api/cash-flow':
                user, ok = self.require_auth('cash_flow:manage', conn=conn)
                if not ok:
                    return

                flow_type = body.get('type')
                category = body.get('category')
                amount = float(body.get('amount', 0))
                target_type = body.get('target_type', 'other')
                target_id = body.get('target_id')
                target_name = body.get('target_name', 'Khác')
                fund_type = body.get('fund_type', 'cash')
                notes = body.get('notes', '')

                if flow_type not in ('receipt', 'payment') or amount <= 0 or not category:
                    self.send_error_json("Loại phiếu, hạng mục và số tiền hợp lệ là bắt buộc", 400)
                    return

                now = get_now_str()
                prefix = 'PT' if flow_type == 'receipt' else 'PC'
                code = generate_code(prefix, 'cash_flow', cursor)

                cursor.execute("""
                    INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, notes, created_at, user_id, user_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, flow_type, category, amount, target_type, target_id, target_name, fund_type, notes, now, user['id'], user['full_name']))
                cf_id = cursor.lastrowid

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='CASH_RECEIPT' if flow_type == 'receipt' else 'CASH_PAYMENT',
                    entity_type='cash_flow',
                    entity_id=cf_id,
                    entity_code=code,
                    details={'category': category, 'amount': amount, 'fund_type': fund_type, 'target_name': target_name},
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({
                    "id": cf_id,
                    "code": code,
                    "type": flow_type,
                    "amount": amount
                }, 201)
                return

            # 15. SETTINGS (Admin only)
            if path == '/api/settings':
                user, ok = self.require_auth('settings:manage', conn=conn)
                if not ok:
                    return

                changed_keys = []
                for k, v in body.items():
                    cursor.execute("""
                        INSERT INTO store_settings (key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """, (k, str(v)))
                    changed_keys.append(k)

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='SETTINGS_UPDATE',
                    entity_type='settings',
                    entity_id=None,
                    entity_code='store_settings',
                    details={'updated_keys': changed_keys},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": "Đã lưu cài đặt cửa hàng"})
                return

            if path.startswith('/api/audit-logs'):
                self.send_error_json("Không được phép sửa hoặc thêm dữ liệu vào nhật ký kiểm toán trực tiếp", 403, "FORBIDDEN")
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            conn.rollback()
            self.send_error_json(f"Lỗi hệ thống: {str(e)}", 500)
        finally:
            conn.close()

    # ------------------ PUT HANDLERS ------------------
    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_body()
        client_ip = self.get_client_ip()

        conn = get_db()
        cursor = conn.cursor()

        try:
            if path.startswith('/api/audit-logs'):
                self.send_error_json("Nhật ký kiểm toán là bất biến. Nghiêm cấm mọi hành vi chỉnh sửa!", 403, "AUDIT_IMMUTABLE")
                return

            # 1. USER PROFILE UPDATE (Admin only)
            if path.startswith('/api/users/'):
                user, ok = self.require_auth('users:manage', conn=conn)
                if not ok:
                    return
                target_uid = int(path.split('/')[3])
                
                full_name = body.get('full_name', '').strip()
                role = body.get('role', '')

                if not full_name:
                    self.send_error_json("Họ và tên không được để trống", 400)
                    return
                if role not in auth.ROLES:
                    self.send_error_json("Vai trò không hợp lệ", 400)
                    return

                if target_uid == user['id'] and role != 'admin':
                    cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1")
                    admin_count = cursor.fetchone()[0]
                    if admin_count <= 1:
                        self.send_error_json("Không thể hạ quyền của Quản trị viên duy nhất trong hệ thống", 400)
                        return

                now_str = get_now_str()
                cursor.execute("UPDATE users SET full_name = ?, role = ?, updated_at = ? WHERE id = ?", (full_name, role, now_str, target_uid))
                
                cursor.execute("SELECT username FROM users WHERE id = ?", (target_uid,))
                target_user = cursor.fetchone()

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='USER_UPDATE',
                    entity_type='user',
                    entity_id=target_uid,
                    entity_code=target_user['username'] if target_user else str(target_uid),
                    details={'full_name': full_name, 'role': role},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": "Cập nhật thông tin người dùng thành công"})
                return

            # 2. UPDATE PRODUCT
            if path.startswith('/api/products/'):
                user, ok = self.require_auth('products:manage', conn=conn)
                if not ok:
                    return
                pid = path.split('/')[3]

                cursor.execute("SELECT * FROM products WHERE id = ?", (pid,))
                old_p = cursor.fetchone()
                if not old_p:
                    self.send_error_json("Sản phẩm không tồn tại", 404)
                    return

                name = body.get('name', old_p['name'])
                category = body.get('category', old_p['category'])
                unit = body.get('unit', old_p['unit'])
                sub_unit = body.get('sub_unit', old_p['sub_unit'])
                sub_unit_ratio = float(body.get('sub_unit_ratio', old_p['sub_unit_ratio'] or 1))
                sale_price = float(body.get('sale_price', old_p['sale_price']))
                cost_price = float(body.get('cost_price', old_p['cost_price']))
                min_stock = float(body.get('min_stock', old_p['min_stock']))
                barcode = body.get('barcode', old_p['barcode'])
                now = get_now_str()

                cursor.execute("""
                    UPDATE products
                    SET name = ?, category = ?, unit = ?, sub_unit = ?, sub_unit_ratio = ?,
                        sale_price = ?, cost_price = ?, min_stock = ?, barcode = ?, updated_at = ?
                    WHERE id = ?
                """, (name, category, unit, sub_unit, sub_unit_ratio, sale_price, cost_price, min_stock, barcode, now, pid))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PRODUCT_UPDATE',
                    entity_type='product',
                    entity_id=pid,
                    entity_code=old_p['code'],
                    details={'name': name, 'sale_price': sale_price, 'cost_price': cost_price},
                    ip_address=client_ip
                )
                conn.commit()

                cursor.execute("SELECT * FROM products WHERE id = ?", (pid,))
                self.send_json(row_to_dict(cursor.fetchone()))
                return

            # 3. UPDATE CUSTOMER
            if path.startswith('/api/customers/'):
                user, ok = self.require_auth('customers:manage', conn=conn)
                if not ok:
                    return
                cid = path.split('/')[3]
                cursor.execute("SELECT * FROM customers WHERE id = ?", (cid,))
                old_c = cursor.fetchone()
                if not old_c:
                    self.send_error_json("Khách hàng không tồn tại", 404)
                    return

                name = body.get('name', old_c['name'])
                phone = body.get('phone', old_c['phone'])
                email = body.get('email', old_c['email'])
                address = body.get('address', old_c['address'])
                group_name = body.get('group_name', old_c['group_name'])
                notes = body.get('notes', old_c['notes'])

                cursor.execute("""
                    UPDATE customers
                    SET name = ?, phone = ?, email = ?, address = ?, group_name = ?, notes = ?
                    WHERE id = ?
                """, (name, phone, email, address, group_name, notes, cid))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='CUSTOMER_UPDATE',
                    entity_type='customer',
                    entity_id=cid,
                    entity_code=old_c['code'],
                    details={'name': name, 'phone': phone, 'group_name': group_name},
                    ip_address=client_ip
                )
                conn.commit()

                cursor.execute("SELECT * FROM customers WHERE id = ?", (cid,))
                self.send_json(row_to_dict(cursor.fetchone()))
                return

            # 4. UPDATE SUPPLIER
            if path.startswith('/api/suppliers/'):
                user, ok = self.require_auth('suppliers:manage', conn=conn)
                if not ok:
                    return
                sid = path.split('/')[3]
                cursor.execute("SELECT * FROM suppliers WHERE id = ?", (sid,))
                old_s = cursor.fetchone()
                if not old_s:
                    self.send_error_json("Nhà cung cấp không tồn tại", 404)
                    return

                name = body.get('name', old_s['name'])
                phone = body.get('phone', old_s['phone'])
                email = body.get('email', old_s['email'])
                address = body.get('address', old_s['address'])
                notes = body.get('notes', old_s['notes'])

                cursor.execute("""
                    UPDATE suppliers
                    SET name = ?, phone = ?, email = ?, address = ?, notes = ?
                    WHERE id = ?
                """, (name, phone, email, address, notes, sid))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='SUPPLIER_UPDATE',
                    entity_type='supplier',
                    entity_id=sid,
                    entity_code=old_s['code'],
                    details={'name': name, 'phone': phone},
                    ip_address=client_ip
                )
                conn.commit()

                cursor.execute("SELECT * FROM suppliers WHERE id = ?", (sid,))
                self.send_json(row_to_dict(cursor.fetchone()))
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            conn.rollback()
            self.send_error_json(f"Lỗi: {str(e)}", 500)
        finally:
            conn.close()

    # ------------------ DELETE HANDLERS ------------------
    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        client_ip = self.get_client_ip()

        conn = get_db()
        cursor = conn.cursor()

        try:
            if path.startswith('/api/audit-logs'):
                self.send_error_json("Nhật ký kiểm toán là bất biến. Nghiêm cấm mọi hành vi xóa bỏ!", 403, "AUDIT_IMMUTABLE")
                return

            if path.startswith('/api/customer-prices/'):
                user, ok = self.require_auth('customers:manage', conn=conn)
                if not ok:
                    return
                price_id = path.split('/')[3]
                cursor.execute("DELETE FROM customer_product_prices WHERE id = ?", (price_id,))
                conn.commit()
                self.send_json({"success": True, "message": "Đã xóa giá riêng"})
                return

            if path.startswith('/api/products/'):
                user, ok = self.require_auth('products:manage', conn=conn)
                if not ok:
                    return
                pid = path.split('/')[3]
                cursor.execute("SELECT code, name FROM products WHERE id = ?", (pid,))
                p = cursor.fetchone()
                if p:
                    cursor.execute("DELETE FROM products WHERE id = ?", (pid,))
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='PRODUCT_DELETE',
                        entity_type='product',
                        entity_id=pid,
                        entity_code=p['code'],
                        details={'deleted_product': p['name']},
                        ip_address=client_ip
                    )
                    conn.commit()
                self.send_json({"success": True})
                return

            if path.startswith('/api/customers/'):
                user, ok = self.require_auth('customers:manage', conn=conn)
                if not ok:
                    return
                cid = path.split('/')[3]
                cursor.execute("SELECT code, name FROM customers WHERE id = ?", (cid,))
                c = cursor.fetchone()
                if c:
                    cursor.execute("DELETE FROM customers WHERE id = ?", (cid,))
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='CUSTOMER_DELETE',
                        entity_type='customer',
                        entity_id=cid,
                        entity_code=c['code'],
                        details={'deleted_customer': c['name']},
                        ip_address=client_ip
                    )
                    conn.commit()
                self.send_json({"success": True})
                return

            if path.startswith('/api/suppliers/'):
                user, ok = self.require_auth('suppliers:manage', conn=conn)
                if not ok:
                    return
                sid = path.split('/')[3]
                cursor.execute("SELECT code, name FROM suppliers WHERE id = ?", (sid,))
                s = cursor.fetchone()
                if s:
                    cursor.execute("DELETE FROM suppliers WHERE id = ?", (sid,))
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='SUPPLIER_DELETE',
                        entity_type='supplier',
                        entity_id=sid,
                        entity_code=s['code'],
                        details={'deleted_supplier': s['name']},
                        ip_address=client_ip
                    )
                    conn.commit()
                self.send_json({"success": True})
                return

            self.send_error_json("Endpoint not found", 404)

        except Exception as e:
            conn.rollback()
            self.send_error_json(f"Lỗi: {str(e)}", 500)
        finally:
            conn.close()

def run_server():
    init_db()
    lan_ip = get_lan_ip()

    server_address = ('0.0.0.0', PORT)
    httpd = ThreadedHTTPServer(server_address, KiotVietHandler)

    print("=" * 68)
    print("   KIOTPRO ENTERPRISE - POS & DISTRIBUTION MANAGEMENT SYSTEM")
    print("   Engineered with Strict RBAC, Audit Trail & Accounting Precision")
    print("=" * 68)
    print(f" -> Local Access     : http://localhost:{PORT}")
    print(f" -> Multi-client LAN : http://{lan_ip}:{PORT}")
    print(" -> SQLite Database  : Thread-safe, multi-client, auto-migration")
    print("=" * 68)
    print(" Server is actively listening for incoming connections. Press Ctrl+C to stop.")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Shutting down gracefully...")
        httpd.server_close()
        print("[Server] Stopped.")

if __name__ == '__main__':
    run_server()
