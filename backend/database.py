"""
Database module for KiotPro POS & Distribution Management.
Features:
- Full relational schema with SQLite
- Weighted Average Cost (MAC - Moving Average Cost)
- Accurate cash flow accounting & change tracking
- Net revenue & VAT separation for strict profit calculations
- Unit conversions (e.g. Thùng -> Lon)
- Customer-specific product pricing
- Return goods management (Đổi/Trả hàng)
- Strict validation & audit trails
"""

import sqlite3
import os
import datetime

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = (
    os.environ.get('KIOTPRO_DATA_DIR')
    or os.environ.get('RAILWAY_VOLUME_MOUNT_PATH')
    or os.path.join(PROJECT_DIR, 'data')
)
DB_FILE = os.path.join(DATA_DIR, 'kiotviet.db')

def get_db():
    # isolation_level=None + BEGIN IMMEDIATE o cac handler ghi: chuan multi-thread
    conn = sqlite3.connect(DB_FILE, timeout=8.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 8000")
    try:
        conn.execute("PRAGMA journal_mode = WAL")
    except sqlite3.Error:
        pass
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_FILE), exist_ok=True)
    conn = get_db()
    cursor = conn.cursor()

    # 1. Products Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        barcode TEXT,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'Chung',
        unit TEXT DEFAULT 'Cái',
        sub_unit TEXT,
        sub_unit_ratio REAL DEFAULT 1,
        cost_price REAL DEFAULT 0,
        sale_price REAL DEFAULT 0,
        stock REAL DEFAULT 0,
        min_stock REAL DEFAULT 5,
        created_at TEXT,
        updated_at TEXT
    )
    """)

    # 2. Customers Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        group_name TEXT DEFAULT 'Khách lẻ',
        debt REAL DEFAULT 0,
        total_spent REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT
    )
    """)

    # 3. Customer-Specific Pricing Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customer_product_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        custom_price REAL NOT NULL,
        notes TEXT,
        updated_at TEXT,
        UNIQUE(customer_id, product_id)
    )
    """)

    # 4. Suppliers Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        debt REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT
    )
    """)

    # 5. Orders Table (Sales / Output)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(id),
        customer_name TEXT,
        total_amount REAL NOT NULL,       -- Gross subtotal (tổng tiền hàng trước giảm giá & VAT)
        discount REAL DEFAULT 0,          -- Chiết khấu
        net_revenue REAL DEFAULT 0,       -- Doanh thu thuần = total_amount - discount (trước VAT)
        vat_percent REAL DEFAULT 0,       -- % thuế VAT
        vat_amount REAL DEFAULT 0,        -- Tiền thuế VAT
        final_amount REAL NOT NULL,       -- Khách cần trả = net_revenue + vat_amount
        customer_paid REAL DEFAULT 0,     -- Tiền thực khách đưa (ví dụ 200,000 đ)
        paid_amount REAL NOT NULL,        -- Tiền thực thanh toán vào hóa đơn = min(customer_paid, final_amount)
        change_amount REAL DEFAULT 0,     -- Tiền thừa trả khách = max(0, customer_paid - final_amount)
        debt_amount REAL DEFAULT 0,       -- Tiền ghi nợ = max(0, final_amount - paid_amount)
        payment_method TEXT DEFAULT 'cash',-- cash, bank, debt
        status TEXT DEFAULT 'completed',  -- completed, cancelled, returned
        total_cost REAL DEFAULT 0,        -- Tổng giá vốn tính theo MAC
        profit REAL DEFAULT 0,            -- Lợi nhuận gộp = net_revenue - total_cost (không tính thuế VAT vào lợi nhuận!)
        notes TEXT,
        created_at TEXT
    )
    """)

    # 6. Order Items
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_code TEXT,
        product_name TEXT,
        unit TEXT,
        quantity REAL NOT NULL,
        cost_price REAL NOT NULL,
        sale_price REAL NOT NULL,
        is_custom_price INTEGER DEFAULT 0,
        subtotal REAL NOT NULL
    )
    """)

    # 7. Purchases Table (Goods Receipt / Input)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        supplier_name TEXT,
        total_amount REAL NOT NULL,
        discount REAL DEFAULT 0,
        final_amount REAL NOT NULL,
        paid_amount REAL NOT NULL,
        debt_amount REAL DEFAULT 0,
        payment_method TEXT DEFAULT 'cash',
        status TEXT DEFAULT 'completed',
        notes TEXT,
        created_at TEXT
    )
    """)

    # 8. Purchase Items
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS purchase_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_code TEXT,
        product_name TEXT,
        unit TEXT,
        quantity REAL NOT NULL,
        import_price REAL NOT NULL,
        subtotal REAL NOT NULL
    )
    """)

    # 9. Returns Table (Khách trả hàng)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        order_id INTEGER REFERENCES orders(id),
        customer_id INTEGER REFERENCES customers(id),
        customer_name TEXT,
        total_amount REAL NOT NULL,
        refund_amount REAL NOT NULL,
        debt_deduct_amount REAL DEFAULT 0,
        fund_type TEXT DEFAULT 'cash',
        notes TEXT,
        created_at TEXT
    )
    """)

    # 10. Return Items
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS return_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_name TEXT,
        unit TEXT,
        quantity REAL NOT NULL,
        return_price REAL NOT NULL,
        cost_price REAL NOT NULL,
        subtotal REAL NOT NULL
    )
    """)

    # 11. Inventory Logs (Thẻ kho)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS inventory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type TEXT NOT NULL, -- 'input', 'output', 'adjustment', 'return'
        reference_code TEXT,
        change_qty REAL NOT NULL,
        stock_before REAL NOT NULL,
        stock_after REAL NOT NULL,
        notes TEXT,
        created_at TEXT
    )
    """)

    # 12. Cash Flow (Sổ quỹ & Dòng tiền)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cash_flow (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL, -- 'receipt' (Thu), 'payment' (Chi)
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        target_type TEXT, -- 'customer', 'supplier', 'other'
        target_id INTEGER,
        target_name TEXT,
        fund_type TEXT DEFAULT 'cash', -- 'cash', 'bank'
        reference_code TEXT,
        notes TEXT,
        created_at TEXT
    )
    """)

    # 13. Store Settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS store_settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)

    # 14. Customer Order Summary View
    cursor.execute("""
    CREATE VIEW IF NOT EXISTS customer_order_summary AS
    SELECT customer_id, COUNT(*) AS order_count
    FROM orders
    WHERE status = 'completed' AND customer_id IS NOT NULL
    GROUP BY customer_id;
    """)

    conn.commit()
    backup_db_before_migration()
    apply_migrations(conn)
    seed_initial_data(conn)
    conn.close()

def backup_db_before_migration():
    """Create a safety backup of SQLite database before executing migrations."""
    if os.path.exists(DB_FILE) and os.path.getsize(DB_FILE) > 0:
        backup_dir = os.path.dirname(DB_FILE)
        pre_v2_backup = os.path.join(backup_dir, 'kiotviet_backup_pre_v2.db')
        pre_v3_backup = os.path.join(backup_dir, 'kiotviet_backup_pre_v3.db')
        import shutil
        if not os.path.exists(pre_v2_backup):
            try:
                shutil.copy2(DB_FILE, pre_v2_backup)
                print(f"[Backup] Đã tự động sao lưu an toàn cơ sở dữ liệu: {pre_v2_backup}")
            except Exception as e:
                print(f"[Backup Warning] Không thể sao lưu tự động pre_v2: {e}")
        if not os.path.exists(pre_v3_backup):
            try:
                shutil.copy2(DB_FILE, pre_v3_backup)
                print(f"[Backup] Đã tự động sao lưu an toàn cơ sở dữ liệu: {pre_v3_backup}")
            except Exception as e:
                print(f"[Backup Warning] Không thể sao lưu tự động pre_v3: {e}")


def format_stock_breakdown(stock, units):
    """
    Format stock quantity into multi-tier breakdown string.
    e.g. 383 with units Thùng(36), Lốc(6), Lon(1) -> '10 Thùng 3 Lốc 5 Lon'
    Accepts decimals e.g. 383.5 -> '10 Thùng 3 Lốc 5.5 Lon'
    """
    if not units:
        return f"{stock:g}"
    valid_units = [u for u in units if float(u.get('conversion_rate', 1)) > 0]
    if not valid_units:
        return f"{stock:g}"
    sorted_units = sorted(valid_units, key=lambda u: float(u['conversion_rate']), reverse=True)
    base_unit = next((u for u in sorted_units if u.get('is_base') or float(u['conversion_rate']) == 1.0), sorted_units[-1])

    if stock == 0:
        return f"0 {base_unit.get('unit_name', '')}"

    is_neg = stock < 0
    rem = round(abs(stock), 6)
    parts = []

    for i, u in enumerate(sorted_units):
        rate = float(u['conversion_rate'])
        is_last = (i == len(sorted_units) - 1)
        if is_last:
            if rem > 0 or len(parts) == 0:
                qty_str = f"{rem:g}"
                parts.append(f"{qty_str} {u.get('unit_name', '')}")
            rem = 0
        else:
            if rem >= rate:
                cnt = int(rem // rate)
                rem = round(rem - (cnt * rate), 6)
                if cnt > 0:
                    parts.append(f"{cnt} {u.get('unit_name', '')}")

    res = " ".join(parts) if parts else f"0 {base_unit.get('unit_name', '')}"
    return f"-({res})" if is_neg else res

def apply_migrations(conn):
    """
    Versioned database migrations with strict schema tracking.
    Ensures safe, additive schema evolutions with zero data loss.
    """
    cursor = conn.cursor()
    
    # 0. Create schema_migrations table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
    )
    """)
    conn.commit()

    # Get applied versions
    cursor.execute("SELECT version FROM schema_migrations")
    applied_versions = {row['version'] for row in cursor.fetchall()}

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # MIGRATION V1: Baseline schema
    if 1 not in applied_versions:
        # Check and migrate columns that might be missing on legacy databases
        try:
            cursor.execute("PRAGMA table_info(products)")
            prod_cols = [r['name'] for r in cursor.fetchall()]
            if 'sub_unit' not in prod_cols:
                cursor.execute("ALTER TABLE products ADD COLUMN sub_unit TEXT")
            if 'sub_unit_ratio' not in prod_cols:
                cursor.execute("ALTER TABLE products ADD COLUMN sub_unit_ratio REAL DEFAULT 1")

            cursor.execute("PRAGMA table_info(orders)")
            order_cols = [r['name'] for r in cursor.fetchall()]
            if 'net_revenue' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN net_revenue REAL DEFAULT 0")
            if 'vat_percent' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN vat_percent REAL DEFAULT 0")
            if 'vat_amount' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN vat_amount REAL DEFAULT 0")
            if 'customer_paid' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN customer_paid REAL DEFAULT 0")
            if 'change_amount' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN change_amount REAL DEFAULT 0")
        except Exception as e:
            print(f"[Migration v1 Note] {e}")

        cursor.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'v1_initial_schema', ?)", (now_str,))
        conn.commit()
        print("[Migration] Applied Migration v1: v1_initial_schema")

    # MIGRATION V2: RBAC, User Authentication & Audit Trail
    if 2 not in applied_versions:
        print("[Migration] Applying Migration v2: v2_auth_rbac_audit...")
        
        # 1. Users table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            is_active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT
        )
        """)
        
        # 2. Sessions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")

        # 3. Audit Logs table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            entity_code TEXT,
            details TEXT,
            ip_address TEXT,
            created_at TEXT NOT NULL
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_code ON audit_logs(entity_code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)")

        # 4. Attach user_id and user_name to business vouchers
        tables_to_add_user = ['orders', 'purchases', 'returns', 'inventory_logs', 'cash_flow']
        for tbl in tables_to_add_user:
            try:
                cursor.execute(f"PRAGMA table_info({tbl})")
                cols = [r['name'] for r in cursor.fetchall()]
                if 'user_id' not in cols:
                    cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN user_id INTEGER")
                if 'user_name' not in cols:
                    cursor.execute(f"ALTER TABLE {tbl} ADD COLUMN user_name TEXT")
            except Exception as e:
                print(f"[Migration v2 Column Note] {tbl}: {e}")

        # 5. Mark legacy data clearly with 'Hệ thống / Dữ liệu cũ' (do not guess identity)
        for tbl in tables_to_add_user:
            try:
                cursor.execute(f"UPDATE {tbl} SET user_name = 'Hệ thống / Dữ liệu cũ' WHERE user_name IS NULL")
            except Exception as e:
                pass

        cursor.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, 'v2_auth_rbac_audit', ?)", (now_str,))
        conn.commit()
        print("[Migration] Applied Migration v2: v2_auth_rbac_audit successfully!")

    # MIGRATION V3: Multi-tier packaging units, Promotions, Order adjust/delete & Pre-orders
    if 3 not in applied_versions:
        print("[Migration] Applying Migration v3: v3_multi_units_promotions...")

        # 1. Product Units table (multi-tier: Lon -> Lốc -> Thùng)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS product_units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            unit_name TEXT NOT NULL,
            conversion_rate REAL NOT NULL DEFAULT 1,
            sale_price REAL DEFAULT 0,
            cost_price REAL DEFAULT 0,
            barcode TEXT,
            is_base INTEGER DEFAULT 0,
            created_at TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_prod_units_prod ON product_units(product_id)")

        # 2. Promotions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS promotions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL, -- 'percent', 'fixed', 'order_discount_percent', 'order_discount_amount', 'product_discount_percent', 'product_discount_amount', 'buy_x_get_y'
            value REAL DEFAULT 0,
            discount_value REAL DEFAULT 0,
            applicable_product_ids TEXT,
            min_order_amount REAL DEFAULT 0,
            target_product_id INTEGER REFERENCES products(id),
            gift_product_id INTEGER REFERENCES products(id),
            buy_quantity REAL DEFAULT 0,
            gift_quantity REAL DEFAULT 0,
            start_date TEXT,
            end_date TEXT,
            is_active INTEGER DEFAULT 1,
            notes TEXT,
            created_at TEXT,
            user_id INTEGER,
            user_name TEXT
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_promotions_code ON promotions(code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(is_active)")

        # 3. Add order columns for promotions
        try:
            cursor.execute("PRAGMA table_info(orders)")
            order_cols = [r['name'] for r in cursor.fetchall()]
            if 'promotion_id' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN promotion_id INTEGER")
            if 'promotion_code' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN promotion_code TEXT")
            if 'promotion_discount' not in order_cols:
                cursor.execute("ALTER TABLE orders ADD COLUMN promotion_discount REAL DEFAULT 0")
        except Exception as e:
            print(f"[Migration v3 Orders Note] {e}")

        # 4. Add order_items columns for multi-unit conversion and gift
        try:
            cursor.execute("PRAGMA table_info(order_items)")
            item_cols = [r['name'] for r in cursor.fetchall()]
            if 'unit_conversion_rate' not in item_cols:
                cursor.execute("ALTER TABLE order_items ADD COLUMN unit_conversion_rate REAL DEFAULT 1")
            if 'is_gift' not in item_cols:
                cursor.execute("ALTER TABLE order_items ADD COLUMN is_gift INTEGER DEFAULT 0")
        except Exception as e:
            print(f"[Migration v3 OrderItems Note] {e}")

        # 5. Populate product_units for existing products if not present
        cursor.execute("SELECT id, name, unit, sub_unit, sub_unit_ratio, sale_price, cost_price, barcode FROM products")
        existing_products = cursor.fetchall()
        for p in existing_products:
            cursor.execute("SELECT COUNT(*) FROM product_units WHERE product_id = ?", (p['id'],))
            if cursor.fetchone()[0] == 0:
                # Add base unit
                cursor.execute("""
                INSERT INTO product_units (product_id, unit_name, conversion_rate, sale_price, cost_price, barcode, is_base, created_at)
                VALUES (?, ?, 1, ?, ?, ?, 1, ?)
                """, (p['id'], p['unit'], p['sale_price'], p['cost_price'], p['barcode'], now_str))

                # If product had sub_unit in v2
                if p['sub_unit'] and p['sub_unit_ratio'] and float(p['sub_unit_ratio']) > 1:
                    sub_ratio = float(p['sub_unit_ratio'])
                    sub_sale = round(p['sale_price'] / sub_ratio)
                    sub_cost = round(p['cost_price'] / sub_ratio)
                    cursor.execute("""
                    INSERT INTO product_units (product_id, unit_name, conversion_rate, sale_price, cost_price, barcode, is_base, created_at)
                    VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
                    """, (p['id'], p['sub_unit'], round(1.0 / sub_ratio, 6), sub_sale, sub_cost, now_str))

        # 6. Customer Order Summary View
        cursor.execute("""
        CREATE VIEW IF NOT EXISTS customer_order_summary AS
        SELECT customer_id, COUNT(*) AS order_count
        FROM orders
        WHERE status = 'completed' AND customer_id IS NOT NULL
        GROUP BY customer_id;
        """)

        cursor.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (3, 'v3_multi_units_promotions', ?)", (now_str,))
        conn.commit()
        print("[Migration] Applied Migration v3: v3_multi_units_promotions successfully!")

    # Ensure promotions table has value and applicable_product_ids columns
    try:
        cursor.execute("PRAGMA table_info(promotions)")
        promo_cols = [r['name'] for r in cursor.fetchall()]
        if promo_cols:
            if 'value' not in promo_cols:
                cursor.execute("ALTER TABLE promotions ADD COLUMN value REAL DEFAULT 0")
                cursor.execute("UPDATE promotions SET value = discount_value WHERE value = 0 AND discount_value != 0")
            if 'applicable_product_ids' not in promo_cols:
                cursor.execute("ALTER TABLE promotions ADD COLUMN applicable_product_ids TEXT")
            conn.commit()
    except Exception as e:
        print(f"[Migration Promotions Note] {e}")

def migrate_columns(conn):
    """Backward compatibility stub redirecting to apply_migrations."""
    apply_migrations(conn)

def seed_initial_data(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM products")
    if cursor.fetchone()[0] > 0:
        return

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Seed Store Settings
    settings = [
        ('store_name', 'Tổng Kho Phân Phối & Bán Lẻ KiotPro'),
        ('store_phone', '0909 123 456'),
        ('store_address', '128 Đường Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh'),
        ('store_currency', 'VNĐ'),
        ('default_vat_rate', '0'),
        ('allow_negative_stock', 'false'),
        ('invoice_footer', 'Cảm ơn quý khách! Hàng mua được đổi trả trong vòng 48h kèm hóa đơn.')
    ]
    cursor.executemany("INSERT OR REPLACE INTO store_settings (key, value) VALUES (?, ?)", settings)

    # Seed Suppliers
    suppliers = [
        ('NCC0001', 'Công ty Phân Phối Nước Giải Khát Tân Hiệp', '0912 345 678', 'tanhiep@gmail.com', 'KCN VSIP, Bình Dương', 3500000, 'Nhà phân phối nước ngọt, bia, trà xanh', now),
        ('NCC0002', 'Tổng Kho Bánh Kẹo Hữu Nghị Miền Nam', '0988 777 666', 'huunghi@gmail.com', 'Tân Bình, TP.HCM', 0, 'Nhà cung cấp bánh kẹo các loại', now),
        ('NCC0003', 'Công ty Lương Thực & Thực Phẩm Đại Nam', '0903 111 222', 'dainam@gmail.com', 'Quận 7, TP.HCM', 1200000, 'Dầu ăn, gia vị, gạo ST25, sữa', now),
    ]
    cursor.executemany("""
    INSERT INTO suppliers (code, name, phone, email, address, debt, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, suppliers)

    # Seed Customers
    customers = [
        ('KH0001', 'Khách lẻ tại quầy', '---', '', '', 'Khách vãng lai', 0, 0, 'Khách hàng mua lẻ tại quầy', now),
        ('KH0002', 'Nguyễn Văn Hùng (Đại Lý Minh Khai)', '0918 222 333', 'hung.minhkhai@gmail.com', '15 Minh Khai, Hà Nội', 'Đại lý cấp 1', 4500000, 18500000, 'Đại lý sỉ lớn, hưởng giá chiết khấu riêng theo từng sản phẩm', now),
        ('KH0003', 'Trần Thị Mai (Tạp Hóa Mai Linh)', '0977 888 999', 'mailinh@gmail.com', '88 Quang Trung, Gò Vấp, TP.HCM', 'Bán buôn', 1200000, 8900000, 'Tạp hóa buôn vừa, thanh toán định kỳ', now),
        ('KH0004', 'Lê Hoàng Nam (Quán Cafe Góc Phố)', '0933 444 555', 'gocpho.cafe@gmail.com', '42 Nguyễn Huệ, Quận 1, TP.HCM', 'VIP', 0, 14200000, 'Khách ruột lấy nước ngọt và sữa đặc đều đặn', now),
    ]
    cursor.executemany("""
    INSERT INTO customers (code, name, phone, email, address, group_name, debt, total_spent, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, customers)

    # Seed Products with Packaging Sub-units
    products = [
        ('SP0001', '893500170001', 'Thùng Nước ngọt Coca Cola 24 lon 320ml', 'Nước giải khát', 'Thùng', 'Lon', 24, 195000, 245000, 48, 10, now, now),
        ('SP0002', '893500170002', 'Lon Nước ngọt Coca Cola 320ml', 'Nước giải khát', 'Lon', None, 1, 8500, 12000, 120, 24, now, now),
        ('SP0003', '893500170003', 'Thùng Bia Heineken Silver 24 lon 330ml', 'Bia & Rượu', 'Thùng', 'Lon', 24, 410000, 470000, 32, 10, now, now),
        ('SP0004', '893500170004', 'Gạo ST25 Ông Cua Túi 5kg', 'Lương thực', 'Túi', 'Kg', 5, 165000, 210000, 25, 5, now, now),
        ('SP0005', '893500170005', 'Dầu ăn Neptune Gold Chai 1 Lít', 'Gia vị thực phẩm', 'Chai', None, 1, 52000, 68000, 60, 15, now, now),
        ('SP0006', '893500170006', 'Hộp Bánh Danisa Bơ Hoàng Gia 454g', 'Bánh kẹo', 'Hộp', None, 1, 115000, 155000, 18, 5, now, now),
        ('SP0007', '893500170007', 'Thùng Sữa tươi tiệt trùng Vinamilk 100% 48 hộp 180ml', 'Sữa & Bơ', 'Thùng', 'Hộp', 48, 330000, 385000, 4, 10, now, now), # Low stock alert!
        ('SP0008', '893500170008', 'Sữa đặc có đường Ông Thọ đỏ Hộp 380g', 'Sữa & Bơ', 'Hộp', None, 1, 21000, 28000, 85, 20, now, now),
        ('SP0009', '893500170009', 'Bịch Nước giặt OMO Matic Cửa Trên 3.6kg', 'Hóa mỹ phẩm', 'Bịch', None, 1, 160000, 205000, 15, 5, now, now),
        ('SP0010', '893500170010', 'Thùng Mì Omachi Xốt Bò Hầm 30 gói', 'Mì & Miến', 'Thùng', 'Gói', 30, 190000, 235000, 40, 10, now, now),
        ('SP0011', '893500170011', 'Nước ngọt Pepsi lon 330ml (Đa đơn vị Thùng/Lốc/Lon)', 'Nước giải khát', 'Lon', 'Thùng', 36, 7000, 10000, 383, 24, now, now)
    ]
    cursor.executemany("""
    INSERT INTO products (code, barcode, name, category, unit, sub_unit, sub_unit_ratio, cost_price, sale_price, stock, min_stock, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, products)

    # Seed Product Units
    cursor.execute("SELECT id, code, unit, sub_unit, sub_unit_ratio, sale_price, cost_price, barcode FROM products")
    all_prods = cursor.fetchall()
    for p in all_prods:
        if p['code'] == 'SP0011':
            pepsi_units = [
                (p['id'], 'Thùng', 36, 340000, 250000, '893500170011-T', 0, now),
                (p['id'], 'Lốc', 6, 58000, 42000, '893500170011-L', 0, now),
                (p['id'], 'Lon', 1, 10000, 7000, '893500170011', 1, now)
            ]
            cursor.executemany("""
            INSERT INTO product_units (product_id, unit_name, conversion_rate, sale_price, cost_price, barcode, is_base, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, pepsi_units)
        else:
            cursor.execute("""
            INSERT INTO product_units (product_id, unit_name, conversion_rate, sale_price, cost_price, barcode, is_base, created_at)
            VALUES (?, ?, 1, ?, ?, ?, 1, ?)
            """, (p['id'], p['unit'], p['sale_price'], p['cost_price'], p['barcode'], now))
            if p['sub_unit'] and p['sub_unit_ratio'] and float(p['sub_unit_ratio']) > 1:
                sub_ratio = float(p['sub_unit_ratio'])
                cursor.execute("""
                INSERT INTO product_units (product_id, unit_name, conversion_rate, sale_price, cost_price, barcode, is_base, created_at)
                VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
                """, (p['id'], p['sub_unit'], round(1.0 / sub_ratio, 6), round(p['sale_price'] / sub_ratio), round(p['cost_price'] / sub_ratio), now))

    # Seed Sample Promotions
    sample_promos = [
        ('KM0001', 'Giảm 10% cho đơn hàng từ 500.000 đ', 'order_discount_percent', 500000, 10, None, None, 0, 0, '2026-01-01', '2027-12-31', 1, 'Áp dụng cho mọi khách hàng khi đơn đạt 500k', now, None, 'Hệ thống'),
        ('KM0002', 'Giảm 50.000 đ cho đơn hàng từ 1.000.000 đ', 'order_discount_amount', 1000000, 50000, None, None, 0, 0, '2026-01-01', '2027-12-31', 1, 'Giảm tiền mặt trực tiếp vào hóa đơn', now, None, 'Hệ thống')
    ]
    cursor.executemany("""
    INSERT INTO promotions (code, name, type, min_order_amount, discount_value, target_product_id, gift_product_id, buy_quantity, gift_quantity, start_date, end_date, is_active, notes, created_at, user_id, user_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, sample_promos)

    # Seed Customer-Specific Pricing (Bảng giá riêng theo từng khách)
    custom_prices = [
        (2, 1, 220000, 'Giá đại lý cấp 1 ký hợp đồng năm', now),
        (2, 3, 435000, 'Giá chiết khấu sản lượng bia Heineken', now),
        (2, 7, 355000, 'Giá buôn sữa Vinamilk', now),
        (3, 1, 230000, 'Giá buôn tạp hóa lấy trên 5 thùng', now),
        (4, 8, 24000, 'Giá riêng khách cafe ruột lấy đều đặn', now),
        (4, 2, 10500, 'Giá lon nước ngọt cho khách quán cafe', now),
    ]
    cursor.executemany("""
    INSERT INTO customer_product_prices (customer_id, product_id, custom_price, notes, updated_at)
    VALUES (?, ?, ?, ?, ?)
    """, custom_prices)

    # Seed Initial Stock Movement Logs
    cursor.execute("SELECT id, code, stock FROM products")
    prods = cursor.fetchall()
    for p in prods:
        cursor.execute("""
        INSERT INTO inventory_logs (product_id, type, reference_code, change_qty, stock_before, stock_after, notes, created_at)
        VALUES (?, 'input', 'TON-DAU-KY', ?, 0, ?, 'Nhập tồn kho ban đầu', ?)
        """, (p['id'], p['stock'], p['stock'], now))

    # Seed Initial Cash Flow
    cash_flows = [
        ('PT0001', 'receipt', 'Số dư đầu kỳ', 25000000, 'internal', None, 'Quỹ tiền mặt tại quầy', 'cash', 'TON-QUY', 'Quỹ tiền mặt đầu kỳ', now),
        ('PT0002', 'receipt', 'Số dư đầu kỳ', 80000000, 'internal', None, 'Vietcombank', 'bank', 'TON-QUY-NH', 'Tài khoản ngân hàng đầu kỳ', now),
        ('PC0001', 'payment', 'Chi phí thuê mặt bằng', 12000000, 'other', None, 'Chủ nhà', 'bank', 'THUE-NHA-T11', 'Tiền thuê mặt bằng tháng 11', now),
        ('PC0002', 'payment', 'Chi trả tiền điện nước', 2150000, 'other', None, 'Điện Lực & Cấp Nước', 'cash', 'HOADON-DIEN', 'Tiền điện nước tháng 10', now)
    ]
    cursor.executemany("""
    INSERT INTO cash_flow (code, type, category, amount, target_type, target_id, target_name, fund_type, reference_code, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, cash_flows)

    conn.commit()

if __name__ == '__main__':
    init_db()
    print("Database schema upgraded and initialized successfully at:", DB_FILE)
