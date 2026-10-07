const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PRODUCTS_PER_CATEGORY = 50;
const ACTION_DELAY_MS = 1000;
const OUTPUT_DIRECTORY = path.join(__dirname, '..', '.playwright-state');
const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'flipkart-category-products.csv');
const DEFAULT_PRODUCT_SEARCH_TERMS = [
    'fashion',
    'mobile phones',
    'Gold Coins',
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

async function waitAfterAction(page) {
    await page.waitForTimeout(ACTION_DELAY_MS);
}

async function readProductItems(page) {
    return page.locator('a[href*="/p/"]').evaluateAll((anchors) => {
        const products = new Map();

        for (const anchor of anchors) {
            const url = new URL(anchor.href);
            const productId = url.searchParams.get('pid');
            if (!productId) {
                continue;
            }

            let product = products.get(productId);
            if (!product) {
                product = {
                    productId,
                    name: '',
                    prices: [],
                    url: url.toString()
                };
                products.set(productId, product);
            }

            const text = (anchor.innerText || '').replace(/\s+/g, ' ').trim();
            if (!product.name && text) {
                const candidateName = text
                    .replace(/₹\s*[\d,]+(?:\.\d{1,2})?/g, '')
                    .replace(/\b\d+(?:\.\d+)?%\s*off\b/ig, '')
                    .replace(/^Add to Compare\s*/i, '')
                    .trim();
                if (candidateName) {
                    product.name = candidateName;
                }
            }

            const priceValues = [...anchor.querySelectorAll('*'), anchor]
                .filter((element) => element.children.length === 0)
                .map((element) => element.textContent.trim().match(
                    /^₹\s*([\d,]+(?:\.\d{1,2})?)$/
                ))
                .filter(Boolean)
                .map((match) => Number(match[1].replace(/,/g, '')));

            for (const price of priceValues) {
                if (!product.prices.includes(price)) {
                    product.prices.push(price);
                }
            }
        }

        return [...products.values()].flatMap((product) => {
            const [currentPrice, listedOriginalPrice] = product.prices;
            if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
                return [];
            }

            const originalPrice = Number.isFinite(listedOriginalPrice)
                && listedOriginalPrice > currentPrice
                ? listedOriginalPrice
                : '';
            const discountPercent = originalPrice
                ? Number((((originalPrice - currentPrice) / originalPrice) * 100).toFixed(2))
                : '';

            return [{
                productId: product.productId,
                name: product.name
                    || decodeURIComponent(
                        new URL(product.url).pathname.split('/').filter(Boolean)[0]
                        || product.productId
                    ).replace(/-/g, ' '),
                priceRupees: currentPrice,
                originalPriceRupees: originalPrice,
                discountPercent,
                url: product.url
            }];
        });
    });
}

async function findTopProductsByCategory(page, searchTerms) {
    const productsByCategory = [];

    for (const searchTerm of searchTerms) {
        const productsById = new Map();
        for (let pageNumber = 1;
            pageNumber <= 2 && productsById.size < MAX_PRODUCTS_PER_CATEGORY;
            pageNumber += 1) {
            const searchUrl = new URL('https://www.flipkart.com/search');
            searchUrl.searchParams.set('q', searchTerm);
            searchUrl.searchParams.set('page', String(pageNumber));
            await page.goto(searchUrl.toString());
            await waitAfterAction(page);

            const items = await readProductItems(page);
            for (const product of items) {
                if (!productsById.has(product.productId)) {
                    productsById.set(product.productId, {
                        category: searchTerm,
                        ...product
                    });
                }
                if (productsById.size >= MAX_PRODUCTS_PER_CATEGORY) {
                    break;
                }
            }

            if (items.length === 0) {
                break;
            }
        }

        const products = [...productsById.values()].slice(0, MAX_PRODUCTS_PER_CATEGORY);
        productsByCategory.push({ category: searchTerm, products });
        console.log(
            `Found ${products.length} of up to ${MAX_PRODUCTS_PER_CATEGORY} product items `
            + `for category "${searchTerm}".`
        );
        console.log(JSON.stringify(products, null, 2));
    }

    return productsByCategory;
}

function writeProductsCsv(products) {
    const columns = [
        'category',
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
        product.category,
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

test('List the top 50 Flipkart product items for each category', async ({ page }) => {
    test.setTimeout(600000);

    const searchTerms = (process.env.FLIPKART_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);

    if (searchTerms.length === 0) {
        throw new Error('Set FLIPKART_PRODUCT_SEARCH_TERMS to one or more categories.');
    }

    const categories = await findTopProductsByCategory(page, searchTerms);
    expect(categories).toHaveLength(searchTerms.length);
    for (const category of categories) {
        expect(category.products.length, `Products found for ${category.category}`)
            .toBeGreaterThan(0);
        expect(category.products.length, `Product limit for ${category.category}`)
            .toBeLessThanOrEqual(MAX_PRODUCTS_PER_CATEGORY);
    }
    const products = categories.flatMap(({ products: categoryProducts }) => categoryProducts);
    writeProductsCsv(products);
    expect(fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n'))
        .toHaveLength(products.length + 2);
    console.log(
        `Saved ${products.length} product items across ${categories.length} categories `
        + `to ${OUTPUT_FILE}.`
    );
});
