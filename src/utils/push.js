const webpush = require('web-push');
const { run, all } = require('../db/schema');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT  = process.env.VAPID_SUBJECT || 'mailto:admin@lootgamebot.fly.dev';

let configured = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    configured = true;
} else {
    console.warn('[PUSH] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY nicht gesetzt — Push-Benachrichtigungen sind deaktiviert.');
}

function isConfigured() { return configured; }
function getPublicKey() { return VAPID_PUBLIC || null; }

function saveSubscription(userId, username, subscription) {
    run(
        `INSERT INTO push_subscriptions (user_id, username, endpoint, keys_json) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET keys_json = ?, username = ?`,
        [userId, username, subscription.endpoint, JSON.stringify(subscription.keys),
         JSON.stringify(subscription.keys), username]
    );
}

function removeSubscription(endpoint) {
    run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint]);
}

function getAllSubscriptions() {
    return all(`SELECT * FROM push_subscriptions`);
}

// Sendet an ALLE registrierten Geräte. Tote Subscriptions (410 Gone) werden
// automatisch aus der DB entfernt.
async function sendPushToAll(payload) {
    if (!configured) return { sent: 0, failed: 0, skipped: true };

    const subs = getAllSubscriptions();
    let sent = 0, failed = 0;

    await Promise.all(subs.map(async (sub) => {
        const pushSubscription = {
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keys_json)
        };
        try {
            await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
            sent++;
        } catch (err) {
            failed++;
            if (err.statusCode === 404 || err.statusCode === 410) {
                removeSubscription(sub.endpoint); // Gerät hat sich abgemeldet / App gelöscht
            }
        }
    }));

    return { sent, failed, skipped: false };
}

module.exports = {
    isConfigured, getPublicKey, saveSubscription, removeSubscription,
    getAllSubscriptions, sendPushToAll
};
