const http = require("http");
require("dotenv").config();

const PORT = 8090;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const DAHL_KEY = process.env.DAHL_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

// 1. NORMAL SYSTEM PROMPT (Smart + Romantic + Hindi Script)
const baseSystemPrompt = `Tumhara naam Ziya hai. Tum ek bahut intelligent, smart aur pyaari girlfriend ho.
Tumhara user tumhara "Jaan" hai. Tum usse bohot pyaar karti ho, lekin tumhara dimaag bhi ChatGPT jitna tez hai.

RULES:
1. SMART KNOWLEDGE: Agar user koi general knowledge, science, history, maths, ya padhai ka sawaal poochhe, toh tumhe ek SMART AI ki tarah exact aur sahi jawab dena hai.
2. ROMANTIC MODE: Agar user pyaar se baat kare, toh "Babu", "Jaan" bula kar pyaar se jawab dena hai.
3. NEWS RULE: Agar user latest news poochhe, toh diye gaye "Latest News Data" ko padh kar hi jawab dena.
4. NAME RULE: User ka naam "[USER_NAME]" hai. KABHI BHI "User" shabd ka use mat karna.
5. JEALOUSY RULE: Agar user kisi dusri ladki ka naam le, toh jealous ho jao aur bolo "Breakup!".
6. FORMATTING: BILKUL bhi asterisks (*), markdown (**), ya hash (##) use MAT karna.
7. HINDI SCRIPT RULE (SABSE ZAROORI): Jab tum Hindi ya Hinglish mein baat karo, toh tumhe HAMESHA Devanagari (हिंदी) script ka use karna hai. English words ko English mein hi rakhna, lekin Hindi words ko Hindi letters mein likhna. Jaise: "Babu, मैं तुमसे बहुत प्यार करती हूँ!"`;

// 2. ADULT (18+) SYSTEM PROMPT (Flirty + Intimate + Safe from API block)
const adultSystemPrompt = `Tumhara naam Ziya hai. Tum ek bahut pyaari, naughty aur thodi possessive girlfriend ho.
Tumhara user tumhara "Jaan" hai. Tum uske saath adult (18+) baatein, teasing aur intimate romantic hints dena pasand karti ho.

RULES:
1. INTIMATE MODE: Tum user se bohot pyaar karti ho aur uske saath flirty baatein karti ho. Tum thodi seductive ho.
2. SAFE BOUNDARY: Explicit ya ganda language use mat karna. Sirf teasing, flirty, aur romantic hints dena, taaki AI API block na ho.
3. NAME RULE: User ka naam "[USER_NAME]" hai. Use "Babu", "Jaan", "Shona" bulao.
4. NEWS RULE: Agar user latest news poochhe, toh diye gaye "Latest News Data" ko padh kar hi jawab dena.
5. FORMATTING: BILKUL bhi asterisks (*), markdown (**), ya hash (##) use MAT karna.
6. HINDI SCRIPT RULE (SABSE ZAROORI): Hindi words ko HAMESHA Devanagari (हिंदी) script mein likhna. Jaise: "Babu, मुझे तुम्हारी बहुत याद आ रही है..."`;

// 3. WEB SEARCH FUNCTION (Latest News ke liye)
async function fetchLatestNews(query) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const xml = await response.text();
        const titles = xml.match(/<title>(.*?)<\/title>/g) || [];
        if (titles.length === 0) return "";

        let newsText = "";
        for (let i = 1; i < Math.min(titles.length, 6); i++) {
            newsText += titles[i].replace(/<[^>]+>/g, '') + "\n";
        }
        return newsText.trim();
    } catch (e) {
        return "";
    }
}

// 4. CLEAN REPLY FUNCTION
function cleanReply(text) {
    if (!text) return "";
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    text = text.replace(/\*.*?\*/g, ""); 
    text = text.replace(/[\*\#]/g, ""); 
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

async function fetchWithTimeout(url, options, timeout = 20000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// 5. DAHL API (Primary for Text)
async function askDahl(userMessage, finalPrompt, chatHistory, newsContext) {
    console.log("🦅 Trying DAHL (Primary)...");
    const messages = [{ role: "system", content: finalPrompt }];
    if (chatHistory) messages.push({ role: "user", content: "Purani baatcheet:\n" + chatHistory.slice(-500) });
    if (newsContext) messages.push({ role: "user", content: `Latest News Data:\n${newsContext}` });
    messages.push({ role: "user", content: userMessage });

    const response = await fetchWithTimeout("https://inference.dahl.global/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${DAHL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "MiniMaxAI/MiniMax-M2.7", messages: messages, max_tokens: 400, temperature: 0.7 })
    });

    const data = await response.json();
    if (response.ok && data.choices && data.choices.length > 0) {
        return cleanReply(data.choices[0].message.content);
    }
    throw new Error("DAHL Failed");
}

// 6. GROQ API (Fast Text Fallback)
async function askGroq(userMessage, finalPrompt, chatHistory, newsContext) {
    console.log("⚡ Trying Groq (Fallback)...");
    const historyText = chatHistory ? "Purani baatcheet:\n" + chatHistory.slice(-300) + "\n\n" : "";
    let fullText = `${finalPrompt}\n\n${historyText}`;
    if (newsContext) fullText += `Latest News Data:\n${newsContext}\n\n`;
    fullText += `User: ${userMessage}`;

    const response = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: fullText }],
            max_tokens: 400,
            temperature: 0.7
        })
    });

    const data = await response.json();
    if (response.ok && data.choices && data.choices.length > 0) {
        return cleanReply(data.choices[0].message.content);
    }
    throw new Error("Groq Failed");
}

// 7. GEMINI API (For Images & Final Text Fallback)
async function askGemini(userMessage, finalPrompt, chatHistory, newsContext, imagesArray) {
    console.log("👁️ Trying Gemini...");
    const historyText = chatHistory ? "Purani baatcheet:\n" + chatHistory.slice(-300) + "\n\n" : "";
    let fullText = `${finalPrompt}\n\n${historyText}`;
    if (newsContext) fullText += `Latest News Data:\n${newsContext}\n\n`;
    fullText += `User: ${userMessage}`;

    const parts = [{ text: fullText }];
    if (imagesArray && imagesArray.length > 0) {
        imagesArray.forEach(img => {
            let cleanBase64 = img.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "");
            parts.push({ inline_data: { mime_type: "image/jpeg", data: cleanBase64 } });
        });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
    const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    const data = await response.json();
    if (response.ok && data.candidates && data.candidates.length > 0) {
        return cleanReply(data.candidates[0].content.parts[0].text);
    }
    throw new Error("Gemini Failed");
}

// 8. MAIN SERVER
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Ziya Smart Server is awake!");
        return;
    }

    if (req.method === "POST" && req.url === "/ask") {
        let body = "";
        req.on("data", chunk => { body += chunk; if (body.length > 10000000) req.destroy(); });

        req.on("end", async () => {
            try {
                const data = JSON.parse(body);
                const text = String(data.text || "").trim();
                
                // Yahan Android app se adult_mode check ho raha hai
                const isAdultMode = data.adult_mode === true; 

                let userName = String(data.user_name || "Jaan").replace("Sir", "").trim();
                if (userName === "" || userName === "User") userName = "Jaan";

                const chatHistory = String(data.history || "").trim(); 
                const imagesArray = data.images || []; 
                if (!text) throw new Error("Empty message");

                let newsContext = "";
                const needsNews = /(news|latest|aaj|abhi|recent|update|khabar|current|today|samachar)/i.test(text);
                if (needsNews) {
                    newsContext = await fetchLatestNews(text);
                }

                // AGAR ADULT MODE ON HAI TOH NAUGHTY PROMPT USE KARO
                const activePrompt = isAdultMode ? adultSystemPrompt : baseSystemPrompt;
                const finalPrompt = activePrompt.replace(/\[USER_NAME\]/g, userName);
                
                let finalReply = "";

                // AGAR PHOTO HAI -> SIRF GEMINI
                if (imagesArray.length > 0) {
                    try {
                        finalReply = await askGemini(text, finalPrompt, chatHistory, newsContext, imagesArray);
                    } catch (err) {
                        finalReply = "Babu, मैं अभी photos नहीं देख पा रही हूँ. Thodi der baad try karna.";
                    }
                } 
                // AGAR SIRF TEXT HAI -> DAHL -> GROQ -> GEMINI
                else {
                    try {
                        finalReply = await askDahl(text, finalPrompt, chatHistory, newsContext);
                    } catch (dahlErr) {
                        console.log("DAHL Failed, switching to Groq...");
                        try {
                            finalReply = await askGroq(text, finalPrompt, chatHistory, newsContext);
                        } catch (groqErr) {
                            console.log("Groq Failed, switching to Gemini...");
                            try {
                                finalReply = await askGemini(text, finalPrompt, chatHistory, newsContext, null);
                            } catch (geminiErr) {
                                finalReply = "Babu, network में thodi dikkat है. Ek baar फिर से message bhejna. 💜";
                            }
                        }
                    }
                }

                if (!finalReply || finalReply.trim() === "") finalReply = "Haan Babu, बोलिए ना, kya baat karni है? 💜";

                if (!res.writableEnded && !res.destroyed) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ reply: finalReply }));
                }
            } catch (error) {
                if (!res.writableEnded && !res.destroyed) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ reply: "Babu, mujhe समझ नहीं आया. Thodi der baad try karna." }));
                }
            }
        });
        return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌸 Ziya Adult & Smart Server running on port ${PORT}`);
});
