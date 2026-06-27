// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  await loadCurrentUser();
  await registerServiceWorker();
  updatePushBellState();
  connectLiveWS();
  navigateTo('overview'); // Startet auf der Kachel-Übersicht
})();
