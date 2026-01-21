const fs = require('fs');
const path = require('path');

const REQUIRED = ['key','name','list_id','url','db_basename','telegram_chat_id'];

function fail(msg){ console.error('❌', msg); process.exit(2); }
function warn(msg){ console.warn('⚠️', msg); }

function validateOne(item, i){
  for (const f of REQUIRED){
    if (!(f in item)) fail(`lists[${i}] missing required field: ${f}`);
    if (typeof item[f] !== 'string' && !['last_seen_tweet_id'].includes(f))
      fail(`lists[${i}].${f} must be string`);
  }
  if (!/^https:\/\/x\.com\/i\/lists\/\d+/.test(item.url))
    fail(`lists[${i}].url must look like https://x.com/i/lists/<ID>`);
  if (!/^\d+$/.test(item.list_id))
    fail(`lists[${i}].list_id must be digits only`);

  const normalized = {
    key: item.key.trim(),
    name: item.name.trim(),
    listId: item.list_id.trim(),
    url: item.url.trim().replace(/\/members\/?$/,''),
    dbBase: item.db_basename.trim(),
    chatId: item.telegram_chat_id.trim(),
    lastSeenTweetId: item.last_seen_tweet_id ?? null,
    active: item.active !== false // default true
  };
  return normalized;
}

(function main(){
  const p = path.join(__dirname, '.', 'config', 'lists.json');
  if (!fs.existsSync(p)) fail(`config file not found: ${p}`);
  const raw = fs.readFileSync(p, 'utf-8');
  let arr;
  try { arr = JSON.parse(raw); }
  catch(e){ fail(`JSON parse error: ${e.message}`); }

  if (!Array.isArray(arr) || arr.length === 0) fail('lists.json must be a non-empty array');

  const seenKeys = new Set();
  const out = [];
  arr.forEach((it,i) => {
    const n = validateOne(it,i);
    if (seenKeys.has(n.key)) fail(`duplicate key: ${n.key}`);
    seenKeys.add(n.key);
    out.push(n);
  });

  // דו"ח קצר
  console.log('✅ lists.json OK');
  out.forEach((l,idx) => {
    console.log(`${idx+1}. key=${l.key} name=${l.name} url=${l.url} db=${l.dbBase} chat=${l.chatId} active=${l.active}`);
  });

  // פלט JSON מנורמל לשימוש עתידי (צינור ל-main אם נרצה)
  console.log('---NORMALIZED_JSON_START---');
  process.stdout.write(JSON.stringify(out, null, 2));
  console.log('\n---NORMALIZED_JSON_END---');
})();
