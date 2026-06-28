// ─────────────────────────────────────────────────────────
//  GlobalPulse Bot v6.1 — Entry Point
//  /start → inline region buttons (no news flood)
//  Tap a region → get that region's full digest
//  Tap "Browse by Topic" → topic buttons
// ─────────────────────────────────────────────────────────

require('dotenv').config();
const express = require('express');
const cron    = require('node-cron');

const { fetchAllFeeds }                        = require('./fetcher');
const { filterArticles }                       = require('./filter');
const { REGIONS }                              = require('./feeds');
const { pollCommands, sendRegionMenu,
        sendTopicMenu, sendText, sendDigest }  = require('./telegram');
const { verifyWebhook, parseInbound,
        isEnabled: waEnabled }                 = require('./whatsapp');
const { broadcastDigest, broadcastAlert }      = require('./broadcaster');
const tracker                                  = require('./tracker');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

app.get('/health', (_req, res) => res.json({
  status: 'ok', time: new Date().toISOString(),
  telegram: !!process.env.TELEGRAM_BOT_TOKEN ? 'enabled' : 'missing',
  whatsapp: waEnabled() ? 'enabled' : 'disabled',
}));

app.get('/webhook',  (req, res) => waEnabled() ? verifyWebhook(req, res) : res.sendStatus(404));
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  if (!waEnabled()) return;
  const msg = parseInbound(req.body);
  if (msg) await handleCommand(msg.text, null, msg.from);
});

// ── Command maps ──────────────────────────────────────────
const REGION_CMDS = {
  '/kenya':  'kenya',
  '/africa': 'africa',
  '/usa':    'usa',
  '/europe': 'europe',
  '/china':  'china',
  '/japan':  'japan',
  '/korea':  'korea',
};

const TOPIC_CMDS = {
  '/politics':   'politics',
  '/tech':       'technology',
  '/innovation': 'innovation',
  '/business':   'business',
  '/agri':       'agriculture',
  '/edu':        'education',
  '/startup':    'startup',
  '/research':   'research',
  '/finance':    'finance',
  '/invest':     'investment',
  '/jobs':       'jobs',
};

// ── 10-min article cache ──────────────────────────────────
let _cache = null, _cacheTime = 0;
async function getArticles() {
  if (_cache && Date.now() - _cacheTime < 10 * 60 * 1000) return _cache;
  _cache = await fetchAllFeeds();
  _cacheTime = Date.now();
  return _cache;
}

// ── Command handler ───────────────────────────────────────
async function handleCommand(text, tgChatId = null, waPhone = null) {
  const cmd = (text || '').toLowerCase().split(/\s+/)[0];
  console.log(`📩 Command: ${cmd}`);

  // ── /start, /news, /help → show region picker (no flood) ──
  if (['/start', '/news', '/help'].includes(cmd)) {
    if (tgChatId) await sendRegionMenu(tgChatId);
    // WhatsApp: send a plain text menu since it has no inline buttons
    if (waPhone) {
      const waMenu =
        `🌐 *GlobalPulse* — Reply with a region or topic:\n\n` +
        `*Regions*\n/kenya /africa /usa /europe /china /japan /korea /world\n\n` +
        `*Topics*\n/politics /tech /innovation /business /agri /edu /startup /research /finance /invest /jobs`;
      const wa = require('./whatsapp');
      await wa.sendText(waMenu, waPhone);
    }
    return;
  }

  // ── Region command ─────────────────────────────────────
  if (REGION_CMDS[cmd]) {
    const region   = REGION_CMDS[cmd];
    const meta     = REGIONS[region];
    const label    = `${meta.emoji} ${meta.label}`;

    if (tgChatId) {
      await sendText(`⏳ Fetching <b>${label}</b> news…`, tgChatId);
    }

    const filtered = filterArticles(await getArticles(), region);
    await broadcastDigest(filtered, tgChatId, waPhone, label);
    return;
  }

  // ── Topic command ──────────────────────────────────────
  if (TOPIC_CMDS[cmd]) {
    const cat   = TOPIC_CMDS[cmd];
    const label = cmd.replace('/', '');

    if (tgChatId) {
      await sendText(`⏳ Fetching <b>${label}</b> news (all regions)…`, tgChatId);
    }

    const filtered = filterArticles(await getArticles());
    await broadcastDigest({ [cat]: filtered[cat] || [] }, tgChatId, waPhone);
    return;
  }

  // ── /world — all regions ───────────────────────────────
  if (cmd === '/world') {
    if (tgChatId) await sendText('⏳ Fetching <b>World</b> news…', tgChatId);
    const filtered = filterArticles(await getArticles());
    await broadcastDigest(filtered, tgChatId, waPhone, '🌐 World');
    return;
  }

  // ── Unknown → show menu ────────────────────────────────
  if (tgChatId) await sendRegionMenu(tgChatId);
}

// ── Telegram long-poll loop ───────────────────────────────
let tgOffset = 0;
async function telegramLoop() {
  while (true) {
    const { offset, backoff } = await pollCommands(tgOffset, (chatId, text) =>
      handleCommand(text, chatId, null)
    );
    tgOffset = offset;
    if (backoff > 0) await new Promise(r => setTimeout(r, backoff));
  }
}
telegramLoop().catch(err => console.error('❌ TG loop:', err.message));

// ── Scheduled digests (EAT) ───────────────────────────────

// Every 30 min — Kenya real-time alerts
cron.schedule('*/30 * * * *', async () => {
  const ts = new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  console.log(`\n⏱  [${ts}] 30-min poll...`);
  try {
    _cache = null;
    const filtered = filterArticles(await getArticles(), 'kenya');
    let count = 0;
    for (const [cat, items] of Object.entries(filtered)) {
      for (const article of tracker.filterNew(items)) {
        await broadcastAlert(article, cat);
        await new Promise(r => setTimeout(r, 600));
        count++;
      }
    }
    console.log(`   ✅ ${count} alerts | tracker: ${tracker.size}`);
  } catch (err) { console.error('❌ Poll failed:', err.message); }
}, { timezone: 'Africa/Nairobi' });

// 7:00 AM — Kenya digest
cron.schedule('0 4 * * *', async () => {
  console.log('\n📰 Daily Kenya digest...');
  try {
    _cache = null;
    const filtered = filterArticles(await getArticles(), 'kenya');
    await broadcastDigest(filtered, null, null, '🇰🇪 Kenya');
    Object.values(filtered).flat().forEach(a => tracker.isNew(a));
  } catch (err) { console.error('❌ Kenya digest failed:', err.message); }
}, { timezone: 'Africa/Nairobi' });

// 7:30 AM — Africa digest
cron.schedule('30 4 * * *', async () => {
  console.log('\n📰 Daily Africa digest...');
  try {
    const filtered = filterArticles(await getArticles(), 'africa');
    await broadcastDigest(filtered, null, null, '🌍 Africa');
  } catch (err) { console.error('❌ Africa digest failed:', err.message); }
}, { timezone: 'Africa/Nairobi' });

// 8:00 AM — Global Tech, Innovation & Business
cron.schedule('0 5 * * *', async () => {
  console.log('\n🌐 Daily global digest...');
  try {
    const filtered = filterArticles(await getArticles());
    await broadcastDigest(
      { technology: filtered.technology, innovation: filtered.innovation,
        business: filtered.business, startup: filtered.startup, research: filtered.research },
      null, null, '🌐 Global Tech & Business'
    );
  } catch (err) { console.error('❌ Global digest failed:', err.message); }
}, { timezone: 'Africa/Nairobi' });

// 9:00 AM Mondays — Weekly Reports
cron.schedule('0 6 * * 1', async () => {
  console.log('\n📊 Weekly reports digest (Monday)...');
  try {
    const filtered = filterArticles(await getArticles());
    await broadcastDigest(
      { research: filtered.research, business: filtered.business,
        agriculture: filtered.agriculture, education: filtered.education },
      null, null, '📊 Weekly Reports & Research'
    );
  } catch (err) { console.error('❌ Weekly reports failed:', err.message); }
}, { timezone: 'Africa/Nairobi' });

app.listen(PORT, () => {
  console.log(`\n🌐 GlobalPulse Bot v6.1 on port ${PORT}`);
  console.log(`📱 Telegram: inline buttons | 💬 WhatsApp: ${waEnabled() ? 'enabled' : 'disabled'}`);
  console.log(`🗺  8 regions | 11 topics | /start → region picker\n`);
});

if (process.env.RUN_ON_START === 'true') {
  (async () => {
    const filtered = filterArticles(await getArticles(), 'kenya');
    await broadcastDigest(filtered, null, null, '🇰🇪 Kenya');
  })().catch(console.error);
}
