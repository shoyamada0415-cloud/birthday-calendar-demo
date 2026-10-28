import { calendarEvents, dateParts } from './model.js';
import { eventKey } from './calendar-move.js';

export const entryId = (entry) => `${entry.person.id}:${eventKey(entry.ann)}`;

// フィルターで隠れた予定の位置は維持し、表示中の予定だけを入れ替える。
export function reorderedPeople(people, date, ids) {
  const { year, month } = dateParts(date);
  const entries = calendarEvents(people, year, month).get(date) ?? [];
  const byId = new Map(entries.map(entry => [entryId(entry), entry]));
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) throw new Error('orderInvalid');
  let index = 0;
  const chosen = new Set(ids);
  const ordered = entries.map(entry => chosen.has(entryId(entry)) ? byId.get(ids[index++]) : entry);
  if (ordered.every((entry, i) => entry === entries[i])) return [];
  const ranks = new Map(ordered.map((entry, rank) => [entryId(entry), rank]));
  return people.filter(person => ordered.some(entry => entry.person.id === person.id)).map(person => ({
    ...person, anniversaries:person.anniversaries.map(ann => {
      const rank = ranks.get(`${person.id}:${eventKey(ann)}`);
      return rank === undefined ? ann : { ...ann, calendarOrder:rank };
    }),
  }));
}
