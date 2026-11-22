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

  VIEW_PERMISSIONS: {
    'orders': 'orders:view',
    'promotions': 'promotions:view',
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
    'dashboard': null
  },

  async init() {
    this.setupNavigation();
    this.setupModals();
    this.updateUserUI();
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

  removeVietnameseTones(str) {
    if (!str) return '';
    str = String(str);
    str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    str = str.replace(/[đĐ]/g, m => m === 'đ' ? 'd' : 'D');
    return str.toLowerCase().trim();
  },

  matchesSearch(item, query, fields = []) {
    if (!query) return true;
    const cleanQ = this.removeVietnameseTones(query);
    const qTerms = cleanQ.split(/\s+/).filter(Boolean);
    let candidateText = '';
    for (const f of fields) {
      if (item[f] !== undefined && item[f] !== null) {
        candidateText += ' ' + String(item[f]);
      }
    }
    const cleanCandidate = this.removeVietnameseTones(candidateText);
    return qTerms.every(term => cleanCandidate.includes(term));
  },

  normalizeOrders(res) {
    if (Array.isArray(res)) return res;
    if (res && typeof res === 'object') {
      if (Array.isArray(res.orders)) return res.orders;
      if (Array.isArray(res.invoices)) return res.invoices;
      if (Array.isArray(res.data)) return res.data;
      if (Array.isArray(res.items)) return res.items;
      if (Array.isArray(res.rows)) return res.rows;
      if (Array.isArray(res.result)) return res.result;
    }
    return [];
  },

  async exportTableToExcel(headers, rows, sheetName, filename) {
    try {
      this.toast('Đang khởi tạo tệp Excel (.xlsx)...', 'info');
      await API.exportXlsx({
        title: sheetName,
        sheet_name: sheetName.substring(0, 31),
        filename: filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
        headers: headers,
        rows: rows
      });
      this.toast(`Đã xuất tệp ${filename} thành công!`, 'success');
    } catch (err) {
      this.toast(`Lỗi xuất Excel: ${err.message}`, 'error');
    }
  },

  async exportTable(tableName) {
    try {
      this.toast(`Đang xuất dữ liệu '${tableName}' ra file Excel...`, 'info');
      await API.exportTable(tableName);
      this.toast(`Đã xuất bảng '${tableName}' ra file Excel thành công!`, 'success');
    } catch (err) {
      this.toast(`Lỗi xuất Excel: ${err.message}`, 'error');
    }
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
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        const modalId = closeBtn.getAttribute('data-close-modal');
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('active');
      }
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          if (modal.id === 'auth-modal') return;
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
      'orders': 'Quản lý Hóa đơn & Đơn đặt hàng',
      'promotions': 'Quản lý Chương trình Khuyến mãi',
      'products': 'Quản lý Hàng hóa & Tồn kho',
      'purchases': 'Quản lý Nhập hàng (Nhà cung cấp)',
      'customers': 'Quản lý Khách hàng & Bảng giá riêng',
      'suppliers': 'Quản lý Nhà cung cấp',
      'returns': 'Quản lý Khách trả hàng (Đổi trả)',
      'cash-flow': 'Quản lý Sổ quỹ & Dòng tiền',
      'reports': 'Báo cáo doanh thu & Lợi nhuận',
      'settings': 'Cài đặt hệ thống & Sao lưu',
      'audit': 'Nhật ký hoạt động & Truy vết kiểm toán',
      'users': 'Quản lý Nhân viên & Phân quyền'
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
      case 'orders':
        this.renderOrdersView();
        break;
      case 'promotions':
        this.renderPromotionsView();
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
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="prod-search-input" class="form-control" style="max-width: 280px;" placeholder="Tìm theo tên, mã SKU, barcode...">
            <select id="prod-search-by" class="form-control" style="max-width: 140px;">
              <option value="both">Code & Name</option>
              <option value="code">Code</option>
              <option value="name">Name</option>
            </select>
            <select id="prod-cat-filter" class="form-control" style="max-width: 170px;">
              <option value="">Tất cả danh mục</option>
            </select>
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.84rem; cursor: pointer; color: var(--color-text-muted);">
              <input type="checkbox" id="prod-low-stock-filter"> Cảnh báo tồn kho
            </label>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-excel" onclick="App.exportTable('products')" title="Xuất file Excel danh mục hàng hóa">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
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
                  <th>ĐVT cơ bản</th>
                  <th>Quy đổi & Tồn chi tiết</th>
                  <th class="text-right">Giá vốn (MAC)</th>
                  <th class="text-right">Giá bán</th>
                  <th class="text-center">Tồn kho cơ bản</th>
                  <th class="text-center">Đang đặt</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="products-table-body">
                <tr><td colspan="10" class="empty-state">Đang tải danh mục hàng hóa...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    try {
      const cats = await API.getCategories();
      const catSelect = document.getElementById('prod-cat-filter');
      if (catSelect && Array.isArray(cats)) {
        cats.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c;
          catSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn("Could not load categories", e);
    }

    document.getElementById('prod-search-input')?.addEventListener('input', () => this.loadProductsTable());
    document.getElementById('prod-search-by')?.addEventListener('change', () => this.loadProductsTable());
    document.getElementById('prod-cat-filter')?.addEventListener('change', () => this.loadProductsTable());
    document.getElementById('prod-low-stock-filter')?.addEventListener('change', () => this.loadProductsTable());

    this.loadProductsTable();
  },

  async loadProductsTable() {
    const q = document.getElementById('prod-search-input')?.value || '';
    const searchBy = document.getElementById('prod-search-by')?.value || 'both';
    const cat = document.getElementById('prod-cat-filter')?.value || '';
    const lowStock = document.getElementById('prod-low-stock-filter')?.checked || false;

    try {
      const products = await API.getProducts({ q, search: q, searchBy, category: cat, low_stock: lowStock });
      const tbody = document.getElementById('products-table-body');
      if (!tbody) return;

      let filtered = products;
      if (q) {
        if (searchBy === 'code') {
          filtered = filtered.filter(p => this.matchesSearch(p, q, ['code', 'barcode']));
        } else if (searchBy === 'name') {
          filtered = filtered.filter(p => this.matchesSearch(p, q, ['name']));
        } else {
          filtered = filtered.filter(p => this.matchesSearch(p, q, ['name', 'code', 'barcode', 'category']));
        }
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Không tìm thấy hàng hóa phù hợp</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(p => `
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
          <td>
            ${p.stock_breakdown ? `<div class="breakdown-badge" title="Tồn kho chi tiết theo đơn vị">${p.stock_breakdown}</div>` : ''}
            ${p.units && p.units.length > 1 ? `
              <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                ${p.units.map(u => `${u.unit_name}${u.conversion_rate > 1 ? ` (x${u.conversion_rate})` : ''}`).join(' · ')}
              </div>
            ` : (p.sub_unit ? `<small style="color: var(--color-text-muted);">1 ${p.unit} = ${p.sub_unit_ratio} ${p.sub_unit}</small>` : '<span style="color: var(--color-text-disabled);">---</span>')}
          </td>
          <td class="text-right tabular-nums">${this.formatMoney(p.cost_price)}</td>
          <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(p.sale_price)}</td>
          <td class="text-center">
            <span class="badge-tag ${p.stock <= p.min_stock ? 'badge-red' : 'badge-green'}">
              ${p.stock} ${p.unit}
            </span>
          </td>
          <td class="text-center">
            ${p.ordered_qty > 0 ? `<span class="badge-tag badge-amber" title="Số lượng khách đặt trước chưa xuất kho">${p.ordered_qty} ${p.unit}</span>` : '<span style="color: var(--color-text-disabled);">0</span>'}
          </td>
          <td class="text-right" style="white-space: nowrap;">
            <button class="btn btn-sm btn-outline" onclick="App.openStockLogsModal(${p.id})" title="Thẻ kho">Thẻ kho</button>
            <button class="btn btn-sm btn-outline" onclick="App.openAdjustStockModal(${p.id}, '${p.name.replace(/'/g, "\\'")}', ${p.stock}, '${p.unit}', '${(p.stock_breakdown || '').replace(/'/g, "\\'")}')" title="Kiểm kho">Kiểm kho</button>
            <button class="btn btn-sm btn-outline" onclick="App.openEditProductModal(${p.id})" title="Sửa">Sửa</button>
            <button class="btn btn-sm btn-outline text-danger" style="color: var(--color-danger);" onclick="App.deleteProduct(${p.id})" title="Xóa">Xóa</button>
            <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('product', '${p.code}')" title="Xem lịch sử kiểm toán">Lịch sử</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Không thể tải sản phẩm: ' + err.message, 'error');
    }
  },

  async exportProductsExcel() {
    try {
      const products = await API.getProducts();
      const headers = ['Mã SKU', 'Mã vạch (Barcode)', 'Tên hàng hóa', 'Danh mục', 'ĐVT cơ bản', 'Quy đổi chi tiết', 'Tồn kho cơ bản', 'Phân rã tồn kho', 'Khách đang đặt', 'Giá vốn (MAC)', 'Giá bán'];
      const rows = products.map(p => {
        let convStr = '';
        if (p.units && p.units.length > 0) {
          convStr = p.units.map(u => `${u.unit_name} (x${u.conversion_rate})`).join(', ');
        }
        return [
          p.code,
          p.barcode || '',
          p.name,
          p.category || 'Chung',
          p.unit,
          convStr,
          p.stock,
          p.stock_breakdown || `${p.stock} ${p.unit}`,
          p.ordered_qty || 0,
          p.cost_price,
          p.sale_price
        ];
      });
      await this.exportTableToExcel(headers, rows, 'DanhSachHangHoa', 'danh_sach_hang_hoa.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel hàng hóa: ' + err.message, 'error');
    }
  },

  addUnitRow(unit = null) {
    const tbody = document.getElementById('product-units-tbody');
    if (!tbody) return;

    const uName = unit ? (unit.unit_name || '') : '';
    const uRate = (unit && unit.conversion_rate !== null && unit.conversion_rate !== undefined) ? unit.conversion_rate : '';
    const uPrice = (unit && unit.sale_price !== null && unit.sale_price !== undefined) ? unit.sale_price : '';
    const uBarcode = unit ? (unit.barcode || '') : '';

    const escapeAttr = (str) => String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const tr = document.createElement('tr');
    tr.className = 'unit-row-item';
    tr.innerHTML = `
      <td>
        <input type="text" class="form-control form-control-sm unit-name-input" placeholder="Ví dụ: Lốc, Thùng..." value="${escapeAttr(uName)}">
      </td>
      <td>
        <input type="number" step="any" min="0.001" class="form-control form-control-sm unit-rate-input" placeholder="Ví dụ: 6 hoặc 36" value="${escapeAttr(uRate)}">
      </td>
      <td>
        <input type="number" step="any" min="0" class="form-control form-control-sm unit-price-input" placeholder="Giá bán..." value="${escapeAttr(uPrice)}">
      </td>
      <td>
        <input type="text" class="form-control form-control-sm unit-barcode-input" placeholder="Barcode riêng..." value="${escapeAttr(uBarcode)}">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn btn-sm btn-outline" onclick="App.removeUnitRow(this)" title="Xóa dòng" style="color: #ef4444; padding: 2px 6px;">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  },

  removeUnitRow(btn) {
    const row = btn?.closest('tr');
    if (row) row.remove();
  },

  syncBaseUnitName(name) {
    // Base unit sync callback
  },

  openCreateProductModal() {
    try {
      const modal = document.getElementById('product-modal');
      if (!modal) return;
      const titleEl = document.getElementById('product-modal-title');
      if (titleEl) titleEl.textContent = 'Thêm hàng hóa mới';

      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val !== null && val !== undefined) ? val : '';
      };

      setVal('prod-id', '');
      setVal('prod-code', '');
      setVal('prod-barcode', '');
      setVal('prod-name', '');
      setVal('prod-category', 'Chung');
      setVal('prod-unit', 'Cái');
      setVal('prod-sub-unit', '');
      setVal('prod-sub-unit-ratio', '1');
      setVal('prod-cost-price', '0');
      setVal('prod-sale-price', '0');
      setVal('prod-stock', '0');
      const stockEl = document.getElementById('prod-stock');
      if (stockEl) stockEl.disabled = false;
      setVal('prod-min-stock', '5');

      const tbody = document.getElementById('product-units-tbody');
      if (tbody) tbody.innerHTML = '';

      modal.classList.add('active');
    } catch (e) {
      App.toast('Lỗi mở form sản phẩm: ' + e.message, 'error');
    }
  },

  async openEditProductModal(id) {
    try {
      if (id === undefined || id === null || id === '') {
        App.toast('Mã sản phẩm không hợp lệ', 'warning');
        return;
      }

      const products = await API.getProducts();
      const list = Array.isArray(products) ? products : (products && Array.isArray(products.data) ? products.data : []);
      const p = list.find(x => x && (x.id === id || String(x.id) === String(id)));
      if (!p) {
        App.toast('Không tìm thấy thông tin sản phẩm', 'warning');
        return;
      }

      const modal = document.getElementById('product-modal');
      if (!modal) return;
      const titleEl = document.getElementById('product-modal-title');
      if (titleEl) titleEl.textContent = 'Chỉnh sửa: ' + (p.name || '');

      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = (val !== null && val !== undefined) ? val : '';
      };

      setVal('prod-id', p.id);
      setVal('prod-code', p.code || '');
      setVal('prod-barcode', p.barcode || '');
      setVal('prod-name', p.name || '');
      setVal('prod-category', p.category || 'Chung');
      setVal('prod-unit', p.unit || 'Cái');
      setVal('prod-sub-unit', p.sub_unit || '');
      setVal('prod-sub-unit-ratio', p.sub_unit_ratio || 1);
      setVal('prod-cost-price', p.cost_price ?? 0);
      setVal('prod-sale-price', p.sale_price ?? 0);
      setVal('prod-stock', p.stock ?? 0);
      const stockEl = document.getElementById('prod-stock');
      if (stockEl) stockEl.disabled = true;
      setVal('prod-min-stock', p.min_stock ?? 5);

      const tbody = document.getElementById('product-units-tbody');
      if (tbody) {
        tbody.innerHTML = '';
        const unitsList = Array.isArray(p.units) ? p.units : [];
        let addedNonBase = false;
        if (unitsList.length > 0) {
          unitsList.forEach(u => {
            if (!u.is_base && Number(u.conversion_rate) !== 1.0) {
              App.addUnitRow(u);
              addedNonBase = true;
            }
          });
        }
        // Fallback for legacy v2 products where sub_unit was stored in products table without product_units row
        if (!addedNonBase && p.sub_unit && parseFloat(p.sub_unit_ratio) > 1) {
          App.addUnitRow({
            unit_name: p.sub_unit,
            conversion_rate: p.sub_unit_ratio,
            sale_price: Math.round((p.sale_price || 0) * (p.sub_unit_ratio || 1)),
            barcode: ''
          });
        }
      }

      modal.classList.add('active');
    } catch (e) {
      App.toast('Lỗi mở form sản phẩm: ' + e.message, 'error');
    }
  },

  // Aliases for opening / editing product modal
  openProductModal(id) {
    if (id !== undefined && id !== null && id !== '') {
      return App.openEditProductModal(id);
    } else {
      return App.openCreateProductModal();
    }
  },

  editProduct(id) {
    return App.openEditProductModal(id);
  },

  async saveProductForm() {
    const getVal = (id, fallback = '') => {
      const el = document.getElementById(id);
      return el ? el.value : fallback;
    };

    const id = getVal('prod-id').trim();
    const name = getVal('prod-name').trim();
    if (!name) {
      App.toast('Tên sản phẩm không được để trống', 'warning');
      return;
    }

    const baseUnit = getVal('prod-unit').trim() || 'Cái';
    const baseSalePrice = parseFloat(getVal('prod-sale-price', '0')) || 0;
    const prodBarcode = getVal('prod-barcode').trim();

    // Assemble multi-tier units
    const units = [
      {
        unit_name: baseUnit,
        conversion_rate: 1.0,
        is_base: 1,
        sale_price: baseSalePrice,
        barcode: prodBarcode
      }
    ];

    const unitRows = document.querySelectorAll('#product-units-tbody tr.unit-row-item');
    unitRows.forEach(r => {
      const uName = r.querySelector('.unit-name-input')?.value.trim();
      const uRate = parseFloat(r.querySelector('.unit-rate-input')?.value) || 0;
      const uPrice = parseFloat(r.querySelector('.unit-price-input')?.value) || 0;
      const uBarcode = r.querySelector('.unit-barcode-input')?.value.trim() || '';
      if (uName && uRate > 0) {
        units.push({
          unit_name: uName,
          conversion_rate: uRate,
          is_base: 0,
          sale_price: uPrice > 0 ? uPrice : (baseSalePrice * uRate),
          barcode: uBarcode
        });
      }
    });

    // Secondary packaging unit is derived from units[1], keeping DOM hidden inputs in sync
    const subUnitVal = units[1] ? units[1].unit_name : '';
    const subUnitRatioVal = units[1] ? units[1].conversion_rate : 1;

    const subUnitEl = document.getElementById('prod-sub-unit');
    if (subUnitEl) subUnitEl.value = subUnitVal;
    const subUnitRatioEl = document.getElementById('prod-sub-unit-ratio');
    if (subUnitRatioEl) subUnitRatioEl.value = subUnitRatioVal;

    const payload = {
      code: getVal('prod-code').trim(),
      barcode: prodBarcode,
      name: name,
      category: getVal('prod-category').trim(),
      unit: baseUnit,
      units: units,
      sub_unit: subUnitVal,
      sub_unit_ratio: subUnitRatioVal,
      cost_price: parseFloat(getVal('prod-cost-price', '0')) || 0,
      sale_price: baseSalePrice,
      stock: parseFloat(getVal('prod-stock', '0')) || 0,
      min_stock: parseFloat(getVal('prod-min-stock', '5')) || 5
    };

    try {
      if (id) {
        await API.updateProduct(id, payload);
        App.toast('Cập nhật hàng hóa thành công', 'success');
      } else {
        await API.createProduct(payload);
        App.toast('Thêm hàng hóa mới thành công', 'success');
      }
      document.getElementById('product-modal')?.classList.remove('active');
      App.loadProductsTable();
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

  openAdjustStockModal(productId, productName, currentStock, unit = '', stockBreakdown = '') {
    const modal = document.getElementById('adjust-modal');
    document.getElementById('adjust-product-id').value = productId;
    document.getElementById('adjust-product-name').textContent = productName;
    document.getElementById('adjust-current-stock').textContent = `${currentStock} ${unit}`;
    const breakdownElem = document.getElementById('adjust-stock-breakdown');
    if (breakdownElem) {
      if (stockBreakdown) {
        breakdownElem.innerHTML = `<span class="breakdown-badge" style="background: var(--color-bg); padding: 3px 8px; border-radius: 4px; font-size: 0.82rem; border: 1px solid var(--color-border); display: inline-block;">Phân rã: <strong>${stockBreakdown}</strong></span>`;
      } else {
        breakdownElem.innerHTML = '';
      }
    }
    document.getElementById('adjust-actual-stock').value = currentStock;
    document.getElementById('adjust-notes').value = 'Kiểm kho định kỳ';
    modal.classList.add('active');
  },

  async deleteProduct(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa sản phẩm này? Hệ thống sẽ ghi nhận vào nhật ký kiểm toán.')) return;
    try {
      await API.deleteProduct(id);
      App.toast('Đã xóa sản phẩm thành công', 'success');
      this.loadProductsTable();
      if (typeof POS !== 'undefined' && POS.loadProducts) {
        await POS.loadProducts();
      }
    } catch (err) {
      App.toast('Lỗi xóa sản phẩm: ' + err.message, 'error');
    }
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
  // ==========================================
  // 3. PURCHASES (NHẬP HÀNG) VIEW
  // ==========================================
  async renderPurchasesView() {
    const container = document.getElementById('view-purchases');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="purch-search-input" class="form-control" style="max-width: 300px;" placeholder="Tìm theo mã phiếu, nhà cung cấp...">
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-excel" onclick="App.exportPurchasesExcel()" title="Xuất file Excel danh sách nhập hàng">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
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

    document.getElementById('purch-search-input')?.addEventListener('input', () => this.loadPurchasesTable());
    this.loadPurchasesTable();
  },

  async loadPurchasesTable() {
    const q = document.getElementById('purch-search-input')?.value || '';
    try {
      const purchases = await API.getPurchases();
      const tbody = document.getElementById('purchases-table-body');
      if (!tbody) return;

      let filtered = purchases;
      if (q) {
        filtered = filtered.filter(p => this.matchesSearch(p, q, ['code', 'supplier_name', 'notes']));
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Chưa có phiếu nhập hàng phù hợp</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(p => `
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
          <td class="text-right" style="white-space: nowrap;">
            <button class="btn btn-sm btn-outline" onclick="App.viewPurchaseDetail(${p.id})">Chi tiết</button>
            <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('purchase', '${p.code}')" title="Xem lịch sử kiểm toán">Lịch sử</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải phiếu nhập: ' + err.message, 'error');
    }
  },

  async exportPurchasesExcel() {
    try {
      const purchases = await API.getPurchases();
      const headers = ['Mã phiếu nhập', 'Thời gian', 'Nhà cung cấp', 'Số mặt hàng', 'Tổng tiền hàng (VNĐ)', 'Đã trả NCC (VNĐ)', 'Còn nợ NCC (VNĐ)', 'Trạng thái', 'Ghi chú'];
      const rows = purchases.map(p => [
        p.code,
        p.created_at,
        p.supplier_name || 'Nhà cung cấp',
        p.item_count || 0,
        p.final_amount || 0,
        p.paid_amount || 0,
        p.debt_amount || 0,
        'Hoàn tất',
        p.notes || ''
      ]);
      await this.exportTableToExcel(headers, rows, 'DanhSachNhapHang', 'danh_sach_nhap_hang.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel nhập hàng: ' + err.message, 'error');
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

    const prodSelect = document.getElementById('purch-prod-select');
    if (prodSelect) {
      prodSelect.innerHTML = '<option value="">-- Chọn sản phẩm để thêm vào phiếu --</option>';
      try {
        const prods = await API.getProducts();
        prods.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.code}) - Tồn: ${p.stock} ${p.unit}`;
          prodSelect.appendChild(opt);
        });
      } catch (e) {
        console.error(e);
      }
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

  addSelectedProductToPurchase() {
    const sel = document.getElementById('purch-prod-select');
    if (!sel || !sel.value) {
      App.toast('Vui lòng chọn sản phẩm trong danh sách trước', 'warning');
      return;
    }
    this.addDraftItemToPurchase(parseInt(sel.value));
  },

  async addDraftItemToPurchase(productId) {
    if (!productId) return;
    try {
      const prods = await API.getProducts();
      const p = prods.find(x => x.id == productId);
      if (!p) return;

      const availableUnits = [
        { unit_name: p.unit, conversion_rate: 1.0, cost_price: p.cost_price || 0 }
      ];
      if (p.units && Array.isArray(p.units)) {
        p.units.forEach(u => {
          if (!availableUnits.some(au => au.unit_name.toLowerCase() === u.unit_name.toLowerCase())) {
            availableUnits.push({
              unit_name: u.unit_name,
              conversion_rate: u.conversion_rate || 1.0,
              cost_price: u.cost_price || (p.cost_price * (u.conversion_rate || 1.0))
            });
          }
        });
      }

      const existing = this.purchaseDraftItems.find(i => i.product_id == p.id && i.unit == p.unit);
      if (existing) {
        existing.quantity += 1;
      } else {
        this.purchaseDraftItems.push({
          product_id: p.id,
          code: p.code,
          name: p.name,
          base_unit: p.unit,
          unit: p.unit,
          unit_conversion_rate: 1.0,
          available_units: availableUnits,
          quantity: 1,
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
      container.innerHTML = '<tr><td colspan="6" class="empty-state">Chưa chọn sản phẩm nhập kho. Chọn sản phẩm từ danh mục rồi nhấn "+ Thêm vào phiếu".</td></tr>';
      this.updatePurchaseDraftTotals();
      return;
    }

    container.innerHTML = this.purchaseDraftItems.map((item, idx) => {
      let unitHtml = `<span>${item.unit}</span>`;
      if (item.available_units && item.available_units.length > 1) {
        unitHtml = `
          <select class="form-control form-control-sm" style="font-weight: 600; min-width: 90px;" onchange="App.updatePurchaseItemUnit(${idx}, this.value)">
            ${item.available_units.map(u => `
              <option value="${u.unit_name}" ${u.unit_name === item.unit ? 'selected' : ''}>
                ${u.unit_name} ${u.conversion_rate !== 1.0 ? `(x${u.conversion_rate})` : ''}
              </option>
            `).join('')}
          </select>
        `;
      }

      return `
        <tr>
          <td>
            <strong>${item.name}</strong><br>
            <small style="color: var(--color-text-subtle); font-family: var(--font-mono);">${item.code}</small>
          </td>
          <td>${unitHtml}</td>
          <td>
            <input type="number" class="form-control" style="width: 80px;" value="${item.quantity}" min="0.01" step="any" onchange="App.updatePurchaseItemQty(${idx}, this.value)">
          </td>
          <td>
            <input type="number" class="form-control" style="width: 130px;" value="${item.import_price}" min="0" onchange="App.updatePurchaseItemPrice(${idx}, this.value)">
          </td>
          <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">
            ${this.formatMoney(item.quantity * item.import_price)}
          </td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline text-danger" onclick="App.removePurchaseItem(${idx})" style="color: var(--color-danger); border-color: transparent;">✕</button>
          </td>
        </tr>
      `;
    }).join('');

    this.updatePurchaseDraftTotals();
  },

  updatePurchaseItemUnit(idx, unitName) {
    const item = this.purchaseDraftItems[idx];
    if (!item) return;
    item.unit = unitName;
    const match = item.available_units?.find(u => u.unit_name === unitName);
    if (match) {
      item.unit_conversion_rate = match.conversion_rate || 1.0;
      if (match.cost_price) {
        item.import_price = match.cost_price;
      }
    } else {
      item.unit_conversion_rate = 1.0;
    }
    this.renderPurchaseDraftItems();
  },

  updatePurchaseItemQty(idx, val) {
    if (this.purchaseDraftItems[idx]) {
      this.purchaseDraftItems[idx].quantity = Math.max(0.01, parseFloat(val) || 1);
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
    this.addSelectedProductToPurchase();
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
        unit: i.unit,
        unit_conversion_rate: i.unit_conversion_rate || 1.0,
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
      const modal = document.getElementById('purchase-detail-modal');
      const title = document.getElementById('pd-title');
      const subtitle = document.getElementById('pd-subtitle');
      const body = document.getElementById('pd-body');
      const footer = document.getElementById('pd-footer');

      if (!modal || !body) return;

      if (title) title.textContent = `Phiếu Nhập Hàng: ${p.code}`;
      if (subtitle) subtitle.textContent = `Thời gian: ${p.created_at} | Người lập: ${p.user_name || 'Quản lý'}`;

      let methodText = 'Tiền mặt';
      if (p.payment_method === 'bank') methodText = 'Chuyển khoản';
      if (p.payment_method === 'debt') methodText = 'Ghi nợ NCC';

      body.innerHTML = `
        <div style="background: var(--color-surface-muted); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 0.875rem;">
            <div>
              <span style="color: var(--color-text-secondary); display: block;">Nhà cung cấp:</span>
              <strong style="font-size: 1rem; color: var(--color-text-main);">${p.supplier_name || 'Nhà cung cấp'}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-secondary); display: block;">Hình thức thanh toán:</span>
              <strong>${methodText}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-secondary); display: block;">Trạng thái:</span>
              <span class="badge-tag badge-green">Hoàn tất (Đã nhập kho)</span>
            </div>
          </div>
          ${p.notes ? `
            <div style="margin-top: 8px; font-size: 0.84rem; color: var(--color-text-secondary); border-top: 1px dashed var(--color-border); padding-top: 6px;">
              Ghi chú chứng từ: <em>${p.notes}</em>
            </div>
          ` : ''}
        </div>

        <div style="margin-bottom: 12px; font-weight: 600; color: var(--color-text-main); font-size: 0.95rem;">
          Danh sách mặt hàng nhập kho:
        </div>
        <div class="table-responsive" style="max-height: 280px; margin-bottom: 16px;">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 40px;">STT</th>
                <th>Mã SKU</th>
                <th>Tên sản phẩm</th>
                <th>ĐVT</th>
                <th class="text-right">SL Nhập</th>
                <th class="text-right">Giá nhập</th>
                <th class="text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              ${p.items && p.items.length > 0 ? p.items.map((it, idx) => `
                <tr>
                  <td class="text-center">${idx + 1}</td>
                  <td style="font-family: var(--font-mono); font-size: 0.8125rem;">${it.product_code || ''}</td>
                  <td><strong>${it.product_name}</strong></td>
                  <td><span class="badge-tag badge-blue">${it.unit}</span></td>
                  <td class="text-right tabular-nums font-bold">${it.quantity}</td>
                  <td class="text-right tabular-nums">${this.formatMoney(it.import_price)}</td>
                  <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(it.subtotal)}</td>
                </tr>
              `).join('') : '<tr><td colspan="7" class="empty-state">Không có thông tin chi tiết</td></tr>'}
            </tbody>
          </table>
        </div>

        <div style="background: var(--color-surface-muted); padding: 14px 16px; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="color: var(--color-text-secondary);">Tổng tiền hàng nhập:</span>
            <span class="tabular-nums font-bold">${this.formatMoney(p.total_amount)}</span>
          </div>
          ${p.discount > 0 ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: var(--color-danger);">
              <span>Chiết khấu NCC:</span>
              <span class="tabular-nums font-bold">-${this.formatMoney(p.discount)}</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 1.05rem; border-top: 1px dashed var(--color-border); padding-top: 8px;">
            <strong>Cần thanh toán cho NCC:</strong>
            <strong class="tabular-nums font-bold" style="color: var(--color-primary); font-size: 1.15rem;">${this.formatMoney(p.final_amount)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: var(--color-success);">
            <span>Đã thanh toán:</span>
            <span class="tabular-nums font-bold">${this.formatMoney(p.paid_amount)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: ${p.debt_amount > 0 ? 'var(--color-danger)' : 'var(--color-text-secondary)'}; font-weight: 700;">
            <span>Còn ghi nợ NCC:</span>
            <span class="tabular-nums font-bold">${this.formatMoney(p.debt_amount)}</span>
          </div>
        </div>
      `;

      footer.innerHTML = `
        <div>
          <button class="btn btn-outline" onclick="App.viewEntityTimeline('purchase', '${p.code}')" title="Xem lịch sử kiểm toán của phiếu nhập này">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
            Lịch sử kiểm toán
          </button>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-outline" onclick="window.print()">In phiếu nhập</button>
          <button class="btn btn-primary" data-close-modal="purchase-detail-modal">Đóng</button>
        </div>
      `;

      modal.classList.add('active');
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
          <div style="display: flex; gap: 10px; align-items: center; flex: 1;">
            <input type="text" id="cust-search-input" class="form-control" style="max-width: 320px;" placeholder="Tìm theo tên, SĐT, mã khách, địa chỉ...">
            <select id="cust-search-by" class="form-control" style="max-width: 140px;">
              <option value="both">Code & Name</option>
              <option value="code">Code</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-excel" onclick="App.exportTable('customers')" title="Xuất file Excel danh sách khách hàng">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
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
                  <th class="text-center">Hàng đang đặt</th>
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
    document.getElementById('cust-search-by')?.addEventListener('change', () => this.loadCustomersTable());
    this.loadCustomersTable();
  },

  async loadCustomersTable() {
    const q = document.getElementById('cust-search-input')?.value || '';
    const searchBy = document.getElementById('cust-search-by')?.value || 'both';
    try {
      const customers = await API.getCustomers({ q, search: q, searchBy });
      const tbody = document.getElementById('customers-table-body');
      if (!tbody) return;

      let filtered = customers;
      if (q) {
        if (searchBy === 'code') {
          filtered = filtered.filter(c => this.matchesSearch(c, q, ['code']));
        } else if (searchBy === 'name') {
          filtered = filtered.filter(c => this.matchesSearch(c, q, ['name']));
        } else {
          filtered = filtered.filter(c => this.matchesSearch(c, q, ['name', 'code', 'phone', 'address', 'group_name', 'email']));
        }
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Không tìm thấy khách hàng phù hợp</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(c => `
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
              <span class="badge-tag badge-amber" title="Tổng tiền đang đặt: ${this.formatMoney(c.pending_orders_amount || 0)}">
                ${c.pending_orders_count} đơn (${this.formatMoney(c.pending_orders_amount || 0)})
              </span>
            ` : '<span style="color: var(--color-text-disabled);">0 đơn</span>'}
          </td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline" style="background-color: #fffbeb; border-color: #fde68a; color: #92400e; font-weight: 600;" onclick="App.openCustomerPricingModal(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
              Giá riêng
            </button>
          </td>
          <td class="text-right" style="white-space: nowrap;">
            <button class="btn btn-sm btn-outline" onclick="App.openCustomerDetailModal(${c.id})" title="Xem tóm tắt đơn hàng & thông tin">Chi tiết</button>
            ${c.debt > 0 ? `<button class="btn btn-sm btn-success" onclick="App.openPayCustomerDebtModal(${c.id}, '${c.name.replace(/'/g, "\\'")}', ${c.debt})">Thu nợ</button>` : ''}
            <button class="btn btn-sm btn-outline" onclick="App.openEditCustomerModal(${c.id})">Sửa</button>
            ${c.id !== 1 ? `<button class="btn btn-sm btn-outline text-danger" style="color: var(--color-danger);" onclick="App.deleteCustomer(${c.id})">Xóa</button>` : ''}
            <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('customer', '${c.code}')" title="Xem lịch sử kiểm toán">Lịch sử</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải khách hàng: ' + err.message, 'error');
    }
  },

  async exportCustomersExcel() {
    try {
      const customers = await API.getCustomers();
      const headers = ['Mã KH', 'Tên khách hàng', 'Số điện thoại', 'Email', 'Địa chỉ', 'Nhóm khách', 'Tổng mua (VNĐ)', 'Công nợ hiện tại (VNĐ)', 'Số đơn đang đặt', 'Tổng tiền đang đặt (VNĐ)', 'Ghi chú'];
      const rows = customers.map(c => [
        c.code,
        c.name,
        c.phone || '',
        c.email || '',
        c.address || '',
        c.group_name || 'Khách lẻ',
        c.total_spent || 0,
        c.debt || 0,
        c.pending_orders_count || 0,
        c.pending_orders_amount || 0,
        c.notes || ''
      ]);
      await this.exportTableToExcel(headers, rows, 'DanhSachKhachHang', 'danh_sach_khach_hang.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel khách hàng: ' + err.message, 'error');
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
      let resCust = null;
      if (id) {
        resCust = await API.updateCustomer(id, payload);
        App.toast('Cập nhật khách hàng thành công', 'success');
      } else {
        resCust = await API.createCustomer(payload);
        App.toast('Thêm khách hàng mới thành công', 'success');
      }
      document.getElementById('customer-modal').classList.remove('active');
      this.loadCustomersTable();
      if (typeof POS !== 'undefined' && POS.loadCustomers) {
        await POS.loadCustomers();
        if (resCust && resCust.id) {
          POS.selectCustomer(resCust.id);
          const sel = document.getElementById('pos-customer-select');
          if (sel) sel.value = resCust.id;
        }
      }
    } catch (err) {
      App.toast('Lỗi lưu khách hàng: ' + err.message, 'error');
    }
  },

  async deleteCustomer(id) {
    if (id === 1) {
      App.toast('Không thể xóa khách lẻ mặc định của hệ thống', 'warning');
      return;
    }
    if (!confirm('Bạn có chắc chắn muốn xóa khách hàng này? Mọi thông tin công nợ và lịch sử mua hàng liên quan sẽ được xử lý an toàn.')) return;
    try {
      await API.deleteCustomer(id);
      App.toast('Đã xóa khách hàng thành công', 'success');
      this.loadCustomersTable();
      if (typeof POS !== 'undefined' && POS.loadCustomers) {
        await POS.loadCustomers();
      }
    } catch (err) {
      App.toast('Lỗi xóa khách hàng: ' + err.message, 'error');
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
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="supp-search-input" class="form-control" style="max-width: 320px;" placeholder="Tìm theo tên, mã NCC, SĐT, địa chỉ...">
            <select id="supp-search-by" class="form-control" style="max-width: 140px;">
              <option value="both">Code & Name</option>
              <option value="code">Code</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-excel" onclick="App.exportTable('suppliers')" title="Xuất file Excel danh sách nhà cung cấp">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất NCC
            </button>
            <button class="btn btn-outline btn-excel" onclick="App.exportTable('distributors')" title="Xuất file Excel danh sách nhà phân phối">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất NPP
            </button>
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
    document.getElementById('supp-search-by')?.addEventListener('change', () => this.loadSuppliersTable());
    this.loadSuppliersTable();
  },

  async loadSuppliersTable() {
    const q = document.getElementById('supp-search-input')?.value || '';
    const searchBy = document.getElementById('supp-search-by')?.value || 'both';
    try {
      const suppliers = await API.getSuppliers({ q, search: q, searchBy });
      const tbody = document.getElementById('suppliers-table-body');
      if (!tbody) return;

      let filtered = suppliers;
      if (q) {
        if (searchBy === 'code') {
          filtered = filtered.filter(s => this.matchesSearch(s, q, ['code']));
        } else if (searchBy === 'name') {
          filtered = filtered.filter(s => this.matchesSearch(s, q, ['name', 'company_name']));
        } else {
          filtered = filtered.filter(s => this.matchesSearch(s, q, ['name', 'code', 'phone', 'address', 'company_name', 'email', 'notes']));
        }
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Chưa có nhà cung cấp nào phù hợp</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(s => `
        <tr>
          <td><strong>${s.code}</strong></td>
          <td><strong>${s.name}</strong></td>
          <td>${s.phone || '---'}</td>
          <td>${s.address || '---'}</td>
          <td class="text-right tabular-nums font-bold" style="color: ${s.debt > 0 ? 'var(--color-danger)' : 'var(--color-success)'};">
            ${this.formatMoney(s.debt)}
          </td>
          <td><small style="color: var(--color-text-subtle);">${s.notes || ''}</small></td>
          <td class="text-right" style="white-space: nowrap;">
            ${s.debt > 0 ? `<button class="btn btn-sm btn-success" onclick="App.openPaySupplierDebtModal(${s.id}, '${s.name.replace(/'/g, "\\'")}', ${s.debt})">Trả nợ</button>` : ''}
            <button class="btn btn-sm btn-primary" onclick="App.openCreatePurchaseModal()">Nhập hàng</button>
            <button class="btn btn-sm btn-outline" onclick="App.openEditSupplierModal(${s.id})">Sửa</button>
            <button class="btn btn-sm btn-outline text-danger" style="color: var(--color-danger);" onclick="App.deleteSupplier(${s.id})">Xóa</button>
            <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('supplier', '${s.code}')" title="Xem lịch sử kiểm toán">Lịch sử</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải nhà cung cấp: ' + err.message, 'error');
    }
  },

  async exportSuppliersExcel() {
    try {
      const suppliers = await API.getSuppliers();
      const headers = ['Mã NCC', 'Tên nhà cung cấp', 'Số điện thoại', 'Địa chỉ', 'Công nợ phải trả NCC (VNĐ)', 'Ghi chú'];
      const rows = suppliers.map(s => [
        s.code,
        s.name,
        s.phone || '',
        s.address || '',
        s.debt || 0,
        s.notes || ''
      ]);
      await this.exportTableToExcel(headers, rows, 'DanhSachNhaCungCap', 'danh_sach_nha_cung_cap.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel nhà cung cấp: ' + err.message, 'error');
    }
  },

  openCreateSupplierModal() {
    const modal = document.getElementById('supplier-modal');
    const title = document.getElementById('supp-modal-title');
    if (title) title.textContent = 'Thêm Nhà cung cấp mới';
    document.getElementById('supp-id').value = '';
    document.getElementById('supp-code').value = '';
    document.getElementById('supp-name').value = '';
    document.getElementById('supp-phone').value = '';
    document.getElementById('supp-address').value = '';
    document.getElementById('supp-debt').value = '0';
    document.getElementById('supp-notes').value = '';
    modal.classList.add('active');
  },

  async openEditSupplierModal(id) {
    try {
      const suppliers = await API.getSuppliers();
      const s = suppliers.find(x => x.id === id);
      if (!s) return;

      const modal = document.getElementById('supplier-modal');
      const title = document.getElementById('supp-modal-title');
      if (title) title.textContent = 'Chỉnh sửa: ' + s.name;
      document.getElementById('supp-id').value = s.id;
      document.getElementById('supp-code').value = s.code;
      document.getElementById('supp-name').value = s.name;
      document.getElementById('supp-phone').value = s.phone || '';
      document.getElementById('supp-address').value = s.address || '';
      document.getElementById('supp-debt').value = s.debt || 0;
      document.getElementById('supp-notes').value = s.notes || '';
      modal.classList.add('active');
    } catch (e) {
      App.toast('Lỗi mở form nhà cung cấp: ' + e.message, 'error');
    }
  },

  async saveSupplierForm() {
    const id = document.getElementById('supp-id').value;
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
      if (id) {
        await API.updateSupplier(id, payload);
        App.toast('Cập nhật nhà cung cấp thành công', 'success');
      } else {
        await API.createSupplier(payload);
        App.toast('Thêm nhà cung cấp mới thành công', 'success');
      }
      document.getElementById('supplier-modal').classList.remove('active');
      this.renderSuppliersView();
    } catch (err) {
      App.toast('Lỗi lưu nhà cung cấp: ' + err.message, 'error');
    }
  },

  async deleteSupplier(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa nhà cung cấp này? Mọi thông tin nhập hàng và công nợ liên quan sẽ được bảo lưu theo quy định kiểm toán.')) return;
    try {
      await API.deleteSupplier(id);
      App.toast('Đã xóa nhà cung cấp thành công', 'success');
      this.renderSuppliersView();
    } catch (err) {
      App.toast('Lỗi xóa nhà cung cấp: ' + err.message, 'error');
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
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="ret-search-input" class="form-control" style="max-width: 320px;" placeholder="Tìm theo mã phiếu, khách hàng, lý do...">
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-excel" onclick="App.exportReturnsExcel()" title="Xuất file Excel danh sách trả hàng">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
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
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="returns-table-body">
                <tr><td colspan="9" class="empty-state">Đang tải danh sách trả hàng...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('ret-search-input')?.addEventListener('input', () => this.loadReturnsTable());
    this.loadReturnsTable();
  },

  async loadReturnsTable() {
    const q = document.getElementById('ret-search-input')?.value || '';
    try {
      const returns = await API.getReturns();
      const tbody = document.getElementById('returns-table-body');
      if (!tbody) return;

      let filtered = returns;
      if (q) {
        filtered = filtered.filter(r => this.matchesSearch(r, q, ['code', 'customer_name', 'notes']));
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Chưa có phiếu trả hàng phù hợp</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(r => `
        <tr>
          <td><strong>${r.code}</strong></td>
          <td>${r.created_at}</td>
          <td><strong>${r.customer_name}</strong></td>
          <td class="text-center"><span class="badge-tag badge-purple">${r.item_count} món</span></td>
          <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(r.total_amount)}</td>
          <td class="text-right tabular-nums" style="color: var(--color-danger); font-weight: 600;">${this.formatMoney(r.refund_amount)}</td>
          <td class="text-right tabular-nums" style="color: var(--color-success); font-weight: 600;">${this.formatMoney(r.debt_deduct_amount)}</td>
          <td><small style="color: var(--color-text-subtle);">${r.notes || ''}</small></td>
          <td class="text-right" style="white-space: nowrap;">
            <button class="btn btn-sm btn-outline" onclick="App.viewReturnDetail(${r.id})">Chi tiết</button>
            <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('return', '${r.code}')" title="Xem lịch sử kiểm toán">Lịch sử</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      App.toast('Lỗi tải phiếu trả hàng: ' + err.message, 'error');
    }
  },

  async exportReturnsExcel() {
    try {
      const returns = await API.getReturns();
      const headers = ['Mã phiếu trả', 'Thời gian', 'Khách hàng', 'Số mặt hàng', 'Tổng giá trị trả (VNĐ)', 'Tiền hoàn khách (VNĐ)', 'Cấn trừ nợ cũ (VNĐ)', 'Lý do trả hàng'];
      const rows = returns.map(r => [
        r.code,
        r.created_at,
        r.customer_name || 'Khách lẻ',
        r.item_count || 0,
        r.total_amount || 0,
        r.refund_amount || 0,
        r.debt_deduct_amount || 0,
        r.notes || ''
      ]);
      await this.exportTableToExcel(headers, rows, 'DanhSachTraHang', 'danh_sach_tra_hang.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel trả hàng: ' + err.message, 'error');
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
      this.returnCachedProducts = await API.getProducts();
      this.returnCachedProducts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.code}) - Tồn: ${p.stock} ${p.unit}`;
        prodSelect.appendChild(opt);
      });
    } catch (e) {}

    this.onReturnProductChange();

    document.getElementById('ret-qty').value = 1;
    document.getElementById('ret-qty').oninput = () => this.updateReturnTotals();
    document.getElementById('ret-price').oninput = () => this.updateReturnTotals();
  },

  onReturnProductChange() {
    const prodSelect = document.getElementById('ret-product-select');
    const unitSelect = document.getElementById('ret-unit-select');
    if (!prodSelect || !unitSelect) return;

    const prodId = parseInt(prodSelect.value);
    const p = this.returnCachedProducts?.find(x => x.id === prodId);

    unitSelect.innerHTML = '';
    if (!p) {
      unitSelect.innerHTML = '<option value="" data-conv="1">Đơn vị cơ bản</option>';
      document.getElementById('ret-price').value = 0;
      this.updateReturnTotals();
      return;
    }

    const availableUnits = [
      { unit_name: p.unit, conversion_rate: 1.0, sale_price: p.sale_price }
    ];
    if (p.units && Array.isArray(p.units)) {
      p.units.forEach(u => {
        if (!availableUnits.some(au => au.unit_name.toLowerCase() === u.unit_name.toLowerCase())) {
          availableUnits.push({
            unit_name: u.unit_name,
            conversion_rate: u.conversion_rate || 1.0,
            sale_price: u.sale_price || (p.sale_price * (u.conversion_rate || 1.0))
          });
        }
      });
    }

    availableUnits.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.unit_name;
      opt.textContent = `${u.unit_name} ${u.conversion_rate !== 1.0 ? `(x${u.conversion_rate})` : ''}`;
      opt.dataset.conv = u.conversion_rate;
      opt.dataset.price = u.sale_price;
      unitSelect.appendChild(opt);
    });

    this.onReturnUnitChange();
  },

  onReturnUnitChange() {
    const unitSelect = document.getElementById('ret-unit-select');
    if (!unitSelect) return;
    const opt = unitSelect.options[unitSelect.selectedIndex];
    if (opt && opt.dataset.price) {
      document.getElementById('ret-price').value = opt.dataset.price;
    }
    this.updateReturnTotals();
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

    const unitSelect = document.getElementById('ret-unit-select');
    const unitOpt = unitSelect?.options[unitSelect.selectedIndex];
    const unitName = unitOpt ? unitOpt.value : '';
    const unitConv = unitOpt ? (parseFloat(unitOpt.dataset.conv) || 1.0) : 1.0;

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
        unit: unitName,
        unit_conversion_rate: unitConv,
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

  async viewReturnDetail(returnId) {
    try {
      const r = await API.getReturn(returnId);
      const modal = document.getElementById('return-detail-modal');
      const title = document.getElementById('rd-title');
      const subtitle = document.getElementById('rd-subtitle');
      const body = document.getElementById('rd-body');
      const footer = document.getElementById('rd-footer');

      if (!modal || !body) return;

      if (title) title.textContent = `Phiếu Trả Hàng: ${r.code}`;
      if (subtitle) subtitle.textContent = `Thời gian: ${r.created_at} | Người lập: ${r.user_name || 'Thu ngân'}`;

      let fundText = 'Tiền mặt tại két';
      if (r.fund_type === 'bank') fundText = 'Chuyển khoản';

      body.innerHTML = `
        <div style="background: var(--color-surface-muted); padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 0.875rem;">
            <div>
              <span style="color: var(--color-text-secondary); display: block;">Khách hàng:</span>
              <strong style="font-size: 1rem; color: var(--color-text-main);">${r.customer_name || 'Khách lẻ'}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-secondary); display: block;">Nguồn hoàn tiền:</span>
              <strong>${fundText}</strong>
            </div>
            <div>
              <span style="color: var(--color-text-secondary); display: block;">Trạng thái:</span>
              <span class="badge-tag badge-green">Hoàn tất (Đã nhập lại kho)</span>
            </div>
          </div>
          ${r.notes ? `
            <div style="margin-top: 8px; font-size: 0.84rem; color: var(--color-text-secondary); border-top: 1px dashed var(--color-border); padding-top: 6px;">
              Lý do trả hàng: <em>${r.notes}</em>
            </div>
          ` : ''}
        </div>

        <div style="margin-bottom: 12px; font-weight: 600; color: var(--color-text-main); font-size: 0.95rem;">
          Danh sách mặt hàng hoàn trả:
        </div>
        <div class="table-responsive" style="max-height: 280px; margin-bottom: 16px;">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 40px;">STT</th>
                <th>Tên sản phẩm</th>
                <th>ĐVT</th>
                <th class="text-right">SL Trả</th>
                <th class="text-right">Đơn giá hoàn</th>
                <th class="text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              ${r.items && r.items.length > 0 ? r.items.map((it, idx) => `
                <tr>
                  <td class="text-center">${idx + 1}</td>
                  <td><strong>${it.product_name}</strong></td>
                  <td><span class="badge-tag badge-purple">${it.unit}</span></td>
                  <td class="text-right tabular-nums font-bold">${it.quantity}</td>
                  <td class="text-right tabular-nums">${this.formatMoney(it.return_price)}</td>
                  <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(it.subtotal)}</td>
                </tr>
              `).join('') : '<tr><td colspan="6" class="empty-state">Không có thông tin chi tiết</td></tr>'}
            </tbody>
          </table>
        </div>

        <div style="background: var(--color-surface-muted); padding: 14px 16px; border-radius: var(--radius-md); border: 1px solid var(--color-border);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 1.05rem;">
            <strong>Tổng giá trị hàng trả lại:</strong>
            <strong class="tabular-nums font-bold" style="color: var(--color-primary); font-size: 1.15rem;">${this.formatMoney(r.total_amount)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: var(--color-danger); border-top: 1px dashed var(--color-border); padding-top: 8px;">
            <span>Tiền mặt hoàn cho khách:</span>
            <span class="tabular-nums font-bold">-${this.formatMoney(r.refund_amount)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: var(--color-success); font-weight: 700;">
            <span>Giảm trừ vào nợ cũ của khách:</span>
            <span class="tabular-nums font-bold">-${this.formatMoney(r.debt_deduct_amount)}</span>
          </div>
        </div>
      `;

      footer.innerHTML = `
        <div>
          <button class="btn btn-outline" onclick="App.viewEntityTimeline('return', '${r.code}')" title="Xem lịch sử kiểm toán của phiếu trả này">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
            Lịch sử kiểm toán
          </button>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-outline" onclick="window.print()">In phiếu trả</button>
          <button class="btn btn-primary" data-close-modal="return-detail-modal">Đóng</button>
        </div>
      `;

      modal.classList.add('active');
    } catch (e) {
      App.toast('Không thể tải chi tiết phiếu trả hàng: ' + e.message, 'error');
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
            <button class="btn btn-outline btn-excel" onclick="App.exportCashFlowExcel()" title="Xuất file Excel sổ quỹ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
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

  async exportCashFlowExcel() {
    try {
      const type = document.getElementById('cf-type-filter')?.value || 'all';
      const fund = document.getElementById('cf-fund-filter')?.value || 'all';
      const res = await API.getCashFlow({ type, fund });
      const items = res.items || [];
      const headers = ['Mã phiếu', 'Thời gian', 'Loại phiếu', 'Hạng mục', 'Đối tượng', 'Tài khoản quỹ', 'Số tiền (VNĐ)', 'Mã chứng từ liên quan', 'Ghi chú'];
      const rows = items.map(item => [
        item.code,
        item.created_at,
        item.type === 'receipt' ? 'Phiếu thu (+)' : 'Phiếu chi (-)',
        item.category || '',
        item.target_name || '',
        item.fund_type === 'cash' ? 'Tiền mặt' : 'Ngân hàng',
        item.amount || 0,
        item.reference_code || '',
        item.notes || ''
      ]);
      await this.exportTableToExcel(headers, rows, 'SoQuyDongTien', 'so_quy_dong_tien.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel sổ quỹ: ' + err.message, 'error');
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
          <button class="btn btn-outline btn-excel" onclick="App.exportReportsExcel()" title="Xuất file Excel báo cáo doanh thu & lợi nhuận">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Xuất Excel
          </button>
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
      const res = await API.getOrders();
      const tbody = document.getElementById('orders-report-tbody');
      if (!tbody) return;

      const orders = this.normalizeOrders(res).filter(Boolean);
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
          <td class="text-right" style="white-space: nowrap;">
            <button class="btn btn-sm btn-outline" onclick="App.viewOrderDetail(${o.id})">Chi tiết</button>
            <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('order', '${o.code}')" title="Xem lịch sử kiểm toán">Lịch sử</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      const tbody = document.getElementById('orders-report-tbody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" class="empty-state text-danger">Lỗi tải báo cáo: ${err.message}</td></tr>`;
      }
      App.toast('Lỗi tải báo cáo: ' + err.message, 'error');
    }
  },

  async exportReportsExcel() {
    try {
      const res = await API.getOrders();
      const orders = this.normalizeOrders(res).filter(Boolean);
      const headers = ['Mã đơn hàng', 'Thời gian', 'Khách hàng', 'Tiền hàng (VNĐ)', 'Chiết khấu (VNĐ)', 'Thuế VAT (VNĐ)', 'Khách cần trả (VNĐ)', 'Khách đã trả (VNĐ)', 'Ghi nợ (VNĐ)', 'Lợi nhuận gộp (VNĐ)', 'Trạng thái'];
      const statusMap = { completed: 'Đã hoàn thành', ordered: 'Khách đang đặt', draft: 'Bản nháp', cancelled: 'Đã hủy' };
      const rows = orders.map(o => [
        o.code,
        o.created_at,
        o.customer_name || 'Khách lẻ',
        o.total_amount || 0,
        o.discount || 0,
        o.vat_amount || 0,
        o.final_amount || 0,
        o.paid_amount || 0,
        o.debt_amount || 0,
        o.profit || 0,
        statusMap[o.status] || o.status || 'Đã hoàn thành'
      ]);
      await this.exportTableToExcel(headers, rows, 'BaoCaoDoanhThu', 'bao_cao_doanh_thu_loi_nhuan.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel báo cáo: ' + err.message, 'error');
    }
  },

  // ==========================================
  // 9. ORDERS & INVOICES VIEW (Hóa đơn & Đơn hàng)
  // ==========================================
  async renderOrdersView() {
    const container = document.getElementById('view-orders');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="order-search-input" class="form-control" style="max-width: 280px;" placeholder="Tìm theo mã đơn, tên/SĐT khách...">
            <select id="order-search-by" class="form-control" style="max-width: 140px;">
              <option value="both">Code & Name</option>
              <option value="code">Code</option>
              <option value="name">Name</option>
            </select>
            <select id="order-period-filter" class="form-control" style="max-width: 140px;">
              <option value="all">Mọi thời gian</option>
              <option value="today">Hôm nay</option>
              <option value="yesterday">Hôm qua</option>
              <option value="7days">7 ngày qua</option>
              <option value="this_month">Tháng này</option>
            </select>
            <select id="order-status-filter" class="form-control" style="max-width: 175px;">
              <option value="all">Tất cả trạng thái</option>
              <option value="completed">Đã hoàn thành</option>
              <option value="ordered">Khách đang đặt (Đơn đặt)</option>
              <option value="draft">Bản nháp</option>
              <option value="cancelled">Đã hủy</option>
            </select>
            <select id="order-payment-filter" class="form-control" style="max-width: 140px;">
              <option value="all">Tất cả PTTT</option>
              <option value="cash">Tiền mặt</option>
              <option value="bank">Chuyển khoản</option>
              <option value="debt">Ghi nợ</option>
            </select>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-excel" onclick="App.exportTable('invoices')" title="Xuất file Excel danh sách hóa đơn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
            <button class="btn btn-primary" onclick="App.navigate('pos')">+ Bán hàng tại quầy (F9)</button>
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
                  <th class="text-right">Giảm giá/KM</th>
                  <th class="text-right">Khách cần trả</th>
                  <th class="text-right">Đã thanh toán</th>
                  <th class="text-right">Còn nợ</th>
                  <th class="text-center">Trạng thái</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="orders-table-body">
                <tr><td colspan="10" class="empty-state">Đang tải danh sách hóa đơn...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('order-search-input')?.addEventListener('input', () => this.loadOrdersTable());
    document.getElementById('order-search-by')?.addEventListener('change', () => this.loadOrdersTable());
    document.getElementById('order-period-filter')?.addEventListener('change', () => this.loadOrdersTable());
    document.getElementById('order-status-filter')?.addEventListener('change', () => this.loadOrdersTable());
    document.getElementById('order-payment-filter')?.addEventListener('change', () => this.loadOrdersTable());

    this.loadOrdersTable();
  },

  async loadOrdersTable() {
    this._ordersLoadSeq = (this._ordersLoadSeq || 0) + 1;
    const currentSeq = this._ordersLoadSeq;

    const q = document.getElementById('order-search-input')?.value || '';
    const searchBy = document.getElementById('order-search-by')?.value || 'both';
    const period = document.getElementById('order-period-filter')?.value || 'all';
    const status = document.getElementById('order-status-filter')?.value || 'all';
    const payment = document.getElementById('order-payment-filter')?.value || 'all';

    try {
      const res = await API.getOrders({ period, status, payment_method: payment, q, search: q, searchBy });
      if (this._ordersLoadSeq !== currentSeq) return;

      const tbody = document.getElementById('orders-table-body');
      if (!tbody) return;

      const orders = this.normalizeOrders(res);
      let filtered = orders.filter(Boolean);
      if (q) {
        if (searchBy === 'code') {
          filtered = filtered.filter(o => this.matchesSearch(o, q, ['code']));
        } else if (searchBy === 'name') {
          filtered = filtered.filter(o => this.matchesSearch(o, q, ['customer_name']));
        } else {
          filtered = filtered.filter(o => this.matchesSearch(o, q, ['code', 'customer_name', 'customer_phone', 'notes', 'promotion_code']));
        }
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Không tìm thấy hóa đơn / đơn hàng phù hợp</td></tr>`;
        return;
      }

      const pmMap = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Ghi nợ' };

      tbody.innerHTML = filtered.map(o => {
        let statusBadge = '<span class="badge-tag badge-green">Đã hoàn thành</span>';
        if (o.status === 'ordered') {
          statusBadge = '<span class="badge-tag badge-amber" title="Đơn đặt hàng - Chưa xuất kho">Khách đang đặt</span>';
        } else if (o.status === 'draft') {
          statusBadge = '<span class="badge-tag badge-gray" title="Hóa đơn nháp - Nhân bản">Bản nháp</span>';
        } else if (o.status === 'cancelled') {
          statusBadge = '<span class="badge-tag badge-red">Đã hủy</span>';
        }

        const pmLabel = pmMap[o.payment_method] || (o.payment_method || 'Tiền mặt');
        const hasPromo = o.promotion_code || (o.discount > 0);

        return `
          <tr style="${o.status === 'cancelled' ? 'opacity: 0.65; background: #fafafa;' : ''}">
            <td>
              <strong>${o.code}</strong><br>
              <small style="color: var(--color-text-subtle);">${pmLabel}</small>
            </td>
            <td>${o.created_at}</td>
            <td>
              <strong>${o.customer_name || 'Khách lẻ'}</strong>
              ${o.customer_phone ? `<br><small style="color: var(--color-text-subtle);">${o.customer_phone}</small>` : ''}
            </td>
            <td class="text-right tabular-nums">${this.formatMoney(o.total_amount)}</td>
            <td class="text-right tabular-nums" style="color: ${o.discount > 0 ? 'var(--color-danger)' : 'var(--color-text-subtle)'};">
              ${o.discount > 0 ? '-' + this.formatMoney(o.discount) : '0 đ'}
              ${o.promotion_code ? `<br><span class="badge-tag badge-purple" style="font-size: 0.68rem;">${o.promotion_code}</span>` : ''}
            </td>
            <td class="text-right tabular-nums font-bold" style="color: var(--color-primary);">${this.formatMoney(o.final_amount)}</td>
            <td class="text-right tabular-nums" style="color: var(--color-success);">${this.formatMoney(o.paid_amount)}</td>
            <td class="text-right tabular-nums font-bold" style="color: ${o.debt_amount > 0 ? 'var(--color-danger)' : 'var(--color-text-subtle)'};">
              ${this.formatMoney(o.debt_amount)}
            </td>
            <td class="text-center">${statusBadge}</td>
            <td class="text-right" style="white-space: nowrap;">
              <button class="btn btn-sm btn-outline" onclick="App.openInvoiceDetailModal(${o.id})" title="Xem & Quản lý hóa đơn">👁 Chi tiết</button>
              <button class="btn btn-sm btn-outline" onclick="App.cloneOrder(${o.id})" title="Nhân bản đơn sang POS">Nhân bản</button>
              ${o.status !== 'cancelled' ? `
                <button class="btn btn-sm btn-outline" onclick="App.openAdjustOrderModal(${o.id})" title="Điều chỉnh trạng thái / ghi chú">Sửa</button>
                <button class="btn btn-sm btn-outline text-danger" style="color: var(--color-danger);" onclick="App.cancelOrder(${o.id})" title="Hủy hóa đơn / hoàn kho">Hủy</button>
              ` : ''}
              <button class="btn btn-sm btn-outline" onclick="App.viewEntityTimeline('order', '${o.code}')" title="Xem lịch sử kiểm toán">Lịch sử</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      if (this._ordersLoadSeq !== currentSeq) return;
      const tbody = document.getElementById('orders-table-body');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="10" class="empty-state text-danger">Lỗi tải danh sách hóa đơn: ${err.message}</td></tr>`;
      }
      App.toast('Lỗi tải danh sách hóa đơn: ' + err.message, 'error');
    }
  },

  async exportOrdersExcel() {
    try {
      const period = document.getElementById('order-period-filter')?.value || 'all';
      const status = document.getElementById('order-status-filter')?.value || 'all';
      const payment = document.getElementById('order-payment-filter')?.value || 'all';
      const res = await API.getOrders({ period, status, payment_method: payment });
      const orders = this.normalizeOrders(res).filter(Boolean);
      const headers = ['Mã đơn', 'Thời gian', 'Khách hàng', 'SĐT khách', 'Tiền hàng (VNĐ)', 'Chiết khấu (VNĐ)', 'Mã khuyến mãi', 'Thuế VAT (VNĐ)', 'Khách cần trả (VNĐ)', 'Đã thanh toán (VNĐ)', 'Còn ghi nợ (VNĐ)', 'PTTT', 'Trạng thái', 'Ghi chú'];
      const pmMap = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Ghi nợ' };
      const statusMap = { completed: 'Đã hoàn thành', ordered: 'Khách đang đặt', draft: 'Bản nháp', cancelled: 'Đã hủy' };
      const rows = orders.map(o => [
        o.code,
        o.created_at,
        o.customer_name || 'Khách lẻ',
        o.customer_phone || '',
        o.total_amount || 0,
        o.discount || 0,
        o.promotion_code || '',
        o.vat_amount || 0,
        o.final_amount || 0,
        o.paid_amount || 0,
        o.debt_amount || 0,
        pmMap[o.payment_method] || (o.payment_method || 'Tiền mặt'),
        statusMap[o.status] || o.status || 'Đã hoàn thành',
        o.notes || ''
      ]);
      await this.exportTableToExcel(headers, rows, 'DanhSachHoaDon', 'danh_sach_hoa_don.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel hóa đơn: ' + err.message, 'error');
    }
  },

  async viewOrderDetail(orderId) {
    try {
      const o = await API.getOrder(orderId);
      const modal = document.getElementById('order-detail-modal');
      const title = document.getElementById('od-title');
      const subtitle = document.getElementById('od-subtitle');
      const body = document.getElementById('od-body');
      const footer = document.getElementById('od-footer');

      if (!modal || !body) return;

      let statusBadge = '<span class="badge-tag badge-green">Đã hoàn thành</span>';
      if (o.status === 'ordered') statusBadge = '<span class="badge-tag badge-amber">Khách đang đặt (Đơn đặt hàng)</span>';
      if (o.status === 'draft') statusBadge = '<span class="badge-tag badge-gray">Bản nháp</span>';
      if (o.status === 'cancelled') statusBadge = '<span class="badge-tag badge-red">Đã hủy</span>';

      const pmMap = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Ghi nợ' };
      const pmLabel = pmMap[o.payment_method] || (o.payment_method || 'Tiền mặt');

      title.textContent = `Hóa đơn: ${o.code}`;
      subtitle.innerHTML = `Thời gian: <strong>${o.created_at}</strong> | Trạng thái: ${statusBadge}`;

      body.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; background: var(--color-surface-muted); padding: 12px; border-radius: var(--radius-md);">
          <div>
            <div style="font-size: 0.8125rem; color: var(--color-text-secondary);">Khách hàng:</div>
            <div style="font-weight: 700; font-size: 1rem; color: var(--color-text-main);">${o.customer_name || 'Khách lẻ'}</div>
            <div style="font-size: 0.8125rem; color: var(--color-text-subtle);">${o.customer_phone || ''}</div>
          </div>
          <div>
            <div style="font-size: 0.8125rem; color: var(--color-text-secondary);">Hình thức thanh toán:</div>
            <div style="font-weight: 700;">${pmLabel}</div>
            ${o.promotion_code ? `<div style="font-size: 0.8125rem; color: var(--color-purple-text); font-weight: 600;">Khuyến mãi: ${o.promotion_code}</div>` : ''}
          </div>
        </div>

        <div style="font-weight: 600; margin-bottom: 8px;">Danh sách sản phẩm (${(o.items || []).length} mặt hàng):</div>
        <table class="table" style="font-size: 0.85rem; margin-bottom: 16px;">
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th class="text-center">ĐVT</th>
              <th class="text-center">SL</th>
              <th class="text-right">Đơn giá</th>
              <th class="text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            ${(o.items || []).map(i => `
              <tr>
                <td>
                  <strong>${i.product_name}</strong>
                  ${i.unit_conversion_rate > 1 ? `<br><small style="color: var(--color-text-subtle);">(Quy đổi: x${i.unit_conversion_rate})</small>` : ''}
                  ${i.is_gift ? '<br><span class="badge-tag badge-purple">Hàng tặng KM</span>' : ''}
                </td>
                <td class="text-center"><strong>${i.unit || 'Cái'}</strong></td>
                <td class="text-center font-bold">${i.quantity}</td>
                <td class="text-right tabular-nums">${this.formatMoney(i.sale_price)}</td>
                <td class="text-right tabular-nums font-bold">${this.formatMoney(i.subtotal)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 12px; line-height: 1.8;">
          <div style="display: flex; justify-content: space-between;">
            <span>Tổng tiền hàng:</span>
            <span class="tabular-nums font-bold">${this.formatMoney(o.total_amount)}</span>
          </div>
          ${o.discount > 0 ? `
            <div style="display: flex; justify-content: space-between; color: var(--color-danger);">
              <span>Chiết khấu / Giảm giá:</span>
              <span class="tabular-nums font-bold">-${this.formatMoney(o.discount)}</span>
            </div>
          ` : ''}
          ${o.vat_amount > 0 ? `
            <div style="display: flex; justify-content: space-between;">
              <span>Thuế VAT (${o.vat_percent}%):</span>
              <span class="tabular-nums">+${this.formatMoney(o.vat_amount)}</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; font-size: 1.05rem; font-weight: 800; border-top: 1px dashed var(--color-border); padding-top: 6px; margin-top: 6px;">
            <span>KHÁCH CẦN TRẢ:</span>
            <span class="tabular-nums" style="color: var(--color-primary);">${this.formatMoney(o.final_amount)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Khách đã thanh toán:</span>
            <span class="tabular-nums font-bold" style="color: var(--color-success);">${this.formatMoney(o.paid_amount)}</span>
          </div>
          ${o.debt_amount > 0 ? `
            <div style="display: flex; justify-content: space-between; color: var(--color-danger); font-weight: 700;">
              <span>Ghi nợ:</span>
              <span class="tabular-nums">${this.formatMoney(o.debt_amount)}</span>
            </div>
          ` : ''}
          ${o.profit !== undefined ? `
            <div style="display: flex; justify-content: space-between; font-size: 0.8125rem; color: var(--color-text-muted); border-top: 1px dotted var(--color-border); margin-top: 6px; padding-top: 4px;">
              <span>Lợi nhuận gộp đơn hàng:</span>
              <span class="tabular-nums font-bold" style="color: var(--color-success);">+${this.formatMoney(o.profit)}</span>
            </div>
          ` : ''}
        </div>
        ${o.notes ? `<div style="margin-top: 10px; font-size: 0.8125rem; color: var(--color-text-subtle);"><strong>Ghi chú:</strong> ${o.notes}</div>` : ''}
      `;

      footer.innerHTML = `
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-outline" onclick="App.viewEntityTimeline('order', '${o.code}')" title="Xem lịch sử kiểm toán">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
            Lịch sử
          </button>
          <button class="btn btn-outline" onclick="App.cloneOrder(${o.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Nhân bản sang POS
          </button>
          ${o.status !== 'cancelled' ? `
            <button class="btn btn-outline text-danger" style="color: var(--color-danger);" onclick="App.cancelOrder(${o.id})">Hủy đơn</button>
          ` : ''}
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary" onclick="POS.showReceiptModal(${JSON.stringify(o).replace(/"/g, '&quot;')})">In lại hóa đơn</button>
          <button class="btn btn-outline" data-close-modal="order-detail-modal">Đóng</button>
        </div>
      `;

      modal.classList.add('active');
    } catch (e) {
      App.toast('Không thể tải chi tiết hóa đơn: ' + e.message, 'error');
    }
  },

  async cloneOrder(orderId) {
    try {
      const res = await API.cloneOrder(orderId);
      this.navigate('pos');
      POS.loadOrder(res.order);
      // close modal if open
      document.getElementById('order-detail-modal')?.classList.remove('active');
    } catch (err) {
      App.toast('Lỗi nhân bản đơn hàng: ' + err.message, 'error');
    }
  },

  async openAdjustOrderModal(orderId) {
    try {
      const o = await API.getOrder(orderId);
      document.getElementById('oa-order-id').value = o.id;
      document.getElementById('oa-code').value = o.code;
      document.getElementById('oa-customer-name').value = o.customer_name || '';
      document.getElementById('oa-status').value = o.status || 'completed';
      document.getElementById('oa-notes').value = o.notes || '';
      document.getElementById('order-adjust-modal').classList.add('active');
    } catch (err) {
      App.toast('Lỗi mở form điều chỉnh: ' + err.message, 'error');
    }
  },

  async saveOrderAdjustment() {
    const id = document.getElementById('oa-order-id').value;
    const customerName = document.getElementById('oa-customer-name').value.trim();
    const status = document.getElementById('oa-status').value;
    const notes = document.getElementById('oa-notes').value.trim();

    try {
      await API.updateOrder(id, { customer_name: customerName, status: status, notes: notes });
      App.toast('Cập nhật đơn hàng thành công!', 'success');
      document.getElementById('order-adjust-modal').classList.remove('active');
      this.loadOrdersTable();
      this.loadTopFundSummary();
    } catch (err) {
      App.toast('Lỗi điều chỉnh đơn hàng: ' + err.message, 'error');
    }
  },

  async cancelOrder(orderId) {
    if (!confirm('Bạn có chắc chắn muốn HỦY đơn hàng này? Hệ thống sẽ tự động hoàn lại tồn kho, cấn trừ công nợ và hoàn dòng tiền!')) {
      return;
    }

    try {
      await API.deleteOrder(orderId);
      App.toast('Đã hủy đơn hàng thành công. Tồn kho và công nợ đã được hoàn lại!', 'success');
      document.getElementById('order-detail-modal')?.classList.remove('active');
      this.loadOrdersTable();
      this.loadTopFundSummary();
    } catch (err) {
      App.toast('Lỗi hủy đơn hàng: ' + err.message, 'error');
    }
  },

  // ==========================================
  // INVOICE DETAIL & MANAGEMENT (CRUD + DUPLICATE)
  // ==========================================
  currentInvoiceModalData: null,
  isInvoiceEditing: false,

  async openInvoiceDetailModal(invoiceId) {
    try {
      const inv = await API.getInvoice(invoiceId);
      this.currentInvoiceModalData = inv;
      this.isInvoiceEditing = false;

      const modal = document.getElementById('invoice-detail-modal');
      if (!modal) return;

      const idElem = document.getElementById('inv-modal-id');
      const titleElem = document.getElementById('inv-modal-title');
      const subtitleElem = document.getElementById('inv-modal-subtitle');
      if (idElem) idElem.value = inv.id;
      if (titleElem) titleElem.textContent = `Hóa đơn: ${inv.code || ('HD' + inv.id)}`;
      if (subtitleElem) subtitleElem.textContent = `Thời gian: ${inv.created_at || '---'} | Nhân viên: ${inv.user_name || 'Hệ thống'}`;

      const codeInput = document.getElementById('inv-modal-code');
      const custInput = document.getElementById('inv-modal-customer');
      const dateInput = document.getElementById('inv-modal-date');
      const statusSelect = document.getElementById('inv-modal-status');
      const notesInput = document.getElementById('inv-modal-notes');

      if (codeInput) codeInput.value = inv.code || '';
      if (custInput) {
        custInput.value = inv.customer_name || 'Khách lẻ';
        custInput.readOnly = true;
      }
      if (dateInput) dateInput.value = inv.created_at || '';
      if (statusSelect) {
        statusSelect.value = inv.status || 'completed';
        statusSelect.disabled = true;
      }
      if (notesInput) {
        notesInput.value = inv.notes || '';
        notesInput.readOnly = true;
      }

      // Render line-items
      const itemsBody = document.getElementById('inv-modal-items-body');
      if (itemsBody) {
        const items = inv.items || [];
        if (items.length === 0) {
          itemsBody.innerHTML = `<tr><td colspan="5" class="empty-state">Không có mặt hàng nào</td></tr>`;
        } else {
          itemsBody.innerHTML = items.map(item => `
            <tr>
              <td>
                <strong>${item.product_name}</strong>
                ${item.product_code ? `<br><small style="color: var(--color-text-subtle);">${item.product_code}</small>` : ''}
                ${item.is_gift ? '<br><span class="badge-tag badge-purple">Hàng tặng KM</span>' : ''}
              </td>
              <td class="text-center"><strong>${item.unit || 'Cái'}</strong></td>
              <td class="text-center font-bold">${item.quantity}</td>
              <td class="text-right tabular-nums">${this.formatMoney(item.sale_price)}</td>
              <td class="text-right tabular-nums font-bold">${this.formatMoney(item.subtotal !== undefined ? item.subtotal : (item.quantity * item.sale_price))}</td>
            </tr>
          `).join('');
        }
      }

      // Summary totals
      const totalElem = document.getElementById('inv-modal-total');
      const discElem = document.getElementById('inv-modal-discount');
      const vatElem = document.getElementById('inv-modal-vat');
      const finalElem = document.getElementById('inv-modal-final');
      const paidElem = document.getElementById('inv-modal-paid');
      const debtElem = document.getElementById('inv-modal-debt');

      if (totalElem) totalElem.textContent = this.formatMoney(inv.total_amount || 0);
      if (discElem) discElem.textContent = '-' + this.formatMoney(inv.discount || 0);
      if (vatElem) vatElem.textContent = '+' + this.formatMoney(inv.vat_amount || 0);
      if (finalElem) finalElem.textContent = this.formatMoney(inv.final_amount || 0);
      if (paidElem) paidElem.textContent = this.formatMoney(inv.paid_amount || 0);
      if (debtElem) debtElem.textContent = this.formatMoney(inv.debt_amount || 0);

      // Buttons
      const btnEdit = document.getElementById('inv-btn-edit');
      const btnSave = document.getElementById('inv-btn-save');
      if (btnEdit) {
        btnEdit.style.display = 'inline-block';
        btnEdit.textContent = 'Sửa';
      }
      if (btnSave) btnSave.style.display = 'none';

      modal.classList.add('active');
    } catch (err) {
      this.toast('Lỗi tải chi tiết hóa đơn: ' + err.message, 'error');
    }
  },

  toggleEditInvoiceModal() {
    this.isInvoiceEditing = !this.isInvoiceEditing;
    const custInput = document.getElementById('inv-modal-customer');
    const statusSelect = document.getElementById('inv-modal-status');
    const notesInput = document.getElementById('inv-modal-notes');
    const btnEdit = document.getElementById('inv-btn-edit');
    const btnSave = document.getElementById('inv-btn-save');

    if (this.isInvoiceEditing) {
      if (custInput) custInput.readOnly = false;
      if (statusSelect) statusSelect.disabled = false;
      if (notesInput) notesInput.readOnly = false;
      if (btnEdit) btnEdit.textContent = 'Hủy sửa';
      if (btnSave) btnSave.style.display = 'inline-block';
      this.toast('Đã bật chế độ sửa hóa đơn. Bạn có thể thay đổi khách hàng, trạng thái và ghi chú.', 'info');
    } else {
      if (custInput) {
        custInput.value = this.currentInvoiceModalData?.customer_name || 'Khách lẻ';
        custInput.readOnly = true;
      }
      if (statusSelect) {
        statusSelect.value = this.currentInvoiceModalData?.status || 'completed';
        statusSelect.disabled = true;
      }
      if (notesInput) {
        notesInput.value = this.currentInvoiceModalData?.notes || '';
        notesInput.readOnly = true;
      }
      if (btnEdit) btnEdit.textContent = 'Sửa';
      if (btnSave) btnSave.style.display = 'none';
    }
  },

  async saveInvoiceModal() {
    const id = document.getElementById('inv-modal-id')?.value;
    if (!id) return;
    const customer_name = document.getElementById('inv-modal-customer')?.value?.trim();
    const status = document.getElementById('inv-modal-status')?.value;
    const notes = document.getElementById('inv-modal-notes')?.value?.trim();

    try {
      await API.updateInvoice(id, { customer_name, status, notes });
      this.toast('Cập nhật hóa đơn thành công!', 'success');
      this.isInvoiceEditing = false;
      await this.openInvoiceDetailModal(id);
      this.loadOrdersTable();
      this.loadTopFundSummary();
    } catch (err) {
      this.toast('Lỗi cập nhật hóa đơn: ' + err.message, 'error');
    }
  },

  async deleteInvoiceModal() {
    const id = document.getElementById('inv-modal-id')?.value;
    if (!id) return;
    if (!confirm('Bạn có chắc chắn muốn xóa hóa đơn này? Tồn kho và công nợ sẽ được hoàn lại.')) return;
    try {
      await API.deleteInvoice(id);
      this.toast('Đã xóa hóa đơn thành công!', 'success');
      document.getElementById('invoice-detail-modal')?.classList.remove('active');
      this.loadOrdersTable();
      this.loadTopFundSummary();
    } catch (err) {
      this.toast('Lỗi xóa hóa đơn: ' + err.message, 'error');
    }
  },

  async duplicateInvoiceModal() {
    const id = document.getElementById('inv-modal-id')?.value;
    if (!id) return;
    try {
      const res = await API.duplicateInvoice(id);
      this.toast(`Đã nhân bản hóa đơn thành công! (Mã hóa đơn mới: ID #${res.id})`, 'success');
      document.getElementById('invoice-detail-modal')?.classList.remove('active');
      this.loadOrdersTable();
      await this.openInvoiceDetailModal(res.id);
    } catch (err) {
      this.toast('Lỗi nhân bản hóa đơn: ' + err.message, 'error');
    }
  },

  // ==========================================
  // CUSTOMER DETAIL & ORDER SUMMARY MODAL
  // ==========================================
  async openCustomerDetailModal(customerId) {
    try {
      const customers = await API.getCustomers();
      const customer = customers.find(c => c.id == customerId);
      if (!customer) {
        this.toast('Không tìm thấy thông tin khách hàng', 'error');
        return;
      }

      let orderCount = 0;
      try {
        const countRes = await API.getCustomerOrdersCount(customerId);
        orderCount = countRes.orderCount !== undefined ? countRes.orderCount : 0;
      } catch (ce) {
        console.warn('Could not fetch customer order count', ce);
      }

      let customerOrders = [];
      try {
        const res = await API.getOrders({ customer_id: customerId, limit: 10 });
        customerOrders = this.normalizeOrders(res).filter(Boolean);
      } catch (oe) {
        console.warn('Could not fetch customer orders', oe);
      }

      const modal = document.getElementById('customer-detail-modal');
      if (!modal) return;

      document.getElementById('cdm-name').textContent = customer.name;
      document.getElementById('cdm-code').textContent = `Mã: ${customer.code} | Ngày tạo: ${customer.created_at || '---'}`;
      document.getElementById('cdm-phone').textContent = customer.phone || 'Chưa cập nhật';
      document.getElementById('cdm-group').textContent = customer.group_name || 'Khách lẻ';
      document.getElementById('cdm-address').textContent = customer.address || 'Chưa cập nhật';

      document.getElementById('cdm-order-count').textContent = orderCount;
      document.getElementById('cdm-total-spent').textContent = this.formatMoney(customer.total_spent || 0);
      document.getElementById('cdm-debt').textContent = this.formatMoney(customer.debt || 0);

      const recentTbody = document.getElementById('cdm-recent-orders-body');
      if (recentTbody) {
        if (!customerOrders || customerOrders.length === 0) {
          recentTbody.innerHTML = `<tr><td colspan="5" class="empty-state">Khách hàng chưa có đơn hàng nào</td></tr>`;
        } else {
          const statusClassMap = { completed: 'badge-green', ordered: 'badge-amber', draft: 'badge-gray', cancelled: 'badge-red' };
          const statusTextMap = { completed: 'Hoàn thành', ordered: 'Đang đặt', draft: 'Bản nháp', cancelled: 'Đã hủy' };
          recentTbody.innerHTML = customerOrders.map(o => `
            <tr>
              <td><strong>${o.code}</strong></td>
              <td>${o.created_at}</td>
              <td class="text-right font-bold tabular-nums">${this.formatMoney(o.final_amount)}</td>
              <td class="text-center">
                <span class="badge-tag ${statusClassMap[o.status] || 'badge-green'}">
                  ${statusTextMap[o.status] || o.status || 'Hoàn thành'}
                </span>
              </td>
              <td class="text-right" style="white-space: nowrap;">
                <button class="btn btn-sm btn-outline" onclick="document.getElementById('customer-detail-modal').classList.remove('active'); App.openInvoiceDetailModal(${o.id});">
                  Xem HĐ
                </button>
              </td>
            </tr>
          `).join('');
        }
      }

      const viewAllBtn = document.getElementById('cdm-view-all-orders-btn');
      if (viewAllBtn) {
        viewAllBtn.onclick = () => {
          modal.classList.remove('active');
          this.navigate('orders');
          const searchInput = document.getElementById('order-search-input');
          if (searchInput) {
            searchInput.value = customer.name;
            this.loadOrdersTable();
          }
        };
      }

      modal.classList.add('active');
    } catch (err) {
      this.toast('Lỗi tải thông tin chi tiết khách hàng: ' + err.message, 'error');
    }
  },

  // ==========================================
  // 10. PROMOTIONS VIEW (Chương trình khuyến mãi)
  // ==========================================
  async renderPromotionsView() {
    const container = document.getElementById('view-promotions');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
            <input type="text" id="promo-search-input" class="form-control" style="max-width: 280px;" placeholder="Tìm theo tên, mã khuyến mãi...">
            <select id="promo-active-filter" class="form-control" style="max-width: 170px;">
              <option value="all">Tất cả chương trình</option>
              <option value="active">Đang áp dụng</option>
            </select>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-outline btn-excel" onclick="App.exportPromotionsExcel()" title="Xuất file Excel danh sách khuyến mãi">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
            <button class="btn btn-primary" onclick="App.openCreatePromotionModal()">+ Thêm khuyến mãi</button>
          </div>
        </div>
        <div class="card-body" style="padding: 0;">
          <div class="table-responsive">
            <table class="table">
              <thead>
                <tr>
                  <th>Mã KM</th>
                  <th>Tên chương trình</th>
                  <th>Hình thức khuyến mãi</th>
                  <th class="text-right">Mức ưu đãi</th>
                  <th class="text-right">Đơn tối thiểu</th>
                  <th class="text-center">Thời gian áp dụng</th>
                  <th class="text-center">Kích hoạt</th>
                  <th class="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="promotions-table-body">
                <tr><td colspan="8" class="empty-state">Đang tải chương trình khuyến mãi...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.getElementById('promo-search-input')?.addEventListener('input', () => this.loadPromotionsTable());
    document.getElementById('promo-active-filter')?.addEventListener('change', () => this.loadPromotionsTable());
    this.loadPromotionsTable();
  },

  async loadPromotionsTable() {
    const q = document.getElementById('promo-search-input')?.value || '';
    const activeFilter = document.getElementById('promo-active-filter')?.value || 'all';

    try {
      const promotions = await API.getPromotions(activeFilter === 'active');
      const tbody = document.getElementById('promotions-table-body');
      if (!tbody) return;

      let filtered = promotions;
      if (q) {
        filtered = filtered.filter(p => this.matchesSearch(p, q, ['code', 'name', 'type', 'notes']));
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Không tìm thấy chương trình khuyến mãi nào</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map(p => {
        let typeText = 'Giảm % đơn hàng';
        let valText = `${p.discount_value}%`;
        if (p.type === 'order_discount_amount') {
          typeText = 'Giảm tiền mặt';
          valText = this.formatMoney(p.discount_value);
        } else if (p.type === 'buy_x_get_y') {
          typeText = 'Mua X tặng Y';
          valText = `Mua ${p.buy_quantity} tặng ${p.gift_quantity}`;
        }

        const dateRange = (p.start_date || p.end_date)
          ? `${p.start_date || '---'} → ${p.end_date || '---'}`
          : '<span style="color: var(--color-text-subtle);">Vô thời hạn</span>';

        return `
          <tr>
            <td><strong>${p.code}</strong></td>
            <td>
              <div style="font-weight: 600; color: var(--color-text-main);">${p.name}</div>
              <small style="color: var(--color-text-subtle);">${p.notes || ''}</small>
            </td>
            <td><span class="badge-tag badge-purple">${typeText}</span></td>
            <td class="text-right font-bold tabular-nums" style="color: var(--color-primary); font-size: 0.95rem;">${valText}</td>
            <td class="text-right tabular-nums">${p.min_order_amount > 0 ? this.formatMoney(p.min_order_amount) : '<span style="color: var(--color-text-disabled);">Không yêu cầu</span>'}</td>
            <td class="text-center" style="font-size: 0.8125rem;">${dateRange}</td>
            <td class="text-center">
              <button class="btn btn-sm ${p.is_active ? 'btn-success' : 'btn-outline'}" onclick="App.togglePromotion(${p.id})" title="Nhấp để bật/tắt">
                ${p.is_active ? 'Đang bật' : 'Đã tắt'}
              </button>
            </td>
            <td class="text-right">
              <button class="btn btn-sm btn-outline" onclick="App.openEditPromotionModal(${p.id})">Sửa</button>
              <button class="btn btn-sm btn-outline text-danger" style="color: var(--color-danger);" onclick="App.deletePromotion(${p.id})">Xóa</button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      App.toast('Lỗi tải danh sách khuyến mãi: ' + err.message, 'error');
    }
  },

  async exportPromotionsExcel() {
    try {
      const promotions = await API.getPromotions(false);
      const headers = ['Mã KM', 'Tên chương trình', 'Loại khuyến mãi', 'Mức ưu đãi', 'Đơn tối thiểu (VNĐ)', 'Từ ngày', 'Đến ngày', 'Trạng thái', 'Ghi chú'];
      const rows = promotions.map(p => {
        let typeStr = p.type === 'order_discount_percent' ? 'Giảm % đơn hàng' : (p.type === 'order_discount_amount' ? 'Giảm tiền mặt' : 'Mua X tặng Y');
        let valStr = p.type === 'order_discount_percent' ? `${p.discount_value}%` : (p.type === 'order_discount_amount' ? p.discount_value : `Mua ${p.buy_quantity} tặng ${p.gift_quantity}`);
        return [
          p.code,
          p.name,
          typeStr,
          valStr,
          p.min_order_amount || 0,
          p.start_date || '',
          p.end_date || '',
          p.is_active ? 'Đang kích hoạt' : 'Đã tắt',
          p.notes || ''
        ];
      });
      await this.exportTableToExcel(headers, rows, 'DanhSachKhuyenMai', 'danh_sach_khuyen_mai.xlsx');
    } catch (err) {
      this.toast('Lỗi xuất Excel khuyến mãi: ' + err.message, 'error');
    }
  },

  openCreatePromotionModal() {
    const modal = document.getElementById('promotion-modal');
    document.getElementById('promo-modal-title').textContent = 'Thêm chương trình khuyến mãi';
    document.getElementById('promo-id').value = '';
    document.getElementById('promo-code').value = '';
    document.getElementById('promo-type').value = 'order_discount_percent';
    document.getElementById('promo-name').value = '';
    document.getElementById('promo-val').value = '10';
    document.getElementById('promo-min-order').value = '0';
    document.getElementById('promo-buy-qty').value = '1';
    document.getElementById('promo-gift-qty').value = '1';
    document.getElementById('promo-start-date').value = '';
    document.getElementById('promo-end-date').value = '';
    document.getElementById('promo-notes').value = '';
    this.onPromoTypeChange('order_discount_percent');
    modal.classList.add('active');
  },

  async openEditPromotionModal(id) {
    try {
      const promotions = await API.getPromotions(false);
      const p = promotions.find(x => x.id === id);
      if (!p) return;

      const modal = document.getElementById('promotion-modal');
      document.getElementById('promo-modal-title').textContent = 'Chỉnh sửa: ' + p.name;
      document.getElementById('promo-id').value = p.id;
      document.getElementById('promo-code').value = p.code;
      document.getElementById('promo-type').value = p.type || 'order_discount_percent';
      document.getElementById('promo-name').value = p.name;
      document.getElementById('promo-val').value = p.discount_value || 0;
      document.getElementById('promo-min-order').value = p.min_order_amount || 0;
      document.getElementById('promo-buy-qty').value = p.buy_quantity || 1;
      document.getElementById('promo-gift-qty').value = p.gift_quantity || 1;
      document.getElementById('promo-start-date').value = p.start_date || '';
      document.getElementById('promo-end-date').value = p.end_date || '';
      document.getElementById('promo-notes').value = p.notes || '';
      this.onPromoTypeChange(p.type || 'order_discount_percent');
      modal.classList.add('active');
    } catch (e) {
      App.toast('Lỗi mở form khuyến mãi: ' + e.message, 'error');
    }
  },

  onPromoTypeChange(type) {
    const valLabel = document.getElementById('promo-val-label');
    const discountRow = document.getElementById('promo-discount-row');
    const giftRow = document.getElementById('promo-gift-row');

    if (type === 'buy_x_get_y') {
      if (discountRow) discountRow.style.display = 'none';
      if (giftRow) giftRow.style.display = 'flex';
    } else {
      if (discountRow) discountRow.style.display = 'flex';
      if (giftRow) giftRow.style.display = 'none';
      if (valLabel) {
        valLabel.textContent = type === 'order_discount_percent' 
          ? 'Mức giảm (%) (*):' 
          : 'Mức giảm (VNĐ) (*):';
      }
    }
  },

  async savePromotionForm() {
    const id = document.getElementById('promo-id').value;
    const name = document.getElementById('promo-name').value.trim();
    if (!name) {
      App.toast('Tên chương trình khuyến mãi không được để trống', 'warning');
      return;
    }

    const payload = {
      code: document.getElementById('promo-code').value.trim(),
      name: name,
      type: document.getElementById('promo-type').value,
      discount_value: parseFloat(document.getElementById('promo-val').value) || 0,
      min_order_amount: parseFloat(document.getElementById('promo-min-order').value) || 0,
      buy_quantity: parseInt(document.getElementById('promo-buy-qty').value) || 1,
      gift_quantity: parseInt(document.getElementById('promo-gift-qty').value) || 1,
      start_date: document.getElementById('promo-start-date').value || null,
      end_date: document.getElementById('promo-end-date').value || null,
      notes: document.getElementById('promo-notes').value.trim()
    };

    try {
      if (id) {
        await API.updatePromotion(id, payload);
        App.toast('Cập nhật khuyến mãi thành công', 'success');
      } else {
        await API.createPromotion(payload);
        App.toast('Thêm khuyến mãi mới thành công', 'success');
      }
      document.getElementById('promotion-modal').classList.remove('active');
      this.loadPromotionsTable();
    } catch (err) {
      App.toast('Lỗi lưu khuyến mãi: ' + err.message, 'error');
    }
  },

  async togglePromotion(id) {
    try {
      const res = await API.togglePromotion(id);
      App.toast(`Đã ${res.is_active ? 'kích hoạt' : 'tắt'} chương trình khuyến mãi!`, 'success');
      this.loadPromotionsTable();
    } catch (err) {
      App.toast('Lỗi cập nhật trạng thái: ' + err.message, 'error');
    }
  },

  async deletePromotion(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa chương trình khuyến mãi này?')) return;
    try {
      await API.deletePromotion(id);
      App.toast('Đã xóa chương trình khuyến mãi', 'success');
      this.loadPromotionsTable();
    } catch (err) {
      App.toast('Lỗi xóa khuyến mãi: ' + err.message, 'error');
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
                <div style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--color-border);">
                  <strong style="font-size: 0.88rem; display: block; margin-bottom: 6px; color: var(--color-text-main);">Phục hồi cơ sở dữ liệu (Restore):</strong>
                  <p style="font-size: 0.8125rem; color: var(--color-text-subtle); margin-bottom: 10px;">
                    Chọn tệp tin backup SQLite (.db) để khôi phục toàn bộ hệ thống. Bản dữ liệu hiện tại sẽ được tự động sao lưu dự phòng an toàn.
                  </p>
                  <input type="file" id="backup-restore-file" accept=".db,application/x-sqlite3" style="display: none;" onchange="App.handleBackupRestore(event)">
                  <button class="btn btn-outline" style="width: 100%; border-color: #d97706; color: #b45309; font-weight: 600;" onclick="document.getElementById('backup-restore-file').click()">
                    Chọn file .db để Phục hồi (Restore)
                  </button>
                </div>
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

  async handleBackupRestore(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!confirm(`CẢNH BÁO PHỤC HỒI:\n\nBạn có chắc chắn muốn khôi phục cơ sở dữ liệu từ file "${file.name}"?\n\nDữ liệu hiện tại sẽ được thay thế (hệ thống sẽ tự động lưu một bản sao lưu an toàn trước khi thay thế).`)) {
      event.target.value = '';
      return;
    }

    try {
      App.toast('Đang đọc và kiểm tra tệp tin sao lưu...', 'info');
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target.result;
          const res = await API.restoreBackup(base64Data);
          App.toast(res.message || 'Phục hồi cơ sở dữ liệu thành công!', 'success');
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err) {
          App.toast('Lỗi phục hồi cơ sở dữ liệu: ' + err.message, 'error');
        } finally {
          event.target.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      App.toast('Lỗi đọc file: ' + err.message, 'error');
      event.target.value = '';
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
    const isGuest = !this.currentUser;
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
        ${isGuest ? '<button class="btn btn-primary" onclick="App.showAuthModal(false)">Đăng nhập hệ thống</button>' : '<button class="btn btn-primary" onclick="App.navigate(\'dashboard\')">Quay lại Tổng quan</button>'}
      </div>
    `;
  },

  async initAuth() {
    try {
      const bs = await API.getBootstrapStatus();
      if (bs.need_bootstrap) {
        this.currentUser = null;
        this.userPermissions = new Set();
        this.updateUserUI();
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
      this.updateUserUI();
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
    const nameElem = document.getElementById('user-display-name');
    const roleElem = document.getElementById('user-role-badge');
    const initialsElem = document.getElementById('user-avatar-initials');
    const badgeContainer = document.getElementById('topbar-user-badge');

    if (!this.currentUser) {
      if (nameElem) nameElem.textContent = 'Chưa đăng nhập';
      if (roleElem) {
        roleElem.innerHTML = '<span class="badge badge-gray" style="font-size: 0.65rem; padding: 1px 5px; cursor: pointer;" title="Nhấn để đăng nhập">Chưa đăng nhập</span>';
      }
      if (initialsElem) initialsElem.textContent = '--';
      if (badgeContainer) {
        badgeContainer.style.cursor = 'pointer';
        badgeContainer.title = 'Nhấn để đăng nhập vào hệ thống';
        badgeContainer.onclick = () => this.showAuthModal(false);
      }
      return;
    }

    if (badgeContainer) {
      badgeContainer.style.cursor = 'default';
      badgeContainer.title = '';
      badgeContainer.onclick = null;
    }

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
    this.updateUserUI();
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
      'USER_REVOKE_SESSIONS': { label: 'Thu hồi phiên đăng nhập', badgeClass: 'badge-amber', markerClass: 'marker-warning' }
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
      'role': 'Vai trò'
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
  }
};

window.App = App;
window.openProductModal = (id) => App.openProductModal(id);
window.editProduct = (id) => App.editProduct(id);
window.openEditProductModal = (id) => App.openEditProductModal(id);
window.openCreateProductModal = () => App.openCreateProductModal();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
