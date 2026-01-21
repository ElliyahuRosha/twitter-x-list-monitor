const puppeteer = require('puppeteer');
const PUPPETEER_CHROME = puppeteer.executablePath();   // ← ⬅️ שורה חדשה
const fs = require('fs');
const path = require('path');
const https = require('https');
const FormData = require('form-data');
const { loadListsConfig } = require('./lib/config');

let CURRENT_DB_BASE = null;
let CURRENT_CHAT_ID = null;
let Headless = false;
let globalBrowser = null;
const DB_DIRNAME = 'db';

// 🟢 --- WhatsApp Integration (OPEN-WA) ---
const { create, ev } = require("@open-wa/wa-automate");
const mime = require("mime-types");

let whatsappClient = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));

function logCurrentFunctionName(internal = false) {
  const stack = new Error().stack;
  const callerLine = stack.split("\n")[2]; // השורה השלישית מכילה את הפונקציה שלנו
  const match = callerLine.match(/at (\S+)/);
  const funcName = match ? match[1] : '<anonymous>';
  let newlineandtab = 1;
  if (internal) newlineandtab = 0;
  console.log(`${"\n\t".repeat(newlineandtab)}[${funcName}]:`);
}

function getLatestDb(dbBasename) {
  logCurrentFunctionName(true);

  const dir = path.join(__dirname, DB_DIRNAME);
  const prefix = `${dbBasename}_`; // ← שימוש בפרמטר, לא בגלובלי

  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0] : null;
}

function loadDB(fromSaveDbFunction = false, dbBasename) {
  // if (!fromSaveDbFunction) logCurrentFunctionName();
  logCurrentFunctionName();

  const dir = path.join(__dirname, DB_DIRNAME);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }

    const file = getLatestDb(dbBasename);

    if (!file) {
      console.log("🟠 No DB files found — returning empty object");
      return {};
    }
    // if (!fromSaveDbFunction) console.log(`📂 Loaded latest DB file: ${file.name}`);
    console.log(`📂 Loaded latest DB file: ${file.name}`);
    const raw = fs.readFileSync(file.path, 'utf-8');
    return JSON.parse(raw);

  } catch (err) {
    console.error("❌ Error loading database:", err);
    return {};
  }
}

function saveDB(db, dbBasename) {
  logCurrentFunctionName();
                                                                      console.log(`${dbBasename}`);

  function isOldDbSubsetOfNewDb(olddb, newdb) {
    if (typeof olddb !== 'object' || typeof newdb !== 'object' || olddb === null || newdb === null) {
      return true;
    }

    for (const key of Object.keys(olddb)) {
      if (!(key in newdb)) return false;
      if (!isOldDbSubsetOfNewDb(olddb[key], newdb[key])) return false;
    }
    return true;
  }

  const dir = path.join(__dirname, DB_DIRNAME);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${dbBasename}_${timestamp}.json`;
                                                                        console.log(`${filename}`);
  const fullpath = path.join(dir, filename);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`🟠 Created DB directory: ${dir}`);
    }

    const latestMeta = getLatestDb(dbBasename);
    const oldDb = loadDB(true, dbBasename);
    const isSafeToOverwrite = isOldDbSubsetOfNewDb(oldDb, db);

    if (isSafeToOverwrite && latestMeta) {
      fs.writeFileSync(latestMeta.path, JSON.stringify(db, null, 2), 'utf-8');
      fs.renameSync(latestMeta.path, fullpath);
      console.log(`💾 DB safely overwritten, saved and renamed as: ${fullpath}`);
    } else {
      fs.writeFileSync(fullpath, JSON.stringify(db, null, 2), 'utf-8');
      console.warn(`⚠️ DB not overwritten — new DB file: ${fullpath}`);
    }

  } catch (err) {
    console.error("❌ Error saving database:", err);
  }
}

async function verifyLogin(page) {
  logCurrentFunctionName();

  const quickMatch = await page.evaluate(() => {
    return !!document.querySelector('a[href="/mstipe69"][data-testid="AppTabBar_Profile_Link"]');
  });

  if (quickMatch) {
    console.log("✅ Login verified immediately (profile link found)");
  } else {
    console.warn("⚠️  No immediate profile link — checking aria-label...");
    let found = false;

    for (let i = 1; i <= 10; i++) {
      const handles = await page.$x('//*[@aria-label="Elliyahu Rosha"]');
      if (handles.length > 0) {
        console.log("✅ Required element found!");
        found = true;
        break;
      }
      await page.waitForTimeout(10000);
    }

    if (!found) {
      console.warn("❌ Login not verified after 10 seconds");
    }
  }
}

async function safeGoto(page, url, timeout) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    console.log(` [safeGoto:] navigating to: ${url}`);
    return true;
  } catch (err) {
    console.warn(`❌ GOTO failed for ${url}: ${err.message}`);
    throw err;
  }
}

async function initWhatsappClient() {
  console.log("📲 Initializing OPEN-WA WhatsApp client...");

  if (whatsappClient) {
    console.log("⚠️ WhatsApp client already initialized");
    return whatsappClient;
  }

  try {
    const client = await create({
      sessionId: "bot1",
      multiDevice: true,
      qrTimeout: 0,
      authTimeout: 0,

      // ⭐ ככה מכריחים את OPEN-WA להשתמש ב-Chromium של Puppeteer ⭐
      headless: true,
      useChrome: true,
      executablePath: PUPPETEER_CHROME,

      chromiumArgs: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-zygote",
        "--disable-gpu",
      ]
    });

    console.log("✅ WhatsApp client READY");

    whatsappClient = client;
    return client;

  } catch (err) {
    console.error("❌ WhatsApp init failed:", err);
    throw err;
  }
}


async function sendToWhatsapp(tweetObj, db, dbBasename, groupName) {
  if (!whatsappClient) {
    await initWhatsappClient();
  }

  const client = whatsappClient;

  // ----- get chats -----
  console.log("📦 Fetching WhatsApp chat list...");
  const chats = await client.getAllChats();
  console.log(`📋 Found ${chats.length} chats`);

  const group = chats.find(c => c.isGroup && c.name === groupName);

  if (!group) {
    console.warn(`❌ WhatsApp group "${groupName}" not found`);
    return;
  }

  const { screenshot_path, tweeterName, isRepost, retweeterName } = tweetObj;

  if (!screenshot_path || !fs.existsSync(screenshot_path)) {
    console.warn(`⚠️ No screenshot to send for tweet by ${tweeterName}`);
    return;
  }

  const caption = isRepost
    ? `${retweeterName} ↰↳ ${tweeterName}`
    : tweeterName;

  console.log("🖼 Sending image to WhatsApp group:");
  console.log("   → group:", groupName);
  console.log("   → file:", screenshot_path);
  console.log("   → caption:", caption);

  try {
    const result = await client.sendImage(
      group.id,
      screenshot_path,
      path.basename(screenshot_path),
      caption
    );

    console.log("✅ WhatsApp image sent!", result);

    tweetObj.was_sent_to_whatsapp = true;
    saveDB(db, dbBasename);

  } catch (err) {
    console.error("❌ WhatsApp send error:", err);
  }
}

async function sendToTelegram(tweetObj, db, dbBasename, chatId) {
  logCurrentFunctionName();

  const { TELEGRAM_BOT_TOKEN } = JSON.parse(fs.readFileSync('./secrets.json', 'utf-8'));

  const { tweetKey, tweetId, screenshot_path, tweetUsername, tweeterName, isRepost, retweeterName } = tweetObj;
  const caption = isRepost
    ? `${retweeterName} ↰↳ ${tweeterName}`
    : tweeterName;

  let attempt = 1;
  while (attempt <= 3) {
    try {
      const form = new FormData();
      form.append('chat_id', chatId);
      if (!screenshot_path) {
        console.warn(`⛔ Missing screenshot for tweet ${tweetId} — skipping Telegram send.`);
        return;
      }
      form.append('photo', fs.createReadStream(screenshot_path));
      form.append('caption', caption);

      await new Promise((resolve, reject) => {
        const req = https.request({
          method: 'POST',
          host: 'api.telegram.org',
          path: `/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
          headers: form.getHeaders()
        }, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log(`📤 Sent to Telegram: ${path.basename(screenshot_path)}`);
              db[tweetKey].was_sent_to_telegram = true;
              saveDB(db, dbBasename);
              resolve();
            } else {
              reject(new Error(data || `Telegram status ${res.statusCode}`));
            }
          });
        });

        req.on('error', err => reject(err));
        form.pipe(req);
      });
      break;
    } catch (err) {
      console.warn(`⚠️ Telegram error while sending tweet ${tweetId}:`, err.message);

      try {
        const parsed = JSON.parse(err.message);
        if (parsed?.error_code === 429 && parsed.parameters?.retry_after && attempt <= 2) {
          const waitSeconds = parsed.parameters.retry_after;
          console.log(`⏳ Detected 429 — waiting ${waitSeconds}s before retry`);
          await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
          attempt++;
          continue;
        }
        else console.log(`❌ image was not sent! ( ${screenshot_path} )`);
      } catch (jsonErr) {
        console.warn(`⚠️ JSON.parse failed: ${jsonErr.message}`);
      }
      break;
    }
  }
}

function registerNewTweets(db, tweets, dbBasename) {
  logCurrentFunctionName();

  let addedCount = 0;

  for (const tweet of tweets) {
    const key = tweet.tweetId + (tweet.isRepost ? `_${tweet.retweeterUsername}` : '');
    if (!db[key]) {
      db[key] = {
        tweetKey: key,
        tweetId: tweet.tweetId,
        href: tweet.href,
        isRepost: tweet.isRepost,
        retweeterName: tweet.retweeter,
        retweeterUsername: tweet.retweeterUsername,
        tweetUsername: tweet.username,
        tweeterName: tweet.originalAuthor,
        timestamp: tweet.datetime,
        // was_sent: false,
        was_sent_to_telegram: false,
        was_sent_to_whatsapp: false,
        screenshot_path: null
      }
      addedCount++;
    }
  }

  console.log(`🆕 Added ${addedCount} new tweets to ${dbBasename}`);
  saveDB(db, dbBasename);
}

async function extractTweetsFromFeed(page, listFeedUrl, db) {
  logCurrentFunctionName();

  const startTime = Date.now();
  const MAX_RUNTIME_MS = 150_000;
  const maxTweets = 10;
  const THROTTLE_MS = 200; // light per-iteration yield

  await safeGoto(page, listFeedUrl, 30000);

  let tweets = [];
  let lastSeenTweetId = null;

  // פיד חייב להראות לפחות article אחד עם <time> בתוך FEED_INIT_MS, אחרת נחתכים מוקדם.
  const FEED_INIT_MS = 30000;
  try {
    await page.waitForFunction(() => {
      const a = document.querySelector('article time');
      return !!a;
    }, { timeout: FEED_INIT_MS });
    console.log('✅ Feed init: found at least one <article><time>');
  } catch {
    console.warn(`⛔ NO_CONTENT: feed did not show any <article><time> within ${FEED_INIT_MS/1000}s`);
    return [];
  }

  while (tweets.length < maxTweets) {
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.warn(`🕒 Timeout: extractTweetsFromFeed exceeded ${MAX_RUNTIME_MS / 1000}s`);
      break;
    }

    // ↓↓↓ throttle: yield a bit every loop to avoid starving other tabs
    // await sleep(THROTTLE_MS);  // <<< ADD

    await new Promise(resolve => setTimeout(resolve, 5000));

    let newTweets = [];
    try {
      newTweets = await Promise.race([ page.evaluate(() => {
        const detectRepostFromHTML = (html) =>
          html.includes('aria-label="Repost"') ||
          html.includes('data-reposted-candidate') ||
          html.includes('retweeted') ||
          html.includes('M4.75 3.79');

        const extractReplyInfo = (el) => {
          const nodes = el.querySelectorAll('*');
          for (let node of nodes) {
            const txt = node?.innerText?.trim() || '';
            if (txt.includes('Replying to')) {
              const match = txt.match(/Replying to\s+@?(\w+)/);
              if (match) return match[1];
            }
          }
          return null;
        };

        const articles = [...document.querySelectorAll('article')];
        return articles.map((el) => {

          const timeEl = el.querySelector('time');
          const rawDate = new Date(timeEl.dateTime);

          // שמירה כ־10:00 שעון ישראל — בדיוק מה שאתה רואה בפיד
          const datetime = rawDate.toLocaleString('sv-SE', {timeZone: 'Asia/Jerusalem',}).replace(' ', 'T');
          // const datetime = rawDate.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).replace(' ', 'T') + ':00.000Z';

          const timeHref = timeEl?.closest('a')?.getAttribute('href') || '';
          const tweetId = timeHref.split('/status/')[1];
          const username = timeHref.split('/')[1];
          const href = `/${username}/status/${tweetId}`;

          const html = el.outerHTML;
          const isRepost = detectRepostFromHTML(html);

          let retweeter = null;
          let retweeterUsername = null;
          if (isRepost) {
            const socialContext = el.querySelector('span[data-testid="socialContext"]');
            const candidate = socialContext?.querySelector('span');
            retweeter = candidate?.innerText?.trim() || null;

            const match = html.match(/<a[^>]+href="\/([^"]+)"[^>]*>.*?reposted/);
            if (match) retweeterUsername = match[1];
          }

          const originalAuthorEl = el.querySelector('div[data-testid="User-Name"] span');
          const originalAuthor = originalAuthorEl?.innerText?.trim() || '';

          // const quotedCandidate = el.querySelector('div[role="link"] div[dir="auto"] span');
          // const hasQuotedTweet = !!quotedCandidate;
          // const quotedTextPreview = quotedCandidate?.innerText?.slice(0, 40) || '—';

          const replyTo = extractReplyInfo(el);
          const isReply = !!replyTo;

          // const textPreview = el.innerText.slice(0, 60).replace(/\n/g, ' ');

          const hasMemberReply = !isReply && !!el.querySelector('.r-f8sm7e.r-m5arl1');
          if (hasMemberReply) return null;

          return {
            tweetId,
            isRepost,
            retweeterUsername,
            retweeter,
            username,
            href,
            datetime,
            originalAuthor
            // hasVideo
            // hasQuotedTweet,
            // quotedTextPreview,
            // isReply,
            // replyTo,
            // textPreview
          };
        });
      }), timeout(10000)]);
      // if (newTweets.some(t => t?.tweetId === '1950516132617539722')) {
        // console.log(`⏸️ Pause: target tweet is visible. Investigate manually in browser.`);
        // await new Promise(resolve => setTimeout(resolve, 99999999));
      // }

    } catch (err) {
        console.warn(`⏱️ Timeout while evaluating page. - ${err.message}`);
        console.log(`tweets length (final): ${tweets.length}`);
        return tweets.slice(0, maxTweets);
    }

    newTweets = newTweets.filter(Boolean);

    // extra small yield before heavy merges/scroll
    // await sleep(THROTTLE_MS);  // <<< ADD

    const seen = newTweets.find(t => t.tweetId === lastSeenTweetId);
    let skipPush = false;
    if (lastSeenTweetId && !seen) {
      let found = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.warn(`⚠️ Scroll attempt ${attempt}/3: trying to recover tweet ${lastSeenTweetId}`);
        await page.evaluate(() => window.scrollBy(0, -2000));
        await new Promise(resolve => setTimeout(resolve, 2500));

        found = await page.evaluate((id) => {
          return !!document.querySelector(`a[href*="/status/${id}"]`);
        }, lastSeenTweetId);

        if (found) {
          console.log(`✅ Tweet ${lastSeenTweetId} reappeared in the DOM`);
          break;
        }
      }

      if (!found) {
          console.warn(`⛔ Reached 3 attempts – possible unrecoverable overscroll`);
          break;
      }  
    }

        // עכשיו מוסיפים רק אם לא דילגנו
    if (!skipPush) {
      tweets.push(...newTweets.filter(t => !tweets.some(x => x.tweetId === t.tweetId)));
      lastSeenTweetId = [...tweets].reverse().find(t => !t.isRepost)?.tweetId;

      // ✅ סיום אם הציוץ האחרון כבר במסד הנתונים
      if (db[lastSeenTweetId]) {
        console.log(`🟣 Last tweet (${lastSeenTweetId}) already exists in DB – stopping.`);
        console.log(`tweets length (final): ${tweets.length}`);
        return tweets.slice(0, maxTweets);
      }

      await page.evaluate(() => window.scrollBy(0, 2000));
      await new Promise(resolve => setTimeout(resolve, 3000));

    }

    console.log(`tweets length: ${tweets.length}`);

    if (tweets.length >= maxTweets) break;
  }
  return tweets.slice(0, maxTweets);
}

async function captureTweetThreadImproved(page, tweetObj, db, dbBasename) {
  logCurrentFunctionName();

  const SCREENSHOTS_DIRNAME = 'screenshots';

  async function RemovePostBanner(page) {
    logCurrentFunctionName(true);

    const found = await page.evaluate(() => {
      const banners = [];

      [...document.querySelectorAll('h2 span')].forEach(span => {
        const text = span.innerText.trim();
        if (text !== 'Post') return;

        const outermost = span.closest('div')?.parentElement?.parentElement?.parentElement;
        if (!outermost) return;

        const rect = outermost.getBoundingClientRect();
        const style = getComputedStyle(outermost);
        const alpha = parseFloat(style.backgroundColor.split(',')[3]) || 1;

        const isTopPinned = rect.top < 30;
        const isOverlay = alpha < 0.95;

        if (isTopPinned && isOverlay) {
          outermost.setAttribute('data-found-banner', 'true');
          outermost.style.outline = '3px solid lime';
          banners.push({
            tag: outermost.tagName,
            class: outermost.className,
            top: rect.top,
            alpha: alpha.toFixed(2),
          });
        }
      });

      // 🩹 הסרת כפתור Follow אם קיים
      const followButtons = [...document.querySelectorAll('button[aria-label^="Follow"]')];
      if (followButtons.length > 0) {
        followButtons.forEach(btn => {
          const wrapper = btn.closest('div.css-175oi2r');
          if (wrapper) wrapper.style.display = 'none';
        });
      }

      return banners;
    });

    if (found.length === 0) {
      console.log(`\t🔴 No Post overlay found!`);
      return;
    }

    console.log(`\t🟢 Found Post banner:`);

    await page.evaluate(() => {
      const targets = [...document.querySelectorAll('[data-found-banner="true"]')];
      targets.forEach(el => {
        el.dataset.hiddenBy = 'post-remover';
        el.style.display = 'none';
      });
    });

    console.log(`\t✅ Removed Post banner overlay`);
  }
  async function injectRepostedBanner(page, name) {
    logCurrentFunctionName(true);

    const result = await page.evaluate((name) => {
      const placeholder = document.querySelector('article')?.firstElementChild?.firstElementChild?.children[0];
      if (!placeholder) return '\t❌ placeholder was not found!';

      const rawHTML = `<div class="css-175oi2r r-18u37iz" data-reposted-candidate="true" style="margin-bottom: 4px;"><div class="css-175oi2r r-18kxxzh r-1wron08 r-onrtq4 r-obd0qt r-1777fci"><svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-dnmrzs r-bnwqim r-lrvibr r-m6rgpd r-14j79pv r-10ptun7 r-1janqcz"><g><path d="M4.75 3.79l4.603 4.3-1.706 1.82L6 8.38v7.37c0 .97.784 1.75 1.75 1.75H13V20H7.75c-2.347 0-4.25-1.9-4.25-4.25V8.38L1.853 9.91.147 8.09l4.603-4.3zm11.5 2.71H11V4h5.25c2.347 0 4.25 1.9 4.25 4.25v7.37l1.647-1.53 1.706 1.82-4.603 4.3-4.603-4.3 1.706-1.82L18 15.62V8.25c0-.97-.784-1.75-1.75-1.75z"></path></g></svg></div><div class="css-175oi2r r-1iusvr4 r-16y2uox"><div class="css-175oi2r r-18u37iz"><div class="css-175oi2r r-1habvwh r-1wbh5a2 r-1777fci"><div class="css-175oi2r"><a href="/${name.replace(/\s+/g, '')}" dir="ltr" role="link" class="css-146c3p1 r-bcqeeo r-1ttztb7 r-qvutc0 r-37j5jr r-a023e6 r-rjixqe r-16dba41 r-1loqt21" style="color: rgb(83, 100, 113);"><span class="css-1jxf684 r-8akbws r-krxsd3 r-dnmrzs r-1udh08x r-1udbk01 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3 r-n6v787 r-1cwl3u0 r-b88u0q" data-testid="socialContext" style="-webkit-line-clamp: 2; color: rgb(83, 100, 113);"><span dir="ltr" class="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3"><span class="css-1jxf684 r-bcqeeo r-1ttztb7 r-qvutc0 r-poiln3">${name}</span></span> reposted</span></a></div></div></div></div></div>`;

      placeholder.innerHTML = rawHTML;
      return "\t💉 Injection's done";
    }, name);

    console.log(result);
  }
  async function addWatermark(inputPath, watermarkPath, opacity = 0.3) {
    logCurrentFunctionName(true);

    const watermarkLib = require('image-video-watermark').default;

    const options = {
      position: 'top-right',
      margin: 2,
      opacity,
      watermarkScalePercentage: 4.4
    };

    try {
      const result = await watermarkLib(inputPath, watermarkPath, options);
      fs.writeFileSync(inputPath, result.buffer); // Overwrite the original
      console.log(`\t💧 Watermark added`);
    } catch (error) {
      console.error(`\t❌ Error: ${error.message}`);
    }
  }
  
  const { tweetKey, tweetId, href, isRepost, retweeterUsername, retweeterName, tweetUsername } = tweetObj;

  console.log(`📸 Capturing tweet: ${href}`);
  const url = `https://x.com${href}`;
  await safeGoto(page, url, 30000);
  
  try {
    await page.waitForFunction((tweetId) => {
    const articles = Array.from(document.querySelectorAll('article'));
    return articles.some(article => {
      const timeHref = article.querySelector('time')?.closest('a')?.getAttribute('href') || '';
      const allHrefs = Array.from(article.querySelectorAll('a')).map(a => a.getAttribute('href') || '');
      return timeHref.includes(tweetId) || allHrefs.some(h => h.includes(tweetId));
      });
    }, { timeout: 30000 }, tweetId);

    console.log(`✅ Target <article> found`);
    await page.evaluate(async (tweetId) => {
      // מאתר את ה-article לפי tweetId (ללא גלילה וללא שינוי)
      const art = [...document.querySelectorAll('article')].find(a => {
        const timeHref = a.querySelector('time')?.closest('a')?.getAttribute('href') || '';
        const allHrefs = [...a.querySelectorAll('a')].map(x => x.getAttribute('href') || '');
        return timeHref.includes(tweetId) || allHrefs.some(h => h.includes(tweetId));
      });
      if (!art) throw new Error('article not found');

      // 1) ודאות שפונטים נטענו
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      // 2) כל ה-IMG בתוך ה-article דקודו (decode → מוכן לציור)
      const imgs = [...art.querySelectorAll('img')];
      await Promise.all(imgs.map(img => (img.decode ? img.decode().catch(()=>{}) : Promise.resolve())));
        // גם וידוא מצב טעינה בסיסי
        if (!imgs.every(i => i.complete && i.naturalWidth > 0 && i.naturalHeight > 0)) {
          throw new Error('images not fully ready');
      }

      // 3) CSS background-image: אוספים URL-ים מכל הצאצאים, טוענים לדפדפן, ממתינים ל-decode (ללא הצמדה ל-DOM)
      const urls = new Set();
      const collectBg = (el) => {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundImage;
        if (bg && bg !== 'none') {
          const m = [...bg.matchAll(/url\((["']?)(.*?)\1\)/g)];
          m.forEach(x => urls.add(x[2]));
        }
      };
      const allNodes = [art, ...art.querySelectorAll('*')];
      allNodes.forEach(collectBg);
      await Promise.all([...urls].map(u => new Promise((res) => {
        const im = new Image();
        im.onload = im.onerror = () => res();
        im.src = u;
      })));

      // 4) שני RAF ברצף → מבטיחים שהדפדפן צייר אחרי decode
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, tweetId);

  } catch {
    console.warn(`❌ Timeout waiting for <article> with tweetId=${tweetId}`);

    const currentTimeout = db[tweetKey].articleTimeout || 0;
    db[tweetKey].articleTimeout = currentTimeout + 1;

    console.log(`🔁 Marking tweet ${tweetKey} with articleTimeout = ${db[tweetKey].articleTimeout}`);
    saveDB(db, dbBasename);

    return null;
  }

  if (!fs.existsSync(SCREENSHOTS_DIRNAME)) fs.mkdirSync(SCREENSHOTS_DIRNAME);

  const fontSize = '24px';

  await page.evaluate((fontSize, fontFamily) => {
    if (!document.querySelector('#__custom_font_patch')) {
      const style = document.createElement('style');
      style.id = '__custom_font_patch';
    style.innerHTML = `
      [data-testid="tweetText"],
      [data-testid="tweetText"] *,
      [data-testid="app-text-transition-container"],
      [data-testid="app-text-transition-container"] *,
      time,
      time *,

      [data-testid="tweet"] article article,
      [data-testid="tweet"] article article *,

      [data-testid="like"],
      [data-testid="retweet"],
      [data-testid="viewCount"],
      [data-testid="reply"] {
        font-size: ${fontSize} !important;
        font-family: "${fontFamily}" !important;
      }
    `;
      document.head.appendChild(style);
    }
  }, fontSize, "Noto Sans Hebrew");

  const baseUsername = isRepost ? `${retweeterUsername}_RT_of_${tweetUsername}` : tweetUsername;
  const filename = `tweet_${baseUsername}_${tweetId}.png`;
  const filepath = path.join(SCREENSHOTS_DIRNAME, filename);

  if (fs.existsSync(filepath)) {
    console.log(`🟠 Screenshot already exists: ${filepath}`);
    db[tweetKey].screenshot_path = filepath;;
  }

  const unionClip = await page.evaluate((tweetId) => {
    const articles = Array.from(document.querySelectorAll('article'));
    const targetIndex = articles.findIndex(a => {
      const href = a.querySelector('time')?.closest('a')?.getAttribute('href') || '';
      const allHrefs = Array.from(a.querySelectorAll('a')).map(a => a.getAttribute('href') || '');
      return href.includes(tweetId) || allHrefs.some(h => h.includes(tweetId));
    });

    if (targetIndex === -1) return null;

    const main = articles[targetIndex];
    const maybePrev = articles[targetIndex - 1] || null;

    const mainRect = main.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, Math.round(mainRect.top + window.scrollY)));

    return new Promise(resolve => {
      setTimeout(() => {
        const engagementFromMain = main.querySelector('[data-testid="like"]')?.closest('div[role="group"]');
        if (!engagementFromMain) {
          console.warn('❌ engagement banner was not found!');
          resolve(null);
          return;
        }

        const visibleArticles = articles
        .slice(0, targetIndex + 1)
        .map((a, i) => {
          const rect = a.getBoundingClientRect();
          return { el: a, top: rect.top, index: i, fullText: a.innerText.slice(0, 100) };
        })
        .filter(a => a.top < window.innerHeight);

        const topMost = visibleArticles.reduce((min, a) =>
          a.top < min.top ? a : min
        , visibleArticles[0]);

        const topRect = (maybePrev || main).getBoundingClientRect();
        const engagementRect = engagementFromMain.getBoundingClientRect();

        const scrollY = Math.max(0, Math.round(topRect.top + window.scrollY));
        const height = Math.round(
          (engagementRect.top + engagementRect.height + window.scrollY) - (topRect.top + window.scrollY)
        );

        resolve({
          clipX: Math.round(topRect.left),
          clipY: scrollY,
          clipWidth: Math.round(topRect.width),
          clipHeight: height
        });
      }, 3000);
    });
  }, tweetId);

  if (!unionClip) {
    console.warn('❌ unionClip failed!');
    return false;
  }

  await page.evaluate(y => {
    window.scrollTo(0, y);
  }, unionClip.clipY);

  await page.evaluate(y => window.scrollTo(0, y), unionClip.clipY);
  await page.waitForTimeout(300);

  await RemovePostBanner(page);
  if (isRepost) await injectRepostedBanner(page, retweeterName);

  const pageMetrics = await page.evaluate(() => ({
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
    bodyScrollHeight: document.body.scrollHeight,
    documentHeight: document.documentElement.scrollHeight,
    viewportBottom: window.scrollY + window.innerHeight,
  }));
  // console.log("📏 Page Metrics:", pageMetrics);
  // console.log("📐 unionClip:", unionClip);

  // ----- Remove "Show translation" button (new UI) -----
  await page.evaluate(() => {
    // מוצא כפתורים חדשים
    const btns = document.querySelectorAll('button[aria-label="Show translation"]');

    btns.forEach(btn => {
      // נסיר רק את ה-SVG והכפתור עצמו — לא את ה-div העוטף!
      const svg = btn.parentElement?.querySelector('svg');
      if (svg) svg.remove();

      btn.remove();

      // סימון לפיקוח (לוג בתוך הדומ בלבד)
      btn.parentElement?.setAttribute('data-stripped-show-translation', 'true');
    });

    console.log(`🔹 Removed ${btns.length} "Show translation" button(s)`);
  });

  await page.evaluate(() => {
    // מציאת כפתורי "Grok actions"
    const grokButtons = document.querySelectorAll('button[aria-label="Grok actions"]');

    grokButtons.forEach(btn => {
      const wrapper = btn.closest('div.css-175oi2r');
      if (wrapper) {
        wrapper.style.display = 'none';
        wrapper.dataset.grokRemoved = 'true';
      }
    });

    console.log(`🧹 Removed ${grokButtons.length} Grok action block(s)`);
  });

  await page.screenshot({
    path: filepath,
    clip: {
      x: unionClip.clipX,
      y: unionClip.clipY,
      width: unionClip.clipWidth,
      height: unionClip.clipHeight
    }
  });

  console.log(`🖼️ screenshot saved: ${filepath}`);
  db[tweetKey].screenshot_path = filepath;
  saveDB(db, dbBasename);
  await addWatermark(filepath, './watermarking/watermark555.png', 0.3);
}

async function initBrowserPool(lists) {
  logCurrentFunctionName(true);

  const userDataDir = '/tmp/clean-profile';
  if (fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  // Load cookies once
  const cookiesRaw = JSON.parse(fs.readFileSync('./x_cookies.json', 'utf-8'));
  const cookies = Array.isArray(cookiesRaw)
    ? cookiesRaw
    : Object.entries(cookiesRaw).map(([name, value]) => ({
        name,
        value,
        url: 'https://x.com'
      }));

  const browser = await puppeteer.launch({
    headless: headless,
    devtools: false,
    args: [
      '--no-sandbox',
      `--user-data-dir=${userDataDir}`,
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion'
    ]
  });

  const pagesMap = {};

  // Primary page — load cookies + verify login once
  const primaryPage = await browser.newPage();
  await primaryPage.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );
  await primaryPage.setViewport({ width: 650, height: 3000 });
  await primaryPage.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
  await primaryPage.setCookie(...cookies);
  await safeGoto(primaryPage, 'https://x.com', 30000); // warm-up session
  await verifyLogin(primaryPage);

  // Create a tab for each list (inherits cookies automatically)
  for (const l of lists) {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 650, height: 3000 });
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    pagesMap[l.key] = page;
    console.log(`🧭 Tab ready → ${l.key}`);
  }

  await primaryPage.close();

  // === Tab rotation to keep Chromium rendering all lists ===
  (async () => {
    const listKeys = Object.keys(pagesMap);
    let i = 0;
    while (true) {
      try {
        const key = listKeys[i % listKeys.length];
        if (pagesMap[key] && !pagesMap[key].isClosed()) {
          await pagesMap[key].bringToFront();
          console.log(`🪄 Focus switched to: ${key}`);
        }
      } catch (err) {
        console.warn(`⚠️ Tab focus failed: ${err.message}`);
      }
      i++;
      await new Promise(r => setTimeout(r, 5000)); // rotate every 5s
    }
  })();

  return { browser, pagesMap };
}

async function processList(list, page) {
  console.log(`\n🗂️ Working on list: ${list.name}  -  ${list.url}`);

  console.log(`[processList]: CURRENT_DB_BASE set to ${list.dbBasename}`);
  console.log(`[processList]: CURRENT_CHAT_ID set to ${list.chatId}`);

  const db = loadDB(false, list.dbBasename);

  const tweetObjs = await extractTweetsFromFeed(page, list.url, db);
  registerNewTweets(db, tweetObjs, list.dbBasename);

  const unsentTweets = Object.entries(db)
    .filter(([_, t]) =>
      ((t.was_sent_to_telegram === false) || (t.was_sent_to_whatsapp === false)) &&
      (t.articleTimeout ?? 0) < 2
    )
    .map(([tweetKey, t]) => ({ tweetKey, ...t }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const totalPendingSends = unsentTweets.reduce((sum, t) => {
    let count = 0;
    if (!t.was_sent_to_telegram) count++;
    if (!t.was_sent_to_whatsapp) count++;
    return sum + count;
  }, 0);

  console.log(`📤 Pending send actions for "${list.key}": ${totalPendingSends}`);
  let i = totalPendingSends;

  for (const tweet of unsentTweets) {
    // console.log(`${i} tweets left for "${list.key}"`);
    if (!tweet.screenshot_path) await captureTweetThreadImproved(page, tweet, db, list.dbBasename);

    if (!tweet.was_sent_to_telegram) {
      await sendToTelegram(db[tweet.tweetKey], db, list.dbBasename, list.chatId);
      i--;
    }

    // if (!tweet.was_sent_to_whatsapp) {
    //   await sendToWhatsapp(db[tweet.tweetKey], db, list.dbBasename, list.whatsappGroup);
    //   i--;
    // }
    console.log(`📦 ${i} send actions left`);
  }
}

async function main() {
  logCurrentFunctionName();

  // if (!whatsappClient) {
  //   console.log('💬 Initializing WhatsApp client...');
  //   whatsappClient = await initWhatsappClient();
  // }

  const lists = loadListsConfig().filter(l => l.active);
  console.log(`🧩 Multi-list run: ${lists.length} active list(s)`);

  const { browser, pagesMap } = await initBrowserPool(lists);
  globalBrowser = browser;

  const STAGGER_MS = 1200; // 1.2s between list starts
  await Promise.all(
    lists.map((list, idx) => (async () => {
      const page = pagesMap[list.key];
      // await sleep(idx * STAGGER_MS);  // stagger start
      console.log(`🚀 Starting list=${list.key} after ${idx * STAGGER_MS}ms`);
      // page.on('console', msg => {
      //   const type = msg.type();
      //   console.log(`🧠 [${list.key}][${type}] ${msg.text()}`);
      // });
      try {
        await processList(list, page);
        console.log(`✅ Finished list=${list.key}`);
      } catch (err) {
        console.error(`❌ Error list=${list.key}:`, err);
      }
    })())
  );
  await browser.close();
}

async function safeMainWrapper() {
  logCurrentFunctionName();

  while (true) {
    try {
      console.log("🌀 Starting main run...");
      await main();
      console.log("🌀 reStarting main in 30 seconds...");
      await new Promise((resolve) => { setTimeout(resolve, 30000); });
    } catch (err) {
      console.error("❌ Unhandled error in main():", err.message);
      console.warn("♻️  Restarting browser and main() in 5 seconds...");
      await new Promise(res => setTimeout(res, 5000));
    } finally {
      if (globalBrowser) {
        try {
          await globalBrowser.close();
          console.log('✅ Browser closed');
        } catch (e) {
          console.warn('⚠️ Failed to close browser in finally:', e.message);
        } finally {
          globalBrowser = null;
        }
      }
    }
  }
}

headless = true;
safeMainWrapper();