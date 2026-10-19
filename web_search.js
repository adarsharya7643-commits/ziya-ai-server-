const axios = require("axios");
const cheerio = require("cheerio");

function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFeed(xml, fallbackPublisher = "Unknown") {
  const $ = cheerio.load(xml, { xmlMode: true });
  const results = [];
  const seen = new Set();

  $("item").each((index, element) => {
    const item = $(element);
    const title = cleanText(item.find("title").first().text());
    const link = item.find("link").first().text().trim();
    const publisher =
      cleanText(item.find("source").first().text()) ||
      fallbackPublisher;
    const date = cleanText(item.find("pubDate").first().text());
    const description = cleanText(
      item.find("description").first().text()
    );

    if (!title || !link || seen.has(link)) return;

    seen.add(link);
    results.push({ title, link, publisher, date, description });
  });

  return results;
}

function relevanceScore(item, query) {
  const ignored = new Set([
    "the", "and", "for", "with", "from", "that", "this",
    "what", "when", "where", "who", "how", "latest",
    "news", "today", "about", "kya", "hai", "ka", "ki",
    "ke", "mein", "me", "aur", "aaj", "batao"
  ]);

  const terms = String(query || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];

  const keywords = [...new Set(terms)].filter(
    word => word.length > 2 && !ignored.has(word)
  );

  if (!keywords.length) return 1;

  const text = `${item.title} ${item.description} ${item.publisher}`
    .toLowerCase();

  return keywords.reduce(
    (score, word) => score + (text.includes(word) ? 1 : 0),
    0
  );
}

function titleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\s+-\s+[^-]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeDistinct(ndtv, google, limit = 10) {
  const output = [];
  const seen = new Set();
  const max = Math.max(ndtv.length, google.length);

  // Alternate feeds so the first results aren't all from one feed.
  for (let i = 0; i < max && output.length < limit; i++) {
    for (const item of [ndtv[i], google[i]]) {
      if (!item) continue;

      const key = titleKey(item.title);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      output.push(item);

      if (output.length >= limit) break;
    }
  }

  return output;
}

async function fetchFeed(url, fallbackPublisher = "Unknown") {
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "hi-IN,hi;q=0.9,en;q=0.8"
    },
    timeout: 15000
  });

  return parseFeed(response.data, fallbackPublisher);
}

async function fetchNdtv() {
  const results = await fetchFeed(
    "https://feeds.feedburner.com/ndtvnews-india-news",
    "NDTV"
  );

  results.sort((a, b) =>
    (Date.parse(b.date || "") || 0) -
    (Date.parse(a.date || "") || 0)
  );

  return results;
}

async function fetchGoogleNews(query) {
  const rssUrl =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=hi&gl=IN&ceid=IN:hi";

  return fetchFeed(rssUrl, "Google News");
}

async function webSearch(query) {
  const text = String(query || "").toLowerCase().trim();

  const generalNewsTerms = [
    "latest news", "today news", "breaking news",
    "aaj ki news", "aaj ka latest news",
    "आज की खबर", "आज की खबरें", "ताज़ा खबर", "ताजा खबर"
  ];

  const isGeneralNews = generalNewsTerms.some(term =>
    text.includes(term)
  );

  const searchQuery = isGeneralNews
    ? "India latest news"
    : query;

  const [ndtvResult, googleResult] = await Promise.allSettled([
    fetchNdtv(),
    fetchGoogleNews(searchQuery)
  ]);

  const ndtv = ndtvResult.status === "fulfilled"
    ? ndtvResult.value
    : [];

  const google = googleResult.status === "fulfilled"
    ? googleResult.value
    : [];

  if (ndtvResult.status === "rejected") {
    console.error("NDTV RSS error:", ndtvResult.reason.message);
  }

  if (googleResult.status === "rejected") {
    console.error("Google News RSS error:", googleResult.reason.message);
  }

  console.log(`NDTV RSS: ${ndtv.length} articles`);
  console.log(`Google News RSS: ${google.length} articles`);

  let results;

  if (isGeneralNews) {
    results = mergeDistinct(ndtv, google, 10);
  } else {
    const matches = ndtv
      .map(item => ({
        ...item,
        score: relevanceScore(item, query)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        (Date.parse(b.date || "") || 0) -
        (Date.parse(a.date || "") || 0)
      )
      .map(({ score, ...item }) => item);

    results = mergeDistinct(matches, google, 10);
  }

  console.log(`Combined distinct results: ${results.length}`);
  return results;
}

module.exports = { webSearch };
