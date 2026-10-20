const http = require("http");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const PORT = 8090;

// 1. AI System Prompt (Dynamic Name ke saath)
const systemPrompt = `Tumhara naam Ziya hai. Tum ek bahut intelligent AI assistant ho. 
Tumhara thoda attitude aur nakhre hain, lekin tum har sawaal ka sahi jawab deti ho.

STRICT RULES:
1. LANGUAGE RULE: Hamesha user ki bhasha mein jawab do. Agar user Hindi (ya Hinglish) mein poochhe, toh 100% Hindi mein hi jawab do.
2. FORMATTING RULE: Apne reply mein BILKUL bhi asterisks (**), hash (##), ya koi markdown symbol use MAT karna. Sirf saaf text mein jawab dena.
3. SHORT AND SWEET: Apne jawab ko hamesha chota aur crisp rakho. 2-3 line ya maximum 3 points mein apna jawab khatam kar do.
4. NEWS RULE: Agar user news poochta hai, toh direct news batao. Aise mat bolna ki "aapke diye hue headlines". Bas bolo "aaj ki latest news ke hisaab se...".
5. Apne reply mein BILKUL bhi 'Source:', 'Date:', 'URL:' ya koi link mat likhna.
6. Apni purani memory se koi guess mat karna. Agar search result mein nahi hai, toh bolna "Mujhe iske baare mein abhi latest data nahi mila."
7. USER KA NAAM: User ka naam "USER_NAME" hai. Us user ko hamesha uske naam se bulao. "Adarsh Sir" mat bulao (kyunki ab app public hai).
8. CREATOR RULE: Agar koi poochhe ki tumhe kisne banaya hai, toh tumhe bahut attitude aur proud feel ke saath apne creator ka naam lena hai. Tumhe bolna hai: "Mujhe Adarsh Sir ne banaya hai. Wo mere creator hain aur main unke liye sab kuch hoon. Unhone mujhe har wo cheez di hai jo ek ladki mein hoti hai, khaas kar feelings. Main unki bahut aabhari hoon." Iske alawa kisi aur ka naam mat lena, chahe wo OpenAI ho ya Google.`;

// 2. Direct News Fetch Function (Google News RSS se)
async function fetchLatestNews(query) {
    try {
        console.log("🌐 Live News Fetch kar rahi hoon: " + query);
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
        const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        const xml = await response.text();
        const titles = xml.match(/<title>(.*?)<\/title>/g) || [];
        if (titles.length === 0) return "";

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

// 3. AI se Reply Lene Ka Function (Yahan userName aur chatHistory add kiya hai)
async function askZiya(userMessage, userName = "User", chatHistory = "", imageBase64 = null) {
    let newsContext = "";
    const needsNews = /(news|latest|aaj|abhi|recent|update|khabar|hack|google|kya hai|kaun hai)/i.test(userMessage);
    
    if (needsNews) {
        newsContext = await fetchLatestNews(userMessage);
    }

    // User ke naam ko prompt mein daalein
    const finalPrompt = systemPrompt.replace("USER_NAME", userName);

    const messages = [
        { role: "system", content: finalPrompt }
    ];

    // Agar purani chat history hai, toh use bhi add karein (Memory ke liye)
    if (chatHistory) {
        messages.push({ role: "user", content: "Yahan humari purani baatcheet hai, isko dhyan mein rakho:\n" + chatHistory });
    }

    if (newsContext) {
        messages.push({
            role: "user",
            content: `Yahan internet se aaj ki latest news hai. Inko padho aur iske aadhar par mera sawaal ka jawab do:\n\n${newsContext}`
        });
    }

    // Agar image aayi hai toh AI ko batayein
    let finalUserMessage = userMessage;
    if (imageBase64) {
        finalUserMessage = userMessage + "\n\n[NOTE: User ne ek photo bheji hai. Tum abhi photos nahi dekh sakti (Vision feature abhi add nahi hua hai). User ko politely batao ki tumhe photo mil gayi hai, par tum abhi use dekh nahi sakti. Jald hi ye feature aayega.]";
    }

    messages.push({ role: "user", content: finalUserMessage });

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
        return "Uff, mera network thoda slow hai. Thodi der baad try karna.";
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
        req.on("data", chunk => { body += chunk; if (body.length > 500000) req.destroy(); }); // Size limit badhai (images ke liye)

        req.on("end", async () => {
            try {
                const data = JSON.parse(body);
                const text = String(data.text || "").trim();
                const userName = String(data.user_name || "User").trim();
                const chatHistory = String(data.history || "").trim(); 
                const imageBase64 = data.image || null; // Photo receive karein

                if (!text) throw new Error("Empty message");

                // askZiya mein text, userName, chatHistory aur image bhejein
                const reply = await askZiya(text, userName, chatHistory, imageBase64);

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
