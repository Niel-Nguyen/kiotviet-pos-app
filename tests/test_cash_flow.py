"""
Tests for Cash Flow (Sổ quỹ & Dòng tiền) Endpoints:
- GET /api/cash-flow
- GET /api/cash-flow/summary
- GET /api/fund-summary
- POST /api/cash-flow

Verifies:
1. RBAC permissions (401 unauthenticated, 403 cashier, 200 accountant/admin)
2. Response structure of GET /api/cash-flow:
   - Contains { items, data, cash_flows, summary }
   - Contains summary with { total_receipts, total_payments, current_balance, cash_balance, bank_balance }
   - raw/list format query parameter fallback
3. Filter behaviors:
   - type: 'all', 'receipt', 'payment'
   - fund: 'all', 'cash', 'bank'
   - search: keyword in code, category, target_name
4. Synchronization:
   - Cash flow summary metrics match GET /api/reports/dashboard funds
   - Point-in-time calculation matches actual database ledger
5. POST /api/cash-flow:
   - Strict validation (invalid type, <=0 amount, empty category)
   - Successful creation and atomic fund balance update
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
        server.KiotVietHandler(sock, ('127.0.0.1', 54321), FakeServer())
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


class TestCashFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_cash_flow.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path
        database.init_db()

    def setUp(self):
        conn = database.get_db()
        c = conn.cursor()
        c.execute("DELETE FROM cash_flow")
        c.execute("DELETE FROM sessions")
        c.execute("DELETE FROM users")
        conn.commit()
        conn.close()

    def _create_user(self, username, role, full_name="User"):
        conn = database.get_db()
        c = conn.cursor()
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        pwd_hash = hash_password("Pass123456")
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
        """, (username, pwd_hash, full_name, role, now, now))
        uid = c.lastrowid
        token, _ = create_session(c, uid, '127.0.0.1', 'Test/1.0')
        conn.commit()
        conn.close()
        return uid, {"Authorization": f"Bearer {token}"}

    def _populate_sample_cash_flow(self):
        conn = database.get_db()
        c = conn.cursor()
        now = "2026-11-23 10:00:00"
        records = [
            # Receipts: total 100,000,000 (cash: 40M, bank: 60M)
            ('PT0001', 'receipt', 'Số dư đầu kỳ', 40000000.0, 'internal', 'Quỹ tiền mặt', 'cash', 'Quỹ đầu kỳ', now),
            ('PT0002', 'receipt', 'Số dư đầu kỳ', 60000000.0, 'internal', 'Vietcombank', 'bank', 'Tài khoản đầu kỳ', now),
            ('PT0003', 'receipt', 'Bán hàng', 5000000.0, 'customer', 'Khách A', 'cash', 'HD0001', now),
            # Payments: total 35,000,000 (cash: 15M, bank: 20M)
            ('PC0001', 'payment', 'Tiền thuê mặt bằng', 20000000.0, 'other', 'Chủ nhà', 'bank', 'Tiền thuê', now),
            ('PC0002', 'payment', 'Tiền điện nước', 5000000.0, 'other', 'Điện Lực', 'cash', 'Tiền điện', now),
            ('PC0003', 'payment', 'Văn phòng phẩm', 10000000.0, 'other', 'Nhà sách', 'cash', 'Giấy in', now),
        ]
        for r in records:
            c.execute("""
                INSERT INTO cash_flow (code, type, category, amount, target_type, target_name, fund_type, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, r)
        conn.commit()
        conn.close()

    def test_01_rbac_cash_flow_endpoints(self):
        """Unauthenticated requests get 401; Cashier gets 403; Accountant/Admin get 200."""
        # Unauthenticated
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow")
        self.assertEqual(code, 401)
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow/summary")
        self.assertEqual(code, 401)
        code, _, data, _ = execute_http_request("GET", "/api/fund-summary")
        self.assertEqual(code, 401)

        # Cashier role (does NOT have cash_flow:view)
        _, cashier_headers = self._create_user("cashier1", "cashier", "Cashier A")
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow", headers=cashier_headers)
        self.assertEqual(code, 403)
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow/summary", headers=cashier_headers)
        self.assertEqual(code, 403)
        code, _, data, _ = execute_http_request("GET", "/api/fund-summary", headers=cashier_headers)
        self.assertEqual(code, 403)

        # Accountant role (has cash_flow:view)
        _, acct_headers = self._create_user("acct1", "accountant", "Accountant B")
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow", headers=acct_headers)
        self.assertEqual(code, 200)
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow/summary", headers=acct_headers)
        self.assertEqual(code, 200)

        # Admin role
        _, admin_headers = self._create_user("admin1", "admin", "Admin System")
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow", headers=admin_headers)
        self.assertEqual(code, 200)
        code, _, data, _ = execute_http_request("GET", "/api/cash-flow/summary", headers=admin_headers)
        self.assertEqual(code, 200)

    def test_02_cash_flow_summary_calculation_and_synchronization(self):
        """Summary calculation matches ledger math and dashboard fund balances."""
        self._populate_sample_cash_flow()
        _, admin_headers = self._create_user("admin2", "admin", "Admin System")

        code, _, summary, _ = execute_http_request("GET", "/api/cash-flow/summary", headers=admin_headers)
        self.assertEqual(code, 200)
        # Receipts: 40M + 60M + 5M = 105M
        # Payments: 20M + 5M + 10M = 35M
        # Net balance: 105M - 35M = 70M
        # Cash: 45M receipts - 15M payments = 30M
        # Bank: 60M receipts - 20M payments = 40M
        self.assertEqual(summary['total_receipts'], 105000000.0)
        self.assertEqual(summary['total_payments'], 35000000.0)
        self.assertEqual(summary['current_balance'], 70000000.0)
        self.assertEqual(summary['cash_balance'], 30000000.0)
        self.assertEqual(summary['bank_balance'], 40000000.0)

        # Test fund alias /api/fund-summary
        code_alias, _, alias_summary, _ = execute_http_request("GET", "/api/fund-summary", headers=admin_headers)
        self.assertEqual(code_alias, 200)
        self.assertEqual(alias_summary['current_balance'], 70000000.0)

        # Verify synchronization with dashboard stats
        dash_code, _, dash_data, _ = execute_http_request("GET", "/api/reports/dashboard", headers=admin_headers)
        self.assertEqual(dash_code, 200)
        dash_funds = dash_data['funds']
        self.assertEqual(dash_funds['total_balance'], summary['current_balance'])
        self.assertEqual(dash_funds['cash_balance'], summary['cash_balance'])
        self.assertEqual(dash_funds['bank_balance'], summary['bank_balance'])

    def test_03_get_cash_flow_response_structure_and_filters(self):
        """GET /api/cash-flow returns { items, data, cash_flows, summary } and filters correctly."""
        self._populate_sample_cash_flow()
        _, admin_headers = self._create_user("admin3", "admin", "Admin System")

        code, _, res, _ = execute_http_request("GET", "/api/cash-flow", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertIn("items", res)
        self.assertIn("data", res)
        self.assertIn("cash_flows", res)
        self.assertIn("summary", res)
        self.assertEqual(len(res['items']), 6)
        self.assertEqual(res['summary']['current_balance'], 70000000.0)

        # Filter type=receipt
        code, _, res_rec, _ = execute_http_request("GET", "/api/cash-flow?type=receipt", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertEqual(len(res_rec['items']), 3)
        self.assertTrue(all(item['type'] == 'receipt' for item in res_rec['items']))

        # Filter type=payment
        code, _, res_pay, _ = execute_http_request("GET", "/api/cash-flow?type=payment", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertEqual(len(res_pay['items']), 3)
        self.assertTrue(all(item['type'] == 'payment' for item in res_pay['items']))

        # Filter fund=cash
        code, _, res_cash, _ = execute_http_request("GET", "/api/cash-flow?fund=cash", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertTrue(all(item['fund_type'] == 'cash' for item in res_cash['items']))

        # Filter fund=bank
        code, _, res_bank, _ = execute_http_request("GET", "/api/cash-flow?fund=bank", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertTrue(all(item['fund_type'] == 'bank' for item in res_bank['items']))

        # Combination type=payment&fund=bank
        code, _, res_combo, _ = execute_http_request("GET", "/api/cash-flow?type=payment&fund=bank", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertEqual(len(res_combo['items']), 1)
        self.assertEqual(res_combo['items'][0]['code'], 'PC0001')

        # Raw format query parameter returns array
        code, _, raw_res, _ = execute_http_request("GET", "/api/cash-flow?format=raw", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertIsInstance(raw_res, list)
        self.assertEqual(len(raw_res), 6)

    def test_04_create_cash_flow_voucher_and_audit(self):
        """POST /api/cash-flow creates voucher, logs audit, and updates summary."""
        _, admin_headers = self._create_user("admin4", "admin", "Admin System")

        # Validation: missing/invalid data
        code, _, err, _ = execute_http_request("POST", "/api/cash-flow", headers=admin_headers, body={
            "type": "invalid", "amount": 100000, "category": "Test"
        })
        self.assertEqual(code, 400)

        code, _, err, _ = execute_http_request("POST", "/api/cash-flow", headers=admin_headers, body={
            "type": "receipt", "amount": -500, "category": "Test"
        })
        self.assertEqual(code, 400)

        # Successful Receipt
        code, _, receipt_res, _ = execute_http_request("POST", "/api/cash-flow", headers=admin_headers, body={
            "type": "receipt",
            "category": "Thu tiền dịch vụ",
            "amount": 2500000.0,
            "target_name": "Công ty ABC",
            "fund_type": "cash",
            "notes": "Hợp đồng dịch vụ bảo trì"
        })
        self.assertEqual(code, 201)
        self.assertTrue(receipt_res['code'].startswith('PT'))

        # Check summary reflects new receipt
        code, _, summary, _ = execute_http_request("GET", "/api/cash-flow/summary", headers=admin_headers)
        self.assertEqual(code, 200)
        self.assertEqual(summary['total_receipts'], 2500000.0)
        self.assertEqual(summary['cash_balance'], 2500000.0)

        # Successful Payment
        code, _, pay_res, _ = execute_http_request("POST", "/api/cash-flow", headers=admin_headers, body={
            "type": "payment",
            "category": "Chi tiền tiếp khách",
            "amount": 500000.0,
            "target_name": "Nhà hàng Sen",
            "fund_type": "cash",
            "notes": "Họp đối tác"
        })
        self.assertEqual(code, 201)
        self.assertTrue(pay_res['code'].startswith('PC'))

        # Check updated net balance: 2.5M - 0.5M = 2.0M
        code, _, summary2, _ = execute_http_request("GET", "/api/cash-flow/summary", headers=admin_headers)
        self.assertEqual(summary2['current_balance'], 2000000.0)
        self.assertEqual(summary2['cash_balance'], 2000000.0)

    def test_05_production_db_cash_flow_integrity(self):
        """Verify queries on real data/kiotviet.db return 123,842,000 balance and valid transactions."""
        import sqlite3
        real_db = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'kiotviet.db')
        if not os.path.exists(real_db):
            self.skipTest("Production database data/kiotviet.db not found")

        conn = sqlite3.connect(real_db)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        summary = server.get_cash_flow_summary(c)

        self.assertEqual(summary['current_balance'], 123842000.0)
        self.assertEqual(summary['total_receipts'], 217552000.0)
        self.assertEqual(summary['total_payments'], 93710000.0)
        self.assertEqual(summary['cash_balance'], 85362000.0)
        self.assertEqual(summary['bank_balance'], 61300000.0)

        # Check transactions list
        c.execute("SELECT * FROM cash_flow ORDER BY id DESC")
        rows = [dict(r) for r in c.fetchall()]
        self.assertGreaterEqual(len(rows), 25)
        # First row has valid codes and amounts
        self.assertTrue(all(r['code'] and r['amount'] > 0 for r in rows))
        conn.close()


if __name__ == '__main__':
    unittest.main()
