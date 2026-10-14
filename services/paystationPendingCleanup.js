// services/paystationPendingCleanup.js
// Deletes ONLY unpaid pending attempts older than one hour.
// Uses the existing MySQL pool passed from server.js; no extra packages needed.
const INTERVAL_MS = 5 * 60 * 1000;

function startPaystationPendingCleanup(db) {
  if (!db || typeof db.execute !== 'function') {
    throw new Error('PayStation cleanup requires the MySQL pool');
  }

  let running = false;
  async function cleanup() {
    if (running) return;
    running = true;
    try {
      const [result] = await db.execute(`
        DELETE FROM paystation_attempts
        WHERE state = 'pending'
          AND created_at < (NOW() - INTERVAL 1 HOUR)
      `);
      if (result.affectedRows > 0) {
        console.log(`[PayStation Cleanup] Removed ${result.affectedRows} expired pending attempt(s).`);
      }
    } catch (err) {
      console.error('[PayStation Cleanup] Failed:', err);
    } finally {
      running = false;
    }
  }

  // Run once at server startup, then every five minutes.
  void cleanup();
  const timer = setInterval(cleanup, INTERVAL_MS);
  timer.unref?.();
  return { cleanup, stop: () => clearInterval(timer) };
}

module.exports = startPaystationPendingCleanup;
