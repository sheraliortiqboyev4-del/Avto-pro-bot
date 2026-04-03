const User = require('../models/User');
const { Api } = require('telegram');

// --- YANGI: Kliklangan xabarlarni kuzatish tizimi ---
// Key: "chatId_peerId_msgId", Value: timestamp
const clickedMessages = new Map();

// Xotirani tozalash (har 1 soatda 1 soatdan eski yozuvlarni o'chiramiz)
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of clickedMessages.entries()) {
        if (now - timestamp > 3600000) { // 1 soat
            clickedMessages.delete(key);
        }
    }
}, 3600000);

// Regexni yanada qat'iy qilamiz (faqat shu so'zlar qatnashgan tugmalarni bosish uchun)
const ALMAZ_REGEX = /\bolish\b|\bклик\b|\bclick\b|\bbosing\b|💎|🎁|💵/i;

/**
 * Avto Almaz tugmalarini tekshirish va bosish
 */
const handleAlmazClick = async (client, message, chatId, bot, avtoAlmazStates) => {
    // Agar funksiya o'chirilgan bo'lsa, ishlamaydi 
    if (avtoAlmazStates[chatId] === false) return;
    if (!message || !message.id) return;

    try {
        // Peer ID ni aniqlash
        let peerStr = "";
        if (message.peerId) {
            if (message.peerId.userId) peerStr = message.peerId.userId.toString();
            else if (message.peerId.chatId) peerStr = message.peerId.chatId.toString();
            else if (message.peerId.channelId) peerStr = message.peerId.channelId.toString();
        }

        const clickKey = `${chatId}_${peerStr}_${message.id}`;

        // Agar xabar allaqachon kliklangan bo'lsa, qaytamiz
        if (clickedMessages.has(clickKey)) return;

        // Tugmalarni olish (Wrapped Message yoki Api.Message bo'lishiga qarab)
        let buttons = [];
        if (message.buttons) {
            buttons = message.buttons; // Wrapped Message (Event orqali kelgan)
        } else if (message.replyMarkup && message.replyMarkup.rows) {
            // Api.Message (Update orqali kelgan)
            buttons = message.replyMarkup.rows.map(row => row.buttons);
        }

        if (!buttons || buttons.length === 0) return;

        for (let i = 0; i < buttons.length; i++) {
            const row = buttons[i];
            for (let j = 0; j < row.length; j++) {
                const button = row[j];
                const btnText = (button.text || "").trim();

                if (!btnText) continue;

                // Faqat ruxsat berilgan so'zlar bo'lsa kliklaymiz
                const isMatch = ALMAZ_REGEX.test(btnText);
                if (isMatch) {
                    // Kliklashdan oldin xotiraga saqlab qo'yamiz (double-click oldini olish uchun)
                    clickedMessages.set(clickKey, Date.now());

                    console.log(`🎯 [${chatId}] Tugma aniqlandi: "${btnText}" (ID: ${message.id})`);

                    try {
                        // Tugmani bosish
                        if (typeof message.click === 'function') {
                            await message.click(i, j);
                        } else {
                            // Api.Message bo'lsa, client orqali bosamiz
                            await client.invoke(new Api.messages.GetBotCallbackAnswer({
                                peer: message.peerId,
                                msgId: message.id,
                                data: button.data
                            }));
                        }
                        
                        console.log(`✅ [${chatId}] Tugma muvaffaqiyatli bosildi!`);

                        // Statistikani fon rejimida yangilash
                        (async () => {
                            try {
                                await User.increment({ clicks: 1 }, { where: { chatId } });
                                const user = await User.findOne({ where: { chatId } });

                                let chatTitle = "Guruh";
                                try {
                                    const chat = await client.getEntity(message.peerId);
                                    chatTitle = chat.title || chat.firstName || "Guruh";
                                } catch (e) {}

                                const totalClicks = user ? user.clicks : 1;
                                let rewardText = btnText.includes('💵') ? "Pul olindi 💵" : "Almaz olindi 💎";

                                bot.sendMessage(chatId, `💎 **Avto Almaz:** ${rewardText}\n📍 ${chatTitle}\n\nJami: ${totalClicks} ta`, { parse_mode: "Markdown" });
                            } catch (e) {
                                console.error("Stats error:", e.message);
                            }
                        })();

                        return; // Birinchi tugmani bosib chiqamiz
                    } catch (clickErr) {
                        // Agar bosishda xato bo'lsa, xotiradan o'chirib qo'yamiz (keyingi urinish uchun)
                        clickedMessages.delete(clickKey);

                        if (clickErr.message.includes("MESSAGE_ID_INVALID")) {
                            console.warn(`⚠️ [${chatId}] Message ID eskirgan yoki noto'g'ri (ID: ${message.id}).`);
                        } else {
                            throw clickErr;
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error(`[${chatId}] handleAlmazClick error:`, err.message);
    }
};

module.exports = { handleAlmazClick };
