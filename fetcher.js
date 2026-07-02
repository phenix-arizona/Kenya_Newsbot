// ─────────────────────────────────────────────────────────
//  GlobalPulse Bot — Fetcher v8
//  Caps articles per source to prevent any one feed dominating
// ─────────────────────────────────────────────────────────

const axios  = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { FEEDS, MAX_PER_SOURCE } = require('./feeds');

const TIMEOUT = 15000;
const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const xmlParser = new XMLParser({
  ignoreAttributes:       false,
  attributeNamePrefix:    '@_',
  allowBooleanAttributes: true,
  parseAttributeValue:    false,
  trimValues:             true,
  cdataPropName:          '__cdata',
  isArray: (name) => ['item', 'entry', 'link'].includes(name),
});

async function fetchXml(url) {
  const res = await axios.get(url, {
    timeout: TIMEOUT,
    responseType: 'text',
    decompress: true,
    maxRedirects: 5,
    headers: {
      'User-Agent': UA,
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
  });
  return res.data;
}

function text(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (val.__cdata) return val.__cdata;
  if (val['#text']) return val['#text'];
  return '';
}

function linkHref(linkVal) {
  if (!linkVal) return '';
  if (typeof linkVal === 'string') return linkVal;
  if (Array.isArray(linkVal)) {
    const alt = linkVal.find(l => !l['@_rel'] || l['@_rel'] === 'alternate');
    return alt?.['@_href'] || linkVal[0]?.['@_href'] || '';
  }
  return linkVal['@_href'] || text(linkVal) || '';
}

// Named HTML entities commonly found in RSS feeds
const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&rsquo;': '\u2019', '&lsquo;': '\u2018', '&rdquo;': '\u201d', '&ldquo;': '\u201c',
};

/** Decode HTML entities: named (&amp;), decimal (&#8217;), and hex (&#x2019;) */
function decodeEntities(str = '') {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z]+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? entity);
}

function stripHtml(str = '') {
  return decodeEntities(str.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractSummary(item) {
  for (const key of ['content:encoded','content','summary','description','media:description']) {
    const s = stripHtml(text(item[key]));
    if (s.length > 30) return s.slice(0, 280);
  }
  return '';
}

function parseDate(raw) {
  if (!raw) return new Date();
  const d = new Date(text(raw));
  return isNaN(d.getTime()) ? new Date() : d;
}

function normalise(items, feed) {
  return items
    .filter(i => i.title)
    .slice(0, MAX_PER_SOURCE)   // ← cap per source
    .map(item => ({
      title:    stripHtml(text(item.title)).slice(0, 200),
      link:     linkHref(item.link) || text(item.guid) || text(item.id) || '',
      summary:  extractSummary(item),
      pubDate:  parseDate(item.pubDate || item['dc:date'] || item.updated || item.published),
      source:   feed.name,
      category: feed.category,
      region:   feed.region,
    }))
    .filter(a => a.title.length > 3);
}

async function fetchFeed(feed) {
  try {
    const xml    = await fetchXml(feed.url);
    const parsed = xmlParser.parse(xml);
    let items    = [];

    if (parsed?.feed?.entry)          items = normalise([].concat(parsed.feed.entry), feed);
    else if (parsed?.rss?.channel)    items = normalise([].concat(parsed.rss.channel.item || []), feed);
    else if (parsed?.['rdf:RDF'])     items = normalise([].concat(parsed['rdf:RDF'].item || []), feed);

    if (items.length === 0) console.warn(`⚠  [${feed.name}]: 0 items`);
    return items;
  } catch (err) {
    const msg = err.response?.status ? `HTTP ${err.response.status}` : err.message.split('\n')[0].slice(0, 60);
    console.warn(`⚠  [${feed.name}]: ${msg}`);
    return [];
  }
}

async function fetchAllFeeds() {
  console.log(`📡 Fetching from ${FEEDS.length} sources...`);
  const results  = await Promise.allSettled(FEEDS.map(fetchFeed));
  const all      = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  const cutoff   = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent   = all.filter(a => a.pubDate >= cutoff);
  const working  = results.filter(r => r.status === 'fulfilled' && r.value.length > 0).length;
  console.log(`📰 ${recent.length} articles (24h) | ${working}/${FEEDS.length} feeds OK`);
  return recent;
}

module.exports = { fetchAllFeeds };
