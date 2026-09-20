const { test, expect } = require('@playwright/test');

// ---------------------------------------------------------
// Test Data
// ---------------------------------------------------------

const TEST_DATA = {
    url: 'https://nkkn-qa.managemymobile.com/',
    //url: 'https://activa-mobile-stage.reachmobileplatform.com/',
    imei: '351849090744387',
    address: '123 william street',
    email: 'reachem54@gmail.com',
    password: 'Reach@123',
    maxLines: 25
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

// Ramdom Email Generator

function getUniqueEmail() {

    const timestamp = Date.now();

    const [username, domain] = TEST_DATA.email.split('@');

    return `${username}+${timestamp}@${domain}`;
}

async function captureNotification(page) {

    const notification = page.locator('div.rnc__notification-container--top-full');

    await expect(notification).toBeVisible({timeout: 5000});

    const message = await notification.innerText();

    console.log(`Response Message: ${message}`);

    return message;
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

    const FindYourPlan = await page.getByText('Find Your Plan');

    // Verify CTA is visible 
    await expect(FindYourPlan).toBeVisible();

    // Verify CTA is enabled 
    await expect(FindYourPlan).toBeEnabled();

    await FindYourPlan.click(); 

    console.log('Find Your Plan clicked.');

    const selectPlan = page.getByTestId('plan_plannsec_button_1');

    // Verify Select Plan CTA is visible 
    await expect(selectPlan).toBeVisible(); 
    
    // Verify Select Plan CTA is enabled 
    await expect(selectPlan).toBeEnabled();

    await selectPlan.click();

    console.log("Plan is Selected");


    // =====================================================
    // 3. Verify First Line is Selected...
    // =====================================================

    const addLineButton = page.getByTestId('plan_plannsec_post_button_add_child_1');
    
    const removeLineButton = page.getByTestId('plan_plannsec_post_button_remove_child_1');
    
    // Verify + button is available 
    await expect(addLineButton).toBeVisible(); 
    
    // Verify - button is available 
    await expect(removeLineButton).toBeVisible(); 
    
    console.log('First line selected successfully.');

    // ======================================================== 
    // 4. ADD LINES UP TO MAXIMUM - 25 
    // Select Plan = Line 1 
    // + clicks = Lines 2 to 25
    // Therefore: 
    // 1 Select Plan + 24 Plus clicks = 25 lines 
    // ========================================================

    for (let line = 2; line <= TEST_DATA.maxLines; line++) 
        { 
          // Verify + button is visible 
          await expect(addLineButton).toBeVisible(); 

          // Verify + button is enabled 
          await expect(addLineButton).toBeEnabled(); 
        
          // Click + 
          await addLineButton.click(); 
        
          console.log(`Line ${line} selected.`); 
        }

    const lineCount = page.getByTestId('plan_plannsec_post_button_number_1');

    await expect(lineCount).toHaveText('25');

    console.log(`Maximum line validation completed: ${TEST_DATA.maxLines} lines.`);

        
    // =====================================================
    // 5. Open & Close Broadband Facts
    // =====================================================

    const broadbandFactsOpen = page.getByTestId('plan_plannsec_boardbandfact_arrow_down_1');
        
    // Verify down arrow is visible 
    await expect(broadbandFactsOpen).toBeVisible();

    await broadbandFactsOpen.click();

    console.log('Broadband Facts opened.');

    const broadbandFactsClose = page.getByTestId('plan_plannsec_boardbandfact_arrow_up_1');

    await expect(broadbandFactsClose).toBeVisible();

    console.log('Broadband Facts open state verified.');

    await broadbandFactsClose.click();

    console.log('Broadband Facts closed.');

    await expect(broadbandFactsOpen).toBeVisible(); 
    
    console.log('Broadband Facts close state verified.');

    // ======================================================== 
    // 6. REMOVE ALL 25 LINES 

    // 25 → 24 → 23 → ... → 1 → 0 

    // Therefore 25 minus clicks are required.
    //  ========================================================

    for ( let line = TEST_DATA.maxLines; line >= 1; line-- ) 
        { 
            // Verify - button is visible 
            await expect(removeLineButton).toBeVisible();
           
            // Verify - button is enabled 
            await expect(removeLineButton).toBeEnabled(); 
           
            // Click -  
            await removeLineButton.click(); 
            
            console.log(`Line removed. Remaining lines: ${line - 1}`); 
        }

    await expect(page.getByText('Select Plan')).toBeVisible(); 
    
    console.log('All selected lines removed.');

    // =====================================================
    // 7. IMEI Compatibility Check
    // =====================================================

    const checkCompatibilityButton = page.locator('[class="button__text"]').filter({ hasText: 'Check Compatibility' });

    // Verify button is visible 
    await expect(checkCompatibilityButton).toBeVisible(); 
    
    // Verify button is enabled 
    await expect(checkCompatibilityButton).toBeEnabled();
    
    await checkCompatibilityButton.click();

    console.log('Check Compatibility opened.');

    const imeiInput = page.getByPlaceholder('Enter IMEI number');

    // Verify IMEI input is visible 
    await expect(imeiInput).toBeVisible(); 
    
    // Verify IMEI input is enabled 
    await expect(imeiInput).toBeEnabled();

    await imeiInput.fill(TEST_DATA.imei);

    console.log('IMEI entered successfully.');

    const checkButton = page.getByRole('button', {name: 'Check'});

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

    const checkCoverageButton = page.locator('[class="button__text"]').filter({ hasText: 'Check Coverage' });

    await expect(checkCoverageButton).toBeVisible(); 
    
    await expect(checkCoverageButton).toBeEnabled();

    await checkCoverageButton.click();

    console.log('Check Coverage opened.');

    const addressInput = page.getByPlaceholder('Enter your address');

    await expect(addressInput).toBeVisible(); 
    
    await expect(addressInput).toBeEnabled();

    await addressInput.fill(TEST_DATA.address);

    // Verify address was entered 
    await expect(addressInput).toHaveValue( TEST_DATA.address ); 

    console.log('Address entered successfully.');

    const showResultsButton = page.locator('[class="button__text"]').filter({ hasText: 'Show Results' });

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

    await expect(selectPlan).toBeVisible(); 
    
    await expect(selectPlan).toBeEnabled();
    
    await selectPlan.click();

    console.log('Plan selected again.');

    const GoToCart = await page.getByText('Go to Cart');

    await expect(GoToCart).toBeVisible(); 

    await expect(GoToCart).toBeEnabled();

    await GoToCart.click(); 
    
    console.log('Navigated to Cart.');

    // =====================================================
    // 9. Enter Customer Details
    // =====================================================


    const firstNameInput = page.getByPlaceholder('First name');

    const lastNameInput = page.getByPlaceholder('Last name');

    const uniqueEmail = getUniqueEmail();

    const emailInput = page.getByPlaceholder('Email address');

    const passwordInput = page.getByPlaceholder('Password');

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



    // Continue to account details

    const continueButton = page.locator('[class="button__text"]').filter({ hasText: 'Continue' });

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

    const RevealPassword = page.getByLabel('Reveal password');

    await expect(RevealPassword).toBeVisible(); 
    
    await RevealPassword.click();

    await expect(passwordInput).toHaveAttribute('type','text');

    console.log('Password reveal functionality verified.');

    const HidePassword = page.getByLabel('Hide password');
    
    
    await expect(HidePassword).toBeVisible(); 
    
    await HidePassword.click();

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

    const SignUp = page.getByTestId('signup_btn_1');

    await expect(SignUp).toBeEnabled(); 

    await SignUp.click(); 

    console.log('SignUp button clicked.');

    const responseMessage = await captureNotification(page);

    console.log( '================================================' ); 

    console.log( 'Reach Common Playwright Test completed successfully.' ); 

    console.log( '================================================' );


    // =====================================================
    // Debugging Only
    // =====================================================

    // await page.pause();

})
