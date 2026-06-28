// ─────────────────────────────────────────────────────────
//  GlobalPulse Bot — Telegram Notifier  v6.0
//  • /start → clickable region & topic menu (inline keyboard)
//  • Tapping a region button fetches only that region's news
//  • callback_query handled in pollCommands
// ─────────────────────────────────────────────────────────

require('dotenv').config();
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const BASE_URL  = () => `https://api.telegram.org/bot${BOT_TOKEN}`;

const SECTION_META = {
  politics:    { emoji: '🏛️',  label: 'Politics & Governance'   },
  technology:  { emoji: '💻',  label: 'Technology'               },
  innovation:  { emoji: '🚀',  label: 'Innovation & R&D'         },
  business:    { emoji: '💼',  label: 'Business & Companies'     },
  agriculture: { emoji: '🌾',  label: 'Agriculture & Food'       },
  education:   { emoji: '🎓',  label: 'Education'                },
  startup:     { emoji: '🌱',  label: 'Startups & Funding'       },
  research:    { emoji: '🔬',  label: 'Research & Science'       },
  finance:     { emoji: '💰',  label: 'Finance & Economy'        },
  investment:  { emoji: '📈',  label: 'Investment & Markets'     },
  jobs:        { emoji: '🗂️',  label: 'Jobs & Careers'           },
};

const MAX_PER_SECTION = 5;
const MSG_LIMIT       = 3800;
const EXCERPT_LEN     = 180;

// ── Inline keyboard layouts ───────────────────────────────

/** Region picker — sent on /start, /help, or unknown command */
const REGION_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🇰🇪 Kenya',       callback_data: '/kenya'  },
      { text: '🌍 Africa',       callback_data: '/africa' },
    ],
    [
      { text: '🇺🇸 USA',         callback_data: '/usa'    },
      { text: '🇪🇺 Europe',      callback_data: '/europe' },
    ],
    [
      { text: '🇨🇳 China',       callback_data: '/china'  },
      { text: '🇯🇵 Japan',       callback_data: '/japan'  },
    ],
    [
      { text: '🇰🇷 S. Korea',    callback_data: '/korea'  },
      { text: '🌐 World',        callback_data: '/world'  },
    ],
    [
      { text: '📂 Browse by Topic →', callback_data: '__topics__' },
    ],
  ],
};

/** Topic picker — shown when user taps "Browse by Topic" */
const TOPIC_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '🏛️ Politics',    callback_data: '/politics'   },
      { text: '💻 Tech',        callback_data: '/tech'        },
    ],
    [
      { text: '🚀 Innovation',  callback_data: '/innovation'  },
      { text: '💼 Business',    callback_data: '/business'    },
    ],
    [
      { text: '🌾 Agriculture', callback_data: '/agri'        },
      { text: '🎓 Education',   callback_data: '/edu'         },
    ],
    [
      { text: '🌱 Startups',    callback_data: '/startup'     },
      { text: '🔬 Research',    callback_data: '/research'    },
    ],
    [
      { text: '💰 Finance',     callback_data: '/finance'     },
      { text: '📈 Invest',      callback_data: '/invest'      },
    ],
    [
      { text: '🗂️ Jobs',        callback_data: '/jobs'        },
    ],
    [
      { text: '← Back to Regions', callback_data: '__regions__' },
    ],
  ],
};

// ── Helpers ───────────────────────────────────────────────

function escapeHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function excerpt(article) {
  const raw = (article.summary || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > EXCERPT_LEN
    ? raw.slice(0, EXCERPT_LEN).replace(/\s\S*$/, '') + '…'
    : raw;
}

// ── Core send functions ───────────────────────────────────

async function sendText(text, chatId = CHAT_ID, extra = {}) {
  if (!BOT_TOKEN || !chatId) { console.log('[TG]', text.slice(0, 80)); return; }
  try {
    await axios.post(`${BASE_URL()}/sendMessage`, {
      chat_id: chatId, text, parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  } catch (err) {
    console.error(`❌ TG send: ${err.response?.data?.description || err.message}`);
  }
}

/** Send the region picker menu */
async function sendRegionMenu(chatId = CHAT_ID) {
  await sendText(
    '🌐 <b>GlobalPulse</b> — Choose a region to get today\'s news:',
    chatId,
    { reply_markup: REGION_KEYBOARD }
  );
}

/** Send the topic picker menu */
async function sendTopicMenu(chatId = CHAT_ID) {
  await sendText(
    '📂 <b>GlobalPulse</b> — Choose a topic (all regions):',
    chatId,
    { reply_markup: TOPIC_KEYBOARD }
  );
}

/** Answer a callback_query so Telegram removes the loading spinner */
async function answerCallback(callbackQueryId, text = '') {
  if (!BOT_TOKEN) return;
  try {
    await axios.post(`${BASE_URL()}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    });
  } catch (_) { /* non-critical */ }
}

// ── Digest formatting ─────────────────────────────────────

function formatArticle(i, a) {
  const time = new Date(a.pubDate).toLocaleTimeString('en-KE', {
    timeZone: 'Africa/Nairobi', timeStyle: 'short',
  });
  const snip = excerpt(a);
  let e = `${i + 1}. <a href="${a.link}">${escapeHtml(a.title)}</a>\n`;
  e    += `   <i>${escapeHtml(a.source)} • ${time}</i>\n`;
  if (snip) e += `   ${escapeHtml(snip)}\n`;
  return e + '\n';
}

async function sendDigest(categorised, chatId = CHAT_ID, regionLabel = null) {
  const now   = new Date().toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi', dateStyle: 'full', timeStyle: 'short',
  });
  const total = Object.values(categorised).reduce((n, arr) => n + (arr || []).length, 0);

  if (total === 0) {
    await sendText('ℹ️ No recent articles found for this selection.', chatId);
    // Re-show the menu after an empty result
    await sendRegionMenu(chatId);
    return;
  }

  const title   = regionLabel ? `${regionLabel} News Digest` : '🌐 GlobalPulse Digest';
  let current   = `<b>${title}</b>\n${now}\n${total} stories\n${'─'.repeat(30)}\n`;
  const chunks  = [];

  for (const [key, meta] of Object.entries(SECTION_META)) {
    const articles = (categorised[key] || []).slice(0, MAX_PER_SECTION);
    if (!articles.length) continue;
    let section = `\n${meta.emoji} <b>${meta.label}</b>\n`;
    articles.forEach((a, i) => { section += formatArticle(i, a); });
    if ((current + section).length > MSG_LIMIT) { chunks.push(current); current = section; }
    else current += section;
  }

  if (current.trim()) chunks.push(current);

  for (const msg of chunks) {
    await sendText(msg.trim(), chatId);
    await new Promise(r => setTimeout(r, 400));
  }

  // After the digest, show the menu again so user can pick another region easily
  await sendRegionMenu(chatId);
}

async function sendAlert(article, category, chatId = CHAT_ID) {
  if (!BOT_TOKEN || !chatId) return;
  const meta = SECTION_META[category] || { emoji: '📰', label: category };
  const time = new Date(article.pubDate).toLocaleTimeString('en-KE', {
    timeZone: 'Africa/Nairobi', timeStyle: 'short',
  });
  const snip = excerpt(article);
  const body =
    `${meta.emoji} <b>${meta.label} Alert</b>\n\n` +
    `<a href="${article.link}">${escapeHtml(article.title)}</a>\n` +
    `<i>${escapeHtml(article.source)} • ${time}</i>` +
    (snip ? `\n\n${escapeHtml(snip)}` : '');
  try {
    await axios.post(`${BASE_URL()}/sendMessage`, {
      chat_id: chatId, text: body, parse_mode: 'HTML',
      disable_web_page_preview: false,
    });
  } catch (err) {
    console.error(`❌ TG alert: ${err.response?.data?.description || err.message}`);
  }
}

// ── Long-poll loop ────────────────────────────────────────
/**
 * Polls for both `message` updates (typed commands) and
 * `callback_query` updates (button taps).
 *
 * onCommand(chatId, text)  — called for both typed commands & button taps
 * onCallback is handled internally (answerCallback + route via onCommand)
 */
async function pollCommands(offset = 0, onCommand) {
  try {
    const res = await axios.get(`${BASE_URL()}/getUpdates`, {
      params: {
        offset,
        timeout: 20,
        allowed_updates: ['message', 'callback_query'],
      },
      timeout: 25000,
    });

    for (const update of res.data.result || []) {
      // ── Typed message ──────────────────────────────────
      if (update.message?.text) {
        const chatId = String(update.message.chat.id);
        await onCommand(chatId, update.message.text.trim());
      }

      // ── Button tap (callback_query) ────────────────────
      if (update.callback_query) {
        const cq     = update.callback_query;
        const chatId = String(cq.message?.chat?.id || cq.from.id);
        const data   = cq.data || '';

        await answerCallback(cq.id); // dismiss spinner immediately

        if (data === '__topics__') {
          // Show topic menu inline — don't route through onCommand
          const { sendTopicMenu: stm } = require('./telegram');
          await stm(chatId);
        } else if (data === '__regions__') {
          const { sendRegionMenu: srm } = require('./telegram');
          await srm(chatId);
        } else {
          // Treat the callback data as a command (e.g. "/kenya")
          await onCommand(chatId, data);
        }
      }

      offset = update.update_id + 1;
    }

    return { offset, backoff: 0 };
  } catch (err) {
    const status = err.response?.status;
    const desc   = err.response?.data?.description || err.message;

    if (status === 409) {
      console.warn('⚠  TG 409: duplicate poller — backing off 30s');
      return { offset, backoff: 30000 };
    }
    if (!desc.includes('timeout')) console.error(`❌ TG poll: ${desc}`);
    return { offset, backoff: 3000 };
  }
}

module.exports = {
  sendDigest, sendAlert, sendText,
  sendRegionMenu, sendTopicMenu,
  pollCommands,
};
