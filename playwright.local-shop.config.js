const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    testMatch: 'EndToEndGitHubProject.spec.js',
    timeout: 30_000,
    expect: {
        timeout: 5_000
    },
    reporter: 'list',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4174',
        browserName: 'chromium',
        headless: true,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ],
    webServer: {
        command: 'SHOP_PORT=4174 SHOP_DATABASE_PATH=local-shop/data/e2e.sqlite SHOP_RESET_DATABASE=1 node local-shop/server.js',
        url: 'http://127.0.0.1:4174/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
    }
});
