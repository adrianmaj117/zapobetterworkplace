/* Jedno, spokojne menu dla trzech sposobów tworzenia zapotrzebowania. */
(() => {
  const actions = document.querySelector('.warehouse-actions');
  const choices = [
    { id:'manualDemand', icon:'☑', title:'Zapotrzebowanie ręczne', text:'Wybierz produkty z magazynu.' },
    { id:'demandText', icon:'▤', title:'Zapotrzebowanie z opisu', text:'Wklej listę produktów i ilości.' },
    { id:'demand', icon:'▣', title:'Zapotrzebowanie ze zdjęcia', text:'Dodaj od 1 do 4 zdjęć listy.' }
  ];
  const buttons = choices.map(choice => document.querySelector(`#${choice.id}`)).filter(Boolean);
  if (!actions || buttons.length !== choices.length) return;

  buttons.forEach(button => { button.hidden = true; });
  const menu = document.createElement('details');
  menu.className = 'demand-menu';
  menu.innerHTML = `<summary><span class="demand-menu-icon">☰</span><span><b>Zapotrzebowanie</b><small>Wybierz sposób dodania</small></span><i>⌄</i></summary><div class="demand-menu-options">${choices.map(choice => `<button type="button" data-demand-option="${choice.id}"><span>${choice.icon}</span><span><b>${choice.title}</b><small>${choice.text}</small></span></button>`).join('')}</div>`;
  actions.prepend(menu);
  menu.addEventListener('click', event => {
    const option = event.target.closest('[data-demand-option]');
    if (!option) return;
    menu.open = false;
    document.querySelector(`#${option.dataset.demandOption}`)?.click();
  });
  // On a phone the demand picker must never cover a notification or expired-stock panel.
  const keepAbovePanels = () => {
    const mobile = window.matchMedia('(max-width: 700px)').matches;
    const notificationsOpen = !document.querySelector('#notificationsPanel')?.hidden;
    const expiredOpen = !document.querySelector('#expiredPanel')?.hidden;
    menu.hidden = mobile && (notificationsOpen || expiredOpen);
  };
  ['#notificationsPanel', '#expiredPanel'].forEach(selector => {
    const panel = document.querySelector(selector);
    if (panel) new MutationObserver(keepAbovePanels).observe(panel, { attributes:true, attributeFilter:['hidden'] });
  });
  window.addEventListener('resize', keepAbovePanels);
  keepAbovePanels();
})();
