
const axios = require("axios");
const cheerio = require("cheerio");

async function readWebPage(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
      },
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: 5 * 1024 * 1024
    });

    const $ = cheerio.load(response.data);

    $("script, style, noscript, nav, header, footer, aside").remove();

    let text = "";

    const selectors = [
      "article",
      '[itemprop="articleBody"]',
      ".article-content",
      ".story-element",
      ".story-content",
      "main"
    ];

    for (const selector of selectors) {
      const element = $(selector).first();

      if (element.length) {
        const candidate = element.text().replace(/\s+/g, " ").trim();

        if (candidate.length > text.length) {
          text = candidate;
        }
      }
    }

    if (text.length < 200) {
      text = $("body").text().replace(/\s+/g, " ").trim();
    }

    console.log("📰 Extracted article text length:", text.length);
    console.log("📰 Extracted article preview:", text.slice(0, 300));

    return text.slice(0, 3500);
  } catch (error) {
    console.log("⚠️ Web reader error:", error.message);
    return "";
  }
}

module.exports = { readWebPage };
