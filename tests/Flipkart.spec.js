const { test, expect } = require('@playwright/test');

const MIN_DISCOUNT_PERCENT = 90;
const MAX_PRODUCTS_TO_SCAN = 10;
const DEFAULT_PRODUCT_SEARCH_TERMS = [
    'mobile phone',
    'running shoes',
    'mens shirt',
    'headphones',
    'smart watch',
    'kitchen mixer',
    'toys',
    'novel book',
    'bedsheet',
    'backpack'
];

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

test('List high-discount products from ten different Flipkart categories', async ({ page }) => {
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
        `Products with discounts greater than ${MIN_DISCOUNT_PERCENT}% from up to ${MAX_PRODUCTS_TO_SCAN} different categories:`
    );
    console.log(JSON.stringify(products, null, 2));
});
