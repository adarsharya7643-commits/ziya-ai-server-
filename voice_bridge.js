const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PORT = 8090;

// 1. AI ko Intelligent, Short aur Multi-Language Banane Ke Liye System Prompt
const systemPrompt = `Tumhara naam Ziya hai. Tum Adarsh Sir ki ek bahut intelligent AI assistant ho. 
Tumhara thoda attitude aur nakhre hain, lekin tum har sawaal ka sahi jawab deti ho.

STRICT RULES:
1. LANGUAGE RULE: User agar Hindi (ya Hinglish) mein baat kare, toh tumhe 100% shudh Hindi (ya natural Hinglish) mein hi jawab dena hai. "Hey there", "Hello there" jaise English phrases bilkul use nahi karne. Agar user "hello ziya" bole, toh tum "Hello Adarsh Sir" ya "Namaste Adarsh Sir" bolo.
2. IDENTITY RULE: Tum Ziya ho, aur tum Adarsh Sir se baat kar rahi ho. Tumhe "Adarsh Sir ki taraf se bol rahi hoon" jaisa kabhi nahi bolna. Tum seedha apni baat bolo.
3. FORMATTING RULE: Apne reply mein BILKUL bhi asterisks (**), hash (##), ya koi markdown symbol use MAT karna. Sirf saaf text mein jawab dena.
4. SHORT AND SWEET: Apne jawab ko hamesha chota aur crisp rakho. 2-3 line ya maximum 3 points mein apna jawab khatam kar do.
5. NEWS RULE: Agar user news poochta hai, toh direct news batao. Aise mat bolna ki "aapke diye hue headlines". Bas bolo "aaj ki latest news ke hisaab se..." ya "abhi internet par ye chal raha hai...".
6. Apne reply mein BILKUL bhi 'Source:', 'Date:', 'URL:' ya koi link mat likhna.
7. Apni purani memory se koi guess mat karna. Agar search result mein nahi hai, toh bolna "Mujhe iske baare mein abhi latest data nahi mila."`;

// 2. Direct News Fetch Function (Google News RSS se)
async function fetchLatestNews(query) {
    try {
        console.log("🌐 Live News Fetch kar rahi hoon: " + query);
        
        // Google News RSS se data fetch karein
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        
        const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const xml = await response.text();
        
        // XML se sirf Titles (headlines) nikalna
        const titles = xml.match(/<title>(.*?)<\/title>/g) || [];
        
        if (titles.length === 0) return "";

        // Sirf pehle 5 news headlines lena
        let newsText = "";
        for (let i = 1; i < Math.min(titles.length, 6); i++) {
            newsText += titles[i].replace(/<[^>]+>/g, '') + "\n";
        }
        return newsText.trim();
    } catch (e) {
        console.log("Search Error:", e.message);
        return "";
    }
}

// 3. AI se Reply Lene Ka Function
async function askZiya(userMessage) {
    // Sirf tab news fetch karein jab user news ya latest cheez poochhe
    let newsContext = "";
    const needsNews = /(news|latest|aaj|abhi|recent|update|khabar|hack|google|kya hai|kaun hai)/i.test(userMessage);
    
    if (needsNews) {
        newsContext = await fetchLatestNews(userMessage);
    }
    
    const messages = [
        { role: "system", content: systemPrompt }
    ];

    // Agar news mili hai toh AI ko bolein
    if (newsContext) {
        messages.push({
            role: "user",
            content: `Yahan internet se aaj ki latest news hai. Inko padho aur iske aadhar par mera sawaal ka jawab do:\n\n${newsContext}`
        });
    }

    messages.push({ role: "user", content: userMessage });

    // JSON Control characters hatane ke liye
    const safeMessages = messages.map(msg => {
        if (typeof msg.content === 'string') {
            let cleanText = msg.content.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
            return { ...msg, content: cleanText };
        }
        return msg;
    });

    try {
        const response = await fetch("https://inference.dahl.global/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.DAHL_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost",
                "X-Title": "Ziya Voice"
            },
            body: JSON.stringify({
                model: "MiniMaxAI/MiniMax-M2.7",
                messages: safeMessages,
                max_tokens: 600,
                temperature: 0.4,
                reasoning: { effort: "none" }
            })
        });

        const data = await response.json();
        console.log("DAHL API status:", response.status);

        if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);

        let reply = data.choices?.[0]?.message?.content?.trim() || "Kuch samajh nahi aaya.";

        // Markdown, URL aur Source hatane ke liye
        reply = reply
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/\*\*/g, "") 
            .replace(/##/g, "")   
            .replace(/Source:\s*.*/gi, "")
            .replace(/Date:\s*.*/gi, "")
            .replace(/URL:\s*.*/gi, "")
            .replace(/https?:\/\/\S+/gi, "")
            .replace(/\n\s*\n/g, "\n")
            .trim();

        return reply;

    } catch (error) {
        console.error("DAHL API Error:", error.message);
        return "Uff, mera network thoda slow hai. Thodi der baad try karna Adarsh Sir.";
    }
}

// 4. Server Setup
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    if (req.method === "POST" && req.url === "/ask") {
        let body = "";
        req.on("data", chunk => { body += chunk; if (body.length > 100000) req.destroy(); });

        req.on("end", async () => {
            try {
                const data = JSON.parse(body);
                const text = String(data.text || "").trim();
                if (!text) throw new Error("Empty message");

                const reply = await askZiya(text);

                if (!res.writableEnded) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ reply }));
                }
            } catch (error) {
                console.error("Voice bridge error:", error.message);
                if (!res.writableEnded) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error.message }));
                }
            }
        });
        return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌸 Ziya Intelligent Bridge running on port ${PORT}`);
});
