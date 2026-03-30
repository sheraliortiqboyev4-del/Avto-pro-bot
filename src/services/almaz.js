const User = require('../models/User');

// Regexni bir marta kompilyatsiya qilib olamiz (tezlik uchun)
const ALMAZ_REGEX = /^\d+\s*[💎🎁💵].*olish$|^olish$|^клик$|^click$|^Click$|^Bosing$|^bosing$/i;

/**
 * Avto Almaz tugmalarini tekshirish va bosish
 */
const handleAlmazClick = async (event, chatId, bot, avtoAlmazStates) => {
    // Agar funksiya o'chirilgan bo'lsa, ishlamaydi 
    if (avtoAlmazStates[chatId] === false) return;

    const message = event.message;
    if (!message || !message.buttons || message.buttons.length === 0) return;

    try {
        const rows = message.buttons;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            for (let j = 0; j < row.length; j++) {
                const button = row[j];
                const btnText = button.text || "";

                if (!btnText) continue;

                // Eng tezkor regex tekshiruvi
                if (ALMAZ_REGEX.test(btnText)) {
                    // Tugmani DARXOL bosamiz (Hech qanday await yoki overhead'siz)
                    message.click(i, j).then(async () => {
                        console.log(`[${chatId}] Tugma bosildi! (${btnText})`);

                        // Qolgan ishlarni fon rejimida (background) bajaramiz
                        (async () => {
                            try {
                                // Statistikani yangilash
                                const user = await User.findOneAndUpdate(
                                    { chatId }, 
                                    { $inc: { clicks: 1 } },
                                    { new: true }
                                );

                                // Guruh nomini keshdan yoki fondan olish
                                let chatTitle = "Guruh";
                                try {
                                    // getChat() biroz vaqt olishi mumkin, shuning uchun fon rejimida
                                    const chat = await message.getChat();
                                    chatTitle = chat.title || chat.firstName || "Guruh";
                                } catch (e) {}

                                const totalClicks = user ? user.clicks : 1;
                                let rewardText = btnText.includes('💵') ? "Pul olindi 💵" : "1 almaz olindi 💎";

                                // Xabar yuborish
                                bot.sendMessage(chatId, `💎 **Avto Almaz:** ${rewardText}\n${chatTitle}\n\nJami: ${totalClicks} ta`, { parse_mode: "Markdown" });
                            } catch (e) {
                                console.error("Stats/Message error:", e.message);
                            }
                        })();
                    }).catch(err => {
                        // Agar xato bo'lsa ham tezlikka ta'sir qilmaydi
                    });
                    
                    return; // Birinchi topilgan tugmani bosib chiqib ketamiz
                }
            }
        }
    } catch (err) {
        // Xatolik bo'lsa ham bot to'xtab qolmasligi kerak
    }
};

module.exports = { handleAlmazClick };
