const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log("ENV CHECK - TELEGRAM_TOKEN:", TELEGRAM_TOKEN ? "set" : "MISSING");
console.log("ENV CHECK - TELEGRAM_CHAT_ID:", TELEGRAM_CHAT_ID);
console.log("ENV CHECK - OPENAI_API_KEY:", OPENAI_API_KEY ? "set" : "MISSING");

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
  console.log("File info:", JSON.stringify(fileInfo));
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
          content: `You are a to-do list assistant. The user will tell you something they want added to their to-do list or an action to take. Confirm what you understood and what action you will take. Keep it short and friendly, one or two sentences max.`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    }),
  });
  const data = await res.json();
  console.log("GPT response:", JSON.stringify(data));
  return data.choices[0].message.content;
}

module.exports = async function handler(req, res) {
  console.log("Webhook hit - method:", req.method);

  if (req.method !== "POST") {
    console.log("Not a POST, returning early");
    return res.status(200).json({ ok: true });
  }

  try {
    const body = req.body;
    console.log("Incoming body:", JSON.stringify(body));

    const message = body?.message;
    console.log("Message:", JSON.stringify(message));

    if (!message) {
      console.log("No message found, returning early");
      return res.status(200).json({ ok: true });
    }

    console.log("Incoming chat.id:", String(message.chat.id));
    console.log("Expected TELEGRAM_CHAT_ID:", String(TELEGRAM_CHAT_ID));
    console.log("Match:", String(message.chat.id) === String(TELEGRAM_CHAT_ID));

    // Security check: only respond to your own chat
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
      console.log("No user text extracted, returning early");
      return res.status(200).json({ ok: true });
    }

    console.log("Processing with GPT:", userText);
    const reply = await processWithGPT(userText);
    console.log("Got reply:", reply);
    await sendTelegramMessage(reply);

    console.log("Done, returning 200");
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    console.error("Stack:", err.stack);
    return res.status(200).json({ ok: true });
  }
};