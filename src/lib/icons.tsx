import type { SVGProps } from "react";

/*
 * Inline icon set with a consistent line style (thin strokes, rounded
 * caps). Add icons here as needed.
 */

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...props,
  };
}

export function PanelLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="3.5" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
    </svg>
  );
}

export function PanelRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="3.5" />
      <line x1="14.5" y1="4" x2="14.5" y2="20" />
    </svg>
  );
}

export function PanelBottomIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="3.5" />
      <line x1="3" y1="14.5" x2="21" y2="14.5" />
    </svg>
  );
}

export function ComposeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M11 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V13" />
      <path d="M18.4 3.6a1.9 1.9 0 0 1 2.7 2.7L13 14.4 9.5 15.2l.8-3.5Z" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return <svg {...base(props)}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>;
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <line x1="19.5" y1="19.5" x2="15.8" y2="15.8" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="12 7.5 12 12 15 14" />
    </svg>
  );
}

export function PluginIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="3.5" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="20.5" />
    </svg>
  );
}

export function ProjectIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17Z" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M5.5 9.5V19a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    </svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.3-3 4-4.5 7-4.5s5.7 1.5 7 4.5" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M15 5.5 4.5 11l6 1.5L12 18.5 17.5 8" transform="rotate(8 12 12)" />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 2, ...props })}>
      <line x1="12" y1="19" x2="12" y2="6" />
      <polyline points="6 12 12 6 18 12" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <line x1="20" y1="12" x2="5" y2="12" />
      <polyline points="11 6 5 12 11 18" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <line x1="4" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <polyline points="9.5 6 15.5 12 9.5 18" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <polyline points="6 9.5 12 15.5 18 9.5" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function MaximizeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  );
}

export function LogOutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H9" />
      <polyline points="14 8 18 12 14 16" />
      <line x1="18" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function InviteIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.5 4.5 10 12.5" />
      <path d="M20.5 4.5 14 20l-3-6.5L4.5 10Z" />
    </svg>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <line x1="12" y1="12" x2="15.5" y2="8.5" />
    </svg>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <polyline points="7 9.5 10 12 7 14.5" />
      <line x1="12.5" y1="15" x2="16.5" y2="15" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17Z" />
    </svg>
  );
}

export function ReviewIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="13" y2="13" />
    </svg>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <line x1="6.5" y1="10" x2="6.5" y2="10" />
      <line x1="10.2" y1="10" x2="10.2" y2="10" />
      <line x1="13.8" y1="10" x2="13.8" y2="10" />
      <line x1="17.5" y1="10" x2="17.5" y2="10" />
      <line x1="8" y1="14.5" x2="16" y2="14.5" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M17.3 3.7a2 2 0 0 1 2.8 2.8L7.5 19.1 3.5 20l.9-4Z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 7h14" />
      <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7" />
      <line x1="10.2" y1="10.5" x2="10.2" y2="16.5" />
      <line x1="13.8" y1="10.5" x2="13.8" y2="16.5" />
    </svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <polyline points="9 4.5 4.5 4.5 4.5 9" />
      <polyline points="15 19.5 19.5 19.5 19.5 15" />
    </svg>
  );
}

export function SplitIcon(props: IconProps) {
  return <svg {...base(props)}>
    <circle cx="6" cy="17.5" r="2.5" />
    <circle cx="18" cy="17.5" r="2.5" />
    <path d="M8 16 20 4M16 16 4 4" />
  </svg>;
}
