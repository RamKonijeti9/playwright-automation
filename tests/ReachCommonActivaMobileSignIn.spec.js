const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const TEST_DATA = {
    url: 'https://activa-mobile-stage.reachmobileplatform.com/',
    password: 'Reach@123'
};

function readLastSignupEmail() {
    const credentialsPath = path.join(__dirname, '..', '.playwright-state', 'last-signup.json');

    if (!fs.existsSync(credentialsPath)) {
        throw new Error(
            `No saved signup email found at ${credentialsPath}. Run ReachCommonActivaMobile.spec.js first.`
        );
    }

    const { email } = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

    if (!email) {
        throw new Error(`Saved signup data at ${credentialsPath} does not contain an email.`);
    }

    return email;
}

test('Sign in with the last created account', async ({ page }) => {
    const email = readLastSignupEmail();

    await page.goto(TEST_DATA.url);

    const signInButton = page.getByRole('button', { name: /Sign In/i }).first();
    await expect(signInButton).toBeVisible();
    await signInButton.click();

    const emailInput = page
        .getByRole('textbox', { name: /Email address|Email/i })
        .or(page.getByPlaceholder(/Email address|Email/i))
        .first();
    const passwordInput = page
        .getByRole('textbox', { name: /Password/i })
        .or(page.getByPlaceholder('Password'))
        .first();

    await expect(emailInput).toBeVisible();
    await emailInput.fill(email);
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill(TEST_DATA.password);

    const submitButton = page.getByRole('button', { name: /Sign In|Log In/i }).last();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(signInButton).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Plans', exact: true }).first())
        .toBeVisible();
});
