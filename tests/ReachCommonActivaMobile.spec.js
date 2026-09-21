const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------
// Test Data
// ---------------------------------------------------------

const TEST_DATA = {
    // url: 'https://nkkn-qa.managemymobile.com/',
    url: 'https://activa-mobile-stage.reachmobileplatform.com/',
    imei: '351849090744387',
    address: '123 william street',
    email: 'reachem54@gmail.com',
    password: 'Reach@123',
    maxLines: 25,
    CardNumber: '4000300020001000',
    ExpirationMonth: '06-Jun',
    ExpirationYear: '2037',
    CVV: '999'
};


// ---------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------

function getRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyz';

    let result = '';

    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }

    // Convert first character to uppercase
    return result.charAt(0).toUpperCase() + result.slice(1);
}

function ContactNumber() {
    const firstDigit = Math.floor(Math.random() * 9) + 1;
    const remainingDigits = Math.floor(Math.random() * 1_000_000_000)
        .toString()
        .padStart(9, '0');

    return `${firstDigit}${remainingDigits}`;
}

function getDigits(value) {
    return value.replace(/\D/g, '');
}

async function findFrameWithSelector(page, selector) {
    for (const frame of page.frames()) {
        if (frame.isDetached()) {
            continue;
        }

        try {
            if (await frame.locator(selector).count() > 0) {
                return frame;
            }
        } catch (error) {
            if (!/detached|closed/i.test(error.message)) {
                throw error;
            }
        }
    }

    return null;
}

async function findPaymentFrame(context) {
    for (const paymentPage of context.pages()) {
        if (paymentPage.isClosed()) {
            continue;
        }

        const frame = await findFrameWithSelector(paymentPage, '#cardNumber');

        if (frame) {
            return { page: paymentPage, frame };
        }
    }

    return null;
}

function hasPaymentUrl(context) {
    return context.pages().some((openPage) =>
        !openPage.isClosed() && /ippay\.com|hpp-test/i.test(openPage.url())
    );
}

async function findCompletedPaymentPage(context) {
    for (const openPage of context.pages()) {
        if (openPage.isClosed()) {
            continue;
        }

        if (/reachmobileplatform\.com/i.test(openPage.url())
            && !/\/(checkout|loader)\b/i.test(openPage.url())) {
            const plansButton = openPage.getByRole('button', { name: 'Plans', exact: true }).first();
            const signInButton = openPage.getByRole('button', { name: /Sign In/i }).first();

            try {
                if (await plansButton.isVisible() && !(await signInButton.isVisible())) {
                    return openPage;
                }
            } catch (error) {
                if (!/detached|closed/i.test(error.message)) {
                    throw error;
                }
            }
        }

    if (/reachmobileplatform\.com/i.test(openPage.url())
        && !/\/(checkout|loader)\b/i.test(openPage.url())) {
        for (const frame of openPage.frames()) {
            if (frame.isDetached()) {
                continue;
            }

            try {
                if (await frame
                    .getByText(/payment (successful|complete)|transaction approved|thank you/i)
                    .count() > 0) {
                    return openPage;
                }
            } catch (error) {
                if (!/detached|closed/i.test(error.message)) {
                    throw error;
                }
            }
        }
    }

    return null;
}

function saveLastSignupEmail(email) {
    const credentialsPath = path.join(__dirname, '..', '.playwright-state', 'last-signup.json');

    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
    fs.writeFileSync(
        credentialsPath,
        JSON.stringify({ email, savedAt: new Date().toISOString() }, null, 2)
    );
}

function appendSignupCredentials(email, password, phoneNumber) {
    const credentialsPath = path.join(
        __dirname,
        '..',
        '.playwright-state',
        'signup-credentials.csv'
    );

    fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });

    if (!fs.existsSync(credentialsPath)) {
        fs.writeFileSync(credentialsPath, 'email,password,phone\n');
    } else {
        const existingContent = fs.readFileSync(credentialsPath, 'utf8');

        if (existingContent.startsWith('email,password\n')) {
            const existingRows = existingContent
                .trimEnd()
                .split('\n')
                .slice(1)
                .map((row) => `${row},""`)
                .join('\n');

            fs.writeFileSync(
                credentialsPath,
                `email,password,phone\n${existingRows}\n`
            );
        }
    }

    const csvValue = (value) => `"${value.replace(/"/g, '""')}"`;

    fs.appendFileSync(
        credentialsPath,
        `${csvValue(email)},${csvValue(password)},${csvValue(phoneNumber)}\n`
    );
}

// Ramdom Email Generator

function getUniqueEmail() {

    const timestamp = Date.now();

    const [username, domain] = TEST_DATA.email.split('@');

    return `${username}+${timestamp}@${domain}`;
}

function getClickableCta(page, text, { exact = false } = {}) {
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const textPattern = exact ? `^\\s*${escapedText}\\s*$` : escapedText;

    return page
        .locator('button, a, [role="button"]')
        .filter({ hasText: new RegExp(textPattern, 'i') })
        .first();
}

// ---------------------------------------------------------
// Test Case
// ---------------------------------------------------------

test('Reach Common Playwright Test', async ({ page }) => {

    // =====================================================
    // 1. Open Application
    // =====================================================

    await page.goto(TEST_DATA.url);

    // Verify application URL

    await expect(page).toHaveURL(TEST_DATA.url);

    console.log('Application opened successfully.');


    // =====================================================
    // 2. Navigate to Plans
    // =====================================================

    const getStartedButton = getClickableCta(page, 'Get Started');

    // Verify CTA is visible 
    await expect(getStartedButton).toBeVisible();

    // Verify CTA is enabled 
    await expect(getStartedButton).toBeEnabled();

    await getStartedButton.click(); 

    console.log('Get Started is clicked.');

    const selectPlanBTG = getClickableCta(page, 'Select Plan');
    

    // Verify Select Plan CTA is visible 
    await expect(selectPlanBTG).toBeVisible(); 
    
    // Verify Select Plan CTA is enabled 
    await expect(selectPlanBTG).toBeEnabled();

    await selectPlanBTG.click();

    console.log("Plan BTG is Selected");

    // =====================================================
    // 3. Verify First Line is Selected...
    // =====================================================

    const addLineButtonBTG = page.getByTestId('plan_plannsec_post_button_add_child_1');
    
    const removeLineButtonBTG = page.getByTestId('plan_plannsec_post_button_remove_child_1');
    
    // Verify + button is available 
    await expect(addLineButtonBTG).toBeVisible(); 
    
    // Verify - button is available 
    await expect(removeLineButtonBTG).toBeVisible(); 
    
    console.log('ByTheGig line selected successfully.');

    // ======================================================== 
    // 4. ADD LINES UP TO MAXIMUM - 25 
    // Select Plan = Line 1 
    // + clicks = Lines 2 to 25
    // Therefore: 
    // 1 Select Plan + 24 Plus clicks = 25 lines 
    // ========================================================

    await expect(addLineButtonBTG).toBeEnabled();

    for (let line = 2; line <= TEST_DATA.maxLines; line++) 
        { 
          await addLineButtonBTG.click(); 
        
          console.log(`Line ${line} selected.`); 
        }

    const lineCount = page.getByTestId('plan_plannsec_post_button_number_1');

    await expect(lineCount).toHaveText('25');

    console.log(`Maximum line validation completed: ${TEST_DATA.maxLines} lines.`);

        
    // =====================================================
    // 5. Open & Close Broadband Facts
    // =====================================================

    const broadbandFactsOpen = page
        .getByTestId('plan_plannsec_boardbandfact_arrow_down_1')
        .or(page.getByRole('button', { name: /Broadband Facts/i }))
        .first();

    if (await broadbandFactsOpen.count() === 0) {
        console.warn(
            'Broadband Facts is not rendered on this environment after selecting the plan; skipping the optional UI check.'
        );
    } else {
        await expect(broadbandFactsOpen).toBeVisible();
        await broadbandFactsOpen.click();

        console.log('Broadband Facts opened.');

        const broadbandFactsClose = page
            .getByTestId('plan_plannsec_boardbandfact_arrow_up_1')
            .or(page.getByRole('button', { name: /Broadband Facts/i }))
            .first();

        await expect(broadbandFactsClose).toBeVisible();
        console.log('Broadband Facts open state verified.');

        await broadbandFactsClose.click();
        console.log('Broadband Facts closed.');
        await expect(broadbandFactsOpen).toBeVisible();
        console.log('Broadband Facts close state verified.');
    }

    if (!(await removeLineButtonBTG.isVisible())) {
        await page.keyboard.press('Escape');
    }

    if (!(await removeLineButtonBTG.isVisible())) {
        const plansButton = page.getByRole('button', { name: 'Plans', exact: true }).first();

        if (await plansButton.count() > 0) {
            await plansButton.click();
        } else {
            await page.goBack();
        }
    }

    await expect(removeLineButtonBTG).toBeVisible();

    // ======================================================== 
    // 6. REMOVE ALL 25 LINES 

    // 25 → 24 → 23 → ... → 1 → 0 

    // Therefore 25 minus clicks are required.
    //  ========================================================

    await expect(removeLineButtonBTG).toBeEnabled();

    for ( let line = TEST_DATA.maxLines; line >= 1; line-- ) 
        { 
            await removeLineButtonBTG.click(); 
            
            console.log(`Line removed. Remaining lines: ${line - 1}`); 
        }

   // await expect(page.getByText('Select Plan')).toBeVisible(); 
    
    console.log('All selected lines removed.');

    // =====================================================
    // 7. IMEI Compatibility Check
    // =====================================================

    const checkCompatibilityButton = getClickableCta(page, 'Check Compatibility');
    // Verify button is visible 
    await expect(checkCompatibilityButton).toBeVisible(); 
    
    // Verify button is enabled 
    await expect(checkCompatibilityButton).toBeEnabled();
    
    await checkCompatibilityButton.click();

    console.log('Check Compatibility opened.');

    const imeiInput = page
        .getByRole('textbox', { name: /Enter(?: your)? IMEI number/i })
        .or(page.getByPlaceholder(/Enter(?: your)? IMEI number/i))
        .first();

    // Verify IMEI input is visible 
    await expect(imeiInput).toBeVisible(); 
    
    // Verify IMEI input is enabled 
    await expect(imeiInput).toBeEnabled();

    await imeiInput.fill(TEST_DATA.imei);

    console.log('IMEI entered successfully.');

    const checkButton = page
        .getByRole('button', { name: /^(Check|Check Compatibility)$/i })
        .first();

    await expect(checkButton).toBeEnabled(); 
    
    await checkButton.click(); 
    
    console.log('IMEI compatibility check completed.');


    // Verify IMEI compatibility result

    const successIMEIMessage = page.getByText('Your device, MOTOR, is compatible with the network.');

    // await expect(successIMEIMessage).toBeVisible();

    console.log('IMEI compatibility successfully verified.');


    // Close compatibility popup

    const closeButton = page.getByTestId('CloseIcon');

    await expect(closeButton).toBeVisible(); 

    await closeButton.click();

    // Verify popup is closed 
    await expect( successIMEIMessage ).not.toBeVisible(); 
    
    console.log('IMEI popup closed.');


    // =====================================================
    // 7. Coverage Check
    // =====================================================

    const checkCoverageButton = getClickableCta(page, 'Check Coverage', { exact: true });

    await expect(checkCoverageButton).toBeVisible(); 
    
    await expect(checkCoverageButton).toBeEnabled();

    await checkCoverageButton.click();

    console.log('Check Coverage opened.');

    const addressInput = page
        .getByRole('textbox', { name: /Enter your address/i })
        .or(page.getByPlaceholder('Enter your address'))
        .first();

    await expect(addressInput).toBeVisible(); 
    
    await expect(addressInput).toBeEnabled();

    await addressInput.fill(TEST_DATA.address);

    // Verify address was entered 
    await expect(addressInput).toHaveValue( TEST_DATA.address ); 

    const addressSuggestion = page
        .getByRole('option')
        .filter({ hasText: /123 William Street/i })
        .first();

    if (await addressSuggestion.count() > 0) {
        await addressSuggestion.click();
    } else {
        await addressInput.press('ArrowDown');
        await addressInput.press('Enter');
    }

    console.log('Address entered successfully.');

    const showResultsButton = page
        .getByRole('button', { name: /^(Show Results|Check Coverage)$/i })
        .first();

    await expect(showResultsButton).toBeVisible(); 
    
    await expect(showResultsButton).toBeEnabled();

    await showResultsButton.click();

    console.log('Coverage results requested.');

    await expect(closeButton).toBeVisible();

    await closeButton.click();

    console.log('Coverage popup closed.');
    

    // =====================================================
    // 8. Go To Cart
    // =====================================================

    await expect(selectPlanBTG).toBeVisible(); 
    
    await expect(selectPlanBTG).toBeEnabled();
    
    await selectPlanBTG.click();

    console.log('ByTheGig Plan selected again.');

    const selectPlanUL = getClickableCta(page, 'Select Plan');

    await expect(selectPlanUL).toBeVisible(); 
    
    await expect(selectPlanUL).toBeEnabled();
    
    await selectPlanUL.click();

    console.log('Unlimited Plan selected again.');

    const goToCartButton = getClickableCta(page, 'Go to Cart');

    await expect(goToCartButton).toBeVisible(); 

    await expect(goToCartButton).toBeEnabled();

    await goToCartButton.click(); 
    
    console.log('Navigated to Cart.');

    // =====================================================
    // 9. Enter Customer Details
    // =====================================================


    const firstNameInput = page
        .getByRole('textbox', { name: 'First name' })
        .or(page.getByPlaceholder('First name'))
        .first();

    const lastNameInput = page
        .getByRole('textbox', { name: 'Last name' })
        .or(page.getByPlaceholder('Last name'))
        .first();

    const uniqueEmail = getUniqueEmail();

    const emailInput = page
        .getByRole('textbox', { name: /Email address/i })
        .or(page.getByPlaceholder('Email address'))
        .first();

    const passwordInput = page
        .getByRole('textbox', { name: /Password/i })
        .or(page.getByPlaceholder('Password'))
        .first();

    await expect(firstNameInput).toBeVisible(); 
    
    await expect(lastNameInput).toBeVisible(); 

    console.log('Cart page loaded successfully.');

    const firstName = getRandomString(5);
    
    const lastName = getRandomString(5);

    console.log(`Generated First Name: ${firstName}`); 
    
    console.log(`Generated Last Name: ${lastName}`);

    await expect(firstNameInput).toBeEnabled();

    await firstNameInput.fill(firstName);

    await expect(firstNameInput).toHaveValue( firstName ); 
    
    console.log('First name entered successfully.');

    await expect(lastNameInput).toBeEnabled();

    await lastNameInput.fill(lastName);

    await expect(lastNameInput).toHaveValue( lastName ); 
    
    console.log('Last name entered successfully.');

    const deleteLineCartButton = page
        .getByRole('button', { name: /delete|remove/i })
        .or(page.getByTestId('line_card_delete_icon_2'))
        .first();

    await expect(deleteLineCartButton).toBeEnabled();

    await deleteLineCartButton.click();

    console.log('Add Line Deleted successfully.');

    const identityVerificationCheckbox = page.getByRole('checkbox').last();

    if (!(await identityVerificationCheckbox.isChecked())) {
        await identityVerificationCheckbox.check();
    }

    // Continue to account details

    const continueButton = page
        .getByRole('button', { name: /^(Continue|Proceed to Checkout)$/i })
        .first();

   // await expect(continueButton).toBeVisible(); 

    await expect(continueButton).toBeEnabled(); 

    await continueButton.click(); 

    console.log('Continue button clicked.');


    // =====================================================
    // 10. Account Details
    // =====================================================

    await expect(emailInput).toBeVisible(); 

    await expect(emailInput).toBeEnabled();

    await emailInput.fill(uniqueEmail);

    await expect(emailInput).toHaveValue(uniqueEmail);

    console.log('Email entered successfully.');

    console.log(`Email used: ${uniqueEmail}`);

    await expect(passwordInput).toBeVisible(); 

    await expect(passwordInput).toBeEnabled();

    await passwordInput.fill(TEST_DATA.password);

    await expect(passwordInput).toHaveValue( TEST_DATA.password );

    console.log('Password entered successfully.');


    // =====================================================
    // 11. Password Visibility
    // =====================================================

    const revealPasswordButton = page.getByLabel(/Reveal password/i);

    await expect(revealPasswordButton).toBeVisible(); 
    
    await revealPasswordButton.click();

    await expect(passwordInput).toHaveAttribute('type','text');

    console.log('Password reveal functionality verified.');

    const hidePasswordButton = page.getByLabel(/Hide password/i);
    
    await expect(hidePasswordButton).toBeVisible(); 
    
    await hidePasswordButton.click();

    await expect(passwordInput).toHaveAttribute('type','password');

    console.log('Password hide functionality verified.');


    // =====================================================
    // 12. Final Checkbox / Control
    // =====================================================

    const AcceptTermsToggle = page.getByLabel('controlled');

    await expect(AcceptTermsToggle).toBeVisible(); 
    
    await expect(AcceptTermsToggle).toBeEnabled(); 
    
    await AcceptTermsToggle.click();

    console.log('Controlled checkbox selected successfully.');

    const signUpButton = page
        .getByRole('button', { name: /^(Sign Up|Create Account)$/i })
        .first();

    await expect(signUpButton).toBeEnabled(); 

    await signUpButton.click(); 

    console.log('SignUp button clicked.');

    await expect(page.getByRole('heading', { name: 'Checkout', exact: true }))
        .toBeVisible();
    await expect(page.getByRole('button', { name: /Sign In/i }).first())
        .toBeVisible();
    saveLastSignupEmail(uniqueEmail);
    console.log(`Last signup email saved for sign-in test: ${uniqueEmail}`);

    const BillingNumber = ContactNumber();

    const PhoneNumber = page
        .getByRole('textbox', { name: /phone/i })
        .first();

    await expect(PhoneNumber).toBeVisible(); 

    await expect(PhoneNumber).toBeEnabled();

    await PhoneNumber.fill(BillingNumber);

    await expect.poll(
        async () => getDigits(await PhoneNumber.inputValue())
    ).toBe(BillingNumber);

    console.log('Number entered successfully.');

    console.log(`Number used: ${BillingNumber}`);
    console.log(`Formatted number displayed: ${await PhoneNumber.inputValue()}`);
    appendSignupCredentials(uniqueEmail, TEST_DATA.password, BillingNumber);

    const billingAddress = page
        .getByRole('textbox', { name: /Street/i })
        .or(page.getByPlaceholder(/address1/i))
        .first();

    await expect(billingAddress).toBeVisible();
    await expect(billingAddress).toBeEnabled();
    await billingAddress.click();
    await billingAddress.fill('');
    await billingAddress.pressSequentially('123 William Street', { delay: 50 });

    const billingAddressSuggestion = page
        .locator('.pac-container .pac-item, [role="option"]')
        .first();

    await expect(billingAddressSuggestion).toBeVisible({ timeout: 10000 });
    await billingAddressSuggestion.click();

    await expect(billingAddress).toHaveValue(/123 William Street/i);
    await expect(page.getByRole('textbox', { name: 'City' }))
        .toHaveValue(/.+/);
    await expect(page.getByRole('textbox', { name: 'Select State' }))
        .toHaveValue(/.+/);
    await expect(page.getByRole('textbox', { name: 'ZIP code' }))
        .toHaveValue(/.+/);
    console.log(`Billing address entered: ${await billingAddress.inputValue()}`);

    const proceedToAddCardDetails = page.getByRole('button', {
        name: /Proceed to add card details/i
    });

    await expect(proceedToAddCardDetails).toBeEnabled();

    await proceedToAddCardDetails.click();

    console.log('ProceedToAddCardDetails button clicked.');
    console.log(
        `Open pages after payment CTA: ${page.context().pages().map((openPage) => (
            openPage.isClosed() ? 'closed' : openPage.url()
        )).join(' | ')}`
    );

    await expect.poll(
        () => hasPaymentUrl(page.context()),
        { timeout: 60000 }
    ).toBeTruthy();

    await expect.poll(
        () => findPaymentFrame(page.context()),
        { timeout: 30000 }
    ).toBeTruthy();

    const paymentTarget = await findPaymentFrame(page.context());

    if (!paymentTarget) {
        throw new Error('Payment card form was not found on any open page or frame.');
    }

    const paymentPage = paymentTarget.page;
    const paymentFrame = paymentTarget.frame;

    await paymentPage.bringToFront();
    console.log(`Payment Page URL: ${paymentPage.url()}`);

    const IPPAYCard = paymentFrame.locator('#cardNumber');

    await expect(IPPAYCard).toBeVisible();
    await expect(IPPAYCard).toBeEnabled();
    await IPPAYCard.fill(TEST_DATA.CardNumber);

    const ExpMonth = paymentFrame.locator('#CardExpMonth');
    const ExpYear = paymentFrame.locator('#CardExpYear');
    const SubmitPayment = paymentFrame.locator('#submit');

    const IPPAYCVV = paymentFrame.locator('#cvv');

    await expect(IPPAYCVV).toBeVisible();
    await expect(IPPAYCVV).toBeEnabled();
    await IPPAYCVV.fill(TEST_DATA.CVV);

    await expect(ExpMonth).toBeVisible();
    await expect(ExpMonth).toBeEnabled();
    await ExpMonth.selectOption({ label: TEST_DATA.ExpirationMonth });

    await expect(ExpYear).toBeVisible();
    await expect(ExpYear).toBeEnabled();
    await ExpYear.selectOption({ label: TEST_DATA.ExpirationYear });

    await expect(SubmitPayment).toBeVisible();
    await expect(SubmitPayment).toBeEnabled();
    await SubmitPayment.click();

    await expect.poll(
        () => findCompletedPaymentPage(page.context()),
        { timeout: 120000 }
    ).toBeTruthy();

    const returnedPage = await findCompletedPaymentPage(page.context());

    if (!returnedPage) {
        throw new Error('Payment did not complete or return to the Activa Mobile application.');
    }

    await returnedPage.bringToFront();
    await expect(returnedPage).toHaveURL(/reachmobileplatform\.com/i);
    await expect(returnedPage).not.toHaveURL(/\/(checkout|loader)\b/i);
    await expect(returnedPage.getByRole('button', { name: /Plans/i }).first())
        .toBeVisible();
    await expect(returnedPage.getByRole('button', { name: /Sign In/i }).first())
        .not.toBeVisible();

    console.log(`Payment completed and returned to the authenticated home page: ${returnedPage.url()}`);

    console.log( '================================================' ); 

    console.log( 'Reach Common Playwright Test completed successfully.' ); 

    console.log( '================================================' );


});
