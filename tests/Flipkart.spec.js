const { test, expect } = require('@playwright/test');

const PRODUCT_PRICE_LIMIT_RUPEES = 10;
const MAX_PRODUCTS_TO_SCAN = 10;
const DEFAULT_PRODUCT_SEARCH_TERMS = ['pencil', 'eraser', 'pen', 'sharpener'];

async function signIn(page) {
    const email = process.env.FLIPKART_EMAIL;
    const password = process.env.FLIPKART_PASSWORD;
    const otp = process.env.FLIPKART_OTP;

    if (!email || !password) {
        throw new Error(
            'Set FLIPKART_EMAIL and FLIPKART_PASSWORD environment variables before running this test.'
        );
    }

    await page.goto('https://www.flipkart.com/');

    const emailInput = page.getByRole('textbox', { name: 'Email ID' });
    if (!(await emailInput.isVisible())) {
        const emailLoginOption = page.getByText('Use Email-ID', { exact: true });
        await expect(emailLoginOption).toBeVisible();
        await emailLoginOption.click();
    }

    await expect(emailInput).toBeVisible();
    await emailInput.fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    const passwordInput = page.getByLabel(/password/i);
    if (await passwordInput.isVisible()) {
        await passwordInput.fill(password);
        await page.getByRole('button', { name: /login|sign in|continue/i }).last().click();
    } else {
        await expect(page).toHaveURL(/\/login\/verify/);

        if (!otp) {
            throw new Error(
                'Flipkart requires an OTP for this login. Set FLIPKART_OTP to the current code received for this sign-in, then rerun.'
            );
        }

        if (!/^\d{6}$/.test(otp)) {
            throw new Error('FLIPKART_OTP must contain exactly six digits.');
        }

        const otpInputs = page.getByRole('spinbutton');
        await expect(otpInputs).toHaveCount(6);
        for (let index = 0; index < otp.length; index += 1) {
            await otpInputs.nth(index).fill(otp[index]);
        }
        await page.getByRole('button', { name: 'Verify', exact: true }).click();
    }

    await expect(page).not.toHaveURL(/\/login(?:\/verify)?(?:[/?]|$)/);
    const accountMenu = page.getByRole('link', {
        name: new RegExp(email.split('@')[0], 'i')
    });
    await expect(accountMenu).toBeVisible();
    await accountMenu.click();
    await expect(page.getByRole('link', { name: /My Profile/i })).toBeVisible();
}

async function findProductsBelowPrice(page, searchTerms) {
    const productsByUrl = new Map();
    const scannedProductIds = new Set();
    const scannedProducts = [];

    for (const searchTerm of searchTerms) {
        if (scannedProductIds.size >= MAX_PRODUCTS_TO_SCAN) {
            break;
        }

        await page.goto(
            `https://www.flipkart.com/search?q=${encodeURIComponent(searchTerm)}`
        );

        const pricedProductLinks = page
            .locator('a[href*="/p/"]')
            .filter({ hasText: /₹\s*[\d,]+(?:\.\d{1,2})?/ });
        await expect(pricedProductLinks.first()).toBeVisible({ timeout: 15000 });

        const count = await pricedProductLinks.count();
        for (let index = 0; index < count; index += 1) {
            if (scannedProductIds.size >= MAX_PRODUCTS_TO_SCAN) {
                break;
            }

            const productLink = pricedProductLinks.nth(index);
            const href = await productLink.getAttribute('href');
            if (!href) {
                continue;
            }

            const parsedProductUrl = new URL(href, 'https://www.flipkart.com');
            const productUrl = parsedProductUrl.toString();
            const productId = parsedProductUrl.searchParams.get('pid')
                || parsedProductUrl.pathname;
            if (scannedProductIds.has(productId)) {
                continue;
            }
            scannedProductIds.add(productId);

            const cardText = (await productLink.locator('..').innerText())
                .replace(/\s+/g, ' ')
                .trim();
            const priceMatch = cardText.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
            if (!priceMatch) {
                continue;
            }

            const priceRupees = Number(priceMatch[1].replace(/,/g, ''));
            if (!Number.isFinite(priceRupees)) {
                continue;
            }

            const name = cardText.slice(0, priceMatch.index).trim()
                || new URL(productUrl).pathname.split('/').filter(Boolean)[0];
            scannedProducts.push({ name, priceRupees });
            if (priceRupees >= PRODUCT_PRICE_LIMIT_RUPEES) {
                continue;
            }

            productsByUrl.set(productId, { name, priceRupees, url: productUrl });
        }
    }

    return {
        scannedProducts,
        affordableProducts: [...productsByUrl.values()]
    };
}

test('Flipkart user adds search results priced below ₹10 to cart', async ({ page }) => {
    await signIn(page);

    const searchTerms = (process.env.FLIPKART_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
    if (searchTerms.length === 0) {
        throw new Error('Set FLIPKART_PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const { scannedProducts, affordableProducts } =
        await findProductsBelowPrice(page, searchTerms);
    console.log(
        `First ${scannedProducts.length} inspected search products (name and price):`,
        JSON.stringify(scannedProducts, null, 2)
    );
    console.log(
        `Products priced below ₹${PRODUCT_PRICE_LIMIT_RUPEES} among the first ${MAX_PRODUCTS_TO_SCAN} search results:`,
        JSON.stringify(affordableProducts, null, 2)
    );

    test.skip(
        affordableProducts.length === 0,
        `No products below ₹${PRODUCT_PRICE_LIMIT_RUPEES} were found in the current search results.`
    );

    for (const product of affordableProducts) {
        await page.goto(product.url);
        const addToCartButton = page.getByRole('button', {
            name: /add to cart/i
        }).first();
        await expect(addToCartButton).toBeVisible();
        await expect(addToCartButton).toBeEnabled();
        await addToCartButton.click();
        await expect(page.getByText(/added to cart|added to your cart/i))
            .toBeVisible({ timeout: 10000 });

        console.log(
            `Added to cart: ${product.name} — ₹${product.priceRupees.toFixed(2)}`
        );
    }
});