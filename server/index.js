import './utils/env.js';
import cors from 'cors';
import express from 'express';
import { retrieveContext, initDatabase } from './services/vector.service.js';
import { generateAnswer } from './services/llm.service.js';
import { trace } from './utils/traces.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ strict: false }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mile-assistant-backend' });
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  return res.status(500).json({ ok: false, error: 'Internal server error' });
});

app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const context = await retrieveContext(message, 3);
  const answer = await generateAnswer(message, context, history);
  const traceEntry = trace('chat-request', { message, context, answer });

  res.json({
    ok: true,
    route: answer.route,
    answer: answer.answer,
    confidence: answer.confidence,
    model: answer.model,
    context,
    traceId: traceEntry.ts,
  });
});

const port = process.env.PORT || 3001;
initDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Mile Assistant API listening on http://localhost:${port}`);
  });
});
