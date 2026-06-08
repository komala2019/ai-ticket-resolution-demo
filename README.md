# AI Ticket Auto-Resolution Demo

An interactive Angular demo of a human-in-the-loop support workflow. It shows how a customer issue moves through self-service, CS review, and engineering escalation while the shared knowledge base and analytics update live.

> [!NOTE]
> The demo runs locally with bundled sample data. No backend is required to explore the customer view, CS console, README, or architecture tabs.

## What You Can Explore

- Customer chat with scenario-driven resolutions
- CS console with Approval Queue, Knowledge Base, Analytics, and Golden Set tabs
- Live notification bell and threshold tweaks in the shell
- In-app documentation for the project README and architecture overview

## How It Works

- Type 3 issues are solved in chat with a direct fix.
- Type 2 issues get a workaround and ETA for CS follow-up.
- Type 1 issues are escalated to engineering with the full context attached.
- Customer feedback feeds the shared state service so metrics, flags, and KB usage counts update immediately.

## Run Locally

Make sure Node.js 18 or newer is installed, then run:

```bash
npm install
npm start -- --port 4205
```

Open [http://localhost:4205](http://localhost:4205) in your browser.

## Build

```bash
npm run build
```

The production bundle is written to `dist-build/`.

## Key Source Files

- `src/app/ticket-resolution/ticket-data.ts` contains the shared demo data, thresholds, metrics, and scenarios.
- `src/app/ticket-resolution/demo-state.service.ts` owns the shared live state used across the chat, console, analytics, and notifications.
- `src/app/ticket-resolution/ticket-resolution.component.ts` controls the shell, view switching, tabs, and toasts.
