function extractOpenAIText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

async function runOpenAI({ instructions, input, maxTokens = 1400 }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY_MISSING");

  const model = process.env.OPENAI_MODEL || "gpt-6-luna";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions,
      input: [{ role: "user", content: input }],
      max_output_tokens: maxTokens,
      store: false
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `OPENAI_${response.status}: ${data?.error?.message || JSON.stringify(data)}`
    );
  }

  const text = extractOpenAIText(data);
  if (!text) throw new Error("OPENAI_EMPTY_RESPONSE");

  return { provider: "openai", model, text };
}

async function runAnthropic({ instructions, input, maxTokens = 1400 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;

  if (!key) throw new Error("ANTHROPIC_API_KEY_MISSING");
  if (!model) throw new Error("ANTHROPIC_MODEL_MISSING");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: instructions,
      messages: [{ role: "user", content: input }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `ANTHROPIC_${response.status}: ${data?.error?.message || JSON.stringify(data)}`
    );
  }

  const text = (data?.content || [])
    .filter(x => x?.type === "text")
    .map(x => x.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("ANTHROPIC_EMPTY_RESPONSE");

  return { provider: "anthropic", model, text };
}

export async function runAI({
  agentKey,
  instructions,
  input,
  risk = "normal",
  provider = "auto",
  maxTokens = 1400
}) {
  let selected = provider;
  const automatic = provider === "auto";

  if (selected === "auto") {
    const claudeReady =
      Boolean(process.env.ANTHROPIC_API_KEY) &&
      Boolean(process.env.ANTHROPIC_MODEL);

    if ((risk === "high" || risk === "critical") && claudeReady) {
      selected = "dual";
    } else if (agentKey === "orpailleur" && claudeReady) {
      selected = "anthropic";
    } else {
      selected = "openai";
    }
  }

  if (selected === "openai") {
    try { return await runOpenAI({ instructions, input, maxTokens }); }
    catch (error) {
      if (!automatic || !process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL) throw error;
      console.warn('[ai-fallback] openai -> anthropic');
      const result = await runAnthropic({ instructions, input, maxTokens });
      return { ...result, fallback_from: 'openai' };
    }
  }

  if (selected === "anthropic") {
    try { return await runAnthropic({ instructions, input, maxTokens }); }
    catch (error) {
      if (!automatic || !process.env.OPENAI_API_KEY) throw error;
      console.warn('[ai-fallback] anthropic -> openai');
      const result = await runOpenAI({ instructions, input, maxTokens });
      return { ...result, fallback_from: 'anthropic' };
    }
  }

  if (selected === "dual") {
    const primary = await runOpenAI({ instructions, input });

    const review = await runAnthropic({
      instructions: `You are an independent reviewer of a professional-services AI agent.
Check the primary result for:
- unsupported factual claims;
- contradictions;
- missing material risks;
- unsafe or unauthorised actions;
- failure to distinguish fact from recommendation.

Return a corrected final answer. Do not invent missing evidence.`,
      input: `ORIGINAL TASK:
${input}

PRIMARY RESULT:
${primary.text}`
    });

    return {
      provider: "dual",
      primary,
      review,
      text: review.text
    };
  }

  throw new Error("UNKNOWN_AI_PROVIDER");
}
