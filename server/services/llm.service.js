async function fetchWithRetry(url, options, maxRetries = 5, initialDelay = 2000) {
  let delay = initialDelay;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 || res.status === 503 || res.status >= 500) {
        console.warn(`[LLM Service] Gemini API returned status ${res.status}. Retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      return res;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.warn(`[LLM Service] Network error. Retrying in ${delay}ms...`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function fallbackAnswer(message, context) {
  const top = context[0];
  const route = top && top.score > 0.1 ? 'kb-match' : 'fallback';
  return {
    route,
    model: 'demo-fallback',
    answer:
      top
        ? `I matched your issue to ${top.id} (${top.title}). Suggested path: use the KB guidance and confirm the fix.\n\nKB hint: ${top.content}`
        : 'I could not find a strong KB match. I recommend escalating this issue for specialist review.',
    confidence: top ? Math.min(97, Math.round(top.score * 100)) : 35,
  };
}

async function generateGeminiAnswer(message, context, apiKey, history = []) {
  const kbContext = context.map(item => `- ${item.id}: ${item.title}\n  ${item.content}`).join('\n\n');

  // Build multi-turn contents: prior turns first, then the current user message with KB context appended.
  const priorContents = history.map(turn => ({
    role: turn.role === 'ai' ? 'model' : 'user',
    parts: [{ text: turn.text }],
  }));

  const currentPrompt = [
    'Use the retrieved KB context to answer the customer issue.',
    'If the evidence is weak, recommend escalation.',
    '',
    'Customer message:',
    message,
    '',
    'Retrieved KB context:',
    kbContext,
  ].join('\n');

  const contents = [
    ...priorContents,
    { role: 'user', parts: [{ text: currentPrompt }] },
  ];

  try {
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{ text: 'You are Mile Assistant, a support copilot assistant for a ticket-resolution demo. If there is a matching KB article in the retrieved context that addresses the user query, start your response with a brief, friendly confirmation of what was matched (e.g., "Based on your description, I matched this to our knowledge base article: **[Article Title]**. Here is the recommended resolution:").' }]
        },
        generationConfig: {
          temperature: 0.2
        }
      }),
    });

    if (!res.ok) throw new Error(`Gemini request failed: ${res.statusText}`);
    const data = await res.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No reply returned.';

    return {
      route: 'gemini-llm',
      model: 'gemini-2.5-flash',
      answer,
      confidence: 90,
    };
  } catch (error) {
    console.error("Gemini chat generation failed:", error);
    throw error;
  }
}

async function generateOpenaiAnswer(message, context, apiKey) {
  const prompt = [
    'You are Mile Assistant, a support copilot.',
    'Use the retrieved KB context to answer the customer issue.',
    'If the evidence is weak, recommend escalation.',
    '',
    'Customer message:',
    message,
    '',
    'Retrieved KB context:',
    context.map(item => `- ${item.id}: ${item.title}\n  ${item.content}`).join('\n\n'),
  ].join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You are a support assistant for a ticket-resolution demo.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      let errText = '';
      try {
        errText = await res.text();
      } catch (_) {}
      throw new Error(`OpenAI request failed with status ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content || 'No reply returned.';

    return {
      route: 'openai-llm',
      model: OPENAI_MODEL,
      answer,
      confidence: 88,
    };
  } catch (error) {
    console.error("OpenAI chat generation failed:", error);
    throw error;
  }
}

export async function generateAnswer(message, context, history = []) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      return await generateGeminiAnswer(message, context, geminiKey, history);
    } catch (error) {
      console.warn("[LLM Service] Gemini generateAnswer failed. Trying OpenAI backup if key available...");
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      return await generateOpenaiAnswer(message, context, openaiKey);
    } catch (error) {
      console.error("[LLM Service] OpenAI generateAnswer failed:", error);
    }
  }

  return fallbackAnswer(message, context);
}
