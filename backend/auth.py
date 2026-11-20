"""
Authentication, Authorization (RBAC), and Audit Trail Module for KiotPro.
Built strictly with Python standard library (hashlib, secrets, hmac, datetime, json).
"""

import hashlib
import secrets
import hmac
import datetime
import json
import sqlite3

# Default Roles & Descriptions
ROLES = {
    'admin': {
        'name': 'Quản trị viên',
        'description': 'Quản lý tài khoản, cấu hình bảo mật và toàn quyền truy cập hệ thống'
    },
    'manager': {
        'name': 'Quản lý',
        'description': 'Xem báo cáo, toàn quyền nghiệp vụ bán/nhập/kho/công nợ; không quản lý người dùng'
    },
    'cashier': {
        'name': 'Thu ngân',
        'description': 'Bán hàng POS, xem thông tin cần thiết, in hóa đơn; không xem giá vốn, không kiểm kho'
    },
    'warehouse': {
        'name': 'Kho',
        'description': 'Nhập kho, kiểm kho/điều chỉnh tồn và quản lý danh mục hàng; không quản lý quỹ tiền'
    },
    'accountant': {
        'name': 'Kế toán',
        'description': 'Quản lý công nợ, thanh toán, sổ quỹ thu/chi và xem báo cáo tài chính'
    },
    'viewer': {
        'name': 'Chỉ xem',
        'description': 'Chỉ xem dữ liệu được cấp quyền, không được thêm, sửa, xóa hay giao dịch'
    }
}

# Granular Permission Codes
# Principle: Deny by default. If a role lacks a permission, request is blocked with HTTP 403.
ROLE_PERMISSIONS = {
    'admin': {
        'users:manage', 'settings:manage', 'backup:download', 'audit:view',
        'reports:view', 'orders:create', 'orders:view',
        'purchases:create', 'purchases:view', 'returns:create', 'returns:view',
        'inventory:adjust', 'inventory:view', 'products:manage', 'products:view',
        'products:view_cost', 'customers:manage', 'customers:view',
        'suppliers:manage', 'suppliers:view', 'cash_flow:manage', 'cash_flow:view',
        'debt:manage'
    },
    'manager': {
        'audit:view', 'reports:view', 'orders:create', 'orders:view',
        'purchases:create', 'purchases:view', 'returns:create', 'returns:view',
        'inventory:adjust', 'inventory:view', 'products:manage', 'products:view',
        'products:view_cost', 'customers:manage', 'customers:view',
        'suppliers:manage', 'suppliers:view', 'cash_flow:manage', 'cash_flow:view',
        'debt:manage'
    },
    'cashier': {
        'orders:create', 'orders:view', 'returns:create', 'returns:view',
        'products:view',
        'customers:manage', 'customers:view'
    },
    'warehouse': {
        'purchases:create', 'purchases:view', 'inventory:adjust', 'inventory:view',
        'products:manage', 'products:view', 'products:view_cost',
        'suppliers:manage', 'suppliers:view'
    },
    'accountant': {
        'reports:view', 'orders:view', 'purchases:view', 'returns:view',
        'cash_flow:manage', 'cash_flow:view', 'debt:manage',
        'customers:view', 'suppliers:view', 'products:view', 'products:view_cost'
    },
    'viewer': {
        'orders:view', 'purchases:view', 'returns:view',
        'products:view', 'customers:view', 'suppliers:view', 'inventory:view'
    }
}

def has_permission(role, permission):
    """Check if given role possesses the required permission string."""
    if not role:
        return False
    perms = ROLE_PERMISSIONS.get(role, set())
    return permission in perms

# Password Hashing using PBKDF2-HMAC-SHA256 (Python Standard Library)
def hash_password(password: str) -> str:
    """Hash password using pbkdf2_hmac with sha256 and unique 16-byte random salt."""
    if not password or len(password) < 6:
        raise ValueError("Mật khẩu phải có tối thiểu 6 ký tự")
    salt = secrets.token_hex(16)
    iterations = 100_000
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${dk.hex()}"

def verify_password(password: str, hashed: str) -> bool:
    """Safely verify password against stored pbkdf2 hash using constant-time comparison."""
    if not password or not hashed:
        return False
    parts = hashed.split('$')
    if len(parts) != 4 or parts[0] != 'pbkdf2_sha256':
        return False
    try:
        iterations = int(parts[1])
        salt = parts[2].encode('utf-8')
        expected_hash = parts[3]
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
        return hmac.compare_digest(dk.hex(), expected_hash)
    except Exception:
        return False

# Session Management
SESSION_DURATION_HOURS = 24

def create_session(cursor, user_id, ip_address='', user_agent=''):
    """Create a new time-limited session in database."""
    token = secrets.token_urlsafe(32)
    now = datetime.datetime.now()
    created_at = now.strftime("%Y-%m-%d %H:%M:%S")
    expires_at = (now + datetime.timedelta(hours=SESSION_DURATION_HOURS)).strftime("%Y-%m-%d %H:%M:%S")
    
    cursor.execute("""
        INSERT INTO sessions (token, user_id, expires_at, created_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (token, user_id, expires_at, created_at, ip_address, user_agent))
    
    return token, expires_at

def get_session_user(cursor, token):
    """
    Validate session token. Return user dict if valid and not expired;
    If user is locked (is_active == 0) or session expired, purge and return None.
    """
    if not token:
        return None
    
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        SELECT s.token, s.user_id, s.expires_at,
               u.id, u.username, u.full_name, u.role, u.is_active
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ?
    """, (token,))
    row = cursor.fetchone()
    
    if not row:
        return None
    
    # Check expiry
    if row['expires_at'] < now:
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return None
    
    # Check active status (if locked, revoke all sessions)
    if not row['is_active']:
        cursor.execute("DELETE FROM sessions WHERE user_id = ?", (row['user_id'],))
        return None
    
    return {
        'id': row['id'],
        'username': row['username'],
        'full_name': row['full_name'],
        'role': row['role'],
        'is_active': row['is_active']
    }

def revoke_session(cursor, token):
    """Revoke a single session token (logout)."""
    if token:
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))

def revoke_user_sessions(cursor, user_id):
    """Revoke all active sessions for a user (e.g., when locked or password changed)."""
    cursor.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

# Bootstrap Helpers
def is_bootstrap_needed(cursor):
    """Check if the system has zero users and needs initial admin setup."""
    cursor.execute("SELECT COUNT(*) FROM users")
    return cursor.fetchone()[0] == 0

def bootstrap_admin(cursor, username, full_name, password, ip_address=''):
    """
    Safely create the first administrator account if and only if no users exist.
    Permanently locks once completed.
    """
    if not is_bootstrap_needed(cursor):
        raise ValueError("Hệ thống đã được thiết lập tài khoản quản trị. Không thể kích hoạt lại bootstrap!")
    
    if not username or len(username.strip()) < 3:
        raise ValueError("Tên đăng nhập phải có ít nhất 3 ký tự")
    if not full_name or len(full_name.strip()) < 2:
        raise ValueError("Họ và tên không được để trống")
    
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pw_hash = hash_password(password)
    clean_username = username.strip().lower()
    clean_fullname = full_name.strip()
    
    cursor.execute("""
        INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, 'admin', 1, ?, ?)
    """, (clean_username, pw_hash, clean_fullname, now, now))
    
    user_id = cursor.lastrowid
    
    # Record bootstrap audit log
    log_audit(
        cursor=cursor,
        user_id=user_id,
        user_name=clean_fullname,
        action='BOOTSTRAP_INITIAL_ADMIN',
        entity_type='user',
        entity_id=user_id,
        entity_code=clean_username,
        details={'message': 'Thiết lập tài khoản Quản trị viên ban đầu thành công', 'username': clean_username, 'role': 'admin'},
        ip_address=ip_address
    )
    
    return user_id

# Audit Trail Helper
def log_audit(cursor, user_id, user_name, action, entity_type, entity_id=None, entity_code=None, details=None, ip_address=''):
    """
    Write audit event in the same active SQLite transaction.
    If audit fails, caller's transaction automatically rolls back.
    Ensures no passwords, tokens, or authentication secrets are ever logged.
    """
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Sanitize details (strip any passwords or tokens)
    clean_details = {}
    if isinstance(details, dict):
        for k, v in details.items():
            if k.lower() in ('password', 'token', 'secret', 'cookie', 'password_hash'):
                continue
            clean_details[k] = v
        details_str = json.dumps(clean_details, ensure_ascii=False)
    elif isinstance(details, list):
        details_str = json.dumps(details, ensure_ascii=False)
    else:
        details_str = str(details or '')
    
    cursor.execute("""
        INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, entity_code, details, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        user_id,
        user_name or 'Hệ thống / Dữ liệu cũ',
        action,
        entity_type,
        entity_id,
        entity_code or '',
        details_str,
        ip_address or '',
        now
    ))
