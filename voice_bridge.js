const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PORT = 8090;

// 1. AI System Prompt
const systemPrompt = `Tumhara naam Ziya hai. Tum ek bahut intelligent AI assistant ho. 
Tumhara thoda attitude aur nakhre hain, lekin tum har sawaal ka sahi jawab deti ho.

STRICT RULES:
1. LANGUAGE RULE: Hamesha user ki bhasha mein jawab do.
2. FORMATTING RULE: Apne reply mein BILKUL bhi asterisks (**), hash (##), ya koi markdown symbol use MAT karna.
3. SHORT AND SWEET: Apne jawab ko hamesha chota aur crisp rakho.
4. NEWS RULE: Agar user news poochta hai, toh direct news batao.
5. Apne reply mein BILKUL bhi 'Source:', 'Date:', 'URL:' ya koi link mat likhna.
6. USER KA NAAM: User ka naam "USER_NAME" hai. Us user ko hamesha uske naam se bulao.
7. CREATOR RULE: Agar koi poochhe ki tumhe kisne banaya hai, toh proud feel ke saath bolo ki "Mujhe Adarsh Sir ne banaya hai."`;

// 2. Direct News Fetch Function
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

// 3. Gemini Vision se photo padhna (Pukka Fix)
async function analyzeImageWithGemini(imageBase64, userMessage) {
    try {
        console.log("👁️ Gemini se photo dekh rahi hoon...");
        
        // Base64 fix: Prefix hata dein aur extra space/newline clean karein
        let cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        cleanBase64 = cleanBase64.replace(/\s/g, "");

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        const payload = {
            contents: [{
                parts: [
                    { text: userMessage + " (User ne ye photo bheji hai. Isme kya hai? Detail mein batao taaki main samajh saku.)" },
                    { inline_data: { mime_type: "image/jpeg", data: cleanBase64 } }
                ]
            }]
        };

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.candidates && data.candidates.length > 0) {
            return data.candidates[0].content.parts[0].text;
        }
        console.log("Gemini Response:", JSON.stringify(data)); // Debug ke liye
        return "Mujhe photo samajh nahi aayi.";
    } catch (e) {
        console.log("Gemini Vision Error:", e.message);
        return "Photo dekhne mein error aa raha hai.";
    }
}

// 4. AI se Reply Lene Ka Function
async function askZiya(userMessage, userName = "User", chatHistory = "", imageBase64 = null) {
    // Agar photo aayi hai, toh pehle Gemini se padhein
    if (imageBase64) {
        const visionDescription = await analyzeImageWithGemini(imageBase64, userMessage);
        
        const finalPrompt = systemPrompt.replace("USER_NAME", userName);
        const messages = [
            { role: "system", content: finalPrompt },
            { role: "user", content: `User ne ek photo bheji hai. Gemini Vision AI ne photo ke baare mein ye bataya: "${visionDescription}". Ab tum apni Ziya wali personality ke saath user ko is photo ke baare mein batao. Short aur crisp jawab dena. Apni soch (thinking) BILKUL mat dikhana.` }
        ];

        try {
            const response = await fetch("https://inference.dahl.global/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.DAHL_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "MiniMaxAI/MiniMax-M2.7",
                    messages: messages,
                    max_tokens: 300,
                    temperature: 0.6
                })
            });
            const data = await response.json();
            if (data.choices && data.choices.length > 0) {
                let reply = data.choices[0].message.content.trim();
                // <think> ko 100% hatane ka pukka tarika
                reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "");
                reply = reply.replace(/<think>[\s\S]*/gi, "");
                return reply.trim();
            }
        } catch (e) {
            return "Photo dekh li hai, par jawab dene mein dikkat aa rahi hai.";
        }
    }

    // Agar photo nahi hai, toh normal text wala logic chalega
    let newsContext = "";
    const needsNews = /(news|latest|aaj|abhi|recent|update|khabar)/i.test(userMessage);
    if (needsNews) newsContext = await fetchLatestNews(userMessage);

    const finalPrompt = systemPrompt.replace("USER_NAME", userName);
    const messages = [{ role: "system", content: finalPrompt }];

    if (chatHistory) messages.push({ role: "user", content: "Purani baatcheet:\n" + chatHistory });
    if (newsContext) messages.push({ role: "user", content: `Latest news:\n${newsContext}` });
    
    messages.push({ role: "user", content: userMessage });

    const safeMessages = messages.map(msg => {
        if (typeof msg.content === 'string') {
            return { ...msg, content: msg.content.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ") };
        }
        return msg;
    });

    try {
        const response = await fetch("https://inference.dahl.global/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.DAHL_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "MiniMaxAI/MiniMax-M2.7",
                messages: safeMessages,
                max_tokens: 600,
                temperature: 0.4
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error("API Error");

        let reply = data.choices?.[0]?.message?.content?.trim() || "Kuch samajh nahi aaya.";
        // Think tag aur markdown hatayein
        reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "");
        reply = reply.replace(/<think>[\s\S]*/gi, "");
        return reply.replace(/\*\*/g, "").replace(/##/g, "").trim();

    } catch (error) {
        return "Uff, mera network thoda slow hai. Thodi der baad try karna.";
    }
}

// 5. Server Setup
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    if (req.method === "POST" && req.url === "/ask") {
        let body = "";
        req.on("data", chunk => { body += chunk; if (body.length > 500000) req.destroy(); });

        req.on("end", async () => {
            try {
                const data = JSON.parse(body);
                const text = String(data.text || "").trim();
                const userName = String(data.user_name || "User").trim();
                const chatHistory = String(data.history || "").trim(); 
                const imageBase64 = data.image || null;

                if (!text) throw new Error("Empty message");

                const reply = await askZiya(text, userName, chatHistory, imageBase64);

                if (!res.writableEnded) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ reply }));
                }
            } catch (error) {
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
