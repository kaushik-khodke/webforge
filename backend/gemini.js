import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

async function generateWithFallback(ai, request) {
  try { return await ai.models.generateContent({ ...request, model }); }
  catch (error) {
    const message = String(error?.message || error);
    if (fallbackModel === model || !/(404|429|500|502|503|504|not.found|resource.exhausted|quota|rate.limit|unavailable|overloaded)/i.test(message)) throw error;
    return ai.models.generateContent({ ...request, model: fallbackModel });
  }
}

export function geminiReady() { return Boolean(apiKey); }

function client() {
  if (!apiKey) throw new Error("Gemini is not configured on the server.");
  return new GoogleGenAI({ apiKey });
}

export async function extractVisualText(bytes, mimeType) {
  const response = await generateWithFallback(client(), {
    contents: [
      { text: "Extract all legible text from this health document. Preserve headings, dates, measurements, units, and table row relationships. Return only the extracted text. If nothing is legible, return exactly NO_READABLE_TEXT." },
      { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
    ],
    config: { temperature: 0, maxOutputTokens: 8192 },
  });
  const result = String(response.text || "").trim();
  return result === "NO_READABLE_TEXT" ? "" : result;
}

export async function generateAgentResponse({ instruction, history, question, image, tools, executeTool }) {
  const ai = client();
  const contents = history.map(item => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.content.slice(0, 6000) }],
  }));
  const userParts = [{ text: question }];
  if (image) userParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  contents.push({ role: "user", parts: userParts });
  const usedTools = [];

  for (let turn = 0; turn < 4; turn += 1) {
    const response = await generateWithFallback(ai, {
      contents,
      config: {
        systemInstruction: instruction,
        temperature: 0.25,
        maxOutputTokens: 1800,
        ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
      },
    });
    const candidate = response.candidates?.[0];
    if (!candidate?.content) throw new Error("The AI service did not return an answer. Please try again.");
    const calls = candidate.content.parts?.filter(part => part.functionCall).map(part => part.functionCall) || [];
    if (!calls.length) {
      const answer = candidate.content.parts?.map(part => part.text || "").join("").trim();
      if (!answer) throw new Error("The AI service returned an empty answer. Please try again.");
      return { answer, usedTools };
    }
    contents.push(candidate.content);
    const results = [];
    for (const call of calls) {
      const result = usedTools.length < 6 ? await executeTool(call.name, call.args || {}) : { error: "Tool step limit reached." };
      usedTools.push({ name: call.name, result });
      results.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: "user", parts: results });
  }
  throw new Error("The assistant needed too many steps for this request. Please ask a shorter question.");
}
