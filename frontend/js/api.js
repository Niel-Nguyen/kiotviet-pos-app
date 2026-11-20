/**
 * API Service for KiotPro POS & Distribution Management
 * Supports Cookie & Token-based Authentication, RBAC, and Audit Logging
 */

const API = {
  token: localStorage.getItem('kiotpro_token') || '',

  setToken(t) {
    this.token = t || '';
    if (t) {
      localStorage.setItem('kiotpro_token', t);
    } else {
      localStorage.removeItem('kiotpro_token');
    }
  },

  async request(url, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (this.token) {
      defaultHeaders['Authorization'] = `Bearer ${this.token}`;
    }

    const config = {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...defaultHeaders,
        ...options.headers
      }
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (response.status === 401) {
        this.setToken('');
        if (window.App && typeof window.App.showAuthModal === 'function' && !url.includes('/api/auth/')) {
          window.App.showAuthModal();
        }
        throw new Error(data.message || 'Phiên đăng nhập đã hết hạn');
      }

      if (!response.ok) {
        const err = new Error(data.message || `Lỗi máy chủ (${response.status})`);
        err.code = data.code;
        throw err;
      }
      return data;
    } catch (err) {
      console.error(`API Error [${url}]:`, err);
      throw err;
    }
  },

  // Auth & Account Management
  getBootstrapStatus() {
    return this.request('/api/auth/bootstrap-status');
  },
  bootstrap(data) {
    return this.request('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  login(data) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  logout() {
    return this.request('/api/auth/logout', {
      method: 'POST'
    });
  },
  getMe() {
    return this.request('/api/auth/me');
  },
  changePassword(data) {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Users Management (Admin)
  getUsers() {
    return this.request('/api/users');
  },
  createUser(data) {
    return this.request('/api/users', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  updateUser(id, data) {
    return this.request(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },
  lockUser(id) {
    return this.request(`/api/users/${id}/lock`, {
      method: 'POST'
    });
  },
  unlockUser(id) {
    return this.request(`/api/users/${id}/unlock`, {
      method: 'POST'
    });
  },
  resetUserPassword(id, data) {
    return this.request(`/api/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  revokeUserSessions(id) {
    return this.request(`/api/users/${id}/revoke-sessions`, {
      method: 'POST'
    });
  },

  // Audit Logs & Timeline
  getAuditLogs(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/audit-logs${qs ? '?' + qs : ''}`);
  },
  getTimeline(entityType, identifier) {
    return this.request(`/api/timeline/${entityType}/${encodeURIComponent(identifier)}`);
  },

  // Dashboard & Reports
  getDashboardStats(range = 'today') {
    return this.request(`/api/reports/dashboard?range=${range}`);
  },

  // Products & Inventory
  getProducts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/products${qs ? '?' + qs : ''}`);
  },
  createProduct(data) {
    return this.request('/api/products', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  updateProduct(id, data) {
    return this.request(`/api/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },
  deleteProduct(id) {
    return this.request(`/api/products/${id}`, { method: 'DELETE' });
  },
  getProductLogs(productId) {
    return this.request(`/api/products/${productId}/logs`);
  },
  adjustInventory(data) {
    return this.request('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  getCategories() {
    return this.request('/api/categories');
  },

  // Customers
  getCustomers(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/customers${qs ? '?' + qs : ''}`);
  },
  createCustomer(data) {
    return this.request('/api/customers', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  updateCustomer(id, data) {
    return this.request(`/api/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },
  deleteCustomer(id) {
    return this.request(`/api/customers/${id}`, { method: 'DELETE' });
  },
  payCustomerDebt(id, data) {
    return this.request(`/api/customers/${id}/pay-debt`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Customer-Specific Product Pricing
  getCustomerPrices(customerId) {
    return this.request(`/api/customers/${customerId}/prices`);
  },
  saveCustomerPrice(customerId, data) {
    return this.request(`/api/customers/${customerId}/prices`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  deleteCustomerPrice(priceId) {
    return this.request(`/api/customer-prices/${priceId}`, { method: 'DELETE' });
  },
  lookupCustomerProductPrice(customerId, productId) {
    return this.request(`/api/customer-prices/lookup?customer_id=${customerId}&product_id=${productId}`);
  },

  // Suppliers
  getSuppliers(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/suppliers${qs ? '?' + qs : ''}`);
  },
  createSupplier(data) {
    return this.request('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  updateSupplier(id, data) {
    return this.request(`/api/suppliers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },
  deleteSupplier(id) {
    return this.request(`/api/suppliers/${id}`, { method: 'DELETE' });
  },
  paySupplierDebt(id, data) {
    return this.request(`/api/suppliers/${id}/pay-debt`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Orders / Sales (Output)
  getOrders() {
    return this.request('/api/orders');
  },
  getOrder(id) {
    return this.request(`/api/orders/${id}`);
  },
  createOrder(data) {
    return this.request('/api/orders', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Purchases / Goods Receipt (Input)
  getPurchases() {
    return this.request('/api/purchases');
  },
  getPurchase(id) {
    return this.request(`/api/purchases/${id}`);
  },
  createPurchase(data) {
    return this.request('/api/purchases', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Returns / Sales Returns
  getReturns() {
    return this.request('/api/returns');
  },
  createReturn(data) {
    return this.request('/api/returns', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Cash Flow (Sổ quỹ)
  getCashFlow(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request(`/api/cash-flow${qs ? '?' + qs : ''}`);
  },
  createCashFlow(data) {
    return this.request('/api/cash-flow', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // Settings
  getSettings() {
    return this.request('/api/settings');
  },
  saveSettings(data) {
    return this.request('/api/settings', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
};
