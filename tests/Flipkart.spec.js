const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MIN_DISCOUNT_PERCENT = 70;
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

                if (!productId || ids.has(productId) || priceValues.length < 2) {
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
                    discountPercent: Number(
                        (((originalPrice - currentPrice) / originalPrice) * 100).toFixed(2)
                    ),
                    url: url.toString()
                }];
            });
        });

        for (const product of productCards) {
            if (scannedProductIds.has(product.productId)) {
                continue;
            }
            scannedProductIds.add(product.productId);

            if (product.discountPercent > MIN_DISCOUNT_PERCENT) {
                matchingProducts.push({
                    searchTerm,
                    productId: product.productId,
                    name: product.name,
                    priceRupees: product.currentPrice,
                    originalPriceRupees: product.originalPrice,
                    discountPercent: product.discountPercent,
                    url: product.url
                });
            }
        }
    }

    return matchingProducts;
}

async function readProductDetails(page, product) {
    await page.goto(product.url);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });

    return page.evaluate(() => {
        const lines = document.body.innerText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        const structuredProducts = [...document.querySelectorAll(
            'script[type="application/ld+json"]'
        )].flatMap((script) => {
            try {
                const data = JSON.parse(script.textContent || 'null');
                const values = Array.isArray(data) ? data : [data];
                return values.flatMap((value) => {
                    const graph = value?.['@graph'];
                    return Array.isArray(graph) ? [value, ...graph] : [value];
                });
            } catch (error) {
                return [];
            }
        });
        const structuredProduct = structuredProducts.find((value) => {
            const types = Array.isArray(value?.['@type'])
                ? value['@type']
                : [value?.['@type']];
            return types.includes('Product');
        }) || {};
        const structuredOffers = Array.isArray(structuredProduct.offers)
            ? structuredProduct.offers[0]
            : structuredProduct.offers || {};
        const nextLineFor = (labels) => {
            const labelIndex = lines.findIndex((line) => labels.includes(line));
            return labelIndex >= 0 ? lines[labelIndex + 1] || '' : '';
        };
        const h1 = document.querySelector('h1')?.innerText.trim() || '';
        const titleIndex = lines.findIndex((line) => line === h1);
        const productSectionLines = titleIndex >= 0
            ? lines.slice(titleIndex, lines.findIndex(
                (line, index) => index > titleIndex
                    && /Features, description and more/i.test(line)
            ) > titleIndex
                ? lines.findIndex((line, index) => index > titleIndex
                    && /Features, description and more/i.test(line))
                : undefined)
            : lines;
        const sellerIndex = productSectionLines.findIndex((line) => /^Seller:/i.test(line));
        const sellerName = sellerIndex >= 0
            ? productSectionLines[sellerIndex].replace(/^Seller:\s*/i, '')
            : '';
        const sellerContext = sellerIndex >= 0
            ? productSectionLines.slice(sellerIndex + 1, sellerIndex + 8)
            : [];
        const sellerRating = sellerContext.find((line) => /^\d(?:\.\d)?$/.test(line)) || '';
        const sellerTenure = sellerContext.find((line) => /\byears? with Flipkart\b/i.test(line)) || '';
        const offerLines = [...new Set(productSectionLines.filter((line) =>
            /bank offers?|cashback|no cost emi|emi\b|buy at|₹\s*[\d,]+\s+off|exchange offer/i
                .test(line)
        ))];
        const rating = structuredProduct.aggregateRating || {};
        const brand = typeof structuredProduct.brand === 'string'
            ? structuredProduct.brand
            : structuredProduct.brand?.name || '';
        return {
            title: structuredProduct.name || h1,
            brand,
            model: structuredProduct.model || nextLineFor(['Model Name', 'Model']),
            color: structuredProduct.color || nextLineFor([
                'Selected Color:',
                'Selected Colour:',
                'Color',
                'Colour'
            ]),
            category: structuredProduct.category || '',
            rating: rating.ratingValue ?? '',
            ratingCount: rating.ratingCount ?? '',
            reviewCount: rating.reviewCount ?? '',
            sellerName,
            sellerRating,
            sellerTenure,
            sellerInfo: sellerContext.join(' | '),
            offers: offerLines.join(' | '),
            availability: String(structuredOffers.availability || '')
                .split('/').pop(),
            returnPolicy: structuredOffers.hasMerchantReturnPolicy?.description || ''
        };
    });
}

function writeProductsCsv(products) {
    const columns = [
        'search_term',
        'product_name',
        'selling_price_inr',
        'original_price_inr',
        'discount_percent',
        'brand',
        'model',
        'color',
        'category',
        'rating',
        'rating_count',
        'review_count',
        'seller_name',
        'seller_rating',
        'seller_tenure',
        'seller_info',
        'offers',
        'availability',
        'return_policy',
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
        product.brand,
        product.model,
        product.color,
        product.category,
        product.rating,
        product.ratingCount,
        product.reviewCount,
        product.sellerName,
        product.sellerRating,
        product.sellerTenure,
        product.sellerInfo,
        product.offers,
        product.availability,
        product.returnPolicy,
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
    test.setTimeout(300000);

    const searchTerms = (process.env.FLIPKART_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);

    if (searchTerms.length === 0) {
        throw new Error('Set FLIPKART_PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const products = await findProductsWithDiscount(page, searchTerms);
    const detailedProducts = [];
    for (const [index, product] of products.entries()) {
        console.log(
            `Opening filtered product ${index + 1}/${products.length}: ${product.name}`
        );
        const details = await readProductDetails(page, product);
        detailedProducts.push({ ...product, ...details });
    }

    writeProductsCsv(detailedProducts);
    expect(fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n')).toHaveLength(products.length + 2);
    console.log(JSON.stringify(detailedProducts, null, 2));
    console.log(`Saved ${detailedProducts.length} detailed products to ${OUTPUT_FILE}`);
});
