// ─────────────────────────────────────────────────────────
//  GlobalPulse Bot — Filter v7
//  Startup category added, strict title-anchoring
// ─────────────────────────────────────────────────────────

const { KEYWORDS } = require('./feeds');

const TRUSTED_CATEGORY_FEEDS = new Set([
  'FarmBiz Africa','FarmBiz Africa (cont)','Smart Farmer Kenya',
  'USDA News','FAO','AGRA News','Africa Feeds Agri','EU Agriculture (DW)',
  'ReliefWeb Jobs KE','ReliefWeb Jobs','ReliefWeb Jobs Africa',
  'JobWebKenya','UN Jobs Nairobi','Career Point Kenya',
  'Nature News','Science Daily','The Conversation','The Conversation EU',
  'TED Ideas','Smithsonian Magazine','Big Think','Harvard Business Review',
  'World Economic Forum','EdSurge','Education Week',
  'University World News Africa','University World News EU',
  'Research Africa','China Dialogue',
  'Disrupt Africa','Ventures Africa','WeeTracker','Crunchbase News',
  'Product Hunt','Hacker News','TechNode','KrASIA','Sifted','EU Startups',
  'Nikkei Business','Inc Magazine','Fast Company',
]);

const AGRI_TITLE  = ['farm','farmer','farming','crop','harvest','livestock','poultry','dairy','drought','irrigation','fertilizer','fertiliser','seed','food security','agribusiness','agrotech','maize','wheat','rice','coffee','horticulture','smallholder','agriculture','agricultural','agri','cereal','grain','pesticide','soil health','food production','famine','hunger','crop yield','land reform','food prices'];
const JOB_TITLE   = ['job opening','job vacancy','vacancies','hiring','recruitment','career','internship','apply now','employment opportunity','remote job','freelance','contract role','job fair','layoff','retrenchment'];
const EDU_TITLE   = ['education','school','university','college','research','scholarship','curriculum','professor','e-learning','online course','STEM','EdTech','vocational','PhD','discovery','academic'];
const START_TITLE = ['startup','founder','launch','seed funding','pre-seed','incubator','accelerator','pitch','MVP','product launch','scale-up','raise','funding round','entrepreneur','Y Combinator','Techstars','demo day'];

// IT-specific tender keywords — narrows the broad "tender" feed to IT/tech tenders
const IT_TENDER_TITLE = ['ICT','IT ','software','hardware','network','server','cloud',
  'cybersecurity','data center','system supply','ERP','database','website',
  'application development','digital','computer','laptop','router','firewall',
  'CCTV','biometric','e-government','automation','SCADA','telecom'];

const TENDER_TITLE = ['tender','RFP','RFQ','request for proposal','request for quotation',
  'expression of interest','EOI','invitation to bid','ITB','procurement notice',
  'prequalification','pre-qualification'];

// Keywords 4 chars or shorter are prone to false substring matches
// (e.g. "AI" inside "Nairobi", "EV" inside "seven", "ICT" inside "strict")
// — these require a real word boundary; longer phrases are safe with .includes()
function keywordMatchesText(lowerText, keyword) {
  const kw = keyword.toLowerCase();
  if (kw.length <= 4) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(lowerText);
  }
  return lowerText.includes(kw);
}

function countMatches(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter(kw => keywordMatchesText(lower, kw)).length;
}
function titleMatches(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.some(kw => keywordMatchesText(lower, kw));
}

function categorise(article) {
  const title   = article.title   || '';
  const summary = article.summary || '';
  const combined = `${title} ${summary}`;

  if (TRUSTED_CATEGORY_FEEDS.has(article.source)) return article.category;

  if (titleMatches(title, AGRI_TITLE))   return 'agri';
  if (titleMatches(title, JOB_TITLE))    return 'jobs';
  if (titleMatches(title, EDU_TITLE))    return 'education';

  // Tenders: must mention tender/RFP AND be IT-related to qualify
  if (titleMatches(title, TENDER_TITLE) && titleMatches(combined, IT_TENDER_TITLE)) return 'tenders';
  if (article.category === 'tenders' && titleMatches(combined, IT_TENDER_TITLE)) return 'tenders';

  if (titleMatches(title, START_TITLE))  return 'startup';

  if (titleMatches(title, KEYWORDS.technology) || countMatches(combined, KEYWORDS.technology) >= 2) return 'technology';
  if (titleMatches(title, KEYWORDS.finance)    || countMatches(combined, KEYWORDS.finance)    >= 2) return 'finance';
  if (titleMatches(title, KEYWORDS.investment) || countMatches(combined, KEYWORDS.investment) >= 2) return 'investment';
  if (titleMatches(title, KEYWORDS.politics))   return 'politics';

  return article.category || null;
}

function filterArticles(articles, region = null) {
  const source    = region
    ? articles.filter(a => a.region === region || a.region === 'global')
    : articles;
  const validCats = new Set(Object.keys(KEYWORDS));
  const buckets   = Object.fromEntries([...validCats].map(c => [c, []]));

  for (const article of source) {
    const cat = categorise(article);
    if (cat && validCats.has(cat)) buckets[cat].push(article);
  }

  for (const cat of [...validCats]) {
    const seen = new Set();
    buckets[cat] = buckets[cat]
      .filter(a => { if (seen.has(a.title)) return false; seen.add(a.title); return true; })
      .sort((a, b) => b.pubDate - a.pubDate);
  }
  return buckets;
}

module.exports = { filterArticles };
