const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MIN_DISCOUNT_PERCENT = 40;
const MAX_PRODUCTS_TO_SCAN = 30;
const OUTPUT_DIRECTORY = path.join(__dirname, '..', '.playwright-state');
const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'amazon-discounts.csv');
const DEFAULT_PRODUCT_SEARCH_TERMS = [
    'mobile phone',
    'running shoes',
    'mens shirt',
    'wireless earbuds',
    'smart watch',
    'kitchen mixer',
    'toys',
    'novel book',
    'bedsheet',
    'backpack'
];

function parseRupees(text) {
    const match = text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
}

async function findDiscountedProducts(page, searchTerms) {
    const productsById = new Map();

    for (const searchTerm of searchTerms) {
        if (productsById.size >= MAX_PRODUCTS_TO_SCAN) {
            break;
        }

        await page.goto(
            `https://www.amazon.in/s?k=${encodeURIComponent(searchTerm)}`
        );

        const resultCards = page.locator(
            '[data-component-type="s-search-result"][data-asin]'
        );
        await expect(resultCards.first()).toBeVisible({ timeout: 20000 });

        const count = await resultCards.count();
        for (let index = 0; index < count; index += 1) {
            if (productsById.size >= MAX_PRODUCTS_TO_SCAN) {
                break;
            }

            const card = resultCards.nth(index);
            const product = await card.evaluate((element, term) => {
                const productId = element.getAttribute('data-asin');
                const title = element.querySelector('h2 span')?.textContent?.trim();
                const currentPriceText = element.querySelector(
                    '.a-price:not(.a-text-price) .a-offscreen'
                )?.textContent?.trim();
                const originalPriceText = element.querySelector(
                    '.a-price.a-text-price .a-offscreen'
                )?.textContent?.trim();

                return {
                    productId,
                    searchTerm: term,
                    name: title || '',
                    currentPriceText: currentPriceText || '',
                    originalPriceText: originalPriceText || '',
                    url: productId ? `https://www.amazon.in/dp/${productId}` : ''
                };
            }, searchTerm);

            if (!product.productId || productsById.has(product.productId)) {
                continue;
            }
            productsById.set(product.productId, {
                ...product,
                searchTerm,
                currentPrice: parseRupees(product.currentPriceText),
                originalPrice: parseRupees(product.originalPriceText)
            });
        }
    }

    return [...productsById.values()]
        .filter((product) => Number.isFinite(product.currentPrice)
            && Number.isFinite(product.originalPrice)
            && product.originalPrice > product.currentPrice)
        .map((product) => {
            const discountPercent = (
                (product.originalPrice - product.currentPrice) / product.originalPrice
            ) * 100;
            return {
                searchTerm: product.searchTerm,
                productId: product.productId,
                name: product.name,
                priceRupees: product.currentPrice,
                originalPriceRupees: product.originalPrice,
                discountPercent: Number(discountPercent.toFixed(2)),
                url: product.url
            };
        })
        .filter((product) => product.discountPercent > MIN_DISCOUNT_PERCENT);
}

function writeProductsCsv(products) {
    const columns = [
        'search_term',
        'product_id',
        'product_name',
        'selling_price_inr',
        'original_price_inr',
        'discount_percent',
        'product_url'
    ];
    const csvCell = (value) => {
        let text = String(value ?? '');
        if (/^[=+\-@]/.test(text)) {
            text = `'${text}`;
        }
        return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = products.map((product) => [
        product.searchTerm,
        product.productId,
        product.name,
        product.priceRupees,
        product.originalPriceRupees,
        product.discountPercent,
        product.url
    ]);
    const csv = [
        columns.map(csvCell).join(','),
        ...rows.map((row) => row.map(csvCell).join(','))
    ].join('\n') + '\n';

    fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, csv, 'utf8');
}

test('List Amazon products with discounts above the threshold', async ({ page }) => {
    const searchTerms = (process.env.AMAZON_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);

    if (searchTerms.length === 0) {
        throw new Error('Set AMAZON_PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const products = await findDiscountedProducts(page, searchTerms);
    writeProductsCsv(products);

    expect(fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n'))
        .toHaveLength(products.length + 2);
    console.log(`Saved ${products.length} matching Amazon products to ${OUTPUT_FILE}`);
});
