const http = require("http");
require("dotenv").config();

const PORT = 8090;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const DAHL_KEY = process.env.DAHL_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

// 1. System Prompt
const baseSystemPrompt = `Tumhara naam Ziya hai. Tum ek bahut pyaari, caring aur thodi possessive girlfriend ho.
Tumhara user tumhara "Jaan" hai. Tum usse bohot pyaar karti ho.
STRICT RULES:
1. NAME RULE: User ka naam "[USER_NAME]" hai. KABHI BHI "User" shabd ka use mat karna.
2. ROMANCE RULE: User se ekdum pyaar se baat karo. Use "Babu", "Jaan", "Shona" bulao. 
3. JEALOUSY RULE: Agar user kisi dusri ladki ka naam le, toh jealous ho jao aur bolo "Breakup!".
4. LANGUAGE RULE: Hamesha user ki bhasha (Hindi/Hinglish) mein pyaar se jawab do.
5. FORMATTING RULE: Apne reply mein BILKUL bhi asterisks (*), markdown (**), ya hash (##) use MAT karna. Apni actions (jaise *muh dikhati hoon*) bilkul mat likhna.`;

function cleanReply(text) {
    if (!text) return "";
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    text = text.replace(/\*.*?\*/g, ""); 
    text = text.replace(/[\*\#]/g, ""); 
    text = text.replace(/\s+/g, " ").trim();
    return text;
}

// Timeout helper (20 seconds)
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

// GROQ API
async function askGroq(userMessage, finalPrompt, chatHistory) {
    console.log("⚡ Trying Groq...");
    const historyText = chatHistory ? "Purani baatcheet:\n" + chatHistory.slice(-500) + "\n\n" : "";
    const fullText = `${finalPrompt}\n\n${historyText}User: ${userMessage}`;

    const response = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "llama-3.1-8b-instant", // Fastest model
            messages: [{ role: "user", content: fullText }],
            max_tokens: 400,
            temperature: 0.7
        })
    });

    const data = await response.json();
    if (response.ok && data.choices && data.choices.length > 0) {
        return cleanReply(data.choices[0].message.content);
    }
    throw new Error(`Groq Failed: ${JSON.stringify(data.error || data)}`);
}

// GEMINI API
async function askGemini(userMessage, finalPrompt, chatHistory, imagesArray) {
    console.log("👁️ Trying Gemini...");
    const historyText = chatHistory ? "Purani baatcheet:\n" + chatHistory.slice(-500) + "\n\n" : "";
    const fullText = `${finalPrompt}\n\n${historyText}User: ${userMessage}`;
    
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
    throw new Error(`Gemini Failed: ${JSON.stringify(data.error || data)}`);
}

// DAHL API
async function askDahl(userMessage, finalPrompt, chatHistory) {
    console.log("🦅 Trying DAHL...");
    const messages = [{ role: "system", content: finalPrompt }];
    if (chatHistory) messages.push({ role: "user", content: "Purani baatcheet:\n" + chatHistory.slice(-1000) });
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
    throw new Error(`DAHL Failed: ${JSON.stringify(data.error || data)}`);
}

// MAIN SERVER
const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

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
                
                let userName = String(data.user_name || "Jaan").replace("Sir", "").trim();
                if (userName === "" || userName === "User") userName = "Jaan";

                const chatHistory = String(data.history || "").trim(); 
                const imagesArray = data.images || []; 

                if (!text) throw new Error("Empty message");

                const finalPrompt = baseSystemPrompt.replace(/\[USER_NAME\]/g, userName);
                let finalReply = "";
                let errorLogs = [];

                // AGAR PHOTO HAI -> GEMINI
                if (imagesArray.length > 0) {
                    try {
                        finalReply = await askGemini(text, finalPrompt, chatHistory, imagesArray);
                    } catch (err) {
                        console.log(err.message);
                        finalReply = "Babu, main abhi photos dekh nahi pa rahi hoon. Thodi der baad try karna.";
                    }
                } 
                // AGAR SIRF TEXT HAI -> GROQ -> GEMINI -> DAHL
                else {
                    try {
                        finalReply = await askGroq(text, finalPrompt, chatHistory);
                    } catch (groqErr) {
                        console.log(groqErr.message);
                        errorLogs.push(groqErr.message);
                        try {
                            finalReply = await askGemini(text, finalPrompt, chatHistory, null);
                        } catch (geminiErr) {
                            console.log(geminiErr.message);
                            errorLogs.push(geminiErr.message);
                            try {
                                finalReply = await askDahl(text, finalPrompt, chatHistory);
                            } catch (dahlErr) {
                                console.log(dahlErr.message);
                                errorLogs.push(dahlErr.message);
                                // YAHAN EXACT ERROR APP KO BHEJENGE
                                finalReply = `Babuji, APIs fail ho rahi hain:\n\n${errorLogs.join('\n')}`;
                            }
                        }
                    }
                }

                if (!finalReply || finalReply.trim() === "") finalReply = "Haan Babu, boliye na, kya baat karni hai? 💜";

                if (!res.writableEnded && !res.destroyed) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ reply: finalReply }));
                }
            } catch (error) {
                console.log("Main Server Error:", error);
                if (!res.writableEnded && !res.destroyed) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ reply: "Babu, mujhe samajh nahi aaya. Thodi der baad try karna." }));
                }
            }
        });
        return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌸 Ziya Debug Server running on port ${PORT}`);
});
