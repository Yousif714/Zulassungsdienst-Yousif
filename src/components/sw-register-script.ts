/** Inline-Skript: Service Worker registrieren, außer auf den öffentlichen Zahlungsseiten (`/zahlung`, `/zahlung/…`). */
export const registerServiceWorkerScript = `(function () {
  if (!('serviceWorker' in navigator)) return;
  var p = location.pathname;
  if (p === '/zahlung' || p.indexOf('/zahlung/') === 0) return;
  var register = function () { navigator.serviceWorker.register('/sw.js').catch(function (err) { console.error('Service Worker konnte nicht registriert werden:', err); }); };
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
})();`;
