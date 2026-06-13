const User = require('../models/User');
const config = require('../config');
const texts = require('../config/texts');
const { getDbReady } = require('../config/db');
const { findUserByChatId } = require('../utils/dbUser');
const { startUserbot } = require('../services/userbot');
const { 
    formatRemainingTime, 
    checkMembership, 
    sendSubscriptionAsk, 
    getMainMenu,
    getBonusCoinRow,
    getPendingPaymentKeyboard,
    getAdminCoinKeyboard,
    BUTTON_EMOJI_IDS,
    BUTTON_STYLES
} = require('../utils/helpers');
const {
    COINS_PER_MONTH,
    parseStartPayload,
    handleStartWithReferral,
    buildBonusMessage,
    buildCoinMessage,
    isBonusEnabled
} = require('../services/bonus');

const bonusExtrasKeyboard = () => ({
    reply_markup: { inline_keyboard: [getBonusCoinRow()] }
});

module.exports = (bot) => {
    const sendBonusCoinHint = async (chatId, extraText = '') => {
        if (!(await isBonusEnabled())) return;
        const prefix = extraText ? `${extraText}\n\n` : '';
        await bot.sendMessage(
            chatId,
            `${prefix}🎁 **Bonus:** do'stlarni taklif qiling — /bonus`,
            { parse_mode: 'Markdown', ...bonusExtrasKeyboard() }
        ).catch(() => {});
    };

    bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => { 
        const chatId = msg.chat.id; 
        const name = msg.from.first_name; 
        const username = msg.from.username;

        if (!getDbReady()) {
            return bot.sendMessage(chatId, texts.errors.botLoading);
        }
        const startPayload = match && match[1] ? match[1].trim() : parseStartPayload(msg.text);
        const refToken = startPayload && startPayload.startsWith('ref_')
            ? startPayload.slice(4)
            : (startPayload || null);
    
        let user = await findUserByChatId(chatId); 
        const isNewUser = !user;
        if (!user) { 
            const initialStatus = chatId.toString() === config.adminId.toString() ? 'approved' : 'pending';
            user = await User.create({ chatId, name, username, status: initialStatus }); 
        } else {
            await User.update({ name, username }, { where: { chatId } });
            user = await User.findOne({ where: { chatId } });
        }

        if (refToken && isNewUser) {
            const refResult = await handleStartWithReferral(bot, chatId, name, username, refToken, true);
            if (refResult && refResult.invalidLink) {
                await bot.sendMessage(chatId, texts.errors.referralExpired);
            }
        }

        const isMember = await checkMembership(bot, chatId);
        if (!isMember) {
            await sendSubscriptionAsk(bot, chatId);
            if (refToken && isNewUser) {
                await bot.sendMessage(
                    chatId,
                    texts.subscription.askJoin,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
        }

        // Adminni avtomatik tasdiqlash
        if (chatId.toString() === config.adminId.toString() && user.status !== 'approved') {
            user.status = 'approved';
            await user.save();
        }
    
        if (user.status === 'blocked') {
            bot.sendMessage(chatId, texts.payment.blocked(name, texts.admin.username), {
                parse_mode: 'Markdown',
                reply_markup: getPendingPaymentKeyboard()
            });

            // Adminga xabar yuborish
            const now = new Date().toLocaleString('en-US', { timeZone: 'UTC' });
            bot.sendMessage(config.adminId, texts.adminNotifications.blockedUser(name, chatId, now), {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [texts.adminButtons.approve1Month(chatId)],
                        [texts.adminButtons.approveVIP(chatId)],
                        [texts.adminButtons.approveCustom(chatId)]
                    ]
                }
            });
            return;
        }

        if (user.status !== 'approved') { 
            // Adminga xabar yuborish
            bot.sendMessage(config.adminId, texts.adminNotifications.newUser(name, username, chatId), {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [texts.adminButtons.approve1Month(chatId)],
                        [texts.adminButtons.approveVIP(chatId)],
                        [texts.adminButtons.approveCustom(chatId)],
                        [texts.adminButtons.block(chatId)]
                    ]
                }
            });

            await bot.sendMessage(chatId, texts.payment.pending(name, texts.admin.username), {
                parse_mode: 'Markdown',
                reply_markup: getPendingPaymentKeyboard()
            });
            return;
        } 
    
        // 2. Auth Flow (Akkauntga kirish)
        if (user.session) {
            // Avto Almaz holatini yuklash
            const { avtoAlmazStates } = require('../services/userbot');
            avtoAlmazStates[chatId] = user.avtoAlmaz;

            // Agar sessiya bo'lsa, menyuni ko'rsatamiz va userbotni ulaymiz
            bot.sendMessage(chatId, texts.welcome.withSession(name), getMainMenu(chatId)); 
            
            startUserbot(chatId, user.session, bot); 
        } else {
            // Agar sessiya bo'lmasa, login jarayonini boshlaymiz
            const { getPhoneShareKeyboard } = require('../utils/helpers');
            global.userStates[chatId] = { step: 'WAITING_PHONE' };
            bot.sendMessage(chatId, texts.welcome.withoutSession, { parse_mode: "Markdown", reply_markup: getPhoneShareKeyboard() });
        }
    }); 

    bot.onText(/\/menu/, async (msg) => {
        const chatId = msg.chat.id;
        const isMember = await checkMembership(bot, chatId);
        if (!isMember) return sendSubscriptionAsk(bot, chatId);

        const user = await User.findOne({ where: { chatId } });
        if (!user || !user.session) {
            return bot.sendMessage(chatId, texts.errors.needLogin);
        }
        bot.sendMessage(chatId, "📊 **Asosiy menyu:**", getMainMenu(chatId));
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, texts.help(texts.admin.channel, texts.admin.username));
    });

    bot.onText(/\/profile/, async (msg) => {
        const chatId = msg.chat.id;
        const isMember = await checkMembership(bot, chatId);
        if (!isMember) return sendSubscriptionAsk(bot, chatId);

        const user = await User.findOne({ where: { chatId } });
        if (!user) return bot.sendMessage(chatId, texts.errors.notRegistered);

        const accCount = (user.reklamaAccounts ? user.reklamaAccounts.length : 0) + (user.reydAccounts ? user.reydAccounts.length : 0) + (user.session ? 1 : 0);
        const text = `👤 **Profilingiz:**\n\nIsm: ${user.name}\nID: \`${user.chatId}\`\nStatus: ${user.status}\nTarif: ${user.subscriptionType}\nMuddat: ${formatRemainingTime(user.expireAt)}\n💎 Almazlar: ${user.clicks}\n📱 Akkauntlar: ${accCount} ta`;
        bot.sendMessage(chatId, text);
    });

    // Admin Commands
    bot.onText(/\/info_(\d+)/, async (msg, match) => { 
        if (msg.chat.id.toString() !== config.adminId.toString()) return; 
        const targetId = match[1]; 
        
        try {
            const user = await User.findOne({ where: { chatId: targetId } }); 
            if (!user) return bot.sendMessage(config.adminId, "❌ Foydalanuvchi topilmadi."); 
            
            const statusText = user.status === 'approved' ? "✅ Tasdiqlangan" : (user.status === 'blocked' ? "🚫 Bloklangan" : "⏳ Tasdiqlanmagan");
            const tarifText = user.subscriptionType || "Oddiy";
            let remainingTime = formatRemainingTime(user.expireAt);
            if (remainingTime.includes("Cheksiz")) remainingTime = "Cheksiz";

            const rekAccCount = user.reklamaAccounts ? user.reklamaAccounts.length : 0;
            const reydAccCount = user.reydAccounts ? user.reydAccounts.length : 0;
            
            const joinedDate = user.joinedAt ? new Date(user.joinedAt) : new Date();
            const regDate = `${joinedDate.getFullYear()}-${String(joinedDate.getMonth() + 1).padStart(2, '0')}-${String(joinedDate.getDate()).padStart(2, '0')} ${String(joinedDate.getHours()).padStart(2, '0')}:${String(joinedDate.getMinutes()).padStart(2, '0')}`;

            // HTML escape function - escapes <, >, & to prevent HTML injection
            const escapeHtml = (str) => {
                if (!str) return str;
                return String(str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
            };
            
            const text = `👤 <b>Foydalanuvchi Ma'lumotlari:</b>\n\n` +
                `📛 <b>Ism:</b> ${escapeHtml(user.name || "Noma'lum")}\n` +
                `🔗 <b>Username:</b> ${user.username ? `@${escapeHtml(user.username)}` : "Yo'q"}\n` +
                `🆔 <b>ID:</b> <code>${user.chatId}</code>\n` +
                `🔰 <b>Holat:</b> ${statusText}\n` +
                `⏰ <b>Tarif:</b> ${escapeHtml(tarifText)}\n` +
                `⏳ <b>Qolgan vaqt:</b> ${escapeHtml(remainingTime)}\n\n` +
                `🗂 <b>Ulangan akkauntlar soni:</b>\n` +
                `📣 Reklama: ${rekAccCount} ta | ⚔️ Reyd: ${reydAccCount} ta\n\n` +
                `📊 <b>Statistika:</b>\n` +
                `⚔️ Reydlar: ${user.reydCount || 0} ta\n` +
                `👥 Yig'ilgan userlar: ${user.usersGathered || 0} ta\n` +
                `📢 Yuborilgan reklamalar: ${user.adsCount || 0} ta\n` +
                `🏷 Utaglar: ${user.utagCount || 0} ta\n` +
                `💎 Almazlar: ${user.clicks || 0} ta\n` +
                `🪙 Coinlar: ${user.coins || 0} ta\n\n` +
                `📅 <b>Ro'yxatdan o'tgan:</b> ${regDate}`;

            await bot.sendMessage(config.adminId, text, { 
                parse_mode: "HTML",
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "1 Oy", callback_data: `admin_approve_1month_${targetId}`, icon_custom_emoji_id: BUTTON_EMOJI_IDS.check, style: BUTTON_STYLES.success }],
                        [{ text: "VIP", callback_data: `admin_approve_vip_${targetId}`, icon_custom_emoji_id: BUTTON_EMOJI_IDS.crown, style: BUTTON_STYLES.success }],
                        [{ text: "Ixtiyoriy", callback_data: `admin_approve_${targetId}`, icon_custom_emoji_id: BUTTON_EMOJI_IDS.custom, style: BUTTON_STYLES.primary }],
                        [{ text: "Bloklash", callback_data: `admin_block_${targetId}`, icon_custom_emoji_id: BUTTON_EMOJI_IDS.block, style: BUTTON_STYLES.danger }],
                        ...getAdminCoinKeyboard(targetId)
                    ] 
                } 
            });
        } catch (error) {
            console.error(`❌ /info_${targetId} xatolik:`, error);
            bot.sendMessage(config.adminId, `❌ Xatolik yuz berdi:\n\nUser ID: ${targetId}\nXatolik: ${error.message}`);
        }
    });

    bot.onText(/\/stats/, async (msg) => {
        if (msg.chat.id.toString() !== config.adminId.toString()) return;
        const totalUsers = await User.count();
        const approvedUsers = await User.count({ where: { status: 'approved' } });
        bot.sendMessage(config.adminId, `📊 **Statistika:**\n\nJami userlar: ${totalUsers}\nTasdiqlanganlar: ${approvedUsers}`);
    });

    bot.onText(/\/getsession/, async (msg) => {
        if (msg.chat.id.toString() !== config.adminId.toString()) return;
        const user = await User.findOne({ where: { chatId: config.adminId } });
        if (!user || !user.session) {
            return bot.sendMessage(config.adminId, "❌ Sessiya topilmadi! Avval botga kiring.");
        }
        bot.sendMessage(config.adminId, `🔐 **Sessiya string'ingiz:**\n\n\`${user.session}\``, { parse_mode: "Markdown" });
    });

    bot.onText(/\/bonus/, async (msg) => {
        const chatId = msg.chat.id;
        let user = await User.findOne({ where: { chatId } });
        if (!user) {
            user = await User.create({
                chatId,
                name: msg.from.first_name,
                username: msg.from.username,
                status: chatId.toString() === config.adminId.toString() ? 'approved' : 'pending'
            });
        }
        const { text, keyboard, parseMode } = await buildBonusMessage(bot, chatId);
        await bot.sendMessage(chatId, text, {
            parse_mode: parseMode || 'HTML',
            reply_markup: keyboard,
            skipEmojiWrap: true
        });
    });

    bot.onText(/\/coin/, async (msg) => {
        const chatId = msg.chat.id;
        let user = await User.findOne({ where: { chatId } });
        if (!user) {
            user = await User.create({
                chatId,
                name: msg.from.first_name,
                username: msg.from.username,
                status: chatId.toString() === config.adminId.toString() ? 'approved' : 'pending'
            });
        }
        const { text, keyboard } = await buildCoinMessage(chatId);
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    });
};
