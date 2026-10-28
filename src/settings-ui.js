// 既存フォームとIDをそのまま移動。開閉で設定値やイベントを作り直さない。
export function setupSettingsSections(t) {
  const view = document.getElementById('view-settings');
  const cards = [...view.querySelectorAll('.setting-card')];
  for (const [index, id] of ['language-settings','notice-settings','backup-settings','demo-settings','storage-settings'].entries()) cards[index].id = id;
  const section = (id, key, nodes) => {
    const details = document.createElement('details'); details.className = 'setting-section'; details.id = id;
    const summary = document.createElement('summary'), label = document.createElement('span');
    label.dataset.sectionKey = key; label.textContent = t(key); summary.append(label);
    summary.setAttribute('aria-expanded', 'false');
    details.addEventListener('toggle', () => summary.setAttribute('aria-expanded', String(details.open)));
    details.append(summary, ...nodes); return details;
  };
  const appearance = document.createElement('div'); appearance.className = 'panel setting-card';
  const label = document.createElement('label'); label.className = 'language-picker';
  const title = document.createElement('span'); title.id = 'theme-label'; title.textContent = t('theme');
  const select = document.createElement('select'); select.id = 'theme-choice'; select.setAttribute('aria-labelledby','theme-label');
  for (const value of ['light','dark','system']) { const option=document.createElement('option');option.value=value;option.textContent=t(`theme_${value}`);select.append(option); }
  label.append(title, select); appearance.append(label);
  const update = view.querySelector('.settings-update');
  const appName = document.createElement('h2'); appName.textContent = t('appName');
  const info = document.createElement('div');info.className='panel setting-card';info.append(appName,update);
  const privacy = view.querySelector('.privacy-note');
  const guidance = document.createElement('div'); guidance.className = 'data-privacy-guide';
  for (const topic of ['local','backup','zip','restore','help']) {
    for (const [tag, suffix] of [['h3','Title'],['p','Text']]) {
      const node = document.createElement(tag), key = `dataPrivacy_${topic}${suffix}`;
      node.dataset.guidanceKey = key; node.textContent = t(key); guidance.append(node);
    }
  }
  view.append(section('appearance-section','appearanceTitle',[cards[0],appearance]),
    section('notice-section','noticeTitle',[cards[1]]),section('backup-section','backupTitle',[cards[2]]),
    section('demo-section','demoResetTitle',[cards[3]]),section('data-privacy-section','dataPrivacyTitle',[guidance]),
    section('storage-section','storageTitle',[cards[4]]),section('info-section','appInfo',[info,privacy]));
}

export function setupOutlineIcons() {
  const paths = {
    bell:['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9','M10 21h4'],
    settings:['M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z'],
    home:['M3 11 12 3l9 8','M5 10v11h5v-7h4v7h5V10'],
    calendar:['M5 5h14v16H5Z','M8 3v4m8-4v4M5 10h14'],
    people:['M8 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M2 21v-2a6 6 0 0 1 12 0v2M16 5a4 4 0 0 1 0 8m1 3a5 5 0 0 1 5 5'],
    birthdays:['M12 3v3M5 11h14v10H5ZM5 15h14','M12 6c3 2 2 4 0 4s-3-2 0-4'],
  };
  const icon = key => {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('outline-icon');
    for(const d of paths[key]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}
    if(key==='settings'){const circle=document.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx','12');circle.setAttribute('cy','12');circle.setAttribute('r','3');svg.append(circle);}
    return svg;
  };
  const bell=document.getElementById('bell');
  [...bell.childNodes].filter(node=>node.nodeType===3).forEach(node=>node.remove());bell.prepend(icon('bell'));
  const actions=document.createElement('div');actions.className='header-actions';bell.before(actions);actions.append(bell);
  const settings=document.createElement('button');settings.className='icon-button';settings.id='header-settings';settings.type='button';settings.append(icon('settings'));actions.append(settings);
  for(const button of document.querySelectorAll('.bottom-nav [data-tab]'))button.querySelector('span').replaceChildren(icon(button.dataset.tab));
}
