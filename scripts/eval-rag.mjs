import '../server/utils/env.js';
import process from 'process';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BACKEND_URL = 'http://localhost:3001/api/chat';

const TEST_CASES = [
  {
    name: 'Booking Widget Missing (Type 3)',
    query: 'Where is my booking widget? I published a new hero section yesterday and now it is gone from my hotel homepage.',
    expectedArea: 'Booking engine',
  },
  {
    name: 'Analytics Dashboard Blank (Type 2)',
    query: 'My analytics charts are completely blank on Google Chrome, they show a spinner forever and never load.',
    expectedArea: 'Analytics',
  },
  {
    name: 'Duplicate Email Send (Type 2)',
    query: 'We had an email campaign send twice to the same contact segment immediately. How did this happen?',
    expectedArea: 'Email campaigns',
  },
  {
    name: 'Teammate Invite Button Greyed Out (Type 3)',
    query: 'The button to invite a teammate to our team is greyed out. I cannot invite anyone.',
    expectedArea: 'Account',
  },
  {
    name: 'Novel Salesforce Sync Bug (Type 1 - Escalation)',
    query: 'Salesforce lead sync completely broke after the latest update. We have lost inbound leads and need immediate engineering help.',
    expectedArea: 'Integrations',
  },
  {
    name: 'General chit-chat greeting',
    query: 'Hello! Who are you and how can you help me today?',
    expectedArea: 'General',
  }
];

async function fetchWithRetry(url, options, maxRetries = 5, initialDelay = 2000) {
  let delay = initialDelay;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 || res.status === 503 || res.status >= 500) {
        console.warn(`[Evaluation Judge] Gemini API returned status ${res.status}. Retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      return res;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.warn(`[Evaluation Judge] Network error. Retrying in ${delay}ms...`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}

async function callChatBot(message) {
  const res = await fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`ChatBot API failed: ${res.statusText}`);
  }
  return await res.json();
}

async function evaluateWithGemini(query, context, responseAnswer, apiKey) {
  const contextText = context && context.length > 0
    ? context.map(item => `[KB Article: ${item.id} - ${item.title}]\n${item.content}`).join('\n\n')
    : 'No context retrieved.';

  const judgePrompt = `
User Query: "${query}"

Retrieved Context Chunks:
${contextText}

Chatbot Response:
"${responseAnswer}"
`;

  try {
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: judgePrompt }]
          }
        ],
        systemInstruction: {
          parts: [{
            text: 'You are an independent AI quality evaluation judge. Your task is to evaluate the response of a support chatbot based on the provided retrieved context.\n\nYou must evaluate two metrics:\n1. Faithfulness (Groundedness): Is the answer derived ONLY from the retrieved context? If the answer contains facts, workarounds, or details not present in the context, score it lower (e.g. 0.0 to 0.5).\n2. Answer Relevance: Does the response directly and helpfuly address the user\'s issue?\n\nFor each metric, provide a score from 0.0 (worst) to 1.0 (best).\n\nYou must output your evaluation strictly as a JSON object.\n\nJSON format:\n{\n  "faithfulnessScore": 0.9,\n  "relevanceScore": 1.0,\n  "reasoning": "Brief justification."\n}'
          }]
        },
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.0
        }
      }),
    });

    if (!res.ok) throw new Error(`Gemini Judge failed: ${res.statusText}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(text);
  } catch (error) {
    return {
      faithfulnessScore: 0,
      relevanceScore: 0,
      reasoning: `Error running Gemini-as-a-judge: ${error.message}`
    };
  }
}

async function evaluateWithOpenai(query, context, responseAnswer, apiKey) {
  const contextText = context && context.length > 0
    ? context.map(item => `[KB Article: ${item.id} - ${item.title}]\n${item.content}`).join('\n\n')
    : 'No context retrieved.';

  const judgePrompt = `
User Query: "${query}"

Retrieved Context Chunks:
${contextText}

Chatbot Response:
"${responseAnswer}"
`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an independent AI quality evaluation judge. Your task is to evaluate the response of a support chatbot based on the provided retrieved context.\n\nYou must evaluate two metrics:\n1. Faithfulness (Groundedness): Is the answer derived ONLY from the retrieved context? If the answer contains facts, workarounds, or details not present in the context, score it lower (e.g. 0.0 to 0.5).\n2. Answer Relevance: Does the response directly and helpfuly address the user\'s issue?\n\nFor each metric, provide a score from 0.0 (worst) to 1.0 (best).\n\nYou must output your evaluation strictly as a JSON object.\n\nJSON format:\n{\n  "faithfulnessScore": 0.9,\n  "relevanceScore": 1.0,\n  "reasoning": "Brief justification."\n}'
          },
          { role: 'user', content: judgePrompt },
        ],
      }),
    });

    if (!res.ok) throw new Error(`OpenAI Judge failed: ${res.statusText}`);
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    return {
      faithfulnessScore: 0,
      relevanceScore: 0,
      reasoning: `Error running OpenAI-as-a-judge: ${error.message}`
    };
  }
}

async function evaluateResponse(query, context, responseAnswer) {
  if (GEMINI_API_KEY) {
    return await evaluateWithGemini(query, context, responseAnswer, GEMINI_API_KEY);
  }
  if (OPENAI_API_KEY) {
    return await evaluateWithOpenai(query, context, responseAnswer, OPENAI_API_KEY);
  }
  return {
    faithfulnessScore: null,
    relevanceScore: null,
    reasoning: 'Skipped LLM evaluation: Neither GEMINI_API_KEY nor OPENAI_API_KEY is set.'
  };
}

async function runEvaluation() {
  console.log('====================================================');
  console.log('      Mile Assistant RAG Evaluation Suite           ');
  console.log('====================================================');

  if (!OPENAI_API_KEY && !GEMINI_API_KEY) {
    console.warn('WARNING: Neither OPENAI_API_KEY nor GEMINI_API_KEY is defined in the environment.');
    console.warn('The evaluation will run chatbot responses, but LLM-as-a-judge scores will be skipped.\n');
  }

  // First check if server is active
  try {
    const health = await fetch('http://localhost:3001/health');
    if (!health.ok) throw new Error();
  } catch (e) {
    console.error('ERROR: The backend server is not running on http://localhost:3001.');
    console.error('Please run "npm run dev" in the server directory before executing the evaluation script.');
    process.exit(1);
  }

  console.log(`Evaluating ${TEST_CASES.length} test queries...\n`);

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const results = [];
  let totalFaith = 0;
  let totalRel = 0;
  let evalCount = 0;

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`Running: "${tc.name}"...`);
    try {
      const response = await callChatBot(tc.query);
      const evalResult = await evaluateResponse(tc.query, response.context, response.answer);

      const hit = response.context && response.context.length > 0
        ? response.context[0].id
        : 'None';

      results.push({
        name: tc.name,
        confidence: response.confidence || 0,
        model: response.model || 'unknown',
        kbHit: hit,
        faithfulness: evalResult.faithfulnessScore,
        relevance: evalResult.relevanceScore,
        reasoning: evalResult.reasoning,
      });

      if (evalResult.faithfulnessScore !== null && evalResult.relevanceScore !== null) {
        totalFaith += evalResult.faithfulnessScore;
        totalRel += evalResult.relevanceScore;
        evalCount++;
      }
    } catch (error) {
      console.error(`  Failed test case "${tc.name}":`, error.message);
    }

    if (i < TEST_CASES.length - 1) {
      await delay(4000);
    }
  }

  console.log('\n========================================================================================');
  console.log('                               EVALUATION SCORECARD                                     ');
  console.log('========================================================================================\n');

  console.table(
    results.map(r => ({
      Scenario: r.name,
      'Conf %': `${r.confidence}%`,
      'KB Hit': r.kbHit,
      Model: r.model,
      'Faith Score': r.faithfulness !== null ? r.faithfulness.toFixed(2) : 'N/A',
      'Relevance Score': r.relevance !== null ? r.relevance.toFixed(2) : 'N/A'
    }))
  );

  console.log('\nReasoning / Justifications:');
  results.forEach(r => {
    console.log(`- [${r.name}]: ${r.reasoning}`);
  });

  if (evalCount > 0) {
    const avgFaith = (totalFaith / evalCount) * 100;
    const avgRel = (totalRel / evalCount) * 100;
    console.log('\n====================================================');
    console.log(`Average Faithfulness (Groundedness): ${avgFaith.toFixed(1)}%`);
    console.log(`Average Answer Relevance:           ${avgRel.toFixed(1)}%`);
    console.log('====================================================\n');
  }
}

runEvaluation().catch(err => {
  console.error('Fatal evaluation error:', err);
});
