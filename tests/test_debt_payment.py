"""
Tests for Customer and Supplier Debt Collection / Payment Endpoints:
- POST /api/customers/:id/pay-debt
- POST /api/customers/:id/collect-debt
- POST /api/suppliers/:id/pay-debt
- POST /api/suppliers/:id/collect-debt
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


class TestDebtPayment(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.temp_dir, 'test_debt_payment.db')
        database.DB_FILE = cls.db_path
        server.DB_FILE = cls.db_path

        database.init_db()

        conn = database.get_db()
        c = conn.cursor()

        # Admin user (has debt:manage)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('admin_debt', hash_password('Admin@123456'), 'Debt Admin', 'admin'))
        cls.admin_user_id = c.lastrowid
        cls.admin_token, _ = create_session(c, cls.admin_user_id, '127.0.0.1', 'PythonTest/1.0')

        # Cashier user (does NOT have debt:manage)
        c.execute("""
            INSERT INTO users (username, password_hash, full_name, role, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
        """, ('cashier_debt', hash_password('Cashier@123456'), 'Debt Cashier', 'cashier'))
        cls.cashier_user_id = c.lastrowid
        cls.cashier_token, _ = create_session(c, cls.cashier_user_id, '127.0.0.1', 'PythonTest/1.0')

        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls):
        import shutil
        database.DB_FILE = os.path.join(database.DATA_DIR, 'kiotviet.db')
        server.DB_FILE = database.DB_FILE
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def request(self, method, path, data=None, token=None):
        headers = {}
        use_token = token if token is not None else self.admin_token
        if use_token:
            headers['Authorization'] = f"Bearer {use_token}"
        status_code, resp_headers, parsed_json, raw_body = execute_http_request(
            method, path, headers=headers, body=data)
        return status_code, parsed_json, raw_body

    def test_01_auth_required(self):
        status, data, _ = self.request('POST', '/api/customers/1/pay-debt', {'amount': 1000}, token="")
        self.assertEqual(status, 401)

    def test_02_permission_required(self):
        # Cashier does not have debt:manage
        status, data, _ = self.request('POST', '/api/customers/1/pay-debt', {'amount': 1000}, token=self.cashier_token)
        self.assertEqual(status, 403)

    def test_03_validation_customer_not_found(self):
        status, data, _ = self.request('POST', '/api/customers/999999/pay-debt', {'amount': 50000})
        self.assertEqual(status, 404)
        self.assertIn('message', data)

    def test_04_validation_invalid_or_negative_amount(self):
        # Create customer with debt
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer Test Debt 1',
            'phone': '0911000001',
            'debt': 500000
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        # Zero amount
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': 0})
        self.assertEqual(status, 400)

        # Negative amount
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': -10000})
        self.assertEqual(status, 400)

        # Invalid string amount
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': 'invalid'})
        self.assertEqual(status, 400)

    def test_05_validation_amount_exceeds_debt(self):
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer Test Debt 2',
            'phone': '0911000002',
            'debt': 200000
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': 250000})
        self.assertEqual(status, 400)
        self.assertIn("không được vượt quá số dư nợ hiện tại", data.get('message', ''))

    def test_06_customer_pay_debt_success_contract(self):
        # Create customer with 1,000,000 debt
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer Test Pay Debt Contract',
            'phone': '0911000003',
            'debt': 1000000
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        # Pay 400,000 via /pay-debt
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {
            'amount': 400000,
            'fund_type': 'bank',
            'notes': 'Thu nợ đợt 1'
        })
        self.assertEqual(status, 200)
        self.assertTrue(data.get('success'))
        self.assertTrue(data.get('receipt_code', '').startswith('PT'))
        self.assertEqual(data.get('paid_amount'), 400000)
        # Contract alignment: both remaining_debt and new_debt must be present and match
        self.assertEqual(data.get('remaining_debt'), 600000)
        self.assertEqual(data.get('new_debt'), 600000)

        # Verify DB customer debt updated
        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT debt FROM customers WHERE id = ?", (cid,))
        row = c.fetchone()
        self.assertEqual(row['debt'], 600000)

        # Verify cash_flow record created
        c.execute("SELECT * FROM cash_flow WHERE code = ?", (data['receipt_code'],))
        cf = c.fetchone()
        self.assertIsNotNone(cf)
        self.assertEqual(cf['type'], 'receipt')
        self.assertEqual(cf['category'], 'Thu nợ khách hàng')
        self.assertEqual(cf['amount'], 400000)
        self.assertEqual(cf['target_type'], 'customer')
        self.assertEqual(cf['target_id'], cid)
        self.assertEqual(cf['fund_type'], 'bank')
        self.assertEqual(cf['notes'], 'Thu nợ đợt 1')

        # Verify audit log recorded
        c.execute("SELECT * FROM audit_logs WHERE action = 'DEBT_PAY_CUSTOMER' AND entity_id = ?", (cid,))
        audit = c.fetchone()
        self.assertIsNotNone(audit)
        conn.close()

    def test_07_customer_collect_debt_alias_success(self):
        # Create customer with 300,000 debt
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer Collect Debt Alias',
            'phone': '0911000004',
            'debt': 300000
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        # Call /collect-debt
        status, data, _ = self.request('POST', f'/api/customers/{cid}/collect-debt', {
            'amount': 300000,
            'fund_type': 'cash'
        })
        self.assertEqual(status, 200)
        self.assertTrue(data.get('success'))
        self.assertEqual(data.get('remaining_debt'), 0)
        self.assertEqual(data.get('new_debt'), 0)

        # Verify DB
        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT debt FROM customers WHERE id = ?", (cid,))
        row = c.fetchone()
        self.assertEqual(row['debt'], 0)
        conn.close()

    def test_08_supplier_pay_and_collect_debt(self):
        # Create supplier with 1,500,000 debt
        status, sup, _ = self.request('POST', '/api/suppliers', {
            'name': 'Supplier Debt Test',
            'debt': 1500000
        })
        self.assertEqual(status, 201)
        sid = sup['id']

        # Pay 500,000 via /pay-debt
        status, data, _ = self.request('POST', f'/api/suppliers/{sid}/pay-debt', {
            'amount': 500000,
            'fund_type': 'bank',
            'notes': 'Trả nợ NCC đợt 1'
        })
        self.assertEqual(status, 200)
        self.assertTrue(data.get('success'))
        self.assertTrue(data.get('payment_code', '').startswith('PC'))
        self.assertEqual(data.get('paid_amount'), 500000)
        self.assertEqual(data.get('remaining_debt'), 1000000)
        self.assertEqual(data.get('new_debt'), 1000000)

        # Pay 1,000,000 via /collect-debt alias
        status, data2, _ = self.request('POST', f'/api/suppliers/{sid}/collect-debt', {
            'amount': 1000000,
            'fund_type': 'cash'
        })
        self.assertEqual(status, 200)
        self.assertEqual(data2.get('remaining_debt'), 0)
        self.assertEqual(data2.get('new_debt'), 0)

        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT debt FROM suppliers WHERE id = ?", (sid,))
        row = c.fetchone()
        self.assertEqual(row['debt'], 0)
        conn.close()

    def test_09_trailing_slash_support(self):
        # Create customer with 200,000 debt
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer Trailing Slash',
            'phone': '0911000005',
            'debt': 200000
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        # Call with trailing slash
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt/', {'amount': 100000})
        self.assertEqual(status, 200)
        self.assertEqual(data.get('remaining_debt'), 100000)

        # Call alias with trailing slash
        status, data2, _ = self.request('POST', f'/api/customers/{cid}/collect-debt/', {'amount': 100000})
        self.assertEqual(status, 200)
        self.assertEqual(data2.get('remaining_debt'), 0)

    def test_10_validation_nan_infinity_and_boolean(self):
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer NaN Bool Test',
            'phone': '0911000006',
            'debt': 500000
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        # Boolean True must be rejected (not interpreted as 1.0)
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': True})
        self.assertEqual(status, 400)

        # Boolean False must be rejected
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': False})
        self.assertEqual(status, 400)

        # NaN string
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': 'nan'})
        self.assertEqual(status, 400)

        # Infinity string
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': 'Infinity'})
        self.assertEqual(status, 400)

        # Customer debt must remain unchanged
        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT debt FROM customers WHERE id = ?", (cid,))
        self.assertEqual(c.fetchone()['debt'], 500000)
        conn.close()

    def test_11_validation_invalid_ids(self):
        # Negative ID
        status, _, _ = self.request('POST', '/api/customers/-1/pay-debt', {'amount': 10000})
        self.assertEqual(status, 400)

        # Zero ID
        status, _, _ = self.request('POST', '/api/customers/0/pay-debt', {'amount': 10000})
        self.assertEqual(status, 400)

        # Non-numeric ID
        status, _, _ = self.request('POST', '/api/customers/abc/pay-debt', {'amount': 10000})
        self.assertEqual(status, 400)

    def test_12_decimal_precision_and_floating_rounding(self):
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer Decimal Debt',
            'phone': '0911000007',
            'debt': 150000.50
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': 50000.25})
        self.assertEqual(status, 200)
        self.assertEqual(data.get('remaining_debt'), 100000.25)
        self.assertEqual(data.get('new_debt'), 100000.25)

        # Pay remaining debt to zero
        status, data2, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {'amount': 100000.25})
        self.assertEqual(status, 200)
        self.assertEqual(data2.get('remaining_debt'), 0.0)

        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT debt FROM customers WHERE id = ?", (cid,))
        self.assertEqual(c.fetchone()['debt'], 0.0)
        conn.close()

    def test_13_null_fund_type_and_notes_fallback(self):
        status, cust, _ = self.request('POST', '/api/customers', {
            'name': 'Customer Fallback Test',
            'phone': '0911000008',
            'debt': 100000
        })
        self.assertEqual(status, 201)
        cid = cust['id']

        # Pass null fund_type and empty notes
        status, data, _ = self.request('POST', f'/api/customers/{cid}/pay-debt', {
            'amount': 50000,
            'fund_type': None,
            'notes': '   '
        })
        self.assertEqual(status, 200)

        # Verify cash_flow stored fund_type='cash' and default notes
        conn = database.get_db()
        c = conn.cursor()
        c.execute("SELECT fund_type, notes FROM cash_flow WHERE code = ?", (data['receipt_code'],))
        cf = c.fetchone()
        self.assertEqual(cf['fund_type'], 'cash')
        self.assertEqual(cf['notes'], 'Thu nợ khách hàng')
        conn.close()

    def test_14_supplier_validation_edge_cases(self):
        status, sup, _ = self.request('POST', '/api/suppliers', {
            'name': 'Supplier Validation Edge Cases',
            'debt': 800000
        })
        self.assertEqual(status, 201)
        sid = sup['id']

        # Trailing slash
        status, data, _ = self.request('POST', f'/api/suppliers/{sid}/pay-debt/', {'amount': 100000})
        self.assertEqual(status, 200)
        self.assertEqual(data.get('remaining_debt'), 700000)

        # Boolean amount
        status, _, _ = self.request('POST', f'/api/suppliers/{sid}/pay-debt', {'amount': True})
        self.assertEqual(status, 400)

        # NaN amount
        status, _, _ = self.request('POST', f'/api/suppliers/{sid}/pay-debt', {'amount': 'nan'})
        self.assertEqual(status, 400)

        # Invalid ID
        status, _, _ = self.request('POST', '/api/suppliers/-1/pay-debt', {'amount': 10000})
        self.assertEqual(status, 400)


if __name__ == '__main__':
    unittest.main()
