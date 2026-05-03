// Server-side cache — shared across requests for 12 hours
const CACHE_DURATION = 12 * 60 * 60 * 1000;
if (!global._aibCache) global._aibCache = { articles: null, timestamp: 0, date: null };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const today = req.body?.today || new Date().toISOString().split("T")[0];

  // Return cached result if still fresh — no Anthropic call needed
  const cache = global._aibCache;
  if (cache.articles && (Date.now() - cache.timestamp) < CACHE_DURATION) {
    return res.status(200).json({ articles: cache.articles, date: cache.date, cached: true });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system:
          'You are an AI news curator for "AI Build by Madhur". Today is ' + today +
          '. Search the web for the latest AI news from the past 1-3 days. Find 6-8 diverse stories across LLMs, agentic systems, RAG, multimodal models, AI safety, AI tools, and industry news.\n\nReturn ONLY a valid JSON array (no markdown, no backticks, no preamble) with objects:\n- title: string\n- summary: string (2-3 sentences)\n- url: string (real article URL)\n- source: string\n- date: string (e.g. "May 2")\n- tags: array of 1-2 from ["llm","agentic","rag","multimodal","research","tools","safety","industry"]\n\nReturn ONLY the JSON array.',
        messages: [
          { role: "user", content: "Get today's top AI news (" + today + "), return as JSON array." },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err?.error?.message || "Anthropic API error" });
    }

    const data = await response.json();
    const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const clean = txt.replace(/```json|```/g, "").trim();
    const s = clean.indexOf("["), e = clean.lastIndexOf("]");
    if (s < 0 || e < 0) throw new Error("Could not parse news response");

    const articles = JSON.parse(clean.slice(s, e + 1));

    // Store in server cache
    global._aibCache = { articles, timestamp: Date.now(), date: today };

    return res.status(200).json({ articles, date: today, cached: false });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
