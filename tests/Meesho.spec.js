const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MIN_DISCOUNT_PERCENT = 40;
const MAX_PRODUCTS_TO_SCAN = 30;
const OUTPUT_DIRECTORY = path.join(__dirname, '..', '.playwright-state');
const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'meesho-discounts.csv');
const DEFAULT_PRODUCT_SEARCH_TERMS = [
    'kurti',
    'mens shirt',
    'running shoes',
    'wireless earbuds',
    'smart watch',
    'kitchen mixer',
    'toys',
    'bedsheet',
    'backpack',
    'saree'
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
            `https://www.meesho.com/search?q=${encodeURIComponent(searchTerm)}`
        );

        const pageText = await page.locator('body').innerText();
        if (/access denied|don't have permission/i.test(pageText)) {
            throw new Error(
                `Meesho denied access while searching for "${searchTerm}".`
            );
        }

        const resultCards = page.locator('a[href*="/p/"]');
        await expect(resultCards.first()).toBeVisible({ timeout: 20000 });

        const count = await resultCards.count();
        for (let index = 0; index < count; index += 1) {
            if (productsById.size >= MAX_PRODUCTS_TO_SCAN) {
                break;
            }

            const card = resultCards.nth(index);
            const product = await card.evaluate((element, term) => {
                const priceNodes = [...element.querySelectorAll('*')]
                    .filter((node) => node.children.length === 0
                        && /₹\s*[\d,]+(?:\.\d{1,2})?/.test(node.textContent || ''))
                    .map((node) => {
                        let current = node;
                        let isOriginalPrice = false;
                        while (current && current !== element) {
                            const decoration = getComputedStyle(current).textDecorationLine;
                            if (current.matches('del, s, strike')
                                || decoration.includes('line-through')) {
                                isOriginalPrice = true;
                                break;
                            }
                            current = current.parentElement;
                        }
                        return {
                            text: node.textContent.trim(),
                            isOriginalPrice
                        };
                    });
                const productUrl = new URL(element.href, window.location.origin);
                const productId = productUrl.pathname.match(/\/p\/([^/?#]+)/)?.[1] || '';
                const name = (element.innerText || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .find((line) => line && !/₹\s*[\d,]+/.test(line)) || '';
                const currentPrice = priceNodes.find((price) => !price.isOriginalPrice);
                const originalPrice = priceNodes.find((price) => price.isOriginalPrice);

                return {
                    productId,
                    searchTerm: term,
                    name,
                    currentPriceText: currentPrice?.text || '',
                    originalPriceText: originalPrice?.text || '',
                    url: productId ? productUrl.href : ''
                };
            }, searchTerm);

            if (!product.productId || productsById.has(product.productId)) {
                continue;
            }
            productsById.set(product.productId, {
                ...product,
                currentPrice: parseRupees(product.currentPriceText || ''),
                originalPrice: parseRupees(product.originalPriceText || '')
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

test('List Meesho products with discounts above the threshold', async ({ page }) => {
    const searchTerms = (process.env.MEESHO_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);

    if (searchTerms.length === 0) {
        throw new Error('Set MEESHO_PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const products = await findDiscountedProducts(page, searchTerms);
    writeProductsCsv(products);

    expect(fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n'))
        .toHaveLength(products.length + 2);
    console.log(`Saved ${products.length} matching Meesho products to ${OUTPUT_FILE}`);
});
