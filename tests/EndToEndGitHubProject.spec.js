const { test, expect } = require('@playwright/test');

test('shopper completes an order and the API stores the correct totals @smoke', async ({
    page,
    request
}) => {
    const productsResponse = await request.get('/api/products');
    expect(productsResponse.ok()).toBeTruthy();

    const { products } = await productsResponse.json();
    expect(products).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'backpack',
            name: 'Everyday Backpack',
            priceCents: 3499,
            category: 'Accessories',
            stock: expect.any(Number)
        }),
        expect.objectContaining({
            id: 'mug',
            name: 'Ceramic Mug',
            priceCents: 1299
        })
    ]));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Everyday essentials' }))
        .toBeVisible();
    await expect(page.getByRole('button', {
        name: 'Add Insulated Travel Bottle to cart'
    })).toBeDisabled();

    const backpackAddButton = page.getByRole('button', {
        name: 'Add Everyday Backpack to cart'
    });
    await backpackAddButton.click();
    await backpackAddButton.click();
    await page.getByRole('button', { name: 'Add Ceramic Mug to cart' }).click();

    await expect(page.getByText('3 items', { exact: true })).toBeVisible();
    await expect(page.locator('.cart-row')
        .filter({ hasText: 'Everyday Backpack' })).toContainText('$69.98');
    await expect(page.locator('.cart-row')
        .filter({ hasText: 'Ceramic Mug' })).toContainText('$12.99');
    await expect(page.locator('#cart-subtotal')).toHaveText('$82.97');
    await expect(page.locator('#cart-shipping')).toHaveText('$0.00');

    await page.getByLabel('Coupon code').fill('NOTREAL');
    await page.getByRole('button', { name: 'Apply coupon' }).click();
    await expect(page.getByText('Coupon code is not valid.')).toBeVisible();
    await expect(page.locator('#cart-total')).toHaveText('$89.82');

    await page.getByLabel('Coupon code').fill('save10');
    await page.getByRole('button', { name: 'Apply coupon' }).click();
    await expect(page.getByText('SAVE10 applied: 10% off products.')).toBeVisible();
    await expect(page.locator('#cart-discount')).toHaveText('−$8.29');
    await expect(page.locator('#cart-tax')).toHaveText('$6.16');
    await expect(page.locator('#cart-total')).toHaveText('$80.84');

    await page.getByLabel('Full name').fill('Playwright Shopper');
    await page.getByLabel('Email address').fill('shopper@example.test');
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page.getByRole('heading', { name: 'Order confirmed' }))
        .toBeVisible();
    await expect(page.getByText('Subtotal: $82.97')).toBeVisible();
    await expect(page.getByText('Discount: $8.29')).toBeVisible();
    await expect(page.getByText('Shipping: $0.00')).toBeVisible();
    await expect(page.getByText('Tax: $6.16')).toBeVisible();
    await expect(page.getByText('Order total: $80.84')).toBeVisible();
    await expect(page.getByText('Your order was placed successfully.'))
        .toBeVisible();

    const orderId = await page.locator('#confirmation [data-order-id]')
        .getAttribute('data-order-id');
    expect(orderId).toMatch(/^\d+$/);

    const orderResponse = await request.get(`/api/orders/${orderId}`);
    expect(orderResponse.ok()).toBeTruthy();
    expect(await orderResponse.json()).toMatchObject({
        id: Number(orderId),
        customerName: 'Playwright Shopper',
        customerEmail: 'shopper@example.test',
        subtotalCents: 8297,
        discountCents: 829,
        shippingCents: 0,
        taxCents: 616,
        totalCents: 8084,
        couponCode: 'SAVE10',
        items: [
            {
                productId: 'mug',
                productName: 'Ceramic Mug',
                unitPriceCents: 1299,
                quantity: 1
            },
            {
                productId: 'backpack',
                productName: 'Everyday Backpack',
                unitPriceCents: 3499,
                quantity: 2
            }
        ]
    });
});

test('shopper can search, filter, and sort the product catalog @regression', async ({
    page,
    request
}) => {
    const categoriesResponse = await request.get('/api/categories');
    expect(categoriesResponse.ok()).toBeTruthy();
    expect(await categoriesResponse.json()).toMatchObject({
        categories: ['Accessories', 'Home', 'Lifestyle', 'Stationery']
    });

    const filteredResponse = await request.get('/api/products?category=Home&sort=price-asc');
    expect(filteredResponse.ok()).toBeTruthy();
    const filteredProducts = (await filteredResponse.json()).products;
    expect(filteredProducts.map((product) => product.id)).toEqual(['mug', 'desk-lamp']);

    await page.goto('/');
    await page.getByLabel('Category').selectOption('Accessories');
    await expect(page.locator('.product-card')).toHaveCount(2);
    await page.getByLabel('Search products').fill('backpack');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await expect(page.locator('.product-card h3')).toHaveText('Everyday Backpack');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('.product-card')).toHaveCount(6);
    await page.getByLabel('Sort by').selectOption('price-desc');
    await expect(page.locator('.product-card h3').first())
        .toHaveText('Adjustable Desk Lamp');
});

test('free-shipping coupon removes shipping before tax is calculated @regression', async ({
    page,
    request
}) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add Ceramic Mug to cart' }).click();

    await expect(page.locator('#cart-subtotal')).toHaveText('$12.99');
    await expect(page.locator('#cart-shipping')).toHaveText('$5.99');
    await expect(page.locator('#cart-tax')).toHaveText('$1.57');
    await expect(page.locator('#cart-total')).toHaveText('$20.55');

    await page.getByLabel('Coupon code').fill('FREESHIP');
    await page.getByRole('button', { name: 'Apply coupon' }).click();
    await expect(page.getByText('FREESHIP applied: Free shipping.')).toBeVisible();
    await expect(page.locator('#cart-shipping')).toHaveText('$0.00');
    await expect(page.locator('#cart-tax')).toHaveText('$1.07');
    await expect(page.locator('#cart-total')).toHaveText('$14.06');

    await page.getByLabel('Full name').fill('Free Shipping Shopper');
    await page.getByLabel('Email address').fill('freight@example.test');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
    await expect(page.getByText('Order total: $14.06')).toBeVisible();

    const orderId = await page.locator('#confirmation [data-order-id]')
        .getAttribute('data-order-id');
    const orderResponse = await request.get(`/api/orders/${orderId}`);
    expect(orderResponse.ok()).toBeTruthy();
    expect(await orderResponse.json()).toMatchObject({
        subtotalCents: 1299,
        discountCents: 0,
        shippingCents: 0,
        taxCents: 107,
        totalCents: 1406,
        couponCode: 'FREESHIP'
    });
});

test('orders API rejects invalid checkout data @api', async ({ request }) => {
    const response = await request.post('/api/orders', {
        data: {
            customerName: 'Test Shopper',
            customerEmail: 'not-an-email',
            items: [{ productId: 'mug', quantity: 1 }]
        }
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
        error: 'A valid customer email is required.'
    });
});

test('orders API rejects out-of-stock items and unknown coupons @api', async ({ request }) => {
    const outOfStockResponse = await request.post('/api/orders', {
        data: {
            customerName: 'Stock Checker',
            customerEmail: 'stock@example.test',
            items: [{ productId: 'travel-bottle', quantity: 1 }]
        }
    });
    expect(outOfStockResponse.status()).toBe(409);
    expect(await outOfStockResponse.json()).toMatchObject({
        error: 'Insulated Travel Bottle has only 0 item(s) available.',
        productId: 'travel-bottle',
        available: 0
    });

    const couponResponse = await request.post('/api/orders', {
        data: {
            customerName: 'Coupon Checker',
            customerEmail: 'coupon@example.test',
            couponCode: 'NOTREAL',
            items: [{ productId: 'mug', quantity: 1 }]
        }
    });
    expect(couponResponse.status()).toBe(400);
    expect(await couponResponse.json()).toEqual({
        error: 'Coupon code is not valid.'
    });
});
