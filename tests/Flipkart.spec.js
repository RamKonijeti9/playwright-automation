const { test, expect } = require('@playwright/test');

test('Flipkart user can sign in', async ({ page }) => {
    const email = process.env.FLIPKART_EMAIL;
    const password = process.env.FLIPKART_PASSWORD;
    const otp = process.env.FLIPKART_OTP;

    if (!email || !password) {
        throw new Error(
            'Set FLIPKART_EMAIL and FLIPKART_PASSWORD environment variables before running this test.'
        );
    }

    await page.goto('https://www.flipkart.com/');

    const emailInput = page.getByRole('textbox', { name: 'Email ID' });
    if (!(await emailInput.isVisible())) {
        const emailLoginOption = page.getByText('Use Email-ID', { exact: true });
        await expect(emailLoginOption).toBeVisible();
        await emailLoginOption.click();
    }

    await expect(emailInput).toBeVisible();
    await emailInput.fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    const passwordInput = page.getByLabel(/password/i);
    if (await passwordInput.isVisible()) {
        await passwordInput.fill(password);
        await page.getByRole('button', { name: /login|sign in|continue/i }).last().click();
    } else {
        await expect(page).toHaveURL(/\/login\/verify/);

        if (!otp) {
            throw new Error(
                'Flipkart requires an OTP for this login. Set FLIPKART_OTP to the current code received for this sign-in, then rerun.'
            );
        }

        if (!/^\d{6}$/.test(otp)) {
            throw new Error('FLIPKART_OTP must contain exactly six digits.');
        }

        const otpInputs = page.getByRole('spinbutton');
        await expect(otpInputs).toHaveCount(6);
        for (let index = 0; index < otp.length; index += 1) {
            await otpInputs.nth(index).fill(otp[index]);
        }
        await page.getByRole('button', { name: 'Verify', exact: true }).click();
    }

    await expect(page).not.toHaveURL(/\/login(?:\/verify)?(?:[/?]|$)/);
    const accountMenu = page.getByRole('link', {
        name: new RegExp(email.split('@')[0], 'i')
    });
    await expect(accountMenu).toBeVisible();
    await accountMenu.click();
    await expect(page.getByRole('link', { name: /My Profile/i })).toBeVisible();
});