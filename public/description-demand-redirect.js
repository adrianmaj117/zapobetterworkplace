// The compact dialog remains in the HTML only for backward compatibility.
// Opening demand-from-text always navigates to the dedicated review page.
window.addEventListener('click', event => {
  const target = event.target.closest('#demandText, #openDemandTextFromShopping');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.href = 'zapotrzebowanie-opis.html';
}, true);
