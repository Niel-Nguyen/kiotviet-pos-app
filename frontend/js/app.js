/**
 * Main Application Controller for KiotPro POS & Distribution Management
 * SaaS Enterprise Grade UI, Mobile Drawer Navigation, Date Filtering,
 * Sales Returns, and Strict Data Validation.
 */

const App = {
  currentView: 'dashboard',
  selectedCustomerForPricing: null,
  dashboardRange: 'today',
  purchaseDraftItems: [],
  currentUser: null,
  userPermissions: new Set(),
  auditPage: 1,
  auditLimit: 25,
  ordersPage: 1,
  ordersLimit: 15,
  currentColumnSelectorView: null,

  VIEW_PERMISSIONS: {
    'users': 'users:manage',
    'settings': 'settings:manage',
    'audit': 'audit:view',
    'reports': 'reports:view',
    'purchases': 'purchases:view',
    'cash-flow': 'cash_flow:view',
    'returns': 'returns:view',
    'customers': 'customers:view',
    'suppliers': 'suppliers:view',
    'products': 'products:view',
    'pos': 'orders:create',
    'orders': 'orders:view',
    'promotions': 'promotions:view',
    'dashboard': null
  },

  async init() {
    this.setupNavigation();
    this.setupModals();
    await this.initAuth();

    // F9 shortcut to switch to POS
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F9') {
        e.preventDefault();
        if (this.hasPermission('orders:create')) {
          this.navigate('pos');
        }
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
    let iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';
    if (type === 'success') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>';
    } else if (type === 'warning') {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';
    }

    toast.innerHTML = `${iconSvg} <div>${message}</div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3800);
  },

  async loadTopFundSummary() {
    try {
      if (this.hasPermission && !this.hasPermission('cash_flow:view')) {
        const elem = document.getElementById('top-fund-balance');
        if (elem) elem.textContent = '***';
        return;
      }
      const stats = await API.getDashboardStats();
      const elem = document.getElementById('top-fund-balance');
      if (elem && stats) {
        elem.textContent = this.formatMoney(stats.cash_balance !== undefined ? stats.cash_balance : (stats.funds ? stats.funds.total_balance : 0));
      }
    } catch (e) {
      console.warn('Could not load fund balance', e);
    }
  },

  setupNavigation() {
    // Menu items
    const menuLinks = document.querySelectorAll('[data-view]');
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('btn-toggle-sidebar');

    menuLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.getAttribute('data-view');
        this.navigate(view);
        if (sidebar && sidebar.classList.contains('open')) {
          sidebar.classList.remove('open');
          if (overlay) overlay.classList.remove('active');
        }
      });
    });

    // Mobile sidebar toggle
    if (toggleBtn && sidebar && overlay) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
      });

      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      });
    }
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
      'returns': 'Quản lý Khách trả hàng (Đổi trả)',
      'cash-flow': 'Quản lý Sổ quỹ & Dòng tiền',
      'reports': 'Báo cáo doanh thu & Lợi nhuận',
      'settings': 'Cài đặt hệ thống & Sao lưu',
      'audit': 'Nhật ký hoạt động & Truy vết kiểm toán',
      'users': 'Quản lý Nhân viên & Phân quyền',
      'orders': 'Quản lý Hóa đơn & Đơn bán',
      'promotions': 'Chương trình Khuyến mãi & Chiết khấu'
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

      // Check permission
      const requiredPerm = this.VIEW_PERMISSIONS[viewName];
      if (requiredPerm && !this.hasPermission(requiredPerm)) {
        targetSec.innerHTML = this.renderAccessDenied(requiredPerm);
        return;
      }
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
      case 'returns':
        this.renderReturnsView();
        break;
      case 'cash-flow':
        this.renderCashFlowView();
        break;
      case 'reports':
        this.renderReportsView();
        break;
      case 'settings':
        this.renderSettingsView();
        break;
      case 'audit':
        this.renderAuditView();
        break;
      case 'users':
        this.renderUsersView();
        break;
      case 'orders':
        this.renderOrdersView();
        break;
      case 'promotions':
        this.renderPromotionsView();
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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <div style="font-size: 0.88rem; font-weight: 600; color: var(--color-text-muted);">
            Kỳ phân tích: <span style="color: var(--color-primary);">${rangeLabels[this.dashboardRange] || 'Hôm nay'}</span>
            ${today.returns_total > 0 ? `<span class="badge-tag badge-amber" style="margin-left: 8px;">Đã trừ trả hàng: ${this.formatMoney(today.returns_total)}</span>` : ''}
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm ${this.dashboardRange === 'today' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('today')">Hôm nay</button>
            <button class="btn btn-sm ${this.dashboardRange === 'yesterday' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('yesterday')">Hôm qua</button>
            <button class="btn btn-sm ${this.dashboardRange === '7days' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('7days')">7 ngày</button>
            <button class="btn btn-sm ${this.dashboardRange === 'this_month' ? 'btn-primary' : 'btn-outline'}" onclick="App.setDashboardRange('this_month')">Tháng này</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon icon-blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>
            <div class="stat-info">
              <p>Doanh thu thuần</p>
              <h3>${this.formatMoney(today.today_revenue || 0)}</h3>
              <small>${today.today_orders || 0} đơn đã hoàn tất</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            </div>
            <div class="stat-info">
              <p>Lợi nhuận gộp</p>
              <h3 style="color: var(--color-success);">${this.formatMoney(today.today_profit || 0)}</h3>
              <small>Doanh thu thuần trừ giá vốn</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
            </div>
            <div class="stat-info">
              <p>Giá trị kho hàng (MAC)</p>
              <h3>${this.formatMoney(inv.total_inventory_cost || 0)}</h3>
              <small>${inv.total_products || 0} sản phẩm (${inv.total_stock_items || 0} tồn)</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-amber">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div class="stat-info">
              <p>Công nợ phải thu</p>
              <h3 style="color: var(--color-warning);">${this.formatMoney(debt.receivables || 0)}</h3>
              <small>Nợ từ khách mua hàng</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-red">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/></svg>
            </div>
            <div class="stat-info">
              <p>Nợ phải trả NCC</p>
              <h3 style="color: var(--color-danger);">${this.formatMoney(debt.payables || 0)}</h3>
              <small>Công nợ nguồn hàng</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon icon-blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </div>
            <div class="stat-info">
              <p>Số dư quỹ tiền</p>
              <h3 style="color: var(--color-primary);">${this.formatMoney(funds.total_balance || 0)}</h3>
              <small>TM: ${this.formatMoney(funds.cash_balance || 0)} | NH: ${this.formatMoney(funds.bank_balance || 0)}</small>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 18px;">
          <!-- 7-Day Revenue Trend Chart -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>
                <span>Biểu đồ Doanh thu & Lợi nhuận (7 ngày gần nhất)</span>
              </div>
              <div style="display: flex; gap: 12px; font-size: 0.75rem;">
                <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background-color: var(--color-primary); border-radius: 2px;"></span> Doanh thu</span>
                <span style="display: inline-flex; align-items: center; gap: 4px;"><span style="width: 10px; height: 10px; background-color: var(--color-success); border-radius: 2px;"></span> Lợi nhuận</span>
              </div>
            </div>
            <div class="card-body">
              <div style="height: 240px; display: flex; align-items: flex-end; gap: 14px; padding-top: 20px;">
                ${this.renderBarChart(data.revenue_trend || [])}
              </div>
            </div>
          </div>

          <!-- Top Selling Products -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><circle cx="12" cy="12" r="3"/></svg>
                <span>Top 5 sản phẩm bán chạy</span>
              </div>
            </div>
            <div class="card-body" style="padding: 0;">
              <table class="table">
                <thead>
                  <tr>
                    <th>Sản phẩm</th>
                    <th class="text-center">Đã bán</th>
                    <th class="text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody>
                  ${(data.top_products || []).length > 0 ? (data.top_products || []).map(p => `
                    <tr>
                      <td>
                        <strong style="color: var(--color-text-main);">${p.name}</strong><br>
                        <small style="color: var(--color-text-subtle);">${p.code}</small>
                      </td>
                      <td class="text-center">
                        <span class="badge-tag badge-blue">${p.total_quantity} ${p.unit}</span>
                      </td>
                      <td class="text-right tabular-nums font-bold">${this.formatMoney(p.total_sales)}</td>
                    </tr>
                  `).join('') : `
                    <tr><td colspan="3" class="empty-state">Chưa có dữ liệu giao dịch</td></tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Low Stock Warning List -->
        <div class="card">
          <div class="card-header" style="background-color: var(--color-danger-subtle); border-color: var(--color-danger-border);">
            <div class="card-title" style="color: var(--color-danger-text);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
              <span>Cảnh báo tồn kho an toàn (${(data.low_stock || []).length})</span>
            </div>
            <button class="btn btn-sm btn-primary" onclick="App.openCreatePurchaseModal()">+ Nhập hàng ngay</button>
          </div>
          <div class="card-body" style="padding: 0;">
            <div class="table-responsive">
              <table class="table">
                <thead>
                  <tr>
                    <th>Mã SP</th>
                    <th>Tên sản phẩm</th>
                    <th>Danh mục</th>
                    <th class="text-center">Tồn thực tế</th>
                    <th class="text-center">Tồn tối thiểu</th>
                    <th class="text-right">Giá vốn MAC</th>
                    <th class="text-right">Giá bán</th>
                    <th class="text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  ${(data.low_stock || []).length > 0 ? (data.low_stock || []).map(p => `
                    <tr>
                      <td><code>${p.code}</code></td>
                      <td><strong>${p.name}</strong></td>
                      <td><span class="badge-tag badge-blue">${p.category || 'Chung'}</span></td>
                      <td class="text-center">
                        <span class="badge-tag badge-red">
                          ${p.stock} ${p.unit}
                        </span>
                      </td>
                      <td class="text-center text-subtle">${p.min_stock} ${p.unit}</td>
                      <td class="text-right tabular-nums">${this.formatMoney(p.cost_price)}</td>
                      <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(p.sale_price)}</td>
                      <td class="text-right">
                        <button class="btn btn-sm btn-success" onclick="App.openCreatePurchaseForProduct(${p.id})">Nhập hàng</button>
                      </td>
                    </tr>
                  `).join('') : `
                    <tr><td colspan="8" class="empty-state" style="color: var(--color-success);">Tất cả mặt hàng đều đảm bảo mức tồn kho an toàn.</td></tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card card-body" style="color: var(--color-danger);">Lỗi tải dữ liệu tổng quan: ${err.message}</div>`;
    }
  },

  setDashboardRange(range) {
    this.dashboardRange = range;
    this.renderDashboardView();
  },

  renderBarChart(trendData) {
    if (!trendData || trendData.length === 0) return '<div class="empty-state">Chưa có số liệu</div>';
    const maxVal = Math.max(...trendData.map(d => Math.max(d.revenue, d.profit, 1000000)));

    return trendData.map(d => {
      const revHeight = Math.max(8, (d.revenue / maxVal) * 180);
      const profitHeight = Math.max(4, (d.profit / maxVal) * 180);

      return `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
          <div style="display: flex; gap: 4px; align-items: flex-end;">
            <div style="width: 14px; height: ${revHeight}px; background-color: var(--color-primary); border-radius: 3px 3px 0 0;" title="Doanh thu: ${this.formatMoney(d.revenue)}"></div>
            <div style="width: 14px; height: ${profitHeight}px; background-color: var(--color-success); border-radius: 3px 3px 0 0;" title="Lợi nhuận: ${this.formatMoney(d.profit)}"></div>
          </div>
          <div style="font-size: 0.72rem; color: var(--color-text-subtle); margin-top: 6px; font-weight: 600;">${d.display_date}</div>
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
        <div class="card-header" style="flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="prod-search-input" class="form-control" style="max-width: 280px;" placeholder="Tìm theo tên, mã SKU, mã vạch...">
            <select id="prod-cat-filter" class="form-control" style="max-width: 170px;">
              <option value="">Tất cả danh mục</option>
            </select>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.84rem; cursor: pointer; color: var(--color-text-muted);">
              <input type="checkbox" id="prod-low-stock-filter"> Cảnh báo tồn kho
            </label>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="App.openColumnSelector('products')">Chọn cột</button>
            <button class="btn btn-outline" onclick="App.exportExcel('products')">Xuất Excel</button>
            <button class="btn btn-primary" onclick="App.openCreateProductModal()">+ Thêm hàng hóa</button>
          </div>
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
                  <th>Quy đổi đóng gói</th>
                  <th class="text-right">Giá vốn (MAC)</th>
                  <th class="text-right">Giá bán</th>
                  <th class="text-center">Tồn kho & Quy đổi</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="products-table-body">
                <tr><td colspan="9" class="empty-state">Đang tải danh mục hàng hóa...</td></tr>
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
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Không tìm thấy hàng hóa phù hợp</td></tr>`;
        return;
      }

      tbody.innerHTML = products.map(p => {
        let packagingUnitsHtml = '';
        if (p.units && p.units.length > 1) {
          packagingUnitsHtml = p.units
            .filter(u => !u.is_base)
            .map(u => `<span class="unit-tag-pill">${u.name} (x${u.conversion_rate})</span>`)
            .join(' ');
        } else if (p.sub_unit) {
          packagingUnitsHtml = `<small style="color: var(--color-text-muted);">1 ${p.unit} = ${p.sub_unit_ratio} ${p.sub_unit}</small>`;
        } else {
          packagingUnitsHtml = '<span style="color: var(--color-text-disabled);">---</span>';
        }

        return `
        <tr>
          <td>
            <strong>${p.code}</strong><br>
            <small style="color: var(--color-text-subtle); font-family: var(--font-mono);">${p.barcode || '---'}</small>
          </td>
          <td>
            <div style="font-weight: 600; color: var(--color-text-main);">${p.name}</div>
          </td>
          <td><span class="badge-tag badge-blue">${p.category || 'Chung'}</span></td>
          <td><strong>${p.unit}</strong></td>
          <td>${packagingUnitsHtml}</td>
          <td class="text-right tabular-nums">${p.cost_price ? this.formatMoney(p.cost_price) : '***'}</td>
          <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(p.sale_price)}</td>
          <td class="text-center">
            <span class="badge-tag ${p.stock <= p.min_stock ? 'badge-red' : 'badge-green'}">
              ${p.stock} ${p.unit}
            </span>
            ${p.stock_breakdown && p.stock_breakdown !== `${p.stock} ${p.unit}` ? `
              <div style="font-size: 0.75rem; color: var(--color-primary); font-weight: 600; margin-top: 3px;">
                ${p.stock_breakdown}
              </div>
            ` : ''}
          </td>
          <td class="text-right">
            <div style="display: flex; gap: 4px; justify-content: flex-end;">
              <button class="btn btn-sm btn-outline" onclick="App.openProductUnitsModal(${p.id})" title="Quy đổi đơn vị tính">Đơn vị</button>
              <button class="btn btn-sm btn-outline" onclick="App.openStockLogsModal(${p.id})" title="Thẻ kho">Thẻ kho</button>
              <button class="btn btn-sm btn-outline" onclick="App.openAdjustStockModal(${p.id}, '${p.name.replace(/'/g, "\\'")}', ${p.stock})" title="Kiểm kho">Kiểm kho</button>
              <button class="btn btn-sm btn-outline" onclick="App.openEditProductModal(${p.id})" title="Sửa">Sửa</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');
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
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Đang tải thẻ kho...</td></tr>';
    modal.classList.add('active');

    try {
      const logs = await API.getProductLogs(productId);
      if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Chưa có biến động kho</td></tr>';
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
            <td class="text-center font-bold tabular-nums" style="color: ${l.change_qty >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">
              ${l.change_qty >= 0 ? '+' : ''}${l.change_qty} ${l.unit || ''}
            </td>
            <td class="text-center tabular-nums">${l.stock_before} → <strong>${l.stock_after}</strong></td>
            <td><small style="color: var(--color-text-subtle);">${l.notes || ''}</small></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color: var(--color-danger);">Lỗi tải thẻ kho: ${err.message}</td></tr>`;
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
  // 3. PURCHASES VIEW (Goods Receipt)
  // ==========================================
  async renderPurchasesView() {
    const container = document.getElementById('view-purchases');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header" style="flex-wrap: wrap; gap: 10px;">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
            <span>Danh sách phiếu nhập hàng từ Nhà cung cấp</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="App.openColumnSelector('purchases')">Chọn cột</button>
            <button class="btn btn-outline" onclick="App.exportExcel('purchases')">Xuất Excel</button>
            <button class="btn btn-primary" onclick="App.openCreatePurchaseModal()">+ Tạo phiếu nhập hàng</button>
          </div>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Thời gian</th>
                  <th>Nhà cung cấp</th>
                  <th class="text-center">Số mặt hàng</th>
                  <th class="text-right">Tổng tiền hàng</th>
                  <th class="text-right">Đã trả NCC</th>
                  <th class="text-right">Còn nợ</th>
                  <th class="text-center">Trạng thái</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="purchases-table-body">
                <tr><td colspan="9" class="empty-state">Đang tải danh sách nhập hàng...</td></tr>
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
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Chưa có phiếu nhập hàng nào</td></tr>`;
        return;
      }

      tbody.innerHTML = purchases.map(p => `
        <tr>
          <td><strong>${p.code}</strong></td>
          <td>${p.created_at}</td>
          <td>${p.supplier_name || 'Nhà cung cấp'}</td>
          <td class="text-center"><span class="badge-tag badge-blue">${p.item_count} mặt hàng</span></td>
          <td class="text-right tabular-nums font-bold">${this.formatMoney(p.final_amount)}</td>
          <td class="text-right tabular-nums" style="color: var(--color-success);">${this.formatMoney(p.paid_amount)}</td>
          <td class="text-right tabular-nums font-bold" style="color: ${p.debt_amount > 0 ? 'var(--color-danger)' : 'var(--color-text-subtle)'};">
            ${this.formatMoney(p.debt_amount)}
          </td>
          <td class="text-center"><span class="badge-tag badge-green">Hoàn tất</span></td>
          <td class="text-right">
            <button class="btn btn-sm btn-outline" onclick="App.viewPurchaseDetail(${p.id})">Chi tiết</button>
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
        opt.textContent = `${s.name} (Nợ: ${this.formatMoney(s.debt)})`;
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
      container.innerHTML = '<tr><td colspan="6" class="empty-state">Chưa chọn sản phẩm nhập kho. Nhấn "+ Thêm sản phẩm nhập kho" bên trên.</td></tr>';
      this.updatePurchaseDraftTotals();
      return;
    }

    container.innerHTML = this.purchaseDraftItems.map((item, idx) => `
      <tr>
        <td><strong>${item.name}</strong><br><small style="color: var(--color-text-subtle); font-family: var(--font-mono);">${item.code}</small></td>
        <td>${item.unit}</td>
        <td>
          <input type="number" class="form-control" style="width: 80px;" value="${item.quantity}" min="1" onchange="App.updatePurchaseItemQty(${idx}, this.value)">
        </td>
        <td>
          <input type="number" class="form-control" style="width: 130px;" value="${item.import_price}" min="0" onchange="App.updatePurchaseItemPrice(${idx}, this.value)">
        </td>
        <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">
          ${this.formatMoney(item.quantity * item.import_price)}
        </td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="App.removePurchaseItem(${idx})" style="color: var(--color-danger);">✕</button>
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
        <div class="card-header" style="flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1;">
            <input type="text" id="cust-search-input" class="form-control" style="max-width: 320px;" placeholder="Tìm theo tên, SĐT, mã khách, email...">
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="App.openColumnSelector('customers')">Chọn cột</button>
            <button class="btn btn-outline" onclick="App.exportExcel('customers')">Xuất Excel</button>
            <button class="btn btn-primary" onclick="App.openCreateCustomerModal()">+ Thêm khách hàng</button>
          </div>
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
                  <th class="text-right">Tổng mua</th>
                  <th class="text-right">Công nợ hiện tại</th>
                  <th class="text-center">Đơn chờ xử lý</th>
                  <th class="text-center">Bảng giá riêng</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="customers-table-body">
                <tr><td colspan="9" class="empty-state">Đang tải danh sách khách hàng...</td></tr>
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
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Không tìm thấy khách hàng phù hợp</td></tr>`;
        return;
      }

      tbody.innerHTML = customers.map(c => `
        <tr>
          <td><strong>${c.code}</strong></td>
          <td>
            <div style="font-weight: 600; color: var(--color-text-main);">${c.name}</div>
            <small style="color: var(--color-text-subtle);">${c.address || ''}</small>
          </td>
          <td>${c.phone || '---'}</td>
          <td><span class="badge-tag badge-purple">${c.group_name || 'Khách lẻ'}</span></td>
          <td class="text-right tabular-nums font-bold">${this.formatMoney(c.total_spent)}</td>
          <td class="text-right tabular-nums font-bold" style="color: ${c.debt > 0 ? 'var(--color-danger)' : 'var(--color-success)'};">
            ${this.formatMoney(c.debt)}
          </td>
          <td class="text-center">
            ${c.pending_orders_count > 0 ? `
              <button class="btn btn-sm btn-outline order-badge-pending" onclick="App.viewCustomerPendingOrders(${c.id}, '${c.name.replace(/'/g, "\\'")}')" title="Xem danh sách đơn chờ">
                ${c.pending_orders_count} đơn (${this.formatMoney(c.pending_orders_amount)})
              </button>
            ` : '<span style="color: var(--color-text-disabled); font-size: 0.8rem;">0 đơn</span>'}
          </td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline" style="background-color: #fffbeb; border-color: #fde68a; color: #92400e; font-weight: 600;" onclick="App.openCustomerPricingModal(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
              Giá riêng
            </button>
          </td>
          <td class="text-right">
            ${c.debt > 0 ? `<button class="btn btn-sm btn-success" onclick="App.openPayCustomerDebtModal(${c.id}, '${c.name.replace(/'/g, "\\'")}', ${c.debt})">Thu nợ</button>` : ''}
            <button class="btn btn-sm btn-outline" onclick="App.openEditCustomerModal(${c.id})">Sửa</button>
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
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Đang tải bảng giá...</td></tr>';

    try {
      const prices = await API.getCustomerPrices(this.selectedCustomerForPricing.id);
      if (prices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Khách hàng này chưa có bảng giá riêng. Đang áp dụng giá niêm yết chuẩn.</td></tr>`;
        return;
      }

      tbody.innerHTML = prices.map(p => {
        const diff = p.custom_price - p.default_sale_price;
        const diffText = diff < 0 
          ? `<span style="color: var(--color-success); font-weight: 600;">Giảm ${this.formatMoney(Math.abs(diff))}</span>`
          : (diff > 0 ? `<span style="color: var(--color-warning); font-weight: 600;">Tăng ${this.formatMoney(diff)}</span>` : 'Bằng giá chuẩn');

        return `
          <tr>
            <td><code>${p.product_code}</code></td>
            <td><strong>${p.product_name}</strong></td>
            <td>${p.unit}</td>
            <td class="text-right tabular-nums text-subtle" style="text-decoration: line-through;">${this.formatMoney(p.default_sale_price)}</td>
            <td class="text-right tabular-nums font-bold" style="color: var(--color-primary); font-size: 0.95rem;">
              ${this.formatMoney(p.custom_price)}
            </td>
            <td>${diffText}<br><small style="color: var(--color-text-subtle);">${p.notes || ''}</small></td>
            <td class="text-right">
              <button class="btn btn-sm btn-outline" style="color: var(--color-danger);" onclick="App.deleteCustomerPriceRule(${p.id})">Hủy giá riêng</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color: var(--color-danger);">Lỗi tải giá riêng: ${err.message}</td></tr>`;
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
        <div class="card-header" style="flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1;">
            <input type="text" id="supp-search-input" class="form-control" style="max-width: 320px;" placeholder="Tìm theo tên, SĐT, mã NCC, email...">
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="App.openColumnSelector('suppliers')">Chọn cột</button>
            <button class="btn btn-outline" onclick="App.exportExcel('suppliers')">Xuất Excel</button>
            <button class="btn btn-primary" onclick="App.openCreateSupplierModal()">+ Thêm Nhà cung cấp</button>
          </div>
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
                  <th class="text-right">Công nợ phải trả NCC</th>
                  <th>Ghi chú</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="suppliers-table-body">
                <tr><td colspan="7" class="empty-state">Đang tải danh sách nhà cung cấp...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('supp-search-input')?.addEventListener('input', () => this.loadSuppliersTable());
    this.loadSuppliersTable();
  },

  async loadSuppliersTable() {
    const q = document.getElementById('supp-search-input')?.value || '';
    try {
      const suppliers = await API.getSuppliers({ q });
      const tbody = document.getElementById('suppliers-table-body');
      if (!tbody) return;

      if (suppliers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Chưa có nhà cung cấp nào</td></tr>`;
        return;
      }

      tbody.innerHTML = suppliers.map(s => `
        <tr>
          <td><strong>${s.code}</strong></td>
          <td><strong>${s.name}</strong></td>
          <td>${s.phone || '---'}</td>
          <td>${s.address || '---'}</td>
          <td class="text-right tabular-nums font-bold" style="color: ${s.debt > 0 ? 'var(--color-danger)' : 'var(--color-success)'};">
            ${this.formatMoney(s.debt)}
          </td>
          <td><small style="color: var(--color-text-subtle);">${s.notes || ''}</small></td>
          <td class="text-right">
            ${s.debt > 0 ? `<button class="btn btn-sm btn-success" onclick="App.openPaySupplierDebtModal(${s.id}, '${s.name.replace(/'/g, "\\'")}', ${s.debt})">Trả nợ</button>` : ''}
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
  // 6. SALES RETURNS VIEW (Khách đổi trả hàng)
  // ==========================================
  async renderReturnsView() {
    const container = document.getElementById('view-returns');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header" style="flex-wrap: wrap; gap: 10px;">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
            <span>Quản lý Khách Trả Hàng (Hoàn tiền / Giảm trừ nợ)</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="App.openColumnSelector('returns')">Chọn cột</button>
            <button class="btn btn-outline" onclick="App.exportExcel('returns')">Xuất Excel</button>
            <button class="btn btn-primary" onclick="App.openCreateReturnModal()">+ Lập phiếu trả hàng</button>
          </div>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Thời gian</th>
                  <th>Khách hàng</th>
                  <th class="text-center">Số món</th>
                  <th class="text-right">Tổng giá trị</th>
                  <th class="text-right">Tiền hoàn khách</th>
                  <th class="text-right">Trừ vào nợ cũ</th>
                  <th>Lý do</th>
                </tr>
              </thead>
              <tbody id="returns-table-body">
                <tr><td colspan="8" class="empty-state">Đang tải danh sách trả hàng...</td></tr>
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
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Chưa có phiếu trả hàng nào</td></tr>`;
        return;
      }

      tbody.innerHTML = returns.map(r => `
        <tr>
          <td><strong>${r.code}</strong></td>
          <td>${r.created_at}</td>
          <td><strong>${r.customer_name}</strong></td>
          <td class="text-center"><span class="badge-tag badge-purple">${r.item_count} món</span></td>
          <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(r.total_amount)}</td>
          <td class="text-right tabular-nums" style="color: var(--color-danger); font-weight: 600;">${this.formatMoney(r.refund_amount)}</td>
          <td class="text-right tabular-nums" style="color: var(--color-success); font-weight: 600;">${this.formatMoney(r.debt_deduct_amount)}</td>
          <td><small style="color: var(--color-text-subtle);">${r.notes || ''}</small></td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải phiếu trả hàng: ' + err.message, 'error');
    }
  },

  async openCreateReturnModal() {
    const modal = document.getElementById('return-modal');
    modal.classList.add('active');

    const custSelect = document.getElementById('ret-customer-select');
    custSelect.innerHTML = '<option value="">Khách lẻ tại quầy</option>';
    try {
      const custs = await API.getCustomers();
      custs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} (Nợ: ${this.formatMoney(c.debt)})`;
        custSelect.appendChild(opt);
      });
    } catch (e) {}

    const prodSelect = document.getElementById('ret-product-select');
    prodSelect.innerHTML = '<option value="">-- Chọn sản phẩm khách trả lại --</option>';
    try {
      const prods = await API.getProducts();
      prods.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (Niêm yết: ${this.formatMoney(p.sale_price)})`;
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
  // 7. CASH FLOW VIEW (Sổ quỹ & Dòng tiền)
  // ==========================================
  async renderCashFlowView() {
    const container = document.getElementById('view-cash-flow');
    if (!container) return;

    container.innerHTML = `
      <div id="cash-flow-summary-cards" class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));">
      </div>

      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <select id="cf-type-filter" class="form-control" style="max-width: 150px;">
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
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="App.openColumnSelector('cash-flow')">Chọn cột</button>
            <button class="btn btn-outline" onclick="App.exportExcel('cash-flow')">Xuất Excel</button>
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
                  <th class="text-right">Số tiền</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody id="cash-flow-tbody">
                <tr><td colspan="8" class="empty-state">Đang tải sổ quỹ...</td></tr>
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
            <div class="stat-icon icon-blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </div>
            <div class="stat-info">
              <p>Tồn quỹ hiện tại</p>
              <h3 style="color: var(--color-primary);">${this.formatMoney(summary.current_balance)}</h3>
              <small>Thực thu trừ thực chi</small>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon icon-green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            </div>
            <div class="stat-info">
              <p>Tổng thực thu</p>
              <h3 style="color: var(--color-success);">${this.formatMoney(summary.total_receipts)}</h3>
              <small>Bán hàng & thu nợ</small>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon icon-red">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>
            </div>
            <div class="stat-info">
              <p>Tổng thực chi</p>
              <h3 style="color: var(--color-danger);">${this.formatMoney(summary.total_payments)}</h3>
              <small>Nhập hàng & chi phí</small>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon icon-purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h10"/><path d="M7 12h10"/><path d="M7 17h10"/></svg>
            </div>
            <div class="stat-info">
              <p>Phân loại quỹ</p>
              <div style="font-size: 0.8rem; font-weight: 700; margin-top: 3px;" class="tabular-nums">
                TM: ${this.formatMoney(summary.cash_balance)}<br>
                NH: ${this.formatMoney(summary.bank_balance)}
              </div>
            </div>
          </div>
        `;
      }

      const tbody = document.getElementById('cash-flow-tbody');
      if (!tbody) return;

      if (!res.items || res.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Không có giao dịch sổ quỹ nào</td></tr>`;
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
              ${item.fund_type === 'cash' ? 'Tiền mặt' : 'Ngân hàng'}
            </span>
          </td>
          <td class="text-right tabular-nums font-bold" style="color: ${item.type === 'receipt' ? 'var(--color-success)' : 'var(--color-danger)'};">
            ${item.type === 'receipt' ? '+' : '-'}${this.formatMoney(item.amount)}
          </td>
          <td><small style="color: var(--color-text-subtle);">${item.notes || ''}</small></td>
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
  // 8. REPORTS VIEW
  // ==========================================
  async renderReportsView() {
    const container = document.getElementById('view-reports');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>
            <span>Lịch sử Hóa đơn Bán ra (Doanh thu & Lợi nhuận gộp)</span>
          </div>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Thời gian</th>
                  <th>Khách hàng</th>
                  <th class="text-right">Tiền hàng</th>
                  <th class="text-right">Chiết khấu</th>
                  <th class="text-right">Thuế VAT</th>
                  <th class="text-right">Khách cần trả</th>
                  <th class="text-right">Khách trả</th>
                  <th class="text-right">Ghi nợ</th>
                  <th class="text-right">Lợi nhuận gộp</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="orders-report-tbody">
                <tr><td colspan="11" class="empty-state">Đang tải lịch sử đơn hàng...</td></tr>
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
        tbody.innerHTML = `<tr><td colspan="11" class="empty-state">Chưa có đơn hàng nào</td></tr>`;
        return;
      }

      tbody.innerHTML = orders.map(o => `
        <tr>
          <td><strong>${o.code}</strong></td>
          <td>${o.created_at}</td>
          <td><strong>${o.customer_name || 'Khách lẻ'}</strong></td>
          <td class="text-right tabular-nums">${this.formatMoney(o.total_amount)}</td>
          <td class="text-right tabular-nums" style="color: var(--color-danger);">${o.discount > 0 ? '-' + this.formatMoney(o.discount) : '0 đ'}</td>
          <td class="text-right tabular-nums text-subtle">${o.vat_amount > 0 ? this.formatMoney(o.vat_amount) : '0 đ'}</td>
          <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(o.final_amount)}</td>
          <td class="text-right tabular-nums" style="color: var(--color-success);">${this.formatMoney(o.paid_amount)}</td>
          <td class="text-right tabular-nums font-bold" style="color: ${o.debt_amount > 0 ? 'var(--color-danger)' : 'var(--color-text-subtle)'};">
            ${this.formatMoney(o.debt_amount)}
          </td>
          <td class="text-right tabular-nums font-bold" style="color: var(--color-success);">
            +${this.formatMoney(o.profit)}
          </td>
          <td class="text-right">
            <button class="btn btn-sm btn-outline" onclick="App.viewOrderDetail(${o.id})">Chi tiết</button>
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
      alert(`ĐƠN HÀNG ${o.code}\n\nKhách: ${o.customer_name}\nThời gian: ${o.created_at}\nTổng tiền hàng: ${this.formatMoney(o.total_amount)}\nChiết khấu: ${this.formatMoney(o.discount)}\nThuế VAT: ${this.formatMoney(o.vat_amount)}\nKhách cần trả: ${this.formatMoney(o.final_amount)}\nTiền khách đưa: ${this.formatMoney(o.customer_paid)}\nĐã thanh toán: ${this.formatMoney(o.paid_amount)}\nTiền thừa thối lại: ${this.formatMoney(o.change_amount)}\nCòn ghi nợ: ${this.formatMoney(o.debt_amount)}\nLợi nhuận gộp đơn: ${this.formatMoney(o.profit)}\n\nChi tiết sản phẩm:\n` +
        o.items.map(i => `- ${i.product_name}: ${i.quantity} ${i.unit} x ${this.formatMoney(i.sale_price)}${i.is_custom_price ? ' (Giá riêng)' : ''} = ${this.formatMoney(i.subtotal)}`).join('\n')
      );
    } catch (e) {
      App.toast('Không thể tải chi tiết đơn hàng: ' + e.message, 'error');
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
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <!-- Store Config Form -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Cấu hình Thông tin Cửa hàng & Hóa đơn in</span>
              </div>
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
              <div class="form-group" style="background: var(--color-surface-muted); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
                <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; color: var(--color-text-main);">
                  <input type="checkbox" id="cfg-allow-negative" ${s.allow_negative_stock === 'true' ? 'checked' : ''}>
                  Cho phép bán khi hết tồn kho (Âm kho)
                </label>
                <small style="color: var(--color-text-subtle); display: block; margin-top: 4px;">
                  Khi tắt, hệ thống sẽ chặn nghiêm ngặt không cho xuất bán hàng hóa vượt quá tồn kho thực tế.
                </small>
              </div>
              <button class="btn btn-primary" onclick="App.saveStoreSettings()">Lưu cấu hình hệ thống</button>
            </div>
          </div>

          <!-- Backup & LAN Connectivity -->
          <div>
            <div class="card">
              <div class="card-header">
                <div class="card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                  <span>Sao lưu dữ liệu (Backup)</span>
                </div>
              </div>
              <div class="card-body">
                <p style="font-size: 0.84rem; color: var(--color-text-muted); margin-bottom: 12px;">
                  Tải về cơ sở dữ liệu SQLite của cửa hàng bao gồm hàng hóa, giá riêng, khách hàng, đơn hàng, hóa đơn và sổ quỹ.
                </p>
                <a href="/api/backup/download" class="btn btn-success" style="width: 100%; text-decoration: none;" download>
                  Tải file sao lưu Database (.db)
                </a>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <span>Mạng nội bộ (LAN)</span>
                </div>
              </div>
              <div class="card-body" style="font-size: 0.84rem;">
                <p style="color: var(--color-text-muted); margin-bottom: 8px;">
                  Hệ thống đa luồng (Multi-threaded) sẵn sàng cho nhiều quầy thu ngân và nhân viên truy cập cùng lúc qua Wi-Fi.
                </p>
                <div style="background: var(--color-surface-muted); padding: 8px 10px; border-radius: var(--radius-sm); font-family: var(--font-mono); border: 1px solid var(--color-border);">
                  Port: <strong>8080</strong> | Bind: <strong>0.0.0.0</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="card card-body" style="color: var(--color-danger);">Lỗi tải cài đặt: ${err.message}</div>`;
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
  },

  // ==========================================
  // AUTHENTICATION & ACCESS CONTROL (RBAC)
  // ==========================================
  hasPermission(perm) {
    if (!perm) return true;
    if (!this.currentUser) return false;
    if (this.currentUser.role === 'admin') return true;
    return this.userPermissions && this.userPermissions.has(perm);
  },

  getRoleName(role) {
    const map = {
      'admin': 'Quản trị viên',
      'manager': 'Quản lý',
      'cashier': 'Thu ngân',
      'warehouse': 'Kho',
      'accountant': 'Kế toán',
      'viewer': 'Chỉ xem'
    };
    return map[role] || role;
  },

  getRoleBadgeClass(role) {
    const map = {
      'admin': 'badge-purple',
      'manager': 'badge-blue',
      'cashier': 'badge-green',
      'warehouse': 'badge-amber',
      'accountant': 'badge-blue',
      'viewer': 'badge-tag'
    };
    return map[role] || 'badge-tag';
  },

  renderAccessDenied(requiredPerm) {
    const roleName = this.currentUser ? this.getRoleName(this.currentUser.role) : 'Khách';
    const fullName = this.currentUser ? this.currentUser.full_name : 'Người dùng';
    return `
      <div class="empty-state" style="padding: 60px 20px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2" class="empty-state-icon">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <div style="font-weight: 700; font-size: 1.15rem; color: var(--color-text); margin: 12px 0 6px;">Không có quyền truy cập</div>
        <div style="font-size: 0.875rem; color: var(--color-text-secondary); max-width: 480px; margin: 0 auto 18px; line-height: 1.5;">
          Tài khoản của bạn (<strong>${fullName}</strong> - Vai trò: <strong>${roleName}</strong>) không được phân quyền thực hiện chức năng này (${requiredPerm}). Vui lòng liên hệ Quản trị viên hệ thống để được cấp quyền.
        </div>
        <button class="btn btn-primary" onclick="App.navigate('dashboard')">Quay lại Tổng quan</button>
      </div>
    `;
  },

  async initAuth() {
    try {
      const bs = await API.getBootstrapStatus();
      if (bs.need_bootstrap) {
        this.showAuthModal(true, bs.bootstrap_token_required);
        return;
      }

      const me = await API.getMe();
      this.currentUser = me.user;
      this.userPermissions = new Set(me.permissions || []);
      this.updateUserUI();
      this.applyRolePermissions();
      this.hideAuthModal();
      this.navigate('dashboard');
    } catch (err) {
      console.warn("Chưa đăng nhập:", err.message);
      this.currentUser = null;
      this.userPermissions = new Set();
      this.showAuthModal(false);
    }
  },

  showAuthModal(isBootstrap = false, bootstrapTokenRequired = false) {
    const modal = document.getElementById('auth-modal');
    const bsContainer = document.getElementById('auth-bootstrap-container');
    const loginContainer = document.getElementById('auth-login-container');
    const tokenGroup = document.getElementById('bs-token-group');
    const tokenInput = document.getElementById('bs-bootstrap-token');

    if (!modal) return;
    if (isBootstrap) {
      if (bsContainer) bsContainer.style.display = 'block';
      if (loginContainer) loginContainer.style.display = 'none';
      if (tokenGroup) tokenGroup.style.display = bootstrapTokenRequired ? 'block' : 'none';
      if (tokenInput) tokenInput.required = bootstrapTokenRequired;
    } else {
      if (bsContainer) bsContainer.style.display = 'none';
      if (loginContainer) loginContainer.style.display = 'block';
    }
    modal.classList.add('active');
  },

  hideAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('active');
  },

  updateUserUI() {
    if (!this.currentUser) return;
    const nameElem = document.getElementById('user-display-name');
    const roleElem = document.getElementById('user-role-badge');
    const initialsElem = document.getElementById('user-avatar-initials');

    if (nameElem) nameElem.textContent = this.currentUser.full_name;
    if (roleElem) {
      const cls = this.getRoleBadgeClass(this.currentUser.role);
      const title = this.getRoleName(this.currentUser.role);
      roleElem.innerHTML = `<span class="badge ${cls}" style="font-size: 0.65rem; padding: 1px 5px;">${title}</span>`;
    }
    if (initialsElem) {
      const parts = this.currentUser.full_name.trim().split(' ');
      const initials = parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : this.currentUser.full_name.slice(0, 2).toUpperCase();
      initialsElem.textContent = initials;
    }
  },

  applyRolePermissions() {
    if (!this.currentUser) return;
    document.querySelectorAll('.menu-item[data-view]').forEach(item => {
      const v = item.getAttribute('data-view');
      const perm = this.VIEW_PERMISSIONS[v];
      if (perm && !this.hasPermission(perm)) {
        item.style.display = 'none';
      } else {
        item.style.display = 'flex';
      }
    });

    const quickPosBtn = document.getElementById('btn-quick-pos');
    if (quickPosBtn) {
      quickPosBtn.style.display = this.hasPermission('orders:create') ? 'inline-flex' : 'none';
    }

    const fundPill = document.getElementById('top-fund-container');
    if (fundPill) {
      fundPill.style.display = this.hasPermission('cash_flow:view') ? 'flex' : 'none';
    }
  },

  async handleLoginSubmit(e) {
    e.preventDefault();
    const u = document.getElementById('login-username')?.value.trim();
    const p = document.getElementById('login-password')?.value;
    const errElem = document.getElementById('login-error-msg');
    const btn = document.getElementById('btn-login-submit');

    if (errElem) errElem.style.display = 'none';
    if (btn) btn.disabled = true;

    try {
      const res = await API.login({ username: u, password: p });
      API.setToken(res.token);
      this.toast(`Chào mừng ${res.user.full_name} đã đăng nhập!`, 'success');
      await this.initAuth();
    } catch (err) {
      if (errElem) {
        errElem.textContent = err.message || 'Đăng nhập không thành công';
        errElem.style.display = 'block';
      } else {
        this.toast(err.message, 'error');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async handleBootstrapSubmit(e) {
    e.preventDefault();
    const u = document.getElementById('bs-username')?.value.trim();
    const fn = document.getElementById('bs-fullname')?.value.trim();
    const p = document.getElementById('bs-password')?.value;
    const cp = document.getElementById('bs-confirm-password')?.value;
    const bootstrapToken = document.getElementById('bs-bootstrap-token')?.value.trim() || '';

    if (p !== cp) {
      this.toast('Mật khẩu và xác nhận mật khẩu không khớp', 'warning');
      return;
    }

    try {
      const res = await API.bootstrap({
        username: u,
        full_name: fn,
        password: p,
        bootstrap_token: bootstrapToken
      });
      API.setToken(res.token);
      const bootstrapTokenInput = document.getElementById('bs-bootstrap-token');
      if (bootstrapTokenInput) bootstrapTokenInput.value = '';
      this.toast('Khởi tạo tài khoản Quản trị viên thành công!', 'success');
      await this.initAuth();
    } catch (err) {
      this.toast('Lỗi khởi tạo: ' + err.message, 'error');
    }
  },

  async logout() {
    if (!confirm('Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?')) return;
    try {
      await API.logout();
    } catch (e) {
      // Ignore
    }
    API.setToken('');
    this.currentUser = null;
    this.userPermissions = new Set();
    this.toast('Đã đăng xuất khỏi hệ thống', 'info');
    this.showAuthModal(false);
  },

  openSelfPasswordModal() {
    const modal = document.getElementById('user-self-password-modal');
    if (modal) {
      document.getElementById('sp-old-password').value = '';
      document.getElementById('sp-new-password').value = '';
      document.getElementById('sp-confirm-password').value = '';
      modal.classList.add('active');
    }
  },

  async saveSelfPassword(e) {
    e.preventDefault();
    const oldP = document.getElementById('sp-old-password').value;
    const newP = document.getElementById('sp-new-password').value;
    const confP = document.getElementById('sp-confirm-password').value;

    if (newP !== confP) {
      this.toast('Mật khẩu mới và xác nhận mật khẩu không khớp', 'warning');
      return;
    }

    try {
      await API.changePassword({ old_password: oldP, new_password: newP });
      this.toast('Đổi mật khẩu thành công!', 'success');
      document.getElementById('user-self-password-modal')?.classList.remove('active');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  // ==========================================
  // USER MANAGEMENT (Admin only)
  // ==========================================
  async renderUsersView() {
    const container = document.getElementById('view-users');
    if (!container) return;
    if (!this.hasPermission('users:manage')) {
      container.innerHTML = this.renderAccessDenied('users:manage');
      return;
    }

    container.innerHTML = `
      <div class="table-toolbar">
        <div>
          <h3 style="font-size: 1.15rem; font-weight: 700; margin: 0;">Danh sách Nhân viên & Phân quyền</h3>
          <div style="font-size: 0.8125rem; color: var(--color-text-secondary); margin-top: 2px;">
            Quản lý tài khoản, vai trò bảo mật và thu hồi phiên đăng nhập
          </div>
        </div>
        <button class="btn btn-primary" onclick="App.openCreateUserModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Thêm nhân viên mới
        </button>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 50px;">ID</th>
              <th>Tên đăng nhập</th>
              <th>Họ và tên</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Ngày tạo</th>
              <th>Đăng nhập cuối</th>
              <th class="text-right" style="width: 260px;">Thao tác</th>
            </tr>
          </thead>
          <tbody id="users-table-body">
            <tr><td colspan="8" class="text-center" style="padding: 30px;">Đang tải danh sách nhân viên...</td></tr>
          </tbody>
        </table>
      </div>
    `;

    try {
      const users = await API.getUsers();
      const tbody = document.getElementById('users-table-body');
      if (!tbody) return;

      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 40px;">Chưa có nhân viên nào</td></tr>`;
        return;
      }

      tbody.innerHTML = users.map(u => {
        const isCurrent = u.id === this.currentUser.id;
        const statusBadge = u.is_active
          ? `<span class="badge badge-green">Hoạt động</span>`
          : `<span class="badge badge-red">Đã khóa</span>`;
        const roleBadge = `<span class="badge ${this.getRoleBadgeClass(u.role)}">${this.getRoleName(u.role)}</span>`;

        return `
          <tr>
            <td style="font-weight: 600;">${u.id}</td>
            <td><strong>${u.username}</strong> ${isCurrent ? '<span class="badge badge-blue" style="font-size: 0.65rem;">(Bạn)</span>' : ''}</td>
            <td>${u.full_name}</td>
            <td>${roleBadge}</td>
            <td>${statusBadge}</td>
            <td style="font-size: 0.8125rem; color: var(--color-text-secondary);">${u.created_at || '-'}</td>
            <td style="font-size: 0.8125rem; color: var(--color-text-secondary);">${u.last_login_at || 'Chưa đăng nhập'}</td>
            <td class="text-right">
              <div style="display: inline-flex; gap: 4px;">
                <button class="btn btn-sm btn-outline" onclick="App.openEditUserModal(${u.id}, '${encodeURIComponent(u.username)}', '${encodeURIComponent(u.full_name)}', '${u.role}')" title="Sửa thông tin">
                  Sửa
                </button>
                <button class="btn btn-sm btn-outline" onclick="App.openResetPasswordModal(${u.id}, '${encodeURIComponent(u.username)}')" title="Đặt lại mật khẩu">
                  Đổi MK
                </button>
                ${!isCurrent ? `
                  <button class="btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-outline'}" onclick="App.toggleLockUser(${u.id}, ${u.is_active}, '${encodeURIComponent(u.username)}')" title="${u.is_active ? 'Khóa tài khoản' : 'Mở khóa'}">
                    ${u.is_active ? 'Khóa' : 'Mở'}
                  </button>
                  <button class="btn btn-sm btn-outline" onclick="App.revokeUserSessions(${u.id}, '${encodeURIComponent(u.username)}')" title="Thu hồi phiên đăng nhập">
                    Đăng xuất
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      App.toast('Không thể tải danh sách nhân viên: ' + err.message, 'error');
    }
  },

  openCreateUserModal() {
    const modal = document.getElementById('user-create-modal');
    if (!modal) return;
    document.getElementById('uc-username').value = '';
    document.getElementById('uc-fullname').value = '';
    document.getElementById('uc-password').value = '';
    document.getElementById('uc-role').value = 'cashier';
    modal.classList.add('active');
  },

  async saveNewUser(e) {
    e.preventDefault();
    const payload = {
      username: document.getElementById('uc-username').value.trim(),
      full_name: document.getElementById('uc-fullname').value.trim(),
      role: document.getElementById('uc-role').value,
      password: document.getElementById('uc-password').value
    };

    try {
      await API.createUser(payload);
      this.toast(`Tạo tài khoản "${payload.username}" thành công!`, 'success');
      document.getElementById('user-create-modal')?.classList.remove('active');
      this.renderUsersView();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  openEditUserModal(id, encodedUsername, encodedFullname, role) {
    const modal = document.getElementById('user-edit-modal');
    if (!modal) return;
    document.getElementById('ue-id').value = id;
    document.getElementById('ue-username').value = decodeURIComponent(encodedUsername);
    document.getElementById('ue-fullname').value = decodeURIComponent(encodedFullname);
    document.getElementById('ue-role').value = role;
    modal.classList.add('active');
  },

  async saveEditUser(e) {
    e.preventDefault();
    const id = document.getElementById('ue-id').value;
    const payload = {
      full_name: document.getElementById('ue-fullname').value.trim(),
      role: document.getElementById('ue-role').value
    };

    try {
      await API.updateUser(id, payload);
      this.toast('Cập nhật thông tin nhân viên thành công!', 'success');
      document.getElementById('user-edit-modal')?.classList.remove('active');
      this.renderUsersView();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  openResetPasswordModal(id, encodedUsername) {
    const modal = document.getElementById('user-password-modal');
    if (!modal) return;
    document.getElementById('rp-id').value = id;
    document.getElementById('rp-username').textContent = decodeURIComponent(encodedUsername);
    document.getElementById('rp-new-password').value = '';
    modal.classList.add('active');
  },

  async saveResetPassword(e) {
    e.preventDefault();
    const id = document.getElementById('rp-id').value;
    const new_password = document.getElementById('rp-new-password').value;

    try {
      await API.resetUserPassword(id, { new_password });
      this.toast('Đặt lại mật khẩu thành công! Các phiên cũ đã được thu hồi.', 'success');
      document.getElementById('user-password-modal')?.classList.remove('active');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async toggleLockUser(id, currentActive, encodedUsername) {
    const u = decodeURIComponent(encodedUsername);
    const actionName = currentActive ? 'KHÓA' : 'MỞ KHÓA';
    if (!confirm(`Bạn có chắc muốn ${actionName} tài khoản "${u}" không?`)) return;

    try {
      if (currentActive) {
        await API.lockUser(id);
        this.toast(`Đã khóa tài khoản "${u}". Mọi phiên đăng nhập của người này đã bị hủy.`, 'success');
      } else {
        await API.unlockUser(id);
        this.toast(`Đã mở khóa tài khoản "${u}".`, 'success');
      }
      this.renderUsersView();
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  async revokeUserSessions(id, encodedUsername) {
    const u = decodeURIComponent(encodedUsername);
    if (!confirm(`Bạn có chắc muốn thu hồi tất cả phiên đăng nhập của "${u}"? Người dùng này sẽ bị buộc đăng xuất ngay lập tức.`)) return;

    try {
      await API.revokeUserSessions(id);
      this.toast(`Đã thu hồi phiên của "${u}"!`, 'success');
    } catch (err) {
      this.toast(err.message, 'error');
    }
  },

  // ==========================================
  // AUDIT TRAIL & ACTIVITY LOG VIEW
  // ==========================================
  async renderAuditView(page = 1) {
    const container = document.getElementById('view-audit');
    if (!container) return;
    if (!this.hasPermission('audit:view')) {
      container.innerHTML = this.renderAccessDenied('audit:view');
      return;
    }

    this.auditPage = page;

    container.innerHTML = `
      <div class="table-toolbar">
        <div>
          <h3 style="font-size: 1.15rem; font-weight: 700; margin: 0;">Nhật Ký Hoạt Động & Truy Vết Kiểm Toán</h3>
          <div style="font-size: 0.8125rem; color: var(--color-text-secondary); margin-top: 2px;">
            Lưu vết tự động mọi giao dịch bán hàng, kho, quỹ, công nợ và quản trị (Không thể chỉnh sửa/xóa)
          </div>
        </div>
      </div>

      <!-- Filter Bar -->
      <div class="audit-filter-bar">
        <div style="flex: 1; min-width: 180px;">
          <input type="text" id="audit-filter-q" class="form-control" placeholder="Tìm mã chứng từ, người thực hiện...">
        </div>
        <div style="width: 160px;">
          <select id="audit-filter-action" class="form-control">
            <option value="">Tất cả nghiệp vụ</option>
            <option value="ORDER_CREATE">Bán hàng (POS)</option>
            <option value="PURCHASE_CREATE">Nhập hàng</option>
            <option value="RETURN_CREATE">Khách trả hàng</option>
            <option value="STOCK_ADJUST">Kiểm kho</option>
            <option value="CASH_RECEIPT">Thu tiền</option>
            <option value="CASH_PAYMENT">Chi tiền</option>
            <option value="DEBT_PAY_CUSTOMER">Thu nợ khách</option>
            <option value="DEBT_PAY_SUPPLIER">Trả nợ NCC</option>
            <option value="USER_LOGIN">Đăng nhập</option>
            <option value="USER_CREATE">Tạo nhân viên</option>
            <option value="USER_LOCK">Khóa nhân viên</option>
            <option value="SETTINGS_UPDATE">Cài đặt hệ thống</option>
          </select>
        </div>
        <div style="width: 150px;">
          <select id="audit-filter-entity" class="form-control">
            <option value="">Tất cả đối tượng</option>
            <option value="order">Hóa đơn bán (HD)</option>
            <option value="purchase">Phiếu nhập (PN)</option>
            <option value="return">Phiếu trả (TH)</option>
            <option value="product">Hàng hóa / Kho</option>
            <option value="cash_flow">Sổ quỹ</option>
            <option value="customer">Khách hàng</option>
            <option value="supplier">Nhà cung cấp</option>
            <option value="user">Người dùng</option>
          </select>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <input type="date" id="audit-filter-from" class="form-control" style="width: 135px;">
          <span>-</span>
          <input type="date" id="audit-filter-to" class="form-control" style="width: 135px;">
        </div>
        <button class="btn btn-primary" onclick="App.filterAuditLogs(1)">Lọc</button>
        <button class="btn btn-outline" onclick="App.resetAuditFilters()">Đặt lại</button>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 140px;">Thời gian</th>
              <th style="width: 140px;">Người thực hiện</th>
              <th style="width: 140px;">Hành động</th>
              <th style="width: 130px;">Chứng từ</th>
              <th>Chi tiết giao dịch</th>
              <th style="width: 110px;">Địa chỉ IP</th>
              <th class="text-right" style="width: 90px;">Timeline</th>
            </tr>
          </thead>
          <tbody id="audit-table-body">
            <tr><td colspan="7" class="text-center" style="padding: 30px;">Đang tải nhật ký kiểm toán...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="audit-pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 0.8125rem; color: var(--color-text-secondary);"></div>
    `;

    this.filterAuditLogs(page);
  },

  async filterAuditLogs(page = 1) {
    this.auditPage = page;
    const tbody = document.getElementById('audit-table-body');
    const pagination = document.getElementById('audit-pagination');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 30px;">Đang tải nhật ký kiểm toán...</td></tr>`;

    const q = document.getElementById('audit-filter-q')?.value.trim() || '';
    const action = document.getElementById('audit-filter-action')?.value || '';
    const entity_type = document.getElementById('audit-filter-entity')?.value || '';
    const date_from = document.getElementById('audit-filter-from')?.value || '';
    const date_to = document.getElementById('audit-filter-to')?.value || '';

    const limit = this.auditLimit || 25;
    const offset = (page - 1) * limit;

    const params = { limit, offset };
    if (q) params.q = q;
    if (action) params.action = action;
    if (entity_type) params.entity_type = entity_type;
    if (date_from) params.date_from = date_from;
    if (date_to) params.date_to = date_to;

    try {
      const res = await API.getAuditLogs(params);
      const items = res.items || [];
      const total = res.total || 0;

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 40px; color: var(--color-text-muted);">Không có bản ghi nhật ký phù hợp với bộ lọc</td></tr>`;
        if (pagination) pagination.innerHTML = `<div>Tổng cộng: <strong>0</strong> sự kiện</div>`;
        return;
      }

      tbody.innerHTML = items.map(l => {
        const actionInfo = this.formatAuditAction(l.action);
        let summary = '';
        if (l.details_parsed && typeof l.details_parsed === 'object') {
          summary = Object.entries(l.details_parsed).map(([k, v]) => `${this.formatDetailKey(k)}: <strong>${this.formatDetailVal(k, v)}</strong>`).join(' | ');
        } else {
          summary = l.details || '';
        }

        const hasTimeline = l.entity_code || (l.entity_type && l.entity_id);

        return `
          <tr>
            <td style="font-size: 0.8125rem; color: var(--color-text-secondary); white-space: nowrap;">${l.created_at}</td>
            <td><strong style="color: var(--color-primary);">${l.user_name}</strong></td>
            <td><span class="badge ${actionInfo.badgeClass}">${actionInfo.label}</span></td>
            <td>
              ${l.entity_code ? `<span class="badge badge-tag font-bold">${l.entity_code}</span>` : '-'}
            </td>
            <td style="font-size: 0.8125rem; line-height: 1.4;">${summary}</td>
            <td style="font-size: 0.75rem; color: var(--color-text-muted);">${l.ip_address || '-'}</td>
            <td class="text-right">
              ${hasTimeline ? `
                <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('${l.entity_type}', '${l.entity_code || l.entity_id}')" title="Xem chuỗi lịch sử">
                  Xem
                </button>
              ` : '-'}
            </td>
          </tr>
        `;
      }).join('');

      const totalPages = Math.ceil(total / limit) || 1;
      if (pagination) {
        pagination.innerHTML = `
          <div>Hiển thị ${offset + 1} - ${Math.min(offset + limit, total)} trên tổng <strong>${total}</strong> sự kiện</div>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-sm btn-outline" ${page <= 1 ? 'disabled' : ''} onclick="App.filterAuditLogs(${page - 1})">Trước</button>
            <span style="padding: 4px 8px; font-weight: 600;">Trang ${page} / ${totalPages}</span>
            <button class="btn btn-sm btn-outline" ${page >= totalPages ? 'disabled' : ''} onclick="App.filterAuditLogs(${page + 1})">Sau</button>
          </div>
        `;
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--color-danger); padding: 30px;">Lỗi tải nhật ký: ${err.message}</td></tr>`;
    }
  },

  resetAuditFilters() {
    const q = document.getElementById('audit-filter-q');
    const act = document.getElementById('audit-filter-action');
    const ent = document.getElementById('audit-filter-entity');
    const from = document.getElementById('audit-filter-from');
    const to = document.getElementById('audit-filter-to');
    if (q) q.value = '';
    if (act) act.value = '';
    if (ent) ent.value = '';
    if (from) from.value = '';
    if (to) to.value = '';
    this.filterAuditLogs(1);
  },

  async viewEntityTimeline(entityType, identifier) {
    const modal = document.getElementById('timeline-modal');
    const titleElem = document.getElementById('timeline-title');
    const subElem = document.getElementById('timeline-subtitle');
    const container = document.getElementById('timeline-events-container');

    if (!modal || !container) return;

    titleElem.textContent = `Lịch sử nghiệp vụ: ${identifier}`;
    subElem.textContent = `Dòng sự kiện truy vết kiểm toán của đối tượng [${entityType.toUpperCase()}]`;
    container.innerHTML = '<div style="text-align: center; padding: 30px;">Đang tải dữ liệu timeline...</div>';
    modal.classList.add('active');

    try {
      const res = await API.getTimeline(entityType, identifier);
      const events = res.timeline || [];

      if (events.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 40px 10px;">
            <div style="font-weight: 600; margin-bottom: 4px;">Chưa có bản ghi kiểm toán nào cho chứng từ này</div>
            <div style="font-size: 0.8125rem; color: var(--color-text-muted);">Chứng từ có thể được tạo từ dữ liệu khởi tạo ban đầu</div>
          </div>
        `;
        return;
      }

      container.innerHTML = events.map(ev => {
        const actionInfo = this.formatAuditAction(ev.action);
        let detailsHtml = '';
        if (ev.details_parsed && typeof ev.details_parsed === 'object') {
          const rows = Object.entries(ev.details_parsed).map(([k, v]) => {
            return `<div><strong>${this.formatDetailKey(k)}:</strong> ${this.formatDetailVal(k, v)}</div>`;
          }).join('');
          detailsHtml = `<div class="timeline-body">${rows}</div>`;
        } else if (ev.details) {
          detailsHtml = `<div class="timeline-body">${ev.details}</div>`;
        }

        return `
          <div class="timeline-item">
            <div class="timeline-marker ${actionInfo.markerClass}">
              <div class="timeline-dot-inner"></div>
            </div>
            <div class="timeline-header">
              <div class="timeline-title">
                <span class="badge ${actionInfo.badgeClass}">${actionInfo.label}</span>
                ${ev.entity_code ? `<span style="font-weight: 700; color: var(--color-primary);">${ev.entity_code}</span>` : ''}
              </div>
              <div class="timeline-time">${ev.created_at}</div>
            </div>
            <div style="font-size: 0.8125rem; margin-bottom: 6px; color: var(--color-text-secondary);">
              Người thực hiện: <span class="timeline-actor">${ev.user_name}</span> ${ev.ip_address ? `(IP: ${ev.ip_address})` : ''}
            </div>
            ${detailsHtml}
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<div style="color: var(--color-danger); padding: 20px;">Lỗi tải timeline: ${err.message}</div>`;
    }
  },

  formatAuditAction(action) {
    const map = {
      'ORDER_CREATE': { label: 'Tạo đơn bán (POS)', badgeClass: 'badge-green', markerClass: 'marker-success' },
      'ORDER_RETURN_PROCESSED': { label: 'Xử lý trả hàng', badgeClass: 'badge-amber', markerClass: 'marker-warning' },
      'PURCHASE_CREATE': { label: 'Tạo phiếu nhập hàng', badgeClass: 'badge-blue', markerClass: 'marker-info' },
      'RETURN_CREATE': { label: 'Khách đổi trả hàng', badgeClass: 'badge-amber', markerClass: 'marker-warning' },
      'STOCK_ADJUST': { label: 'Kiểm kho / Điều chỉnh', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'CASH_RECEIPT': { label: 'Lập phiếu thu tiền', badgeClass: 'badge-green', markerClass: 'marker-success' },
      'CASH_PAYMENT': { label: 'Lập phiếu chi tiền', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'DEBT_PAY_CUSTOMER': { label: 'Thu nợ khách hàng', badgeClass: 'badge-green', markerClass: 'marker-success' },
      'DEBT_PAY_SUPPLIER': { label: 'Thanh toán nợ NCC', badgeClass: 'badge-amber', markerClass: 'marker-warning' },
      'PRODUCT_CREATE': { label: 'Tạo hàng hóa', badgeClass: 'badge-blue', markerClass: 'marker-info' },
      'PRODUCT_UPDATE': { label: 'Cập nhật hàng hóa', badgeClass: 'badge-tag', markerClass: 'marker-info' },
      'PRODUCT_DELETE': { label: 'Xóa hàng hóa', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'CUSTOMER_CREATE': { label: 'Thêm khách hàng', badgeClass: 'badge-blue', markerClass: 'marker-info' },
      'CUSTOMER_UPDATE': { label: 'Cập nhật khách hàng', badgeClass: 'badge-tag', markerClass: 'marker-info' },
      'CUSTOMER_DELETE': { label: 'Xóa khách hàng', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'CUSTOMER_PRICE_SET': { label: 'Cài giá riêng', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'SUPPLIER_CREATE': { label: 'Thêm nhà cung cấp', badgeClass: 'badge-blue', markerClass: 'marker-info' },
      'SUPPLIER_UPDATE': { label: 'Cập nhật nhà cung cấp', badgeClass: 'badge-tag', markerClass: 'marker-info' },
      'SUPPLIER_DELETE': { label: 'Xóa nhà cung cấp', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'SETTINGS_UPDATE': { label: 'Cập nhật cài đặt', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'BACKUP_DOWNLOAD': { label: 'Tải bản sao lưu', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'BOOTSTRAP_INITIAL_ADMIN': { label: 'Khởi tạo Quản trị viên', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'USER_LOGIN': { label: 'Đăng nhập thành công', badgeClass: 'badge-green', markerClass: 'marker-success' },
      'USER_LOGIN_FAILED': { label: 'Đăng nhập thất bại', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'USER_LOGOUT': { label: 'Đăng xuất', badgeClass: 'badge-tag', markerClass: 'marker-info' },
      'USER_CREATE': { label: 'Tạo tài khoản nhân viên', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'USER_UPDATE': { label: 'Sửa tài khoản', badgeClass: 'badge-tag', markerClass: 'marker-info' },
      'USER_LOCK': { label: 'Khóa tài khoản', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'USER_UNLOCK': { label: 'Mở khóa tài khoản', badgeClass: 'badge-green', markerClass: 'marker-success' },
      'USER_RESET_PASSWORD': { label: 'Đặt lại mật khẩu', badgeClass: 'badge-amber', markerClass: 'marker-warning' },
      'USER_PASSWORD_CHANGE': { label: 'Đổi mật khẩu', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'USER_REVOKE_SESSIONS': { label: 'Thu hồi phiên đăng nhập', badgeClass: 'badge-amber', markerClass: 'marker-warning' },
      'ORDER_CANCEL': { label: 'Hủy đơn hàng', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'ORDER_COMPLETE': { label: 'Hoàn tất đơn hàng', badgeClass: 'badge-green', markerClass: 'marker-success' },
      'ORDER_DUPLICATE': { label: 'Nhân bản đơn hàng', badgeClass: 'badge-blue', markerClass: 'marker-info' },
      'ORDER_UPDATE': { label: 'Cập nhật đơn hàng', badgeClass: 'badge-tag', markerClass: 'marker-info' },
      'PRODUCT_UNIT_CREATE': { label: 'Thêm đơn vị quy đổi', badgeClass: 'badge-blue', markerClass: 'marker-info' },
      'PRODUCT_UNIT_UPDATE': { label: 'Sửa đơn vị quy đổi', badgeClass: 'badge-tag', markerClass: 'marker-info' },
      'PRODUCT_UNIT_DELETE': { label: 'Xóa đơn vị quy đổi', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'PROMOTION_CREATE': { label: 'Tạo khuyến mãi', badgeClass: 'badge-purple', markerClass: 'marker-purple' },
      'PROMOTION_UPDATE': { label: 'Sửa khuyến mãi', badgeClass: 'badge-tag', markerClass: 'marker-purple' },
      'PROMOTION_DELETE': { label: 'Xóa khuyến mãi', badgeClass: 'badge-red', markerClass: 'marker-danger' },
      'EXCEL_EXPORT': { label: 'Xuất file Excel', badgeClass: 'badge-tag', markerClass: 'marker-info' }
    };
    return map[action] || { label: action, badgeClass: 'badge-tag', markerClass: 'marker-info' };
  },

  formatDetailKey(key) {
    const map = {
      'customer_name': 'Khách hàng',
      'supplier_name': 'Nhà cung cấp',
      'items_count': 'Số lượng mặt hàng',
      'total_amount': 'Tổng tiền hàng',
      'discount': 'Chiết khấu',
      'vat_amount': 'Thuế VAT',
      'final_amount': 'Khách cần trả',
      'actual_paid': 'Tiền thực thu',
      'change_amount': 'Tiền thừa',
      'debt_amount': 'Ghi nợ',
      'payment_method': 'Hình thức thanh toán',
      'refund_amount': 'Tiền hoàn lại',
      'debt_deduct_amount': 'Cấn trừ nợ',
      'order_code': 'Mã hóa đơn gốc',
      'return_code': 'Mã phiếu trả',
      'reason': 'Lý do',
      'diff': 'Chênh lệch tồn',
      'old_stock': 'Tồn trước kiểm',
      'new_stock': 'Tồn sau kiểm',
      'amount': 'Số tiền',
      'category': 'Hạng mục',
      'fund_type': 'Quỹ tiền',
      'receipt_code': 'Mã phiếu thu',
      'payment_code': 'Mã phiếu chi',
      'message': 'Thông tin',
      'username': 'Tên đăng nhập',
      'full_name': 'Họ và tên',
      'role': 'Vai trò',
      'unit_name': 'Đơn vị tính',
      'conversion_rate': 'Tỷ lệ quy đổi',
      'promo_code': 'Mã khuyến mãi',
      'discount_value': 'Giá trị giảm',
      'cancel_reason': 'Lý do hủy đơn',
      'stock_breakdown': 'Quy đổi tồn'
    };
    return map[key] || key;
  },

  formatDetailVal(key, val) {
    if (typeof val === 'number') {
      if (key.includes('amount') || key.includes('paid') || key.includes('discount') || key.includes('vat') || key.includes('total') || key.includes('debt')) {
        return this.formatMoney(val);
      }
      return val.toLocaleString('vi-VN');
    }
    if (key === 'role') return this.getRoleName(val);
    if (key === 'payment_method') {
      const pm = { 'cash': 'Tiền mặt', 'bank': 'Chuyển khoản', 'debt': 'Ghi nợ' };
      return pm[val] || val;
    }
    return val;
  },

  // ==========================================
  // COLUMN SELECTOR & LOCAL STORAGE PERSISTENCE
  // ==========================================
  COLUMN_DEFS: {
    'orders': [
      { key: 'code', label: 'Mã đơn hàng' },
      { key: 'created_at', label: 'Thời gian' },
      { key: 'customer_name', label: 'Khách hàng' },
      { key: 'status', label: 'Trạng thái' },
      { key: 'items_summary', label: 'Mặt hàng' },
      { key: 'total_amount', label: 'Tổng tiền' },
      { key: 'discount', label: 'Giảm giá / KM' },
      { key: 'final_amount', label: 'Khách cần trả' },
      { key: 'actual_paid', label: 'Đã thanh toán' },
      { key: 'debt_amount', label: 'Ghi nợ' },
      { key: 'payment_method', label: 'Hình thức TT' },
      { key: 'notes', label: 'Ghi chú' }
    ],
    'products': [
      { key: 'code', label: 'Mã SP / SKU' },
      { key: 'barcode', label: 'Mã vạch' },
      { key: 'name', label: 'Tên hàng hóa' },
      { key: 'category', label: 'Danh mục' },
      { key: 'unit', label: 'Đơn vị tính' },
      { key: 'stock', label: 'Tồn kho' },
      { key: 'cost_price', label: 'Giá vốn (MAC)' },
      { key: 'sale_price', label: 'Giá bán' }
    ],
    'customers': [
      { key: 'code', label: 'Mã KH' },
      { key: 'name', label: 'Tên khách hàng' },
      { key: 'phone', label: 'Số điện thoại' },
      { key: 'group_name', label: 'Nhóm khách' },
      { key: 'total_spent', label: 'Tổng chi tiêu' },
      { key: 'debt', label: 'Công nợ hiện tại' },
      { key: 'address', label: 'Địa chỉ' }
    ],
    'suppliers': [
      { key: 'code', label: 'Mã NCC' },
      { key: 'name', label: 'Tên nhà cung cấp' },
      { key: 'phone', label: 'Số điện thoại' },
      { key: 'debt', label: 'Công nợ cần trả' },
      { key: 'address', label: 'Địa chỉ' }
    ],
    'purchases': [
      { key: 'code', label: 'Mã phiếu nhập' },
      { key: 'created_at', label: 'Ngày nhập' },
      { key: 'supplier_name', label: 'Nhà cung cấp' },
      { key: 'total_amount', label: 'Tổng tiền' },
      { key: 'paid_amount', label: 'Đã trả' },
      { key: 'debt_amount', label: 'Còn nợ' },
      { key: 'status', label: 'Trạng thái' }
    ],
    'returns': [
      { key: 'code', label: 'Mã phiếu trả' },
      { key: 'created_at', label: 'Ngày trả' },
      { key: 'order_code', label: 'Hóa đơn gốc' },
      { key: 'customer_name', label: 'Khách hàng' },
      { key: 'total_refund', label: 'Tổng tiền trả' },
      { key: 'reason', label: 'Lý do' }
    ],
    'cash-flow': [
      { key: 'code', label: 'Mã phiếu' },
      { key: 'created_at', label: 'Thời gian' },
      { key: 'type', label: 'Loại phiếu (Thu/Chi)' },
      { key: 'category', label: 'Hạng mục' },
      { key: 'amount', label: 'Số tiền' },
      { key: 'fund_type', label: 'Hình thức quỹ' },
      { key: 'notes', label: 'Diễn giải' }
    ]
  },

  getSavedColumns(viewName) {
    try {
      const saved = localStorage.getItem('kiotpro_cols_' + viewName);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }
    } catch (e) {}
    const defs = this.COLUMN_DEFS[viewName];
    return defs ? defs.map(d => d.key) : [];
  },

  openColumnSelector(viewName) {
    this.currentColumnSelectorView = viewName;
    const defs = this.COLUMN_DEFS[viewName] || [];
    const saved = this.getSavedColumns(viewName);
    const container = document.getElementById('cs-checkboxes-container');
    const title = document.getElementById('cs-title');
    if (!container) return;

    if (title) title.textContent = `Tùy chỉnh cột: ${viewName}`;

    container.innerHTML = defs.map(col => `
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--color-border); background: var(--color-bg-alt);">
        <input type="checkbox" value="${col.key}" ${saved.includes(col.key) ? 'checked' : ''} class="cs-col-chk">
        <span style="font-weight: 500; font-size: 0.84rem;">${col.label}</span>
      </label>
    `).join('');

    const modal = document.getElementById('modal-column-selector');
    if (modal) modal.classList.add('active');
  },

  selectAllColumns(checked) {
    document.querySelectorAll('.cs-col-chk').forEach(chk => chk.checked = checked);
  },

  saveColumnSelection() {
    if (!this.currentColumnSelectorView) return;
    const chks = document.querySelectorAll('.cs-col-chk:checked');
    const keys = Array.from(chks).map(c => c.value);
    if (keys.length === 0) {
      this.toast('Vui lòng chọn ít nhất 1 cột hiển thị', 'warning');
      return;
    }
    localStorage.setItem('kiotpro_cols_' + this.currentColumnSelectorView, JSON.stringify(keys));
    const modal = document.getElementById('modal-column-selector');
    if (modal) modal.classList.remove('active');
    this.toast('Đã lưu cấu hình cột hiển thị!', 'success');
    this.refreshCurrentView();
  },

  // ==========================================
  // EXCEL EXPORT DISPATCHER
  // ==========================================
  exportExcel(entity) {
    const params = {};
    if (entity === 'orders') {
      const q = document.getElementById('order-filter-q')?.value;
      const status = document.getElementById('order-filter-status')?.value;
      const payment = document.getElementById('order-filter-payment')?.value;
      const from = document.getElementById('order-filter-from')?.value;
      const to = document.getElementById('order-filter-to')?.value;
      if (q) params.q = q;
      if (status) params.status = status;
      if (payment) params.payment_method = payment;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
    } else if (entity === 'products') {
      const q = document.getElementById('prod-search-input')?.value;
      const cat = document.getElementById('prod-cat-filter')?.value;
      const lowStock = document.getElementById('prod-low-stock-filter')?.checked;
      if (q) params.q = q;
      if (cat) params.category = cat;
      if (lowStock) params.low_stock = '1';
    } else if (entity === 'customers') {
      const q = document.getElementById('cust-search-input')?.value;
      if (q) params.q = q;
    } else if (entity === 'suppliers') {
      const q = document.getElementById('supp-search-input')?.value;
      if (q) params.q = q;
    } else if (entity === 'purchases') {
      const supp = document.getElementById('purchase-supplier-filter')?.value;
      const from = document.getElementById('purchase-filter-from')?.value;
      const to = document.getElementById('purchase-filter-to')?.value;
      if (supp) params.supplier_id = supp;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
    } else if (entity === 'returns') {
      const from = document.getElementById('return-filter-from')?.value;
      const to = document.getElementById('return-filter-to')?.value;
      if (from) params.date_from = from;
      if (to) params.date_to = to;
    } else if (entity === 'cash-flow') {
      const type = document.getElementById('cf-type-filter')?.value;
      const from = document.getElementById('cf-filter-from')?.value;
      const to = document.getElementById('cf-filter-to')?.value;
      if (type && type !== 'all') params.type = type === 'receipt' ? 'in' : 'out';
      if (from) params.date_from = from;
      if (to) params.date_to = to;
    }

    const savedCols = this.getSavedColumns(entity);
    if (savedCols && savedCols.length > 0) {
      params.columns = savedCols.join(',');
    }

    this.toast(`Đang tạo và tải tệp Excel ${entity}.xlsx...`, 'info');
    API.downloadExport(entity, params);
  },

  // ==========================================
  // ORDERS MANAGEMENT VIEW
  // ==========================================
  async renderOrdersView() {
    const container = document.getElementById('view-orders');
    if (!container) return;

    container.innerHTML = `
      <div id="orders-summary-cards" class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 16px;">
        <!-- Summary cards populated dynamically -->
      </div>

      <div class="card">
        <div class="card-header" style="flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; gap: 8px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="order-filter-q" class="form-control" style="max-width: 240px;" placeholder="Tìm theo mã đơn, khách, SĐT...">
            <select id="order-filter-status" class="form-control" style="max-width: 150px;">
              <option value="">Tất cả trạng thái</option>
              <option value="completed">Đã hoàn tất</option>
              <option value="pending">Đang chờ</option>
              <option value="cancelled">Đã hủy</option>
            </select>
            <select id="order-filter-payment" class="form-control" style="max-width: 150px;">
              <option value="">Tất cả hình thức</option>
              <option value="cash">Tiền mặt</option>
              <option value="bank">Chuyển khoản</option>
              <option value="debt">Ghi nợ</option>
            </select>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="date" id="order-filter-from" class="form-control" style="max-width: 135px;" title="Từ ngày">
              <span>-</span>
              <input type="date" id="order-filter-to" class="form-control" style="max-width: 135px;" title="Đến ngày">
            </div>
            <button class="btn btn-primary btn-sm" onclick="App.filterOrders(1)">Lọc</button>
            <button class="btn btn-outline btn-sm" onclick="App.resetOrderFilters()">Đặt lại</button>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-sm" onclick="App.openColumnSelector('orders')">Chọn cột</button>
            <button class="btn btn-outline btn-sm" onclick="App.exportExcel('orders')">Xuất Excel</button>
            <button class="btn btn-primary btn-sm" onclick="App.navigate('pos')">+ Bán hàng (POS)</button>
          </div>
        </div>

        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead id="orders-table-head">
                <!-- Dynamically configured headers -->
              </thead>
              <tbody id="orders-table-body">
                <tr><td colspan="10" class="empty-state">Đang tải danh sách đơn bán hàng...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card-footer" id="orders-pagination" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; font-size: 0.8125rem;">
          <!-- Pagination populated dynamically -->
        </div>
      </div>
    `;

    document.getElementById('order-filter-q')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.filterOrders(1);
    });

    this.filterOrders(1);
  },

  async filterOrders(page = 1) {
    this.ordersPage = page;
    const tbody = document.getElementById('orders-table-body');
    const thead = document.getElementById('orders-table-head');
    const summaryContainer = document.getElementById('orders-summary-cards');
    const pagination = document.getElementById('orders-pagination');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Đang tải dữ liệu...</td></tr>`;

    const q = document.getElementById('order-filter-q')?.value.trim() || '';
    const status = document.getElementById('order-filter-status')?.value || '';
    const payment = document.getElementById('order-filter-payment')?.value || '';
    const date_from = document.getElementById('order-filter-from')?.value || '';
    const date_to = document.getElementById('order-filter-to')?.value || '';

    const limit = this.ordersLimit || 15;
    const offset = (page - 1) * limit;

    const params = { limit, offset };
    if (q) params.q = q;
    if (status) params.status = status;
    if (payment) params.payment_method = payment;
    if (date_from) params.date_from = date_from;
    if (date_to) params.date_to = date_to;

    try {
      const res = await API.getOrders(params);
      const items = res.items || [];
      const total = res.total || 0;
      const summary = res.summary || {};

      // Render summary cards
      if (summaryContainer && summary.total_count !== undefined) {
        summaryContainer.innerHTML = `
          <div class="stat-card">
            <div class="stat-title">Tổng đơn hàng</div>
            <div class="stat-value">${summary.total_count.toLocaleString('vi-VN')}</div>
            <div class="stat-sub">Tất cả giao dịch</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Đã hoàn tất</div>
            <div class="stat-value text-success">${summary.completed_count || 0}</div>
            <div class="stat-sub">Doanh thu: <strong>${this.formatMoney(summary.completed_revenue || 0)}</strong></div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Đơn đang chờ</div>
            <div class="stat-value text-amber">${summary.pending_count || 0}</div>
            <div class="stat-sub">Tổng tiền: <strong>${this.formatMoney(summary.pending_amount || 0)}</strong></div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Đã hủy</div>
            <div class="stat-value text-danger">${summary.cancelled_count || 0}</div>
            <div class="stat-sub">Đã hoàn trả kho/quỹ</div>
          </div>
        `;
      }

      // Configure table headers
      const visibleCols = this.getSavedColumns('orders');
      const allCols = this.COLUMN_DEFS['orders'];
      if (thead) {
        thead.innerHTML = `
          <tr>
            ${allCols.filter(c => visibleCols.includes(c.key)).map(c => `<th>${c.label}</th>`).join('')}
            <th class="text-right" style="min-width: 140px;">Thao tác</th>
          </tr>
        `;
      }

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${visibleCols.length + 1}" class="empty-state">Không tìm thấy đơn hàng nào phù hợp với bộ lọc</td></tr>`;
        if (pagination) pagination.innerHTML = `<div>Tổng cộng: <strong>0</strong> đơn hàng</div>`;
        return;
      }

      tbody.innerHTML = items.map(o => {
        let statusBadge = '';
        if (o.status === 'completed') {
          statusBadge = '<span class="order-badge-completed">Hoàn tất</span>';
        } else if (o.status === 'pending') {
          statusBadge = '<span class="order-badge-pending">Đang chờ</span>';
        } else if (o.status === 'cancelled') {
          statusBadge = '<span class="order-badge-cancelled">Đã hủy</span>';
        } else {
          statusBadge = `<span class="badge-tag">${o.status}</span>`;
        }

        const pmText = { 'cash': 'Tiền mặt', 'bank': 'Chuyển khoản', 'debt': 'Ghi nợ' }[o.payment_method] || o.payment_method;

        const cells = [];
        if (visibleCols.includes('code')) {
          cells.push(`<td><strong style="color: var(--color-primary); cursor: pointer;" onclick="App.renderOrderDetail(${o.id})">${o.code}</strong></td>`);
        }
        if (visibleCols.includes('created_at')) {
          cells.push(`<td style="font-size: 0.8125rem; white-space: nowrap; color: var(--color-text-secondary);">${o.created_at}</td>`);
        }
        if (visibleCols.includes('customer_name')) {
          cells.push(`<td><strong>${o.customer_name || 'Khách lẻ'}</strong>${o.customer_phone ? `<br><small style="color: var(--color-text-muted);">${o.customer_phone}</small>` : ''}</td>`);
        }
        if (visibleCols.includes('status')) {
          cells.push(`<td>${statusBadge}</td>`);
        }
        if (visibleCols.includes('items_summary')) {
          const summaryStr = o.items ? o.items.map(it => `${it.product_name} (${it.quantity} ${it.unit_name || ''})`).join(', ') : '---';
          cells.push(`<td style="font-size: 0.8125rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${summaryStr}">${summaryStr}</td>`);
        }
        if (visibleCols.includes('total_amount')) {
          cells.push(`<td class="text-right tabular-nums">${this.formatMoney(o.total_amount)}</td>`);
        }
        if (visibleCols.includes('discount')) {
          cells.push(`<td class="text-right tabular-nums text-amber">${this.formatMoney(o.discount)}</td>`);
        }
        if (visibleCols.includes('final_amount')) {
          cells.push(`<td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(o.final_amount)}</td>`);
        }
        if (visibleCols.includes('actual_paid')) {
          cells.push(`<td class="text-right tabular-nums">${this.formatMoney(o.actual_paid)}</td>`);
        }
        if (visibleCols.includes('debt_amount')) {
          cells.push(`<td class="text-right tabular-nums" style="color: ${o.debt_amount > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)'}; font-weight: ${o.debt_amount > 0 ? '700' : 'normal'};">${this.formatMoney(o.debt_amount)}</td>`);
        }
        if (visibleCols.includes('payment_method')) {
          cells.push(`<td><span class="badge-tag">${pmText}</span></td>`);
        }
        if (visibleCols.includes('notes')) {
          cells.push(`<td style="font-size: 0.8125rem; color: var(--color-text-muted); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${o.notes || ''}">${o.notes || '---'}</td>`);
        }

        const canCancel = o.status !== 'cancelled' && this.hasPermission('orders:cancel');
        const isPending = o.status === 'pending';

        const actionBtns = `
          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            <button class="btn btn-sm btn-outline" onclick="App.renderOrderDetail(${o.id})" title="Xem chi tiết">Chi tiết</button>
            <button class="btn btn-sm btn-outline" onclick="App.duplicateOrderToPos(${o.id})" title="Nhân bản / Tải vào POS">Nhân bản</button>
            ${isPending ? `<button class="btn btn-sm btn-success" onclick="App.promptCompleteOrder(${o.id})" title="Hoàn tất đơn hàng">Hoàn tất</button>` : ''}
            ${canCancel ? `<button class="btn btn-sm btn-danger" onclick="App.openCancelOrderModal(${o.id}, '${o.code}')" title="Hủy đơn hàng">Hủy</button>` : ''}
          </div>
        `;

        return `<tr>${cells.join('')}<td class="text-right">${actionBtns}</td></tr>`;
      }).join('');

      // Render pagination
      const totalPages = Math.ceil(total / limit) || 1;
      if (pagination) {
        pagination.innerHTML = `
          <div>Hiển thị ${offset + 1} - ${Math.min(offset + limit, total)} trên tổng <strong>${total}</strong> đơn hàng</div>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-sm btn-outline" ${page <= 1 ? 'disabled' : ''} onclick="App.filterOrders(${page - 1})">Trước</button>
            <span style="padding: 4px 8px; font-weight: 600;">Trang ${page} / ${totalPages}</span>
            <button class="btn btn-sm btn-outline" ${page >= totalPages ? 'disabled' : ''} onclick="App.filterOrders(${page + 1})">Sau</button>
          </div>
        `;
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state text-danger">Lỗi tải danh sách hóa đơn: ${err.message}</td></tr>`;
    }
  },

  resetOrderFilters() {
    const q = document.getElementById('order-filter-q');
    const status = document.getElementById('order-filter-status');
    const payment = document.getElementById('order-filter-payment');
    const from = document.getElementById('order-filter-from');
    const to = document.getElementById('order-filter-to');
    if (q) q.value = '';
    if (status) status.value = '';
    if (payment) payment.value = '';
    if (from) from.value = '';
    if (to) to.value = '';
    this.filterOrders(1);
  },

  async renderOrderDetail(orderId) {
    const modal = document.getElementById('modal-order-detail');
    const title = document.getElementById('od-title');
    const subtitle = document.getElementById('od-subtitle');
    const body = document.getElementById('od-body-content');
    const footer = document.getElementById('od-footer-actions');
    if (!modal || !body) return;

    modal.classList.add('active');
    body.innerHTML = '<div style="text-align: center; padding: 40px;">Đang tải chi tiết đơn hàng...</div>';

    try {
      const order = await API.getOrder(orderId);
      if (!order) {
        body.innerHTML = '<div class="text-danger">Không tìm thấy đơn hàng.</div>';
        return;
      }

      let statusBadge = '';
      if (order.status === 'completed') {
        statusBadge = '<span class="order-badge-completed">Đã hoàn tất</span>';
      } else if (order.status === 'pending') {
        statusBadge = '<span class="order-badge-pending">Đơn hàng đang chờ</span>';
      } else if (order.status === 'cancelled') {
        statusBadge = '<span class="order-badge-cancelled">Đã hủy</span>';
      }

      if (title) title.innerHTML = `Chi tiết hóa đơn: <strong style="color: var(--color-primary);">${order.code}</strong> ${statusBadge}`;
      if (subtitle) subtitle.textContent = `Ngày tạo: ${order.created_at} | Nhân viên: ${order.user_name || 'Hệ thống'}`;

      const pmMap = { 'cash': 'Tiền mặt', 'bank': 'Chuyển khoản', 'debt': 'Ghi nợ' };
      const pmLabel = pmMap[order.payment_method] || order.payment_method;

      const itemsHtml = (order.items || []).map((it, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>
            <strong>${it.product_name}</strong>
            ${it.conversion_rate && it.conversion_rate > 1 ? `<br><small style="color: var(--color-text-muted);">Quy đổi: 1 ${it.unit_name} = ${it.conversion_rate} đv cơ sở</small>` : ''}
          </td>
          <td><span class="unit-tag-pill">${it.unit_name || 'Cái'}</span></td>
          <td class="text-right font-bold">${it.quantity}</td>
          <td class="text-right tabular-nums">${this.formatMoney(it.unit_price)}</td>
          <td class="text-right tabular-nums font-bold">${this.formatMoney(it.total_price)}</td>
        </tr>
      `).join('');

      body.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; background: var(--color-bg-alt); padding: 12px 16px; border-radius: 6px; font-size: 0.84rem;">
          <div>
            <div><strong>Khách hàng:</strong> ${order.customer_name || 'Khách lẻ'}</div>
            <div><strong>Số điện thoại:</strong> ${order.customer_phone || '---'}</div>
            <div><strong>Địa chỉ:</strong> ${order.customer_address || '---'}</div>
          </div>
          <div>
            <div><strong>Hình thức thanh toán:</strong> <span class="badge-tag">${pmLabel}</span></div>
            <div><strong>Trạng thái:</strong> ${statusBadge}</div>
            <div><strong>Ghi chú:</strong> <em style="color: var(--color-text-secondary);">${order.notes || 'Không có ghi chú'}</em></div>
          </div>
        </div>

        ${order.status === 'cancelled' ? `
          <div class="alert alert-warning" style="margin-bottom: 16px; font-size: 0.84rem;">
            <strong>Đơn hàng đã bị hủy</strong> lúc <em>${order.cancelled_at || ''}</em>.<br>
            <strong>Lý do:</strong> ${order.cancel_reason || 'Không rõ lý do'}.<br>
            Toàn bộ tồn kho, quỹ tiền và công nợ liên quan đã được tự động hoàn trả an toàn.
          </div>
        ` : ''}

        ${order.status === 'pending' ? `
          <div class="alert alert-info" style="margin-bottom: 16px; font-size: 0.84rem;">
            <strong>Đơn hàng đang chờ xử lý.</strong> Tồn kho chưa bị trừ và doanh thu/công nợ chưa được ghi nhận vào sổ sách chính thức.
          </div>
        ` : ''}

        <div class="table-responsive" style="margin-bottom: 16px;">
          <table class="table" style="font-size: 0.84rem;">
            <thead>
              <tr>
                <th style="width: 40px;">STT</th>
                <th>Sản phẩm / Hàng hóa</th>
                <th>Đơn vị tính</th>
                <th class="text-right">Số lượng</th>
                <th class="text-right">Đơn giá</th>
                <th class="text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <div style="min-width: 280px; font-size: 0.875rem; line-height: 1.8;">
            <div style="display: flex; justify-content: space-between;">
              <span>Tổng tiền hàng:</span>
              <span class="tabular-nums font-bold">${this.formatMoney(order.total_amount)}</span>
            </div>
            ${order.discount > 0 ? `
              <div style="display: flex; justify-content: space-between; color: var(--color-warning-text);">
                <span>Giảm giá / Khuyến mãi ${order.promotion_code ? `(${order.promotion_code})` : ''}:</span>
                <span class="tabular-nums font-bold">-${this.formatMoney(order.discount)}</span>
              </div>
            ` : ''}
            ${order.vat_amount > 0 ? `
              <div style="display: flex; justify-content: space-between;">
                <span>Thuế VAT:</span>
                <span class="tabular-nums">${this.formatMoney(order.vat_amount)}</span>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; border-top: 1px dashed var(--color-border); padding-top: 4px; font-size: 1rem; color: var(--color-primary);">
              <strong>Khách cần trả:</strong>
              <strong class="tabular-nums">${this.formatMoney(order.final_amount)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Khách đã trả:</span>
              <span class="tabular-nums font-bold">${this.formatMoney(order.actual_paid)}</span>
            </div>
            ${order.change_amount > 0 ? `
              <div style="display: flex; justify-content: space-between; color: var(--color-success-text);">
                <span>Tiền thừa trả khách:</span>
                <span class="tabular-nums">${this.formatMoney(order.change_amount)}</span>
              </div>
            ` : ''}
            ${order.debt_amount > 0 ? `
              <div style="display: flex; justify-content: space-between; color: var(--color-danger-text);">
                <strong>Ghi nợ đơn hàng:</strong>
                <strong class="tabular-nums">${this.formatMoney(order.debt_amount)}</strong>
              </div>
            ` : ''}
          </div>
        </div>
      `;

      if (footer) {
        footer.innerHTML = `
          <div style="display: flex; gap: 8px; justify-content: space-between; width: 100%;">
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-outline" onclick="App.viewEntityTimeline('order', '${order.code}')">Xem Timeline</button>
              <button class="btn btn-outline" onclick="App.duplicateOrderToPos(${order.id})">Nhân bản đơn</button>
              <button class="btn btn-outline" onclick="POS.reprintReceipt(${JSON.stringify(order).replace(/"/g, '&quot;')})">In hóa đơn</button>
            </div>
            <div style="display: flex; gap: 8px;">
              ${isPending ? `<button class="btn btn-success" onclick="App.promptCompleteOrder(${order.id})">Hoàn tất đơn hàng</button>` : ''}
              ${canCancel ? `<button class="btn btn-danger" onclick="App.openCancelOrderModal(${order.id}, '${order.code}')">Hủy đơn</button>` : ''}
              <button class="btn btn-outline" data-close-modal="modal-order-detail">Đóng</button>
            </div>
          </div>
        `;
      }
    } catch (err) {
      body.innerHTML = `<div class="text-danger">Lỗi tải chi tiết đơn hàng: ${err.message}</div>`;
    }
  },

  openCancelOrderModal(orderId, orderCode) {
    document.getElementById('cancel-order-code').textContent = orderCode;
    document.getElementById('cancel-order-code').dataset.orderId = orderId;
    const reasonElem = document.getElementById('cancel-order-reason');
    if (reasonElem) reasonElem.value = '';
    const modal = document.getElementById('modal-order-cancel');
    if (modal) modal.classList.add('active');
  },

  async confirmCancelOrder() {
    const codeElem = document.getElementById('cancel-order-code');
    const orderId = codeElem?.dataset?.orderId;
    const orderCode = codeElem?.textContent;
    const reason = document.getElementById('cancel-order-reason')?.value.trim();

    if (!reason) {
      this.toast('Vui lòng nhập lý do hủy đơn hàng', 'warning');
      return;
    }

    try {
      await API.cancelOrder(orderId, { reason });
      this.toast(`Đã hủy đơn hàng ${orderCode} thành công! Kho, tiền quỹ và công nợ đã được hoàn trả.`, 'success');
      const modalCancel = document.getElementById('modal-order-cancel');
      if (modalCancel) modalCancel.classList.remove('active');
      const modalDetail = document.getElementById('modal-order-detail');
      if (modalDetail) modalDetail.classList.remove('active');
      this.refreshCurrentView();
      this.loadTopFundSummary();
    } catch (err) {
      this.toast('Lỗi hủy đơn hàng: ' + err.message, 'error');
    }
  },

  async promptCompleteOrder(orderId) {
    if (!confirm('Xác nhận hoàn tất đơn hàng đang chờ này? Tồn kho sẽ được trừ và ghi nhận doanh thu.')) return;
    try {
      await API.completeOrder(orderId);
      this.toast('Đơn hàng đã được chuyển sang trạng thái Hoàn tất!', 'success');
      const modalDetail = document.getElementById('modal-order-detail');
      if (modalDetail) modalDetail.classList.remove('active');
      const modalPending = document.getElementById('modal-customer-pending');
      if (modalPending) modalPending.classList.remove('active');
      this.refreshCurrentView();
      this.loadTopFundSummary();
    } catch (err) {
      this.toast('Lỗi hoàn tất đơn hàng: ' + err.message, 'error');
    }
  },

  async duplicateOrderToPos(orderId) {
    try {
      const modalDetail = document.getElementById('modal-order-detail');
      if (modalDetail) modalDetail.classList.remove('active');
      const modalPending = document.getElementById('modal-customer-pending');
      if (modalPending) modalPending.classList.remove('active');

      this.navigate('pos');
      await POS.loadFromOrder(orderId);
      this.toast('Đã sao chép đơn hàng vào giỏ bán POS!', 'success');
    } catch (err) {
      this.toast('Lỗi sao chép đơn: ' + err.message, 'error');
    }
  },

  // ==========================================
  // PROMOTIONS MANAGEMENT VIEW
  // ==========================================
  async renderPromotionsView() {
    const container = document.getElementById('view-promotions');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1;">
            <h4 style="margin: 0; font-size: 1rem; font-weight: 600;">Chương trình khuyến mãi & Chiết khấu</h4>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline" onclick="App.exportExcel('promotions')">Xuất Excel</button>
            <button class="btn btn-primary" onclick="App.openCreatePromotionModal()">+ Tạo khuyến mãi mới</button>
          </div>
        </div>

        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã KM</th>
                  <th>Tên chương trình</th>
                  <th>Phạm vi</th>
                  <th>Đối tượng áp dụng</th>
                  <th>Loại giảm</th>
                  <th class="text-right">Giá trị</th>
                  <th class="text-right">Đơn tối thiểu</th>
                  <th>Thời gian áp dụng</th>
                  <th class="text-center">Trạng thái</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="promotions-table-body">
                <tr><td colspan="10" class="empty-state">Đang tải danh sách khuyến mãi...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.loadPromotionsTable();
  },

  async loadPromotionsTable() {
    const tbody = document.getElementById('promotions-table-body');
    if (!tbody) return;

    try {
      const promos = await API.getPromotions();
      if (promos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Chưa có chương trình khuyến mãi nào được tạo.</td></tr>`;
        return;
      }

      tbody.innerHTML = promos.map(p => {
        const scopeMap = { 'order': 'Toàn đơn hàng', 'category': 'Theo danh mục', 'product': 'Theo sản phẩm' };
        const typeMap = { 'percent': 'Theo phần trăm (%)', 'fixed': 'Số tiền cố định' };
        const valStr = p.discount_type === 'percent' ? `${p.discount_value}%` : this.formatMoney(p.discount_value);

        return `
          <tr>
            <td><strong style="color: var(--color-primary);">${p.code}</strong></td>
            <td><strong>${p.name}</strong></td>
            <td><span class="badge-tag badge-blue">${scopeMap[p.scope] || p.scope}</span></td>
            <td>${p.scope_target || 'Tất cả'}</td>
            <td>${typeMap[p.discount_type] || p.discount_type}</td>
            <td class="text-right font-bold tabular-nums" style="color: var(--color-primary);">${valStr}</td>
            <td class="text-right tabular-nums">${this.formatMoney(p.min_order_amount)}</td>
            <td style="font-size: 0.8125rem; white-space: nowrap;">${p.start_date} <br>đến ${p.end_date}</td>
            <td class="text-center">
              <span class="badge-tag ${p.is_active ? 'badge-green' : 'badge-red'}" style="cursor: pointer;" onclick="App.togglePromotionActive(${p.id}, ${!p.is_active})">
                ${p.is_active ? 'Đang chạy' : 'Tạm dừng'}
              </span>
            </td>
            <td class="text-right">
              <button class="btn btn-sm btn-outline" onclick="App.openEditPromotionModal(${p.id})">Sửa</button>
              <button class="btn btn-sm btn-danger" onclick="App.deletePromotion(${p.id}, '${p.name.replace(/'/g, "\\'")}')">Xóa</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state text-danger">Lỗi tải khuyến mãi: ${err.message}</td></tr>`;
    }
  },

  async openCreatePromotionModal() {
    const modal = document.getElementById('modal-promotion');
    document.getElementById('promo-modal-title').textContent = 'Tạo chương trình khuyến mãi';
    document.getElementById('promo-id').value = '';
    document.getElementById('promo-name').value = '';
    
    // Default dates
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    document.getElementById('promo-start').value = now.toISOString().split('T')[0];
    document.getElementById('promo-end').value = future.toISOString().split('T')[0];

    document.getElementById('promo-scope').value = 'order';
    document.getElementById('promo-type').value = 'percent';
    document.getElementById('promo-value').value = '5';
    document.getElementById('promo-min-amount').value = '0';
    document.getElementById('promo-is-active').checked = true;

    await this.onPromoScopeChange();
    modal.classList.add('active');
  },

  async openEditPromotionModal(id) {
    try {
      const promo = await API.getPromotion(id);
      if (!promo) return;

      const modal = document.getElementById('modal-promotion');
      document.getElementById('promo-modal-title').textContent = 'Chỉnh sửa khuyến mãi: ' + promo.name;
      document.getElementById('promo-id').value = promo.id;
      document.getElementById('promo-name').value = promo.name;
      document.getElementById('promo-start').value = promo.start_date || '';
      document.getElementById('promo-end').value = promo.end_date || '';
      document.getElementById('promo-scope').value = promo.scope || 'order';
      document.getElementById('promo-type').value = promo.discount_type || 'percent';
      document.getElementById('promo-value').value = promo.discount_value || '0';
      document.getElementById('promo-min-amount').value = promo.min_order_amount || '0';
      document.getElementById('promo-customer-group').value = promo.customer_group || '';
      document.getElementById('promo-is-active').checked = Boolean(promo.is_active);

      await this.onPromoScopeChange(promo.scope_target);
      modal.classList.add('active');
    } catch (err) {
      this.toast('Lỗi tải thông tin khuyến mãi: ' + err.message, 'error');
    }
  },

  async onPromoScopeChange(currentTargetVal = '') {
    const scope = document.getElementById('promo-scope')?.value || 'order';
    const targetGrp = document.getElementById('promo-scope-target-grp');
    const targetLbl = document.getElementById('promo-scope-target-lbl');
    const targetContainer = document.getElementById('promo-scope-target-container');
    if (!targetGrp || !targetContainer) return;

    if (scope === 'order') {
      targetGrp.style.display = 'none';
      targetContainer.innerHTML = '';
      return;
    }

    targetGrp.style.display = 'block';
    if (scope === 'category') {
      targetLbl.textContent = 'Danh mục áp dụng:';
      try {
        const cats = await API.getCategories();
        targetContainer.innerHTML = `
          <select id="promo-scope-target-select" class="form-control">
            ${cats.map(c => `<option value="${c}" ${c === currentTargetVal ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        `;
      } catch (e) {
        targetContainer.innerHTML = '<input type="text" id="promo-scope-target-select" class="form-control" placeholder="Tên danh mục">';
      }
    } else if (scope === 'product') {
      targetLbl.textContent = 'Sản phẩm áp dụng:';
      try {
        const prods = await API.getProducts();
        targetContainer.innerHTML = `
          <select id="promo-scope-target-select" class="form-control">
            ${prods.map(p => `<option value="${p.id}" ${String(p.id) === String(currentTargetVal) ? 'selected' : ''}>${p.code} - ${p.name}</option>`).join('')}
          </select>
        `;
      } catch (e) {
        targetContainer.innerHTML = '<input type="text" id="promo-scope-target-select" class="form-control" placeholder="Mã hoặc ID sản phẩm">';
      }
    }
  },

  async savePromotion(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('promo-id')?.value;
    const name = document.getElementById('promo-name')?.value.trim();
    const start_date = document.getElementById('promo-start')?.value;
    const end_date = document.getElementById('promo-end')?.value;
    const scope = document.getElementById('promo-scope')?.value;
    const discount_type = document.getElementById('promo-type')?.value;
    const discount_value = parseFloat(document.getElementById('promo-value')?.value || '0');
    const min_order_amount = parseFloat(document.getElementById('promo-min-amount')?.value || '0');
    const customer_group = document.getElementById('promo-customer-group')?.value || null;
    const is_active = document.getElementById('promo-is-active')?.checked ? 1 : 0;

    let scope_target = null;
    if (scope !== 'order') {
      scope_target = document.getElementById('promo-scope-target-select')?.value || null;
    }

    if (!name) {
      this.toast('Vui lòng nhập tên chương trình khuyến mãi', 'warning');
      return;
    }
    if (discount_value <= 0) {
      this.toast('Giá trị giảm phải lớn hơn 0', 'warning');
      return;
    }
    if (discount_type === 'percent' && discount_value > 100) {
      this.toast('Chiết khấu phần trăm không được vượt quá 100%', 'warning');
      return;
    }

    const payload = {
      name,
      start_date,
      end_date,
      scope,
      scope_target,
      discount_type,
      discount_value,
      min_order_amount,
      customer_group,
      is_active
    };

    try {
      if (id) {
        await API.updatePromotion(id, payload);
        this.toast('Cập nhật khuyến mãi thành công!', 'success');
      } else {
        await API.createPromotion(payload);
        this.toast('Tạo chương trình khuyến mãi thành công!', 'success');
      }
      const modal = document.getElementById('modal-promotion');
      if (modal) modal.classList.remove('active');
      this.loadPromotionsTable();
    } catch (err) {
      this.toast('Lỗi lưu khuyến mãi: ' + err.message, 'error');
    }
  },

  async togglePromotionActive(id, newStatus) {
    try {
      await API.updatePromotion(id, { is_active: newStatus ? 1 : 0 });
      this.toast(`Đã ${newStatus ? 'kích hoạt' : 'tạm dừng'} khuyến mãi!`, 'success');
      this.loadPromotionsTable();
    } catch (err) {
      this.toast('Lỗi cập nhật: ' + err.message, 'error');
    }
  },

  async deletePromotion(id, name) {
    if (!confirm(`Xác nhận xóa chương trình khuyến mãi: "${name}"?`)) return;
    try {
      await API.deletePromotion(id);
      this.toast('Đã xóa khuyến mãi thành công!', 'success');
      this.loadPromotionsTable();
    } catch (err) {
      this.toast('Lỗi xóa khuyến mãi: ' + err.message, 'error');
    }
  },

  // ==========================================
  // MULTI-LEVEL PACKAGING UNITS MODAL
  // ==========================================
  async openProductUnitsModal(productId) {
    const modal = document.getElementById('modal-product-units');
    const title = document.getElementById('pu-modal-title');
    const subtitle = document.getElementById('pu-modal-subtitle');
    const tbody = document.getElementById('pu-table-body');
    const hiddenPid = document.getElementById('pu-product-id');
    const hiddenUid = document.getElementById('pu-unit-id');
    const formTitle = document.getElementById('pu-form-title');

    if (!modal) return;
    hiddenPid.value = productId;
    hiddenUid.value = '';
    formTitle.textContent = 'Thêm đơn vị đóng gói mới';

    // Clear form inputs
    document.getElementById('pu-name').value = '';
    document.getElementById('pu-rate').value = '';
    document.getElementById('pu-price').value = '';
    document.getElementById('pu-barcode').value = '';

    modal.classList.add('active');
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Đang tải danh sách đơn vị quy đổi...</td></tr>';

    try {
      const units = await API.getProductUnits(productId);
      const baseUnit = units.find(u => u.is_base);
      const baseUnitName = baseUnit ? baseUnit.name : 'đv cơ sở';

      if (subtitle) {
        subtitle.textContent = `Đơn vị cơ sở: [${baseUnitName}] | Quy đổi các cấp đóng gói/bán buôn lớn hơn`;
      }

      tbody.innerHTML = units.map(u => {
        const isBase = Boolean(u.is_base);
        return `
          <tr>
            <td><strong>${u.name}</strong></td>
            <td>
              ${isBase ? `<span class="badge-tag badge-purple">1 (Đơn vị cơ sở)</span>` : `1 ${u.name} = <strong>${u.conversion_rate}</strong> ${baseUnitName}`}
            </td>
            <td class="text-right tabular-nums">
              ${u.sale_price !== null && u.sale_price !== undefined ? this.formatMoney(u.sale_price) : '<span style="color: var(--color-text-muted); font-size: 0.8rem;">Tự động tính theo tỷ lệ</span>'}
            </td>
            <td style="font-family: var(--font-mono); font-size: 0.8125rem;">${u.barcode || '---'}</td>
            <td>
              <span class="badge-tag ${isBase ? 'badge-purple' : 'badge-blue'}">${isBase ? 'Cơ sở' : 'Đóng gói'}</span>
            </td>
            <td class="text-right">
              ${isBase ? '<span style="color: var(--color-text-disabled); font-size: 0.8rem;">Mặc định</span>' : `
                <button class="btn btn-sm btn-outline" onclick="App.editProductUnitRow(${JSON.stringify(u).replace(/"/g, '&quot;')})">Sửa</button>
                <button class="btn btn-sm btn-danger" onclick="App.deleteProductUnit(${u.id}, ${productId})">Xóa</button>
              `}
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state text-danger">Lỗi tải đơn vị tính: ${err.message}</td></tr>`;
    }
  },

  editProductUnitRow(u) {
    document.getElementById('pu-unit-id').value = u.id;
    document.getElementById('pu-form-title').textContent = 'Chỉnh sửa đơn vị: ' + u.name;
    document.getElementById('pu-name').value = u.name;
    document.getElementById('pu-rate').value = u.conversion_rate;
    document.getElementById('pu-price').value = u.sale_price !== null && u.sale_price !== undefined ? u.sale_price : '';
    document.getElementById('pu-barcode').value = u.barcode || '';
  },

  async saveProductUnit(e) {
    if (e) e.preventDefault();
    const productId = document.getElementById('pu-product-id').value;
    const unitId = document.getElementById('pu-unit-id').value;
    const name = document.getElementById('pu-name').value.trim();
    const rate = parseFloat(document.getElementById('pu-rate').value);
    const priceInput = document.getElementById('pu-price').value.trim();
    const sale_price = priceInput !== '' ? parseFloat(priceInput) : null;
    const barcode = document.getElementById('pu-barcode').value.trim() || null;

    if (!name) {
      this.toast('Vui lòng nhập tên đơn vị tính', 'warning');
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      this.toast('Hệ số quy đổi phải lớn hơn 0', 'warning');
      return;
    }

    const payload = {
      name,
      conversion_rate: rate,
      sale_price,
      barcode
    };

    try {
      if (unitId) {
        await API.updateProductUnit(unitId, payload);
        this.toast('Đã cập nhật đơn vị quy đổi!', 'success');
      } else {
        await API.saveProductUnit(productId, payload);
        this.toast('Đã thêm đơn vị quy đổi mới!', 'success');
      }
      this.openProductUnitsModal(productId);
      this.loadProductsTable();
    } catch (err) {
      this.toast('Lỗi lưu đơn vị tính: ' + err.message, 'error');
    }
  },

  async deleteProductUnit(unitId, productId) {
    if (!confirm('Xác nhận xóa đơn vị quy đổi này?')) return;
    try {
      await API.deleteProductUnit(unitId);
      this.toast('Đã xóa đơn vị quy đổi thành công!', 'success');
      this.openProductUnitsModal(productId);
      this.loadProductsTable();
    } catch (err) {
      this.toast('Lỗi xóa đơn vị: ' + err.message, 'error');
    }
  },

  // ==========================================
  // CUSTOMER PENDING ORDERS MODAL
  // ==========================================
  async viewCustomerPendingOrders(customerId, customerName) {
    const modal = document.getElementById('modal-customer-pending');
    const title = document.getElementById('cust-pending-title');
    const subtitle = document.getElementById('cust-pending-subtitle');
    const container = document.getElementById('cust-pending-list-container');
    if (!modal || !container) return;

    if (title) title.textContent = `Đơn hàng đang chờ: ${customerName}`;
    if (subtitle) subtitle.textContent = 'Danh sách các đơn đặt hàng chưa hoàn tất hoặc giao dịch chưa chốt';
    container.innerHTML = '<div style="text-align: center; padding: 30px;">Đang tải đơn đặt hàng...</div>';
    modal.classList.add('active');

    try {
      const orders = await API.getCustomerPendingOrders(customerId);
      if (orders.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 40px 10px;">
            <div style="font-weight: 600; margin-bottom: 4px;">Khách hàng hiện không có đơn hàng nào đang chờ</div>
            <div style="font-size: 0.8125rem; color: var(--color-text-muted);">Tất cả các đơn đã được hoàn tất hoặc đã hủy</div>
          </div>
        `;
        return;
      }

      container.innerHTML = orders.map(o => {
        const itemsStr = o.items ? o.items.map(it => `${it.product_name} (${it.quantity} ${it.unit_name || ''})`).join(', ') : '---';
        return `
          <div style="background: var(--color-bg-alt); border: 1px solid var(--color-border); border-radius: 8px; padding: 14px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div>
                <strong style="color: var(--color-primary); font-size: 0.95rem;">${o.code}</strong>
                <span style="font-size: 0.8125rem; color: var(--color-text-muted); margin-left: 8px;">${o.created_at}</span>
              </div>
              <span class="order-badge-pending">Đang chờ</span>
            </div>
            <div style="font-size: 0.84rem; margin-bottom: 6px;">
              <strong>Mặt hàng:</strong> ${itemsStr}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem;">
              <div>
                Tổng tiền: <strong class="tabular-nums" style="color: var(--color-primary);">${this.formatMoney(o.final_amount)}</strong>
                ${o.notes ? `<span style="font-size: 0.8125rem; color: var(--color-text-muted); margin-left: 10px;">(Ghi chú: ${o.notes})</span>` : ''}
              </div>
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-sm btn-outline" onclick="App.renderOrderDetail(${o.id})">Chi tiết</button>
                <button class="btn btn-sm btn-outline" onclick="App.duplicateOrderToPos(${o.id})">Tải vào POS</button>
                <button class="btn btn-sm btn-success" onclick="App.promptCompleteOrder(${o.id})">Hoàn tất</button>
                <button class="btn btn-sm btn-danger" onclick="App.openCancelOrderModal(${o.id}, '${o.code}')">Hủy</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<div class="text-danger" style="padding: 20px;">Lỗi tải đơn hàng: ${err.message}</div>`;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
