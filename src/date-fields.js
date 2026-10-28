import {validMonthDay,BIRTH_YEAR_MIN,BIRTH_YEAR_MAX} from './model.js';

export function birthdayYearChoices(currentYear){
  return Array.from({length:Math.min(120,currentYear-BIRTH_YEAR_MIN)+1},(_,i)=>currentYear-i)
    .filter(year=>year<=BIRTH_YEAR_MAX);
}
export function monthDays(month){
  return Array.from({length:31},(_,i)=>i+1).filter(day=>!month||validMonthDay(Number(month),day));
}
export function yearInputMode(value,currentYear){
  return value===''||value==null||birthdayYearChoices(currentYear).includes(Number(value))?'select':'custom';
}
function option(select,value,label){const node=document.createElement('option');node.value=value;node.textContent=label;select.append(node);}

// 誕生日と任意記念日で同じ月末・閏日ルールを使用する。無効になった日は未選択に戻す。
export function setupMonthDay(month,day,{monthLabel,dayLabel,empty,required=false}){
  const updateDays=(wanted=day.value)=>{
    day.replaceChildren();option(day,'',empty());
    for(const value of monthDays(month.value))option(day,value,dayLabel(value));
    day.value=[...day.options].some(o=>o.value===String(wanted))?wanted:'';
  };
  return {
    set(m='',d=''){month.replaceChildren();option(month,'',empty());for(let value=1;value<=12;value++)option(month,value,monthLabel(value));
      month.value=m??'';updateDays(d??'');month.required=day.required=required;},
    refresh(){this.set(month.value,day.value);},
    bind(){month.addEventListener('change',()=>updateDays(month.value?day.value:''));},
  };
}

export function setupBirthYear({input,choice,mode,currentYear,t}){
  const candidates=birthdayYearChoices(currentYear);
  const rebuild=()=>{
    const value=input.value;choice.replaceChildren();option(choice,'',t('unregistered'));
    const values=[...candidates];if(value&&!values.includes(Number(value)))values.push(Number(value));
    values.sort((a,b)=>b-a);
    for(const year of values)option(choice,String(year),String(year));
    choice.value=value?String(Number(value)):'';
  };
  const display=()=>{const custom=mode.value==='custom';input.hidden=!custom;choice.hidden=custom;};
  const refresh=()=>{const value=mode.value;mode.replaceChildren();option(mode,'select',t('yearSelectMode'));option(mode,'custom',t('yearCustomMode'));mode.value=value||'select';
    mode.setAttribute('aria-label',t('birthYearMode'));rebuild();display();};
  mode.addEventListener('change',()=>{
    if(mode.value==='select'&&!input.checkValidity()){mode.value='custom';input.reportValidity();return;}
    rebuild();display();
  });
  choice.addEventListener('change',()=>{input.value=choice.value;});
  return {set(value=''){input.value=value??'';mode.value=yearInputMode(value,currentYear);refresh();},refresh};
}
