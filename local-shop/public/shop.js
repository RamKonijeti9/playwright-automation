const productsElement = document.querySelector('#products');
const cartItemsElement = document.querySelector('#cart-items');
const cartCountElement = document.querySelector('#cart-count');
const cartItemCountElement = document.querySelector('#cart-item-count');
const cartTotalElement = document.querySelector('#cart-total');
const cartSubtotalElement = document.querySelector('#cart-subtotal');
const cartDiscountElement = document.querySelector('#cart-discount');
const cartShippingElement = document.querySelector('#cart-shipping');
const cartTaxElement = document.querySelector('#cart-tax');
const messageElement = document.querySelector('#app-message');
const searchInput = document.querySelector('#product-search');
const categoryFilter = document.querySelector('#category-filter');
const sortSelect = document.querySelector('#sort-products');
const emptyCatalogElement = document.querySelector('#catalog-empty');
const couponInput = document.querySelector('#coupon-code');
const applyCouponButton = document.querySelector('#apply-coupon');
const couponMessage = document.querySelector('#coupon-message');
const checkoutForm = document.querySelector('#checkout-form');
const placeOrderButton = document.querySelector('#place-order');
const confirmationElement = document.querySelector('#confirmation');

const cart = new Map();
let products = [];
const productCatalog = new Map();
let activeCoupon = null;
let catalogRequestId = 0;

function money(cents) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(cents / 100);
}

function showMessage(message) {
    messageElement.textContent = message;
}

function calculateTotals() {
    const subtotalCents = [...cart.entries()].reduce((total, [id, quantity]) => {
        const product = productCatalog.get(id);
        return total + (product ? product.priceCents * quantity : 0);
    }, 0);
    const discountCents = activeCoupon?.type === 'percent'
        ? Math.floor(subtotalCents * activeCoupon.value / 100)
        : 0;
    const shippingCents = activeCoupon?.type === 'shipping'
        || subtotalCents - discountCents >= 5000
        ? 0
        : subtotalCents === 0 ? 0 : 599;
    const taxCents = Math.round(
        (subtotalCents - discountCents + shippingCents) * 825 / 10000
    );

    return {
        subtotalCents,
        discountCents,
        shippingCents,
        taxCents,
        totalCents: subtotalCents - discountCents + shippingCents + taxCents
    };
}

function renderProducts(list) {
    productsElement.replaceChildren(...list.map((product) => {
        const card = document.createElement('article');
        card.className = 'product-card';
        card.dataset.productId = product.id;

        const category = document.createElement('p');
        category.className = 'product-category';
        category.textContent = product.category;
        const name = document.createElement('h3');
        name.textContent = product.name;
        const description = document.createElement('p');
        description.textContent = product.description;
        const price = document.createElement('p');
        price.className = 'product-price';
        price.textContent = money(product.priceCents);
        const stock = document.createElement('p');
        stock.className = 'stock-status';
        stock.textContent = product.stock > 0
            ? `${product.stock} in stock`
            : 'Out of stock';
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.textContent = product.stock > 0 ? 'Add to cart' : 'Out of stock';
        addButton.disabled = product.stock === 0;
        addButton.setAttribute('aria-label', `Add ${product.name} to cart`);
        addButton.addEventListener('click', () => addToCart(product.id));

        card.append(category, name, description, price, stock, addButton);
        return card;
    }));
    emptyCatalogElement.hidden = list.length !== 0;
}

async function loadProducts() {
    const requestId = ++catalogRequestId;
    const query = new URLSearchParams({
        search: searchInput.value.trim(),
        category: categoryFilter.value,
        sort: sortSelect.value
    });
    const response = await fetch(`/api/products?${query}`);
    if (!response.ok) {
        throw new Error('The product catalog could not be loaded.');
    }

    const result = await response.json();
    if (requestId !== catalogRequestId) {
        return;
    }
    products = result.products;
    for (const product of products) {
        productCatalog.set(product.id, product);
    }
    renderProducts(products);
    renderCart();
}

async function loadCategories() {
    const response = await fetch('/api/categories');
    if (!response.ok) {
        throw new Error('Product categories could not be loaded.');
    }
    const { categories } = await response.json();
    for (const category of categories) {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categoryFilter.append(option);
    }
}

function addToCart(productId) {
    const product = products.find((item) => item.id === productId);
    const quantity = cart.get(productId) || 0;
    if (!product || quantity >= product.stock) {
        showMessage(product
            ? `Only ${product.stock} ${product.name} item(s) are available.`
            : 'That product is no longer available.');
        return;
    }

    cart.set(productId, quantity + 1);
    showMessage(`${product.name} added to cart.`);
    renderCart();
}

function changeQuantity(productId, delta) {
    const product = products.find((item) => item.id === productId);
    const newQuantity = (cart.get(productId) || 0) + delta;
    if (newQuantity <= 0) {
        cart.delete(productId);
    } else if (product && newQuantity <= product.stock) {
        cart.set(productId, newQuantity);
    } else {
        showMessage(`Only ${product?.stock || 0} ${product?.name || 'item'}(s) are available.`);
    }
    renderCart();
}

function renderCart() {
    const entries = [...cart.entries()];
    const totalQuantity = entries.reduce((total, [, quantity]) => total + quantity, 0);
    const totals = calculateTotals();

    cartCountElement.textContent = String(totalQuantity);
    cartItemCountElement.textContent = `${totalQuantity} ${totalQuantity === 1 ? 'item' : 'items'}`;
    cartSubtotalElement.textContent = money(totals.subtotalCents);
    cartDiscountElement.textContent = `−${money(totals.discountCents)}`;
    cartShippingElement.textContent = money(totals.shippingCents);
    cartTaxElement.textContent = money(totals.taxCents);
    cartTotalElement.textContent = money(totals.totalCents);

    if (entries.length === 0) {
        cartItemsElement.innerHTML = '<p class="empty-cart">Your cart is empty.</p>';
        return;
    }

    cartItemsElement.replaceChildren(...entries.map(([id, quantity]) => {
        const product = productCatalog.get(id);
        if (!product) {
            return document.createElement('span');
        }

        const row = document.createElement('article');
        row.className = 'cart-row';
        row.dataset.productId = id;

        const details = document.createElement('div');
        const name = document.createElement('h3');
        name.textContent = product.name;
        const unitPrice = document.createElement('p');
        unitPrice.textContent = `${money(product.priceCents)} each`;
        const lineTotal = document.createElement('p');
        lineTotal.className = 'line-total';
        lineTotal.textContent = money(product.priceCents * quantity);
        details.append(name, unitPrice, lineTotal);

        const controls = document.createElement('div');
        controls.className = 'quantity-controls';
        const decrement = document.createElement('button');
        decrement.type = 'button';
        decrement.textContent = '−';
        decrement.setAttribute('aria-label', `Decrease ${product.name} quantity`);
        decrement.addEventListener('click', () => changeQuantity(id, -1));
        const count = document.createElement('span');
        count.setAttribute('aria-label', `${product.name} quantity`);
        count.textContent = String(quantity);
        const increment = document.createElement('button');
        increment.type = 'button';
        increment.textContent = '+';
        increment.setAttribute('aria-label', `Increase ${product.name} quantity`);
        increment.disabled = quantity >= product.stock;
        increment.addEventListener('click', () => changeQuantity(id, 1));
        controls.append(decrement, count, increment);

        row.append(details, controls);
        return row;
    }));
}

applyCouponButton.addEventListener('click', async () => {
    const code = couponInput.value.trim();
    if (!code) {
        activeCoupon = null;
        couponMessage.textContent = 'Enter a coupon code.';
        renderCart();
        return;
    }

    applyCouponButton.disabled = true;
    try {
        const response = await fetch(`/api/coupons/${encodeURIComponent(code)}`);
        const result = await response.json();
        if (!response.ok) {
            activeCoupon = null;
            couponMessage.textContent = result.error;
        } else {
            activeCoupon = result.coupon;
            couponMessage.textContent = `${activeCoupon.code} applied: ${activeCoupon.description}.`;
        }
        renderCart();
    } catch {
        activeCoupon = null;
        couponMessage.textContent = 'Coupon validation is unavailable. Please try again.';
        renderCart();
    } finally {
        applyCouponButton.disabled = false;
    }
});

checkoutForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (cart.size === 0) {
        showMessage('Add at least one product before placing your order.');
        return;
    }

    placeOrderButton.disabled = true;
    showMessage('');
    try {
        const form = new FormData(checkoutForm);
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                customerName: form.get('customerName'),
                customerEmail: form.get('customerEmail'),
                couponCode: activeCoupon?.code || null,
                items: [...cart.entries()].map(([productId, quantity]) => ({
                    productId,
                    quantity
                }))
            })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'The order could not be placed.');
        }

        confirmationElement.hidden = false;
        confirmationElement.replaceChildren();
        const heading = document.createElement('h2');
        heading.textContent = 'Order confirmed';
        const orderNumber = document.createElement('p');
        orderNumber.textContent = `Order number: ${result.id}`;
        orderNumber.dataset.orderId = String(result.id);
        const items = document.createElement('p');
        items.textContent = `${result.items.reduce((count, item) => count + item.quantity, 0)} item(s)`;
        const subtotal = document.createElement('p');
        subtotal.textContent = `Subtotal: ${money(result.subtotalCents)}`;
        const discount = document.createElement('p');
        discount.textContent = `Discount: ${money(result.discountCents)}`;
        const shipping = document.createElement('p');
        shipping.textContent = `Shipping: ${money(result.shippingCents)}`;
        const tax = document.createElement('p');
        tax.textContent = `Tax: ${money(result.taxCents)}`;
        const total = document.createElement('p');
        total.textContent = `Order total: ${money(result.totalCents)}`;
        confirmationElement.append(heading, orderNumber, items, subtotal, discount, shipping, tax, total);

        cart.clear();
        activeCoupon = null;
        couponInput.value = '';
        couponMessage.textContent = '';
        checkoutForm.reset();
        renderCart();
        showMessage('Your order was placed successfully.');
        await loadProducts();
    } catch (error) {
        showMessage(error.message);
    } finally {
        placeOrderButton.disabled = false;
    }
});

let searchTimer;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadProducts().catch((error) => showMessage(error.message)), 150);
});
categoryFilter.addEventListener('change', () => {
    loadProducts().catch((error) => showMessage(error.message));
});
sortSelect.addEventListener('change', () => {
    loadProducts().catch((error) => showMessage(error.message));
});
document.querySelector('#clear-filters').addEventListener('click', () => {
    searchInput.value = '';
    categoryFilter.value = 'all';
    sortSelect.value = 'name';
    loadProducts().catch((error) => showMessage(error.message));
});

Promise.all([loadCategories(), loadProducts()]).catch((error) => {
    showMessage(error.message);
});
