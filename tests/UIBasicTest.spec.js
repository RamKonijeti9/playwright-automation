const {test,expect} = require('@playwright/test');

test('First Playwright Test', async ({browser})=> 
{

const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://rahulshettyacademy.com/client");


});

test('Browser Playwright Test', async ({page})=> 
{

await page.goto("https://rahulshettyacademy.com/client");
console.log(await page.title());
//await expect(page).toHaveTitle("Practice Page");
page.locator(".text-reset").click();
await page.getByText('Register here').click();
await page.locator("#firstName").fill('Ram');
});