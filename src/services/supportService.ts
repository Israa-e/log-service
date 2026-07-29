const SYSTEM_PROMPT =
  "You are the AI support assistant for Obsidian Log Engine, a log ingestion and analytics dashboard. " +
  "Help users with log ingestion (POST /logs), querying (GET /logs, ObsidianQL search syntax), aggregation, " +
  "and retention policies. Keep answers short and practical.";

export async function getSupportReply(message: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/anomalyco/log-service",
      "X-Title": "Obsidian Log Engine",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${text}`);
  }

  const data: any = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't come up with a response.";
}
