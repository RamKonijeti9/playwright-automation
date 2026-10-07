const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_MARKETPLACES = ['amazon', 'flipkart', 'compare'];
const DEFAULT_MARKETPLACE = 'compare';
const DEFAULT_SEARCH_TERMS = ['gold coin'];
const MIN_DISCOUNT_PERCENT = 20;
const MAX_PRODUCTS_PER_MARKETPLACE = 10;
const ACTION_DELAY_MS = 1000;
const OUTPUT_DIRECTORY = path.join(__dirname, '..', '.playwright-state');
const OUTPUT_FILE = path.join(OUTPUT_DIRECTORY, 'product-comparison.csv');

function parseRupees(text) {
    const match = String(text || '').match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
}

function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

function normalizeProductName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/&amp;/g, 'and')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

async function waitAfterAction(page) {
    await page.waitForTimeout(ACTION_DELAY_MS);
}

async function findAmazonDiscountedProducts(page, searchTerms) {
    const productsById = new Map();

    for (const searchTerm of searchTerms) {
        if (productsById.size >= MAX_PRODUCTS_PER_MARKETPLACE) {
            break;
        }

        await page.goto(`https://www.amazon.in/s?k=${encodeURIComponent(searchTerm)}`);
        await waitAfterAction(page);

        const cards = page.locator(
            '[data-component-type="s-search-result"][data-asin]'
        );
        await expect(cards.first()).toBeVisible({ timeout: 20000 });

        for (let index = 0; index < await cards.count(); index += 1) {
            if (productsById.size >= MAX_PRODUCTS_PER_MARKETPLACE) {
                break;
            }

            const product = await cards.nth(index).evaluate((element, term) => ({
                marketplace: 'Amazon',
                searchTerm: term,
                productId: element.getAttribute('data-asin') || '',
                name: element.querySelector('h2 span')?.textContent?.trim() || '',
                currentPriceText: element.querySelector(
                    '.a-price:not(.a-text-price) .a-offscreen'
                )?.textContent?.trim() || '',
                originalPriceText: element.querySelector(
                    '.a-price.a-text-price .a-offscreen'
                )?.textContent?.trim() || '',
                url: element.getAttribute('data-asin')
                    ? `https://www.amazon.in/dp/${element.getAttribute('data-asin')}`
                    : ''
            }), searchTerm);

            if (!product.productId || productsById.has(product.productId)) {
                continue;
            }

            const price = parseRupees(product.currentPriceText);
            const originalPrice = parseRupees(product.originalPriceText);
            if (!Number.isFinite(price) || !Number.isFinite(originalPrice)
                || originalPrice <= price) {
                continue;
            }
            const discountPercent = Number(
                (((originalPrice - price) / originalPrice) * 100).toFixed(2)
            );
            if (discountPercent <= MIN_DISCOUNT_PERCENT) {
                continue;
            }
            productsById.set(product.productId, {
                ...product,
                priceRupees: price,
                originalPriceRupees: originalPrice,
                discountPercent
            });
        }
    }

    return [...productsById.values()];
}

async function findFlipkartDiscountedProducts(page, searchTerms) {
    const productsById = new Map();

    for (const searchTerm of searchTerms) {
        if (productsById.size >= MAX_PRODUCTS_PER_MARKETPLACE) {
            break;
        }

        await page.goto(`https://www.flipkart.com/search?q=${encodeURIComponent(searchTerm)}`);
        await waitAfterAction(page);
        const links = await page.locator('a[href*="/p/"]').evaluateAll((anchors) => {
            const ids = new Set();
            return anchors.flatMap((anchor) => {
                const url = new URL(anchor.href);
                const productId = url.searchParams.get('pid') || url.pathname;
                if (!productId || ids.has(productId)) {
                    return [];
                }

                const priceValues = [anchor, ...anchor.querySelectorAll('*')]
                    .filter((element) => element.children.length === 0)
                    .map((element) => element.textContent.trim().match(
                        /^₹\s*([\d,]+(?:\.\d{1,2})?)$/
                    ))
                    .filter(Boolean)
                    .map((match) => Number(match[1].replace(/,/g, '')));
                if (priceValues.length < 2) {
                    return [];
                }

                const currentPrice = priceValues[0];
                const originalPrice = priceValues[1];
                if (!Number.isFinite(currentPrice)
                    || !Number.isFinite(originalPrice)
                    || originalPrice <= currentPrice) {
                    return [];
                }
                ids.add(productId);

                return [{
                    productId,
                    name: (anchor.innerText || '').replace(/\s+/g, ' ').trim(),
                    currentPrice,
                    originalPrice,
                    url: url.href
                }];
            });
        });
        console.log(`Flipkart found ${links.length} discounted candidates for "${searchTerm}".`);

        for (const product of links) {
            if (productsById.size >= MAX_PRODUCTS_PER_MARKETPLACE) {
                break;
            }
            if (productsById.has(product.productId)) {
                continue;
            }

            const discountPercent = Number(
                (((product.originalPrice - product.currentPrice)
                    / product.originalPrice) * 100).toFixed(2)
            );
            if (discountPercent <= MIN_DISCOUNT_PERCENT) {
                continue;
            }
            productsById.set(product.productId, {
                marketplace: 'Flipkart',
                searchTerm,
                ...product,
                priceRupees: product.currentPrice,
                originalPriceRupees: product.originalPrice,
                discountPercent
            });
        }
    }

    return [...productsById.values()];
}

async function readAmazonDetails(page, product) {
    await page.goto(product.url);
    await waitAfterAction(page);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });

    const details = await page.evaluate(() => {
        const lines = document.body.innerText.split('\n')
            .map((line) => line.trim()).filter(Boolean);
        const ratingText = document.querySelector('#acrPopover')?.getAttribute('title')
            || lines.find((line) => /\d(?:\.\d)? out of 5 stars/i.test(line)) || '';
        const rating = Number(ratingText.match(/([\d.]+)\s+out of 5 stars/i)?.[1]);
        const findFollowingLine = (label) => {
            const index = lines.findIndex((line) => line === label);
            return index >= 0 ? lines[index + 1] || '' : '';
        };
        const currentPriceText = document.querySelector(
            '#tp_price_block_total_price_ww .a-offscreen'
        )?.textContent?.trim()
            || document.querySelector(
                '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen'
            )?.textContent?.trim() || '';
        const originalPriceText = document.querySelector(
            '#apex_desktop .apex-basisprice-value .a-offscreen'
        )?.textContent?.trim()
            || document.querySelector(
                '#corePriceDisplay_desktop_feature_div .a-price.a-text-price .a-offscreen'
            )?.textContent?.trim() || '';

        return {
            title: document.querySelector('#productTitle')?.innerText.trim()
                || document.querySelector('h1')?.innerText.trim() || '',
            rating: Number.isFinite(rating) ? rating : null,
            ratingCount: document.querySelector('#acrCustomerReviewText')
                ?.innerText.trim() || '',
            purchases: lines.find((line) => /bought in past month/i.test(line)) || '',
            seller: document.querySelector('#sellerProfileTriggerId')?.innerText.trim()
                || findFollowingLine('Sold by'),
            shipsFrom: findFollowingLine('Ships from'),
            offers: [...document.querySelectorAll(
                '#promoPriceBlockMessage_feature_div, #promotions_feature_div'
            )].map((node) => node.innerText.trim().replace(/\s+/g, ' '))
                .filter(Boolean).join(' | '),
            about: [...document.querySelectorAll('#feature-bullets li')]
                .map((node) => node.innerText.trim().replace(/\s+/g, ' '))
                .filter((text) => text && !/see more/i.test(text)).join(' | '),
            specifications: [
                '#productOverview_feature_div',
                '#detailBullets_feature_div li',
                '#productDetails_detailBullets_sections1 tr',
                '#productDetails_techSpec_section_1 tr'
            ].flatMap((selector) => [...document.querySelectorAll(selector)])
                .map((node) => node.innerText.trim().replace(/\s+/g, ' '))
                .filter(Boolean).join(' | '),
            currentPriceText,
            originalPriceText
        };
    });

    const variantPricing = [];
    const dimensions = await page.locator('[id^="inline-twister-row-"]')
        .evaluateAll((rows) => rows.map((row) =>
            row.id.replace('inline-twister-row-', '')
        ));
    for (const dimension of dimensions) {
        const options = await page.locator(
            `#inline-twister-row-${dimension} .a-button-toggle:visible`
        ).evaluateAll((buttons) => {
            const uniqueOptions = new Map();
            for (const button of buttons) {
                const input = button.querySelector('input[role="radio"]');
                const img = button.querySelector('img');
                const announce = input?.getAttribute('aria-labelledby');
                const label = announce
                    ? document.getElementById(announce)?.innerText || ''
                    : '';
                const value = img?.alt || label.split('\n')
                    .map((part) => part.trim())
                    .find((part) => part && !/₹|percent savings|M\.R\.P/i.test(part))
                    || '';
                if (button.id && value && !uniqueOptions.has(button.id)) {
                    uniqueOptions.set(button.id, { id: button.id, value });
                }
            }
            return [...uniqueOptions.values()];
        });

        for (const option of options) {
            await page.locator(
                `#inline-twister-row-${dimension} [id="${option.id}"].a-button-toggle:visible`
            ).first().click();
            await waitAfterAction(page);
            const variant = await page.evaluate(({ variantDimension, variantValue }) => {
                const text = (selector) => document.querySelector(selector)
                    ?.textContent?.trim() || '';
                const currentPriceText = text(
                    '#tp_price_block_total_price_ww .a-offscreen'
                ) || text(
                    '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen'
                );
                const originalPriceText = text(
                    '#apex_desktop .apex-basisprice-value .a-offscreen'
                ) || text(
                    '#corePriceDisplay_desktop_feature_div .a-price.a-text-price .a-offscreen'
                );
                return {
                    dimension: variantDimension,
                    value: variantValue,
                    selectedColor: text('#inline-twister-expanded-dimension-text-color_name'),
                    selectedModel: text(`#inline-twister-expanded-dimension-text-${variantDimension}`),
                    currentPriceText,
                    originalPriceText,
                    availability: document.querySelector('#availability')?.innerText.trim() || ''
                };
            }, { variantDimension: dimension, variantValue: option.value });
            variantPricing.push(variant);
        }
    }

    return { ...details, variantPricing };
}

async function readFlipkartDetails(page, product) {
    await page.goto(product.url);
    await waitAfterAction(page);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });

    return page.evaluate(() => {
        const lines = document.body.innerText.split('\n')
            .map((line) => line.trim()).filter(Boolean);
        const jsonProducts = [...document.querySelectorAll(
            'script[type="application/ld+json"]'
        )].flatMap((script) => {
            try {
                const value = JSON.parse(script.textContent || 'null');
                const items = Array.isArray(value) ? value : [value];
                return items.flatMap((item) => Array.isArray(item?.['@graph'])
                    ? [item, ...item['@graph']]
                    : [item]);
            } catch (error) {
                return [];
            }
        });
        const details = jsonProducts.find((item) => {
            const types = Array.isArray(item?.['@type']) ? item['@type'] : [item?.['@type']];
            return types.includes('Product');
        }) || {};
        const sellerIndex = lines.findIndex((line) =>
            /^(Seller:|Fulfilled by )/i.test(line)
        );
        const sellerName = sellerIndex >= 0
            ? lines[sellerIndex].replace(/^(Seller:|Fulfilled by )\s*/i, '')
            : '';
        const sellerContext = sellerIndex >= 0
            ? lines.slice(sellerIndex + 1, sellerIndex + 8)
            : [];
        const offer = Array.isArray(details.offers) ? details.offers[0] : details.offers || {};
        const brand = typeof details.brand === 'string'
            ? details.brand
            : details.brand?.name || '';
        const highlightsIndex = lines.findIndex((line) =>
            /^(Product highlights|Highlights)$/i.test(line)
        );
        const allDetailsIndex = lines.findIndex((line, index) =>
            index > highlightsIndex && /^All details$/i.test(line)
        );

        return {
            title: details.name || document.querySelector('h1')?.innerText.trim() || '',
            brand,
            model: details.model || '',
            color: details.color || '',
            rating: details.aggregateRating?.ratingValue ?? null,
            ratingCount: details.aggregateRating?.ratingCount ?? '',
            purchases: '',
            seller: sellerName,
            sellerRating: sellerContext.find((line) => /^\d(?:\.\d)?$/.test(line)) || '',
            offers: [...new Set(lines.filter((line) =>
                /bank offers?|cashback|no cost emi|buy at/i.test(line)
            ))].join(' | '),
            about: highlightsIndex >= 0
                ? lines.slice(
                    highlightsIndex + 1,
                    allDetailsIndex > highlightsIndex ? allDetailsIndex : undefined
                ).join(' | ')
                : '',
            specifications: [...document.querySelectorAll('table tr, [class*="specification"] tr')]
                .map((row) => row.innerText.trim().replace(/\s+/g, ' '))
                .filter(Boolean).join(' | '),
            currentPriceText: String(offer.price ?? ''),
            originalPriceText: ''
        };
    });
}

async function enrichProducts(page, products) {
    const enriched = [];
    for (const [index, product] of products.entries()) {
        console.log(
            `Opening ${product.marketplace} product ${index + 1}/${products.length}: ${product.name}`
        );
        const details = product.marketplace === 'Amazon'
            ? await readAmazonDetails(page, product)
            : await readFlipkartDetails(page, product);
        const price = parseRupees(details.currentPriceText);
        const originalPrice = parseRupees(details.originalPriceText);
        const verifiedPrice = Number.isFinite(price) ? price : product.priceRupees;
        const verifiedOriginalPrice = Number.isFinite(originalPrice)
            ? originalPrice
            : product.originalPriceRupees;
        const verifiedDiscount = verifiedOriginalPrice > verifiedPrice
            ? Number((((verifiedOriginalPrice - verifiedPrice) / verifiedOriginalPrice)
                * 100).toFixed(2))
            : product.discountPercent;

        enriched.push({
            ...product,
            ...details,
            priceRupees: verifiedPrice,
            originalPriceRupees: verifiedOriginalPrice,
            discountPercent: verifiedDiscount,
            comparisonKey: normalizeProductName(details.title || product.name)
        });
    }
    return enriched;
}

function pairExactTitleMatches(products) {
    const amazonByKey = new Map();
    const flipkartByKey = new Map();
    for (const product of products) {
        const map = product.marketplace === 'Amazon' ? amazonByKey : flipkartByKey;
        const items = map.get(product.comparisonKey) || [];
        items.push(product);
        map.set(product.comparisonKey, items);
    }

    return products.map((product) => {
        const otherRetailer = product.marketplace === 'Amazon' ? 'Flipkart' : 'Amazon';
        const otherMap = otherRetailer === 'Amazon' ? amazonByKey : flipkartByKey;
        const counterpart = otherMap.get(product.comparisonKey)?.[0];
        if (!counterpart) {
            return {
                ...product,
                comparisonStatus: 'No exact title match on the other retailer',
                comparedPrice: '',
                priceDifference: '',
                cheaperRetailer: ''
            };
        }

        const priceDifference = Number(
            (product.priceRupees - counterpart.priceRupees).toFixed(2)
        );
        return {
            ...product,
            comparisonStatus: 'Exact normalized title match',
            comparedMarketplace: counterpart.marketplace,
            comparedProduct: counterpart.title || counterpart.name,
            comparedPrice: counterpart.priceRupees,
            priceDifference,
            cheaperRetailer: priceDifference === 0
                ? 'Same price'
                : priceDifference < 0 ? product.marketplace : counterpart.marketplace
        };
    });
}

function writeCsv(products) {
    const columns = [
        'marketplace', 'search_term', 'product_title', 'selling_price_inr',
        'original_price_inr', 'discount_percent', 'rating', 'rating_count',
        'purchases', 'brand', 'model', 'color', 'seller', 'seller_rating',
        'offers', 'about_this_item', 'specifications', 'variant_pricing',
        'comparison_status', 'compared_marketplace', 'compared_product',
        'compared_price_inr', 'price_difference_inr', 'cheaper_retailer', 'product_url'
    ];
    const rows = products.map((product) => [
        product.marketplace, product.searchTerm, product.title || product.name,
        product.priceRupees, product.originalPriceRupees, product.discountPercent,
        product.rating, product.ratingCount, product.purchases, product.brand,
        product.model, product.color, product.seller, product.sellerRating,
        product.offers, product.about, product.specifications,
        JSON.stringify(product.variantPricing || []), product.comparisonStatus,
        product.comparedMarketplace, product.comparedProduct, product.comparedPrice,
        product.priceDifference, product.cheaperRetailer, product.url
    ]);
    const csv = [
        columns.map(csvCell).join(','),
        ...rows.map((row) => row.map(csvCell).join(','))
    ].join('\n') + '\n';

    fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, csv, 'utf8');
}

test('Compare discounted products across Amazon and Flipkart', async ({ page }) => {
    test.setTimeout(300000);
    const marketplace = (process.env.PRODUCT_MARKETPLACE || DEFAULT_MARKETPLACE)
        .trim().toLowerCase();
    if (!SUPPORTED_MARKETPLACES.includes(marketplace)) {
        throw new Error(
            `PRODUCT_MARKETPLACE must be one of: ${SUPPORTED_MARKETPLACES.join(', ')}.`
        );
    }

    const searchTerms = (process.env.PRODUCT_SEARCH_TERMS
        || DEFAULT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
    if (searchTerms.length === 0) {
        throw new Error('Set PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const products = [];
    if (marketplace === 'amazon' || marketplace === 'compare') {
        products.push(...await findAmazonDiscountedProducts(page, searchTerms));
    }
    if (marketplace === 'flipkart' || marketplace === 'compare') {
        products.push(...await findFlipkartDiscountedProducts(page, searchTerms));
    }

    const enrichedProducts = await enrichProducts(page, products);
    const comparisonProducts = marketplace === 'compare'
        ? pairExactTitleMatches(enrichedProducts)
        : enrichedProducts.map((product) => ({
            ...product,
            comparisonStatus: 'Comparison mode not selected'
        }));
    writeCsv(comparisonProducts);

    expect(fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n'))
        .toHaveLength(comparisonProducts.length + 2);
    console.log(JSON.stringify(comparisonProducts, null, 2));
    console.log(
        `Saved ${comparisonProducts.length} products for ${marketplace} `
        + `to ${OUTPUT_FILE}. Exact title matching only is used when comparing retailers.`
    );
});
