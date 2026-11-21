/**
 * POS (Point of Sale) & Cashier Checkout Module for KiotPro
 * Features:
 * - Multi-level packaging unit selection per line item (Lon -> Lốc -> Thùng)
 * - Decimal quantity support with real-time base stock validation
 * - Dynamic promotion verification & non-stackable discount calculation
 * - Customer-specific pricing compatible with packaging unit conversions
 * - Dedicated order notes (without overwriting with debt messages)
 * - Support for Completed sales and Pending orders (Đơn đang đặt)
 * - Thermal 80mm invoice printing with cashier identity, promotions & notes
 */

const POS = {
  products: [],
  cart: [],
  customers: [],
  selectedCustomer: null,
  customerPricesMap: {},
  activeCategory: 'all',
  discountAmount: 0,
  vatPercent: 0,
  customerPaid: 0,
  paymentMethod: 'cash',
  storeSettings: {},
  applicablePromotions: [],
  selectedPromotion: null,
  _isSubmitting: false,
  cartTabs: [
    { id: 1, name: 'Hóa đơn 1', cart: [], selectedCustomer: null, discountAmount: 0, vatPercent: 0, customerPaid: 0, paymentMethod: 'cash', notes: '', selectedPromotion: null }
  ],
  activeTabId: 1,

  async init() {
    await this.loadStoreSettings();
    await this.loadCustomers();
    await this.loadProducts();
    this.renderCategories();
    this.renderCartTabs();
    this.setupEventListeners();
  },

  async loadStoreSettings() {
    try {
      this.storeSettings = await API.getSettings();
      const defaultVat = parseFloat(this.storeSettings.default_vat_rate) || 0;
      this.vatPercent = defaultVat;
      const vatSelect = document.getElementById('pos-vat-select');
      if (vatSelect) vatSelect.value = defaultVat;
    } catch (e) {
      console.warn("Could not load settings", e);
    }
  },

  async loadProducts() {
    try {
      this.products = await API.getProducts();
      this.renderProducts();
    } catch (err) {
      App.toast('Không thể tải danh sách sản phẩm: ' + err.message, 'error');
    }
  },

  async loadCustomers() {
    try {
      this.customers = await API.getCustomers();
      this.renderCustomerSelect();
      const defaultCust = this.customers.find(c => c.code === 'KH0001') || this.customers[0];
      if (defaultCust) {
        this.selectCustomer(defaultCust.id);
      }
    } catch (err) {
      App.toast('Không thể tải danh sách khách hàng: ' + err.message, 'error');
    }
  },

  async selectCustomer(customerId) {
    const cust = this.customers.find(c => c.id == customerId);
    this.selectedCustomer = cust || null;
    this.customerPricesMap = {};

    if (this.selectedCustomer && this.selectedCustomer.id) {
      try {
        const prices = await API.getCustomerPrices(this.selectedCustomer.id);
        prices.forEach(p => {
          this.customerPricesMap[p.product_id] = p.custom_price;
        });
      } catch (e) {
        console.error("Error loading customer prices", e);
      }
    }

    // Update customer UI
    const debtElem = document.getElementById('pos-customer-debt');
    if (debtElem) {
      if (this.selectedCustomer && this.selectedCustomer.debt > 0) {
        debtElem.style.display = 'inline-block';
        debtElem.textContent = `Nợ cũ: ${App.formatMoney(this.selectedCustomer.debt)}`;
      } else {
        debtElem.style.display = 'none';
      }
    }

    // Refresh cart item prices according to selected customer & current unit
    this.cart.forEach(item => {
      const prod = this.products.find(p => p.id === item.product_id);
      const hasCustom = this.customerPricesMap[item.product_id] !== undefined;
      if (hasCustom) {
        item.sale_price = Math.round(this.customerPricesMap[item.product_id] * item.conversion_rate);
        item.is_custom_price = true;
      } else {
        const u = item.available_units.find(x => x.unit_name === item.unit);
        if (u && u.sale_price && u.sale_price > 0) {
          item.sale_price = u.sale_price;
        } else if (prod) {
          item.sale_price = Math.round(prod.sale_price * item.conversion_rate);
        }
        item.is_custom_price = false;
      }
      item.subtotal = Math.round(item.quantity * item.sale_price);
    });

    this.renderProducts();
    this.renderCart();
    this.checkApplicablePromotions();
  },

  renderCustomerSelect() {
    const select = document.getElementById('pos-customer-select');
    if (!select) return;
    select.innerHTML = this.customers.map(c => 
      `<option value="${c.id}">${c.name} (${c.phone || c.code})</option>`
    ).join('');
  },

  renderCategories() {
    const container = document.getElementById('pos-categories-container');
    if (!container) return;
    const categories = ['all', ...new Set(this.products.map(p => p.category).filter(Boolean))];
    container.innerHTML = categories.map(cat => `
      <button class="category-pill ${cat === this.activeCategory ? 'active' : ''}" onclick="POS.setCategory('${cat}')">
        ${cat === 'all' ? 'Tất cả' : cat}
      </button>
    `).join('');
  },

  setCategory(cat) {
    this.activeCategory = cat;
    this.renderCategories();
    this.renderProducts();
  },

  renderProducts() {
    const grid = document.getElementById('pos-products-grid');
    if (!grid) return;

    const query = (document.getElementById('pos-search-input')?.value || '').toLowerCase().trim();
    let filtered = this.products;

    if (this.activeCategory !== 'all') {
      filtered = filtered.filter(p => p.category === this.activeCategory);
    }
    if (query) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(query) || 
        p.code.toLowerCase().includes(query) || 
        (p.barcode && p.barcode.toLowerCase().includes(query)) ||
        (p.units && p.units.some(u => u.barcode && u.barcode.toLowerCase().includes(query)))
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 40px;">Không tìm thấy sản phẩm phù hợp</div>`;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const hasCustom = this.customerPricesMap[p.id] !== undefined;
      const effectivePrice = hasCustom ? this.customerPricesMap[p.id] : p.sale_price;
      const isOutOfStock = p.stock <= 0;
      const breakdownText = p.stock_breakdown || `${p.stock} ${p.unit}`;

      return `
        <div class="pos-product-card ${isOutOfStock ? 'product-card-out' : ''}" onclick="POS.addToCart(${p.id})">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
            <span class="product-code-tag">${p.code}</span>
            <span class="product-stock-tag ${p.stock <= p.min_stock ? 'badge-tag badge-red' : ''}" title="Tồn cơ sở: ${p.stock} ${p.unit}">
              Tồn: ${breakdownText}
            </span>
          </div>
          <div class="product-name-title" title="${p.name}">${p.name}</div>
          ${p.units && p.units.length > 1 ? `
            <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px;">
              ${p.units.map(u => `
                <span class="unit-tag-pill" style="font-size: 0.7rem; padding: 1px 5px;" onclick="event.stopPropagation(); POS.addToCart(${p.id}, '${u.unit_name}')">
                  +1 ${u.unit_name}
                </span>
              `).join('')}
            </div>
          ` : ''}
          <div class="product-price-row">
            <div>
              <div class="product-price">${App.formatMoney(effectivePrice)} / ${p.unit}</div>
              ${hasCustom ? `<span class="badge-custom-price"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Giá riêng</span> <span style="text-decoration: line-through; font-size: 0.72rem; color: #94a3b8;">${App.formatMoney(p.sale_price)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  addToCart(productId, unitName = null) {
    const prod = this.products.find(p => p.id === productId);
    if (!prod) return;

    const units = (prod.units && prod.units.length > 0) ? prod.units : [
      { unit_name: prod.unit, conversion_rate: 1.0, sale_price: prod.sale_price, is_base: 1 }
    ];

    let chosenUnit = units.find(u => u.is_default_sale) || units.find(u => u.is_base) || units[0];
    if (unitName) {
      const match = units.find(u => u.unit_name === unitName);
      if (match) chosenUnit = match;
    }

    const existing = this.cart.find(item => item.product_id === productId && item.unit === chosenUnit.unit_name);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    const addQty = 1;
    const targetQty = (existing ? existing.quantity + addQty : addQty);
    const targetBaseQty = targetQty * chosenUnit.conversion_rate;

    const otherItemsBaseQty = this.cart
      .filter(i => i.product_id === productId && (!existing || i !== existing))
      .reduce((sum, i) => sum + (i.quantity * i.conversion_rate), 0);

    if (!allowNegative && prod.stock < (otherItemsBaseQty + targetBaseQty)) {
      App.toast(`Sản phẩm "${prod.name}" chỉ còn tồn ${prod.stock} ${prod.unit}, không đủ để bán thêm!`, 'warning');
      return;
    }

    if (existing) {
      existing.quantity += 1;
      existing.subtotal = Math.round(existing.quantity * existing.sale_price);
    } else {
      let effectivePrice = chosenUnit.sale_price;
      const hasCustom = this.customerPricesMap[prod.id] !== undefined;
      if (hasCustom) {
        effectivePrice = Math.round(this.customerPricesMap[prod.id] * chosenUnit.conversion_rate);
      } else if (!effectivePrice || effectivePrice <= 0) {
        effectivePrice = Math.round(prod.sale_price * chosenUnit.conversion_rate);
      }

      this.cart.push({
        product_id: prod.id,
        code: prod.code,
        name: prod.name,
        category: prod.category,
        unit: chosenUnit.unit_name,
        conversion_rate: chosenUnit.conversion_rate,
        available_units: units,
        default_sale_price: Math.round(prod.sale_price * chosenUnit.conversion_rate),
        sale_price: effectivePrice,
        is_custom_price: hasCustom,
        save_as_custom_price: false,
        quantity: 1,
        subtotal: effectivePrice
      });
    }

    this.renderCart();
    this.checkApplicablePromotions();
  },

  changeItemUnit(cartIndex, newUnitName) {
    const item = this.cart[cartIndex];
    if (!item) return;

    const prod = this.products.find(p => p.id === item.product_id);
    const unit = item.available_units.find(u => u.unit_name === newUnitName);
    if (!unit) return;

    item.unit = unit.unit_name;
    item.conversion_rate = unit.conversion_rate;

    const hasCustom = this.customerPricesMap[item.product_id] !== undefined;
    if (hasCustom) {
      item.sale_price = Math.round(this.customerPricesMap[item.product_id] * unit.conversion_rate);
    } else if (unit.sale_price && unit.sale_price > 0) {
      item.sale_price = unit.sale_price;
    } else if (prod) {
      item.sale_price = Math.round(prod.sale_price * unit.conversion_rate);
    }
    item.default_sale_price = prod ? Math.round(prod.sale_price * unit.conversion_rate) : item.sale_price;
    item.subtotal = Math.round(item.quantity * item.sale_price);

    this.renderCart();
    this.checkApplicablePromotions();
  },

  updateQuantity(cartIndex, delta) {
    const item = this.cart[cartIndex];
    if (!item) return;

    const prod = this.products.find(p => p.id === item.product_id);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    const newQty = Math.max(0.001, item.quantity + delta);

    const otherItemsBaseQty = this.cart
      .filter((it, idx) => it.product_id === item.product_id && idx !== cartIndex)
      .reduce((sum, it) => sum + (it.quantity * it.conversion_rate), 0);

    if (delta > 0 && prod && !allowNegative && prod.stock < (otherItemsBaseQty + (newQty * item.conversion_rate))) {
      App.toast(`Không đủ tồn kho để bán ${newQty} ${item.unit} (Hiện còn tồn: ${prod.stock} ${prod.unit})`, 'warning');
      return;
    }

    item.quantity = newQty;
    if (item.quantity <= 0.0001) {
      this.removeFromCart(cartIndex);
      return;
    }
    item.subtotal = Math.round(item.quantity * item.sale_price);
    this.renderCart();
    this.checkApplicablePromotions();
  },

  setQuantity(cartIndex, value) {
    const qty = parseFloat(value);
    if (isNaN(qty) || qty <= 0) return;
    const item = this.cart[cartIndex];
    if (!item) return;

    const prod = this.products.find(p => p.id === item.product_id);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    const otherItemsBaseQty = this.cart
      .filter((it, idx) => it.product_id === item.product_id && idx !== cartIndex)
      .reduce((sum, it) => sum + (it.quantity * it.conversion_rate), 0);

    if (prod && !allowNegative && prod.stock < (otherItemsBaseQty + (qty * item.conversion_rate))) {
      App.toast(`Không đủ tồn kho để bán ${qty} ${item.unit} (Hiện còn tồn: ${prod.stock} ${prod.unit})`, 'warning');
      const maxQty = Math.max(0, (prod.stock - otherItemsBaseQty) / item.conversion_rate);
      item.quantity = maxQty > 0 ? Math.floor(maxQty * 100) / 100 : 1;
    } else {
      item.quantity = qty;
    }

    item.subtotal = Math.round(item.quantity * item.sale_price);
    this.renderCart();
    this.checkApplicablePromotions();
  },

  editItemPrice(cartIndex, newPrice, saveAsCustom = false) {
    const item = this.cart[cartIndex];
    if (!item) return;
    item.sale_price = Math.max(0, parseFloat(newPrice) || 0);
    item.subtotal = Math.round(item.quantity * item.sale_price);
    item.is_custom_price = (item.sale_price !== item.default_sale_price);
    item.save_as_custom_price = saveAsCustom;
    this.renderCart();
    this.checkApplicablePromotions();
  },

  removeFromCart(cartIndex) {
    this.cart.splice(cartIndex, 1);
    this.renderCart();
    this.checkApplicablePromotions();
  },

  renderCartTabs() {
    const container = document.getElementById('pos-cart-tabs-bar');
    if (!container) return;

    let html = '';
    this.cartTabs.forEach((tab) => {
      const isActive = tab.id === this.activeTabId;
      const count = (tab.cart || []).length;
      html += `
        <div class="pos-cart-tab ${isActive ? 'active' : ''}" onclick="POS.switchTab(${tab.id})">
          <span>${tab.name}</span>
          ${count > 0 ? `<span style="background: ${isActive ? 'var(--color-primary)' : '#94a3b8'}; color: #fff; font-size: 0.6875rem; padding: 1px 5px; border-radius: 10px;">${count}</span>` : ''}
          ${this.cartTabs.length > 1 ? `<span class="pos-cart-tab-close" onclick="event.stopPropagation(); POS.closeTab(${tab.id});" title="Đóng tab">&times;</span>` : ''}
        </div>
      `;
    });

    if (this.cartTabs.length < 5) {
      html += `<button class="pos-cart-tab-add" onclick="POS.addTab()" title="Thêm đơn mới (+)">+</button>`;
    }
    container.innerHTML = html;
  },

  saveCurrentTabState() {
    const tab = this.cartTabs.find(t => t.id === this.activeTabId);
    if (!tab) return;
    tab.cart = [...this.cart];
    tab.selectedCustomer = this.selectedCustomer;
    tab.discountAmount = this.discountAmount;
    tab.vatPercent = this.vatPercent;
    tab.customerPaid = this.customerPaid;
    tab.paymentMethod = this.paymentMethod;
    tab.selectedPromotion = this.selectedPromotion;
    tab.notes = (document.getElementById('pos-order-notes')?.value || '').trim();
  },

  switchTab(tabId) {
    if (tabId === this.activeTabId) return;
    this.saveCurrentTabState();
    const nextTab = this.cartTabs.find(t => t.id === tabId);
    if (!nextTab) return;

    this.activeTabId = tabId;
    this.cart = [...nextTab.cart];
    this.selectedCustomer = nextTab.selectedCustomer;
    this.discountAmount = nextTab.discountAmount || 0;
    this.vatPercent = nextTab.vatPercent !== undefined ? nextTab.vatPercent : (parseFloat(this.storeSettings.default_vat_rate) || 0);
    this.customerPaid = nextTab.customerPaid || 0;
    this.paymentMethod = nextTab.paymentMethod || 'cash';
    this.selectedPromotion = nextTab.selectedPromotion || null;

    // Update UI elements
    const custSelect = document.getElementById('pos-customer-select');
    if (custSelect) custSelect.value = this.selectedCustomer ? this.selectedCustomer.id : '1';
    const discInput = document.getElementById('pos-discount-input');
    if (discInput) discInput.value = this.discountAmount;
    const vatSelect = document.getElementById('pos-vat-select');
    if (vatSelect) vatSelect.value = this.vatPercent;
    const notesInput = document.getElementById('pos-order-notes');
    if (notesInput) notesInput.value = nextTab.notes || '';

    // Update payment method buttons
    const methodBtns = document.querySelectorAll('.payment-method-btn');
    methodBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.method === this.paymentMethod);
    });

    this.renderCart();
    this.renderCartTabs();
    this.updateCustomerDebtBadge();
  },

  addTab() {
    if (this.cartTabs.length >= 5) {
      App.toast('Tối đa 5 hóa đơn chờ cùng lúc!', 'warning');
      return;
    }
    this.saveCurrentTabState();
    const nextId = Math.max(...this.cartTabs.map(t => t.id), 0) + 1;
    const newTab = {
      id: nextId,
      name: `Hóa đơn ${nextId}`,
      cart: [],
      selectedCustomer: null,
      discountAmount: 0,
      vatPercent: parseFloat(this.storeSettings.default_vat_rate) || 0,
      customerPaid: 0,
      paymentMethod: 'cash',
      selectedPromotion: null,
      notes: ''
    };
    this.cartTabs.push(newTab);
    this.switchTab(nextId);
  },

  closeTab(tabId) {
    if (this.cartTabs.length <= 1) return;
    const tabIndex = this.cartTabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    const tab = this.cartTabs[tabIndex];
    if (tab.cart && tab.cart.length > 0) {
      if (!confirm(`Hóa đơn '${tab.name}' đang có sản phẩm. Bạn có chắc muốn đóng không?`)) {
        return;
      }
    }
    this.cartTabs.splice(tabIndex, 1);
    if (this.activeTabId === tabId) {
      const nextTab = this.cartTabs[Math.max(0, tabIndex - 1)];
      this.activeTabId = null;
      this.switchTab(nextTab.id);
    } else {
      this.renderCartTabs();
    }
  },

  clearCart() {
    this.cart = [];
    this.discountAmount = 0;
    this.customerPaid = 0;
    this.applicablePromotions = [];
    this.selectedPromotion = null;

    const paidInput = document.getElementById('pos-paid-input');
    if (paidInput) {
      paidInput.value = 0;
      paidInput.dataset.manual = 'false';
    }
    const discInput = document.getElementById('pos-discount-input');
    if (discInput) discInput.value = 0;
    const notesInput = document.getElementById('pos-order-notes');
    if (notesInput) notesInput.value = '';

    this.saveCurrentTabState();
    this.renderPromotionsSelect();
    this.renderCart();
    this.renderCartTabs();
  },

  renderCart() {
    const list = document.getElementById('pos-cart-list');
    const badge = document.getElementById('pos-cart-count');
    if (badge) badge.textContent = this.cart.reduce((sum, i) => sum + i.quantity, 0);

    if (!list) return;

    if (this.cart.length === 0) {
      list.innerHTML = `
        <div class="empty-state" style="padding: 36px 16px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-state-icon">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
          <div style="font-weight: 500; color: var(--color-text-secondary); margin-bottom: 4px;">Chưa có sản phẩm trong giỏ</div>
          <div style="font-size: 0.8125rem; color: var(--color-text-muted);">Tìm kiếm hoặc quét mã vạch để thêm</div>
        </div>
      `;
      this.updateTotals();
      return;
    }

    list.innerHTML = this.cart.map((item, idx) => `
      <div class="pos-cart-item">
        <div class="cart-item-header">
          <div>
            <span class="cart-item-name">${item.name}</span>
            ${item.is_custom_price ? '<span class="badge-custom-price" style="margin-left: 6px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Giá riêng</span>' : ''}
          </div>
          <button class="cart-item-delete" onclick="POS.removeFromCart(${idx})" title="Xóa">✕</button>
        </div>
        <div class="cart-item-controls">
          <div class="cart-qty-group">
            <button class="qty-btn" onclick="POS.updateQuantity(${idx}, -1)">-</button>
            <input type="number" class="qty-input" value="${item.quantity}" step="any" min="0.001" onchange="POS.setQuantity(${idx}, this.value)" style="width: 58px;">
            <button class="qty-btn" onclick="POS.updateQuantity(${idx}, 1)">+</button>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <select class="cart-unit-select" onchange="POS.changeItemUnit(${idx}, this.value)">
              ${item.available_units.map(u => `
                <option value="${u.unit_name}" ${u.unit_name === item.unit ? 'selected' : ''}>
                  ${u.unit_name} (x${u.conversion_rate})
                </option>
              `).join('')}
            </select>
          </div>

          <div class="cart-item-pricing">
            <div class="cart-item-subtotal">${App.formatMoney(item.subtotal)}</div>
            <div class="cart-item-unit-price">
              <span style="cursor: pointer; text-decoration: underline dotted; display: inline-flex; align-items: center; gap: 3px;" onclick="POS.promptEditPrice(${idx})" title="Nhấp để sửa giá bán">
                ${App.formatMoney(item.sale_price)} / ${item.unit}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </span>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    this.updateTotals();
  },

  promptEditPrice(cartIndex) {
    const item = this.cart[cartIndex];
    if (!item) return;

    const newPriceStr = prompt(`Chỉnh sửa đơn giá cho "${item.name}" (Đơn vị: ${item.unit}, Giá niêm yết: ${App.formatMoney(item.default_sale_price)}):`, item.sale_price);
    if (newPriceStr === null) return;
    const newPrice = parseFloat(newPriceStr);
    if (isNaN(newPrice) || newPrice < 0) {
      App.toast('Đơn giá không hợp lệ', 'warning');
      return;
    }

    let saveAsCustom = false;
    if (this.selectedCustomer && this.selectedCustomer.code !== 'KH0001') {
      saveAsCustom = confirm(`Bạn có muốn LƯU giá ${App.formatMoney(newPrice)} làm GIÁ RIÊNG cố định cho khách "${this.selectedCustomer.name}" không?`);
    }

    this.editItemPrice(cartIndex, newPrice, saveAsCustom);
    if (saveAsCustom) {
      App.toast(`Đã cài đặt giá riêng cho khách ${this.selectedCustomer.name}!`, 'success');
    }
  },

  async checkApplicablePromotions() {
    if (this.cart.length === 0) {
      this.applicablePromotions = [];
      this.selectedPromotion = null;
      this.renderPromotionsSelect();
      this.updateTotals();
      return;
    }

    const grossSubtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    try {
      const applicable = await API.checkPromotions({
        items: this.cart.map(i => ({
          product_id: i.product_id,
          category: i.category,
          subtotal: i.subtotal
        })),
        customer_id: this.selectedCustomer ? this.selectedCustomer.id : 1,
        total_amount: grossSubtotal
      });
      this.applicablePromotions = applicable || [];

      if (this.selectedPromotion) {
        const match = this.applicablePromotions.find(p => p.id === this.selectedPromotion.id);
        if (match) this.selectedPromotion = match;
        else this.selectedPromotion = this.applicablePromotions[0] || null;
      } else if (this.applicablePromotions.length > 0) {
        this.selectedPromotion = this.applicablePromotions[0];
      }
    } catch (e) {
      console.warn("Could not check promotions", e);
      this.applicablePromotions = [];
    }

    this.renderPromotionsSelect();
    this.updateTotals();
  },

  renderPromotionsSelect() {
    const sel = document.getElementById('pos-promotion-select');
    if (!sel) return;

    if (!this.applicablePromotions || this.applicablePromotions.length === 0) {
      sel.innerHTML = '<option value="">-- Không có KM hợp lệ --</option>';
      sel.disabled = true;
      return;
    }

    sel.disabled = false;
    sel.innerHTML = '<option value="">-- Không áp dụng --</option>' + 
      this.applicablePromotions.map(p => `
        <option value="${p.id}" ${this.selectedPromotion && this.selectedPromotion.id === p.id ? 'selected' : ''}>
          ${p.name} (-${App.formatMoney(p.calculated_discount)})
        </option>
      `).join('');
  },

  onPromotionChange() {
    const sel = document.getElementById('pos-promotion-select');
    if (!sel) return;
    const promoId = parseInt(sel.value);
    if (!promoId) {
      this.selectedPromotion = null;
    } else {
      this.selectedPromotion = this.applicablePromotions.find(p => p.id === promoId) || null;
    }
    this.updateTotals();
  },

  updateTotals() {
    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const subtotalElem = document.getElementById('pos-subtotal');
    if (subtotalElem) subtotalElem.textContent = App.formatMoney(subtotal);

    const discountInput = document.getElementById('pos-discount-input');
    this.discountAmount = discountInput ? (parseFloat(discountInput.value) || 0) : 0;

    const promoDiscountRow = document.getElementById('pos-promo-discount-row');
    const promoDiscountValElem = document.getElementById('pos-promo-discount-val');
    const promoDiscount = this.selectedPromotion ? this.selectedPromotion.calculated_discount : 0;

    if (promoDiscountRow && promoDiscountValElem) {
      if (promoDiscount > 0) {
        promoDiscountRow.style.display = 'flex';
        promoDiscountValElem.textContent = `-${App.formatMoney(promoDiscount)}`;
      } else {
        promoDiscountRow.style.display = 'none';
      }
    }

    const netRevenue = Math.max(0, subtotal - this.discountAmount - promoDiscount);

    const vatSelect = document.getElementById('pos-vat-select');
    this.vatPercent = vatSelect ? (parseFloat(vatSelect.value) || 0) : 0;
    const vatAmount = Math.round(netRevenue * (this.vatPercent / 100));
    const vatElem = document.getElementById('pos-vat-amount');
    if (vatElem) vatElem.textContent = App.formatMoney(vatAmount);

    const finalAmount = netRevenue + vatAmount;
    const finalElem = document.getElementById('pos-final-amount');
    if (finalElem) finalElem.textContent = App.formatMoney(finalAmount);

    const paidInput = document.getElementById('pos-paid-input');
    if (paidInput && (!paidInput.dataset.manual || paidInput.dataset.manual === 'false')) {
      paidInput.value = finalAmount;
      this.customerPaid = finalAmount;
    } else if (paidInput) {
      this.customerPaid = parseFloat(paidInput.value) || 0;
    }

    const balanceLabel = document.getElementById('pos-balance-label');
    const balanceAmount = document.getElementById('pos-balance-amount');
    if (balanceLabel && balanceAmount) {
      const diff = this.customerPaid - finalAmount;
      if (diff >= 0) {
        balanceLabel.textContent = 'Tiền thừa trả khách:';
        balanceAmount.style.color = 'var(--color-success)';
        balanceAmount.textContent = App.formatMoney(diff);
      } else {
        balanceLabel.textContent = 'Ghi nợ vào tài khoản:';
        balanceAmount.style.color = 'var(--color-danger-text)';
        balanceAmount.textContent = App.formatMoney(Math.abs(diff));
      }
    }
  },

  async checkout(isPending = false) {
    if (this._isSubmitting) return;

    if (this.cart.length === 0) {
      App.toast('Giỏ hàng đang trống!', 'warning');
      return;
    }

    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const promoDiscount = this.selectedPromotion ? this.selectedPromotion.calculated_discount : 0;
    const netRevenue = Math.max(0, subtotal - this.discountAmount - promoDiscount);
    const vatAmount = Math.round(netRevenue * (this.vatPercent / 100));
    const finalAmount = netRevenue + vatAmount;

    const paid = isPending ? 0 : this.customerPaid;
    const debt = isPending ? 0 : Math.max(0, finalAmount - paid);

    if (!isPending && debt > 0 && (!this.selectedCustomer || this.selectedCustomer.code === 'KH0001')) {
      App.toast('Khách lẻ không thể ghi nợ. Vui lòng chọn khách hàng cụ thể hoặc thanh toán đủ.', 'error');
      return;
    }

    const notes = (document.getElementById('pos-order-notes')?.value || '').trim();

    const orderData = {
      customer_id: this.selectedCustomer ? this.selectedCustomer.id : 1,
      customer_name: this.selectedCustomer ? this.selectedCustomer.name : 'Khách lẻ',
      status: isPending ? 'pending' : 'completed',
      items: this.cart.map(i => ({
        product_id: i.product_id,
        unit: i.unit,
        quantity: i.quantity,
        sale_price: i.sale_price,
        is_custom_price: i.is_custom_price ? 1 : 0,
        save_as_custom_price: i.save_as_custom_price
      })),
      discount: this.discountAmount,
      promotion_id: this.selectedPromotion ? this.selectedPromotion.id : null,
      vat_percent: this.vatPercent,
      paid_amount: paid,
      payment_method: this.paymentMethod,
      notes: notes
    };

    this._isSubmitting = true;
    const checkoutBtn = document.getElementById('pos-btn-checkout');
    const pendingBtn = document.getElementById('pos-btn-pending');
    const origCheckoutHtml = checkoutBtn ? checkoutBtn.innerHTML : '';
    const origPendingHtml = pendingBtn ? pendingBtn.innerHTML : '';
    if (checkoutBtn) { checkoutBtn.disabled = true; checkoutBtn.innerHTML = 'Đang xử lý...'; }
    if (pendingBtn) { pendingBtn.disabled = true; }

    try {
      const res = await API.createOrder(orderData);
      if (isPending) {
        App.toast(`Đã lưu đơn đặt hàng ${res.code} (Pending) thành công!`, 'success');
      } else {
        App.toast(`Tạo đơn hàng ${res.code} thành công!`, 'success');
        this.showReceiptModal({
          code: res.code,
          customer_name: orderData.customer_name,
          created_at: new Date().toLocaleString('vi-VN'),
          items: this.cart,
          subtotal: subtotal,
          discount: this.discountAmount,
          promotion_name: this.selectedPromotion ? this.selectedPromotion.name : null,
          promotion_discount: promoDiscount,
          net_revenue: netRevenue,
          vat_percent: this.vatPercent,
          vat_amount: vatAmount,
          final_amount: finalAmount,
          customer_paid: paid,
          actual_paid: res.paid_amount,
          change: res.change_amount,
          debt: res.debt_amount,
          payment_method: this.paymentMethod,
          notes: notes
        });
      }

      this.clearCart();
      await this.loadProducts();
      await this.loadCustomers();
      if (window.App && typeof window.App.refreshDashboardStats === 'function') {
        window.App.refreshDashboardStats();
      }
    } catch (err) {
      App.toast(`Lỗi thanh toán: ${err.message}`, 'error');
    } finally {
      this._isSubmitting = false;
      if (checkoutBtn) { checkoutBtn.disabled = false; checkoutBtn.innerHTML = origCheckoutHtml; }
      if (pendingBtn) { pendingBtn.disabled = false; pendingBtn.innerHTML = origPendingHtml; }
    }
  },

  loadFromOrder(order) {
    if (!order || !order.items || order.items.length === 0) return;
    this.clearCart();

    if (order.customer_id) {
      const custSel = document.getElementById('pos-customer-select');
      if (custSel) custSel.value = order.customer_id;
      this.selectCustomer(order.customer_id);
    }

    order.items.forEach(it => {
      const prod = this.products.find(p => p.id === it.product_id);
      const units = (prod && prod.units) ? prod.units : [
        { unit_name: it.unit, conversion_rate: it.conversion_rate || 1.0, sale_price: it.sale_price, is_base: 1 }
      ];

      this.cart.push({
        product_id: it.product_id,
        code: it.product_code || (prod ? prod.code : ''),
        name: it.product_name || (prod ? prod.name : ''),
        category: prod ? prod.category : 'Chung',
        unit: it.unit,
        conversion_rate: it.conversion_rate || 1.0,
        available_units: units,
        default_sale_price: prod ? Math.round(prod.sale_price * (it.conversion_rate || 1.0)) : it.sale_price,
        sale_price: it.sale_price,
        is_custom_price: it.is_custom_price || false,
        save_as_custom_price: false,
        quantity: it.quantity,
        subtotal: it.subtotal || Math.round(it.quantity * it.sale_price)
      });
    });

    const notesInput = document.getElementById('pos-order-notes');
    if (notesInput && order.notes) {
      notesInput.value = order.notes;
    }

    this.renderCart();
    this.checkApplicablePromotions();
    App.toast(`Đã nạp ${this.cart.length} sản phẩm từ hóa đơn ${order.code} vào POS!`, 'info');
  },

  showReceiptModal(order) {
    const modal = document.getElementById('receipt-modal');
    const content = document.getElementById('receipt-content');
    if (!modal || !content) return;

    const storeName = this.storeSettings.store_name || 'KIOTPRO STORE';
    const storeAddr = this.storeSettings.store_address || '128 Lê Lợi, Quận 1, TP. HCM';
    const storePhone = this.storeSettings.store_phone || '0909 123 456';
    const storeFooter = this.storeSettings.invoice_footer || 'Cảm ơn quý khách và hẹn gặp lại!';

    content.innerHTML = `
      <div class="receipt-paper">
        <div class="text-center">
          <h2 style="font-size: 15px; margin: 0; font-weight: bold; text-transform: uppercase;">${storeName}</h2>
          <div style="font-size: 11px;">Đ/c: ${storeAddr}</div>
          <div style="font-size: 11px;">Hotline: ${storePhone}</div>
          <div class="divider"></div>
          <h3 style="font-size: 14px; margin: 4px 0; font-weight: bold;">HÓA ĐƠN BÁN HÀNG</h3>
          <div style="font-size: 12px; font-weight: bold;">Mã: ${order.code}</div>
          <div style="font-size: 11px;">Ngày: ${order.created_at}</div>
          <div style="font-size: 11px;">Thu ngân: <strong>${(App.currentUser && App.currentUser.full_name) || 'Quầy thu ngân'}</strong></div>
          <div style="font-size: 11px;">Khách hàng: <strong>${order.customer_name}</strong></div>
          ${order.notes ? `<div style="font-size: 11px; font-style: italic; margin-top: 2px;">Ghi chú: ${order.notes}</div>` : ''}
        </div>

        <div class="divider"></div>

        <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th style="text-align: left; padding: 4px 0;">Mặt hàng</th>
              <th style="text-align: center;">ĐVT</th>
              <th style="text-align: center;">SL</th>
              <th style="text-align: right;">Đ.Giá</th>
              <th style="text-align: right;">T.Tiền</th>
            </tr>
          </thead>
          <tbody>
            ${order.items.map(item => `
              <tr>
                <td style="padding: 3px 0;">
                  ${item.name}
                  ${item.is_custom_price ? '<br><small style="font-style: italic; color: #555;">(Giá riêng)</small>' : ''}
                </td>
                <td style="text-align: center;">${item.unit}</td>
                <td style="text-align: center;">${item.quantity}</td>
                <td style="text-align: right;">${App.formatMoney(item.sale_price, false)}</td>
                <td style="text-align: right; font-weight: 600;">${App.formatMoney(item.subtotal, false)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="divider"></div>

        <div style="font-size: 12px; line-height: 1.5;">
          <div style="display: flex; justify-content: space-between;">
            <span>Tổng tiền hàng:</span>
            <span>${App.formatMoney(order.subtotal)}</span>
          </div>
          ${order.promotion_discount > 0 ? `
            <div style="display: flex; justify-content: space-between; color: #15803d;">
              <span>Khuyến mãi (${order.promotion_name || ''}):</span>
              <span>-${App.formatMoney(order.promotion_discount)}</span>
            </div>
          ` : ''}
          ${order.discount > 0 ? `
            <div style="display: flex; justify-content: space-between; color: #b91c1c;">
              <span>Chiết khấu thêm:</span>
              <span>-${App.formatMoney(order.discount)}</span>
            </div>
          ` : ''}
          ${order.vat_amount > 0 ? `
            <div style="display: flex; justify-content: space-between;">
              <span>Thuế VAT (${order.vat_percent}%):</span>
              <span>+${App.formatMoney(order.vat_amount)}</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 13px; margin: 4px 0;">
            <span>KHÁCH CẦN TRẢ:</span>
            <span style="font-size: 14px;">${App.formatMoney(order.final_amount)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Tiền khách đưa:</span>
            <span>${App.formatMoney(order.customer_paid)}</span>
          </div>
          ${order.change > 0 ? `
            <div style="display: flex; justify-content: space-between; font-weight: bold; color: #15803d;">
              <span>Tiền thừa trả khách:</span>
              <span>${App.formatMoney(order.change)}</span>
            </div>
          ` : ''}
          ${order.debt > 0 ? `
            <div style="display: flex; justify-content: space-between; color: red; font-weight: bold;">
              <span>Ghi nợ:</span>
              <span>${App.formatMoney(order.debt)}</span>
            </div>
          ` : ''}
        </div>

        <div class="divider"></div>

        <div class="text-center" style="font-size: 11px; margin-top: 8px;">
          <div>${storeFooter}</div>
          <div style="margin-top: 4px; color: #666;">Hệ thống phần mềm KiotPro POS</div>
        </div>
      </div>
    `;

    modal.classList.add('active');
  },

  setupEventListeners() {
    const searchInput = document.getElementById('pos-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.renderProducts());
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const val = searchInput.value.trim().toLowerCase();
          if (val) {
            // Find by barcode or code
            const match = this.products.find(p => 
              (p.barcode && p.barcode.toLowerCase() === val) || 
              p.code.toLowerCase() === val ||
              (p.units && p.units.some(u => u.barcode && u.barcode.toLowerCase() === val))
            );
            if (match) {
              // Check if matched a specific unit's barcode
              let matchedUnitName = null;
              if (match.units) {
                const uMatch = match.units.find(u => u.barcode && u.barcode.toLowerCase() === val);
                if (uMatch) matchedUnitName = uMatch.unit_name;
              }
              this.addToCart(match.id, matchedUnitName);
              searchInput.value = '';
              this.renderProducts();
            }
          }
        }
      });
    }

    const customerSelect = document.getElementById('pos-customer-select');
    if (customerSelect) {
      customerSelect.addEventListener('change', (e) => {
        this.selectCustomer(e.target.value);
      });
    }

    const discountInput = document.getElementById('pos-discount-input');
    if (discountInput) {
      discountInput.addEventListener('input', () => this.updateTotals());
    }

    const vatSelect = document.getElementById('pos-vat-select');
    if (vatSelect) {
      vatSelect.addEventListener('change', () => this.updateTotals());
    }

    const paidInput = document.getElementById('pos-paid-input');
    if (paidInput) {
      paidInput.addEventListener('input', (e) => {
        paidInput.dataset.manual = 'true';
        this.customerPaid = parseFloat(e.target.value) || 0;
        this.updateTotals();
      });
    }

    const methodBtns = document.querySelectorAll('.payment-method-btn');
    methodBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        methodBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.paymentMethod = e.target.dataset.method;
      });
    });

    // Global keyboard shortcuts for POS
    window.addEventListener('keydown', (e) => {
      const posSection = document.getElementById('view-pos');
      if (!posSection || posSection.style.display === 'none') return;

      if (e.key === 'F2') {
        e.preventDefault();
        const searchInput = document.getElementById('pos-search-input');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      } else if (e.key === 'F4') {
        e.preventDefault();
        const customerSelect = document.getElementById('pos-customer-select');
        if (customerSelect) {
          customerSelect.focus();
        }
      } else if (e.key === 'F8') {
        e.preventDefault();
        this.checkout(false);
      } else if (e.key === 'F6') {
        e.preventDefault();
        this.checkout(true);
      }
    });
  }
};
