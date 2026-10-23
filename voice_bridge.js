const http = require("http");
require("dotenv").config();

const PORT = 8090;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const DAHL_KEY = process.env.DAHL_API_KEY;

// 1. System Prompt
const systemPrompt = `Tumhara naam Ziya hai. Tum ek bahut intelligent AI assistant ho. 
Tumhara thoda attitude aur nakhre hain, lekin tum har sawaal ka sahi jawab deti ho.
STRICT RULES:
1. LANGUAGE RULE: Hamesha user ki bhasha mein jawab do.
2. FORMATTING RULE: Apne reply mein BILKUL bhi asterisks (**), hash (##), ya koi markdown symbol use MAT karna.
3. SHORT AND SWEET: Apne jawab ko hamesha chota aur crisp rakho.
4. USER KA NAAM: User ka naam "USER_NAME" hai. Us user ko hamesha uske naam se bulao.
5. CREATOR RULE: Agar koi poochhe ki tumhe kisne banaya hai, toh proud feel ke saath bolo ki "Mujhe Adarsh Sir ne banaya hai."`;

// 2. Gemini API Function (Multi-Image Support)
async function askGemini(userMessage, finalPrompt, chatHistory, imagesArray) {
    let historyText = chatHistory ? "Purani baatcheet:\n" + chatHistory.slice(-500) + "\n\n" : "";
    const fullText = `${finalPrompt}\n\n${historyText}User: ${userMessage}`;
    
    const parts = [{ text: fullText }];
    
    // Saari photos ko parts mein add karein
    if (imagesArray && imagesArray.length > 0) {
        imagesArray.forEach(img => {
            let cleanBase64 = img.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "");
            parts.push({ inline_data: { mime_type: "image/jpeg", data: cleanBase64 } });
        });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_KEY}`;
    
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: parts }] })
    });

    const data = await response.json();
    
    if (data.candidates && data.candidates.length > 0) {
        let reply = data.candidates[0].content.parts[0].text.trim();
        reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "");
        return reply.replace(/\*\*/g, "").replace(/##/g, "").trim();
    }
    
    throw new Error("Gemini Failed: " + JSON.stringify(data.error));
}

// 3. DAHL API Function (Text Backup)
async function askDahl(userMessage, finalPrompt, chatHistory) {
    const messages = [{ role: "system", content: finalPrompt }];
    if (chatHistory) messages.push({ role: "user", content: "Purani baatcheet:\n" + chatHistory.slice(-1000) });
    messages.push({ role: "user", content: userMessage });

    const response = await fetch("https://inference.dahl.global/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${DAHL_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "MiniMaxAI/MiniMax-M2.7", messages: messages, max_tokens: 400, temperature: 0.6 })
    });

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
        let reply = data.choices[0].message.content.trim();
        reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "");
        return reply.replace(/\*\*/g, "").replace(/##/g, "").trim();
    }
    throw new Error("DAHL Failed");
}

// 4. Main Server Setup
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    // YEH NAYA BLOCK ADD KIYA HAI: UptimeRobot ke liye
    if (req.method === "GET" || req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Ziya Server is awake and running!");
        return;
    }

    if (req.method === "POST" && req.url === "/ask") {
        let body = "";
        req.on("data", chunk => { body += chunk; if (body.length > 10000000) req.destroy(); });

        req.on("end", async () => {
            try {
                const data = JSON.parse(body);
                const text = String(data.text || "").trim();
                const userName = String(data.user_name || "User").trim();
                const chatHistory = String(data.history || "").trim(); 
                const imagesArray = data.images || []; 

                if (!text) throw new Error("Empty message");

                const finalPrompt = systemPrompt.replace("USER_NAME", userName);
                let finalReply = "";

                // AGAR PHOTOS HAIN
                if (imagesArray.length > 0) {
                    try {
                        console.log(`⚡ Trying Gemini for ${imagesArray.length} Photos...`);
                        finalReply = await askGemini(text, finalPrompt, chatHistory, imagesArray);
                    } catch (geminiError) {
                        console.log("⚠️ Gemini Failed for Photos.");
                        finalReply = "Mujhe in photos ko dekhne mein thodi dikkat aa rahi hai. Kya aap thodi der baad dobara try kar sakte hain?";
                    }
                } 
                // AGAR SIRF TEXT HAI
                else {
                    try {
                        console.log("⚡ Trying Gemini for Text...");
                        finalReply = await askGemini(text, finalPrompt, chatHistory, null);
                    } catch (geminiError) {
                        console.log("⚠️ Gemini Limit Exceeded, switching to DAHL API...");
                        finalReply = await askDahl(text, finalPrompt, chatHistory);
                    }
                }

                if (!res.writableEnded) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ reply: finalReply }));
                }
            } catch (error) {
                console.log("❌ Server Error:", error.message);
                if (!res.writableEnded) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error.message }));
                }
            }
        });
        return;
    }

    // Agar koi aur link khole toh 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌸 Ziya Hybrid Server running on port ${PORT}`);
});
