export const KB_ARTICLES = [
  {
    id: 'KB-001',
    title: 'Booking widget disappears after hero publish',
    content: 'When a new hero section is published, the booking widget block can revert to Draft visibility. To resolve this, open Content → Homepage → Layout, select the Booking widget block, toggle its settings to Published, and click Publish.',
    tags: ['booking engine', 'widgets', 'publish'],
    updated: '2d ago',
  },
  {
    id: 'KB-002',
    title: 'Analytics dashboard blank on Chrome 124+',
    content: 'Chart.js v3 has a known rendering issue on Chrome 124+ due to the offscreen canvas API change. Fix shipped in 3.14. Advise customers to use Firefox or Safari as a temporary workaround.',
    tags: ['analytics', 'chrome', 'charts'],
    updated: '5d ago',
  },
  {
    id: 'KB-003',
    title: 'Email campaign sends twice on rapid segment edit',
    content: 'A known race condition in the segment-save debounce causes a duplicate dispatch when the user edits a segment and triggers send within 800ms. Fixed in 3.14. Workaround: stagger edits 10+ minutes before send.',
    tags: ['email campaigns', 'segments', 'duplicate send'],
    updated: '1d ago',
  },
  {
    id: 'KB-004',
    title: 'Invite button greyed out at seat limit',
    content: 'By design: the invite button disables when the account reaches its licensed seat count. Direct customers to the billing page to add seats, or remove an inactive user to free a slot.',
    tags: ['account', 'billing', 'invites', 'by design'],
    updated: '12d ago',
  },
];
