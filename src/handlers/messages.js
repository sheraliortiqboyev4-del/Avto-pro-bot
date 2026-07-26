const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Channel = require('../models/Channel');
const config = require('../config');
const {
    parseTime,
    checkMembership,
    sendSubscriptionAsk,
    sendBotReaction,
    normalizeTelegramUrl,
    SCRAPE_CHAT_REQUEST_ID,
    REYD_CHAT_REQUEST_ID,
    UTAG_CHAT_REQUEST_ID,
    AUTOMSG_GROUP_REQUEST_ID,
    AUTOMSG_CHANNEL_REQUEST_ID,
    parseSharedGroup,
    BUTTON_EMOJI_IDS,
    BUTTON_STYLES,
    normalizePhoneInput,
    removeKeyboardMarkup,
    getPhoneShareKeyboard,
    getUtagSetupKeyboard,
    getUtagModeKeyboard,
    getMainMenu
} = require('../utils/helpers');
const { triggerBackup } = require('../utils/dbBackup');
const { adminSetCoins, adminAdjustCoins } = require('../services/bonus');
const { initAuth, handleAuthStep, scrapeUsers, startReyd, startReklama, startAutoTag } = require('../services/userbot');

if (!global.userStates) global.userStates = {};

module.exports = (bot) => {
    bot.on('message', async (msg) => { 
        const chatId = msg.chat.id; 
        const text = msg.text;
        const state = global.userStates[chatId]; 

        // 1. Agar xabar buyruq bo'lsa, uni commands.js ga topshiramiz
        if (text && (text.startsWith('/') || (msg.entities && msg.entities.some(e => e.type === 'bot_command')))) {
            return;
        }
        
        // 2. Majburiy obuna tekshiruvi (faqat matnli xabarlar va holati bor userlar uchun)
        if (state) {
            const isMember = await checkMembership(bot, chatId);
            if (!isMember) {
                return sendSubscriptionAsk(bot, chatId);
            }
        }
        
        // 3. Agar hech qanday holatda bo'lmasa, xabarni e'tiborsiz qoldiramiz
        if (!state) return;

        // 4. Session check for features
        if (!['WAITING_PHONE', 'WAITING_CODE', 'WAITING_PASSWORD', 'WAITING_TIME', 'WAITING_BROADCAST', 'WAITING_COIN_SET', 'WAITING_COIN_DEDUCT', 'WAITING_REK_USERS', 'WAITING_AUTOMSG_MESSAGE', 'WAITING_AUTOMSG_TARGET', 'WAITING_AUTOREPLY_MSG'].includes(state.step)) {
            const user = await User.findOne({ where: { chatId } });
            if (!user || !user.session) {
                delete global.userStates[chatId];
                return bot.sendMessage(chatId, "⚠️ Botdan foydalanish uchun avval Telegram akkauntingiz bilan tizimga kiring. /start ni bosing.");
            }
        }

        // Auth logic
        if (state.step === 'WAITING_PHONE') {
            let phoneRaw = null;
            if (msg.contact && msg.contact.phone_number) {
                phoneRaw = msg.contact.phone_number;
            } else if (text) {
                phoneRaw = text;
            }
            if (!phoneRaw) return;
            try {
                const phoneNumber = normalizePhoneInput(phoneRaw);
                if (phoneNumber.length < 7) throw new Error("Noto'g'ri telefon raqami. Iltimos, xalqaro formatda kiriting (Masalan: +998991234567)");

                const isAdditional = state.isAdditional || false;
                const isReyd = state.isReyd || false;
                await bot.sendMessage(chatId, "⏳", { ...removeKeyboardMarkup() }).catch(() => {});
                await initAuth(chatId, phoneNumber, bot, isAdditional, isReyd);
                global.userStates[chatId] = { step: 'WAITING_CODE', phoneNumber, isAdditional, isReyd };
            } catch (e) {
                bot.sendMessage(chatId, `❌ Xatolik: ${e.message}\n\nQayta urinib ko'ring (Telefon raqam yuboring):`, {
                    reply_markup: getPhoneShareKeyboard()
                });
            }
            return;
        }

        if (state.step === 'WAITING_CODE' || state.step === 'WAITING_PASSWORD') {
            if (!text) return;
            try {
                await handleAuthStep(chatId, text, bot);
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

        // Admin logic
        if (chatId.toString() === config.adminId.toString()) {
            if (state.step === 'WAITING_TIME') { 
                if (!text) return;
                const duration = parseTime(text); 
                if (duration === 0) return bot.sendMessage(chatId, "❌ Noto'g'ri format! Qayta kiriting."); 
                const expireAt = new Date(Date.now() + duration); 
                await User.update({ status: 'approved', expireAt, expiryWarningSent: false }, { where: { chatId: state.targetId } }); 
                triggerBackup('admin_tasdiq_qolda', true);
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

            if (state.step === 'WAITING_COIN_SET') {
                if (!text) return;
                const amount = parseInt(text.replace(/\s/g, ''), 10);
                if (Number.isNaN(amount) || amount < 0) {
                    return bot.sendMessage(chatId, "❌ 0 yoki undan katta butun son kiriting.");
                }
                try {
                    const { oldCoins, newCoins } = await adminSetCoins(state.targetId, amount, chatId);
                    bot.sendMessage(
                        chatId,
                        `✅ User \`${state.targetId}\`: ${oldCoins} → **${newCoins}** coin`,
                        { parse_mode: 'Markdown', skipEmojiWrap: true }
                    );
                    bot.sendMessage(
                        state.targetId,
                        `🪙 Admin tomonidan sizga **${newCoins}** ta coin xadiya qilindi.`,
                        { parse_mode: 'Markdown', skipEmojiWrap: true }
                    ).catch(() => {});
                } catch (e) {
                    bot.sendMessage(chatId, `❌ ${e.message}`);
                }
                delete global.userStates[chatId];
                return;
            }

            if (state.step === 'WAITING_COIN_DEDUCT') {
                if (!text) return;
                const amount = parseInt(text.replace(/\s/g, ''), 10);
                if (Number.isNaN(amount) || amount <= 0) {
                    return bot.sendMessage(chatId, "❌ 1 yoki undan katta butun son kiriting (masalan: 10).");
                }
                try {
                    const { newCoins, delta } = await adminAdjustCoins(state.targetId, -amount, chatId);
                    bot.sendMessage(
                        chatId,
                        `✅ User \`${state.targetId}\` dan **${amount}** coin yechildi.\nYangi balans: **${newCoins}** coin`,
                        { parse_mode: 'Markdown', skipEmojiWrap: true }
                    );
                    // bot.sendMessage(
                    //     state.targetId,
                    //     `🪙 Admin hisobingizdan **${amount}** coin yechildi.\nQolgan: **${newCoins}** coin`,
                    //     { parse_mode: 'Markdown', skipEmojiWrap: true }
                    // ).catch(() => {});
                } catch (e) {
                    bot.sendMessage(chatId, `❌ ${e.message}`);
                }
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
                bot.sendMessage(chatId, "🔗 Kanal **linkini** yuboring:\n`https://t.me/kanal` yoki `@kanal` yoki `kanal`");
                return;
            }

            if (state.step === 'WAITING_CHANNEL_URL') {
                if (!text) return;
                const normalizedUrl = normalizeTelegramUrl(text);
                if (!normalizedUrl) {
                    return bot.sendMessage(
                        chatId,
                        "❌ Noto'g'ri link. Quyidagilardan birini yuboring:\n`https://t.me/kanal_nomi`\n`@kanal_nomi`\n`kanal_nomi`",
                        { parse_mode: 'Markdown' }
                    );
                }
                try {
                    await Channel.create({
                        channelId: state.channelId,
                        name: state.name,
                        url: normalizedUrl
                    });
                    bot.sendMessage(chatId, `✅ Kanal qo'shildi!\nLink: ${normalizedUrl}`);
                    delete global.userStates[chatId];
                } catch (e) {
                    bot.sendMessage(chatId, "❌ Xatolik: " + e.message);
                }
                return;
            }
        }

        // Features logic
        if (state.step === 'WAITING_SCRAPE_LINK') {
            if (msg.chat_shared && msg.chat_shared.request_id === SCRAPE_CHAT_REQUEST_ID) {
                const { id: groupId, title } = parseSharedGroup(msg.chat_shared);
                global.userStates[chatId] = { step: 'WAITING_SCRAPE_LIMIT', groupLink: groupId };
                await bot.sendMessage(
                    chatId,
                    `✅ **${title}** tanlandi.\n\n🔢 Nechta User yig'moqchisiz? (Maximum 2000):`,
                    { parse_mode: "Markdown", ...removeKeyboardMarkup() }
                );
                return;
            }

            if (!text) return;
            global.userStates[chatId] = { step: 'WAITING_SCRAPE_LIMIT', groupLink: text.trim() };
            await bot.sendMessage(
                chatId,
                "🔢 Nechta User yig'moqchisiz? (Maximum 2000):",
                { parse_mode: "Markdown", ...removeKeyboardMarkup() }
            );
            return;
        }

        if (state.step === 'WAITING_SCRAPE_LIMIT') {
            if (!text) return;
            const limit = parseInt(text) || 100;
            const groupLink = state.groupLink;
            
            delete global.userStates[chatId];
            
            // scrapeUsers o'zi dinamik progress xabarini yuboradi
            scrapeUsers(chatId, groupLink, limit, bot).catch(e => {
                bot.sendMessage(chatId, `❌ Xatolik: Guruh linki eskirgan bo'lishi mumkin.\nGuruha borligingizni tekshiring.`);
            });
            return;
        }

        if (state.step === 'WAITING_REYD_TARGET') {
            if (msg.chat_shared && msg.chat_shared.request_id === REYD_CHAT_REQUEST_ID) {
                const { id, title } = parseSharedGroup(msg.chat_shared);
                global.userStates[chatId] = { ...state, step: 'WAITING_REYD_TEXT', target: id, groupTitle: title };
                await bot.sendMessage(chatId, "📩 Reyd xabarini (matn yoki stiker) yuboring:", removeKeyboardMarkup());
                return;
            }
            if (!text) return;
            global.userStates[chatId] = { ...state, step: 'WAITING_REYD_TEXT', target: text.trim() };
            await bot.sendMessage(chatId, "📩 Reyd xabarini (matn yoki stiker) yuboring:", removeKeyboardMarkup());
            return;
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
                `📍 Nishon: ${reydData.groupTitle || reydData.target}\n` +
                `🔢 Soni: ${reydData.limit} ta\n` +
                `📩 Xabar turi: ${reydData.reydMsg.sticker ? "Stiker" : "Matn"}\n\n` +
                `Tayyormisiz? "Boshlash" tugmasini bosing.`;

            bot.sendMessage(chatId, reydInfo, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Boshlash", callback_data: "reyd_start_confirm", icon_custom_emoji_id: BUTTON_EMOJI_IDS.start, style: BUTTON_STYLES.success }],
                        [{ text: "Bekor qilish", callback_data: "reyd_cancel", icon_custom_emoji_id: BUTTON_EMOJI_IDS.cancel, style: BUTTON_STYLES.danger }]
                    ]
                }
            });
        }

        if (state.step === 'WAITING_REK_USERS') {
            console.log(`[WAITING_REK_USERS] Xabar keldi: "${text}"`);
            
            if (!text) return;
            
            console.log('[Reaction] Userlar ro\'yxati yuborildi, tekshirilmoqda...');
            
            // Agar allaqachon usersList mavjud bo'lsa, yangi xabarni qo'shamiz
            const existingUsers = state.usersList || '';
            const newUsers = existingUsers ? `${existingUsers}\n${text}` : text;
            
            // Duplicate userlarni olib tashlash
            const allUsers = newUsers.split(/\s+/).filter(u => u.startsWith('@'));
            const uniqueUsers = [...new Set(allUsers)]; // Duplicate olib tashlash
            const totalUsers = uniqueUsers.length;
            
            // Maksimal 1000 ta user
            if (totalUsers > 1000) {
                console.log('[Reaction] Juda ko\'p userlar - error reaksiya');
                sendBotReaction(bot, chatId, msg.message_id, 'error');
                
                return bot.sendMessage(chatId, 
                    `⚠️ **Maksimal 1000 ta user qabul qilish mumkin!**\n\n` +
                    `Hozir: ${totalUsers} ta\n\n` +
                    `Iltimos, kamroq user yuboring yoki "Tayyor" tugmasini bosing.`,
                    { parse_mode: 'Markdown' }
                );
            }
            
            global.userStates[chatId] = { step: 'WAITING_REK_USERS', usersList: uniqueUsers.join('\n') };
            
            console.log(`[Reaction] Userlar qabul qilindi: ${totalUsers} ta - success reaksiya`);
            sendBotReaction(bot, chatId, msg.message_id, 'success');
            
            // Hozirgi holatni ko'rsatish
            const duplicates = allUsers.length - totalUsers;
            bot.sendMessage(chatId, 
                `✅ Qabul qilindi!\n\n` +
                `📊 Jami userlar: **${totalUsers}** ta\n` +
                (duplicates > 0 ? `♻️ Duplicate: **${duplicates}** ta olib tashlandi\n` : '') +
                `\n▶️ Yana userlar yuboring yoki **"Tayyor (Davom etish)"** tugmasini bosing.\n` +
                `⚠️ Maksimal: 1000 ta`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Tayyor (Davom etish)', callback_data: 'reklama_users_done', icon_custom_emoji_id: BUTTON_EMOJI_IDS.check, style: BUTTON_STYLES.success }],
                            [{ text: 'Bekor qilish', callback_data: 'reklama_users_cancel', icon_custom_emoji_id: BUTTON_EMOJI_IDS.cancel, style: BUTTON_STYLES.danger }]
                        ]
                    }
                }
            );
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
                        [{ text: "Boshlash", callback_data: "reklama_start_confirm", icon_custom_emoji_id: BUTTON_EMOJI_IDS.start, style: BUTTON_STYLES.success }],
                        [{ text: "Bekor qilish", callback_data: "reklama_cancel", icon_custom_emoji_id: BUTTON_EMOJI_IDS.cancel, style: BUTTON_STYLES.danger }]
                    ]
                }
            });
        }

        if (state.step === 'WAITING_UTAG_LINK') {
            if (msg.chat_shared && msg.chat_shared.request_id === UTAG_CHAT_REQUEST_ID) {
                const { id, title } = parseSharedGroup(msg.chat_shared);
                global.userStates[chatId] = { ...state, step: 'WAITING_UTAG_SETUP', groupLink: id, groupTitle: title };
                await bot.sendMessage(chatId, "⏳", removeKeyboardMarkup()).catch(() => {});
                await bot.sendMessage(chatId,
                    `📍 **${title}**\n\nKimlarni tag qilamiz?\n• 🟢 Faqat online\n• 👥 Hammani\n\n• Yoki **faqat raqam** yuboring (masalan: 50)`,
                    { parse_mode: 'Markdown', ...getUtagSetupKeyboard() }
                );
                return;
            }
            if (!text) return;
            global.userStates[chatId] = { ...state, step: 'WAITING_UTAG_SETUP', groupLink: text.trim() };
            await bot.sendMessage(chatId, "⏳", removeKeyboardMarkup()).catch(() => {});
            await bot.sendMessage(chatId,
                "Kimlarni tag qilamiz?\n• 🟢 Faqat online\n• 👥 Hammani\n\n• Yoki **faqat raqam** yuboring (masalan: 50)",
                { parse_mode: 'Markdown', ...getUtagSetupKeyboard() }
            );
            return;
        }

        if (state.step === 'WAITING_UTAG_SETUP') {
            if (!text) return;
            if (!/^\d+$/.test(text.trim())) {
                return bot.sendMessage(chatId, "❌ Faqat raqam kiriting (masalan: 50) yoki tugmalardan tanlang.");
            }
            const limit = parseInt(text.trim(), 10);
            global.userStates[chatId] = { ...state, step: 'WAITING_UTAG_MODE', limit, memberFilter: 'all' };
            return bot.sendMessage(chatId, "🛠 **Tag rejimini tanlang:**", {
                parse_mode: 'Markdown',
                ...getUtagModeKeyboard()
            });
        }

        if (state.step === 'WAITING_UTAG_CUSTOM_TEXT') {
            if (!text) return;
            const utagData = { ...state };
            delete global.userStates[chatId];

            bot.sendMessage(chatId, "🚀 Utag jarayoni boshlanmoqda...");
            startAutoTag(chatId, utagData.groupLink, bot, {
                limit: utagData.limit ?? 0,
                mode: 'custom',
                tagText: text,
                tagEntities: msg.entities || msg.caption_entities || [],
                memberFilter: utagData.memberFilter || 'all',
                groupTitle: utagData.groupTitle
            }).catch((err) => bot.sendMessage(chatId, `❌ Xatolik: ${err.message}`));
            return;
        }

        // ============================================================
        // AVTO XABAR
        // ============================================================
        if (state.step === 'WAITING_AUTOMSG_MESSAGE') {
            const savedMessage = {
                message_id: msg.message_id,
                from_chat_id: chatId,
                text: msg.text || msg.caption || null,
                type: msg.photo ? 'photo' :
                      msg.video ? 'video' :
                      msg.audio ? 'audio' :
                      msg.voice ? 'voice' :
                      msg.document ? 'document' :
                      msg.sticker ? 'sticker' :
                      msg.video_note ? 'video_note' :
                      msg.animation ? 'animation' :
                      (msg.location ? 'location' :
                      (msg.contact ? 'contact' :
                      (msg.poll ? 'poll' : 'text'))),
                entities: msg.entities || msg.caption_entities || null,
                mediaFileId: null
            };
            if (msg.photo && msg.photo.length > 0) savedMessage.mediaFileId = msg.photo[msg.photo.length - 1].file_id;
            else if (msg.video) savedMessage.mediaFileId = msg.video.file_id;
            else if (msg.audio) savedMessage.mediaFileId = msg.audio.file_id;
            else if (msg.voice) savedMessage.mediaFileId = msg.voice.file_id;
            else if (msg.document) savedMessage.mediaFileId = msg.document.file_id;
            else if (msg.sticker) savedMessage.mediaFileId = msg.sticker.file_id;
            else if (msg.video_note) savedMessage.mediaFileId = msg.video_note.file_id;
            else if (msg.animation) savedMessage.mediaFileId = msg.animation.file_id;

            if (msg.caption) savedMessage.text = msg.caption;
            if (msg.caption_entities) savedMessage.entities = msg.caption_entities;

            await User.update({ autoMsgSaved: savedMessage }, { where: { chatId } });
            triggerBackup('auto_msg_msg', false);
            delete global.userStates[chatId];

            const typeLabel = {
                photo: '🖼 Rasm', video: '🎬 Video', audio: '🎵 Audio', voice: '🎙 Ovozli',
                document: '📄 Fayl', sticker: '😀 Stiker', video_note: '🎥 Video xabar',
                animation: '🎞 GIF', location: '📍 Lokatsiya', contact: '📱 Kontakt',
                poll: '📊 So\'rov', text: '📝 Matn'
            }[savedMessage.type] || '📝 Matn';

            const { getAutoMessageMenu, msToIntervalLabel, destinationKeyToLabel } = require('../utils/helpers');
            const user = await User.findOne({ where: { chatId } });
            const settings = {
                enabled: !!user.autoMsgEnabled,
                intervalMs: user.autoMsgIntervalMs ? Number(user.autoMsgIntervalMs) : null,
                destinations: user.autoMsgDestinations || [],
                savedMessage
            };
            const enabledText = settings.enabled ? '🟢 **Yoqilgan**' : '🔴 **O\'chirilgan**';
            const intervalText = settings.intervalMs ? msToIntervalLabel(settings.intervalMs) : 'Belgilanmagan';
            const destText = settings.destinations && settings.destinations.length > 0
                ? settings.destinations.map(destinationKeyToLabel).join(', ')
                : 'Belgilanmagan';
            const textMsg =
                `✅ **Xabar saqlandi!**\nTuri: ${typeLabel}\n\n` +
                `🚀 **Avto Xabar**\n\n` +
                `⚙️ **Holat:** ${enabledText}\n` +
                `⏰ **Interval:** ${intervalText}\n` +
                `📍 **Qayerga:** ${destText}\n` +
                `📝 **Xabar:** ✅ Yuklangan`;
            await bot.sendMessage(chatId, textMsg, { parse_mode: 'Markdown', ...getAutoMessageMenu(settings) });
            return;
        }

        if (state.step === 'WAITING_AUTOMSG_TARGET') {
            const { AUTOMSG_GROUP_REQUEST_ID, AUTOMSG_CHANNEL_REQUEST_ID } = require('../utils/helpers');
            let targetId = null;
            let targetTitle = null;
            let targetType = null;

            if (msg.chat_shared) {
                if (msg.chat_shared.request_id === AUTOMSG_GROUP_REQUEST_ID) {
                    const s = parseSharedGroup(msg.chat_shared);
                    targetId = s.id;
                    targetTitle = s.title;
                    targetType = 'group';
                } else if (msg.chat_shared.request_id === AUTOMSG_CHANNEL_REQUEST_ID) {
                    targetId = String(msg.chat_shared.chat_id);
                    targetTitle = msg.chat_shared.title || 'Kanal';
                    targetType = 'channel';
                }
            } else if (text) {
                const normalized = normalizeTelegramUrl(text);
                if (normalized) {
                    const m = normalized.match(/t\.me\/(.+)/);
                    targetId = m ? ('@' + m[1]) : text.trim();
                } else {
                    targetId = text.trim();
                }
                if (/^-?\d+$/.test(targetId)) targetType = String(targetId).startsWith('-100') ? 'channel' : 'group';
                else if (targetId.startsWith('@') || /^https?:\/\//.test(targetId)) targetType = 'any';
                else targetType = 'any';
                targetTitle = targetId;
            }

            if (!targetId) {
                return bot.sendMessage(chatId, "❌ Noto'g'ri kiriting. Username/link yoki ID raqam yuboring:", {
                    ...removeKeyboardMarkup()
                });
            }

            const user = await User.findOne({ where: { chatId } });
            const targets = (user.autoMsgCustomTargets || []).filter(t => t && t.id !== targetId);
            targets.push({ id: targetId, title: targetTitle || targetId, type: targetType || 'any' });
            await User.update({ autoMsgCustomTargets: targets.slice(-50) }, { where: { chatId } });
            triggerBackup('auto_msg_target', false);
            delete global.userStates[chatId];

            const { getAutoMessageMenu, msToIntervalLabel, destinationKeyToLabel } = require('../utils/helpers');
            const u = await User.findOne({ where: { chatId } });
            const settings = {
                enabled: !!u.autoMsgEnabled,
                intervalMs: u.autoMsgIntervalMs ? Number(u.autoMsgIntervalMs) : null,
                destinations: u.autoMsgDestinations || [],
                customTargets: targets,
                savedMessage: u.autoMsgSaved || null
            };
            const enabledText = settings.enabled ? '🟢 **Yoqilgan**' : '🔴 **O\'chirilgan**';
            const intervalText = settings.intervalMs ? msToIntervalLabel(settings.intervalMs) : 'Belgilanmagan';
            const destText = settings.destinations && settings.destinations.length > 0
                ? settings.destinations.map(destinationKeyToLabel).join(', ')
                : 'Belgilanmagan';
            const hasMsg = settings.savedMessage && Object.keys(settings.savedMessage).length > 0;
            const customCount = (targets || []).length;
            const outText =
                `✅ **Qo'shildi:** ${targetTitle || targetId}\n\n` +
                `🚀 **Avto Xabar**\n\n` +
                `⚙️ **Holat:** ${enabledText}\n` +
                `⏰ **Interval:** ${intervalText}\n` +
                `📍 **Qayerga:** ${destText}\n` +
                (customCount > 0 ? `🔗 **Qo'shimcha joylar:** ${customCount} ta\n` : '') +
                `📝 **Xabar:** ${hasMsg ? '✅ Yuklangan' : '❌ Yuklanmagan'}`;
            await bot.sendMessage(chatId, outText, {
                parse_mode: 'Markdown',
                ...removeKeyboardMarkup(),
                ...getAutoMessageMenu(settings)
            });
            return;
        }

        // ============================================================
        // AUTO XABAR - ISTISNO QO'SHISH (Exception)
        // ============================================================
        if (state.step === 'WAITING_AUTOMSG_EXCEPTION') {
            const {
                AUTOMSG_EXC_GROUP_REQUEST_ID,
                AUTOMSG_EXC_CHANNEL_REQUEST_ID,
                AUTOMSG_EXC_USER_REQUEST_ID
            } = require('../utils/helpers');
            let targetId = null;
            let targetTitle = null;
            let targetType = null;

            if (msg.chat_shared) {
                if (msg.chat_shared.request_id === AUTOMSG_EXC_GROUP_REQUEST_ID) {
                    const s = parseSharedGroup(msg.chat_shared);
                    targetId = s.id;
                    targetTitle = s.title;
                    targetType = 'group';
                } else if (msg.chat_shared.request_id === AUTOMSG_EXC_CHANNEL_REQUEST_ID) {
                    targetId = String(msg.chat_shared.chat_id);
                    targetTitle = msg.chat_shared.title || 'Kanal';
                    targetType = 'channel';
                }
            } else if (msg.user_shared && msg.user_shared.request_id === AUTOMSG_EXC_USER_REQUEST_ID) {
                targetId = String(msg.user_shared.user_id);
                targetTitle = msg.user_shared.first_name || ('User ' + targetId);
                targetType = 'user';
            } else if (text) {
                const normalized = normalizeTelegramUrl(text);
                if (normalized) {
                    const m = normalized.match(/t\.me\/(.+)/);
                    targetId = m ? ('@' + m[1]) : text.trim();
                } else {
                    targetId = text.trim();
                }
                if (/^-?\d+$/.test(targetId)) {
                    if (String(targetId).startsWith('-100')) targetType = 'channel';
                    else if (String(targetId).startsWith('-')) targetType = 'group';
                    else targetType = 'user';
                } else if (targetId.startsWith('@') || /^https?:\/\//.test(targetId)) {
                    targetType = 'any';
                } else {
                    targetType = 'any';
                }
                targetTitle = targetId;
            }

            if (!targetId) {
                return bot.sendMessage(chatId, "❌ Noto'g'ri kiriting. Username/link yoki ID raqam yuboring:", {
                    ...removeKeyboardMarkup()
                });
            }

            const userModel = await User.findOne({ where: { chatId } });
            const excArr = Array.isArray(userModel.autoMsgExceptions) ? [...userModel.autoMsgExceptions] : [];
            // Avval bor bo'lsa, uni oldin olib tashlaymiz
            const filtered = excArr.filter(e => e && String(e.id) !== String(targetId));
            filtered.push({
                id: targetId,
                title: targetTitle || targetId,
                type: targetType || 'any',
                addedAt: new Date().toISOString()
            });
            await User.update({ autoMsgExceptions: filtered.slice(-200) }, { where: { chatId } });
            triggerBackup('auto_msg_exception_add', false);
            delete global.userStates[chatId];

            const { getAutoMessageMenu, msToIntervalLabel, destinationKeyToLabel, getAutoMsgExceptionMenu } = require('../utils/helpers');
            const u = await User.findOne({ where: { chatId } });

            const list = Array.isArray(u.autoMsgExceptions) ? u.autoMsgExceptions : [];
            let listText = `✅ **Istisnoga qo'shildi:** ${targetTitle || targetId}\n\n`;
            if (list.length > 0) {
                listText += `⛔ **Hozirgi istisnolar (${list.length} ta):**\n\n`;
                list.forEach((ex, i) => {
                    const icon = ex.type === 'user' ? '👤' : (ex.type === 'channel' ? '📢' : '👥');
                    listText += `${i + 1}. ${icon} \`${ex.id}\` — ${ex.title || ex.id}\n`;
                });
            }
            await bot.sendMessage(chatId, listText, {
                parse_mode: 'Markdown',
                ...removeKeyboardMarkup(),
                ...getAutoMsgExceptionMenu(list)
            });
            return;
        }

        // ============================================================
        // AVTO JAVOB
        // ============================================================
        if (state.step === 'WAITING_AUTOREPLY_MSG') {
            const replyText = msg.text || msg.caption || '';
            if (!replyText || !replyText.trim()) {
                return bot.sendMessage(chatId, "❌ Hech qanday matn topilmadi. Qaytadan yuboring:");
            }
            const entities = msg.entities || msg.caption_entities || null;
            await User.update({ autoReplyMessage: replyText, autoReplyEntities: entities }, { where: { chatId } });
            triggerBackup('auto_reply_msg', false);
            delete global.userStates[chatId];

            const { getAutoReplyMenu } = require('../utils/helpers');
            const user = await User.findOne({ where: { chatId } });
            const text =
                `✅ **Avto Javob matni saqlandi:**\n\n` +
                `${replyText.length > 300 ? replyText.slice(0, 300) + '...' : replyText}\n\n` +
                `💬 **Avto Javob**\n\n` +
                `⚙️ **Holat:** ${user.autoReplyEnabled ? '🟢 Yoqilgan' : '🔴 O\'chirilgan'}`;
            await bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                ...removeKeyboardMarkup(),
                ...getAutoReplyMenu({ enabled: !!user.autoReplyEnabled, customMessage: replyText })
            });
            return;
        }
    });
};

