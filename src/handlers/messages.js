const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Channel = require('../models/Channel');
const config = require('../config');
const { parseTime } = require('../utils/helpers');
const { initAuth, handleAuthStep, scrapeUsers, startReyd, startReklama, startAutoTag } = require('../services/userbot');

if (!global.userStates) global.userStates = {};

module.exports = (bot) => {
    bot.on('message', async (msg) => { 
        const chatId = msg.chat.id; 
        const text = msg.text;
        const state = global.userStates[chatId]; 
        
        // 1. Session check for features
        if (state && !['WAITING_PHONE', 'WAITING_CODE', 'WAITING_PASSWORD', 'WAITING_TIME', 'WAITING_BROADCAST'].includes(state.step)) {
            const user = await User.findOne({ where: { chatId } });
            if (!user || !user.session) {
                delete global.userStates[chatId];
                return bot.sendMessage(chatId, "⚠️ Botdan foydalanish uchun avval Telegram akkauntingiz bilan tizimga kiring. /start ni bosing.");
            }
        }
        
        // Auth logic
        if (state && state.step === 'WAITING_PHONE') {
            if (!text) return;
            try {
                // Telefon raqamini tozalash: barcha bo'sh joylar va raqam bo'lmagan belgilarni olib tashlash (faqat + saqlanadi)
                let phoneNumber = text.replace(/\s+/g, '').replace(/[^\d+]/g, '');
                
                // Agar raqam + bilan boshlanmasa va uzunligi 9 bo'lsa (masalan 990001122), +998 qo'shish
                if (!phoneNumber.startsWith('+')) {
                    if (phoneNumber.length === 9) {
                        phoneNumber = '+998' + phoneNumber;
                    } else if (phoneNumber.length === 12) {
                        phoneNumber = '+' + phoneNumber;
                    }
                }

                if (phoneNumber.length < 7) throw new Error("Noto'g'ri telefon raqami. Iltimos, xalqaro formatda kiriting (Masalan: +998991234567)");

                const isAdditional = state.isAdditional || false;
                const isReyd = state.isReyd || false;
                await initAuth(chatId, phoneNumber, bot, isAdditional, isReyd);
                global.userStates[chatId] = { step: 'WAITING_CODE', phoneNumber, isAdditional, isReyd };
                bot.sendMessage(chatId, "📩 Telegramdan kelgan kodni orasiga nuqta qo'yib yuboring (Masalan: 12.345):", { parse_mode: "Markdown" });
            } catch (e) {
                bot.sendMessage(chatId, `❌ Xatolik: ${e.message}\n\nQayta urinib ko'ring (Telefon raqam yuboring):`);
            }
            return;
        }

        if (state && (state.step === 'WAITING_CODE' || state.step === 'WAITING_PASSWORD')) {
            if (!text) return;
            try {
                await handleAuthStep(chatId, text);
                // Natija initAuth ichidagi .then() yoki .catch() orqali yuboriladi
            } catch (e) {
                if (e.message === "AUTH_NOT_FOUND") {
                    bot.sendMessage(chatId, "❌ Sessiya topilmadi. Iltimos, /start bosing.");
                    delete global.userStates[chatId];
                } else {
                    bot.sendMessage(chatId, `❌ Xatolik: ${e.message}`);
                }
            }
            return;
        }

        if (!state) return;

        // Admin logic
        if (chatId.toString() === config.adminId.toString()) {
            if (state.step === 'WAITING_TIME') { 
                if (!text) return;
                const duration = parseTime(text); 
                if (duration === 0) return bot.sendMessage(chatId, "❌ Noto'g'ri format! Qayta kiriting."); 
                const expireAt = new Date(Date.now() + duration); 
                await User.update({ status: 'approved', expireAt, expiryWarningSent: false }, { where: { chatId: state.targetId } }); 
                bot.sendMessage(chatId, `✅ Tasdiqlandi! Muddat: ${text}`); 
                bot.sendMessage(state.targetId, `🎉 Siz admin tomonidan tasdiqlandingiz! \n\n 🔰 Tarif: ${text} \n Endi /start ni bosib ro'yxatdan o'tishingiz mumkin.`); 
                delete global.userStates[chatId]; 
                return;
            } 
        
            if (state.step === 'WAITING_BROADCAST') { 
                const users = await User.findAll(); 
                bot.sendMessage(chatId, `🚀 ${users.length} kishiga yuborish boshlandi...`); 
                for (const u of users) { 
                    try { await bot.copyMessage(u.chatId, chatId, msg.message_id); } catch (e) {} 
                } 
                bot.sendMessage(chatId, "🏁 Yakunlandi!"); 
                delete global.userStates[chatId]; 
                return;
            } 

            if (state.step === 'WAITING_CHANNEL_ID') {
                if (!text) return;
                global.userStates[chatId] = { step: 'WAITING_CHANNEL_NAME', channelId: text };
                bot.sendMessage(chatId, "✍️ Kanal uchun **nom** kiriting:");
                return;
            }

            if (state.step === 'WAITING_CHANNEL_NAME') {
                if (!text) return;
                global.userStates[chatId] = { ...state, step: 'WAITING_CHANNEL_URL', name: text };
                bot.sendMessage(chatId, "🔗 Kanal **linkini** yuboring (Masalan: `https://t.me/avtobot_news`):");
                return;
            }

            if (state.step === 'WAITING_CHANNEL_URL') {
                if (!text) return;
                try {
                    await Channel.create({
                        channelId: state.channelId,
                        name: state.name,
                        url: text
                    });
                    bot.sendMessage(chatId, "✅ Kanal muvaffaqiyatli qo'shildi!");
                    delete global.userStates[chatId];
                } catch (e) {
                    bot.sendMessage(chatId, "❌ Xatolik: " + e.message);
                }
                return;
            }
        }

        // Features logic
        if (state.step === 'WAITING_SCRAPE_LINK') {
            if (!text) return;
            global.userStates[chatId] = { step: 'WAITING_SCRAPE_LIMIT', groupLink: text };
            bot.sendMessage(chatId, "🔢 Nechta User yig'moqchisiz? (Maximum 2000):", { parse_mode: "Markdown" });
            return;
        }

        if (state.step === 'WAITING_SCRAPE_LIMIT') {
            if (!text) return;
            const limit = parseInt(text) || 100;
            const groupLink = state.groupLink;
            
            delete global.userStates[chatId];
            
            bot.sendMessage(chatId, "⏳ **Userlarni yig'ish boshlanmoqda...**\nBiroz vaqt olishi mumkin **Iltimos** sabirli bo'ling 😊.");
            
            scrapeUsers(chatId, groupLink, limit, bot).catch(e => {
                bot.sendMessage(chatId, `❌ Xatolik: Guruh linki eskirgan bo'lishi mumkin.\nGuruha borligingizni tekshiring.`);
            });
            return;
        }

        if (state.step === 'WAITING_REYD_TARGET') {
            if (!text) return;
            global.userStates[chatId] = { step: 'WAITING_REYD_TEXT', target: text };
            bot.sendMessage(chatId, "📩 Reyd xabarini (matn yoki stiker) yuboring:");
        } else if (state.step === 'WAITING_REYD_TEXT') {
            let stickerPath = null;
            if (msg.sticker) {
                try {
                    const tempDir = path.join(process.cwd(), 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    stickerPath = await bot.downloadFile(msg.sticker.file_id, tempDir);
                } catch (err) {
                    console.error("Stiker yuklash xatosi:", err.message);
                    return bot.sendMessage(chatId, "❌ Stiker yuklashda xatolik yuz berdi. Qaytadan urinib ko'ring.");
                }
            }
            global.userStates[chatId] = { ...state, step: 'WAITING_REYD_LIMIT', reydMsg: msg, stickerPath };
            bot.sendMessage(chatId, "🔢 Nechta xabar yuborilsin? (Maksimum 500):");
        } else if (state.step === 'WAITING_REYD_LIMIT') {
            if (!text) return;
            const limit = parseInt(text) || 10;
            const reydData = { ...state, limit };
            global.userStates[chatId] = { ...reydData, step: 'CONFIRM_REYD' };
            
            const reydInfo = `🛡 **Reyd Ma'lumotlari:**\n\n` +
                `📍 Nishon: ${reydData.target}\n` +
                `🔢 Soni: ${reydData.limit} ta\n` +
                `📩 Xabar turi: ${reydData.reydMsg.sticker ? "Stiker" : "Matn"}\n\n` +
                `Tayyormisiz? "Boshlash" tugmasini bosing.`;

            bot.sendMessage(chatId, reydInfo, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚀 Boshlash", callback_data: "reyd_start_confirm" }],
                        [{ text: "❌ Bekor qilish", callback_data: "reyd_cancel" }]
                    ]
                }
            });
        }

        if (state.step === 'WAITING_REK_USERS') {
            if (!text) return;
            global.userStates[chatId] = { step: 'WAITING_REK_TEXT', usersList: text };
            bot.sendMessage(chatId, "✍️ Reklama xabarini yuboring (Matn, rasm, stiker va h.k.):");
        } else if (state.step === 'WAITING_REK_TEXT') {
            global.userStates[chatId] = { ...state, step: 'CONFIRM_REK', reklamaMsg: msg };
            
            const rekInfo = `📢 **Reklama Ma'lumotlari:**\n\n` +
                `👥 Userlar soni: ${state.usersList.split(/\s+/).filter(u => u.startsWith('@')).length} ta\n` +
                `📩 Xabar turi: ${msg.photo ? "Rasm" : (msg.sticker ? "Stiker" : (msg.video ? "Video" : "Matn"))}\n\n` +
                `Tayyormisiz? "Boshlash" tugmasini bosing.`;

            bot.sendMessage(chatId, rekInfo, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🚀 Boshlash", callback_data: "reklama_start_confirm" }],
                        [{ text: "❌ Bekor qilish", callback_data: "reklama_cancel" }]
                    ]
                }
            });
        }

        if (state.step === 'WAITING_UTAG_LINK') {
            global.userStates[chatId] = { ...state, step: 'WAITING_UTAG_LIMIT', groupLink: text };
            bot.sendMessage(chatId, "🔢 Nechta odamni Utag qilmoqchisiz? :");
            return;
        } 
        
        if (state.step === 'WAITING_UTAG_LIMIT') {
            const limit = parseInt(text) || 100;
            global.userStates[chatId] = { ...state, step: 'WAITING_UTAG_MODE', limit };
            
            bot.sendMessage(chatId, "🛠 **UTag rejimini tanlang:**", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "👤 @ Foydalanuvchi o'zi", callback_data: "utag_mode_only_mention" }],
                        [{ text: "💬 Tasodifiy so'zlar bilan", callback_data: "utag_mode_random_words" }],
                        [{ text: "✍️ O'z matnim bilan", callback_data: "utag_mode_custom" }]
                    ]
                }
            });
            return;
        }

        if (state.step === 'WAITING_UTAG_CUSTOM_TEXT') {
            if (!text) return;
            const utagData = state;
            delete global.userStates[chatId];
            
            bot.sendMessage(chatId, "🚀 Avto Utag jarayoni boshlanmoqda...");
            startAutoTag(chatId, utagData.groupLink, utagData.limit, text, bot, 'custom')
                .catch(err => bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`));
            return;
        }
    });
};

