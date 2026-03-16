const CALLBACK_DUE_SOON_MS = 2 * 60 * 60 * 1000;

function parseLooseCallbackTime(value, now = new Date()) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) {
    return new Date(direct);
  }

  const normalized = raw.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  const dayFirstMatch = normalized.match(/^(today|tomorrow)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  const timeFirstMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(today|tomorrow)?$/i);

  let dayToken = null;
  let hourText = null;
  let minuteText = null;
  let meridiem = null;

  if (dayFirstMatch) {
    [, dayToken, hourText, minuteText, meridiem] = dayFirstMatch;
  } else if (timeFirstMatch) {
    [, hourText, minuteText, meridiem, dayToken] = timeFirstMatch;
  } else {
    return null;
  }

  let hour = parseInt(hourText, 10);
  const minute = parseInt(minuteText || '0', 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 24 || minute > 59) {
    return null;
  }

  if (meridiem) {
    const suffix = meridiem.toLowerCase();
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
  }

  const parsed = new Date(now);
  if ((dayToken || '').toLowerCase() === 'tomorrow') {
    parsed.setDate(parsed.getDate() + 1);
  }

  parsed.setHours(hour, minute, 0, 0);
  return parsed;
}

export function getCallbackCue({ callbackTime, callbackAt, now = new Date() } = {}) {
  const displayTime = String(callbackTime || '').trim() || null;
  const dueAt = parseLooseCallbackTime(callbackAt || callbackTime, now);

  let state = 'scheduled';
  if (dueAt) {
    const deltaMs = dueAt.getTime() - now.getTime();
    if (deltaMs < 0) {
      state = 'overdue';
    } else if (deltaMs <= CALLBACK_DUE_SOON_MS) {
      state = 'due-soon';
    }
  }

  const stateLabel = state === 'overdue'
    ? 'Overdue'
    : state === 'due-soon'
      ? 'Due soon'
      : 'Scheduled';

  const badgeLabel = state === 'overdue'
    ? 'Callback overdue'
    : state === 'due-soon'
      ? 'Callback due soon'
      : 'Callback scheduled';

  return {
    state,
    stateLabel,
    badgeLabel,
    displayTime,
    dueAt: dueAt ? dueAt.toISOString() : null,
    title: displayTime ? `${badgeLabel}: ${displayTime}` : badgeLabel,
  };
}
