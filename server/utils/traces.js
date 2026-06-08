import fs from 'fs';
import path from 'path';

const traceFile = path.join(process.cwd(), 'traces.log');

export function trace(event, payload) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    payload,
  };
  fs.appendFileSync(traceFile, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}
