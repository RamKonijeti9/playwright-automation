const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MIN_DISCOUNT_PERCENT = 40;
const MAX_PRODUCTS_TO_SCAN = 30;
const OUTPUT_DIRECTORY = path.join(__dirname, '..', '.playwright-state');
const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'flipkart-discounts.csv');
const DEFAULT_PRODUCT_SEARCH_TERMS = [
    'fashion',
    'mobile phones',
    'electronics',
    'beauty products',
    'home essentials',
    'home appliances',
    'toys and baby products',
    'food and health',
    'auto accessories',
    'sports and fitness',
    'furniture',
    'books',
    'two wheelers'
];

async function findProductsWithDiscount(page, searchTerms) {
    const scannedProductIds = new Set();
    const matchingProducts = [];

    for (const searchTerm of searchTerms) {
        await page.goto(
            `https://www.flipkart.com/search?q=${encodeURIComponent(searchTerm)}`
        );

        const productCards = await page.locator('a[href*="/p/"]').evaluateAll((links) => {
            const ids = new Set();

            return links.flatMap((link) => {
                const url = new URL(link.href);
                const productId = url.searchParams.get('pid') || url.pathname;
                const text = (link.innerText || '').replace(/\s+/g, ' ').trim();
                const priceValues = [link, ...link.querySelectorAll('*')]
                    .filter((element) => element.children.length === 0)
                    .map((element) => element.textContent.trim().match(
                        /^₹\s*([\d,]+(?:\.\d{1,2})?)$/
                    ))
                    .filter(Boolean)
                    .map((match) => Number(match[1].replace(/,/g, '')));

                if (ids.has(productId) || priceValues.length < 2) {
                    return [];
                }
                ids.add(productId);

                const currentPrice = priceValues[0];
                const originalPrice = priceValues[1];
                if (!Number.isFinite(currentPrice)
                    || !Number.isFinite(originalPrice)
                    || originalPrice <= 0
                    || currentPrice >= originalPrice) {
                    return [];
                }

                const firstPriceIndex = text.search(/₹\s*[\d,]+(?:\.\d{1,2})?/);
                const name = text.slice(0, firstPriceIndex).trim()
                    .replace(/^Add to Compare\s*/i, '')
                    || url.pathname.split('/').filter(Boolean)[0];

                return [{
                    productId,
                    name,
                    currentPrice,
                    originalPrice,
                    url: url.toString()
                }];
            });
        });

        const product = productCards.find((item) => !scannedProductIds.has(item.productId));
        if (!product) {
            continue;
        }

        scannedProductIds.add(product.productId);
        const discountPercent = (
            (product.originalPrice - product.currentPrice) / product.originalPrice
        ) * 100;

        if (discountPercent > MIN_DISCOUNT_PERCENT) {
            matchingProducts.push({
                searchTerm,
                name: product.name,
                priceRupees: product.currentPrice,
                originalPriceRupees: product.originalPrice,
                discountPercent: Number(discountPercent.toFixed(2)),
                url: product.url
            });
        }
    }

    return matchingProducts;
}

function writeProductsCsv(products) {
    const columns = [
        'search_term',
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

test('List high-discount products across Flipkart categories', async ({ page }) => {
    const searchTerms = (process.env.FLIPKART_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);

    if (searchTerms.length === 0) {
        throw new Error('Set FLIPKART_PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const products = await findProductsWithDiscount(page, searchTerms);
    writeProductsCsv(products);
    expect(fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n')).toHaveLength(products.length + 2);
});
