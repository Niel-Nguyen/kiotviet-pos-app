/**
 * Main Application Controller for KiotPro POS & Distribution Management
 * Multi-device LAN ready, financial date filtering, store settings configuration,
 * sales returns, and inventory audit.
 */

const App = {
  currentView: 'dashboard',
  selectedCustomerForPricing: null,
  dashboardRange: 'today',
  purchaseDraftItems: [],

  async init() {
    this.setupNavigation();
    this.setupModals();
    this.loadTopFundSummary();
    this.navigate('dashboard');

    // F9 shortcut to switch to POS
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F9') {
        e.preventDefault();
        this.navigate('pos');
      }
    });
  },

  formatMoney(amount, withSymbol = true) {
    const num = Math.round(Number(amount) || 0);
    const formatted = num.toLocaleString('vi-VN');
    return withSymbol ? `${formatted} đ` : formatted;
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  },

  async loadTopFundSummary() {
    try {
      const stats = await API.getDashboardStats();
      const elem = document.getElementById('top-fund-balance');
      if (elem && stats.funds) {
        elem.textContent = this.formatMoney(stats.funds.total_balance);
      }
    } catch (e) {
      console.warn('Could not load fund balance', e);
    }
  },

  setupNavigation() {
    const menuLinks = document.querySelectorAll('[data-view]');
    menuLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.getAttribute('data-view');
        this.navigate(view);
      });
    });
  },

  setupModals() {
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('active');
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    });
  },

  navigate(viewName) {
    this.currentView = viewName;

    document.querySelectorAll('.menu-item').forEach(el => {
      if (el.getAttribute('data-view') === viewName) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    const titles = {
      'dashboard': 'Tổng quan kinh doanh',
      'pos': 'Bán hàng tại quầy (POS)',
      'products': 'Quản lý Hàng hóa & Tồn kho',
      'purchases': 'Quản lý Nhập hàng (Nhà cung cấp)',
      'customers': 'Quản lý Khách hàng & Bảng giá riêng',
      'suppliers': 'Quản lý Nhà cung cấp',
      'cash-flow': 'Quản lý Sổ quỹ & Dòng tiền',
      'reports': 'Báo cáo doanh thu & Lợi nhuận',
      'returns': 'Quản lý Khách trả hàng (Đổi trả)',
      'settings': 'Cài đặt hệ thống & Sao lưu'
    };

    const titleElem = document.getElementById('page-title-text');
    if (titleElem) {
      titleElem.textContent = titles[viewName] || 'Hệ thống KiotPro';
    }

    document.querySelectorAll('.view-section').forEach(sec => {
      sec.style.display = 'none';
    });

    const targetSec = document.getElementById(`view-${viewName}`);
    if (targetSec) {
      targetSec.style.display = 'block';
    }

    this.refreshCurrentView();
  },

  refreshCurrentView() {
    this.loadTopFundSummary();
    switch (this.currentView) {
      case 'dashboard':
        this.renderDashboardView();
        break;
      case 'pos':
        POS.init();
        break;
      case 'products':
        this.renderProductsView();
        break;
      case 'purchases':
        this.renderPurchasesView();
        break;
      case 'customers':
        this.renderCustomersView();
        break;
      case 'suppliers':
        this.renderSuppliersView();
        break;
      case 'cash-flow':
        this.renderCashFlowView();
        break;
      case 'reports':
        this.renderReportsView();
        break;
      case 'returns':
        this.renderReturnsView();
        break;
      case 'settings':
        this.renderSettingsView();
        break;
    }
  },

  // ==========================================
  // 1. DASHBOARD VIEW (With Period Filter)
  // ==========================================
  async renderDashboardView() {
    const container = document.getElementById('view-dashboard');
    if (!container) return;

    try {
      const data = await API.getDashboardStats(this.dashboardRange);
      const today = data.today || {};
      const inv = data.inventory || {};
      const debt = data.debt || {};
      const funds = data.funds || {};

      const rangeLabels = {
        'today': 'Hôm nay',
        'yesterday': 'Hôm qua',
        '7days': '7 ngày qua',
        'this_month': 'Tháng này'
      };

      container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <div style="font-size: 0.95rem; font-weight: 600; color: #475569;">
            Kỳ báo cáo: <span style="color: #0066cc;">${rangeLabels[this.dashboardRange] || 'Hôm nay'}</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm ${this.dashboardRange === 'today' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('today')">Hôm nay</button>
            <button class="btn btn-sm ${this.dashboardRange === 'yesterday' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('yesterday')">Hôm qua</button>
            <button class="btn btn-sm ${this.dashboardRange === '7days' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('7days')">7 ngày</button>
            <button class="btn btn-sm ${this.dashboardRange === 'this_month' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('this_month')">Tháng này</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon icon-blue">💰</div>
            <div class="stat-info">
              <p>Doanh thu (${rangeLabels[this.dashboardRange]})</p>
              <h3>${this.formatMoney(today.today_revenue || 0)}</h3>
              <small style="color: #64748b;">${today.today_orders || 0} đơn (Thuần: ${this.formatMoney(today.today_net_revenue || 0)})</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-green">📈</div>
            <div class="stat-info">
              <p>Lợi nhuận gộp</p>
              <h3 style="color: #10b981;">${this.formatMoney(today.today_profit || 0)}</h3>
              <small style="color: #64748b;">Doanh thu thuần trừ giá vốn</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-purple">📦</div>
            <div class="stat-info">
              <p>Giá trị kho hàng (MAC)</p>
              <h3>${this.formatMoney(inv.total_inventory_cost || 0)}</h3>
              <small style="color: #64748b;">${inv.total_products || 0} mặt hàng (${inv.total_stock_items || 0} tồn)</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-amber">👥</div>
            <div class="stat-info">
              <p>Khách nợ phải thu</p>
              <h3 style="color: #d97706;">${this.formatMoney(debt.receivables || 0)}</h3>
              <small style="color: #64748b;">Tổng công nợ khách</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-red">🏭</div>
            <div class="stat-info">
              <p>Nợ phải trả NCC</p>
              <h3 style="color: #dc2626;">${this.formatMoney(debt.payables || 0)}</h3>
              <small style="color: #64748b;">Công nợ nhà cung cấp</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-blue">🏦</div>
            <div class="stat-info">
              <p>Tổng tiền mặt & quỹ</p>
              <h3 style="color: #0066cc;">${this.formatMoney(funds.total_balance || 0)}</h3>
              <small style="color: #64748b;">TM: ${this.formatMoney(funds.cash_balance || 0)} | NH: ${this.formatMoney(funds.bank_balance || 0)}</small>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <!-- 7-Day Revenue Trend Chart -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">📊 Xu hướng Doanh thu & Lợi nhuận (7 ngày qua)</div>
            </div>
            <div class="card-body">
              <div style="height: 260px; display: flex; align-items: flex-end; gap: 18px; padding-top: 30px;">
                ${this.renderBarChart(data.revenue_trend || [])}
              </div>
            </div>
          </div>

          <!-- Top Selling Products -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">🔥 Top sản phẩm bán chạy</div>
            </div>
            <div class="card-body" style="padding: 0;">
              <table class="table">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th style="text-align: center;">Đã bán</th>
                    <th style="text-align: right;">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  ${(data.top_products || []).length > 0 ? (data.top_products || []).map(p => `
                    <tr>
                      <td>
                        <strong>${p.name}</strong><br>
                        <small style="color: #94a3b8;">${p.code}</small>
                      </td>
                      <td style="text-align: center;">
                        <span class="badge-tag badge-blue">${p.total_quantity} ${p.unit}</span>
                      </td>
                      <td style="text-align: right; font-weight: 600;">${this.formatMoney(p.total_sales)}</td>
                    </tr>
                  `).join('') : `
                    <tr><td colspan="3" style="text-align: center; color: #94a3b8; padding: 20px;">Chưa có dữ liệu bán hàng</td></tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Low Stock Warning List -->
        <div class="card">
          <div class="card-header" style="background-color: #fef2f2;">
            <div class="card-title" style="color: #991b1b;">
              ⚠️ Cảnh báo hàng sắp hết tồn kho (${(data.low_stock || []).length})
            </div>
            <button class="btn btn-sm btn-primary" onclick="App.openCreatePurchaseModal()">+ Nhập hàng ngay</button>
          </div>
          <div class="card-body" style="padding: 0;">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã SP</th>
                  <th>Tên sản phẩm</th>
                  <th>Danh mục</th>
                  <th style="text-align: center;">Tồn kho hiện tại</th>
                  <th style="text-align: center;">Tồn tối thiểu</th>
                  <th>Giá vốn (MAC)</th>
                  <th>Giá bán</th>
                  <th style="text-align: right;">Hành động</th>
                </tr>
              </thead>
              <tbody>
                ${(data.low_stock || []).length > 0 ? (data.low_stock || []).map(p => `
                  <tr>
                    <td><code>${p.code}</code></td>
                    <td><strong>${p.name}</strong></td>
                    <td>${p.category || 'Chung'}</td>
                    <td style="text-align: center;">
                      <span class="badge-tag badge-red" style="font-size: 0.85rem;">
                        ${p.stock} ${p.unit}
                      </span>
                    </td>
                    <td style="text-align: center;">${p.min_stock} ${p.unit}</td>
                    <td>${this.formatMoney(p.cost_price)}</td>
                    <td style="font-weight: 600; color: #0066cc;">${this.formatMoney(p.sale_price)}</td>
                    <td style="text-align: right;">
                      <button class="btn btn-sm btn-success" onclick="App.openCreatePurchaseForProduct(${p.id})">Nhập hàng</button>
                    </td>
                  </tr>
                `).join('') : `
                  <tr><td colspan="8" style="text-align: center; color: #10b981; padding: 20px;">Tất cả mặt hàng đều đảm bảo mức tồn an toàn!</td></tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card card-body" style="color: red;">Lỗi tải dữ liệu tổng quan: ${err.message}</div>`;
    }
  },

  setDashboardRange(range) {
    this.dashboardRange = range;
    this.renderDashboardView();
  },

  renderBarChart(trendData) {
    if (!trendData || trendData.length === 0) return '<div>Chưa có số liệu</div>';
    const maxVal = Math.max(...trendData.map(d => Math.max(d.revenue, d.profit, 1000000)));

    return trendData.map(d => {
      const revHeight = Math.max(8, (d.revenue / maxVal) * 190);
      const profitHeight = Math.max(4, (d.profit / maxVal) * 190);

      return `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
          <div style="display: flex; gap: 4px; align-items: flex-end;">
            <div style="width: 18px; height: ${revHeight}px; background: linear-gradient(180deg, #0284c7, #0066cc); border-radius: 4px 4px 0 0;" title="Doanh thu: ${this.formatMoney(d.revenue)}"></div>
            <div style="width: 18px; height: ${profitHeight}px; background: linear-gradient(180deg, #34d399, #10b981); border-radius: 4px 4px 0 0;" title="Lợi nhuận: ${this.formatMoney(d.profit)}"></div>
          </div>
          <div style="font-size: 0.72rem; color: #64748b; margin-top: 8px; font-weight: 600;">${d.display_date}</div>
        </div>
      `;
    }).join('');
  },

  // ==========================================
  // 2. PRODUCTS & INVENTORY VIEW
  // ==========================================
  async renderProductsView() {
    const container = document.getElementById('view-products');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 12px; align-items: center; flex: 1;">
            <input type="text" id="prod-search-input" class="form-control" style="max-width: 300px;" placeholder="Tìm theo tên, mã SKU, mã vạch...">
            <select id="prod-cat-filter" class="form-control" style="max-width: 180px;">
              <option value="">Tất cả danh mục</option>
            </select>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.88rem; cursor: pointer;">
              <input type="checkbox" id="prod-low-stock-filter"> Cảnh báo tồn kho
            </label>
          </div>
          <button class="btn btn-primary" onclick="App.openCreateProductModal()">+ Thêm hàng hóa</button>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã SP / Barcode</th>
                  <th>Tên hàng hóa</th>
                  <th>Danh mục</th>
                  <th>Đơn vị tính</th>
                  <th>Quy đổi</th>
                  <th>Giá vốn (MAC)</th>
                  <th>Giá bán</th>
                  <th style="text-align: center;">Tồn kho</th>
                  <th style="text-align: right;">Hành động</th>
                </tr>
              </thead>
              <tbody id="products-table-body">
                <tr><td colspan="9" style="text-align: center; padding: 20px;">Đang tải hàng hóa...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    try {
      const cats = await API.getCategories();
      const catSelect = document.getElementById('prod-cat-filter');
      cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        catSelect.appendChild(opt);
      });
    } catch (e) {
      console.warn("Could not load categories", e);
    }

    document.getElementById('prod-search-input').addEventListener('input', () => this.loadProductsTable());
    document.getElementById('prod-cat-filter').addEventListener('change', () => this.loadProductsTable());
    document.getElementById('prod-low-stock-filter').addEventListener('change', () => this.loadProductsTable());

    this.loadProductsTable();
  },

  async loadProductsTable() {
    const q = document.getElementById('prod-search-input')?.value || '';
    const cat = document.getElementById('prod-cat-filter')?.value || '';
    const lowStock = document.getElementById('prod-low-stock-filter')?.checked || false;

    try {
      const products = await API.getProducts({ q, category: cat, low_stock: lowStock });
      const tbody = document.getElementById('products-table-body');
      if (!tbody) return;

      if (products.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 30px;">Không tìm thấy hàng hóa</td></tr>`;
        return;
      }

      tbody.innerHTML = products.map(p => `
        <tr>
          <td>
            <strong>${p.code}</strong><br>
            <small style="color: #94a3b8; font-family: monospace;">${p.barcode || '---'}</small>
          </td>
          <td>
            <div style="font-weight: 600; color: #0f172a;">${p.name}</div>
          </td>
          <td><span class="badge-tag badge-blue">${p.category || 'Chung'}</span></td>
          <td><strong>${p.unit}</strong></td>
          <td>
            ${p.sub_unit ? `<small style="color: #475569;">1 ${p.unit} = ${p.sub_unit_ratio} ${p.sub_unit}</small>` : '<span style="color: #94a3b8;">---</span>'}
          </td>
          <td>${this.formatMoney(p.cost_price)}</td>
          <td style="font-weight: 700; color: #0066cc;">${this.formatMoney(p.sale_price)}</td>
          <td style="text-align: center;">
            <span class="badge-tag ${p.stock <= p.min_stock ? 'badge-red' : 'badge-green'}" style="font-size: 0.85rem;">
              ${p.stock}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn-sm btn-outline" onclick="App.openStockLogsModal(${p.id})" title="Thẻ kho">📋 Thẻ kho</button>
            <button class="btn btn-sm btn-outline" onclick="App.openAdjustStockModal(${p.id}, '${p.name.replace(/'/g, "\\'")}', ${p.stock})" title="Kiểm kho">⚖️ Kiểm kho</button>
            <button class="btn btn-sm btn-primary" onclick="App.openEditProductModal(${p.id})" title="Sửa">✏️</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Không thể tải sản phẩm: ' + err.message, 'error');
    }
  },

  openCreateProductModal() {
    const modal = document.getElementById('product-modal');
    document.getElementById('product-modal-title').textContent = 'Thêm hàng hóa mới';
    document.getElementById('prod-id').value = '';
    document.getElementById('prod-code').value = '';
    document.getElementById('prod-barcode').value = '';
    document.getElementById('prod-name').value = '';
    document.getElementById('prod-category').value = 'Chung';
    document.getElementById('prod-unit').value = 'Cái';
    document.getElementById('prod-sub-unit').value = '';
    document.getElementById('prod-sub-unit-ratio').value = '1';
    document.getElementById('prod-cost-price').value = '0';
    document.getElementById('prod-sale-price').value = '0';
    document.getElementById('prod-stock').value = '0';
    document.getElementById('prod-stock').disabled = false;
    document.getElementById('prod-min-stock').value = '5';
    modal.classList.add('active');
  },

  async openEditProductModal(id) {
    try {
      const products = await API.getProducts();
      const p = products.find(x => x.id === id);
      if (!p) return;

      const modal = document.getElementById('product-modal');
      document.getElementById('product-modal-title').textContent = 'Chỉnh sửa: ' + p.name;
      document.getElementById('prod-id').value = p.id;
      document.getElementById('prod-code').value = p.code;
      document.getElementById('prod-barcode').value = p.barcode || '';
      document.getElementById('prod-name').value = p.name;
      document.getElementById('prod-category').value = p.category || 'Chung';
      document.getElementById('prod-unit').value = p.unit || 'Cái';
      document.getElementById('prod-sub-unit').value = p.sub_unit || '';
      document.getElementById('prod-sub-unit-ratio').value = p.sub_unit_ratio || 1;
      document.getElementById('prod-cost-price').value = p.cost_price;
      document.getElementById('prod-sale-price').value = p.sale_price;
      document.getElementById('prod-stock').value = p.stock;
      document.getElementById('prod-stock').disabled = true;
      document.getElementById('prod-min-stock').value = p.min_stock;
      modal.classList.add('active');
    } catch (e) {
      App.toast('Lỗi mở form sản phẩm: ' + e.message, 'error');
    }
  },

  async saveProductForm() {
    const id = document.getElementById('prod-id').value;
    const name = document.getElementById('prod-name').value.trim();
    if (!name) {
      App.toast('Tên sản phẩm không được để trống', 'warning');
      return;
    }

    const payload = {
      code: document.getElementById('prod-code').value.trim(),
      barcode: document.getElementById('prod-barcode').value.trim(),
      name: name,
      category: document.getElementById('prod-category').value.trim(),
      unit: document.getElementById('prod-unit').value.trim(),
      sub_unit: document.getElementById('prod-sub-unit').value.trim(),
      sub_unit_ratio: parseFloat(document.getElementById('prod-sub-unit-ratio').value) || 1,
      cost_price: parseFloat(document.getElementById('prod-cost-price').value) || 0,
      sale_price: parseFloat(document.getElementById('prod-sale-price').value) || 0,
      stock: parseFloat(document.getElementById('prod-stock').value) || 0,
      min_stock: parseFloat(document.getElementById('prod-min-stock').value) || 5
    };

    try {
      if (id) {
        await API.updateProduct(id, payload);
        App.toast('Cập nhật hàng hóa thành công', 'success');
      } else {
        await API.createProduct(payload);
        App.toast('Thêm hàng hóa mới thành công', 'success');
      }
      document.getElementById('product-modal').classList.remove('active');
      this.loadProductsTable();
    } catch (err) {
      App.toast('Lỗi lưu sản phẩm: ' + err.message, 'error');
    }
  },

  async openStockLogsModal(productId) {
    const modal = document.getElementById('stock-logs-modal');
    const tbody = document.getElementById('stock-logs-tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Đang tải thẻ kho...</td></tr>';
    modal.classList.add('active');

    try {
      const logs = await API.getProductLogs(productId);
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">Chưa có biến động kho</td></tr>';
        return;
      }

      document.getElementById('stock-logs-title').textContent = `Thẻ kho: ${logs[0].product_name} (${logs[0].product_code})`;

      tbody.innerHTML = logs.map(l => {
        let typeBadge = '<span class="badge-tag badge-blue">Biến động</span>';
        if (l.type === 'input') typeBadge = '<span class="badge-tag badge-green">Nhập kho</span>';
        if (l.type === 'output') typeBadge = '<span class="badge-tag badge-purple">Xuất bán</span>';
        if (l.type === 'adjustment') typeBadge = '<span class="badge-tag badge-amber">Kiểm kho</span>';
        if (l.type === 'return') typeBadge = '<span class="badge-tag badge-red">Khách trả</span>';

        return `
          <tr>
            <td>${l.created_at}</td>
            <td><strong>${l.reference_code || '---'}</strong></td>
            <td>${typeBadge}</td>
            <td style="text-align: center; font-weight: 700; color: ${l.change_qty >= 0 ? '#10b981' : '#ef4444'};">
              ${l.change_qty >= 0 ? '+' : ''}${l.change_qty} ${l.unit || ''}
            </td>
            <td style="text-align: center;">${l.stock_before} → <strong>${l.stock_after}</strong></td>
            <td><small style="color: #64748b;">${l.notes || ''}</small></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="color: red; text-align: center;">Lỗi tải thẻ kho: ${err.message}</td></tr>`;
    }
  },

  openAdjustStockModal(productId, productName, currentStock) {
    const modal = document.getElementById('adjust-modal');
    document.getElementById('adjust-product-id').value = productId;
    document.getElementById('adjust-product-name').textContent = productName;
    document.getElementById('adjust-current-stock').textContent = currentStock;
    document.getElementById('adjust-actual-stock').value = currentStock;
    document.getElementById('adjust-notes').value = 'Kiểm kho định kỳ';
    modal.classList.add('active');
  },

  async saveAdjustStock() {
    const prodId = document.getElementById('adjust-product-id').value;
    const actualStock = parseFloat(document.getElementById('adjust-actual-stock').value);
    const notes = document.getElementById('adjust-notes').value;

    if (isNaN(actualStock) || actualStock < 0) {
      App.toast('Số lượng thực tế không hợp lệ', 'warning');
      return;
    }

    try {
      await API.adjustInventory({
        product_id: prodId,
        actual_stock: actualStock,
        notes: notes
      });
      App.toast('Cân bằng tồn kho thành công', 'success');
      document.getElementById('adjust-modal').classList.remove('active');
      this.loadProductsTable();
    } catch (err) {
      App.toast('Lỗi kiểm kho: ' + err.message, 'error');
    }
  },

  // ==========================================
  // 3. PURCHASES / GOODS RECEIPT VIEW (Input)
  // ==========================================
  async renderPurchasesView() {
    const container = document.getElementById('view-purchases');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">📥 Danh sách phiếu nhập hàng từ Nhà cung cấp</div>
          <button class="btn btn-primary" onclick="App.openCreatePurchaseModal()">+ Tạo phiếu nhập hàng</button>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Thời gian</th>
                  <th>Nhà cung cấp</th>
                  <th style="text-align: center;">Số mặt hàng</th>
                  <th style="text-align: right;">Tổng tiền hàng</th>
                  <th style="text-align: right;">Đã trả NCC</th>
                  <th style="text-align: right;">Còn nợ</th>
                  <th style="text-align: center;">Trạng thái</th>
                  <th style="text-align: right;">Chi tiết</th>
                </tr>
              </thead>
              <tbody id="purchases-table-body">
                <tr><td colspan="9" style="text-align: center; padding: 20px;">Đang tải danh sách nhập hàng...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    try {
      const purchases = await API.getPurchases();
      const tbody = document.getElementById('purchases-table-body');
      if (!tbody) return;

      if (purchases.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 30px;">Chưa có phiếu nhập hàng nào</td></tr>`;
        return;
      }

      tbody.innerHTML = purchases.map(p => `
        <tr>
          <td><strong>${p.code}</strong></td>
          <td>${p.created_at}</td>
          <td>${p.supplier_name || 'Nhà cung cấp'}</td>
          <td style="text-align: center;"><span class="badge-tag badge-blue">${p.item_count} mặt hàng</span></td>
          <td style="text-align: right; font-weight: 700;">${this.formatMoney(p.final_amount)}</td>
          <td style="text-align: right; color: #10b981;">${this.formatMoney(p.paid_amount)}</td>
          <td style="text-align: right; color: ${p.debt_amount > 0 ? '#ef4444' : '#64748b'}; font-weight: ${p.debt_amount > 0 ? '700' : 'normal'};">
            ${this.formatMoney(p.debt_amount)}
          </td>
          <td style="text-align: center;"><span class="badge-tag badge-green">Hoàn thành</span></td>
          <td style="text-align: right;">
            <button class="btn btn-sm btn-outline" onclick="App.viewPurchaseDetail(${p.id})">Xem</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải phiếu nhập: ' + err.message, 'error');
    }
  },

  async openCreatePurchaseModal() {
    const modal = document.getElementById('purchase-create-modal');
    modal.classList.add('active');

    const suppSelect = document.getElementById('purch-supplier-select');
    suppSelect.innerHTML = '<option value="">Chọn nhà cung cấp...</option>';
    try {
      const suppliers = await API.getSuppliers();
      suppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.name} (Nợ hiện tại: ${this.formatMoney(s.debt)})`;
        suppSelect.appendChild(opt);
      });
    } catch (e) {
      App.toast('Không thể tải nhà cung cấp: ' + e.message, 'error');
    }

    this.purchaseDraftItems = [];
    this.renderPurchaseDraftItems();
  },

  openCreatePurchaseForProduct(productId) {
    this.openCreatePurchaseModal();
    setTimeout(() => {
      this.addDraftItemToPurchase(productId);
    }, 200);
  },

  async addDraftItemToPurchase(productId) {
    if (!productId) return;
    try {
      const prods = await API.getProducts();
      const p = prods.find(x => x.id == productId);
      if (!p) return;

      const existing = this.purchaseDraftItems.find(i => i.product_id == p.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        this.purchaseDraftItems.push({
          product_id: p.id,
          code: p.code,
          name: p.name,
          unit: p.unit,
          quantity: 10,
          import_price: p.cost_price || 0
        });
      }
      this.renderPurchaseDraftItems();
    } catch (e) {
      App.toast('Lỗi thêm sản phẩm vào phiếu nhập: ' + e.message, 'error');
    }
  },

  renderPurchaseDraftItems() {
    const container = document.getElementById('purch-items-tbody');
    if (!container) return;

    if (this.purchaseDraftItems.length === 0) {
      container.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">Chưa chọn sản phẩm nhập kho. Nhấn "Thêm sản phẩm" bên dưới.</td></tr>';
      this.updatePurchaseDraftTotals();
      return;
    }

    container.innerHTML = this.purchaseDraftItems.map((item, idx) => `
      <tr>
        <td><strong>${item.name}</strong><br><small style="color: #94a3b8;">${item.code}</small></td>
        <td>${item.unit}</td>
        <td>
          <input type="number" class="form-control" style="width: 80px;" value="${item.quantity}" min="1" onchange="App.updatePurchaseItemQty(${idx}, this.value)">
        </td>
        <td>
          <input type="number" class="form-control" style="width: 130px;" value="${item.import_price}" min="0" onchange="App.updatePurchaseItemPrice(${idx}, this.value)">
        </td>
        <td style="font-weight: 700; color: #0066cc;">
          ${this.formatMoney(item.quantity * item.import_price)}
        </td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="App.removePurchaseItem(${idx})" style="color: red;">✕</button>
        </td>
      </tr>
    `).join('');

    this.updatePurchaseDraftTotals();
  },

  updatePurchaseItemQty(idx, val) {
    if (this.purchaseDraftItems[idx]) {
      this.purchaseDraftItems[idx].quantity = Math.max(1, parseFloat(val) || 1);
      this.renderPurchaseDraftItems();
    }
  },

  updatePurchaseItemPrice(idx, val) {
    if (this.purchaseDraftItems[idx]) {
      this.purchaseDraftItems[idx].import_price = Math.max(0, parseFloat(val) || 0);
      this.renderPurchaseDraftItems();
    }
  },

  removePurchaseItem(idx) {
    this.purchaseDraftItems.splice(idx, 1);
    this.renderPurchaseDraftItems();
  },

  updatePurchaseDraftTotals() {
    const total = this.purchaseDraftItems.reduce((sum, i) => sum + (i.quantity * i.import_price), 0);
    const totalElem = document.getElementById('purch-total-amount');
    const paidInput = document.getElementById('purch-paid-amount');
    if (totalElem) totalElem.textContent = this.formatMoney(total);
    if (paidInput && (!paidInput.dataset.manual || paidInput.dataset.manual === 'false')) {
      paidInput.value = total;
    }
  },

  async promptAddProductToPurchase() {
    try {
      const prods = await API.getProducts();
      const listStr = prods.map((p, i) => `${i + 1}. ${p.name} (${p.code}) - Tồn: ${p.stock}`).join('\n');
      const choice = prompt(`Nhập số thứ tự sản phẩm muốn thêm vào đơn nhập:\n\n${listStr}`);
      if (!choice) return;
      const idx = parseInt(choice) - 1;
      if (prods[idx]) {
        this.addDraftItemToPurchase(prods[idx].id);
      } else {
        App.toast('Lựa chọn không hợp lệ', 'warning');
      }
    } catch (e) {
      App.toast('Lỗi danh sách sản phẩm', 'error');
    }
  },

  async submitPurchaseOrder() {
    if (this.purchaseDraftItems.length === 0) {
      App.toast('Vui lòng thêm ít nhất 1 sản phẩm vào phiếu nhập', 'warning');
      return;
    }

    const suppSelect = document.getElementById('purch-supplier-select');
    const suppId = suppSelect.value ? parseInt(suppSelect.value) : null;
    const suppName = suppId ? suppSelect.options[suppSelect.selectedIndex].text.split('(')[0].trim() : 'Nhà cung cấp';
    const paidAmount = parseFloat(document.getElementById('purch-paid-amount').value) || 0;
    const paymentMethod = document.getElementById('purch-payment-method').value;
    const notes = document.getElementById('purch-notes').value;

    const payload = {
      supplier_id: suppId,
      supplier_name: suppName,
      items: this.purchaseDraftItems.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        import_price: i.import_price
      })),
      discount: 0,
      paid_amount: paidAmount,
      payment_method: paymentMethod,
      notes: notes
    };

    try {
      const res = await API.createPurchase(payload);
      App.toast(`Tạo phiếu nhập ${res.code} thành công! Giá vốn đã tính theo MAC.`, 'success');
      document.getElementById('purchase-create-modal').classList.remove('active');
      this.renderPurchasesView();
      this.loadTopFundSummary();
    } catch (err) {
      App.toast('Lỗi tạo phiếu nhập: ' + err.message, 'error');
    }
  },

  async viewPurchaseDetail(purchaseId) {
    try {
      const p = await API.getPurchase(purchaseId);
      alert(`CHI TIẾT PHIẾU NHẬP ${p.code}\n\nNhà cung cấp: ${p.supplier_name}\nNgày: ${p.created_at}\nTổng tiền: ${this.formatMoney(p.final_amount)}\nĐã trả: ${this.formatMoney(p.paid_amount)}\nCòn nợ: ${this.formatMoney(p.debt_amount)}\n\nSản phẩm:\n` + 
        p.items.map(i => `- ${i.product_name}: ${i.quantity} ${i.unit} x ${this.formatMoney(i.import_price)} = ${this.formatMoney(i.subtotal)}`).join('\n')
      );
    } catch (e) {
      App.toast('Không thể tải chi tiết phiếu nhập: ' + e.message, 'error');
    }
  },

  // ==========================================
  // 4. CUSTOMERS & CUSTOM PRICING VIEW
  // ==========================================
  async renderCustomersView() {
    const container = document.getElementById('view-customers');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 12px; align-items: center; flex: 1;">
            <input type="text" id="cust-search-input" class="form-control" style="max-width: 320px;" placeholder="Tìm theo tên, SĐT, mã khách...">
          </div>
          <button class="btn btn-primary" onclick="App.openCreateCustomerModal()">+ Thêm khách hàng</button>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã KH</th>
                  <th>Tên khách hàng</th>
                  <th>Số điện thoại</th>
                  <th>Nhóm khách</th>
                  <th style="text-align: right;">Tổng mua</th>
                  <th style="text-align: right;">Công nợ hiện tại</th>
                  <th style="text-align: center;">Bảng giá riêng</th>
                  <th style="text-align: right;">Hành động</th>
                </tr>
              </thead>
              <tbody id="customers-table-body">
                <tr><td colspan="8" style="text-align: center; padding: 20px;">Đang tải danh sách khách hàng...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('cust-search-input').addEventListener('input', () => this.loadCustomersTable());
    this.loadCustomersTable();
  },

  async loadCustomersTable() {
    const q = document.getElementById('cust-search-input')?.value || '';
    try {
      const customers = await API.getCustomers({ q });
      const tbody = document.getElementById('customers-table-body');
      if (!tbody) return;

      if (customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 30px;">Không tìm thấy khách hàng</td></tr>`;
        return;
      }

      tbody.innerHTML = customers.map(c => `
        <tr>
          <td><strong>${c.code}</strong></td>
          <td>
            <div style="font-weight: 600; color: #0f172a;">${c.name}</div>
            <small style="color: #64748b;">${c.address || ''}</small>
          </td>
          <td>${c.phone || '---'}</td>
          <td><span class="badge-tag badge-purple">${c.group_name || 'Khách lẻ'}</span></td>
          <td style="text-align: right; font-weight: 600;">${this.formatMoney(c.total_spent)}</td>
          <td style="text-align: right; color: ${c.debt > 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">
            ${this.formatMoney(c.debt)}
          </td>
          <td style="text-align: center;">
            <button class="btn btn-sm btn-outline" style="background-color: #fef9c3; border-color: #facc15; color: #854d0e; font-weight: 700;" onclick="App.openCustomerPricingModal(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
              ⭐ Bảng giá riêng
            </button>
          </td>
          <td style="text-align: right;">
            ${c.debt > 0 ? `<button class="btn btn-sm btn-success" onclick="App.openPayCustomerDebtModal(${c.id}, '${c.name.replace(/'/g, "\\'")}', ${c.debt})">Thu nợ</button>` : ''}
            <button class="btn btn-sm btn-outline" onclick="App.openEditCustomerModal(${c.id})">✏️</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải khách hàng: ' + err.message, 'error');
    }
  },

  openCreateCustomerModal() {
    const modal = document.getElementById('customer-modal');
    document.getElementById('customer-modal-title').textContent = 'Thêm khách hàng mới';
    document.getElementById('cust-id').value = '';
    document.getElementById('cust-code').value = '';
    document.getElementById('cust-name').value = '';
    document.getElementById('cust-phone').value = '';
    document.getElementById('cust-email').value = '';
    document.getElementById('cust-address').value = '';
    document.getElementById('cust-group').value = 'Đại lý';
    document.getElementById('cust-debt').value = '0';
    document.getElementById('cust-notes').value = '';
    modal.classList.add('active');
  },

  async openEditCustomerModal(id) {
    try {
      const customers = await API.getCustomers();
      const c = customers.find(x => x.id === id);
      if (!c) return;

      const modal = document.getElementById('customer-modal');
      document.getElementById('customer-modal-title').textContent = 'Chỉnh sửa: ' + c.name;
      document.getElementById('cust-id').value = c.id;
      document.getElementById('cust-code').value = c.code;
      document.getElementById('cust-name').value = c.name;
      document.getElementById('cust-phone').value = c.phone || '';
      document.getElementById('cust-email').value = c.email || '';
      document.getElementById('cust-address').value = c.address || '';
      document.getElementById('cust-group').value = c.group_name || 'Khách lẻ';
      document.getElementById('cust-debt').value = c.debt || 0;
      document.getElementById('cust-notes').value = c.notes || '';
      modal.classList.add('active');
    } catch (e) {
      App.toast('Lỗi mở form khách hàng: ' + e.message, 'error');
    }
  },

  async saveCustomerForm() {
    const id = document.getElementById('cust-id').value;
    const name = document.getElementById('cust-name').value.trim();
    if (!name) {
      App.toast('Tên khách hàng không được để trống', 'warning');
      return;
    }

    const payload = {
      code: document.getElementById('cust-code').value.trim(),
      name: name,
      phone: document.getElementById('cust-phone').value.trim(),
      email: document.getElementById('cust-email').value.trim(),
      address: document.getElementById('cust-address').value.trim(),
      group_name: document.getElementById('cust-group').value.trim(),
      debt: parseFloat(document.getElementById('cust-debt').value) || 0,
      notes: document.getElementById('cust-notes').value.trim()
    };

    try {
      if (id) {
        await API.updateCustomer(id, payload);
        App.toast('Cập nhật khách hàng thành công', 'success');
      } else {
        await API.createCustomer(payload);
        App.toast('Thêm khách hàng mới thành công', 'success');
      }
      document.getElementById('customer-modal').classList.remove('active');
      this.loadCustomersTable();
    } catch (err) {
      App.toast('Lỗi lưu khách hàng: ' + err.message, 'error');
    }
  },

  openPayCustomerDebtModal(customerId, customerName, currentDebt) {
    const modal = document.getElementById('cust-debt-modal');
    document.getElementById('debt-cust-id').value = customerId;
    document.getElementById('debt-cust-name').textContent = customerName;
    document.getElementById('debt-cust-current').textContent = this.formatMoney(currentDebt);
    document.getElementById('debt-pay-amount').value = currentDebt;
    modal.classList.add('active');
  },

  async submitCustomerDebtPayment() {
    const custId = document.getElementById('debt-cust-id').value;
    const amount = parseFloat(document.getElementById('debt-pay-amount').value);
    const fundType = document.getElementById('debt-fund-type').value;

    if (isNaN(amount) || amount <= 0) {
      App.toast('Số tiền thu nợ phải lớn hơn 0', 'warning');
      return;
    }

    try {
      const res = await API.payCustomerDebt(custId, {
        amount: amount,
        fund_type: fundType,
        notes: `Thu nợ khách hàng (Phiếu thu ${res?.receipt_code || ''})`
      });
      App.toast(`Đã thu ${this.formatMoney(amount)}. Nợ còn lại: ${this.formatMoney(res.new_debt)}`, 'success');
      document.getElementById('cust-debt-modal').classList.remove('active');
      this.loadCustomersTable();
      this.loadTopFundSummary();
    } catch (err) {
      App.toast('Lỗi thu nợ: ' + err.message, 'error');
    }
  },

  // Customer Specific Pricing Modal
  async openCustomerPricingModal(customerId, customerName) {
    this.selectedCustomerForPricing = { id: customerId, name: customerName };
    const modal = document.getElementById('customer-pricing-modal');
    document.getElementById('cust-pricing-name').textContent = customerName;
    modal.classList.add('active');

    const prodSelect = document.getElementById('cust-pricing-prod-select');
    prodSelect.innerHTML = '<option value="">-- Chọn sản phẩm để thiết lập giá riêng --</option>';
    try {
      const products = await API.getProducts();
      products.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (Niêm yết: ${this.formatMoney(p.sale_price)})`;
        opt.dataset.defaultPrice = p.sale_price;
        prodSelect.appendChild(opt);
      });
    } catch (e) {
      App.toast('Lỗi danh mục sản phẩm: ' + e.message, 'error');
    }

    document.getElementById('cust-pricing-prod-select').onchange = (e) => {
      const opt = e.target.options[e.target.selectedIndex];
      if (opt && opt.dataset.defaultPrice) {
        document.getElementById('cust-pricing-new-price').value = opt.dataset.defaultPrice;
      }
    };

    this.loadCustomerPricesList();
  },

  async loadCustomerPricesList() {
    if (!this.selectedCustomerForPricing) return;
    const tbody = document.getElementById('cust-pricing-tbody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Đang tải bảng giá...</td></tr>';

    try {
      const prices = await API.getCustomerPrices(this.selectedCustomerForPricing.id);
      if (prices.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; color: #94a3b8; padding: 30px;">
              Khách hàng này chưa có bảng giá riêng. Đang áp dụng giá niêm yết chuẩn.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = prices.map(p => {
        const diff = p.custom_price - p.default_sale_price;
        const diffText = diff < 0 
          ? `<span style="color: #10b981; font-weight: 600;">Giảm ${this.formatMoney(Math.abs(diff))}</span>`
          : (diff > 0 ? `<span style="color: #d97706; font-weight: 600;">Tăng ${this.formatMoney(diff)}</span>` : 'Bằng giá chuẩn');

        return `
          <tr>
            <td><code>${p.product_code}</code></td>
            <td><strong>${p.product_name}</strong></td>
            <td>${p.unit}</td>
            <td style="color: #94a3b8; text-decoration: line-through;">${this.formatMoney(p.default_sale_price)}</td>
            <td style="font-weight: 800; color: #0066cc; font-size: 1rem;">
              ${this.formatMoney(p.custom_price)}
            </td>
            <td>${diffText}<br><small style="color: #64748b;">${p.notes || ''}</small></td>
            <td style="text-align: right;">
              <button class="btn btn-sm btn-outline" style="color: red;" onclick="App.deleteCustomerPriceRule(${p.id})">Xóa giá riêng</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="color: red; text-align: center;">Lỗi tải giá riêng: ${err.message}</td></tr>`;
    }
  },

  async saveCustomerPriceRule() {
    if (!this.selectedCustomerForPricing) return;
    const prodSelect = document.getElementById('cust-pricing-prod-select');
    const prodId = prodSelect.value;
    const newPrice = parseFloat(document.getElementById('cust-pricing-new-price').value);
    const notes = document.getElementById('cust-pricing-notes').value.trim();

    if (!prodId) {
      App.toast('Vui lòng chọn sản phẩm', 'warning');
      return;
    }
    if (isNaN(newPrice) || newPrice < 0) {
      App.toast('Đơn giá riêng không hợp lệ', 'warning');
      return;
    }

    try {
      await API.saveCustomerPrice(this.selectedCustomerForPricing.id, {
        product_id: prodId,
        custom_price: newPrice,
        notes: notes || 'Giá riêng theo thỏa thuận'
      });
      App.toast('Đã lưu giá riêng thành công!', 'success');
      document.getElementById('cust-pricing-new-price').value = '';
      document.getElementById('cust-pricing-notes').value = '';
      this.loadCustomerPricesList();
    } catch (err) {
      App.toast('Lỗi lưu giá riêng: ' + err.message, 'error');
    }
  },

  async deleteCustomerPriceRule(priceRuleId) {
    if (!confirm('Bạn có chắc chắn muốn hủy giá riêng này?')) return;
    try {
      await API.deleteCustomerPrice(priceRuleId);
      App.toast('Đã xóa giá riêng thành công', 'success');
      this.loadCustomerPricesList();
    } catch (err) {
      App.toast('Lỗi xóa giá riêng: ' + err.message, 'error');
    }
  },

  // ==========================================
  // 5. SUPPLIERS VIEW
  // ==========================================
  async renderSuppliersView() {
    const container = document.getElementById('view-suppliers');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🏭 Danh sách Nhà cung cấp</div>
          <button class="btn btn-primary" onclick="App.openCreateSupplierModal()">+ Thêm Nhà cung cấp</button>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã NCC</th>
                  <th>Tên Nhà cung cấp</th>
                  <th>Số điện thoại</th>
                  <th>Địa chỉ</th>
                  <th style="text-align: right;">Công nợ phải trả NCC</th>
                  <th>Ghi chú</th>
                  <th style="text-align: right;">Hành động</th>
                </tr>
              </thead>
              <tbody id="suppliers-table-body">
                <tr><td colspan="7" style="text-align: center; padding: 20px;">Đang tải danh sách...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    try {
      const suppliers = await API.getSuppliers();
      const tbody = document.getElementById('suppliers-table-body');
      if (!tbody) return;

      if (suppliers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 30px;">Chưa có nhà cung cấp</td></tr>`;
        return;
      }

      tbody.innerHTML = suppliers.map(s => `
        <tr>
          <td><strong>${s.code}</strong></td>
          <td><strong>${s.name}</strong></td>
          <td>${s.phone || '---'}</td>
          <td>${s.address || '---'}</td>
          <td style="text-align: right; color: ${s.debt > 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">
            ${this.formatMoney(s.debt)}
          </td>
          <td><small style="color: #64748b;">${s.notes || ''}</small></td>
          <td style="text-align: right;">
            ${s.debt > 0 ? `<button class="btn btn-sm btn-success" onclick="App.openPaySupplierDebtModal(${s.id}, '${s.name.replace(/'/g, "\\'")}', ${s.debt})">Trả nợ NCC</button>` : ''}
            <button class="btn btn-sm btn-primary" onclick="App.openCreatePurchaseModal()">Nhập hàng</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải nhà cung cấp: ' + err.message, 'error');
    }
  },

  openCreateSupplierModal() {
    const modal = document.getElementById('supplier-modal');
    document.getElementById('supp-id').value = '';
    document.getElementById('supp-code').value = '';
    document.getElementById('supp-name').value = '';
    document.getElementById('supp-phone').value = '';
    document.getElementById('supp-address').value = '';
    document.getElementById('supp-debt').value = '0';
    document.getElementById('supp-notes').value = '';
    modal.classList.add('active');
  },

  async saveSupplierForm() {
    const name = document.getElementById('supp-name').value.trim();
    if (!name) {
      App.toast('Tên nhà cung cấp không được để trống', 'warning');
      return;
    }

    const payload = {
      code: document.getElementById('supp-code').value.trim(),
      name: name,
      phone: document.getElementById('supp-phone').value.trim(),
      address: document.getElementById('supp-address').value.trim(),
      debt: parseFloat(document.getElementById('supp-debt').value) || 0,
      notes: document.getElementById('supp-notes').value.trim()
    };

    try {
      await API.createSupplier(payload);
      App.toast('Thêm nhà cung cấp thành công', 'success');
      document.getElementById('supplier-modal').classList.remove('active');
      this.renderSuppliersView();
    } catch (err) {
      App.toast('Lỗi lưu nhà cung cấp: ' + err.message, 'error');
    }
  },

  openPaySupplierDebtModal(suppId, suppName, debt) {
    const modal = document.getElementById('supp-debt-modal');
    document.getElementById('debt-supp-id').value = suppId;
    document.getElementById('debt-supp-name').textContent = suppName;
    document.getElementById('debt-supp-current').textContent = this.formatMoney(debt);
    document.getElementById('debt-supp-amount').value = debt;
    modal.classList.add('active');
  },

  async submitSupplierDebtPayment() {
    const suppId = document.getElementById('debt-supp-id').value;
    const amount = parseFloat(document.getElementById('debt-supp-amount').value);
    const fundType = document.getElementById('debt-supp-fund-type').value;

    if (isNaN(amount) || amount <= 0) {
      App.toast('Số tiền trả nợ phải lớn hơn 0', 'warning');
      return;
    }

    try {
      const res = await API.paySupplierDebt(suppId, {
        amount: amount,
        fund_type: fundType
      });
      App.toast(`Đã trả nợ ${this.formatMoney(amount)}. Nợ còn lại: ${this.formatMoney(res.new_debt)}`, 'success');
      document.getElementById('supp-debt-modal').classList.remove('active');
      this.renderSuppliersView();
      this.loadTopFundSummary();
    } catch (err) {
      App.toast('Lỗi trả nợ NCC: ' + err.message, 'error');
    }
  },

  // ==========================================
  // 6. CASH FLOW VIEW (Sổ quỹ & Dòng tiền)
  // ==========================================
  async renderCashFlowView() {
    const container = document.getElementById('view-cash-flow');
    if (!container) return;

    container.innerHTML = `
      <div id="cash-flow-summary-cards" class="stats-grid" style="grid-template-columns: repeat(4, 1fr);">
      </div>

      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 12px; align-items: center; flex: 1;">
            <select id="cf-type-filter" class="form-control" style="max-width: 160px;">
              <option value="all">Tất cả thu / chi</option>
              <option value="receipt">Phiếu thu (+)</option>
              <option value="payment">Phiếu chi (-)</option>
            </select>
            <select id="cf-fund-filter" class="form-control" style="max-width: 180px;">
              <option value="all">Tất cả tài khoản quỹ</option>
              <option value="cash">Tiền mặt tại quầy</option>
              <option value="bank">Tài khoản ngân hàng</option>
            </select>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-success" onclick="App.openCreateCashFlowModal('receipt')">+ Lập Phiếu Thu</button>
            <button class="btn btn-danger" onclick="App.openCreateCashFlowModal('payment')">- Lập Phiếu Chi</button>
          </div>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Thời gian</th>
                  <th>Loại phiếu</th>
                  <th>Hạng mục thu/chi</th>
                  <th>Đối tượng</th>
                  <th>Hình thức</th>
                  <th style="text-align: right;">Số tiền</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody id="cash-flow-tbody">
                <tr><td colspan="8" style="text-align: center; padding: 20px;">Đang tải sổ quỹ...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('cf-type-filter').addEventListener('change', () => this.loadCashFlowData());
    document.getElementById('cf-fund-filter').addEventListener('change', () => this.loadCashFlowData());
    this.loadCashFlowData();
  },

  async loadCashFlowData() {
    const type = document.getElementById('cf-type-filter')?.value || 'all';
    const fund = document.getElementById('cf-fund-filter')?.value || 'all';

    try {
      const res = await API.getCashFlow({ type, fund });
      const summary = res.summary || {};

      const summaryCards = document.getElementById('cash-flow-summary-cards');
      if (summaryCards) {
        summaryCards.innerHTML = `
          <div class="stat-card">
            <div class="stat-icon icon-blue">💰</div>
            <div class="stat-info">
              <p>Tồn quỹ hiện tại</p>
              <h3 style="color: #0066cc;">${this.formatMoney(summary.current_balance)}</h3>
              <small>Tổng thực thu trừ tổng chi</small>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon icon-green">📥</div>
            <div class="stat-info">
              <p>Tổng thực thu</p>
              <h3 style="color: #10b981;">${this.formatMoney(summary.total_receipts)}</h3>
              <small>Bán hàng & thu nợ</small>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon icon-red">📤</div>
            <div class="stat-info">
              <p>Tổng thực chi</p>
              <h3 style="color: #ef4444;">${this.formatMoney(summary.total_payments)}</h3>
              <small>Nhập hàng & chi phí</small>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon icon-purple">🏦</div>
            <div class="stat-info">
              <p>Chi tiết quỹ</p>
              <div style="font-size: 0.85rem; font-weight: 700; margin-top: 4px;">
                Tiền mặt: ${this.formatMoney(summary.cash_balance)}<br>
                Ngân hàng: ${this.formatMoney(summary.bank_balance)}
              </div>
            </div>
          </div>
        `;
      }

      const tbody = document.getElementById('cash-flow-tbody');
      if (!tbody) return;

      if (!res.items || res.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 30px;">Không có giao dịch sổ quỹ nào</td></tr>`;
        return;
      }

      tbody.innerHTML = res.items.map(item => `
        <tr>
          <td><strong>${item.code}</strong></td>
          <td>${item.created_at}</td>
          <td>
            ${item.type === 'receipt' 
              ? '<span class="badge-tag badge-green">Phiếu Thu (+)</span>' 
              : '<span class="badge-tag badge-red">Phiếu Chi (-)</span>'}
          </td>
          <td><strong>${item.category}</strong></td>
          <td>${item.target_name || 'Khác'}</td>
          <td>
            <span class="badge-tag ${item.fund_type === 'cash' ? 'badge-blue' : 'badge-purple'}">
              ${item.fund_type === 'cash' ? '💵 Tiền mặt' : '🏦 Ngân hàng'}
            </span>
          </td>
          <td style="text-align: right; font-weight: 700; color: ${item.type === 'receipt' ? '#10b981' : '#ef4444'};">
            ${item.type === 'receipt' ? '+' : '-'}${this.formatMoney(item.amount)}
          </td>
          <td><small style="color: #64748b;">${item.notes || ''}</small></td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải sổ quỹ: ' + err.message, 'error');
    }
  },

  openCreateCashFlowModal(type) {
    const modal = document.getElementById('cash-flow-modal');
    document.getElementById('cf-modal-type').value = type;
    document.getElementById('cf-modal-title').textContent = type === 'receipt' ? 'Lập Phiếu Thu tiền (+)' : 'Lập Phiếu Chi tiền (-)';
    document.getElementById('cf-category').value = type === 'receipt' ? 'Thu khác' : 'Chi chi phí vận hành';
    document.getElementById('cf-amount').value = '';
    document.getElementById('cf-target-name').value = '';
    document.getElementById('cf-notes').value = '';
    modal.classList.add('active');
  },

  async saveCashFlowVoucher() {
    const type = document.getElementById('cf-modal-type').value;
    const category = document.getElementById('cf-category').value.trim();
    const amount = parseFloat(document.getElementById('cf-amount').value);
    const targetName = document.getElementById('cf-target-name').value.trim();
    const fundType = document.getElementById('cf-fund-type').value;
    const notes = document.getElementById('cf-notes').value.trim();

    if (isNaN(amount) || amount <= 0) {
      App.toast('Số tiền phải lớn hơn 0', 'warning');
      return;
    }

    try {
      await API.createCashFlow({
        type: type,
        category: category,
        amount: amount,
        target_name: targetName || 'Khác',
        fund_type: fundType,
        notes: notes
      });
      App.toast(`Tạo ${type === 'receipt' ? 'phiếu thu' : 'phiếu chi'} thành công`, 'success');
      document.getElementById('cash-flow-modal').classList.remove('active');
      this.loadCashFlowData();
      this.loadTopFundSummary();
    } catch (err) {
      App.toast('Lỗi lưu sổ quỹ: ' + err.message, 'error');
    }
  },

  // ==========================================
  // 7. REPORTS VIEW (Orders History & Revenue)
  // ==========================================
  async renderReportsView() {
    const container = document.getElementById('view-reports');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🧾 Lịch sử Hóa đơn Bán ra (Doanh thu & Lợi nhuận)</div>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Thời gian</th>
                  <th>Khách hàng</th>
                  <th style="text-align: right;">Tiền hàng</th>
                  <th style="text-align: right;">Giảm giá</th>
                  <th style="text-align: right;">Thuế VAT</th>
                  <th style="text-align: right;">Khách cần trả</th>
                  <th style="text-align: right;">Khách trả</th>
                  <th style="text-align: right;">Ghi nợ</th>
                  <th style="text-align: right;">Lợi nhuận gộp</th>
                  <th style="text-align: right;">Hành động</th>
                </tr>
              </thead>
              <tbody id="orders-report-tbody">
                <tr><td colspan="11" style="text-align: center; padding: 20px;">Đang tải đơn hàng...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    try {
      const orders = await API.getOrders();
      const tbody = document.getElementById('orders-report-tbody');
      if (!tbody) return;

      if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #94a3b8; padding: 30px;">Chưa có đơn hàng nào</td></tr>`;
        return;
      }

      tbody.innerHTML = orders.map(o => `
        <tr>
          <td><strong>${o.code}</strong></td>
          <td>${o.created_at}</td>
          <td><strong>${o.customer_name || 'Khách lẻ'}</strong></td>
          <td style="text-align: right;">${this.formatMoney(o.total_amount)}</td>
          <td style="text-align: right; color: #b91c1c;">${o.discount > 0 ? '-' + this.formatMoney(o.discount) : '0 đ'}</td>
          <td style="text-align: right; color: #64748b;">${o.vat_amount > 0 ? this.formatMoney(o.vat_amount) : '0 đ'}</td>
          <td style="text-align: right; font-weight: 700; color: #0066cc;">${this.formatMoney(o.final_amount)}</td>
          <td style="text-align: right; color: #10b981;">${this.formatMoney(o.paid_amount)}</td>
          <td style="text-align: right; color: ${o.debt_amount > 0 ? '#ef4444' : '#64748b'}; font-weight: ${o.debt_amount > 0 ? '700' : 'normal'};">
            ${this.formatMoney(o.debt_amount)}
          </td>
          <td style="text-align: right; font-weight: 700; color: #10b981;">
            +${this.formatMoney(o.profit)}
          </td>
          <td style="text-align: right;">
            <button class="btn btn-sm btn-outline" onclick="App.viewOrderDetail(${o.id})">Xem</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải báo cáo: ' + err.message, 'error');
    }
  },

  async viewOrderDetail(orderId) {
    try {
      const o = await API.getOrder(orderId);
      alert(`ĐƠN HÀNG ${o.code}\n\nKhách: ${o.customer_name}\nThời gian: ${o.created_at}\nTổng tiền hàng: ${this.formatMoney(o.total_amount)}\nGiảm giá: ${this.formatMoney(o.discount)}\nThuế VAT: ${this.formatMoney(o.vat_amount)}\nKhách cần trả: ${this.formatMoney(o.final_amount)}\nTiền khách đưa: ${this.formatMoney(o.customer_paid)}\nĐã thanh toán: ${this.formatMoney(o.paid_amount)}\nTiền thừa thối lại: ${this.formatMoney(o.change_amount)}\nCòn ghi nợ: ${this.formatMoney(o.debt_amount)}\nLợi nhuận gộp đơn: ${this.formatMoney(o.profit)}\n\nChi tiết sản phẩm:\n` +
        o.items.map(i => `- ${i.product_name}: ${i.quantity} ${i.unit} x ${this.formatMoney(i.sale_price)}${i.is_custom_price ? ' (Giá riêng)' : ''} = ${this.formatMoney(i.subtotal)}`).join('\n')
      );
    } catch (e) {
      App.toast('Không thể tải chi tiết đơn hàng: ' + e.message, 'error');
    }
  },

  // ==========================================
  // 8. SALES RETURNS (Khách đổi trả hàng)
  // ==========================================
  async renderReturnsView() {
    const container = document.getElementById('view-returns');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">🔄 Quản lý Khách Trả Hàng (Hoàn tiền / Giảm trừ nợ)</div>
          <button class="btn btn-primary" onclick="App.openCreateReturnModal()">+ Lập phiếu trả hàng</button>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Thời gian</th>
                  <th>Khách hàng</th>
                  <th style="text-align: center;">Số mặt hàng</th>
                  <th style="text-align: right;">Tổng giá trị hàng trả</th>
                  <th style="text-align: right;">Tiền đã hoàn lại</th>
                  <th style="text-align: right;">Trừ vào công nợ</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody id="returns-table-body">
                <tr><td colspan="8" style="text-align: center; padding: 20px;">Đang tải danh sách trả hàng...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    try {
      const returns = await API.getReturns();
      const tbody = document.getElementById('returns-table-body');
      if (!tbody) return;

      if (returns.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 30px;">Chưa có phiếu trả hàng nào</td></tr>`;
        return;
      }

      tbody.innerHTML = returns.map(r => `
        <tr>
          <td><strong>${r.code}</strong></td>
          <td>${r.created_at}</td>
          <td><strong>${r.customer_name}</strong></td>
          <td style="text-align: center;"><span class="badge-tag badge-purple">${r.item_count} món</span></td>
          <td style="text-align: right; font-weight: 700; color: #0066cc;">${this.formatMoney(r.total_amount)}</td>
          <td style="text-align: right; color: #ef4444; font-weight: 600;">${this.formatMoney(r.refund_amount)}</td>
          <td style="text-align: right; color: #10b981; font-weight: 600;">${this.formatMoney(r.debt_deduct_amount)}</td>
          <td><small style="color: #64748b;">${r.notes || ''}</small></td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải phiếu trả hàng: ' + err.message, 'error');
    }
  },

  async openCreateReturnModal() {
    const modal = document.getElementById('return-modal');
    modal.classList.add('active');

    // Populate customers
    const custSelect = document.getElementById('ret-customer-select');
    custSelect.innerHTML = '<option value="">Khách lẻ</option>';
    try {
      const custs = await API.getCustomers();
      custs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} (Nợ hiện tại: ${this.formatMoney(c.debt)})`;
        custSelect.appendChild(opt);
      });
    } catch (e) {}

    // Populate products
    const prodSelect = document.getElementById('ret-product-select');
    prodSelect.innerHTML = '<option value="">-- Chọn sản phẩm khách trả lại --</option>';
    try {
      const prods = await API.getProducts();
      prods.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (Giá bán: ${this.formatMoney(p.sale_price)})`;
        opt.dataset.price = p.sale_price;
        prodSelect.appendChild(opt);
      });
    } catch (e) {}

    document.getElementById('ret-product-select').onchange = (e) => {
      const opt = e.target.options[e.target.selectedIndex];
      if (opt && opt.dataset.price) {
        document.getElementById('ret-price').value = opt.dataset.price;
        this.updateReturnTotals();
      }
    };

    document.getElementById('ret-qty').value = 1;
    document.getElementById('ret-qty').oninput = () => this.updateReturnTotals();
    document.getElementById('ret-price').oninput = () => this.updateReturnTotals();
  },

  updateReturnTotals() {
    const qty = parseFloat(document.getElementById('ret-qty').value) || 0;
    const price = parseFloat(document.getElementById('ret-price').value) || 0;
    const total = qty * price;
    const totalElem = document.getElementById('ret-total-amount');
    const refundInput = document.getElementById('ret-refund-amount');
    if (totalElem) totalElem.textContent = this.formatMoney(total);
    if (refundInput && (!refundInput.dataset.manual || refundInput.dataset.manual === 'false')) {
      refundInput.value = total;
    }
  },

  async submitSalesReturn() {
    const custSelect = document.getElementById('ret-customer-select');
    const custId = custSelect.value ? parseInt(custSelect.value) : null;
    const custName = custId ? custSelect.options[custSelect.selectedIndex].text.split('(')[0].trim() : 'Khách lẻ';

    const prodSelect = document.getElementById('ret-product-select');
    const prodId = prodSelect.value ? parseInt(prodSelect.value) : null;
    if (!prodId) {
      App.toast('Vui lòng chọn sản phẩm khách trả lại', 'warning');
      return;
    }

    const qty = parseFloat(document.getElementById('ret-qty').value) || 0;
    const price = parseFloat(document.getElementById('ret-price').value) || 0;
    if (qty <= 0 || price < 0) {
      App.toast('Số lượng và đơn giá trả hàng không hợp lệ', 'warning');
      return;
    }

    const refundAmount = parseFloat(document.getElementById('ret-refund-amount').value) || 0;
    const debtDeduct = parseFloat(document.getElementById('ret-debt-deduct').value) || 0;
    const fundType = document.getElementById('ret-fund-type').value;
    const notes = document.getElementById('ret-notes').value;

    const payload = {
      customer_id: custId,
      customer_name: custName,
      items: [{
        product_id: prodId,
        quantity: qty,
        return_price: price
      }],
      refund_amount: refundAmount,
      debt_deduct_amount: debtDeduct,
      fund_type: fundType,
      notes: notes
    };

    try {
      const res = await API.createReturn(payload);
      App.toast(`Lập phiếu trả hàng ${res.code} thành công! Kho đã tăng lại tồn.`, 'success');
      document.getElementById('return-modal').classList.remove('active');
      this.renderReturnsView();
      this.loadTopFundSummary();
    } catch (err) {
      App.toast('Lỗi tạo phiếu trả hàng: ' + err.message, 'error');
    }
  },

  // ==========================================
  // 9. SETTINGS & SYSTEM BACKUP VIEW
  // ==========================================
  async renderSettingsView() {
    const container = document.getElementById('view-settings');
    if (!container) return;

    try {
      const s = await API.getSettings();

      container.innerHTML = `
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
          <!-- Store Config Form -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">⚙️ Cấu hình thông tin Cửa hàng & Hóa đơn</div>
            </div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label">Tên cửa hàng / Tổng kho phân phối (*):</label>
                <input type="text" id="cfg-store-name" class="form-control" value="${s.store_name || ''}">
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Số điện thoại hotline:</label>
                  <input type="text" id="cfg-store-phone" class="form-control" value="${s.store_phone || ''}">
                </div>
                <div class="form-group">
                  <label class="form-label">Thuế VAT mặc định (%):</label>
                  <select id="cfg-vat" class="form-control">
                    <option value="0" ${s.default_vat_rate === '0' ? 'selected' : ''}>0% (Không chịu thuế)</option>
                    <option value="8" ${s.default_vat_rate === '8' ? 'selected' : ''}>8% (VAT ưu đãi)</option>
                    <option value="10" ${s.default_vat_rate === '10' ? 'selected' : ''}>10% (VAT chuẩn)</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Địa chỉ trụ sở / Cửa hàng:</label>
                <input type="text" id="cfg-store-address" class="form-control" value="${s.store_address || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Lời chào chân trang hóa đơn in:</label>
                <input type="text" id="cfg-footer" class="form-control" value="${s.invoice_footer || ''}">
              </div>
              <div class="form-group" style="background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
                  <input type="checkbox" id="cfg-allow-negative" ${s.allow_negative_stock === 'true' ? 'checked' : ''}>
                  Cho phép bán khi hết tồn kho (Âm kho)
                </label>
                <small style="color: #64748b; display: block; margin-top: 4px;">
                  Khi tắt tùy chọn này, hệ thống sẽ chặn nghiêm ngặt không cho thu ngân xuất bán các mặt hàng không còn đủ tồn kho thực tế.
                </small>
              </div>
              <button class="btn btn-primary" onclick="App.saveStoreSettings()">Lưu cấu hình hệ thống</button>
            </div>
          </div>

          <!-- Backup & System Health -->
          <div>
            <div class="card">
              <div class="card-header">
                <div class="card-title">💾 Sao lưu dữ liệu (Backup)</div>
              </div>
              <div class="card-body">
                <p style="font-size: 0.88rem; color: #475569; margin-bottom: 14px;">
                  Tải về toàn bộ cơ sở dữ liệu SQLite của cửa hàng bao gồm toàn bộ sản phẩm, bảng giá riêng, khách hàng, đơn hàng, hóa đơn và sổ quỹ.
                </p>
                <a href="/api/backup/download" class="btn btn-success" style="width: 100%; text-decoration: none;" download>
                  📥 Tải file sao lưu Database (.db)
                </a>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">🌐 Kết nối Mạng nội bộ (LAN)</div>
              </div>
              <div class="card-body" style="font-size: 0.88rem;">
                <p style="color: #475569; margin-bottom: 8px;">
                  Hệ thống đang chạy chế độ <strong>Multi-threaded</strong> sẵn sàng cho nhiều quầy thu ngân và nhân viên truy cập cùng lúc qua Wi-Fi nội bộ.
                </p>
                <div style="background: #f1f5f9; padding: 10px; border-radius: 6px; font-family: monospace;">
                  Cổng kết nối: <strong>8080</strong><br>
                  Máy chủ: <strong>0.0.0.0</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card card-body" style="color: red;">Lỗi tải cài đặt: ${err.message}</div>`;
    }
  },

  async saveStoreSettings() {
    const payload = {
      store_name: document.getElementById('cfg-store-name').value.trim(),
      store_phone: document.getElementById('cfg-store-phone').value.trim(),
      store_address: document.getElementById('cfg-store-address').value.trim(),
      default_vat_rate: document.getElementById('cfg-vat').value,
      invoice_footer: document.getElementById('cfg-footer').value.trim(),
      allow_negative_stock: document.getElementById('cfg-allow-negative').checked ? 'true' : 'false'
    };

    try {
      await API.saveSettings(payload);
      App.toast('Lưu cấu hình hệ thống thành công!', 'success');
      POS.loadStoreSettings();
    } catch (err) {
      App.toast('Lỗi lưu cài đặt: ' + err.message, 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
