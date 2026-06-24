const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_DOC_ID = process.env.GOOGLE_DOC_ID;
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const SIRI_AUTH_TOKEN = process.env.SIRI_AUTH_TOKEN;

console.log("ENV CHECK - TELEGRAM_TOKEN:", TELEGRAM_TOKEN ? "set" : "MISSING");
console.log("ENV CHECK - TELEGRAM_CHAT_ID:", TELEGRAM_CHAT_ID);
console.log("ENV CHECK - OPENAI_API_KEY:", OPENAI_API_KEY ? "set" : "MISSING");
console.log("ENV CHECK - GOOGLE_DOC_ID:", GOOGLE_DOC_ID ? "set" : "MISSING");
console.log("ENV CHECK - GOOGLE_SERVICE_ACCOUNT:", GOOGLE_SERVICE_ACCOUNT ? "set" : "MISSING");
console.log("ENV CHECK - SIRI_AUTH_TOKEN:", SIRI_AUTH_TOKEN ? "set" : "MISSING");

// --- Google Auth ---
async function getGoogleAccessToken() {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: GOOGLE_SERVICE_ACCOUNT.client_email,
    scope: "https://www.googleapis.com/auth/documents",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encode = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const headerB64 = encode(header);
  const claimB64 = encode(claim);
  const signingInput = `${headerB64}.${claimB64}`;

  const privateKeyPem = GOOGLE_SERVICE_ACCOUNT.private_key;
  const pemContents = privateKeyPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signingInput}.${signatureB64}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  console.log("Google token response:", JSON.stringify(tokenData));
  return tokenData.access_token;
}

// --- Google Docs ---
async function getDocContent(accessToken) {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${GOOGLE_DOC_ID}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return await res.json();
}

async function findInbooxIndex(doc) {
  const content = doc.body.content;
  for (const element of content) {
    if (element.paragraph) {
      for (const el of element.paragraph.elements) {
        if (el.textRun && el.textRun.content.includes("Inboox")) {
          return element.endIndex - 1;
        }
      }
    }
  }
  return null;
}

async function insertTextAfterInboox(accessToken, index, text) {
  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${GOOGLE_DOC_ID}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index }, text: `\n${text}` } }],
      }),
    }
  );
  const data = await res.json();
  console.log("Docs insert response:", JSON.stringify(data));
  return data;
}

// --- GPT ---
async function processWithGPT(userMessage) {
  console.log("Sending to GPT:", userMessage);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `You are a to-do list assistant. The user will tell you something they want added to their to-do list. Extract just the task itself, clean and concise, no extra words. Return only the task text, nothing else. No bullet points, no dashes, no numbering.`,
        },
        { role: "user", content: userMessage },
      ],
    }),
  });
  const data = await res.json();
  console.log("GPT response:", JSON.stringify(data));
  return data.choices[0].message.content.trim();
}

// --- Telegram ---
async function sendTelegramMessage(text) {
  console.log("Sending Telegram message:", text);
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
  const data = await res.json();
  console.log("Telegram sendMessage response:", JSON.stringify(data));
}

async function downloadVoiceFile(fileId) {
  console.log("Downloading voice file:", fileId);
  const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`;
  const fileInfoRes = await fetch(fileInfoUrl);
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const audioRes = await fetch(fileUrl);
  return await audioRes.arrayBuffer();
}

async function transcribeAudio(audioBuffer) {
  console.log("Transcribing audio, buffer size:", audioBuffer.byteLength);
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: "audio/ogg" });
  formData.append("file", blob, "voice.ogg");
  formData.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  const data = await res.json();
  console.log("Whisper response:", JSON.stringify(data));
  return data.text;
}

// --- Core Task Handler ---
async function handleTask(userText, replyFn) {
  const accessToken = await getGoogleAccessToken();
  const doc = await getDocContent(accessToken);
  const inbooxIndex = await findInbooxIndex(doc);

  if (inbooxIndex === null) {
    await replyFn("❌ Couldn't find the Inboox section in your doc. Make sure it exists!");
    return;
  }

  const task = await processWithGPT(userText);
  console.log("Extracted task:", task);
  await insertTextAfterInboox(accessToken, inbooxIndex, task);
  await replyFn(`✅ Added to Inboox: "${task}"`);
}

// --- Main Handler ---
module.exports = async function handler(req, res) {
  console.log("Webhook hit - method:", req.method);

  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  try {
    const body = req.body;
    console.log("Incoming body:", JSON.stringify(body));

    // --- Siri direct call ---
    if (body?.source === "siri") {
      console.log("Siri request received");

      // Auth check
      const authHeader = req.headers["authorization"];
      if (!authHeader || authHeader !== `Bearer ${SIRI_AUTH_TOKEN}`) {
        console.log("Siri auth failed");
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      const userText = body.text;
      if (!userText) {
        return res.status(200).json({ ok: true });
      }

      // Respond immediately so Siri doesn't time out
      res.status(200).json({ ok: true });
      await handleTask(userText, sendTelegramMessage);
      return;
    }

    // --- Telegram event ---
    const message = body?.message;
    if (!message) {
      return res.status(200).json({ ok: true });
    }

    if (String(message.chat.id) !== String(TELEGRAM_CHAT_ID)) {
      console.log("Chat ID mismatch, rejecting");
      return res.status(200).json({ ok: true });
    }

    let userText = "";

    if (message.text) {
      console.log("Text message received:", message.text);
      userText = message.text;
    } else if (message.voice) {
      console.log("Voice message received");
      await sendTelegramMessage("🎙️ Got your voice memo, transcribing...");
      const audioBuffer = await downloadVoiceFile(message.voice.file_id);
      userText = await transcribeAudio(audioBuffer);
      await sendTelegramMessage(`📝 Transcribed: "${userText}"`);
    }

    if (!userText) {
      return res.status(200).json({ ok: true });
    }

    await handleTask(userText, sendTelegramMessage);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Webhook error:", err.message);
    console.error("Stack:", err.stack);
    await sendTelegramMessage("❌ Something went wrong, check the logs.");
    return res.status(200).json({ ok: true });
  }
}