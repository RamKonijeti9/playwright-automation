const {test,expect} = require('@playwright/test');

function getRandomString(length) {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let k = 0; k < length; k++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  // Capitalize the first letter to look like a proper name
  return result.charAt(0).toUpperCase() + result.slice(1);
}


test('Reach Common Playwright Test', async ({page,browser})=> 
{
const context = await browser.newContext(); 
await page.goto("https://nkkn-qa.managemymobile.com/");
const currentUrl = page.url();
console.log(currentUrl);
await page.getByText("Find Your Plan").click();
const selectPlan = await page.getByTestId("plan_plannsec_button_1");
await selectPlan.click();
const selectLines = await page.getByTestId("plan_plannsec_post_button_add_child_1");
const UnselectLines = await page.getByTestId("plan_plannsec_post_button_remove_child_1");
for (let i=2; i<=25; i++)
{
    await selectLines.click();
    //await page.getByTestId("plan_plannsec_post_button_add_child_1").click();
    console.log("No of lines selected :",  i);
}
const BroadBandFactsOpen = await page.getByTestId("plan_plannsec_boardbandfact_arrow_down_1");
const BroadBandFactsClose = await page.getByTestId("plan_plannsec_boardbandfact_arrow_up_1");

await BroadBandFactsOpen.click();

// const uniquePlan = await page.locator("unique-plan-identifier");
// const textValue = await uniquePlan.textContent();
  
//   // Optional: Trim whitespace or newlines if needed
//   //const cleanValue = textValue.trim();
  
//   console.log('The extracted value is:', textValue);


await BroadBandFactsClose.click();

for (let j=1; j<=25; j++)
{
    await UnselectLines.click();
    console.log("No of lines Unselected :",  j);
}
//await selectPlan.click();
//await page.getByText('Go to Cart').click();
//await page.getByText('Clear Cart').click();
let imei = "351849090744387";
let Address = "123 william street";
let CartEmail = "ramkdatami@gmail.com";
let Password = "Reach@123";
const SubmitButtons = await page.locator("[class=button__text]");
await SubmitButtons.filter({hasText:'Check Compatibility'}).click();
//imei : 351849090744387 password 5779
const IMEIValidation = await page.getByPlaceholder("Enter IMEI number");
await IMEIValidation.fill(imei);
//await SubmitButtons.filter({hasText:'Check'}).click();
await page.getByRole('button', { name: 'Check' }).click();
const SuccessIMEI = await page.getByText("Your  device, MOTOR, is compatible with the network.");
await expect(SuccessIMEI).toBeVisible();
const closeButton = page.getByTestId("CloseIcon"); 
await closeButton.click();
await SubmitButtons.filter({hasText:'Check Coverage'}).click();
const CheckCompatibility = await page.getByPlaceholder("Enter your address");
await CheckCompatibility.fill(Address);
await SubmitButtons.filter({hasText:'Show Results'}).click();
await closeButton.click();
await selectPlan.click();
await page.getByText('Go to Cart').click();
const CartPageFirstName = page.getByPlaceholder("First name");
const CartPageLastName =  page.getByPlaceholder("Last name");
const CartPageEmail = page.getByPlaceholder("Email address");
const CartPagePassword =  page.getByPlaceholder("Password");
const firstName = getRandomString(5);
const lastName = getRandomString(5);
await CartPageFirstName.fill(firstName);
await CartPageLastName.fill(lastName);
await SubmitButtons.filter({hasText:'Continue'}).click();
await CartPageEmail.fill(CartEmail);
await CartPagePassword.fill(Password);
await page.getByLabel("Reveal password").click();
await page.getByLabel("Hide password").click();
await page.getByLabel("controlled").click();
await page.pause();
})

