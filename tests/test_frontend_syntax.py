import unittest
import subprocess
import os
import tempfile
import json

class TestFrontendExecution(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        chrome_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
        ]
        cls.chrome_exe = None
        for p in chrome_paths:
            if os.path.exists(p):
                cls.chrome_exe = p
                break

    def setUp(self):
        if not self.chrome_exe:
            self.skipTest("Chrome not installed on this system")

    def test_01_comprehensive_frontend_suite(self):
        """
        Executes test_frontend.html in headless Chrome to verify:
        - Global objects (API, POS, App) and essential methods
        - formatMoney, removeVietnameseTones, matchesSearch
        - Unauthenticated state: display name, role badge (not stuck on 'Đang tải...')
        - Authenticated state transitions (admin, cashier)
        - Navigation and click responsiveness across all 14 views
        - Modals: open, close button, backdrop click, auth-modal safety barrier
        - POS module: cart manipulation, calculations, discounts, VAT
        - RBAC and Access Denied rendering with direct login prompt
        """
        test_html_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "test_frontend.html"))
        cmd = [
            self.chrome_exe,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--dump-dom",
            f"file:///{test_html_path.replace(os.sep, '/')}"
        ]

        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="ignore")
        output = result.stdout

        self.assertIn("ALL_TESTS_PASSED", output, f"Frontend test suite failed. Output: {output[-1500:]}")

    def test_02_production_index_html_clean_load(self):
        """
        Directly executes production frontend/index.html in headless Chrome with an error spy
        to ensure zero SyntaxErrors, zero parse exceptions, and that the topbar user badge
        does not remain stuck displaying 'Đang tải...'.
        """
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        index_html_path = os.path.join(repo_root, "frontend", "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            html = f.read()

        spy_script = """<script>
        window.__captured_errors = [];
        window.addEventListener('error', function(e) {
            window.__captured_errors.push({ type: 'error', message: e.message, file: e.filename, line: e.lineno });
        });
        window.addEventListener('unhandledrejection', function(e) {
            var reason = e.reason && e.reason.message ? e.reason.message : String(e.reason);
            // Ignore expected network fetch failure on file:/// protocol
            if (!reason.includes('Failed to fetch') && !reason.includes('fetch')) {
                window.__captured_errors.push({ type: 'unhandledrejection', reason: reason });
            }
        });
        setTimeout(function() {
            var el = document.createElement('div');
            el.id = '__test_spy_output';
            el.textContent = JSON.stringify({
                errors: window.__captured_errors,
                roleBadgeText: document.getElementById('user-role-badge') ? document.getElementById('user-role-badge').textContent : '',
                displayNameText: document.getElementById('user-display-name') ? document.getElementById('user-display-name').textContent : '',
                appDefined: typeof window.App === 'object' && window.App !== null,
                posDefined: typeof window.POS === 'object' && window.POS !== null,
                apiDefined: typeof window.API === 'object' && window.API !== null
            });
            document.body.appendChild(el);
        }, 1500);
        </script>
        """

        html_with_spy = html.replace("<head>", "<head>\n" + spy_script)
        temp_html = os.path.join(repo_root, "frontend", "_test_index_spy.html")
        with open(temp_html, "w", encoding="utf-8") as f:
            f.write(html_with_spy)

        try:
            cmd = [
                self.chrome_exe,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--virtual-time-budget=3000",
                "--dump-dom",
                f"file:///{temp_html.replace(os.sep, '/')}"
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="ignore")
            dom = res.stdout

            idx = dom.find('id="__test_spy_output"')
            self.assertNotEqual(idx, -1, "Test spy output div was not found in rendered DOM")

            start = dom.find('>', idx) + 1
            end = dom.find('</div>', start)
            spy_data = json.loads(dom[start:end])

            # Assert App, POS, API are all defined
            self.assertTrue(spy_data['appDefined'], "window.App must be defined")
            self.assertTrue(spy_data['posDefined'], "window.POS must be defined")
            self.assertTrue(spy_data['apiDefined'], "window.API must be defined")

            # Assert zero JS syntax/parse errors
            self.assertEqual(len(spy_data['errors']), 0, f"JS errors occurred during index.html load: {spy_data['errors']}")

            # Assert user role badge is NOT stuck on "Đang tải..."
            self.assertNotIn("Đang tải...", spy_data['roleBadgeText'], "User role badge must not remain stuck on 'Đang tải...'")
            self.assertIn("Chưa đăng nhập", spy_data['roleBadgeText'], "User role badge should display 'Chưa đăng nhập' when unauthenticated")
        finally:
            if os.path.exists(temp_html):
                try:
                    os.remove(temp_html)
                except Exception:
                    pass

    def test_03_product_modal_dom_contract(self):
        """
        Verify that all DOM element IDs manipulated by product modal lifecycle methods
        (openCreateProductModal, openEditProductModal, saveProductForm) in frontend/js/app.js
        actually exist inside #product-modal in frontend/index.html.
        """
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        index_html_path = os.path.join(repo_root, "frontend", "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            html = f.read()

        required_ids = [
            "product-modal",
            "product-modal-title",
            "prod-id",
            "prod-code",
            "prod-barcode",
            "prod-name",
            "prod-category",
            "prod-unit",
            "prod-cost-price",
            "prod-sale-price",
            "prod-stock",
            "prod-min-stock",
            "product-units-tbody",
            "prod-sub-unit",
            "prod-sub-unit-ratio"
        ]

        # Extract only the product-modal section
        modal_start = html.find('id="product-modal"')
        self.assertNotEqual(modal_start, -1, "product-modal element must exist in index.html")
        modal_end = html.find('<!-- 2. Customer Modal -->', modal_start)
        product_modal_html = html[modal_start:modal_end] if modal_end != -1 else html[modal_start:]

        for el_id in required_ids:
            self.assertIn(f'id="{el_id}"', product_modal_html, f"Expected ID '{el_id}' inside #product-modal in index.html")

    def test_04_product_edit_execution_in_browser(self):
        """
        Directly executes openEditProductModal inside production index.html in headless Chrome
        to verify that clicking 'Sửa' does NOT trigger 'Lỗi mở form sản phẩm: Cannot set properties of null'.
        """
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        index_html_path = os.path.join(repo_root, "frontend", "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            html = f.read()

        test_script = """<script>
        window.__product_test_result = { completed: false, errors: [], toasts: [] };
        window.addEventListener('error', function(e) {
            window.__product_test_result.errors.push(e.message);
        });

        window.addEventListener('DOMContentLoaded', function() {
            setTimeout(async function() {
                try {
                    // Mock API.getProducts
                    window.API.getProducts = async function() {
                        return [
                            {
                                id: 101,
                                code: 'SP0101',
                                barcode: '893500101',
                                name: 'Bánh Quy Bơ Danisa 454g',
                                category: 'Bánh kẹo',
                                unit: 'Hộp',
                                sub_unit: 'Thùng',
                                sub_unit_ratio: 12,
                                cost_price: 95000,
                                sale_price: 125000,
                                stock: 36,
                                min_stock: 5,
                                units: [
                                    { unit_name: 'Hộp', conversion_rate: 1.0, is_base: 1, sale_price: 125000 },
                                    { unit_name: 'Thùng', conversion_rate: 12.0, is_base: 0, sale_price: 1450000 }
                                ]
                            }
                        ];
                    };

                    // Spy on App.toast
                    var origToast = window.App.toast;
                    window.App.toast = function(msg, type) {
                        window.__product_test_result.toasts.push({ msg: msg, type: type });
                        origToast.call(window.App, msg, type);
                    };

                    // Trigger openEditProductModal
                    await window.App.openEditProductModal(101);

                    var modal = document.getElementById('product-modal');
                    var title = document.getElementById('product-modal-title');
                    var nameInput = document.getElementById('prod-name');
                    var codeInput = document.getElementById('prod-code');
                    var priceInput = document.getElementById('prod-sale-price');

                    window.__product_test_result.modalActive = modal && modal.classList.contains('active');
                    window.__product_test_result.titleText = title ? title.textContent : '';
                    window.__product_test_result.nameValue = nameInput ? nameInput.value : '';
                    window.__product_test_result.codeValue = codeInput ? codeInput.value : '';
                    window.__product_test_result.priceValue = priceInput ? priceInput.value : '';
                    window.__product_test_result.completed = true;
                } catch (err) {
                    window.__product_test_result.errors.push(err.message);
                } finally {
                    var el = document.createElement('div');
                    el.id = '__product_test_output';
                    el.textContent = JSON.stringify(window.__product_test_result);
                    document.body.appendChild(el);
                }
            }, 600);
        });
        </script>
        """

        html_with_test = html.replace("<head>", "<head>\n" + test_script)
        temp_html = os.path.join(repo_root, "frontend", "_test_product_edit.html")
        with open(temp_html, "w", encoding="utf-8") as f:
            f.write(html_with_test)

        try:
            cmd = [
                self.chrome_exe,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--virtual-time-budget=4000",
                "--dump-dom",
                f"file:///{temp_html.replace(os.sep, '/')}"
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="ignore")
            dom = res.stdout

            idx = dom.find('id="__product_test_output"')
            self.assertNotEqual(idx, -1, "Product test output div was not found in rendered DOM")

            start = dom.find('>', idx) + 1
            end = dom.find('</div>', start)
            test_data = json.loads(dom[start:end])

            self.assertTrue(test_data['completed'], f"Product edit test did not complete: {test_data}")
            self.assertEqual(len(test_data['errors']), 0, f"Errors occurred during product edit: {test_data['errors']}")
            self.assertTrue(test_data['modalActive'], "Product modal should be active after openEditProductModal")
            self.assertIn("Bánh Quy Bơ Danisa", test_data['titleText'], "Product modal title should include product name")
            self.assertEqual(test_data['nameValue'], "Bánh Quy Bơ Danisa 454g", "Product name input should be populated")
            self.assertEqual(test_data['codeValue'], "SP0101", "Product SKU code input should be populated")
            self.assertEqual(test_data['priceValue'], "125000", "Product sale price input should be populated")

            # Check that no error toast was fired
            error_toasts = [t for t in test_data['toasts'] if t['type'] == 'error']
            self.assertEqual(len(error_toasts), 0, f"Error toast was displayed: {error_toasts}")
        finally:
            if os.path.exists(temp_html):
                try:
                    os.remove(temp_html)
                except Exception:
                    pass

    def test_05_product_edit_button_dom_click_workflow(self):
        """
        Simulate real user mouse click on the 'Sửa' button rendered inside the products table
        on the 'Quản lý Hàng hóa & Tồn kho' view and verify the edit modal opens cleanly with zero errors.
        """
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        index_html_path = os.path.join(repo_root, "frontend", "index.html")
        with open(index_html_path, "r", encoding="utf-8") as f:
            html = f.read()

        test_script = """<script>
        window.__click_test_result = { completed: false, errors: [], toasts: [] };
        window.addEventListener('error', function(e) {
            window.__click_test_result.errors.push(e.message);
        });

        window.addEventListener('DOMContentLoaded', function() {
            setTimeout(async function() {
                try {
                    window.API.getCategories = async function() { return ['Bánh kẹo', 'Nước ngọt']; };
                    window.API.getProducts = async function() {
                        return [
                            {
                                id: 202,
                                code: 'SP0202',
                                barcode: '893600202',
                                name: 'Nước Tăng Lực RedBull 250ml',
                                category: 'Nước ngọt',
                                unit: 'Lon',
                                sub_unit: 'Thùng',
                                sub_unit_ratio: 24,
                                cost_price: 11000,
                                sale_price: 15000,
                                stock: 120,
                                min_stock: 10,
                                units: [
                                    { unit_name: 'Lon', conversion_rate: 1.0, is_base: 1, sale_price: 15000 },
                                    { unit_name: 'Thùng', conversion_rate: 24.0, is_base: 0, sale_price: 350000 }
                                ]
                            }
                        ];
                    };

                    var origToast = window.App.toast;
                    window.App.toast = function(msg, type) {
                        window.__click_test_result.toasts.push({ msg: msg, type: type });
                        origToast.call(window.App, msg, type);
                    };

                    // Switch to products view and render table
                    window.App.currentUser = { role: 'admin', full_name: 'Quản trị viên' };
                    await window.App.renderProductsView();
                    await window.App.loadProductsTable();

                    // Find the 'Sửa' button rendered in table
                    var editBtn = document.querySelector('#products-table-body button[title="Sửa"]');
                    if (!editBtn) {
                        throw new Error("Could not find 'Sửa' button in #products-table-body");
                    }

                    // Click 'Sửa'
                    editBtn.click();

                    // Wait microtask for async openEditProductModal
                    await new Promise(r => setTimeout(r, 100));

                    var modal = document.getElementById('product-modal');
                    var nameInput = document.getElementById('prod-name');
                    var codeInput = document.getElementById('prod-code');
                    var priceInput = document.getElementById('prod-sale-price');
                    var unitRows = document.querySelectorAll('#product-units-tbody tr.unit-row-item');

                    window.__click_test_result.modalActive = modal && modal.classList.contains('active');
                    window.__click_test_result.nameValue = nameInput ? nameInput.value : '';
                    window.__click_test_result.codeValue = codeInput ? codeInput.value : '';
                    window.__click_test_result.priceValue = priceInput ? priceInput.value : '';
                    window.__click_test_result.unitRowCount = unitRows.length;
                    window.__click_test_result.completed = true;
                } catch (err) {
                    window.__click_test_result.errors.push(err.message);
                } finally {
                    var el = document.createElement('div');
                    el.id = '__click_test_output';
                    el.textContent = JSON.stringify(window.__click_test_result);
                    document.body.appendChild(el);
                }
            }, 600);
        });
        </script>
        """

        html_with_test = html.replace("<head>", "<head>\n" + test_script)
        temp_html = os.path.join(repo_root, "frontend", "_test_product_click.html")
        with open(temp_html, "w", encoding="utf-8") as f:
            f.write(html_with_test)

        try:
            cmd = [
                self.chrome_exe,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--virtual-time-budget=4000",
                "--dump-dom",
                f"file:///{temp_html.replace(os.sep, '/')}"
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="ignore")
            dom = res.stdout

            idx = dom.find('id="__click_test_output"')
            self.assertNotEqual(idx, -1, "Click test output div was not found in rendered DOM")

            start = dom.find('>', idx) + 1
            end = dom.find('</div>', start)
            test_data = json.loads(dom[start:end])

            self.assertTrue(test_data['completed'], f"Click test did not complete: {test_data}")
            self.assertEqual(len(test_data['errors']), 0, f"Errors occurred during button click: {test_data['errors']}")
            self.assertTrue(test_data['modalActive'], "Product modal should be active after clicking 'Sửa'")
            self.assertEqual(test_data['nameValue'], "Nước Tăng Lực RedBull 250ml", "Product name input should be populated")
            self.assertEqual(test_data['codeValue'], "SP0202", "Product SKU code input should be populated")
            self.assertEqual(test_data['priceValue'], "15000", "Product sale price input should be populated")
            self.assertEqual(test_data['unitRowCount'], 1, "Secondary unit row should be populated in units table")

            # Check that no error toast was fired
            error_toasts = [t for t in test_data['toasts'] if t['type'] == 'error']
            self.assertEqual(len(error_toasts), 0, f"Error toast was displayed on clicking 'Sửa': {error_toasts}")
        finally:
            if os.path.exists(temp_html):
                try:
                    os.remove(temp_html)
                except Exception:
                    pass

if __name__ == "__main__":
    unittest.main()
