/**
 * API Service for KiotPro POS & Distribution Management
 */

const API = {
  async request(url, options = {}) {
    const defaultHeaders = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers
      }
    };
    try {
      const response = await fetch(url, config);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Lỗi máy chủ (${response.status})`);
      }
      return data;
    } catch (err) {
      console.error(`API Error [${url}]:`, err);
      throw err;
    }
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

  // Customer-Specific Product Pricing (Price each product with each customer)
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

  // Returns / Sales Returns (Khách trả hàng)
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
