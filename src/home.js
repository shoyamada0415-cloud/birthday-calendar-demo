import { birthdayRows, anniversaryRows, calendarEvents, dateParts } from './model.js';

// 表示用の集計だけを行う。日付ルールは既存モデルを使い、保存データを変更しない。
export function homeOverview(people, today) {
  const rows = birthdayRows(people, today), { year, month } = dateParts(today);
  // 当日の人を翌年へ繰り越さず、ホームの近日枠だけから除外する。
  const futureRows=rows.filter(row=>row.daysUntil>0);
  const nextBirthdays=futureRows.filter(row=>row.nextDate===futureRows[0]?.nextDate).sort((a,b)=>
    (a.birthday.calendarOrder??Number.MAX_SAFE_INTEGER)-(b.birthday.calendarOrder??Number.MAX_SAFE_INTEGER));
  return {
    today:calendarEvents(people, year, month).get(today) ?? [],
    next:futureRows[0] ?? null,
    nextBirthdays,
    upcoming:futureRows.filter(row => row.daysUntil <= 30),
    anniversaries:anniversaryRows(people, today).filter(row => row.daysUntil <= 14),
    // 従来の統計は計算可能なまま保持し、ホームに統計カードは表示しない。
    counts:{ today:rows.filter(row => row.daysUntil === 0).length,
      seven:rows.filter(row => row.daysUntil <= 7).length,
      month:rows.filter(row => row.birthday.month === month).length },
  };
}
