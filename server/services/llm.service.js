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

export async function generateAnswer(message, context) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return fallbackAnswer(message, context);
  }

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

    if (!res.ok) throw new Error('OpenAI request failed');
    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content || 'No reply returned.';

    return {
      route: 'openai-llm',
      model: OPENAI_MODEL,
      answer,
      confidence: 88,
    };
  } catch (error) {
    return fallbackAnswer(message, context);
  }
}
