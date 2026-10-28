import { dateParts, occurrenceForYear } from './model.js';

export const eventKey = (ann) => ann.type === 'BIRTHDAY' ? 'BIRTHDAY' : ann.id;

// 一覧からの登録と既存の割り当てで同じ変更を作る。保存は呼出側のsavePersonだけ。
export function birthdayAssignedPerson(person, month, day) {
  const previous=person.anniversaries.find(a=>a.type==='BIRTHDAY');
  return {...person,anniversaries:[{type:'BIRTHDAY',month,day,year:previous?.year??null,showAge:previous?.showAge??false},
    ...person.anniversaries.filter(a=>a.type!=='BIRTHDAY')]};
}

// 予定IDと元の表示日を照合。画像・別の記念日・生年は変更しない。
export function movedPerson(person, key, from, to) {
  const source = dateParts(from), target = dateParts(to);
  const ann = person.anniversaries.find((item) => eventKey(item) === key);
  if (!ann || occurrenceForYear(ann, source.year) !== from) throw new Error('moveStale');
  if (from === to) return null;
  return { ...person, anniversaries:person.anniversaries.map((item) => item !== ann ? item : ({
    ...item, month:target.month, day:target.day,
    year:item.type !== 'BIRTHDAY' && item.recurring === false ? target.year : item.year,
  })) };
}
