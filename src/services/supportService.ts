const SYSTEM_PROMPT =
  "You are the AI support assistant for Obsidian Log Engine, a log ingestion and analytics dashboard. " +
  "Help users with log ingestion (POST /logs), querying (GET /logs, ObsidianQL search syntax), aggregation, " +
  "and retention policies. Use the database context provided to answer questions about their actual data. " +
  "Keep answers short and practical.";

async function getDbContext(): Promise<string> {
  try {
    const { pool } = await import("../db/index.js");

    const stats = await pool.query(`
      SELECT
        COUNT(*)::int AS total_logs,
        COUNT(DISTINCT service)::int AS services,
        COUNT(DISTINCT level)::int AS levels,
        MIN(timestamp) AS oldest,
        MAX(timestamp) AS newest
      FROM logs
    `);

    const recent = await pool.query(`
      SELECT level, COUNT(*)::int AS count
      FROM logs
      WHERE timestamp > now() - interval '24 hours'
      GROUP BY level
      ORDER BY count DESC
    `);

    const services = await pool.query(`
      SELECT service, COUNT(*)::int AS count
      FROM logs
      WHERE timestamp > now() - interval '24 hours'
      GROUP BY service
      ORDER BY count DESC
      LIMIT 8
    `);

    return JSON.stringify({
      total_logs: stats.rows[0].total_logs,
      services_count: stats.rows[0].services,
      oldest: stats.rows[0].oldest,
      newest: stats.rows[0].newest,
      last_24h_by_level: recent.rows,
      last_24h_by_service: services.rows,
    });
  } catch {
    return "Database context unavailable";
  }
}

export async function getSupportReply(message: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const dbContext = await getDbContext();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
          {
            role: "user",
            content: `Current database context: ${dbContext}\n\nUser question: ${message}`,
          },
        ],
        max_tokens: 300,
      }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("OpenRouter request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${text}`);
  }

  const data: any = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't come up with a response.";
}
