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
4. NEWS RULE: Agar user news poochta hai, toh direct news batao.
5. Apne reply mein BILKUL bhi 'Source:', 'Date:', 'URL:' ya koi link mat likhna.
6. USER KA NAAM: User ka naam "USER_NAME" hai. Us user ko hamesha uske naam se bulao.
7. CREATOR RULE: Agar koi poochhe ki tumhe kisne banaya hai, toh proud feel ke saath bolo ki "Mujhe Adarsh Sir ne banaya hai."`;

// 2. Gemini API Function (Fast + Vision)
async function askGemini(userMessage, finalPrompt, chatHistory, imageBase64) {
    let historyText = chatHistory ? "Purani baatcheet:\n" + chatHistory.slice(-500) + "\n\n" : "";
    const fullText = `${finalPrompt}\n\n${historyText}User: ${userMessage}`;
    const parts = [{ text: fullText }];
    
    if (imageBase64) {
        let cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "");
        parts.push({ inline_data: { mime_type: "image/jpeg", data: cleanBase64 } });
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
    
    // Agar Gemini fail hota hai (Limit khatam), toh Error throw karein
    throw new Error("Gemini Failed: " + JSON.stringify(data.error));
}

// 3. DAHL API Function (Backup)
async function askDahl(userMessage, finalPrompt, chatHistory, imageBase64) {
    const messages = [{ role: "system", content: finalPrompt }];
    if (chatHistory) messages.push({ role: "user", content: "Purani baatcheet:\n" + chatHistory.slice(-1000) });
    
    // Agar photo hai, toh text mein batao (kyunki DAHL vision nahi hai)
    let finalMsg = userMessage;
    if (imageBase64) finalMsg += " (User ne photo bheji hai, par tum abhi use dekh nahi sakti.)";
    
    messages.push({ role: "user", content: finalMsg });

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

                const finalPrompt = systemPrompt.replace("USER_NAME", userName);
                let finalReply = "";

                // PEHLE GEMINI TRY KARENGE
                try {
                    console.log("⚡ Trying Gemini API...");
                    finalReply = await askGemini(text, finalPrompt, chatHistory, imageBase64);
                    console.log("✅ Gemini Success!");
                } catch (geminiError) {
                    // AGAR GEMINI FAIL HUA (Limit khatam), TOH DAHL USE KARENGE
                    console.log("⚠️ Gemini Limit Exceeded, switching to DAHL API...");
                    finalReply = await askDahl(text, finalPrompt, chatHistory, imageBase64);
                    console.log("✅ DAHL Success!");
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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌸 Ziya Hybrid Server running on port ${PORT}`);
});
