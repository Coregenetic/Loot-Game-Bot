const logger = require('./logger');

async function sendChatMessage(channel, message) {
    const { COMMAND_SOURCE } = require('../bot');
    try {
        if (COMMAND_SOURCE === 'eventsub' && global.eventSubShadow?.isReady()) {
            await global.eventSubShadow.sendChatMessage(message);
        } else if (global.botInstance?.client) {
            await global.botInstance.client.say(channel, message);
        } else {
            logger.warn('CHAT-SENDER', 'Keine aktive Verbindung verfügbar, Nachricht verworfen: ' + message);
        }
    } catch (err) {
        logger.error('CHAT-SENDER', 'Senden fehlgeschlagen: ' + err.message);
    }
}

module.exports = { sendChatMessage };