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
from database import get_db, init_db, DB_FILE, format_stock_breakdown
import auth
from export_xlsx import create_xlsx

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

            # 4b. EXCEL EXPORT (Strict RBAC, column filtering & preserved query filters)
            if path.startswith('/api/export/'):
                entity = path[len('/api/export/'):].strip('/')
                perm_map = {
                    'orders': 'orders:view',
                    'products': 'products:view',
                    'customers': 'customers:view',
                    'suppliers': 'suppliers:view',
                    'purchases': 'purchases:view',
                    'returns': 'returns:view',
                    'cash-flow': 'cash_flow:view',
                    'promotions': 'promotions:view'
                }
                req_perm = perm_map.get(entity)
                if not req_perm:
                    self.send_error_json(f"Unknown export entity: {entity}", 400)
                    return
                user, ok = self.require_auth(req_perm, conn=conn)
                if not ok:
                    return

                can_see_cost = 'products:view_cost' in auth.ROLE_PERMISSIONS.get(user['role'], set())
                col_param = query.get('columns', [''])[0]
                requested_cols = [c.strip() for c in col_param.split(',') if c.strip()] if col_param else None

                all_headers = []
                all_rows = []
                sheet_title = entity.replace('-', '_').title()

                if entity == 'orders':
                    sheet_title = "Don_Ban"
                    col_defs = [
                        ('code', 'Mã đơn hàng'),
                        ('created_at', 'Thời gian'),
                        ('customer_name', 'Khách hàng'),
                        ('status', 'Trạng thái'),
                        ('items_summary', 'Mặt hàng'),
                        ('total_amount', 'Tổng tiền'),
                        ('discount', 'Giảm giá/Khuyến mãi'),
                        ('final_amount', 'Khách cần trả'),
                        ('actual_paid', 'Đã thanh toán'),
                        ('debt_amount', 'Ghi nợ'),
                        ('payment_method', 'Hình thức TT'),
                        ('notes', 'Ghi chú')
                    ]
                    q = query.get('q', [''])[0].strip()
                    status = query.get('status', [''])[0].strip()
                    payment_method = query.get('payment_method', [''])[0].strip()
                    date_from = query.get('date_from', [''])[0].strip()
                    date_to = query.get('date_to', [''])[0].strip()
                    customer_id = query.get('customer_id', [''])[0].strip()

                    sql = """
                        SELECT o.*, c.name as customer_name, c.phone as customer_phone
                        FROM orders o
                        LEFT JOIN customers c ON o.customer_id = c.id
                        WHERE 1=1
                    """
                    params = []
                    if q:
                        sql += " AND (o.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)"
                        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
                    if status:
                        sql += " AND o.status = ?"
                        params.append(status)
                    if payment_method:
                        sql += " AND o.payment_method = ?"
                        params.append(payment_method)
                    if date_from:
                        sql += " AND DATE(o.created_at) >= ?"
                        params.append(date_from)
                    if date_to:
                        sql += " AND DATE(o.created_at) <= ?"
                        params.append(date_to)
                    if customer_id:
                        sql += " AND o.customer_id = ?"
                        params.append(customer_id)
                    sql += " ORDER BY o.id DESC"
                    cursor.execute(sql, params)
                    orders = [dict(r) for r in cursor.fetchall()]

                    for o in orders:
                        cursor.execute("SELECT product_name, quantity, unit_name FROM order_items WHERE order_id = ?", (o['id'],))
                        items = cursor.fetchall()
                        o['items_summary'] = ", ".join([f"{it['product_name']} ({it['quantity']} {it['unit_name'] or ''})" for it in items])
                        if o.get('status') == 'completed':
                            o['status'] = 'Hoàn tất'
                        elif o.get('status') == 'pending':
                            o['status'] = 'Đang chờ'
                        elif o.get('status') == 'cancelled':
                            o['status'] = 'Đã hủy'
                        if not o.get('customer_name'):
                            o['customer_name'] = 'Khách lẻ'

                    cols_to_use = [cd for cd in col_defs if not requested_cols or cd[0] in requested_cols]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for o in orders:
                        all_rows.append([o.get(k, '') for k, _ in cols_to_use])

                elif entity == 'products':
                    sheet_title = "Hang_Hoa"
                    col_defs = [
                        ('code', 'Mã hàng hóa'),
                        ('barcode', 'Mã vạch'),
                        ('name', 'Tên hàng hóa'),
                        ('category', 'Danh mục'),
                        ('unit', 'Đơn vị cơ sở'),
                        ('stock', 'Tồn kho'),
                        ('stock_breakdown', 'Quy đổi tồn'),
                        ('cost_price', 'Giá vốn'),
                        ('sale_price', 'Giá bán'),
                        ('min_stock', 'Tồn tối thiểu')
                    ]
                    q = query.get('q', [''])[0].strip()
                    category = query.get('category', [''])[0].strip()
                    low_stock = query.get('low_stock', [''])[0].strip().lower() in ('1', 'true')

                    sql = "SELECT * FROM products WHERE 1=1"
                    params = []
                    if q:
                        sql += " AND (code LIKE ? OR name LIKE ? OR barcode LIKE ?)"
                        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
                    if category:
                        sql += " AND category = ?"
                        params.append(category)
                    if low_stock:
                        sql += " AND stock <= min_stock"
                    sql += " ORDER BY id DESC"
                    cursor.execute(sql, params)
                    prods = [dict(r) for r in cursor.fetchall()]

                    for p in prods:
                        cursor.execute("SELECT * FROM product_units WHERE product_id = ? ORDER BY conversion_rate DESC", (p['id'],))
                        units = [dict(u) for u in cursor.fetchall()]
                        p['stock_breakdown'] = format_stock_breakdown(p.get('stock', 0), units)
                        if not can_see_cost:
                            p['cost_price'] = 0

                    cols_to_use = [cd for cd in col_defs if (not requested_cols or cd[0] in requested_cols) and (cd[0] != 'cost_price' or can_see_cost)]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for p in prods:
                        all_rows.append([p.get(k, '') for k, _ in cols_to_use])

                elif entity == 'customers':
                    sheet_title = "Khach_Hang"
                    col_defs = [
                        ('code', 'Mã khách hàng'),
                        ('name', 'Tên khách hàng'),
                        ('phone', 'Số điện thoại'),
                        ('email', 'Email'),
                        ('group_name', 'Nhóm khách'),
                        ('total_spent', 'Tổng chi tiêu'),
                        ('debt', 'Công nợ hiện tại'),
                        ('pending_orders_count', 'Đơn chờ xử lý'),
                        ('address', 'Địa chỉ')
                    ]
                    q = query.get('q', [''])[0].strip()
                    sql = """
                        SELECT c.*,
                            COALESCE((SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'pending'), 0) as pending_orders_count
                        FROM customers c WHERE 1=1
                    """
                    params = []
                    if q:
                        sql += " AND (c.name LIKE ? OR c.phone LIKE ? OR c.code LIKE ? OR c.email LIKE ?)"
                        params.extend([f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"])
                    sql += " ORDER BY c.id DESC"
                    cursor.execute(sql, params)
                    custs = [dict(r) for r in cursor.fetchall()]

                    cols_to_use = [cd for cd in col_defs if not requested_cols or cd[0] in requested_cols]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for c in custs:
                        all_rows.append([c.get(k, '') for k, _ in cols_to_use])

                elif entity == 'suppliers':
                    sheet_title = "Nha_Cung_Cap"
                    col_defs = [
                        ('code', 'Mã nhà cung cấp'),
                        ('name', 'Tên nhà cung cấp'),
                        ('phone', 'Số điện thoại'),
                        ('email', 'Email'),
                        ('debt', 'Công nợ cần trả'),
                        ('address', 'Địa chỉ')
                    ]
                    q = query.get('q', [''])[0].strip()
                    sql = "SELECT * FROM suppliers WHERE 1=1"
                    params = []
                    if q:
                        sql += " AND (name LIKE ? OR phone LIKE ? OR code LIKE ? OR email LIKE ?)"
                        params.extend([f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"])
                    sql += " ORDER BY id DESC"
                    cursor.execute(sql, params)
                    supps = [dict(r) for r in cursor.fetchall()]

                    cols_to_use = [cd for cd in col_defs if not requested_cols or cd[0] in requested_cols]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for s in supps:
                        all_rows.append([s.get(k, '') for k, _ in cols_to_use])

                elif entity == 'purchases':
                    sheet_title = "Nhap_Hang"
                    col_defs = [
                        ('code', 'Mã phiếu nhập'),
                        ('created_at', 'Ngày nhập'),
                        ('supplier_name', 'Nhà cung cấp'),
                        ('total_amount', 'Tổng tiền'),
                        ('paid_amount', 'Đã trả'),
                        ('debt_amount', 'Còn nợ'),
                        ('status', 'Trạng thái'),
                        ('notes', 'Ghi chú')
                    ]
                    supplier_id = query.get('supplier_id', [''])[0].strip()
                    date_from = query.get('date_from', [''])[0].strip()
                    date_to = query.get('date_to', [''])[0].strip()
                    sql = """
                        SELECT p.*, s.name as supplier_name
                        FROM purchases p
                        LEFT JOIN suppliers s ON p.supplier_id = s.id
                        WHERE 1=1
                    """
                    params = []
                    if supplier_id:
                        sql += " AND p.supplier_id = ?"
                        params.append(supplier_id)
                    if date_from:
                        sql += " AND DATE(p.created_at) >= ?"
                        params.append(date_from)
                    if date_to:
                        sql += " AND DATE(p.created_at) <= ?"
                        params.append(date_to)
                    sql += " ORDER BY p.id DESC"
                    cursor.execute(sql, params)
                    purchases = [dict(r) for r in cursor.fetchall()]

                    cols_to_use = [cd for cd in col_defs if not requested_cols or cd[0] in requested_cols]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for p in purchases:
                        all_rows.append([p.get(k, '') for k, _ in cols_to_use])

                elif entity == 'returns':
                    sheet_title = "Tra_Hang"
                    col_defs = [
                        ('code', 'Mã phiếu trả'),
                        ('created_at', 'Ngày trả'),
                        ('order_code', 'Hóa đơn gốc'),
                        ('customer_name', 'Khách hàng'),
                        ('refund_amount', 'Hoàn tiền mặt'),
                        ('debt_deduct_amount', 'Giảm công nợ'),
                        ('total_refund', 'Tổng tiền trả'),
                        ('reason', 'Lý do')
                    ]
                    date_from = query.get('date_from', [''])[0].strip()
                    date_to = query.get('date_to', [''])[0].strip()
                    sql = """
                        SELECT r.*, c.name as customer_name
                        FROM returns r
                        LEFT JOIN customers c ON r.customer_id = c.id
                        WHERE 1=1
                    """
                    params = []
                    if date_from:
                        sql += " AND DATE(r.created_at) >= ?"
                        params.append(date_from)
                    if date_to:
                        sql += " AND DATE(r.created_at) <= ?"
                        params.append(date_to)
                    sql += " ORDER BY r.id DESC"
                    cursor.execute(sql, params)
                    returns_list = [dict(r) for r in cursor.fetchall()]

                    cols_to_use = [cd for cd in col_defs if not requested_cols or cd[0] in requested_cols]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for r in returns_list:
                        all_rows.append([r.get(k, '') for k, _ in cols_to_use])

                elif entity == 'cash-flow':
                    sheet_title = "So_Quy"
                    col_defs = [
                        ('code', 'Mã phiếu'),
                        ('created_at', 'Thời gian'),
                        ('type', 'Loại phiếu'),
                        ('category', 'Hạng mục'),
                        ('amount', 'Số tiền'),
                        ('fund_type', 'Quỹ tiền'),
                        ('target_name', 'Đối tượng'),
                        ('notes', 'Ghi chú')
                    ]
                    cf_type = query.get('type', [''])[0].strip()
                    date_from = query.get('date_from', [''])[0].strip()
                    date_to = query.get('date_to', [''])[0].strip()
                    sql = "SELECT * FROM cash_flow WHERE 1=1"
                    params = []
                    if cf_type:
                        sql += " AND type = ?"
                        params.append(cf_type)
                    if date_from:
                        sql += " AND DATE(created_at) >= ?"
                        params.append(date_from)
                    if date_to:
                        sql += " AND DATE(created_at) <= ?"
                        params.append(date_to)
                    sql += " ORDER BY id DESC"
                    cursor.execute(sql, params)
                    cfs = [dict(r) for r in cursor.fetchall()]

                    for cf in cfs:
                        cf['type'] = 'Thu' if cf.get('type') == 'in' else 'Chi'

                    cols_to_use = [cd for cd in col_defs if not requested_cols or cd[0] in requested_cols]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for cf in cfs:
                        all_rows.append([cf.get(k, '') for k, _ in cols_to_use])

                elif entity == 'promotions':
                    sheet_title = "Khuyen_Mai"
                    col_defs = [
                        ('code', 'Mã khuyến mãi'),
                        ('name', 'Tên chương trình'),
                        ('scope', 'Phạm vi'),
                        ('discount_type', 'Loại giảm'),
                        ('discount_value', 'Giá trị giảm'),
                        ('min_order_amount', 'Đơn tối thiểu'),
                        ('start_date', 'Từ ngày'),
                        ('end_date', 'Đến ngày'),
                        ('is_active', 'Trạng thái')
                    ]
                    cursor.execute("SELECT * FROM promotions ORDER BY id DESC")
                    promos = [dict(r) for r in cursor.fetchall()]
                    for p in promos:
                        p['is_active'] = 'Đang kích hoạt' if p.get('is_active') else 'Tạm ngưng'
                        if p.get('scope') == 'order':
                            p['scope'] = 'Đơn hàng'
                        elif p.get('scope') == 'category':
                            p['scope'] = 'Danh mục'
                        elif p.get('scope') == 'product':
                            p['scope'] = 'Sản phẩm'
                        if p.get('discount_type') == 'percent':
                            p['discount_type'] = 'Theo %'
                        else:
                            p['discount_type'] = 'Số tiền cố định'

                    cols_to_use = [cd for cd in col_defs if not requested_cols or cd[0] in requested_cols]
                    all_headers = [cd[1] for cd in cols_to_use]
                    for p in promos:
                        all_rows.append([p.get(k, '') for k, _ in cols_to_use])

                xlsx_bytes = create_xlsx(sheet_title, all_headers, all_rows)
                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='EXCEL_EXPORT',
                    entity_type='export',
                    entity_id=None,
                    entity_code=entity,
                    details={'entity': entity, 'rows_count': len(all_rows), 'columns_count': len(all_headers)},
                    ip_address=self.get_client_ip()
                )
                conn.commit()

                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                self.send_header('Content-Disposition', f'attachment; filename="kiotpro_{entity}_{datetime.datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx"')
                self.send_header('Content-Length', str(len(xlsx_bytes)))
                self.end_headers()
                self.wfile.write(xlsx_bytes)
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

                q = query.get('search', query.get('q', ['']))[0].strip()
                category = query.get('category', [''])[0].strip()
                flt = query.get('filter', [''])[0].strip()

                sql = "SELECT p.* FROM products p WHERE 1=1"
                params = []
                if q:
                    sql += " AND (p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ? OR p.id IN (SELECT product_id FROM product_units WHERE barcode LIKE ?))"
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"])
                if category and category != 'all':
                    sql += " AND p.category = ?"
                    params.append(category)
                if flt == 'low_stock':
                    sql += " AND p.stock <= p.min_stock"
                sql += " ORDER BY p.id DESC"
                cursor.execute(sql, params)
                items = rows_to_list(cursor.fetchall())

                can_view_cost = auth.has_permission(user['role'], 'products:view_cost')
                for item in items:
                    cursor.execute("SELECT * FROM product_units WHERE product_id = ? ORDER BY conversion_rate ASC", (item['id'],))
                    u_rows = rows_to_list(cursor.fetchall())
                    if not can_view_cost:
                        item['cost_price'] = 0
                        for u in u_rows:
                            u['cost_price'] = 0
                    item['units'] = u_rows
                    item['stock_breakdown'] = format_stock_breakdown(item['stock'], u_rows)

                self.send_json(items)
                return

            if path.startswith('/api/products/') and path.endswith('/units'):
                user, ok = self.require_auth('products:view', conn=conn)
                if not ok:
                    return
                prod_id = path.split('/')[3]
                cursor.execute("SELECT * FROM product_units WHERE product_id = ? ORDER BY conversion_rate ASC", (prod_id,))
                units = rows_to_list(cursor.fetchall())
                can_view_cost = auth.has_permission(user['role'], 'products:view_cost')
                for u in units:
                    u['name'] = u['unit_name']
                    if not can_view_cost:
                        u['cost_price'] = 0
                self.send_json(units)
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
                q = query.get('search', query.get('q', ['']))[0].strip()
                sql = """
                    SELECT c.*,
                        COALESCE((SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'pending'), 0) as pending_orders_count,
                        COALESCE((SELECT SUM(o.final_amount) FROM orders o WHERE o.customer_id = c.id AND o.status = 'pending'), 0) as pending_orders_amount
                    FROM customers c
                    WHERE 1=1
                """
                c_params = []
                if q:
                    sql += " AND (c.name LIKE ? OR c.phone LIKE ? OR c.code LIKE ? OR c.email LIKE ?)"
                    c_params.extend([f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"])
                sql += " ORDER BY c.id DESC"
                cursor.execute(sql, c_params)
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            if path.startswith('/api/customers/') and path.endswith('/pending-orders'):
                user, ok = self.require_auth('customers:view', conn=conn)
                if not ok:
                    return
                cust_id = path.split('/')[3]
                cursor.execute("SELECT * FROM orders WHERE customer_id = ? AND status = 'pending' ORDER BY id DESC", (cust_id,))
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
                unit_id = query.get('unit_id', [None])[0]
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

                base_effective = row['custom_price'] if row['custom_price'] is not None else row['default_sale_price']
                conversion_rate = 1.0
                unit_name = ''
                final_unit_price = base_effective

                if unit_id:
                    cursor.execute("SELECT * FROM product_units WHERE id = ?", (unit_id,))
                    u_row = cursor.fetchone()
                    if u_row:
                        conversion_rate = float(u_row['conversion_rate'] or 1.0)
                        unit_name = u_row['unit_name']
                        if row['custom_price'] is not None:
                            final_unit_price = round(float(row['custom_price']) * conversion_rate, 2)
                        elif u_row['sale_price'] is not None and float(u_row['sale_price']) > 0:
                            final_unit_price = float(u_row['sale_price'])
                        else:
                            final_unit_price = round(float(row['default_sale_price']) * conversion_rate, 2)

                res = {
                    "product_id": int(prod_id),
                    "customer_id": int(cust_id),
                    "custom_price": row['custom_price'],
                    "default_price": row['default_sale_price'],
                    "effective_price": final_unit_price,
                    "final_unit_price": final_unit_price,
                    "conversion_rate": conversion_rate,
                    "unit_name": unit_name,
                    "has_custom_price": row['custom_price'] is not None
                }
                self.send_json(res)
                return

            # 10. SUPPLIERS
            if path == '/api/suppliers':
                user, ok = self.require_auth('suppliers:view', conn=conn)
                if not ok:
                    return
                q = query.get('search', query.get('q', ['']))[0].strip()
                sql = "SELECT * FROM suppliers WHERE 1=1"
                params = []
                if q:
                    sql += " AND (name LIKE ? OR phone LIKE ? OR code LIKE ? OR email LIKE ?)"
                    params.extend([f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"])
                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            # 11. PROMOTIONS
            if path == '/api/promotions':
                user, ok = self.require_auth('promotions:view', conn=conn)
                if not ok:
                    return
                active_only = query.get('active_only', ['0'])[0] == '1'
                sql = "SELECT * FROM promotions WHERE 1=1"
                params = []
                if active_only:
                    now_str = get_now_str()
                    sql += " AND is_active = 1 AND start_date <= ? AND end_date >= ?"
                    params.extend([now_str, now_str])
                sql += " ORDER BY id DESC"
                cursor.execute(sql, params)
                self.send_json(rows_to_list(cursor.fetchall()))
                return

            if path.startswith('/api/promotions/') and not path.endswith('/check'):
                user, ok = self.require_auth('promotions:view', conn=conn)
                if not ok:
                    return
                promo_id = path.split('/')[3]
                cursor.execute("SELECT * FROM promotions WHERE id = ?", (promo_id,))
                promo = row_to_dict(cursor.fetchone())
                if not promo:
                    self.send_error_json("Chương trình khuyến mãi không tồn tại", 404)
                    return
                self.send_json(promo)
                return

            # 12. ORDERS (Paginated, Searchable, Filtered)
            if path == '/api/orders':
                user, ok = self.require_auth('orders:view', conn=conn)
                if not ok:
                    return

                page = max(1, int(query.get('page', ['1'])[0]))
                limit = min(1000, max(1, int(query.get('limit', ['20'])[0])))
                offset = (page - 1) * limit

                q = query.get('search', query.get('q', ['']))[0].strip()
                st = query.get('status', ['all'])[0].strip()
                pm = query.get('payment_method', ['all'])[0].strip()
                df = query.get('date_from', [''])[0].strip()
                dt = query.get('date_to', [''])[0].strip()
                cid = query.get('customer_id', [''])[0].strip()

                where_clauses = ["1=1"]
                params = []
                if q:
                    where_clauses.append("(o.code LIKE ? OR o.customer_name LIKE ?)")
                    params.extend([f"%{q}%", f"%{q}%"])
                if st and st != 'all':
                    where_clauses.append("o.status = ?")
                    params.append(st)
                if pm and pm != 'all':
                    where_clauses.append("o.payment_method = ?")
                    params.append(pm)
                if df:
                    where_clauses.append("o.created_at >= ?")
                    params.append(f"{df} 00:00:00")
                if dt:
                    where_clauses.append("o.created_at <= ?")
                    params.append(f"{dt} 23:59:59")
                if cid:
                    where_clauses.append("o.customer_id = ?")
                    params.append(int(cid))

                where_sql = " AND ".join(where_clauses)

                # Total count and aggregate summaries
                summary_sql = f"""
                    SELECT COUNT(*) as total_count,
                           COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.final_amount ELSE 0 END), 0) as total_final,
                           COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.paid_amount ELSE 0 END), 0) as total_paid,
                           COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.debt_amount ELSE 0 END), 0) as total_debt,
                           COALESCE(SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
                           COALESCE(SUM(CASE WHEN o.status = 'pending' THEN o.final_amount ELSE 0 END), 0) as pending_amount
                    FROM orders o
                    WHERE {where_sql}
                """
                cursor.execute(summary_sql, params)
                summary_row = cursor.fetchone()
                total_records = summary_row['total_count'] if summary_row else 0

                data_sql = f"""
                    SELECT o.* 
                    FROM orders o
                    WHERE {where_sql}
                    ORDER BY o.id DESC
                    LIMIT ? OFFSET ?
                """
                cursor.execute(data_sql, params + [limit, offset])
                items = rows_to_list(cursor.fetchall())
                total_pages = max(1, (total_records + limit - 1) // limit) if total_records > 0 else 1

                self.send_json({
                    "items": items,
                    "total": total_records,
                    "page": page,
                    "limit": limit,
                    "total_pages": total_pages,
                    "summary": {
                        "total_final": summary_row['total_final'] if summary_row else 0,
                        "total_paid": summary_row['total_paid'] if summary_row else 0,
                        "total_debt": summary_row['total_debt'] if summary_row else 0,
                        "pending_count": summary_row['pending_count'] if summary_row else 0,
                        "pending_amount": summary_row['pending_amount'] if summary_row else 0
                    }
                })
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
                cursor.execute("SELECT id, code, total_amount, created_at FROM returns WHERE order_id = ?", (order_id,))
                order['returns'] = rows_to_list(cursor.fetchall())
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

                # Automatically create base unit record in product_units
                cursor.execute("""
                    INSERT INTO product_units (product_id, unit_name, conversion_rate, sale_price, is_base, barcode, created_at)
                    VALUES (?, ?, 1.0, ?, 1, ?, ?)
                """, (pid, unit, sale_price, barcode, now))

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

                order_status = body.get('status', 'completed')
                if order_status not in ('completed', 'pending'):
                    order_status = 'completed'

                customer_id = body.get('customer_id')
                customer_name = body.get('customer_name', 'Khách lẻ')
                manual_discount = max(0, float(body.get('discount', 0)))
                vat_percent = max(0, float(body.get('vat_percent', 0)))
                payment_method = body.get('payment_method', 'cash')
                notes = body.get('notes', '').strip()
                now = get_now_str()

                # Customer group lookup for promotion validation
                customer_group = 'all'
                if customer_id and customer_id != 1:
                    cursor.execute("SELECT group_name FROM customers WHERE id = ?", (customer_id,))
                    c_row = cursor.fetchone()
                    if c_row and c_row['group_name']:
                        customer_group = c_row['group_name']

                total_amount = 0
                total_cost = 0
                processed_items = []

                for item in items:
                    cursor.execute("SELECT * FROM products WHERE id = ?", (item['product_id'],))
                    p = cursor.fetchone()
                    if not p:
                        self.send_error_json(f"Sản phẩm ID {item['product_id']} không tồn tại", 400)
                        return

                    qty = float(item.get('quantity', 0))
                    if qty <= 0:
                        self.send_error_json("Số lượng sản phẩm trong đơn phải lớn hơn 0", 400)
                        return

                    unit_name = (item.get('unit_name') or item.get('unit') or p['unit'] or 'Cái').strip()
                    cursor.execute("SELECT * FROM product_units WHERE product_id = ? AND unit_name = ?", (p['id'], unit_name))
                    u_row = cursor.fetchone()

                    if u_row:
                        conversion_rate = float(u_row['conversion_rate'])
                    elif unit_name == p['unit']:
                        conversion_rate = 1.0
                    else:
                        self.send_error_json(f"Đơn vị '{unit_name}' không hợp lệ cho sản phẩm '{p['name']}'", 400)
                        return

                    if conversion_rate <= 0:
                        self.send_error_json(f"Hệ số quy đổi đơn vị '{unit_name}' không hợp lệ", 400)
                        return

                    base_qty = round(qty * conversion_rate, 4)

                    if order_status == 'completed' and not allow_negative_stock:
                        if p['stock'] < base_qty:
                            self.send_error_json(f"Sản phẩm '{p['name']}' chỉ còn tồn {p['stock']} {p['unit']}, không đủ để bán {base_qty} {p['unit']} ({qty} {unit_name})", 400)
                            return

                    # Price calculation with customer-specific pricing and unit conversion
                    cursor.execute("SELECT custom_price FROM customer_product_prices WHERE customer_id = ? AND product_id = ?", (customer_id, p['id']))
                    cp_row = cursor.fetchone()
                    has_custom_price = cp_row is not None and cp_row['custom_price'] is not None

                    if has_custom_price:
                        expected_price = round(float(cp_row['custom_price']) * conversion_rate, 2)
                    elif u_row and u_row['sale_price'] is not None and float(u_row['sale_price']) > 0:
                        expected_price = float(u_row['sale_price'])
                    else:
                        expected_price = round(float(p['sale_price']) * conversion_rate, 2)

                    sale_price = float(item.get('unit_price') if item.get('unit_price') is not None else item.get('sale_price', expected_price))
                    if sale_price < 0:
                        self.send_error_json("Đơn giá sản phẩm không được âm", 400)
                        return

                    subtotal = round(qty * sale_price, 2)
                    total_amount += subtotal

                    cost_price = p['cost_price'] * conversion_rate
                    total_cost += base_qty * p['cost_price']

                    processed_items.append({
                        "product_id": p['id'],
                        "product_code": p['code'],
                        "product_name": p['name'],
                        "category": p['category'],
                        "unit": unit_name,
                        "conversion_rate": conversion_rate,
                        "quantity": qty,
                        "base_quantity": base_qty,
                        "cost_price": cost_price,
                        "sale_price": sale_price,
                        "is_custom_price": 1 if (has_custom_price or item.get('is_custom_price')) else 0,
                        "save_as_custom": item.get('save_as_custom_price', False),
                        "subtotal": subtotal,
                        "current_stock": p['stock']
                    })

                # Promotions verification & calculation (Non-stacking)
                promotion_id = body.get('promotion_id')
                promo_discount = 0
                promo_code = None
                promo_name = None

                if promotion_id:
                    cursor.execute("SELECT * FROM promotions WHERE id = ?", (promotion_id,))
                    promo = cursor.fetchone()
                    if promo and promo['is_active']:
                        now_str = get_now_str()
                        if promo['start_date'] <= now_str <= promo['end_date']:
                            grp_ok = (promo['customer_group'] == 'all' or promo['customer_group'] == customer_group)
                            if grp_ok:
                                p_scope = promo['scope']
                                min_amt = float(promo['min_order_amount'] or 0)
                                d_val = float(promo['discount_value'] or 0)
                                d_type = promo['discount_type']

                                if p_scope == 'order':
                                    if total_amount >= min_amt:
                                        if d_type == 'percent':
                                            promo_discount = round(total_amount * (d_val / 100))
                                        else:
                                            promo_discount = min(d_val, total_amount)
                                elif p_scope == 'category':
                                    target_cat = promo['target_category']
                                    cat_subtotal = sum(it['subtotal'] for it in processed_items if it.get('category') == target_cat)
                                    if cat_subtotal >= min_amt:
                                        if d_type == 'percent':
                                            promo_discount = round(cat_subtotal * (d_val / 100))
                                        else:
                                            promo_discount = min(d_val, cat_subtotal)
                                elif p_scope == 'product':
                                    target_pid = promo['target_id']
                                    prod_subtotal = sum(it['subtotal'] for it in processed_items if it['product_id'] == target_pid)
                                    if prod_subtotal >= min_amt:
                                        if d_type == 'percent':
                                            promo_discount = round(prod_subtotal * (d_val / 100))
                                        else:
                                            promo_discount = min(d_val, prod_subtotal)

                                if promo_discount > 0:
                                    promo_code = promo['code']
                                    promo_name = promo['name']

                if promo_discount > 0 and manual_discount >= promo_discount:
                    manual_discount = manual_discount - promo_discount
                elif promo_discount > 0 and manual_discount < promo_discount:
                    manual_discount = 0

                total_discount = manual_discount + promo_discount
                net_revenue = max(0, total_amount - total_discount)
                vat_amount = round(net_revenue * (vat_percent / 100))
                final_amount = net_revenue + vat_amount

                if order_status == 'pending':
                    customer_paid = 0
                    actual_paid = 0
                    change_amount = 0
                    debt_amount = 0
                    profit = 0
                else:
                    customer_paid = max(0, float(body.get('paid_amount') if body.get('paid_amount') is not None else body.get('actual_paid', 0)))
                    actual_paid = min(customer_paid, final_amount)
                    change_amount = max(0, customer_paid - final_amount)
                    debt_amount = max(0, final_amount - customer_paid)
                    profit = net_revenue - total_cost

                    if debt_amount > 0 and (not customer_id or customer_id == 1):
                        self.send_error_json("Khách lẻ không thể ghi nợ. Vui lòng chọn khách hàng cụ thể hoặc thanh toán đủ.", 400)
                        return

                code = generate_code('HD', 'orders', cursor)

                cursor.execute("""
                    INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, promotion_id, promotion_code, promotion_name, promotion_discount, net_revenue, vat_percent, vat_amount, final_amount, customer_paid, paid_amount, change_amount, debt_amount, payment_method, status, total_cost, profit, notes, created_at, user_id, user_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, customer_id, customer_name, total_amount, manual_discount, promotion_id, promo_code, promo_name, promo_discount, net_revenue, vat_percent, vat_amount, final_amount, customer_paid, actual_paid, change_amount, debt_amount, payment_method, order_status, total_cost, profit, notes, now, user['id'], user['full_name']))
                order_id = cursor.lastrowid

                for it in processed_items:
                    cursor.execute("""
                        INSERT INTO order_items (order_id, product_id, product_code, product_name, unit, quantity, conversion_rate, base_quantity, cost_price, sale_price, is_custom_price, subtotal)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (order_id, it['product_id'], it['product_code'], it['product_name'], it['unit'], it['quantity'], it['conversion_rate'], it['base_quantity'], it['cost_price'], it['sale_price'], it['is_custom_price'], it['subtotal']))

                    if order_status == 'completed':
                        new_stock = it['current_stock'] - it['base_quantity']
                        cursor.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, it['product_id']))

                        cursor.execute("""
                            INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                            VALUES (?, 'output', ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (it['product_id'], code, -it['base_quantity'], it['current_stock'], new_stock, f"Xuất bán {it['quantity']} {it['unit']} theo hóa đơn {code}", now, user['id'], user['full_name']))

                    if it.get('save_as_custom') and customer_id and customer_id != 1:
                        # Save base price
                        custom_base_price = round(it['sale_price'] / it['conversion_rate'], 2)
                        cursor.execute("""
                            INSERT INTO customer_product_prices (customer_id, product_id, custom_price, notes, updated_at)
                            VALUES (?, ?, ?, 'Lưu tự động từ quầy POS', ?)
                            ON CONFLICT(customer_id, product_id) DO UPDATE SET
                                custom_price = excluded.custom_price,
                                updated_at = excluded.updated_at
                        """, (customer_id, it['product_id'], custom_base_price, now))

                if order_status == 'completed':
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
                        'status': order_status,
                        'customer_name': customer_name,
                        'items_count': len(processed_items),
                        'total_amount': total_amount,
                        'manual_discount': manual_discount,
                        'promotion_name': promo_name,
                        'promotion_discount': promo_discount,
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
                    "status": order_status,
                    "total_amount": total_amount,
                    "discount": total_discount,
                    "promotion_id": promotion_id,
                    "promotion_code": promo_code,
                    "promotion_discount": promo_discount,
                    "net_revenue": net_revenue,
                    "vat_amount": vat_amount,
                    "final_amount": final_amount,
                    "paid_amount": actual_paid,
                    "actual_paid": actual_paid,
                    "change_amount": change_amount,
                    "debt_amount": debt_amount,
                    "notes": notes
                }, 201)
                return

            # Complete Pending Order
            if path.startswith('/api/orders/') and path.endswith('/complete'):
                user, ok = self.require_auth('orders:create', conn=conn)
                if not ok:
                    return

                order_id = path.split('/')[3]
                cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                order = cursor.fetchone()
                if not order:
                    self.send_error_json("Đơn hàng không tồn tại", 404)
                    return

                if order['status'] != 'pending':
                    self.send_error_json(f"Chỉ có thể hoàn tất đơn hàng đang ở trạng thái 'pending' (hiện tại: {order['status']})", 400)
                    return

                cursor.execute("SELECT value FROM store_settings WHERE key = 'allow_negative_stock'")
                allow_neg_row = cursor.fetchone()
                allow_negative_stock = (allow_neg_row['value'].lower() == 'true') if allow_neg_row else False

                cursor.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
                order_items = cursor.fetchall()

                for it in order_items:
                    base_qty = float(it['base_quantity'] if it['base_quantity'] is not None else it['quantity'])
                    cursor.execute("SELECT stock, name, unit FROM products WHERE id = ?", (it['product_id'],))
                    p = cursor.fetchone()
                    if p and not allow_negative_stock and p['stock'] < base_qty:
                        self.send_error_json(f"Sản phẩm '{p['name']}' chỉ còn tồn {p['stock']} {p['unit']}, không đủ để hoàn tất xuất bán {base_qty}", 400)
                        return

                payment_method = body.get('payment_method', order['payment_method'] or 'cash')
                if body.get('paid_amount') is not None:
                    customer_paid = max(0, float(body.get('paid_amount')))
                elif body.get('actual_paid') is not None:
                    customer_paid = max(0, float(body.get('actual_paid')))
                elif order['customer_paid'] is not None:
                    customer_paid = max(0, float(order['customer_paid']))
                elif payment_method == 'debt':
                    customer_paid = 0.0
                else:
                    customer_paid = float(order['final_amount'])

                paid_amount = min(customer_paid, order['final_amount'])
                change_amount = max(0, customer_paid - order['final_amount'])
                debt_amount = max(0, order['final_amount'] - paid_amount)

                if debt_amount > 0 and (not order['customer_id'] or order['customer_id'] == 1):
                    self.send_error_json("Khách lẻ không thể ghi nợ. Vui lòng thanh toán đủ.", 400)
                    return

                now = get_now_str()
                for it in order_items:
                    base_qty = float(it['base_quantity'] if it['base_quantity'] is not None else it['quantity'])
                    cursor.execute("SELECT stock FROM products WHERE id = ?", (it['product_id'],))
                    p = cursor.fetchone()
                    if p:
                        new_stock = p['stock'] - base_qty
                        cursor.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, it['product_id']))
                        cursor.execute("""
                            INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                            VALUES (?, 'output', ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (it['product_id'], order['code'], -base_qty, p['stock'], new_stock, f"Xuất bán khi hoàn tất hóa đơn {order['code']}", now, user['id'], user['full_name']))

                if paid_amount > 0 and payment_method != 'debt':
                    rec_code = generate_code('PT', 'cash_flow', cursor)
                    cursor.execute("""
                        INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at, user_id, user_name)
                        VALUES (?, 'receipt', 'Bán hàng', ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (rec_code, paid_amount, order['customer_id'], order['customer_name'], payment_method, order['code'], f"Thu tiền hoàn tất hóa đơn {order['code']}", now, user['id'], user['full_name']))

                if order['customer_id'] and order['customer_id'] != 1:
                    cursor.execute("""
                        UPDATE customers
                        SET debt = debt + ?, total_spent = total_spent + ?
                        WHERE id = ?
                    """, (debt_amount, order['final_amount'], order['customer_id']))

                cursor.execute("""
                    UPDATE orders
                    SET status = 'completed', payment_method = ?, customer_paid = ?, paid_amount = ?, change_amount = ?, debt_amount = ?
                    WHERE id = ?
                """, (payment_method, customer_paid, paid_amount, change_amount, debt_amount, order_id))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='ORDER_COMPLETE',
                    entity_type='order',
                    entity_id=order_id,
                    entity_code=order['code'],
                    details={
                        'final_amount': order['final_amount'],
                        'paid_amount': paid_amount,
                        'debt_amount': debt_amount,
                        'payment_method': payment_method
                    },
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "new_status": "completed", "message": f"Đã hoàn tất hóa đơn {order['code']}"})
                return

            # Cancel Order (Safe Reversal)
            if path.startswith('/api/orders/') and path.endswith('/cancel'):
                user, ok = self.require_auth('orders:cancel', conn=conn)
                if not ok:
                    return

                order_id = path.split('/')[3]
                cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                order = cursor.fetchone()
                if not order:
                    self.send_error_json("Đơn hàng không tồn tại", 404)
                    return

                if order['status'] == 'cancelled':
                    self.send_error_json("Đơn hàng này đã bị hủy trước đó", 400)
                    return

                cursor.execute("SELECT COUNT(*) FROM returns WHERE order_id = ?", (order_id,))
                if cursor.fetchone()[0] > 0:
                    self.send_error_json("Không thể hủy đơn hàng đã có chứng từ đổi/trả hàng. Vui lòng xử lý chứng từ trả hàng trước!", 400)
                    return

                reason = body.get('reason', '').strip() or 'Hủy đơn hàng'
                now = get_now_str()

                if order['status'] == 'completed':
                    cursor.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
                    order_items = cursor.fetchall()
                    for it in order_items:
                        base_qty = float(it['base_quantity'] if it['base_quantity'] is not None else it['quantity'])
                        cursor.execute("SELECT stock, name, unit FROM products WHERE id = ?", (it['product_id'],))
                        prod = cursor.fetchone()
                        if prod:
                            new_stock = prod['stock'] + base_qty
                            cursor.execute("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", (new_stock, now, it['product_id']))
                            cursor.execute("""
                                INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at, user_id, user_name)
                                VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?)
                            """, (it['product_id'], order['code'], base_qty, prod['stock'], new_stock, f"Hoàn tồn do hủy hóa đơn {order['code']}: {reason}", now, user['id'], user['full_name']))

                    if order['customer_id'] and order['customer_id'] != 1:
                        cursor.execute("""
                            UPDATE customers
                            SET debt = MAX(0, debt - ?),
                                total_spent = MAX(0, total_spent - ?)
                            WHERE id = ?
                        """, (order['debt_amount'], order['final_amount'], order['customer_id']))

                    if order['paid_amount'] > 0 and order['payment_method'] != 'debt':
                        rev_cash_code = generate_code('PC', 'cash_flow', cursor)
                        cursor.execute("""
                            INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at, user_id, user_name)
                            VALUES (?, 'payment', 'Hủy hóa đơn', ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (rev_cash_code, order['paid_amount'], order['customer_id'], order['customer_name'], order['payment_method'], order['code'], f"Hoàn tiền do hủy hóa đơn {order['code']}: {reason}", now, user['id'], user['full_name']))

                cursor.execute("""
                    UPDATE orders
                    SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ?
                    WHERE id = ?
                """, (now, reason, order_id))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='ORDER_CANCEL',
                    entity_type='order',
                    entity_id=order_id,
                    entity_code=order['code'],
                    details={
                        'reason': reason,
                        'previous_status': order['status'],
                        'reversed_paid_amount': order['paid_amount'] if order['status'] == 'completed' else 0,
                        'reversed_debt_amount': order['debt_amount'] if order['status'] == 'completed' else 0
                    },
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "new_status": "cancelled", "message": f"Đã hủy thành công đơn hàng {order['code']}"})
                return

            # Duplicate Order into Draft/Pending Order
            if path.startswith('/api/orders/') and path.endswith('/duplicate'):
                user, ok = self.require_auth('orders:create', conn=conn)
                if not ok:
                    return

                order_id = path.split('/')[3]
                cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                orig = cursor.fetchone()
                if not orig:
                    self.send_error_json("Đơn hàng không tồn tại", 404)
                    return

                cursor.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
                items = cursor.fetchall()

                now = get_now_str()
                new_code = generate_code('HD', 'orders', cursor)

                cursor.execute("""
                    INSERT INTO orders (code, customer_id, customer_name, total_amount, discount, net_revenue, vat_percent, vat_amount, final_amount, customer_paid, paid_amount, change_amount, debt_amount, payment_method, status, total_cost, profit, notes, created_at, user_id, user_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 'pending', ?, ?, ?, ?, ?, ?)
                """, (new_code, orig['customer_id'], orig['customer_name'], orig['total_amount'], orig['discount'], orig['net_revenue'], orig['vat_percent'], orig['vat_amount'], orig['final_amount'], orig['payment_method'], orig['total_cost'], orig['profit'], f"Nhân bản từ {orig['code']}. {orig['notes'] or ''}".strip(), now, user['id'], user['full_name']))
                new_order_id = cursor.lastrowid

                for it in items:
                    cursor.execute("""
                        INSERT INTO order_items (order_id, product_id, product_code, product_name, unit, quantity, cost_price, sale_price, is_custom_price, subtotal, conversion_rate, base_quantity)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (new_order_id, it['product_id'], it['product_code'], it['product_name'], it['unit'], it['quantity'], it['cost_price'], it['sale_price'], it['is_custom_price'], it['subtotal'], it['conversion_rate'] or 1.0, it['base_quantity'] or it['quantity']))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='ORDER_DUPLICATE',
                    entity_type='order',
                    entity_id=new_order_id,
                    entity_code=new_code,
                    details={'original_order_code': orig['code']},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({
                    "id": new_order_id,
                    "code": new_code,
                    "status": "pending",
                    "message": f"Nhân bản thành công từ {orig['code']}"
                }, 201)
                return

            # Promotions Check (Validate and preview applicable promotions)
            if path == '/api/promotions/check':
                user, ok = self.require_auth('promotions:view', conn=conn)
                if not ok:
                    return

                cart_items = body.get('items', [])
                customer_id = body.get('customer_id')
                total_amount = float(body.get('total_amount', 0))

                for it in cart_items:
                    if 'subtotal' not in it or not it['subtotal']:
                        it_qty = float(it.get('quantity', 0))
                        it_price = float(it.get('unit_price') if it.get('unit_price') is not None else it.get('sale_price', 0))
                        it['subtotal'] = it_qty * it_price

                if total_amount <= 0 and cart_items:
                    total_amount = sum(float(it.get('subtotal', 0)) for it in cart_items)

                customer_group = 'all'
                if customer_id and customer_id != 1:
                    cursor.execute("SELECT group_name FROM customers WHERE id = ?", (customer_id,))
                    c_row = cursor.fetchone()
                    if c_row and c_row['group_name']:
                        customer_group = c_row['group_name']

                now_date = datetime.datetime.now().strftime("%Y-%m-%d")
                cursor.execute("""
                    SELECT * FROM promotions
                    WHERE is_active = 1 AND DATE(start_date) <= ? AND DATE(end_date) >= ?
                    ORDER BY discount_value DESC
                """, (now_date, now_date))
                promos = cursor.fetchall()

                applicable = []
                for promo in promos:
                    if promo['customer_group'] != 'all' and promo['customer_group'] != customer_group:
                        continue

                    p_scope = promo['scope']
                    min_amt = float(promo['min_order_amount'] or 0)
                    d_val = float(promo['discount_value'] or 0)
                    d_type = promo['discount_type']
                    calc_discount = 0

                    if p_scope == 'order':
                        if total_amount >= min_amt:
                            calc_discount = round(total_amount * (d_val / 100)) if d_type == 'percent' else min(d_val, total_amount)
                    elif p_scope == 'category':
                        target_cat = promo['target_category']
                        cat_subtotal = sum(float(it.get('subtotal', 0)) for it in cart_items if it.get('category') == target_cat)
                        if cat_subtotal >= min_amt:
                            calc_discount = round(cat_subtotal * (d_val / 100)) if d_type == 'percent' else min(d_val, cat_subtotal)
                    elif p_scope == 'product':
                        target_pid = promo['target_id']
                        prod_subtotal = sum(float(it.get('subtotal', 0)) for it in cart_items if it.get('product_id') == target_pid)
                        if prod_subtotal >= min_amt:
                            calc_discount = round(prod_subtotal * (d_val / 100)) if d_type == 'percent' else min(d_val, prod_subtotal)

                    if calc_discount > 0:
                        applicable.append({
                            "id": promo['id'],
                            "code": promo['code'],
                            "name": promo['name'],
                            "discount_type": promo['discount_type'],
                            "discount_value": promo['discount_value'],
                            "calculated_discount": calc_discount
                        })

                applicable.sort(key=lambda x: x['calculated_discount'], reverse=True)
                self.send_json(applicable)
                return

            # Promotions CRUD: Create
            if path == '/api/promotions':
                user, ok = self.require_auth('promotions:manage', conn=conn)
                if not ok:
                    return

                name = body.get('name', '').strip()
                if not name:
                    self.send_error_json("Tên chương trình khuyến mãi không được để trống", 400)
                    return

                start_date = body.get('start_date', get_now_str())
                end_date = body.get('end_date', '2030-12-31 23:59:59')
                scope = body.get('scope', 'order')
                target_id = body.get('target_id')
                target_category = body.get('target_category')
                discount_type = body.get('discount_type', 'percent')
                discount_value = float(body.get('discount_value', 0))
                min_order_amount = float(body.get('min_order_amount', 0))
                customer_group = body.get('customer_group', 'all')
                is_active = 1 if body.get('is_active', True) else 0
                now = get_now_str()

                code = generate_code('KM', 'promotions', cursor)

                cursor.execute("""
                    INSERT INTO promotions (code, name, start_date, end_date, is_active, scope, target_id, target_category, discount_type, discount_value, min_order_amount, customer_group, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (code, name, start_date, end_date, is_active, scope, target_id, target_category, discount_type, discount_value, min_order_amount, customer_group, now, now))
                promo_id = cursor.lastrowid

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PROMOTION_CREATE',
                    entity_type='promotion',
                    entity_id=promo_id,
                    entity_code=code,
                    details={'name': name, 'scope': scope, 'discount_value': discount_value, 'discount_type': discount_type},
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({"id": promo_id, "code": code, "name": name}, 201)
                return

            # Product Units: Add Unit to Product
            if path.startswith('/api/products/') and path.endswith('/units'):
                user, ok = self.require_auth('products:manage', conn=conn)
                if not ok:
                    return

                prod_id = path.split('/')[3]
                cursor.execute("SELECT id, name, unit FROM products WHERE id = ?", (prod_id,))
                prod = cursor.fetchone()
                if not prod:
                    self.send_error_json("Sản phẩm không tồn tại", 404)
                    return

                unit_name = (body.get('unit_name') or body.get('name') or '').strip()
                if not unit_name:
                    self.send_error_json("Tên đơn vị quy đổi không được để trống", 400)
                    return

                conversion_rate = float(body.get('conversion_rate', 1))
                if conversion_rate <= 0:
                    self.send_error_json("Hệ số quy đổi phải lớn hơn 0", 400)
                    return

                sale_price = float(body.get('sale_price', 0)) if body.get('sale_price') is not None else None
                cost_price = float(body.get('cost_price', 0)) if body.get('cost_price') is not None else None
                barcode = body.get('barcode', '').strip() or None
                is_base = 1 if body.get('is_base') else 0
                is_default_sale = 1 if body.get('is_default_sale') else 0
                now = get_now_str()

                if is_base == 1:
                    cursor.execute("UPDATE product_units SET is_base = 0 WHERE product_id = ?", (prod_id,))
                    cursor.execute("UPDATE products SET unit = ? WHERE id = ?", (unit_name, prod_id))

                cursor.execute("""
                    INSERT INTO product_units (product_id, unit_name, conversion_rate, sale_price, cost_price, barcode, is_base, is_default_sale, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(product_id, unit_name) DO UPDATE SET
                        conversion_rate = excluded.conversion_rate,
                        sale_price = excluded.sale_price,
                        cost_price = excluded.cost_price,
                        barcode = excluded.barcode,
                        is_base = excluded.is_base,
                        is_default_sale = excluded.is_default_sale
                """, (prod_id, unit_name, conversion_rate, sale_price, cost_price, barcode, is_base, is_default_sale, now))
                unit_id = cursor.lastrowid

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PRODUCT_UNIT_CREATE',
                    entity_type='product',
                    entity_id=prod_id,
                    entity_code=prod['unit'],
                    details={'unit_name': unit_name, 'conversion_rate': conversion_rate, 'sale_price': sale_price},
                    ip_address=client_ip
                )
                conn.commit()

                self.send_json({"success": True, "id": unit_id, "unit_name": unit_name, "conversion_rate": conversion_rate}, 201)
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

            # 5. UPDATE PROMOTION
            if path.startswith('/api/promotions/'):
                user, ok = self.require_auth('promotions:manage', conn=conn)
                if not ok:
                    return
                promo_id = path.split('/')[3]
                cursor.execute("SELECT * FROM promotions WHERE id = ?", (promo_id,))
                old_promo = cursor.fetchone()
                if not old_promo:
                    self.send_error_json("Chương trình khuyến mãi không tồn tại", 404)
                    return

                name = body.get('name', old_promo['name'])
                start_date = body.get('start_date', old_promo['start_date'])
                end_date = body.get('end_date', old_promo['end_date'])
                is_active = 1 if body.get('is_active', old_promo['is_active']) else 0
                scope = body.get('scope', old_promo['scope'])
                target_id = body.get('target_id', old_promo['target_id'])
                target_category = body.get('target_category', old_promo['target_category'])
                discount_type = body.get('discount_type', old_promo['discount_type'])
                discount_value = float(body.get('discount_value', old_promo['discount_value']))
                min_order_amount = float(body.get('min_order_amount', old_promo['min_order_amount']))
                customer_group = body.get('customer_group', old_promo['customer_group'])
                now = get_now_str()

                cursor.execute("""
                    UPDATE promotions
                    SET name = ?, start_date = ?, end_date = ?, is_active = ?, scope = ?,
                        target_id = ?, target_category = ?, discount_type = ?, discount_value = ?,
                        min_order_amount = ?, customer_group = ?, updated_at = ?
                    WHERE id = ?
                """, (name, start_date, end_date, is_active, scope, target_id, target_category, discount_type, discount_value, min_order_amount, customer_group, now, promo_id))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PROMOTION_UPDATE',
                    entity_type='promotion',
                    entity_id=promo_id,
                    entity_code=old_promo['code'],
                    details={'name': name, 'is_active': is_active, 'discount_value': discount_value},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": "Cập nhật khuyến mãi thành công"})
                return

            # 6. UPDATE PRODUCT UNIT
            if path.startswith('/api/product-units/'):
                user, ok = self.require_auth('products:manage', conn=conn)
                if not ok:
                    return
                unit_id = path.split('/')[3]
                cursor.execute("SELECT * FROM product_units WHERE id = ?", (unit_id,))
                old_u = cursor.fetchone()
                if not old_u:
                    self.send_error_json("Đơn vị quy đổi không tồn tại", 404)
                    return

                unit_name = body.get('unit_name', old_u['unit_name']).strip()
                conversion_rate = float(body.get('conversion_rate', old_u['conversion_rate']))
                if conversion_rate <= 0:
                    self.send_error_json("Hệ số quy đổi phải lớn hơn 0", 400)
                    return

                sale_price = float(body.get('sale_price', old_u['sale_price'] or 0)) if body.get('sale_price') is not None else None
                cost_price = float(body.get('cost_price', old_u['cost_price'] or 0)) if body.get('cost_price') is not None else None
                barcode = body.get('barcode', old_u['barcode'])
                is_default_sale = 1 if body.get('is_default_sale', old_u['is_default_sale']) else 0

                cursor.execute("""
                    UPDATE product_units
                    SET unit_name = ?, conversion_rate = ?, sale_price = ?, cost_price = ?, barcode = ?, is_default_sale = ?
                    WHERE id = ?
                """, (unit_name, conversion_rate, sale_price, cost_price, barcode, is_default_sale, unit_id))

                if old_u['is_base']:
                    cursor.execute("UPDATE products SET unit = ? WHERE id = ?", (unit_name, old_u['product_id']))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PRODUCT_UNIT_UPDATE',
                    entity_type='product',
                    entity_id=old_u['product_id'],
                    entity_code=unit_name,
                    details={'conversion_rate': conversion_rate, 'sale_price': sale_price},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": "Cập nhật đơn vị thành công"})
                return

            # 7. UPDATE ORDER (Notes or pending order details)
            if path.startswith('/api/orders/'):
                user, ok = self.require_auth('orders:edit', conn=conn)
                if not ok:
                    return
                order_id = path.split('/')[3]
                cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
                old_order = cursor.fetchone()
                if not old_order:
                    self.send_error_json("Đơn hàng không tồn tại", 404)
                    return

                if old_order['status'] == 'cancelled':
                    self.send_error_json("Không thể sửa đơn hàng đã hủy", 400)
                    return

                notes = body.get('notes', old_order['notes'])
                cursor.execute("UPDATE orders SET notes = ? WHERE id = ?", (notes, order_id))

                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='ORDER_UPDATE',
                    entity_type='order',
                    entity_id=order_id,
                    entity_code=old_order['code'],
                    details={'notes': notes},
                    ip_address=client_ip
                )
                conn.commit()
                self.send_json({"success": True, "message": "Cập nhật đơn hàng thành công"})
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

            if path.startswith('/api/promotions/'):
                user, ok = self.require_auth('promotions:manage', conn=conn)
                if not ok:
                    return
                promo_id = path.split('/')[3]
                cursor.execute("SELECT code, name FROM promotions WHERE id = ?", (promo_id,))
                promo = cursor.fetchone()
                if promo:
                    cursor.execute("DELETE FROM promotions WHERE id = ?", (promo_id,))
                    auth.log_audit(
                        cursor=cursor,
                        user_id=user['id'],
                        user_name=user['full_name'],
                        action='PROMOTION_DELETE',
                        entity_type='promotion',
                        entity_id=promo_id,
                        entity_code=promo['code'],
                        details={'deleted_promotion': promo['name']},
                        ip_address=client_ip
                    )
                    conn.commit()
                self.send_json({"success": True})
                return

            if path.startswith('/api/product-units/'):
                user, ok = self.require_auth('products:manage', conn=conn)
                if not ok:
                    return
                unit_id = path.split('/')[3]
                cursor.execute("SELECT * FROM product_units WHERE id = ?", (unit_id,))
                u = cursor.fetchone()
                if not u:
                    self.send_error_json("Đơn vị quy đổi không tồn tại", 404)
                    return
                if u['is_base']:
                    self.send_error_json("Không thể xóa đơn vị cơ sở của sản phẩm. Bạn chỉ có thể sửa tên hoặc đổi đơn vị cơ sở.", 400)
                    return

                cursor.execute("DELETE FROM product_units WHERE id = ?", (unit_id,))
                auth.log_audit(
                    cursor=cursor,
                    user_id=user['id'],
                    user_name=user['full_name'],
                    action='PRODUCT_UNIT_DELETE',
                    entity_type='product',
                    entity_id=u['product_id'],
                    entity_code=u['unit_name'],
                    details={'deleted_unit': u['unit_name']},
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
