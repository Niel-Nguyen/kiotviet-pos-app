/**
 * POS (Point of Sale) & Cashier Checkout Module
 * Accurate cash drawer calculation, VAT taxation, multi-tier packaging units,
 * promotion discounts, pre-order management, and dynamic store receipt printing.
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
  promotions: [],
  selectedPromo: null,
  promoDiscount: 0,

  async init() {
    await this.loadStoreSettings();
    await this.loadCustomers();
    await this.loadProducts();
    await this.loadPromotions();
    this.renderCategories();
    this.renderPromoSelect();
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

  async loadPromotions() {
    try {
      this.promotions = await API.getPromotions(true);
    } catch (err) {
      console.warn("Could not load promotions", err);
      this.promotions = [];
    }
  },

  renderPromoSelect() {
    const select = document.getElementById('pos-promo-select');
    if (!select) return;
    const currentVal = this.selectedPromo ? this.selectedPromo.id : '';
    select.innerHTML = '<option value="">-- Không áp dụng KM --</option>' +
      this.promotions.map(p => `
        <option value="${p.id}" ${p.id == currentVal ? 'selected' : ''}>
          ${p.code} - ${p.name}
        </option>
      `).join('');
  },

  manualPromoCleared: false,

  getPromoApplicableSubtotal(promo, cart) {
    if (!promo || !cart || cart.length === 0) return 0;
    const raw = promo.applicable_product_ids;
    if (!raw) {
      return cart.reduce((sum, item) => sum + (item.subtotal || 0), 0);
    }
    let applicableSet = null;
    try {
      if (Array.isArray(raw)) {
        applicableSet = new Set(raw.map(x => Number(x)));
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[')) {
          applicableSet = new Set(JSON.parse(trimmed).map(x => Number(x)));
        } else {
          applicableSet = new Set(trimmed.split(',').map(x => Number(x.trim())).filter(x => !isNaN(x)));
        }
      }
    } catch (e) {
      applicableSet = null;
    }
    if (!applicableSet || applicableSet.size === 0) {
      return cart.reduce((sum, item) => sum + (item.subtotal || 0), 0);
    }
    return cart.reduce((sum, item) => {
      return applicableSet.has(Number(item.productId)) ? sum + (item.subtotal || 0) : sum;
    }, 0);
  },

  autoSelectBestPromotion() {
    if (!this.promotions || this.promotions.length === 0) return null;
    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    if (subtotal <= 0) return null;

    let bestPromo = null;
    let maxDiscount = 0;

    for (const promo of this.promotions) {
      if (!promo.is_active) continue;
      if (promo.min_order_amount && subtotal < promo.min_order_amount) continue;

      const calcBase = this.getPromoApplicableSubtotal(promo, this.cart);
      if (calcBase <= 0) continue;

      let discount = 0;
      const val = promo.discount_value !== undefined ? promo.discount_value : (promo.value || 0);
      if (promo.type === 'order_discount_percent' || promo.type === 'percent') {
        discount = Math.round(calcBase * (val / 100));
      } else if (promo.type === 'order_discount_amount' || promo.type === 'fixed') {
        discount = Math.min(calcBase, val);
      }

      if (discount > maxDiscount) {
        maxDiscount = discount;
        bestPromo = promo;
      }
    }

    return bestPromo;
  },

  applyPromotion(promoId) {
    if (!promoId) {
      this.manualPromoCleared = true;
      this.selectedPromo = null;
      this.promoDiscount = 0;
      this.updatePromoBanner(null, 0);
      this.updateTotals();
      return;
    }

    this.manualPromoCleared = false;
    const promo = this.promotions.find(p => p.id == promoId);
    if (!promo) {
      this.selectedPromo = null;
      this.promoDiscount = 0;
      this.updatePromoBanner(null, 0);
      this.updateTotals();
      return;
    }

    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    if (promo.min_order_amount && subtotal < promo.min_order_amount) {
      App.toast(`Đơn hàng chưa đạt mức tối thiểu ${App.formatMoney(promo.min_order_amount)} để áp dụng KM ${promo.code}`, 'warning');
      const select = document.getElementById('pos-promo-select');
      if (select) select.value = '';
      this.selectedPromo = null;
      this.promoDiscount = 0;
      this.updatePromoBanner(null, 0);
      this.updateTotals();
      return;
    }

    this.selectedPromo = promo;
    this.calculatePromoDiscount();
    this.updateTotals();
    App.toast(`Đã áp dụng khuyến mãi "${promo.name}"!`, 'success');
  },

  updatePromoBanner(promo, discount) {
    const banner = document.getElementById('pos-promo-banner');
    const bannerName = document.getElementById('pos-promo-banner-name');
    const bannerDisc = document.getElementById('pos-promo-banner-discount');
    if (!banner) return;

    if (promo && discount > 0) {
      banner.style.display = 'block';
      if (bannerName) bannerName.textContent = `${promo.name} (${promo.code || ''})`;
      if (bannerDisc) bannerDisc.textContent = App.formatMoney(discount);
    } else {
      banner.style.display = 'none';
    }
  },

  calculatePromoDiscount() {
    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);

    // If no promo explicitly chosen, pick best available discount
    if (!this.selectedPromo && !this.manualPromoCleared && subtotal > 0) {
      const best = this.autoSelectBestPromotion();
      if (best) {
        this.selectedPromo = best;
        const select = document.getElementById('pos-promo-select');
        if (select) select.value = best.id;
      }
    }

    if (!this.selectedPromo) {
      this.promoDiscount = 0;
      this.updatePromoBanner(null, 0);
      return 0;
    }

    const promo = this.selectedPromo;
    if (promo.min_order_amount && subtotal < promo.min_order_amount) {
      this.promoDiscount = 0;
      this.updatePromoBanner(null, 0);
      return 0;
    }

    const calcBase = this.getPromoApplicableSubtotal(promo, this.cart);
    const val = promo.discount_value !== undefined ? promo.discount_value : (promo.value || 0);
    if (promo.type === 'order_discount_percent' || promo.type === 'percent') {
      this.promoDiscount = Math.round(calcBase * (val / 100));
    } else if (promo.type === 'order_discount_amount' || promo.type === 'fixed') {
      this.promoDiscount = Math.min(calcBase, val);
    } else {
      this.promoDiscount = 0;
    }

    this.updatePromoBanner(promo, this.promoDiscount);
    return this.promoDiscount;
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

    // Update customer UI with Debt & Pending Orders (Khách đang đặt)
    const debtElem = document.getElementById('pos-customer-debt');
    if (debtElem) {
      const parts = [];
      if (this.selectedCustomer && this.selectedCustomer.debt > 0) {
        parts.push(`Nợ cũ: ${App.formatMoney(this.selectedCustomer.debt)}`);
      }
      if (this.selectedCustomer && this.selectedCustomer.pending_orders_count > 0) {
        parts.push(`Đang đặt: ${this.selectedCustomer.pending_orders_count} đơn (${App.formatMoney(this.selectedCustomer.pending_orders_amount || 0)})`);
      }

      if (parts.length > 0) {
        debtElem.style.display = 'inline-block';
        debtElem.textContent = parts.join(' | ');
      } else {
        debtElem.style.display = 'none';
      }
    }

    // Refresh cart item prices according to selected customer
    this.cart.forEach(item => {
      if (this.customerPricesMap[item.product_id] !== undefined) {
        item.sale_price = this.customerPricesMap[item.product_id] * item.unit_conversion_rate;
        item.is_custom_price = true;
      } else {
        item.sale_price = item.default_sale_price;
        item.is_custom_price = false;
      }
      item.subtotal = item.quantity * item.sale_price;
    });

    this.renderProducts();
    this.renderCart();
  },

  renderCustomerSelect() {
    const select = document.getElementById('pos-customer-select');
    if (!select) return;
    select.innerHTML = this.customers.map(c => {
      const preOrderInfo = c.pending_orders_count ? ` [Đang đặt: ${c.pending_orders_count}]` : '';
      return `<option value="${c.id}">${c.name} (${c.phone || c.code})${preOrderInfo}</option>`;
    }).join('');
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

    const query = (document.getElementById('pos-search-input')?.value || '').trim();
    let filtered = this.products;

    if (this.activeCategory !== 'all') {
      filtered = filtered.filter(p => p.category === this.activeCategory);
    }
    if (query) {
      filtered = filtered.filter(p => App.matchesSearch(p, query, ['name', 'code', 'barcode', 'category']));
    }

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 40px;">Không tìm thấy sản phẩm phù hợp</div>`;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const hasCustom = this.customerPricesMap[p.id] !== undefined;
      const effectivePrice = hasCustom ? this.customerPricesMap[p.id] : p.sale_price;
      const isOutOfStock = p.stock <= 0;

      return `
        <div class="pos-product-card ${isOutOfStock ? 'product-card-out' : ''}" onclick="POS.addToCart(${p.id})">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
            <span class="product-code-tag">${p.code}</span>
            <span class="product-stock-tag ${p.stock <= p.min_stock ? 'badge-tag badge-red' : ''}">
              Tồn: ${p.stock} ${p.unit}
            </span>
          </div>
          <div class="product-name-title" title="${p.name}">${p.name}</div>
          
          ${p.stock_breakdown ? `<div class="breakdown-badge" title="Tồn kho chi tiết theo đơn vị">${p.stock_breakdown}</div>` : ''}

          ${p.units && p.units.length > 1 ? `
            <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">
              ${p.units.map(u => `${u.unit_name}${u.conversion_rate > 1 ? ` (x${u.conversion_rate})` : ''}`).join(' · ')}
            </div>
          ` : (p.sub_unit ? `<small style="color: #64748b; font-size: 0.72rem;">(1 ${p.unit} = ${p.sub_unit_ratio} ${p.sub_unit})</small>` : '')}

          <div class="product-price-row">
            <div>
              <div class="product-price">${App.formatMoney(effectivePrice)}</div>
              ${hasCustom ? `<span class="badge-custom-price"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Giá riêng</span> <span style="text-decoration: line-through; font-size: 0.72rem; color: #94a3b8;">${App.formatMoney(p.sale_price)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  getTotalBaseUnitsInCart(productId) {
    return this.cart
      .filter(item => item.product_id === productId)
      .reduce((sum, item) => sum + (item.quantity * (item.unit_conversion_rate || 1.0)), 0);
  },

  addToCart(productId, targetUnitName = null) {
    const prod = this.products.find(p => p.id === productId);
    if (!prod) return;

    // Determine unit
    const units = (prod.units && prod.units.length > 0) ? prod.units : [
      { unit_name: prod.unit, conversion_rate: 1.0, is_base: 1, sale_price: prod.sale_price }
    ];

    let chosenUnit = units[0];
    if (targetUnitName) {
      const match = units.find(u => u.unit_name.toLowerCase() === targetUnitName.toLowerCase());
      if (match) chosenUnit = match;
    }

    const convRate = chosenUnit.conversion_rate || 1.0;
    const neededBaseUnits = convRate;
    const currentBaseInCart = this.getTotalBaseUnitsInCart(productId);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');

    if (!allowNegative && (currentBaseInCart + neededBaseUnits) > prod.stock) {
      App.toast(`Sản phẩm "${prod.name}" chỉ còn tồn ${prod.stock} ${prod.unit} (${prod.stock_breakdown || ''}), không đủ để thêm!`, 'warning');
      return;
    }

    // Check if this product with the exact same unit is already in cart
    const existing = this.cart.find(item => item.product_id === productId && item.selected_unit === chosenUnit.unit_name);

    if (existing) {
      existing.quantity += 1;
      existing.subtotal = existing.quantity * existing.sale_price;
    } else {
      const hasCustom = this.customerPricesMap[prod.id] !== undefined;
      let effectiveUnitPrice;
      if (hasCustom) {
        effectiveUnitPrice = this.customerPricesMap[prod.id] * convRate;
      } else {
        effectiveUnitPrice = chosenUnit.sale_price > 0 ? chosenUnit.sale_price : (prod.sale_price * convRate);
      }

      this.cart.push({
        product_id: prod.id,
        code: prod.code,
        name: prod.name,
        base_unit: prod.unit,
        selected_unit: chosenUnit.unit_name,
        unit_conversion_rate: convRate,
        units: units,
        default_sale_price: chosenUnit.sale_price > 0 ? chosenUnit.sale_price : (prod.sale_price * convRate),
        sale_price: effectiveUnitPrice,
        is_custom_price: hasCustom,
        save_as_custom_price: false,
        quantity: 1,
        subtotal: effectiveUnitPrice
      });
    }

    this.calculatePromoDiscount();
    this.renderCart();
  },

  changeItemUnit(productId, newUnitName) {
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;

    const prod = this.products.find(p => p.id === productId);
    const chosenUnit = (item.units || []).find(u => u.unit_name === newUnitName);
    if (!chosenUnit) return;

    const oldRate = item.unit_conversion_rate || 1.0;
    const newRate = chosenUnit.conversion_rate || 1.0;
    const newBaseNeeded = item.quantity * newRate;
    const otherBaseInCart = this.getTotalBaseUnitsInCart(productId) - (item.quantity * oldRate);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');

    if (prod && !allowNegative && (otherBaseInCart + newBaseNeeded) > prod.stock) {
      App.toast(`Không đủ tồn kho để chuyển sang ${item.quantity} ${chosenUnit.unit_name} (Tương đương ${newBaseNeeded} ${prod.unit})`, 'warning');
      this.renderCart();
      return;
    }

    item.selected_unit = chosenUnit.unit_name;
    item.unit_conversion_rate = newRate;

    const hasCustom = this.customerPricesMap[productId] !== undefined;
    if (hasCustom) {
      item.sale_price = this.customerPricesMap[productId] * newRate;
    } else {
      item.sale_price = chosenUnit.sale_price > 0 ? chosenUnit.sale_price : ((prod ? prod.sale_price : item.default_sale_price) * newRate);
    }
    item.default_sale_price = item.sale_price;
    item.subtotal = item.quantity * item.sale_price;

    this.calculatePromoDiscount();
    this.renderCart();
  },

  updateQuantity(productId, delta) {
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;

    const prod = this.products.find(p => p.id === productId);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    const newQty = item.quantity + delta;

    if (delta > 0 && prod && !allowNegative) {
      const addedBaseUnits = delta * (item.unit_conversion_rate || 1.0);
      const totalBase = this.getTotalBaseUnitsInCart(productId) + addedBaseUnits;
      if (totalBase > prod.stock) {
        App.toast(`Không đủ tồn kho để tăng số lượng (Hiện còn ${prod.stock} ${prod.unit} [${prod.stock_breakdown || ''}])`, 'warning');
        return;
      }
    }

    item.quantity = newQty;
    if (item.quantity <= 0) {
      this.removeFromCart(productId);
      return;
    }
    item.subtotal = item.quantity * item.sale_price;
    this.calculatePromoDiscount();
    this.renderCart();
  },

  setQuantity(productId, value) {
    const qty = parseFloat(value) || 1;
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;

    const prod = this.products.find(p => p.id === productId);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    const oldRate = item.unit_conversion_rate || 1.0;
    const otherBaseInCart = this.getTotalBaseUnitsInCart(productId) - (item.quantity * oldRate);
    const neededBase = qty * oldRate;

    if (prod && !allowNegative && (otherBaseInCart + neededBase) > prod.stock) {
      App.toast(`Không đủ tồn kho để bán ${qty} ${item.selected_unit} (Hiện còn tồn: ${prod.stock} ${prod.unit})`, 'warning');
      const maxQty = Math.max(1, Math.floor((prod.stock - otherBaseInCart) / oldRate));
      item.quantity = maxQty;
    } else {
      item.quantity = Math.max(0.1, qty);
    }

    item.subtotal = item.quantity * item.sale_price;
    this.calculatePromoDiscount();
    this.renderCart();
  },

  editItemPrice(productId, newPrice, saveAsCustom = false) {
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;
    item.sale_price = Math.max(0, parseFloat(newPrice) || 0);
    item.subtotal = item.quantity * item.sale_price;
    item.is_custom_price = (item.sale_price !== item.default_sale_price);
    item.save_as_custom_price = saveAsCustom;
    this.calculatePromoDiscount();
    this.renderCart();
  },

  removeFromCart(productId) {
    this.cart = this.cart.filter(i => i.product_id !== productId);
    this.calculatePromoDiscount();
    this.renderCart();
  },

  clearCart() {
    this.cart = [];
    this.discountAmount = 0;
    this.promoDiscount = 0;
    this.selectedPromo = null;
    this.manualPromoCleared = false;
    this.customerPaid = 0;
    this.updatePromoBanner(null, 0);

    const promoSelect = document.getElementById('pos-promo-select');
    if (promoSelect) promoSelect.value = '';

    const paidInput = document.getElementById('pos-paid-input');
    if (paidInput) {
      paidInput.value = 0;
      paidInput.dataset.manual = 'false';
    }
    const discInput = document.getElementById('pos-discount-input');
    if (discInput) discInput.value = 0;
    this.renderCart();
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

    list.innerHTML = this.cart.map(item => `
      <div class="pos-cart-item">
        <div class="cart-item-header">
          <div>
            <span class="cart-item-name">${item.name}</span>
            ${item.is_custom_price ? '<span class="badge-custom-price" style="margin-left: 6px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Giá riêng</span>' : ''}
          </div>
          <button class="cart-item-delete" onclick="POS.removeFromCart(${item.product_id})" title="Xóa">✕</button>
        </div>
        <div class="cart-item-controls">
          <div class="cart-qty-group">
            <button class="qty-btn" onclick="POS.updateQuantity(${item.product_id}, -1)">-</button>
            <input type="number" step="any" class="qty-input" value="${item.quantity}" min="0.1" onchange="POS.setQuantity(${item.product_id}, this.value)">
            <button class="qty-btn" onclick="POS.updateQuantity(${item.product_id}, 1)">+</button>
          </div>

          <!-- Unit Selector (Lon / Lốc / Thùng) -->
          <div style="display: flex; align-items: center; gap: 4px;">
            ${(item.units && item.units.length > 1) ? `
              <select class="cart-unit-select" onchange="POS.changeItemUnit(${item.product_id}, this.value)" title="Chọn đơn vị tính">
                ${item.units.map(u => `
                  <option value="${u.unit_name}" ${u.unit_name === item.selected_unit ? 'selected' : ''}>
                    ${u.unit_name} (x${u.conversion_rate})
                  </option>
                `).join('')}
              </select>
            ` : `
              <span style="font-size: 0.82rem; font-weight: 600; color: #475569; padding: 2px 6px; background: #f1f5f9; border-radius: 4px;">
                ${item.selected_unit}
              </span>
            `}
          </div>

          <div class="cart-item-pricing">
            <div class="cart-item-subtotal">${App.formatMoney(item.subtotal)}</div>
            <div class="cart-item-unit-price">
              <span style="cursor: pointer; text-decoration: underline dotted; display: inline-flex; align-items: center; gap: 3px;" onclick="POS.promptEditPrice(${item.product_id})" title="Nhấp để sửa giá bán">
                ${App.formatMoney(item.sale_price)} / ${item.selected_unit}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </span>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    this.updateTotals();
  },

  promptEditPrice(productId) {
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;

    const newPriceStr = prompt(`Chỉnh sửa đơn giá cho "${item.name}" [${item.selected_unit}] (Giá niêm yết: ${App.formatMoney(item.default_sale_price)}):`, item.sale_price);
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

    this.editItemPrice(productId, newPrice, saveAsCustom);
    if (saveAsCustom) {
      App.toast(`Đã cài đặt giá riêng cho khách ${this.selectedCustomer.name}!`, 'success');
    }
  },

  updateTotals() {
    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const discountInput = document.getElementById('pos-discount-input');
    const manualDiscount = discountInput ? (parseFloat(discountInput.value) || 0) : 0;
    
    // Combine manual discount and promotion discount
    const totalDiscount = manualDiscount + (this.promoDiscount || 0);
    this.discountAmount = totalDiscount;

    const netRevenue = Math.max(0, subtotal - this.discountAmount);
    
    // VAT calculation
    const vatSelect = document.getElementById('pos-vat-select');
    this.vatPercent = vatSelect ? (parseFloat(vatSelect.value) || 0) : 0;
    const vatAmount = Math.round(netRevenue * (this.vatPercent / 100));
    const finalAmount = netRevenue + vatAmount;

    // Customer Paid input handling
    const paidInput = document.getElementById('pos-paid-input');
    if (paidInput && (!paidInput.dataset.manual || paidInput.dataset.manual === 'false')) {
      paidInput.value = finalAmount;
      this.customerPaid = finalAmount;
    } else if (paidInput) {
      this.customerPaid = parseFloat(paidInput.value) || 0;
    }

    // Change returned vs Debt
    const changeAmount = Math.max(0, this.customerPaid - finalAmount);
    const debtAmount = Math.max(0, finalAmount - this.customerPaid);

    // Elements
    const subtotalElem = document.getElementById('pos-subtotal');
    const vatAmountElem = document.getElementById('pos-vat-amount');
    const finalElem = document.getElementById('pos-final-amount');
    const balanceLabel = document.getElementById('pos-balance-label');
    const balanceElem = document.getElementById('pos-balance-amount');

    if (subtotalElem) subtotalElem.textContent = App.formatMoney(subtotal);
    if (vatAmountElem) vatAmountElem.textContent = App.formatMoney(vatAmount);
    if (finalElem) finalElem.textContent = App.formatMoney(finalAmount);

    if (balanceLabel && balanceElem) {
      if (this.customerPaid >= finalAmount) {
        balanceLabel.textContent = 'Tiền thừa trả khách:';
        balanceElem.textContent = App.formatMoney(changeAmount);
        balanceElem.style.color = '#10b981';
      } else {
        balanceLabel.textContent = 'Ghi nợ khách hàng:';
        balanceElem.textContent = App.formatMoney(debtAmount);
        balanceElem.style.color = '#ef4444';
      }
    }
  },

  setupEventListeners() {
    const searchInput = document.getElementById('pos-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.renderProducts());
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = searchInput.value.trim().toLowerCase();
          const match = this.products.find(p => 
            p.barcode === val || p.code.toLowerCase() === val
          );
          if (match) {
            this.addToCart(match.id);
            searchInput.value = '';
            this.renderProducts();
          }
        }
      });
    }

    const custSelect = document.getElementById('pos-customer-select');
    if (custSelect) {
      custSelect.addEventListener('change', (e) => this.selectCustomer(e.target.value));
    }

    const discInput = document.getElementById('pos-discount-input');
    if (discInput) {
      discInput.addEventListener('input', () => {
        this.updateTotals();
      });
    }

    const vatSelect = document.getElementById('pos-vat-select');
    if (vatSelect) {
      vatSelect.addEventListener('change', () => this.updateTotals());
    }

    const paidInput = document.getElementById('pos-paid-input');
    if (paidInput) {
      paidInput.addEventListener('input', () => {
        paidInput.dataset.manual = 'true';
        this.updateTotals();
      });
    }

    const methodBtns = document.querySelectorAll('.payment-method-btn');
    methodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        methodBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.paymentMethod = btn.dataset.method;
        if (this.paymentMethod === 'debt') {
          if (paidInput) {
            paidInput.value = 0;
            paidInput.dataset.manual = 'true';
            this.updateTotals();
          }
        }
      });
    });
  },

  async checkout(isPreOrder = false) {
    if (this.cart.length === 0) {
      App.toast('Giỏ hàng đang trống!', 'warning');
      return;
    }

    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const netRevenue = Math.max(0, subtotal - this.discountAmount);
    const vatAmount = Math.round(netRevenue * (this.vatPercent / 100));
    const finalAmount = netRevenue + vatAmount;

    const paid = isPreOrder ? 0 : this.customerPaid;
    const debt = Math.max(0, finalAmount - paid);

    if (!isPreOrder && debt > 0 && (!this.selectedCustomer || this.selectedCustomer.code === 'KH0001')) {
      App.toast('Khách lẻ không thể ghi nợ! Vui lòng chọn hoặc thêm khách hàng để ghi nợ.', 'error');
      return;
    }

    const orderData = {
      customer_id: this.selectedCustomer ? this.selectedCustomer.id : null,
      customer_name: this.selectedCustomer ? this.selectedCustomer.name : 'Khách lẻ',
      status: isPreOrder ? 'ordered' : 'completed',
      promotion_id: this.selectedPromo ? this.selectedPromo.id : null,
      promotion_code: this.selectedPromo ? this.selectedPromo.code : null,
      promotion_discount: this.promoDiscount || 0,
      items: this.cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit: i.selected_unit,
        unit_conversion_rate: i.unit_conversion_rate || 1.0,
        sale_price: i.sale_price,
        is_custom_price: i.is_custom_price,
        save_as_custom_price: i.save_as_custom_price
      })),
      discount: this.discountAmount,
      vat_percent: this.vatPercent,
      paid_amount: paid,
      payment_method: this.paymentMethod,
      notes: isPreOrder ? 'Khách đặt trước (Đơn đặt hàng)' : (debt > 0 ? `Khách nợ ${App.formatMoney(debt)}` : '')
    };

    try {
      const res = await API.createOrder(orderData);
      
      if (isPreOrder) {
        App.toast(`Đã lưu Đơn đặt hàng ${res.code} thành công (chưa xuất kho)!`, 'success');
      } else {
        App.toast(`Thanh toán đơn hàng ${res.code} thành công!`, 'success');
        // Show receipt modal with dynamic store configuration
        this.showReceiptModal({
          code: res.code,
          customer_name: orderData.customer_name,
          created_at: new Date().toLocaleString('vi-VN'),
          items: this.cart,
          subtotal: subtotal,
          discount: this.discountAmount,
          net_revenue: netRevenue,
          vat_percent: this.vatPercent,
          vat_amount: vatAmount,
          final_amount: finalAmount,
          customer_paid: paid,
          actual_paid: res.paid_amount,
          change: res.change_amount,
          debt: res.debt_amount,
          payment_method: this.paymentMethod
        });
      }

      this.clearCart();
      await this.loadProducts();
      await this.loadCustomers();
      App.refreshCurrentView();
    } catch (err) {
      App.toast(`Lỗi xử lý đơn hàng: ${err.message}`, 'error');
    }
  },

  loadOrder(order) {
    // Clone order items to POS cart
    if (!order || !order.items) return;
    this.cart = [];
    
    // Select customer
    if (order.customer_id) {
      this.selectCustomer(order.customer_id);
      const custSelect = document.getElementById('pos-customer-select');
      if (custSelect) custSelect.value = order.customer_id;
    }

    order.items.forEach(it => {
      const prod = this.products.find(p => p.id === it.product_id);
      const units = (prod && prod.units && prod.units.length > 0) ? prod.units : [
        { unit_name: it.unit || 'Cái', conversion_rate: it.unit_conversion_rate || 1.0, is_base: 1, sale_price: it.sale_price }
      ];

      this.cart.push({
        product_id: it.product_id,
        code: it.product_code || (prod ? prod.code : ''),
        name: it.product_name || (prod ? prod.name : ''),
        base_unit: prod ? prod.unit : it.unit,
        selected_unit: it.unit,
        unit_conversion_rate: it.unit_conversion_rate || 1.0,
        units: units,
        default_sale_price: it.sale_price,
        sale_price: it.sale_price,
        is_custom_price: false,
        save_as_custom_price: false,
        quantity: it.quantity,
        subtotal: it.quantity * it.sale_price
      });
    });

    const discInput = document.getElementById('pos-discount-input');
    if (discInput) discInput.value = order.discount || 0;
    this.discountAmount = order.discount || 0;

    const vatSelect = document.getElementById('pos-vat-select');
    if (vatSelect) vatSelect.value = order.vat_percent || 0;
    this.vatPercent = order.vat_percent || 0;

    this.renderCart();
    App.toast(`Đã nhân bản đơn ${order.code} vào giỏ hàng POS!`, 'info');
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
                  ${item.is_custom_price ? '<br><small style="font-style: italic; color: #555;">(Giá riêng thỏa thuận)</small>' : ''}
                </td>
                <td style="text-align: center;">${item.selected_unit || item.unit || ''}</td>
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
          ${order.discount > 0 ? `
            <div style="display: flex; justify-content: space-between; color: #b91c1c;">
              <span>Chiết khấu giảm giá:</span>
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
  }
};

window.POS = POS;
