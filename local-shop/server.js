const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.SHOP_PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATABASE_PATH = process.env.SHOP_DATABASE_PATH
    ? path.resolve(process.env.SHOP_DATABASE_PATH)
    : path.join(DATA_DIR, 'shop.sqlite');
const MAX_BODY_BYTES = 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
if (process.env.SHOP_RESET_DATABASE === '1' && fs.existsSync(DATABASE_PATH)) {
    fs.unlinkSync(DATABASE_PATH);
}

const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        category TEXT NOT NULL DEFAULT 'General',
        stock INTEGER NOT NULL DEFAULT 100 CHECK (stock >= 0)
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        shipping_cents INTEGER NOT NULL DEFAULT 0,
        tax_cents INTEGER NOT NULL DEFAULT 0,
        coupon_code TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id TEXT NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        PRIMARY KEY (order_id, product_id)
    );
`);

function addColumnIfMissing(table, column, definition) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((existing) => existing.name === column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

addColumnIfMissing('products', 'category', "TEXT NOT NULL DEFAULT 'General'");
addColumnIfMissing('products', 'stock', 'INTEGER NOT NULL DEFAULT 100');
addColumnIfMissing('orders', 'subtotal_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('orders', 'discount_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('orders', 'shipping_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('orders', 'tax_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('orders', 'coupon_code', 'TEXT');

const seedProduct = database.prepare(`
    INSERT OR IGNORE INTO products (id, name, description, price_cents, category, stock)
    VALUES (?, ?, ?, ?, ?, ?)
`);
[
    ['backpack', 'Everyday Backpack', 'A durable backpack for work, school, and travel.', 3499, 'Accessories', 30],
    ['mug', 'Ceramic Mug', 'A sturdy 12 oz mug for your favorite hot drink.', 1299, 'Home', 50],
    ['tote', 'Canvas Tote', 'A reusable cotton canvas bag for everyday errands.', 1899, 'Accessories', 25],
    ['desk-lamp', 'Adjustable Desk Lamp', 'A compact lamp with three brightness levels.', 4299, 'Home', 18],
    ['notebook', 'Recycled Notebook', 'A 160-page notebook made with recycled paper.', 799, 'Stationery', 40],
    ['travel-bottle', 'Insulated Travel Bottle', 'A leak-resistant bottle that keeps drinks cold.', 2499, 'Lifestyle', 0]
].forEach((product) => seedProduct.run(...product));

database.prepare(`
    UPDATE products SET category = ?, stock = ?
    WHERE id = ? AND category = 'General'
`).run('Accessories', 30, 'backpack');
database.prepare(`
    UPDATE products SET category = ?, stock = ?
    WHERE id = ? AND category = 'General'
`).run('Home', 50, 'mug');
database.prepare(`
    UPDATE products SET category = ?, stock = ?
    WHERE id = ? AND category = 'General'
`).run('Accessories', 25, 'tote');

const productList = database.prepare(`
    SELECT id, name, description, price_cents AS priceCents,
           category, stock
    FROM products
    ORDER BY name COLLATE NOCASE
`);
const productById = database.prepare(`
    SELECT id, name, price_cents AS priceCents, category, stock
    FROM products WHERE id = ?
`);
const orderById = database.prepare(`
    SELECT id, customer_name AS customerName, customer_email AS customerEmail,
           subtotal_cents AS subtotalCents, discount_cents AS discountCents,
           shipping_cents AS shippingCents, tax_cents AS taxCents,
           total_cents AS totalCents, coupon_code AS couponCode, created_at AS createdAt
    FROM orders WHERE id = ?
`);
const itemsByOrderId = database.prepare(`
    SELECT product_id AS productId, product_name AS productName,
           unit_price_cents AS unitPriceCents, quantity
    FROM order_items WHERE order_id = ? ORDER BY product_name
`);

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
    });
    response.end(JSON.stringify(body));
}

function readJson(request) {
    return new Promise((resolve, reject) => {
        let body = '';

        request.on('data', (chunk) => {
            body += chunk;
            if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('Request body exceeds 1 MB.'), { statusCode: 413 }));
                request.destroy();
            }
        });
        request.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }));
            }
        });
        request.on('error', reject);
    });
}

function findCoupon(code) {
    if (typeof code !== 'string' || !code.trim()) {
        return null;
    }
    const normalized = code.trim().toUpperCase();
    const coupons = {
        SAVE10: { code: 'SAVE10', type: 'percent', value: 10, description: '10% off products' },
        FREESHIP: { code: 'FREESHIP', type: 'shipping', value: 100, description: 'Free shipping' }
    };
    return coupons[normalized] || null;
}

function priceOrder(products, coupon) {
    const subtotalCents = products.reduce(
        (total, product) => total + product.priceCents * product.quantity,
        0
    );
    const discountCents = coupon?.type === 'percent'
        ? Math.floor(subtotalCents * coupon.value / 100)
        : 0;
    const shippingCents = coupon?.type === 'shipping' || subtotalCents - discountCents >= 5000
        ? 0
        : 599;
    const taxCents = Math.round((subtotalCents - discountCents + shippingCents) * 825 / 10000);

    return {
        subtotalCents,
        discountCents,
        shippingCents,
        taxCents,
        totalCents: subtotalCents - discountCents + shippingCents + taxCents
    };
}

async function createOrder(request, response) {
    const payload = await readJson(request);
    const customerName = typeof payload.customerName === 'string'
        ? payload.customerName.trim()
        : '';
    const customerEmail = typeof payload.customerEmail === 'string'
        ? payload.customerEmail.trim()
        : '';
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail);

    if (customerName.length < 2 || customerName.length > 100) {
        return sendJson(response, 400, { error: 'Customer name must be 2 to 100 characters.' });
    }
    if (!validEmail) {
        return sendJson(response, 400, { error: 'A valid customer email is required.' });
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 20) {
        return sendJson(response, 400, { error: 'Order must contain between 1 and 20 products.' });
    }

    const quantities = new Map();
    for (const item of payload.items) {
        if (!item || typeof item.productId !== 'string'
            || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
            return sendJson(response, 400, { error: 'Each item needs a product ID and quantity from 1 to 20.' });
        }
        quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    }

    const products = [];
    for (const [productId, quantity] of quantities) {
        const product = productById.get(productId);
        if (!product) {
            return sendJson(response, 400, { error: `Unknown product: ${productId}` });
        }
        if (quantity > 20) {
            return sendJson(response, 400, { error: 'Combined quantity for a product cannot exceed 20.' });
        }
        if (product.stock < quantity) {
            return sendJson(response, 409, {
                error: `${product.name} has only ${product.stock} item(s) available.`,
                productId,
                available: product.stock
            });
        }
        products.push({ ...product, quantity });
    }

    let coupon = null;
    if (payload.couponCode) {
        coupon = findCoupon(payload.couponCode);
        if (!coupon) {
            return sendJson(response, 400, { error: 'Coupon code is not valid.' });
        }
    }
    const totals = priceOrder(products, coupon);

    database.exec('BEGIN');
    try {
        const insertedOrder = database.prepare(`
            INSERT INTO orders (
                customer_name, customer_email, subtotal_cents, discount_cents,
                shipping_cents, tax_cents, total_cents, coupon_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            customerName,
            customerEmail,
            totals.subtotalCents,
            totals.discountCents,
            totals.shippingCents,
            totals.taxCents,
            totals.totalCents,
            coupon?.code || null
        );
        const orderId = Number(insertedOrder.lastInsertRowid);
        const insertItem = database.prepare(`
            INSERT INTO order_items
                (order_id, product_id, product_name, unit_price_cents, quantity)
            VALUES (?, ?, ?, ?, ?)
        `);
        const decreaseStock = database.prepare(`
            UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?
        `);

        for (const product of products) {
            const stockUpdate = decreaseStock.run(
                product.quantity,
                product.id,
                product.quantity
            );
            if (stockUpdate.changes !== 1) {
                throw Object.assign(
                    new Error(`${product.name} no longer has enough stock.`),
                    { statusCode: 409 }
                );
            }
            insertItem.run(
                orderId,
                product.id,
                product.name,
                product.priceCents,
                product.quantity
            );
        }

        database.exec('COMMIT');
        return sendJson(response, 201, {
            id: orderId,
            customerName,
            customerEmail,
            ...totals,
            couponCode: coupon?.code || null,
            items: products.map((product) => ({
                productId: product.id,
                productName: product.name,
                unitPriceCents: product.priceCents,
                quantity: product.quantity
            }))
        });
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

function serveStatic(pathname, response) {
    const requestedFile = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.resolve(PUBLIC_DIR, requestedFile);
    if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
        return sendJson(response, 404, { error: 'Not found.' });
    }

    fs.readFile(filePath, (error, contents) => {
        if (error) {
            return sendJson(response, 404, { error: 'Not found.' });
        }

        const extension = path.extname(filePath);
        const contentType = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8'
        }[extension] || 'application/octet-stream';

        response.writeHead(200, { 'content-type': contentType });
        response.end(contents);
    });
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    try {
        if (request.method === 'GET' && url.pathname === '/api/health') {
            return sendJson(response, 200, { status: 'ok' });
        }
        if (request.method === 'GET' && url.pathname === '/api/products') {
            const search = (url.searchParams.get('search') || '').trim().toLowerCase();
            const category = url.searchParams.get('category') || 'all';
            const sort = url.searchParams.get('sort') || 'name';
            const allowedSorts = {
                name: (a, b) => a.name.localeCompare(b.name),
                'price-asc': (a, b) => a.priceCents - b.priceCents || a.name.localeCompare(b.name),
                'price-desc': (a, b) => b.priceCents - a.priceCents || a.name.localeCompare(b.name)
            };
            if (!allowedSorts[sort]) {
                return sendJson(response, 400, { error: 'Sort must be name, price-asc, or price-desc.' });
            }
            const products = productList.all().filter((product) =>
                (category === 'all' || product.category === category)
                && (!search || `${product.name} ${product.description}`.toLowerCase().includes(search))
            ).sort(allowedSorts[sort]);
            return sendJson(response, 200, { products });
        }
        if (request.method === 'GET' && url.pathname === '/api/categories') {
            const categories = database.prepare(`
                SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE
            `).all().map((row) => row.category);
            return sendJson(response, 200, { categories });
        }
        const couponPath = url.pathname.match(/^\/api\/coupons\/([a-z0-9_-]+)$/i);
        if (request.method === 'GET' && couponPath) {
            const coupon = findCoupon(couponPath[1]);
            if (!coupon) {
                return sendJson(response, 404, { error: 'Coupon code is not valid.' });
            }
            return sendJson(response, 200, { coupon });
        }
        if (request.method === 'POST' && url.pathname === '/api/orders') {
            return await createOrder(request, response);
        }

        const orderPath = url.pathname.match(/^\/api\/orders\/(\d+)$/);
        if (request.method === 'GET' && orderPath) {
            const order = orderById.get(Number(orderPath[1]));
            if (!order) {
                return sendJson(response, 404, { error: 'Order not found.' });
            }
            return sendJson(response, 200, {
                ...order,
                items: itemsByOrderId.all(order.id)
            });
        }

        if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
            return serveStatic(url.pathname, response);
        }

        return sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        if (statusCode === 500) {
            console.error('Shop request failed:', error);
        }
        if (!response.headersSent) {
            return sendJson(response, statusCode, { error: error.message });
        }
        response.destroy(error);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Local shop listening at http://127.0.0.1:${PORT}`);
});

function shutdown() {
    server.close(() => {
        database.close();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
