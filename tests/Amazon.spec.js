const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const MIN_DISCOUNT_PERCENT = 40;
const MAX_PRODUCTS_TO_SCAN = 30;
const MIN_PRODUCT_RATING = 3.5;
const ACTION_DELAY_MS = 1000;
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

async function waitAfterAction(page) {
    await page.waitForTimeout(ACTION_DELAY_MS);
}

async function readCurrentVariant(page, dimension, value) {
    return page.evaluate(({ variantDimension, variantValue }) => {
        const textOf = (selector) => document.querySelector(selector)
            ?.textContent?.trim().replace(/\s+/g, ' ') || '';
        const currentPriceText = textOf(
            '#tp_price_block_total_price_ww .a-offscreen'
        ) || textOf(
            '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen'
        ) || textOf('#apex_desktop .priceToPay .a-offscreen')
            || textOf('#apex_desktop .a-price:not(.a-text-price) .a-offscreen');
        const originalPriceText = textOf(
            '#apex_desktop .apex-basisprice-value .a-offscreen'
        ) || textOf(
            '#corePriceDisplay_desktop_feature_div .a-price.a-text-price .a-offscreen'
        ) || textOf('#apex_desktop .a-price.a-text-price .a-offscreen');
        const title = document.querySelector('h1')?.innerText.trim() || '';
        const selectedColor = document.querySelector(
            '#inline-twister-expanded-dimension-text-color_name'
        )?.textContent?.trim() || '';
        const selectedModel = document.querySelector(
            `#inline-twister-expanded-dimension-text-${variantDimension}`
        )?.textContent?.trim() || '';

        return {
            dimension: variantDimension,
            variant: variantValue,
            selectedColor,
            selectedModel,
            currentPriceText,
            originalPriceText,
            availability: document.querySelector('#availability')?.innerText
                .trim().replace(/\s+/g, ' ') || ''
        };
    }, { variantDimension: dimension, variantValue: value });
}

async function clickAndWait(page, locator) {
    await locator.click();
    await waitAfterAction(page);
}

async function readVariantOptions(page, dimension) {
    return page.locator(`#inline-twister-row-${dimension} .a-button-toggle:visible`)
        .evaluateAll((buttons) => {
            const seen = new Set();
            return buttons.flatMap((button) => {
                if (!button.id || seen.has(button.id)) {
                    return [];
                }
                seen.add(button.id);

                const input = button.querySelector('input[role="radio"]');
                const image = button.querySelector('img');
                const announcement = input?.getAttribute('aria-labelledby');
                const announcedText = announcement
                    ? document.getElementById(announcement)?.innerText || ''
                    : '';
                const value = image?.alt
                    || announcedText.split('\n').map((line) => line.trim())
                        .find((line) => line && !/₹|percent savings|M\.R\.P/i.test(line))
                    || button.innerText.trim().split('\n')
                        .find((line) => line && !/₹|percent savings|M\.R\.P/i.test(line))
                    || '';

                return value ? [{
                    id: button.id,
                    value,
                    disabled: input?.disabled || false
                }] : [];
            });
        });
}

async function readVariantPricing(page) {
    const dimensionRows = await page.locator('[id^="inline-twister-row-"]')
        .evaluateAll((rows) => rows.map((row) => row.id.replace('inline-twister-row-', '')));
    const variants = [];

    for (const dimension of dimensionRows) {
        const options = await readVariantOptions(page, dimension);

        for (const option of options) {
            if (option.disabled) {
                continue;
            }
            const optionLocator = page.locator(
                `#inline-twister-row-${dimension} [id="${option.id}"].a-button-toggle:visible`
            ).first();
            await clickAndWait(page, optionLocator);
            await page.locator('h1').first().waitFor({ state: 'visible' });
            const variant = await readCurrentVariant(page, dimension, option.value);
            const currentPrice = parseRupees(variant.currentPriceText);
            const originalPrice = parseRupees(variant.originalPriceText);
            const discountPercent = Number.isFinite(currentPrice)
                && Number.isFinite(originalPrice)
                && originalPrice > currentPrice
                ? Number((((originalPrice - currentPrice) / originalPrice) * 100).toFixed(2))
                : null;
            variants.push({
                ...variant,
                currentPriceRupees: currentPrice,
                originalPriceRupees: originalPrice,
                discountPercent
            });
        }
    }

    return variants;
}

async function readAmazonProductDetails(page, product) {
    await page.goto(product.url);
    await waitAfterAction(page);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });

    const baseDetails = await page.evaluate(() => {
        const lines = document.body.innerText.split('\n')
            .map((line) => line.trim()).filter(Boolean);
        const productTitle = document.querySelector('#productTitle')?.innerText.trim()
            || document.querySelector('h1')?.innerText.trim() || '';
        const ratingText = document.querySelector('#acrPopover')?.getAttribute('title')
            || lines.find((line) => /\d(?:\.\d)? out of 5 stars/i.test(line)) || '';
        const rating = Number(ratingText.match(/([\d.]+)\s+out of 5 stars/i)?.[1]);
        const ratingCountText = document.querySelector('#acrCustomerReviewText')
            ?.innerText.trim() || '';
        const boughtText = [
            document.querySelector('#social-proofing-faceout-title-tk_bought')?.innerText.trim(),
            document.querySelector('#pqv-bought-in-last-month')?.innerText.trim(),
            ...lines
        ].find((text) => /bought in past month/i.test(text || '')) || '';
        const aboutItems = [...document.querySelectorAll('#feature-bullets li')]
            .map((item) => item.innerText.trim().replace(/\s+/g, ' '))
            .filter((text) => text && !/see more/i.test(text));
        const sellingPriceText = document.querySelector(
            '#tp_price_block_total_price_ww .a-offscreen'
        )?.textContent?.trim()
            || document.querySelector(
                '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen'
            )?.textContent?.trim()
            || '';
        const originalPriceText = document.querySelector(
            '#apex_desktop .apex-basisprice-value .a-offscreen'
        )?.textContent?.trim()
            || document.querySelector(
                '#corePriceDisplay_desktop_feature_div .a-price.a-text-price .a-offscreen'
            )?.textContent?.trim()
            || '';
        const sellerLineIndex = lines.findIndex((line) => line === 'Sold by');
        const shipperLineIndex = lines.findIndex((line) => line === 'Ships from');
        const sellerName = document.querySelector('#sellerProfileTriggerId')
            ?.innerText.trim()
            || (sellerLineIndex >= 0 ? lines[sellerLineIndex + 1] || '' : '');
        const shipper = shipperLineIndex >= 0 ? lines[shipperLineIndex + 1] || '' : '';
        const offers = [...document.querySelectorAll(
            '#promoPriceBlockMessage_feature_div, #promotions_feature_div, #dealprice_savings'
        )].map((item) => item.innerText.trim().replace(/\s+/g, ' '))
            .filter(Boolean);
        const offersIndex = lines.findIndex((line) => line === 'Offers');
        const offerTextEnd = lines.findIndex((line, index) =>
            index > offersIndex && /^(Partner Offers|Next page|Top Brand)$/.test(line)
        );
        const offerLines = offersIndex >= 0
            ? lines.slice(offersIndex + 1, offerTextEnd >= 0 ? offerTextEnd : offersIndex + 25)
                .filter((line) => /cashback|emi|offer|save|₹\s*[\d,]+/i.test(line))
            : [];
        const featureValues = [
            '#productOverview_feature_div',
            '#productOverview_feature_div tr',
            '#productOverview_feature_div li',
            '#detailBullets_feature_div li',
            '#productDetails_detailBullets_sections1 tr',
            '#productDetails_techSpec_section_1 tr',
            '#productDetails_techSpec_section_2 tr',
            '#technicalSpecifications_section_1 tr'
        ].flatMap((selector) => [...document.querySelectorAll(selector)])
            .map((item) => item.innerText.trim().replace(/\s+/g, ' '))
            .filter(Boolean);

        return {
            title: productTitle,
            sellingPriceText,
            originalPriceText,
            rating: Number.isFinite(rating) ? rating : null,
            ratingText,
            ratingCount: ratingCountText,
            purchases: boughtText,
            sellerName,
            shipper,
            aboutThisItem: aboutItems.join(' | '),
            offers: [...new Set([...offers, ...offerLines])].join(' | '),
            productDetails: [...new Set(featureValues)].join(' | ')
        };
    });

    if (!Number.isFinite(baseDetails.rating) || baseDetails.rating <= MIN_PRODUCT_RATING) {
        return null;
    }

    const seeMoreDetails = page.locator('#seeMoreDetailsLink');
    if (await seeMoreDetails.isVisible()) {
        await clickAndWait(page, seeMoreDetails);
    }

    const productDetails = await page.evaluate(() => {
        const sections = ['#productOverview_feature_div', '#productDetails_feature_div',
            '#productDetails_db_sections',
            '#technicalSpecifications_section_1', '#detailBullets_feature_div'];
        return [...new Set(sections.flatMap((selector) =>
            [...document.querySelectorAll(selector)]
                .map((section) => section.innerText.trim().replace(/\s+/g, ' '))
                .filter(Boolean)
        ))].join(' | ');
    });
    const variantPricing = await readVariantPricing(page);

    return {
        ...baseDetails,
        productDetails: productDetails || baseDetails.productDetails,
        variantPricing
    };
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
        await waitAfterAction(page);

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
        'rating',
        'rating_count',
        'purchases_past_month',
        'seller',
        'ships_from',
        'offers',
        'about_this_item',
        'product_details',
        'color_and_model_variants',
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
        product.rating,
        product.ratingCount,
        product.purchases,
        product.sellerName,
        product.shipper,
        product.offers,
        product.aboutThisItem,
        product.productDetails,
        JSON.stringify(product.variantPricing || []),
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
    test.setTimeout(300000);

    const searchTerms = (process.env.AMAZON_PRODUCT_SEARCH_TERMS
        || DEFAULT_PRODUCT_SEARCH_TERMS.join(','))
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);

    if (searchTerms.length === 0) {
        throw new Error('Set AMAZON_PRODUCT_SEARCH_TERMS to one or more search terms.');
    }

    const discountedProducts = await findDiscountedProducts(page, searchTerms);
    const ratedProducts = [];
    let skippedRatingCount = 0;
    let skippedPriceCount = 0;
    for (const [index, product] of discountedProducts.entries()) {
        console.log(`Opening filtered Amazon item ${index + 1}/${discountedProducts.length}: ${product.name}`);
        const details = await readAmazonProductDetails(page, product);
        if (!details) {
            skippedRatingCount += 1;
            continue;
        }

        const priceRupees = parseRupees(details.sellingPriceText);
        const originalPriceRupees = parseRupees(details.originalPriceText);
        if (!Number.isFinite(priceRupees)
            || !Number.isFinite(originalPriceRupees)
            || originalPriceRupees <= priceRupees) {
            skippedPriceCount += 1;
            continue;
        }
        const discountPercent = Number(
            (((originalPriceRupees - priceRupees) / originalPriceRupees) * 100).toFixed(2)
        );
        if (discountPercent <= MIN_DISCOUNT_PERCENT) {
            continue;
        }

        ratedProducts.push({
            ...product,
            ...details,
            priceRupees,
            originalPriceRupees,
            discountPercent
        });
    }

    writeProductsCsv(ratedProducts);

    expect(fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n'))
        .toHaveLength(ratedProducts.length + 2);
    console.log(JSON.stringify(ratedProducts, null, 2));
    console.log(
        `Saved ${ratedProducts.length} products rated above ${MIN_PRODUCT_RATING} `
        + `to ${OUTPUT_FILE}`
    );
    if (skippedRatingCount || skippedPriceCount) {
        console.warn(
            `Skipped ${skippedRatingCount} products without ratings above ${MIN_PRODUCT_RATING} `
            + `and ${skippedPriceCount} products without valid detail-page pricing.`
        );
    }
});
