import { all, loadSettings, replaceNotifications } from './db.js';
import { birthdayRows, anniversaryRows, TIMINGS, tokyoToday } from './model.js';

function allowed(settings, days) {
  return settings.enabled && ({ 7: settings.seven, 3: settings.three, 1: settings.one, 0: settings.today })[days];
}

export function notificationId(personId, birthdayDate, daysBefore) {
  return `${personId}:${birthdayDate}:${daysBefore}`;
}

export function anniversaryNotificationId(personId, anniversaryId, date, daysBefore) {
  return `${personId}:${anniversaryId}:${date}:${daysBefore}`;
}

// 同じ人・記念日ID・発生日・タイミングは同じID。既読状態を保ったまま重複を防ぎます。
export function reconcileNotifications(people, existing, settings, today = tokyoToday()) {
  if (!settings.enabled) return [];
  const rows = [
    ...birthdayRows(people, today).map((row) => ({ ...row, anniversaryId: null })),
    ...anniversaryRows(people, today).filter((row) => row.ann.notify)
      .map((row) => ({ ...row, anniversaryId: row.ann.id })),
  ];
  const candidates = new Map(rows.map((row) => [`${row.person.id}:${row.anniversaryId ?? ''}`, row]));
  const kept = existing.filter((notice) => {
    const row = candidates.get(`${notice.personId}:${notice.anniversaryId ?? ''}`);
    return row && row.nextDate === notice.birthdayDate && row.daysUntil <= 7
      && TIMINGS.includes(notice.daysBefore) && allowed(settings, notice.daysBefore)
      && notice.birthdayDate >= today
      && notice.id === (notice.anniversaryId
        ? anniversaryNotificationId(notice.personId, notice.anniversaryId, notice.birthdayDate, notice.daysBefore)
        : notificationId(notice.personId, notice.birthdayDate, notice.daysBefore));
  });
  const ids = new Set(kept.map((notice) => notice.id));
  for (const row of rows) {
    if (!TIMINGS.includes(row.daysUntil) || !allowed(settings, row.daysUntil)) continue;
    const id = row.anniversaryId
      ? anniversaryNotificationId(row.person.id, row.anniversaryId, row.nextDate, row.daysUntil)
      : notificationId(row.person.id, row.nextDate, row.daysUntil);
    if (!ids.has(id)) {
      kept.push({ id, personId: row.person.id, birthdayDate: row.nextDate,
        ...(row.anniversaryId ? { anniversaryId: row.anniversaryId } : {}),
        daysBefore: row.daysUntil, createdAt: new Date().toISOString(), readAt: null });
      ids.add(id);
    }
  }
  return kept.sort((a, b) => a.birthdayDate.localeCompare(b.birthdayDate)
    || a.daysBefore - b.daysBefore || a.id.localeCompare(b.id));
}

export async function synchronizeNotifications(db, today = tokyoToday()) {
  const [people, existing, settings] = await Promise.all([
    all(db, 'people'), all(db, 'notifications'), loadSettings(db),
  ]);
  const reconciled = reconcileNotifications(people, existing, settings, today);
  const order = (a, b) => a.id.localeCompare(b.id);
  if (JSON.stringify([...existing].sort(order)) !== JSON.stringify([...reconciled].sort(order))) {
    await replaceNotifications(db, reconciled);
  }
  return { notifications: reconciled, unread: reconciled.filter((notice) => !notice.readAt).length, settings };
}
