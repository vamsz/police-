/** Presentation helpers shared by both consoles. */

export function distance(metres) {
  if (metres === null || metres === undefined) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 2 : 1)} km`;
}

export function relativeTime(value) {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString();
}

export function clockTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** Up to two initials from a name, for the avatar chips. */
export function initials(name) {
  return (name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** The vocabulary from the server's domain/status.js, given labels and a tone. */
const STATUS_PRESENTATION = {
  on_post: { label: 'On post', tone: 'ok' },
  outside: { label: 'Outside area', tone: 'critical' },
  low_accuracy: { label: 'Weak GPS', tone: 'warn' },
  stale: { label: 'Signal lost', tone: 'warn' },
  no_signal: { label: 'No signal', tone: 'warn' },
  unassigned: { label: 'Unassigned', tone: 'muted' },
};

export function statusInfo(status) {
  return STATUS_PRESENTATION[status] ?? { label: status, tone: 'muted' };
}

const ALERT_LABELS = {
  out_of_radius: 'Left assigned area',
  integrity: 'Suspicious signal',
  signal_lost: 'Reporting stopped',
};

export const alertLabel = (type) => ALERT_LABELS[type] ?? type;
