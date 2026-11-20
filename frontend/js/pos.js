/**
 * POS (Point of Sale) & Cashier Checkout Module
 * Accurate cash drawer calculation, VAT taxation, packaging sub-units,
 * customer price matching, and dynamic store receipt printing.
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

  async init() {
    await this.loadStoreSettings();
    await this.loadCustomers();
    await this.loadProducts();
    this.renderCategories();
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

    // Refresh cart item prices according to selected customer
    this.cart.forEach(item => {
      if (this.customerPricesMap[item.product_id] !== undefined) {
        item.sale_price = this.customerPricesMap[item.product_id];
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
        (p.barcode && p.barcode.toLowerCase().includes(query))
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

      return `
        <div class="pos-product-card ${isOutOfStock ? 'product-card-out' : ''}" onclick="POS.addToCart(${p.id})">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="product-code-tag">${p.code}</span>
            <span class="product-stock-tag ${p.stock <= p.min_stock ? 'badge-tag badge-red' : ''}">
              Tồn: ${p.stock} ${p.unit}
            </span>
          </div>
          <div class="product-name-title" title="${p.name}">${p.name}</div>
          ${p.sub_unit ? `<small style="color: #64748b; font-size: 0.72rem;">(1 ${p.unit} = ${p.sub_unit_ratio} ${p.sub_unit})</small>` : ''}
          <div class="product-price-row">
            <div>
              <div class="product-price">${App.formatMoney(effectivePrice)}</div>
              ${hasCustom ? `<span class="badge-custom-price">⭐ Giá riêng</span> <span style="text-decoration: line-through; font-size: 0.72rem; color: #94a3b8;">${App.formatMoney(p.sale_price)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  addToCart(productId) {
    const prod = this.products.find(p => p.id === productId);
    if (!prod) return;

    const existing = this.cart.find(item => item.product_id === productId);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    const targetQty = (existing ? existing.quantity + 1 : 1);

    if (!allowNegative && prod.stock < targetQty) {
      App.toast(`Sản phẩm "${prod.name}" chỉ còn tồn ${prod.stock} ${prod.unit}, không đủ để bán thêm!`, 'warning');
      return;
    }

    if (existing) {
      existing.quantity += 1;
      existing.subtotal = existing.quantity * existing.sale_price;
    } else {
      const hasCustom = this.customerPricesMap[prod.id] !== undefined;
      const effectivePrice = hasCustom ? this.customerPricesMap[prod.id] : prod.sale_price;

      this.cart.push({
        product_id: prod.id,
        code: prod.code,
        name: prod.name,
        unit: prod.unit,
        default_sale_price: prod.sale_price,
        sale_price: effectivePrice,
        is_custom_price: hasCustom,
        save_as_custom_price: false,
        quantity: 1,
        subtotal: effectivePrice
      });
    }

    this.renderCart();
  },

  updateQuantity(productId, delta) {
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;

    const prod = this.products.find(p => p.id === productId);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    const newQty = item.quantity + delta;

    if (delta > 0 && prod && !allowNegative && prod.stock < newQty) {
      App.toast(`Không đủ tồn kho để bán ${newQty} ${prod.unit} (Hiện còn tồn: ${prod.stock})`, 'warning');
      return;
    }

    item.quantity = newQty;
    if (item.quantity <= 0) {
      this.removeFromCart(productId);
      return;
    }
    item.subtotal = item.quantity * item.sale_price;
    this.renderCart();
  },

  setQuantity(productId, value) {
    const qty = parseFloat(value) || 1;
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;

    const prod = this.products.find(p => p.id === productId);
    const allowNegative = (this.storeSettings.allow_negative_stock === 'true');
    if (prod && !allowNegative && prod.stock < qty) {
      App.toast(`Không đủ tồn kho để bán ${qty} ${prod.unit} (Hiện còn tồn: ${prod.stock})`, 'warning');
      item.quantity = prod.stock > 0 ? prod.stock : 1;
    } else {
      item.quantity = Math.max(1, qty);
    }

    item.subtotal = item.quantity * item.sale_price;
    this.renderCart();
  },

  editItemPrice(productId, newPrice, saveAsCustom = false) {
    const item = this.cart.find(i => i.product_id === productId);
    if (!item) return;
    item.sale_price = Math.max(0, parseFloat(newPrice) || 0);
    item.subtotal = item.quantity * item.sale_price;
    item.is_custom_price = (item.sale_price !== item.default_sale_price);
    item.save_as_custom_price = saveAsCustom;
    this.renderCart();
  },

  removeFromCart(productId) {
    this.cart = this.cart.filter(i => i.product_id !== productId);
    this.renderCart();
  },

  clearCart() {
    this.cart = [];
    this.discountAmount = 0;
    this.customerPaid = 0;
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
        <div style="text-align: center; color: #94a3b8; padding: 40px 10px;">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">🛒</div>
          <div>Chưa có sản phẩm nào trong giỏ</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Chọn sản phẩm hoặc quét mã vạch để thêm</div>
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
            ${item.is_custom_price ? '<span class="badge-custom-price" style="margin-left: 6px;">⭐ Giá riêng</span>' : ''}
          </div>
          <button class="cart-item-delete" onclick="POS.removeFromCart(${item.product_id})" title="Xóa">✕</button>
        </div>
        <div class="cart-item-controls">
          <div class="cart-qty-group">
            <button class="qty-btn" onclick="POS.updateQuantity(${item.product_id}, -1)">-</button>
            <input type="number" class="qty-input" value="${item.quantity}" min="1" onchange="POS.setQuantity(${item.product_id}, this.value)">
            <button class="qty-btn" onclick="POS.updateQuantity(${item.product_id}, 1)">+</button>
          </div>
          <div class="cart-item-pricing">
            <div class="cart-item-subtotal">${App.formatMoney(item.subtotal)}</div>
            <div class="cart-item-unit-price">
              <span style="cursor: pointer; text-decoration: underline dotted;" onclick="POS.promptEditPrice(${item.product_id})">
                ${App.formatMoney(item.sale_price)} / ${item.unit} ✏️
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

    const newPriceStr = prompt(`Chỉnh sửa đơn giá cho "${item.name}" (Giá niêm yết: ${App.formatMoney(item.default_sale_price)}):`, item.sale_price);
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
    const discountVal = discountInput ? (parseFloat(discountInput.value) || 0) : 0;
    this.discountAmount = discountVal;

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

    // Precise Accounting:
    // Change returned (thối lại) vs Debt (ghi nợ)
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
      discInput.addEventListener('input', () => this.updateTotals());
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

  async checkout() {
    if (this.cart.length === 0) {
      App.toast('Giỏ hàng đang trống!', 'warning');
      return;
    }

    const subtotal = this.cart.reduce((sum, item) => sum + item.subtotal, 0);
    const netRevenue = Math.max(0, subtotal - this.discountAmount);
    const vatAmount = Math.round(netRevenue * (this.vatPercent / 100));
    const finalAmount = netRevenue + vatAmount;

    const paid = this.customerPaid;
    const debt = Math.max(0, finalAmount - paid);

    if (debt > 0 && (!this.selectedCustomer || this.selectedCustomer.code === 'KH0001')) {
      App.toast('Khách lẻ không thể ghi nợ! Vui lòng chọn hoặc thêm khách hàng để ghi nợ.', 'error');
      return;
    }

    const orderData = {
      customer_id: this.selectedCustomer ? this.selectedCustomer.id : null,
      customer_name: this.selectedCustomer ? this.selectedCustomer.name : 'Khách lẻ',
      items: this.cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        sale_price: i.sale_price,
        is_custom_price: i.is_custom_price,
        save_as_custom_price: i.save_as_custom_price
      })),
      discount: this.discountAmount,
      vat_percent: this.vatPercent,
      paid_amount: paid,
      payment_method: this.paymentMethod,
      notes: debt > 0 ? `Khách nợ ${App.formatMoney(debt)}` : ''
    };

    try {
      const res = await API.createOrder(orderData);
      App.toast(`Tạo đơn hàng ${res.code} thành công!`, 'success');

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

      this.clearCart();
      await this.loadProducts();
      await this.loadCustomers();
      App.refreshCurrentView();
    } catch (err) {
      App.toast(`Lỗi thanh toán: ${err.message}`, 'error');
    }
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
          <div style="font-size: 11px;">Khách hàng: <strong>${order.customer_name}</strong></div>
        </div>

        <div class="divider"></div>

        <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th style="text-align: left; padding: 4px 0;">Mặt hàng</th>
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
