const { test, expect } = require('@playwright/test');

const MIN_DISCOUNT_PERCENT = 90;
const MAX_PRODUCTS_TO_SCAN = 10;
const DEFAULT_PRODUCT_SEARCH_TERMS = ['pencil', 'eraser', 'pen', 'sharpener'];

async function findProductsWithDiscount(page, searchTerms) {
    const scannedProductIds = new Set();
    const matchingProducts = [];

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

        const resultCount = await pricedProductLinks.count();
        for (let index = 0; index < resultCount; index += 1) {
            if (scannedProductIds.size >= MAX_PRODUCTS_TO_SCAN) {
                break;
            }

            const productLink = pricedProductLinks.nth(index);
            const href = await productLink.getAttribute('href');
            if (!href) {
                continue;
            }

            const productUrl = new URL(href, 'https://www.flipkart.com');
            const productId = productUrl.searchParams.get('pid') || productUrl.pathname;
            if (scannedProductIds.has(productId)) {
                continue;
            }
            scannedProductIds.add(productId);

            const cardText = (await productLink.locator('..').innerText())
                .replace(/\s+/g, ' ')
                .trim();
            const discountMatch = cardText.match(/(\d{1,3})\s*%\s*off/i);
            if (!discountMatch) {
                continue;
            }

            const discountPercent = Number(discountMatch[1]);
            if (discountPercent <= MIN_DISCOUNT_PERCENT) {
                continue;
            }

            const priceMatch = cardText.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
            const name = cardText.slice(0, priceMatch?.index ?? discountMatch.index).trim()
                || productUrl.pathname.split('/').filter(Boolean)[0];

            matchingProducts.push({
                name,
                price: priceMatch ? `₹${priceMatch[1]}` : 'Price not found',
                discountPercent,
                url: productUrl.toString()
            });
        }
    }

    return matchingProducts;
}

test('List the first ten Flipkart products with discounts above 90%', async ({ page }) => {
    const searchTerms = (process.env.FLIPKART_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);

    if (searchTerms.length === 0) {
        throw new Error('Set FLIPKART_PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const products = await findProductsWithDiscount(page, searchTerms);

    console.log(
        `Products with discounts greater than ${MIN_DISCOUNT_PERCENT}% among the first ${MAX_PRODUCTS_TO_SCAN} search results:`
    );
    console.log(JSON.stringify(products, null, 2));
});
