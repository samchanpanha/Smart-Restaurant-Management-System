const ICONS = {
  dashboard: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
  orders: <><path d="M7 3.75h8l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5.25a1.5 1.5 0 0 1 1.5-1.5Z" /><path d="M15 4v4h4M8 12h8M8 16h8" /></>,
  tables: <><path d="M4 7h16M6 7v10m12-10v10M4 17h16M9 7v4h6V7M9 17v3m6-3v3" /><circle cx="6" cy="5" r="1.5" /><circle cx="18" cy="5" r="1.5" /></>,
  kitchen: <><path d="M6 12a6 6 0 1 1 12 0v7H6v-7Z" /><path d="M9 19v2m6-2v2M12 2v3m-5-1 2 2m8-2-2 2M3 12h3m12 0h3" /></>,
  inventory: <><path d="m12 2.8 8 4.3v9.8l-8 4.3-8-4.3V7.1l8-4.3Z" /><path d="m4.5 7.3 7.5 4.1 7.5-4.1M12 11.4v9.4M8 5l8 4.3" /></>,
  menu: <><path d="M5 5h14M5 10h14M5 15h9M5 20h7" /><circle cx="18" cy="17" r="3" /></>,
  costing: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.7-.7-1.6-1-2.7-1-1.4 0-2.3.7-2.3 1.8 0 2.7 5.1 1.2 5.1 4 0 1.2-1.1 2.1-2.7 2.1-1.2 0-2.2-.4-3-1.2M12 5.5v13" /></>,
  reports: <><path d="M4 20V10m5 10V4m5 16v-7m5 7V7" /><path d="M2.5 20.5h19" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1 1.9-1.7 2.9-2.2-.5-.2.1-1.2 1.3h-3.4l-1.2-1.3-.2-.1-2.2.5-1.7-2.9 1.1-1.9.1-.2-.1-2.2-.1-.2-1.1-1.9 1.7-2.9 2.2.5.2-.1L11.8 7h3.4l1.2 1.3.2.1 2.2-.5 1.7 2.9-1.1 1.9-.1.2.1 2.1Z" transform="translate(-1 -1) scale(1.08)" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  plus: <path d="M12 5v14m-7-7h14" />,
  pin: <><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z" /><path d="M12 15v6" /></>,
}

export function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICONS[name] || ICONS.dashboard}
    </svg>
  )
}
