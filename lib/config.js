const fs = require('fs');
const path = require('path');

function fail(msg){ throw new Error(msg); }

function loadListsConfig() {
  const p = path.join(__dirname, '..', 'config', 'lists.json');
  if (!fs.existsSync(p)) fail(`config file not found: ${p}`);
  let arr;
  try { arr = JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch(e){ fail(`JSON parse error: ${e.message}`); }
  if (!Array.isArray(arr) || arr.length === 0) fail('lists.json must be a non-empty array');

  const REQUIRED = ['key','name','list_id','url','db_basename','telegram_chat_id'];
  const seen = new Set();
  const out = arr.map((item, i) => {
    for (const f of REQUIRED) {
      if (!(f in item)) fail(`lists[${i}] missing required field: ${f}`);
      if (typeof item[f] !== 'string' && f !== 'last_seen_tweet_id') {
        fail(`lists[${i}].${f} must be string`);
      }
    }
    if (!/^https:\/\/x\.com\/i\/lists\/\d+/.test(item.url))
      fail(`lists[${i}].url must look like https://x.com/i/lists/<ID>`);
    if (!/^\d+$/.test(item.list_id))
      fail(`lists[${i}].list_id must be digits only`);

    const n = {
      key: item.key.trim(),
      name: item.name.trim(),
      listId: item.list_id.trim(),
      url: item.url.trim().replace(/\/members\/?$/,''),
      dbBasename: item.db_basename.trim(),
      chatId: item.telegram_chat_id.trim(),
      whatsappGroup: item.whatsappGroup.trim(),
      lastSeenTweetId: item.last_seen_tweet_id ?? null,
      active: item.active !== false
    };
    if (seen.has(n.key)) fail(`duplicate list key: ${n.key}`);
    seen.add(n.key);
    return n;
  });

  return out;
}

module.exports = { loadListsConfig };
