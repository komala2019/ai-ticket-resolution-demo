import { Component } from '@angular/core';

interface Layer {
  name: string;
  tone: string;
  accent: string;
  blurb: string;
  items: { label: string; sub?: string }[];
}

interface RouteBand { label: string; range: string; hex: string; human: string; }
interface SeqStep { actor: 'customer' | 'ai' | 'cs' | 'eng'; text: string; }

@Component({
  selector: 'app-tr-architecture',
  templateUrl: './architecture.component.html',
  styleUrls: ['./architecture.component.scss'],
})
export class ArchitectureComponent {
  activeTab: 'layers' | 'sequence' | 'decisions' | 'roadmap' = 'layers';

  layers: Layer[] = [
    {
      name: 'User Interface (Visuals)',
      tone: 'blue',
      accent: 'var(--primary-600)',
      blurb: 'The interactive screens that customers and support agents use.',
      items: [
        { label: 'Customer Chat Screen', sub: 'Where customers describe their issues and talk to the assistant' },
        { label: 'Agent Console', sub: 'Where support agents approve drafts or write custom replies' },
        { label: 'Analytics Dashboard', sub: 'Displays live metrics like deflection rate and recent session activity' },
        { label: 'Interactive Settings', sub: 'Sliders to adjust AI confidence limits in real-time' },
      ],
    },
    {
      name: 'Triage & Brains (Logic)',
      tone: 'purple',
      accent: 'var(--purple-500)',
      blurb: 'The logic that reads questions, determines AI confidence, routes tickets, and handles notifications.',
      items: [
        { label: 'Confidence Classifier', sub: 'Calculates how confident the AI is in resolving the question' },
        { label: 'Triage Engine', sub: 'Decides if a ticket goes to auto-resolve, CS review, or engineering' },
        { label: 'Shared Session Sync', sub: 'Synchronizes all actions across chat, console, and analytics instantly' },
        { label: 'Notification System', sub: 'Triggers the topbar alert bell for new tickets or system updates' },
      ],
    },
    {
      name: 'Data & Memory (Storage)',
      tone: 'green',
      accent: 'var(--success-600)',
      blurb: 'The simulated data and knowledge base that powers the entire demo.',
      items: [
        { label: 'Knowledge Base (KB)', sub: 'Help articles used to find fixes and answers' },
        { label: 'Customer Scenarios', sub: 'Predefined testing flows (e.g., widget missing, sync broken)' },
        { label: 'Active Ticket Queue', sub: 'List of tickets currently awaiting review or escalated' },
        { label: 'Analytics Baselines', sub: 'Historical starting points for metrics and deflection graphs' },
      ],
    },
  ];

  routeBands: RouteBand[] = [
    { label: 'Auto-resolve', range: '>= 90', hex: 'var(--success-600)', human: 'No human touch' },
    { label: 'CS approval', range: '75-89', hex: 'var(--primary-600)', human: 'CS approves or edits' },
    { label: 'CS rewrite', range: '50-74', hex: 'var(--warning-600)', human: 'CS full review' },
    { label: 'Eng queue', range: '< 50', hex: 'var(--error-600)', human: 'Eng manual resolution' },
  ];

  sequence: SeqStep[] = [
    { actor: 'customer', text: 'Describes the issue in plain language' },
    { actor: 'ai', text: 'Asks targeted clarifying questions if details are missing' },
    { actor: 'ai', text: 'Searches knowledge base and past cases to calculate a confidence score' },
    { actor: 'ai', text: 'Categorizes the score into a route band (Auto-resolve, Review, or Escalation)' },
    { actor: 'cs', text: 'If review is needed, a customer support agent reviews the draft response' },
    { actor: 'eng', text: 'If it is a new or unknown issue, the AI escalates it to engineering with all diagnostics' },
    { actor: 'customer', text: 'Confirms if the solution worked, which helps train the AI' },
  ];

  actorMeta: Record<string, { label: string; hex: string }> = {
    customer: { label: 'Customer', hex: 'var(--gray-600)' },
    ai: { label: 'AI', hex: 'var(--primary-600)' },
    cs: { label: 'CS rep', hex: 'var(--warning-600)' },
    eng: { label: 'Eng', hex: 'var(--purple-500)' },
  };

  decisions = [
    {
      title: 'All-in-one demo experience',
      body: 'The customer chat, support agent console, and analytics are built into a single app so you can switch views and see how they interact immediately.',
    },
    {
      title: 'Instant visual updates',
      body: 'A shared memory core synchronizes everything. If you resolve a ticket in chat, the metrics dashboard and notification bell update instantly.',
    },
    {
      title: 'Interactive triage rules',
      body: 'Triage rules are computed live. Dragging the confidence sliders immediately re-calculates which route tickets take, without breaking any active flows.',
    },
    {
      title: 'Continuous feedback loops',
      body: 'Actions taken on one screen automatically benefit others. For example, a customer\'s confirmation of a fix boosts AI accuracy metrics, and agent edits help expand the knowledge base.',
    },
    {
      title: 'Safety baseline checks',
      body: 'A Golden Set checklist tests standard customer issues against the active system, making it easy to confirm that tuning the sliders doesn\'t cause unexpected mistakes.',
    },
    {
      title: 'Runs entirely offline',
      body: 'The demo includes all scenarios, tickets, and knowledge base articles locally, meaning the entire experience works without requiring external databases or paid API keys.',
    },
  ];

  roadmap = [
    {
      title: 'AI Search & Knowledge Retrieval (RAG)',
      implemented: [
        { label: 'Basic Keyword Search', desc: 'The AI looks for exact matching words between the customer\'s question and the knowledge base.' },
        { label: 'Evidence Finder', desc: 'Queries the knowledge base and pulls up the top matching articles to use as context.' }
      ],
      pending: [
        { label: 'Smart Semantic Matching', desc: 'Teach the AI to understand the meaning behind questions, even if customers use different words (e.g., matching "billing issue" to a "stripe credit card error" article).' },
        { label: 'Dedicated Search Database', desc: 'Set up a database specifically optimized for complex AI search to return faster, more accurate results.' }
      ]
    },
    {
      title: 'AI Chat Answers & Triage',
      implemented: [
        { label: 'Smart Draft Generation', desc: 'The system uses an advanced AI model (powered by OpenAI) to write helpful support replies.' },
        { label: 'Offline Fallback', desc: 'If the AI backend is unreachable, the system automatically uses local rules to keep the demo interactive.' }
      ],
      pending: [
        { label: 'Neat Structured Answers', desc: 'Ensures the AI output follows a strict structure, making it extract diagnostic details (like error logs) cleanly without guessing.' },
        { label: 'Learning from Agents', desc: 'Automatically feed human-approved drafts and updates back to the AI as examples to help it improve future answers.' }
      ]
    },
    {
      title: 'Memory & Interactive Safety',
      implemented: [
        { label: 'Triage Slider Controls', desc: 'Allows business leaders to drag sliders to adjust the confidence score required for auto-resolving tickets.' },
        { label: 'Interactive Simulator', desc: 'Enables users to replay preset issues to see how the customer and agent screens interact live.' }
      ],
      pending: [
        { label: 'Chat Thread Memory', desc: 'Give the AI memory of the entire chat conversation so it understands follow-up questions contextually.' },
        { label: 'Safety Evaluation Guard', desc: 'Build an automated testing bot to verify that any changes to the system do not cause AI accuracy to drop.' }
      ]
    }
  ];
}
