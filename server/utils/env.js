import fs from 'fs';
import path from 'path';

const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'environment.env'),
  path.join(process.cwd(), 'server', '.env'),
  path.join(process.cwd(), 'server', 'environment.env'),
  path.join(process.cwd(), '..', '.env'),
  path.join(process.cwd(), '..', 'environment.env'),
];

for (const p of envPaths) {
  if (fs.existsSync(p)) {
    try {
      const content = fs.readFileSync(p, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const cleanLine = line.trim();
        if (cleanLine && !cleanLine.startsWith('#') && cleanLine.includes('=')) {
          const parts = cleanLine.split('=');
          const key = parts[0].trim();
          let val = parts.slice(1).join('=').trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1);
          }
          process.env[key] = val;
          console.log(`[Env Loader] Loaded ${key} from: ${p}`);
        }
      }
    } catch (e) {
      console.error("[Env Loader] Error reading file:", e);
    }
  }
}
