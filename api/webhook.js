const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
}

async function downloadVoiceFile(fileId) {
  const fileInfoUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`;
  const fileInfoRes = await fetch(fileInfoUrl);
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const audioRes = await fetch(fileUrl);
  return await audioRes.arrayBuffer();
}

async function transcribeAudio(audioBuffer) {
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
  return data.text;
}

async function processWithGPT(userMessage) {
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
  return data.choices[0].message.content;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  try {
    const body = req.body;
    const message = body?.message;

    if (!message) {
      return res.status(200).json({ ok: true });
    }

    // Security check: only respond to your own chat
    if (String(message.chat.id) !== String(TELEGRAM_CHAT_ID)) {
      return res.status(200).json({ ok: true });
    }

    let userText = "";

    if (message.text) {
      // Option 1: plain text message
      userText = message.text;
    } else if (message.voice) {
      // Option 2: voice memo, download and transcribe
      await sendTelegramMessage("🎙️ Got your voice memo, transcribing...");
      const audioBuffer = await downloadVoiceFile(message.voice.file_id);
      userText = await transcribeAudio(audioBuffer);
      await sendTelegramMessage(`📝 Transcribed: "${userText}"`);
    }

    if (!userText) {
      return res.status(200).json({ ok: true });
    }

    const reply = await processWithGPT(userText);
    await sendTelegramMessage(reply);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: true });
  }
};