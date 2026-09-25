# Little Shop

A small, locally hosted storefront intended for Playwright end-to-end practice.
It is independently authored and uses Node.js built-ins only: the HTTP server
uses `node:http`, and the local database uses `node:sqlite`. No real payment is
processed.

## Requirements

- Node.js 22.5 or newer (Node 24 LTS is recommended for `node:sqlite`).
- The root project's installed Playwright dependency and Chromium browser.

## Start the website

From the repository root:

```bash
npm run shop:start
```

Open `http://127.0.0.1:4173`. The SQLite file is created at
`local-shop/data/shop.sqlite` and is ignored by Git.

## Run only the shop tests

In another terminal, from the repository root:

```bash
npm run test:shop
```

The dedicated Playwright configuration starts the server automatically,
waits for its health endpoint, and stops it when the run finishes. It targets
only `tests/EndToEndGitHubProject.spec.js`; the existing stage-site tests and
their configuration are not changed by this setup.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Local server readiness check |
| `GET` | `/api/products` | Return products; supports `search`, `category`, and `sort` query parameters |
| `GET` | `/api/categories` | Return category names for the catalog filter |
| `GET` | `/api/coupons/:code` | Validate `SAVE10` or `FREESHIP` |
| `POST` | `/api/orders` | Validate checkout data and create an order |
| `GET` | `/api/orders/:id` | Return a saved order with its line items |

Product sorting accepts `name`, `price-asc`, or `price-desc`. Coupon codes are
case-insensitive. `SAVE10` discounts product subtotal by 10%; `FREESHIP`
removes the standard $5.99 shipping charge. Shipping is free when the
post-discount product subtotal is at least $50. Tax is 8.25% of the
post-discount subtotal plus shipping, rounded to the nearest cent. Percentage
discounts are rounded down to the nearest cent.

Example order body:

```json
{
  "customerName": "Playwright Shopper",
  "customerEmail": "shopper@example.test",
  "couponCode": "SAVE10",
  "items": [
    { "productId": "backpack", "quantity": 2 },
    { "productId": "mug", "quantity": 1 }
  ]
}
```

The backend calculates all order prices from the database; it never trusts a
client-submitted price. Prices, inventory, discounts, shipping, and tax are
stored/calculated in integer cents. Stock is checked and decremented in the
same SQLite transaction that creates the order, so a failed checkout cannot
partially save line items or consume stock.

## Practice ideas

The Playwright scenarios cover catalog/category search and sorting, stock
visibility and rejection, cart quantities, coupon success and failure,
free-shipping threshold and coupon behavior, subtotal/discount/shipping/tax/
total calculations, account form checkout, persisted order retrieval through
the API, and invalid checkout data.

From here, practice browser back/refresh behavior, concurrent stock updates,
additional shipping addresses, and new coupon rules. Do not enter real payment
information: this sample has no payment integration.
