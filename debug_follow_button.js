const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const cookiesRaw = JSON.parse(fs.readFileSync('./x_cookies.json', 'utf-8'));
  const cookies = Array.isArray(cookiesRaw)
    ? cookiesRaw
    : Object.entries(cookiesRaw).map(([name, value]) => ({
        name,
        value,
        url: 'https://x.com'
      }));

  // 🧭 הדפס פה את הקישור לציוץ שברצונך לבדוק
  const TWEET_URL = 'https://x.com/<username>/status/<tweet_id>';

  const browser = await puppeteer.launch({
    headless: false,           // ← חייבים false כדי לראות DevTools
    devtools: true,            // ← יפתח אוטומטית את DevTools
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-notifications',
      '--disable-infobars',
      '--window-size=1200,1000'
    ]
  });

  const page = await browser.newPage();
  await page.setCookie(...cookies);

  console.log(`🌐 Navigating to: ${TWEET_URL}`);
  await page.goto(TWEET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('🧩 Page loaded. You can now inspect elements manually.');
  console.log('💡 Look for follow buttons, usually have data-testid="placementTracking" or aria-label="Follow"');

  // ❗הקוד יעצור כאן — הדפדפן נשאר פתוח
  await new Promise(() => {}); // "infinite hang" for debugging
})();
