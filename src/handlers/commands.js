const User = require('../models/User');
const config = require('../config');
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
    getAdminCoinKeyboard
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

const HELP_TEXT = `🧾 **YORDAM BO'LIMI**

🤖 **Botning barcha imkoniyatlari bilan tanishing:**

💎 **Avto Almaz**
➤ Guruhlardagi "Olish" (Diamond) tugmalarini avtomatik bosadi. 
➤ Siz botni yoqib qo'ysangiz kifoya, qolganini o'zi bajaradi.

🏷 **Avto Utag**
➤ Guruh a'zolarini bittalab "tag" qilib chiqadi. 
➤ Guruhni jonlantirish yoki muhim xabarni yetkazish uchun qulay.

👤 **AvtoUser (Scraper)**
➤ Istalgan guruhdan foydalanuvchilar ro'yxatini (username) yig'ib beradi. 
➤ Yig'ilgan ro'yxatni Reklama uchun ishlatishingiz mumkin.

⚔️ **Avto Reyd**
➤ Berilgan guruh yoki foydalanuvchiga tinimsiz xabar/stiker yuboradi. 
➤ Bir vaqtning o'zida bir nechta akkauntdan foydalanish imkoniyati mavjud.

🚀 **Avto Reklama**
➤ Siz yuborgan foydalanuvchilar ro'yxatiga avtomatik reklama tarqatadi. 
➤ Spamga tushmaslik uchun akkauntlarni navbatma-navbat almashtiradi.

📊 **Profil va Statistika**
➤ Sizning botdagi holatingiz, tarifingiz va statistikangizni ko'rsatadi.

🔄 **Nomer Almashtirish**
➤ Joriy akkauntdan chiqib, yangi raqam orqali kirish imkonini beradi.

⚠️ **Eslatma:** Botdan to'liq foydalanish uchun admin tomonidan tasdiqlangan bo'lishingiz shart.

📞 **Rasmiy kanal:** @AvtoBot_News
👨‍💼 **Admin:** @ortiqov_x7`;

module.exports = (bot) => {
    const sendBonusCoinHint = async (chatId, extraText = '') => {
        if (!(await isBonusEnabled())) return;
        const prefix = extraText ? `${extraText}\n\n` : '';
        await bot.sendMessage(
            chatId,
            `${prefix}🎁 **Bonus:** do'stlarni taklif qiling — /bonus\n🪙 **Coin:** yig'ing va 50 coinda 1 oy oling — /coin`,
            { parse_mode: 'Markdown', ...bonusExtrasKeyboard() }
        ).catch(() => {});
    };

    bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => { 
        const chatId = msg.chat.id; 
        const name = msg.from.first_name; 
        const username = msg.from.username;

        if (!getDbReady()) {
            return bot.sendMessage(chatId, '⏳ Bot hali yuklanmoqda. Iltimos, 10 soniyadan keyin qayta /start bosing.');
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
                await bot.sendMessage(chatId, '⚠️ Referral havola eskirgan. Do\'stingizdan yangi havola so\'rang.');
            }
        }

        const isMember = await checkMembership(bot, chatId);
        if (!isMember) {
            await sendSubscriptionAsk(bot, chatId);
            if (refToken && isNewUser) {
                await bot.sendMessage(
                    chatId,
                    '📢 Kanallarga obuna bo\'ling va **Tekshirish** ni bosing.',
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
            const blockedText =
                `⚠ Sizning foydalanish muddatingiz tugagan.\n\n` +
                `🪙 **50 coin** to'lab 1 oylik obuna olsangiz (/coin) — avtomatik ochiladi.\n` +
                `Yoki admin orqali to'lov qiling.\n\n👨‍💼 Admin: @ortiqov_x7`;
            bot.sendMessage(chatId, blockedText, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🪙 Coin orqali ochish", callback_data: "menu_coin" }],
                        ...getPendingPaymentKeyboard().inline_keyboard
                    ]
                }
            });

            // Adminga xabar yuborish
            const now = new Date().toLocaleString('en-US', { timeZone: 'UTC' }); // Yoki foydalanuvchi vaqti
            const adminNotifyText = `🆕 **Yangi foydalanuvchi!**\n\n👤 Ism: ${name}\n🆔 ID: \`${chatId}\`\n📅 Vaqt: ${now}\n\nBlokdan ochish uchun tugmani bosing:`;
            bot.sendMessage(config.adminId, adminNotifyText, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ 1 Oy (Standard)", callback_data: `admin_approve_1month_${chatId}` }],
                        [{ text: "👑 VIP (Cheksiz)", callback_data: `admin_approve_vip_${chatId}` }],
                        [{ text: "✍️ Qo'lda tasdiqlash", callback_data: `admin_approve_${chatId}` }]
                    ]
                }
            });
            return;
        }

        if (user.status !== 'approved') { 
            // Adminga xabar yuborish
            const isPending = user.status === 'pending';
            const adminHeader = isPending ? "🆕 **Yangi foydalanuvchi!**" : "🆕 **Yangi foydalanuvchi!**";
            const adminText = `${adminHeader}\n\nIsm: ${name}\nUsername: @${username || 'yo\'q'}\nID: \`${chatId}\`\n\nTasdiqlash uchun quyidagi tugmani bosing:`;
            bot.sendMessage(config.adminId, adminText, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ 1 Oy (Standard)", callback_data: `admin_approve_1month_${chatId}` }],
                        [{ text: "👑 VIP (Cheksiz)", callback_data: `admin_approve_vip_${chatId}` }],
                        [{ text: "✍️ Qo'lda tasdiqlash", callback_data: `admin_approve_${chatId}` }],
                        [{ text: "🚫 Bloklash", callback_data: `admin_block_${chatId}` }]
                    ]
                }
            });

            const paymentAskText =
                `👋 Assalomu alaykum, Hurmatli ${name}!\n\n` +
                `⚠ Siz botdan foydalanish uchun botning oylik tulovini amalga oshirmagansiz.\n` +
                `⚠ Botdan foydalanish uchun admin orqali to'lov qiling yoki dostlarni taklif qilish orqali pul ishlang!!!\n\n` +
                `🎁 **Pul ishlash:** do'stlaringizni taklif qiling — har biri uchun **+1 coin**.\n` +
                `👨‍💼 Admin: @ortiqov_x7`;
            await bot.sendMessage(chatId, paymentAskText, {
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
            const welcomeText = `👋 Assalomu alaykum, Hurmatli ${name}! \n\n 🤖 Bu bot orqali siz: \n • 💎 Avto Almaz - avtomatik almaz yig'ish \n • 👤 AvtoUser - guruhdan foydalanuvchilarni yig'ish \n • ⚔ Avto Reyd - guruhga yoki userga xabar yuborish \n • 📣 Avto Reklama - foydalanuvchilarga reklama yuborish \n • 🏷 Avto Uteg - guruhda foydalanuvchilarni uteg qilish \n\n Botdan foydalanish uchun menudan tanlang!`;
            bot.sendMessage(chatId, welcomeText, getMainMenu(chatId)); 
            
            startUserbot(chatId, user.session, bot); 
        } else {
            // Agar sessiya bo'lmasa, login jarayonini boshlaymiz
            global.userStates[chatId] = { step: 'WAITING_PHONE' };
            const text = `👋 **Xush kelibsiz!**\n\nBot funksiyalaridan foydalanish uchun Telegram akkauntingizga kirishingiz kerak.\n\n📞 Iltimos, **telefon raqamingizni** xalqaro formatda yuboring:\n(Masalan: \`+998901234567\`)`;
            bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { remove_keyboard: true } });
        }
    }); 

    bot.onText(/\/menu/, async (msg) => {
        const chatId = msg.chat.id;
        const isMember = await checkMembership(bot, chatId);
        if (!isMember) return sendSubscriptionAsk(bot, chatId);

        const user = await User.findOne({ where: { chatId } });
        if (!user || !user.session) {
            return bot.sendMessage(chatId, "❌ Menyuni ko'rish uchun avval botga kiring.");
        }
        bot.sendMessage(chatId, "📊 **Sizning menyuingiz:**", getMainMenu(chatId));
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, HELP_TEXT);
    });

    bot.onText(/\/profile/, async (msg) => {
        const chatId = msg.chat.id;
        const isMember = await checkMembership(bot, chatId);
        if (!isMember) return sendSubscriptionAsk(bot, chatId);

        const user = await User.findOne({ where: { chatId } });
        if (!user) return bot.sendMessage(chatId, "❌ Ro'yxatdan o'tmagansiz.");

        const accCount = (user.reklamaAccounts ? user.reklamaAccounts.length : 0) + (user.reydAccounts ? user.reydAccounts.length : 0) + (user.session ? 1 : 0);
        const text = `👤 **Profilingiz:**\n\nIsm: ${user.name}\nID: \`${user.chatId}\`\nStatus: ${user.status}\nTarif: ${user.subscriptionType}\nMuddat: ${formatRemainingTime(user.expireAt)}\n💎 Almazlar: ${user.clicks}\n📱 Akkauntlar: ${accCount} ta`;
        bot.sendMessage(chatId, text);
    });

    // Admin Commands
    bot.onText(/\/info_(\d+)/, async (msg, match) => { 
        if (msg.chat.id.toString() !== config.adminId.toString()) return; 
        const targetId = match[1]; 
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

        const text = `👤 **Foydalanuvchi Ma'lumotlari:**\n\n` +
            `📛 **Ism:** ${user.name || "Noma'lum"}\n` +
            `🔗 **Username:** ${user.username ? `@${user.username}` : "Yo'q"}\n` +
            `🆔 **ID:** \`${user.chatId}\`\n` +
            `🔰 **Holat:** ${statusText}\n` +
            `⏰ **Tarif:** ${tarifText}\n` +
            `⏳ **Qolgan vaqt:** ${remainingTime}\n\n` +
            `🗂 **Ulangan akkauntlar soni:**\n` +
            `📣 Reklama: ${rekAccCount} ta | ⚔️ Reyd: ${reydAccCount} ta\n\n` +
            `📊 **Statistika:**\n` +
            `⚔️ Reydlar: ${user.reydCount || 0} ta\n` +
            `👥 Yig'ilgan userlar: ${user.usersGathered || 0} ta\n` +
            `📢 Yuborilgan reklamalar: ${user.adsCount || 0} ta\n` +
            `🏷 Utaglar: ${user.utagCount || 0} ta\n` +
            `💎 Almazlar: ${user.clicks || 0} ta\n` +
            `🪙 Coinlar: ${user.coins || 0} ta\n\n` +
            `📅 **Ro'yxatdan o'tgan:** ${regDate}`;

        bot.sendMessage(config.adminId, text, { 
            parse_mode: "Markdown",
            skipEmojiWrap: true,
            reply_markup: { 
                inline_keyboard: [
                    [{ text: "✅ 1 Oy (Standard)", callback_data: `admin_approve_1month_${targetId}` }],
                    [{ text: "👑 VIP (Cheksiz)", callback_data: `admin_approve_vip_${targetId}` }],
                    [{ text: "✍️ Qo'lda tasdiqlash", callback_data: `admin_approve_${targetId}` }],
                    [{ text: "🚫 Bloklash", callback_data: `admin_block_${targetId}` }],
                    ...getAdminCoinKeyboard(targetId)
                ] 
            } 
        }); 
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
        const { text, keyboard } = await buildBonusMessage(bot, chatId);
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
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
