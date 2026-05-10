const User = require('../models/User');
const Channel = require('../models/Channel');
const config = require('../config');
const { 
    getAdminMenu, 
    getMainMenu, 
    getAlmazMenu,
    checkMembership, 
    escapeMarkdown 
} = require('../utils/helpers');

if (!global.userStates) global.userStates = {};

module.exports = (bot) => {
    // Helper function to safely edit messages and handle "message is not modified" error
    const safeEdit = async (chatId, messageId, text, options = {}, isMarkupOnly = false) => {
        try {
            if (isMarkupOnly) {
                return await bot.editMessageReplyMarkup(options.reply_markup, { chat_id: chatId, message_id: messageId });
            }
            return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
        } catch (error) {
            if (error.message.includes("message is not modified")) {
                // Ignore this error as it's harmless
                return;
            }
            console.error("Edit message error:", error.message);
            throw error;
        }
    };

    bot.on('callback_query', async (query) => { 
        const chatId = query.message.chat.id; 
        const data = query.data; 
        const messageId = query.message.message_id;

        // Helper to answer callback safely
        const safeAnswer = async (options = {}) => {
            try {
                await bot.answerCallbackQuery(query.id, options);
            } catch (e) {
                // Ignore timeout/invalid query errors
                if (!e.message.includes("query is too old") && !e.message.includes("query ID is invalid")) {
                    console.error("answerCallbackQuery error:", e.message);
                }
            }
        };

        // --- 1. SESSION CHECK (Except for specific ones) ---
        const user = await User.findOne({ where: { chatId } });
        const allowedCallbacks = ["check_subscription"];
        const isAdminAction = data.startsWith("admin_");
        
        if (!isAdminAction && !allowedCallbacks.includes(data)) {
            if (!user || !user.session) {
                await safeAnswer({ 
                    text: "⚠️ Botdan foydalanish uchun avval Telegram akkauntingiz bilan tizimga kiring. /start ni bosing.", 
                    show_alert: true 
                });
                return;
            }
        }

        // --- 2. SUBSCRIPTION CHECK ---
        const isMember = await checkMembership(bot, chatId);
        if (!isMember && data !== "check_subscription") {
            await safeAnswer({ text: "⚠️ Botdan foydalanish uchun avval kanallarga a'zo bo'ling!", show_alert: true });
            return sendSubscriptionAsk(bot, chatId);
        }

        if (data === "check_subscription") {
            const isMember = await checkMembership(bot, chatId);
            if (isMember) {
                try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
                await bot.sendMessage(chatId, "✅ **Rahmat!** Siz barcha kanallarga a'zo bo'ldingiz.\n\n/start ni bosing.");
            } else {
                await safeAnswer({ text: "❌ Siz hali barcha kanallarga a'zo bo'lmadingiz!", show_alert: true });
            }
            return;
        }

        // --- 2. MENU NAVIGATION ---
        if (data === "menu_back_main") {
            await safeEdit(chatId, messageId, "📋 **Asosiy menyu:**", { parse_mode: "Markdown", ...getMainMenu(chatId) });
            return await safeAnswer();
        }

        if (data === "menu_almaz") {
            const isEnabled = user.avtoAlmaz;
            const statusText = isEnabled ? "🟢 Yoqilgan" : "🔴 O'chirilgan";
            
            const text = `💎 **Avto Almaz**\n\n🤖 Bot guruhlardagi 'Olish' tugmalarini o'zi bosadi.\n\n⚙ Holati: ${statusText}`;
            
            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                ...getAlmazMenu(isEnabled)
            });
            return await safeAnswer();
        }

        if (data === "almaz_on" || data === "almaz_off") {
            const isEnabled = data === "almaz_on";
            await User.updateOne({ avtoAlmaz: isEnabled }, { where: { chatId } });

            const { avtoAlmazStates } = require('../services/userbot');
            avtoAlmazStates[chatId] = isEnabled;
            
            const statusText = isEnabled ? "🟢 Yoqilgan" : "🔴 O'chirilgan";
            const text = `💎 **Avto Almaz**\n\n🤖 Bot guruhlardagi 'Olish' tugmalarini o'zi bosadi.\n\n⚙ Holati: ${statusText}`;
            
            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                ...getAlmazMenu(isEnabled)
            });
            
            return await safeAnswer({ text: `Avto Almaz ${isEnabled ? "yoqildi" : "o'chirildi"}.`, show_alert: false });
        }

        if (data === "menu_avtouser") {
            global.userStates[chatId] = { step: 'WAITING_SCRAPE_LINK' };
            bot.sendMessage(chatId, "🔗 Guruh linkini yuboring :", { parse_mode: "Markdown" });
            return await safeAnswer();
        }

        if (data === "menu_reyd") {
            const { getReydMenu } = require('../utils/helpers');
            const accCount = user.reydAccounts ? user.reydAccounts.length : 0;
            
            await safeEdit(chatId, messageId, "⚔️ **Avto Reyd Sozlamalari**\n\nSiz bir nechta akkaunt ulab, reydni yanada tezroq va samaraliroq amalga oshirishingiz mumkin. Akkauntlar navbatma-navbat xabar yuboradi.", {
                parse_mode: "Markdown",
                ...getReydMenu(accCount)
            });
            return await safeAnswer();
        }

        if (data === "reyd_add_acc") {
            const accCount = user.reydAccounts ? user.reydAccounts.length : 0;
            
            if (accCount >= 10) {
                return await safeAnswer({ text: "❌ Maksimal 10 ta akkaunt ulash mumkin.", show_alert: true });
            }

            global.userStates[chatId] = { step: 'WAITING_PHONE', isAdditional: true, isReyd: true };
            bot.sendMessage(chatId, "📞 Yangi akkaunt uchun **telefon raqamini** yuboring:\n", { parse_mode: "Markdown" });
            return await safeAnswer();
        }

        if (data === "reyd_clear_acc") {
            await User.updateOne({ reydAccounts: [] }, { where: { chatId } });
            return await safeAnswer({ text: "🗑 Reyd akkauntlari tozalandi.", show_alert: true });
        }

        if (data === "reyd_start") {
            global.userStates[chatId] = { step: 'WAITING_REYD_TARGET' };
            bot.sendMessage(chatId, "⚔️ Reyd qilinadigan guruh linki yoki usernameni yuboring:");
            return await safeAnswer();
        }

        if (data === "menu_reklama") {
            const { getReklamaMenu } = require('../utils/helpers');
            const accCount = user.reklamaAccounts ? user.reklamaAccounts.length : 0;
            
            await safeEdit(chatId, messageId, "🚀 **Avto Reklama Sozlamalari**\n\nSiz bir nechta akkaunt ulab, reklamani yanada ko'proq odamga yuborishingiz mumkin. Akkaunt spamga tushsa, bot avtomatik keyingisiga o'tadi.", {
                parse_mode: "Markdown",
                ...getReklamaMenu(accCount)
            });
            return await safeAnswer();
        }

        if (data === "reklama_add_acc") {
            const accCount = user.reklamaAccounts ? user.reklamaAccounts.length : 0;
            
            if (accCount >= 10) {
                return await safeAnswer({ text: "❌ Maksimal 10 ta akkaunt ulash mumkin.", show_alert: true });
            }

            global.userStates[chatId] = { step: 'WAITING_PHONE', isAdditional: true, isReyd: false };
            bot.sendMessage(chatId, "📞 Yangi akkaunt uchun **telefon raqamini** yuboring:\n", { parse_mode: "Markdown" });
            return await safeAnswer();
        }

        if (data === "reklama_clear_acc") {
            await User.updateOne({ reklamaAccounts: [] }, { where: { chatId } });
            return await safeAnswer({ text: "🗑 Reklama akkauntlari tozalandi.", show_alert: true });
        }

        if (data === "reklama_start") {
            global.userStates[chatId] = { step: 'WAITING_REK_USERS' };
            bot.sendMessage(chatId, "🚀 **Avto Reklama**\n\nFoydalanuvchilar ro'yxatini yuboring (username-lar, har biri yangi qatorda):");
            return await safeAnswer();
        }

        if (data === "reklama_start_confirm") {
            await safeAnswer({ text: "🚀 Reklama boshlandi!" });
            
            const state = global.userStates[chatId];
            if (!state || state.step !== 'CONFIRM_REK') {
                return;
            }

            const { startReklama } = require('../services/userbot');
            try {
                await bot.deleteMessage(chatId, messageId);
            } catch (e) {}
            
            // Async chaqiramiz
            startReklama(chatId, state.usersList, state.reklamaMsg, bot).catch(err => {
                console.error("Reklama error:", err.message);
                bot.sendMessage(chatId, "❌ Reklama boshlashda xatolik: " + err.message);
            });
            
            delete global.userStates[chatId];
            return;
        }

        if (data === "reklama_cancel") {
            await safeAnswer();
            delete global.userStates[chatId];
            return await safeEdit(chatId, messageId, "❌ Reklama bekor qilindi.", { reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "menu_reklama" }]] } });
        }

        if (data === "reklama_spam_continue") {
            const { reklamaStates } = require('../services/userbot');
            if (reklamaStates[chatId] && reklamaStates[chatId].resolveSpam) {
                reklamaStates[chatId].resolveSpam(true);
                delete reklamaStates[chatId].resolveSpam;
                await safeAnswer({ text: "▶️ Davom etilmoqda..." });
                try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
            } else {
                await safeAnswer({ text: "❌ Jarayon topilmadi.", show_alert: true });
            }
            return;
        }

        if (data === "reklama_spam_stop") {
            const { reklamaStates } = require('../services/userbot');
            if (reklamaStates[chatId] && reklamaStates[chatId].resolveSpam) {
                reklamaStates[chatId].resolveSpam(false);
                delete reklamaStates[chatId].resolveSpam;
                await safeAnswer({ text: "⏹ To'xtatildi." });
                try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
            } else {
                await safeAnswer({ text: "❌ Jarayon topilmadi.", show_alert: true });
            }
            return;
        }

        if (data.startsWith("reklama_")) {
            const { reklamaStates } = require('../services/userbot');
            if (!reklamaStates[chatId]) {
                return await safeAnswer({ text: "❌ Faol Reklama jarayoni topilmadi.", show_alert: true });
            }

            const action = data.split('_')[1];
            await safeAnswer({ text: action === "pause" ? "⏸ Pauza" : (action === "resume" ? "▶️ Davom etmoqda" : "⏹ To'xtatildi") });

            const getReklamaButtons = (status) => {
                const buttons = [];
                if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "reklama_pause" });
                if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "reklama_resume" });
                buttons.push({ text: "⏹ To'xtatish", callback_data: "reklama_stop" });
                return { reply_markup: { inline_keyboard: [buttons] } };
            };

            if (action === "pause") {
                reklamaStates[chatId].status = 'paused';
                return await safeEdit(chatId, messageId, `⏸ **Avto Reklama to'xtatib turilibdi...**\nProgress: ${reklamaStates[chatId].count}/${reklamaStates[chatId].total}`, getReklamaButtons('paused'));
            }
            if (action === "resume") {
                reklamaStates[chatId].status = 'running';
                return await safeEdit(chatId, messageId, `🚀 **Avto Reklama jarayoni...**\nProgress: ${reklamaStates[chatId].count}/${reklamaStates[chatId].total}`, getReklamaButtons('running'));
            }
            if (action === "stop") {
                reklamaStates[chatId].status = 'stopped';
                return;
            }
            return;
        }

        if (data === "reyd_start_confirm") {
            await safeAnswer({ text: "🚀 Reyd boshlandi!" });
            
            const state = global.userStates[chatId];
            if (!state || state.step !== 'CONFIRM_REYD') {
                return; // Already answered or invalid state
            }

            const { startReyd } = require('../services/userbot');
            try {
                await bot.deleteMessage(chatId, messageId);
            } catch (e) {}
            
            // Async chaqiramiz, event loopni bloklamaslik uchun
            startReyd(chatId, state.target, state.reydMsg, state.limit, bot, state.stickerPath).catch(err => {
                console.error("Reyd error:", err.message);
                bot.sendMessage(chatId, "❌ Reyd boshlashda xatolik: " + err.message);
            });
            
            delete global.userStates[chatId];
            return;
        }

        if (data === "reyd_cancel") {
            await safeAnswer();
            delete global.userStates[chatId];
            return await safeEdit(chatId, messageId, "❌ Reyd bekor qilindi.", { reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "menu_reyd" }]] } });
        }

        if (data.startsWith("reyd_")) {
            const { reydSessions } = require('../services/userbot');
            if (!reydSessions[chatId]) {
                return await safeAnswer({ text: "❌ Faol Reyd jarayoni topilmadi.", show_alert: true });
            }

            const action = data.split('_')[1];
            await safeAnswer({ text: action === "pause" ? "⏸ Pauza" : (action === "resume" ? "▶️ Davom etmoqda" : "⏹ To'xtatildi") });

            const getReydButtons = (status) => {
                const buttons = [];
                if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "reyd_pause" });
                if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "reyd_resume" });
                buttons.push({ text: "⏹ To'xtatish", callback_data: "reyd_stop" });
                return { reply_markup: { inline_keyboard: [buttons] } };
            };

            if (action === "pause") {
                reydSessions[chatId].status = 'paused';
                return await safeEdit(chatId, messageId, `⏸ **Avto Reyd to'xtatib turilibdi...**\nNishon: ${reydSessions[chatId].target || ""}\nProgress: ${reydSessions[chatId].count}/${reydSessions[chatId].total}`, getReydButtons('paused'));
            }
            if (action === "resume") {
                reydSessions[chatId].status = 'running';
                return await safeEdit(chatId, messageId, `🚀 **Avto Reyd jarayoni...**\nNishon: ${reydSessions[chatId].target || ""}\nProgress: ${reydSessions[chatId].count}/${reydSessions[chatId].total}`, getReydButtons('running'));
            }
            if (action === "stop") {
                reydSessions[chatId].status = 'stopped';
                return;
            }
            return;
        }

        if (data === "menu_utag") {
            const { getUtagMenu } = require('../utils/helpers');
            const mode = user.utagAccountMode || 'main';
            const rekCount = (user.reklamaAccounts || []).length;
            const modeText = mode === 'all' ? "Barcha akkauntlar" : "Faqat asosiy akkaunt";
            const text = `🏷 **Avto Utag Sozlamalari :**\n\n⚙️ Hozirgi rejim: **${modeText}**\n👥 Akkauntlar: **${rekCount + 1} ta**\n\n🚀 **Yangi boshlash**\n➤ Yangi guruh tanlab, avtomatik tag jarayonini boshlang.\n\n📂 **Tarix**\n➤ Oldin ishlatilgan guruhlardan birini tanlab davom eting.`;
            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                ...getUtagMenu(mode, rekCount)
            });
            return await safeAnswer();
        }

        if (data === "utag_change_mode") {
            const currentMode = user.utagAccountMode || 'main';
            const newMode = currentMode === 'all' ? 'main' : 'all';
            await User.updateOne({ utagAccountMode: newMode }, { where: { chatId } });
            
            const { getUtagMenu } = require('../utils/helpers');
            const rekCount = (user.reklamaAccounts || []).length;
            const modeText = newMode === 'all' ? "Barcha akkauntlar" : "Faqat asosiy akkaunt";
            const text = `🏷 **Avto Utag Sozlamalari :**\n\n⚙️ Hozirgi rejim: **${modeText}**\n👥 Akkauntlar: **${rekCount + 1} ta**\n\n🚀 **Yangi boshlash**\n➤ Yangi guruh tanlab, avtomatik tag jarayonini boshlang.\n\n📂 **Tarix**\n➤ Oldin ishlatilgan guruhlardan birini tanlab davom eting.`;
            
            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                ...getUtagMenu(newMode, rekCount)
            });
            return await safeAnswer({ text: `Rejim o'zgartirildi: ${modeText}` });
        }

        if (data === "utag_start_new") {
            if (!user.utagAccountMode) {
                const text = "🛠 **Avto Utag rejimini tanlang:**\n\nSiz bir marta rejimni tanlasangiz, bot uni eslab qoladi. Keyinchalik uni sozlamalar orqali o'zgartirishingiz mumkin.";
                const buttons = [
                    [{ text: "👤 Faqat asosiy akkaunt", callback_data: "utag_set_mode_main" }],
                    [{ text: "🌐 Barcha akkauntlar", callback_data: "utag_set_mode_all" }],
                    [{ text: "🔙 Orqaga", callback_data: "menu_utag" }]
                ];
                await safeEdit(chatId, messageId, text, {
                    parse_mode: "Markdown",
                    reply_markup: { inline_keyboard: buttons }
                });
                return await safeAnswer();
            }
            global.userStates[chatId] = { step: 'WAITING_UTAG_LINK' };
            bot.sendMessage(chatId, "🔗 Qaysi guruhda tag qilmoqchisiz? (Guruh linki yoki username yuboring):");
            return await safeAnswer();
        }

        if (data.startsWith("utag_set_mode_")) {
            const mode = data.replace('utag_set_mode_', ''); // main or all
            await User.updateOne({ utagAccountMode: mode }, { where: { chatId } });
            await safeAnswer({ text: `Rejim eslab qolindi: ${mode === 'all' ? 'Barcha akkauntlar' : 'Faqat asosiy'}` });
            
            global.userStates[chatId] = { step: 'WAITING_UTAG_LINK' };
            bot.sendMessage(chatId, "🔗 Qaysi guruhda tag qilmoqchisiz? (Guruh linki yoki username yuboring):");
            try { await bot.deleteMessage(chatId, messageId); } catch(e) {}
            return;
        }

        if (data.startsWith("utag_mode_")) {
            const mode = data.replace('utag_mode_', ''); // only_mention, random_words, custom
            const state = global.userStates[chatId];
            if (!state || state.step !== 'WAITING_UTAG_MODE') return await safeAnswer({ text: "Sessiya muddati tugagan.", show_alert: true });

            if (mode === 'only_mention' || mode === 'random_words') {
                delete global.userStates[chatId];
                await safeAnswer({ text: "🚀 UTag boshlanmoqda..." });
                try { await bot.deleteMessage(chatId, messageId); } catch(e) {}
                const { startAutoTag } = require('../services/userbot');
                startAutoTag(chatId, state.groupLink, state.limit, null, bot, mode)
                    .catch(err => bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`));
            } else {
                state.step = 'WAITING_UTAG_CUSTOM_TEXT';
                await safeAnswer();
                try { await bot.deleteMessage(chatId, messageId); } catch(e) {}
                bot.sendMessage(chatId, "✍️ Tag qilinganda foydalanuvchi ismi yonidan chiqadigan **matnni** yuboring:");
            }
            return;
        }

        if (data === "utag_history") {
            if (!user.utagHistory || user.utagHistory.length === 0) {
                return await safeAnswer({ text: "📜 Tarix hali bo'sh.", show_alert: true });
            }

            let text = "📜 **UTag Tarixi:**\n\nQayta ishlatish uchun guruhni tanlang:\n";
            const buttons = [];
            user.utagHistory.forEach((h, index) => {
                buttons.push([{ text: `📍 ${h.title}`, callback_data: `utag_re_${index}` }]);
            });
            buttons.push([{ text: "🔙 Orqaga", callback_data: "menu_utag" }]);

            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
            });
            return await safeAnswer();
        }

        if (data.startsWith("utag_re_")) {
            const index = parseInt(data.split('_')[2]);
            const group = user.utagHistory[index];
            if (!group) return await safeAnswer({ text: "❌ Ma'lumot topilmadi.", show_alert: true });

            global.userStates[chatId] = { step: 'WAITING_UTAG_LIMIT', groupLink: group.link };
            bot.sendMessage(chatId, `📍 Tanlangan: **${group.title}**\n\n🔢 Nechta odamni tag qilmoqchisiz? (Masalan: 50):`, { parse_mode: "Markdown" });
            return await safeAnswer();
        }

        if (["utag_pause", "utag_resume", "utag_stop"].includes(data)) {
            const { utagStates } = require('../services/userbot');
            if (!utagStates[chatId]) {
                return await safeAnswer({ text: "❌ Faol UTag jarayoni topilmadi.", show_alert: true });
            }

            const action = data.split('_')[1];
            await safeAnswer({ text: action === "pause" ? "⏸ Pauza" : (action === "resume" ? "▶️ Davom etmoqda" : "⏹ To'xtatildi") });

            const getUtagButtons = (status) => {
                const buttons = [];
                if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "utag_pause" });
                if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "utag_resume" });
                buttons.push({ text: "⏹ To'xtatish", callback_data: "utag_stop" });
                return { reply_markup: { inline_keyboard: [buttons] } };
            };

            if (action === "pause") {
                utagStates[chatId].status = 'paused';
                return await safeEdit(chatId, messageId, `⏸ **Avto UTag to'xtatib turilibdi...**\nProgress: ${utagStates[chatId].count}/${utagStates[chatId].total}`, getUtagButtons('paused'));
            }
            if (action === "resume") {
                utagStates[chatId].status = 'running';
                return await safeEdit(chatId, messageId, `🚀 **Avto UTag jarayoni...**\nProgress: ${utagStates[chatId].count}/${utagStates[chatId].total}`, getUtagButtons('running'));
            }
            if (action === "stop") {
                utagStates[chatId].status = 'stopped';
                return;
            }
            return;
        }

        if (data === "menu_logout") {
            await User.updateOne({ session: null }, { where: { chatId } });
            const { userClients } = require('../services/userbot');
            if (userClients[chatId]) {
                try { await userClients[chatId].disconnect(); } catch (e) {}
                delete userClients[chatId];
            }
            bot.sendMessage(chatId, "🔄 Hisobdan chiqildi. Qayta kirish uchun /start bosing.");
            return await safeAnswer();
        }

        if (data === "menu_profile") {
            const { formatRemainingTime } = require('../utils/helpers');
            
            const statusText = user.status === 'approved' ? "✅ Tasdiqlangan" : "⏳ Tasdiqlanmagan";
            const tarifText = user.subscriptionType || "Oddiy";
            let remainingTime = formatRemainingTime(user.expireAt);
            if (remainingTime.includes("Cheksiz")) remainingTime = "Cheksiz";
            
            const rekAccCount = user.reklamaAccounts ? user.reklamaAccounts.length : 0;
            const reydAccCount = user.reydAccounts ? user.reydAccounts.length : 0;
            
            const joinedDate = user.joinedAt ? new Date(user.joinedAt) : new Date();
            const regDate = `${joinedDate.getDate()}/${joinedDate.getMonth() + 1}/${joinedDate.getFullYear()}`;
            
            const text = `👤 **Sizning Profilingiz:**\n\n` +
                `📛 **Ism:** ${user.name || "Noma'lum"}\n` +
                `🆔 **ID:** \`${user.chatId}\`\n` +
                `🔰 **Holat:** ${statusText}\n` +
                `⏰ **Tarif:** ${tarifText}\n` +
                `⏳ **Qolgan vaqt:** ${remainingTime}\n\n` +
                `🗂 **Ulangan akkauntlar soni:**\n` +
                `📣 Rek: ${rekAccCount} ta  , ⚔️ Reyd ${reydAccCount} ta\n\n` +
                `⚔️ **Reydlar soni:** ${user.reydCount || 0} ta\n` +
                `👥 **Yig'ilgan userlar:** ${user.usersGathered || 0} ta\n` +
                `📢 **Yuborilgan reklamalar:** ${user.adsCount || 0} ta\n` +
                `🏷 **Utag jarayonlari:** ${user.utagCount || 0} ta\n` +
                `🏷 **To'plangan almazlar:** ${user.clicks || 0} ta\n\n` +
                `📅 **Ro'yxatdan o'tgan sana:** ${regDate}`;

            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "menu_back_main" }]]
                }
            });
            return await safeAnswer();
        }

        // --- 3. ADMIN PANEL ---
        if (data === "admin_panel") { 
            if (chatId.toString() !== config.adminId.toString()) return;
            await safeEdit(chatId, messageId, "👨‍💻 Admin Panel:", { ...getAdminMenu() }); 
            return await safeAnswer();
        } 

        if (data === "admin_stats") {
            const total = await User.counountDtc(me);s
            const approved = await User.count({ where: { status: 'approved' } });
            const pending = await User.count({ where: { status: 'pending' } });
            const blocked = await User.count({ where: { status: 'blocked' } });

            const stats = await User.find({
                attributes: [
                    [sequelize.fn('SUM', sequelize.col('clicks')), 'totalClicks'],
                    [sequelize.fn('SUM', sequelize.col('utagCount')), 'totalUtag'],
                    [sequelize.fn('SUM', sequelize.col('reydCount')), 'totalReyd'],
                    [sequelize.fn('SUM', sequelize.col('usersGathered')), 'totalGathered'],
                    [sequelize.fn('SUM', sequelize.col('adsCount')), 'totalAds']
                ],
                raw: true
            });

            const s = stats[0] || { totalClicks: 0, totalUtag: 0, totalReyd: 0, totalGathered: 0, totalAds: 0 };

            const statsText = `📊 **Bot Statistikasi:** \n\n` +
                `👥 **Jami foydalanuvchilar:** ${total} \n` +
                `✅ **Tasdiqlanganlar:** ${approved} \n` +
                `⏳ **Kutilayotganlar:** ${pending} \n` +
                `🚫 **Bloklanganlar:** ${blocked} \n\n` +
                `💎 **Jami almazlar:** ${s.totalClicks || 0} ta \n` +
                `🏷 **Jami utaglar:** ${s.totalUtag || 0} ta \n` +
                `⚔️ **Jami reydlar:** ${s.totalReyd || 0} ta \n` +
                `👥 **Jami yig'ilgan userlar:** ${s.totalGathered || 0} ta \n` +
                `📢 **Jami yuborilgan reklamalar:** ${s.totalAds || 0} ta`;

            await safeEdit(chatId, messageId, statsText, {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: [[{ text: "🔙 Orqaga", callback_data: "admin_panel" }]] }
            });
            return await safeAnswer();
        }

        if (data === "admin_all_users" || data.startsWith('admin_list_') || data === "admin_pending" || data === "admin_approved" || data === "admin_blocked") { 
            let page = 1;
            let statusFilter = 'all';

            if (data.startsWith('admin_list_')) {
                const parts = data.split('_');
                page = parseInt(parts[2]) || 1;
                statusFilter = parts[3] || 'all';
            } else if (data === "admin_pending") {
                statusFilter = 'pending';
            } else if (data === "admin_approved") {
                statusFilter = 'approved';
            } else if (data === "admin_blocked") {
                statusFilter = 'blocked';
            }

            const limit = 10;
            const filter = statusFilter === 'all' ? {} : { status: statusFilter };
            const total = await User.countDocuments(filter); 
            const users = await User.find(filter)
                .sort({ joinedAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit); 
            
            let statusTitle = "Barcha A'zolar";
            if (statusFilter === 'pending') statusTitle = "Kutilayotganlar";
            if (statusFilter === 'approved') statusTitle = "Tasdiqlanganlar";
            if (statusFilter === 'blocked') statusTitle = "Bloklanganlar";

            const totalPages = Math.ceil(total / limit) || 1;
            let text = `👥 **${statusTitle}:** (Sahifa ${page}/${totalPages})\n\n`; 
            
            users.forEach((u, i) => {
                const statusEmoji = u.status === 'approved' ? '✅' : (u.status === 'blocked' ? '🚫' : '⏳');
                const name = u.name || "Noma'lum";
                const username = u.username ? `(@${u.username})` : "";
                
                const date = u.joinedAt ? new Date(u.joinedAt) : new Date();
                const formattedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
                
                text += `👤 ${name} ${username} ${statusEmoji}\n`;
                text += `🆔 \`${u.chatId}\` | /info_${u.chatId}\n`;
                text += `📅 ${formattedDate}\n\n`;
            }); 
            
            const nav = []; 
            if (page > 1) nav.push({ text: "⬅️ Oldingi", callback_data: `admin_list_${page-1}_${statusFilter}` }); 
            if (total > page * limit) nav.push({ text: "Keyingi ➡️", callback_data: `admin_list_${page+1}_${statusFilter}` }); 
            
            await safeEdit(chatId, messageId, text, { 
                parse_mode: "Markdown", 
                reply_markup: { 
                    inline_keyboard: [
                        nav, 
                        [{ text: "🔙 Orqaga", callback_data: "admin_panel" }]
                    ] 
                } 
            }); 
            return await safeAnswer();
        } 

        if (data.startsWith('admin_approve_1month_')) { 
            const targetId = data.split('_')[3]; 
            const expireAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 kun
            await User.updateOne({ status: 'approved', subscriptionType: 'Standard', expireAt, expiryWarningSent: false }, { where: { chatId: targetId } }); 
            
            bot.sendMessage(chatId, `✅ User ${targetId} 1 oyga Standard qilib tasdiqlandi.`); 
            bot.sendMessage(targetId, "🎉 Siz admin tomonidan tasdiqlandingiz! \n\n 🔰 Tarif: Standard \n Endi /start ni bosib ro'yxatdan o'tishingiz mumkin."); 
            
            try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
            return await safeAnswer();
        }

        if (data.startsWith('admin_approve_vip_')) { 
            const targetId = data.split('_')[3]; 
            await User.updateOne({ status: 'approved', subscriptionType: 'VIP', expireAt: null, expiryWarningSent: false }, { where: { chatId: targetId } }); 
            
            bot.sendMessage(chatId, `👑 User ${targetId} **Cheksiz VIP** qilib tasdiqlandi.`); 
            bot.sendMessage(targetId, "🎉 Siz admin tomonidan tasdiqlandingiz! \n\n 🔰 Tarif: 👑 VIP \n Endi /start ni bosib ro'yxatdan o'tishingiz mumkin."); 
            
            try { await bot.deleteMessage(chatId, messageId); } catch (e) {}
            return await safeAnswer();
        }

        if (data.startsWith('admin_approve_')) { 
            const targetId = data.split('_')[2]; 
            global.userStates[chatId] = { step: 'WAITING_TIME', targetId }; 
            bot.sendMessage(chatId, "✍️ Muddatni kiriting (Masalan: `1 oy`, `7 kun`, `2 soat`):"); 
            return await safeAnswer();
        } 

        if (data.startsWith('admin_block_')) {
            const targetId = data.split('_')[2];
            await User.updateOne({ status: 'blocked', session: null }, { where: { chatId: targetId } });
            bot.sendMessage(chatId, `🚫 User ${targetId} bloklandi.`);
            
            const blockedText = `⚠ Sizning foydalanish muddatingiz tugagan. \nBotdan foydalanishni davom ettirish uchun to'lovni amalga oshiring va botni qayta ishga tushiring. \n\n👨‍💼 Admin: @ortiqov_x7`;
            bot.sendMessage(targetId, blockedText, {
                reply_markup: {
                    inline_keyboard: [[{ text: "👨‍💼 Admin bilan bog'lanish", url: "https://t.me/ortiqov_x7" }]]
                }
            });
            return await safeAnswer();
        }

        if (data.startsWith('admin_unblock_')) {
            const targetId = data.split('_')[2];
            await User.updateOne({ status: 'pending' }, { where: { chatId: targetId } });
            bot.sendMessage(chatId, `✅ User ${targetId} blokdan ochildi (status: pending).`);
            bot.sendMessage(targetId, "✅ Siz admin tomonidan blokdan ochildingiz. Endi qayta ro'yxatdan o'tishingiz mumkin.");
            return await safeAnswer();
        }

        if (data === "admin_broadcast") { 
            global.userStates[chatId] = { step: 'WAITING_BROADCAST' }; 
            bot.sendMessage(chatId, "📣 Barchaga yuboriladigan xabarni yuboring:"); 
            return await safeAnswer();
        } 

        // --- 4. CHANNELS MANAGEMENT ---
        if (data === "admin_channels") {
            if (chatId.toString() !== config.adminId.toString()) return;
            const channels = await Channel.findAll();
            let text = "📢 **Majburiy obuna kanallari:**\n\n";
            const buttons = [];
            
            if (channels.length === 0) {
                text += "Hozircha kanallar qo'shilmagan.";
            } else {
                channels.forEach(c => {
                    text += `🔹 **${c.name}**\nID: \`${c.channelId}\`\nURL: ${c.url}\n\n`;
                    buttons.push([{ text: `❌ ${c.name} ni o'chirish`, callback_data: `admin_del_channel_${c.id}` }]);
                });
            }
            
            buttons.push([{ text: "➕ Yangi kanal qo'shish", callback_data: "admin_add_channel" }]);
            buttons.push([{ text: "🔙 Orqaga", callback_data: "admin_panel" }]);
            
            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
            });
            return await safeAnswer();
        }

        if (data === "admin_add_channel") {
            if (chatId.toString() !== config.adminId.toString()) return;
            global.userStates[chatId] = { step: 'WAITING_CHANNEL_ID' };
            bot.sendMessage(chatId, "🆔 Yangi kanalning **ID raqamini** yuboring (Masalan: `-100123456789`):");
            return await safeAnswer();
        }

        if (data.startsWith("admin_del_channel_")) {
            if (chatId.toString() !== config.adminId.toString()) return;
            const channelId = data.split('_')[3];
            await Channel.destroy({ where: { id: channelId } });
            await safeAnswer({ text: "✅ Kanal o'chirildi!", show_alert: true });
            
            // Kanallar ro'yxatini yangilash
            const channels = await Channel.findAll();
            let text = "📢 **Majburiy obuna kanallari:**\n\n";
            const buttons = [];
            if (channels.length === 0) {
                text += "Hozircha kanallar qo'shilmagan.";
            } else {
                channels.forEach(c => {
                    text += `🔹 **${c.name}**\nID: \`${c.channelId}\`\nURL: ${c.url}\n\n`;
                    buttons.push([{ text: `❌ ${c.name} ni o'chirish`, callback_data: `admin_del_channel_${c.id}` }]);
                });
            }
            buttons.push([{ text: "➕ Yangi kanal qo'shish", callback_data: "admin_add_channel" }]);
            buttons.push([{ text: "🔙 Orqaga", callback_data: "admin_panel" }]);
            
            await safeEdit(chatId, messageId, text, {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buttons }
            });
            return;
        }

        await safeAnswer(); 
    });
};


