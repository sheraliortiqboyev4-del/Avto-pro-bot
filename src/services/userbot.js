const { TelegramClient, Api } = require("telegram"); 
const { StringSession } = require("telegram/sessions");
const { computeCheck } = require("telegram/Password"); 
const { NewMessage } = require("telegram/events");
const { CallbackQuery } = require("telegram/events/CallbackQuery");
const fs = require("fs");
const path = require("path");
const config = require("../config"); 
const texts = require("../config/texts");
const User = require("../models/User");
const { triggerBackup } = require('../utils/dbBackup');
const { 
    convertToGramJsEntities, 
    escapeHTML, 
    chunkArray, 
    getMainMenu, 
    getReklamaMenu, 
    getReydMenu,
    withPremiumEmojis,
    getUtf16Length,
    removeKeyboardMarkup,
    upsertUtagHistory,
    normalizeUtagGroupId
} = require('../utils/helpers');

const userClients = {}; 
const avtoAlmazStates = {}; 
const utagStates = {}; 
const reklamaStates = {};
const reydSessions = {}; // Reyd uchun global state

// Temporary cleanup - faqat tugagan jarayonlarni tozalash
const cleanupTempData = () => {
    try {
        const now = Date.now();
        let cleaned = 0;
        
        // 1. Tugagan reklama jarayonlarini tozalash (10 daqiqadan keyin)
        for (const chatId in reklamaStates) {
            const state = reklamaStates[chatId];
            if (state.status === 'stopped' && state.finishedAt && (now - state.finishedAt > 600000)) {
                delete reklamaStates[chatId];
                cleaned++;
            }
        }
        
        // 2. Tugagan reyd jarayonlarini tozalash (10 daqiqadan keyin)
        for (const chatId in reydSessions) {
            const state = reydSessions[chatId];
            if ((state.status === 'stopped' || state.status === 'finished') && state.finishedAt && (now - state.finishedAt > 600000)) {
                delete reydSessions[chatId];
                cleaned++;
            }
        }
        
        // 3. Tugagan utag jarayonlarini tozalash (10 daqiqadan keyin)
        for (const chatId in utagStates) {
            const state = utagStates[chatId];
            if (state.status === 'stopped' && state.finishedAt && (now - state.finishedAt > 600000)) {
                delete utagStates[chatId];
                cleaned++;
            }
        }
        
        // 4. Temporary file'larni tozalash (1 soatdan eski)
        const tempDir = path.join(process.cwd(), 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > 3600000) { // 1 soat
                        fs.unlinkSync(filePath);
                        cleaned++;
                    }
                } catch (e) {
                    // Fayl allaqachon o'chirilgan yoki access yo'q
                }
            }
        }
        
        // 5. Garbage collection (agar mavjud bo'lsa)
        if (global.gc) {
            global.gc();
        }
        
        if (cleaned > 0) {
            console.log(`[Cleanup] ${cleaned} ta vaqtinchalik ma'lumot tozalandi`);
        }
        
    } catch (e) {
        console.error('[Cleanup Error]:', e.message);
    }
};

// Har 5 daqiqada cleanup ishga tushirish
setInterval(cleanupTempData, 300000); // 5 daqiqa

const getPromoBot = () => {
    const u = (config.botPromoUsername || '@Foydasizku_bot').trim();
    return u.startsWith('@') ? u : `@${u}`;
};

const PROMO_UTAG = () => `✈ ᴜᴛᴇɢ  ${getPromoBot()} ᴏʀǫᴀʟɪ ʏᴜʙᴏʀɪʟᴅɪ.`;
const PROMO_REKLAMA = () => `🧙 ʀᴇᴋʟᴀᴍᴀ ${getPromoBot()} ᴏʀǫᴀʟɪ ʏᴜʙᴏʀɪʟᴅɪ`;

// --- YORDAMCHI FUNKSIYALAR ---
const getUser = async (chatId) => {
    return await User.findOne({ where: { chatId } });
};

const updateStats = async (chatId) => {
    return await User.increment({ clicks: 1 }, { where: { chatId } });
};

// --- YANGI: Holatlarni bazadan yuklash va botlarni ishga tushirish ---
const loadAllStates = async (bot) => {
    try {
        const { withMigrationRetry } = require('../config/migrate');
        const users = await withMigrationRetry(() =>
            User.findAll({ where: { session: { [require('sequelize').Op.ne]: null }, status: 'approved' } })
        );
        const now = new Date();
        const activeUsers = users.filter((u) => !u.expireAt || new Date(u.expireAt) >= now);
        console.log(`🔄 [Init] ${activeUsers.length} ta foydalanuvchi botlarini ishga tushirish...`);
        for (const user of activeUsers) {
            avtoAlmazStates[user.chatId] = user.avtoAlmaz !== false;
            // Har bir foydalanuvchi uchun userbotni ishga tushiramiz
            startUserbot(user.chatId, user.session, bot).catch(e => {
                console.error(`[AutoStart Error] ${user.chatId}:`, e.message);
            });
            // Render free: parallel ulanishlar TIMEOUT beradi — kutish
            await new Promise(r => setTimeout(r, 3000)); 
        }
        console.log(`✅ [States] ${activeUsers.length} ta foydalanuvchi holati yuklandi va botlar ishga tushirildi.`);
    } catch (e) {
        console.error('loadAllStates error:', e.message);
    }
};

const DEFAULT_TAG_MESSAGES = [
"Қўшилинг ўйнeли 🦦",
"Қўшилинг топ 1 га алмаз 💎",
"Сзи кутяпмиз 🤨",
"Трикмисз 🧐",
"Жгарим келинг 🫂",
"Келасми ўйинга 👀",
"Қўшилинг тез 👊🏻",
"Балки ўйинга қўшиларсиз 👀",
"Ассалому алайкум 😁",
"Бяхкелингчи 🥱",
"Тезро келинг 😾",
"1 та алмаз бериб туринг 💎",
"Келасми ҳамма кутяпти 🥱" ,
"Сизни махсус чақиряпман 😆",
"Онлайн бўлиб жим туриш – жиноят",
"Рамантика қламизми? 🫣",
"Импортни бомждан салoм 😅",
"Сзам жойнинг",
"Қалесз, кўринмай кетдизку",
"Танидизми ўзи 😎",
"10 та алмаз ташаворин",
"Қўшилмасез тепаман",
"Ўйнамисми бугун ",
"Бот келин",
"Мен сени кўряпман 👀",
"Нима гап",
"Гап йўқми сизда 💬",
"Шунақа жим юраверасизми",
"Алмазли ўйин келин",
"Қани сиз",
"Сзи кутиб зерикдим",
"Қўшилинг бошлаймиз",
"Қочиб кетманг 😂",
"Ёзиб туринг",
"Сизни кутяпмиз 💥",
"Жим турманг",
"Ёзинг",
"Жонкам келинг 😂",
"Қўшиласми",
"Сзи соғиндик",
"Тезз ке"
];

// Global xotirada sessiyalarni saqlaymiz
if (!global.authClients) global.authClients = {};

const startUserbot = async (chatId, sessionStr, bot) => { 
    try { 
        if (userClients[chatId]) {
            try { await userClients[chatId].disconnect(); } catch (e) {}
        }

        const clientOpts = getGramJsClientParams(config.authUseWss !== false, { forAuth: false });
        if (config.telegramProxy?.host) {
            clientOpts.proxy = {
                ip: config.telegramProxy.host,
                port: config.telegramProxy.port,
                secret: config.telegramProxy.secret,
                MTProxy: true
            };
        }
        const client = new TelegramClient(new StringSession(sessionStr), config.apiId, config.apiHash, clientOpts);
        await client.connect(); 
        userClients[chatId] = client; 

        console.log("Userbot " + chatId + " uchun ishga tushdi."); 
    
        // Default holat: Bazadan olish 
        if (avtoAlmazStates[chatId] === undefined) { 
            const user = await getUser(chatId); 
            avtoAlmazStates[chatId] = user && user.avtoAlmaz !== undefined ? user.avtoAlmaz : true; 
        } 

        // Ulanish holatini kuzatish
        client.on('disconnected', () => {
            console.log(`[GramJS] User ${chatId} ulanish uzildi. Qayta ulanish kutilmoqda...`);
        });
        
        client.on('reconnected', () => {
            console.log(`[GramJS] User ${chatId} muvaffaqiyatli qayta ulandi.`);
        });        

        // --- YANGI: XABARLARNI ESHITISH (Bot guruhda bo'lmasa ham ishlashi uchun) ---
        client.addEventHandler(async (event) => {
            const message = event.message;
            if (!message || !message.message) return;

            const text = message.message;
            const fromId = message.senderId ? message.senderId.toString() : null;
            
            // Peer ID ni aniqlash
            let peerStr;
            if (message.peerId instanceof Api.PeerUser) peerStr = message.peerId.userId.toString();
            else if (message.peerId instanceof Api.PeerChat) peerStr = `-${message.peerId.chatId}`;
            else if (message.peerId instanceof Api.PeerChannel) peerStr = `-100${message.peerId.channelId}`;

            // Faqat akkaunt egasi yuborgan buyruqlarni tekshiramiz (/uteg yoki .uteg)
            const isOwner = fromId === chatId.toString();
            const isCommand = /^[./!]?(t|b|s)(@|$)/i.test(text);

            if (isOwner && isCommand) {
                const parts = text.split(/\s+/);
                const rawCommand = parts[0].toLowerCase();
                const base = rawCommand.replace(/^[./!]/, '').split('@')[0];
                const aliasMap = {
                    t: 'uteg',
                    b: 'utegtext',
                    s: 'utegstop'
                };
                const command = aliasMap[base] || base;

                try {
                    // 1. Foydalanuvchi obunasini tekshirish
                    const { checkMembership } = require('../utils/helpers');
                    const isMember = await checkMembership(bot, chatId);
                    if (!isMember) return;

                    // 2. Statusni tekshirish
                    const user = await User.findOne({ where: { chatId } });
                    if (!user || user.status !== 'approved') return;

                    // 3. Akkaunt rejimini tekshirish (agar o'rnatilmagan bo'lsa)
                    if (!user.utagAccountMode) {
                        await client.sendMessage(message.peerId, { message: "⚠️ **Avto Utag rejimi o'rnatilmagan.**\nIltimos, botga kirib rejimni tanlang (Asosiy menyu -> Avto Utag)." });
                        return;
                    }

                    if (message.peerId instanceof Api.PeerUser) {
                        await client.sendMessage(message.peerId, {
                            message: "⚠️ Utag buyruqlarini **guruh yoki kanalda** yuboring (shaxsiy chatda emas)."
                        });
                        return;
                    }

                    // --- BUYRUQLAR ---
                    if (command === 'utegstop') {
                        if (utagStates[chatId]) {
                            utagStates[chatId].status = 'stopped';
                            await client.sendMessage(message.peerId, { message: "⏹ **Utag to'xtatildi.** (/s yoki /utegStop)" });
                        }
                        return;
                    }

                    if (command === 'utegtext') {
                        // Rejim tekshiruvi va default rejim o'rnatish
                        let user = await User.findOne({ where: { chatId } });
                        if (!user || !user.utagAccountMode) {
                            // Default rejimni o'rnatish: 'main' (asosiy akkaunt)
                            if (user) {
                                await User.update({ utagAccountMode: 'main' }, { where: { chatId } });
                                user.utagAccountMode = 'main';
                                console.log(`[Utag] Default rejim o'rnatildi (main) user ${chatId} uchun`);
                            } else {
                                await client.sendMessage(message.peerId, { 
                                    message: "⚠️ Foydalanuvchi topilmadi. Iltimos, botga /start buyrug'ini yuboring." 
                                });
                                return;
                            }
                        }
                        await client.sendMessage(message.peerId, { message: "🚀 **Utag (bot so'zlari) boshlanmoqda...**" });
                        startAutoTag(chatId, peerStr, bot, {
                            limit: 0, mode: 'random_words', memberFilter: 'all', isCommand: true
                        }).catch((e) => client.sendMessage(message.peerId, { message: `❌ ${e.message}` }));
                        return;
                    }

                    if (command === 'uteg') {
                        // Rejim tekshiruvi va default rejim o'rnatish
                        let user = await User.findOne({ where: { chatId } });
                        if (!user || !user.utagAccountMode) {
                            // Default rejimni o'rnatish: 'main' (asosiy akkaunt)
                            if (user) {
                                await User.update({ utagAccountMode: 'main' }, { where: { chatId } });
                                user.utagAccountMode = 'main';
                                console.log(`[Utag] Default rejim o'rnatildi (main) user ${chatId} uchun`);
                            } else {
                                await client.sendMessage(message.peerId, { 
                                    message: "⚠️ Foydalanuvchi topilmadi. Iltimos, botga /start buyrug'ini yuboring." 
                                });
                                return;
                            }
                        }
                        const args = parts.slice(1).join(' ').trim();
                        if (args) {
                            await client.sendMessage(message.peerId, { message: `🚀 **Utag ("${args}" bilan) boshlanmoqda...**` });
                            startAutoTag(chatId, peerStr, bot, {
                                limit: 0, mode: 'custom', tagText: args, memberFilter: 'all', isCommand: true
                            }).catch((e) => client.sendMessage(message.peerId, { message: `❌ ${e.message}` }));
                        } else {
                            await client.sendMessage(message.peerId, { message: "🚀 **Utag (faqat @) boshlanmoqda...**" });
                            startAutoTag(chatId, peerStr, bot, {
                                limit: 0, mode: 'only_mention', memberFilter: 'all', isCommand: true
                            }).catch((e) => client.sendMessage(message.peerId, { message: `❌ ${e.message}` }));
                        }
                    }
                } catch (e) {
                    console.error(`[Userbot Command Error] ${chatId}:`, e.message);
                }
            }
        }, new NewMessage({}));

        // GramJS xatolarini ushlash
        client.on('error', (err) => {
            const msg = err.message || '';
            if (msg.includes('Not connected') || msg.includes('TIMEOUT')) {
                console.log(`[GramJS] User ${chatId}: ${msg} (qayta ulanish kutilmoqda)`);
            } else if (!msg.includes('FLOOD')) {
                console.error(`[GramJS Error] User ${chatId}:`, msg);
            }
        });

        console.log(`✅ Userbot ulandi: ${chatId}`);

        // --- AVTO ALMAZ HANDLER (USER INPUT) ---
        client.addEventHandler(async (event) => { 
            const message = event.message; 
            if (!message) return;

            // Real-time muddat tekshirish (faqat admin bo'lmasa) 
            if (chatId.toString() !== config.adminId.toString()) { 
                const user = await getUser(chatId); 
                if (user && user.status === 'approved' && user.expireAt) { 
                    const now = new Date(); 
                    if (user.expireAt < now) { 
                        console.log(`[Real-time Userbot Expiry] User ${chatId} muddati tugagan.`); 
                        await blockExpiredUser(user, bot); 
                        return; 
                    } 
                } 
            } 

            // Agar funksiya o'chirilgan bo'lsa, ishlamaydi 
            if (avtoAlmazStates[chatId] === false) return; 
            
            // Faqat tugmasi bor xabarlarni tekshiramiz 
            if (message && message.buttons && message.buttons.length > 0) { 
                let clicked = false; 
                
                const rows = message.buttons; 
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i]; 
                    for (let j = 0; j < row.length; j++) { 
                        const button = row[j]; 
                        
                        if (button.text) { 
                            const btnText = button.text; 
                            
                            // Regex orqali istalgan miqdordagi almaz/sovg'ani/pulni aniqlash 
                            if ( 
                                /^\d+\s*[💎🎁💵].*olish$/i.test(btnText) || // "10 💎 olish", "100 💵 olish" 
                                btnText === 'olish' || 
                                btnText === 'клик' || 
                                btnText === 'click' || 
                                btnText === 'Click' || 
                                btnText === 'Bosing' || 
                                btnText === 'bosing' ||
                                btnText == '💎  ta olmos olish' ||
                                btnText == '🎁 olish'

                             ) { 
                                console.log("[" + chatId + "] Tugma topildi (Dynamic): " + btnText); 
                                try { 
                                    // Tugmani darhol bosamiz (await kutmasdan, parallel) 
                                    message.click(i, j).then(async () => { 
                                        console.log("[" + chatId + "] Tugma bosildi!"); 
                                        
                                        // Statistikani ham parallel yangilaymiz 
                                        updateStats(chatId).catch(err => console.error("Stats update error:", err)); 

                                        // Xabar yuborish (Non-blocking) 
                                        try { 
                                            const user = await getUser(chatId); 
                                            const totalClicks = user ? (user.clicks + 1) : 1; // +1 chunki updateStats parallel ketyapti 

                                            let chatTitle = "Noma'lum guruh"; 
                                            try { 
                                                const chat = await message.getChat(); 
                                                chatTitle = chat.title || chat.firstName || "Guruh"; 
                                            } catch (e) {} 

                                            // Xabar turini aniqlash 
                                            let rewardText = "1 almaz olindi 💎"; 
                                            if (btnText.includes('💵')) { 
                                                rewardText = "Pul olindi 💵"; 
                                            } 

                                            bot.sendMessage(chatId, "💎 **Avto Almaz:** " + rewardText + "\n" + chatTitle + "\n\nJami: " + totalClicks + " ta", { parse_mode: "Markdown" }); 
                                        } catch (e) { 
                                            console.error("Xabar yuborishda xatolik:", e); 
                                        } 

                                    }).catch(err => { 
                                        console.error("Tugmani bosishda xatolik:", err); 
                                    }); 
                                    
                                    clicked = true; 
                                    break; 
                                } catch (err) { 
                                    console.error("Tugmani bosishda xatolik:", err); 
                                } 
                            } 
                        } 
                    } 
                    if (clicked) break; 
                } 
            } 
        }, new NewMessage({})); 

        // Tahrirlangan xabarlar uchun (ba'zi botlar tugmalarni tahrirlangan xabarda yuboradi)
        client.addEventHandler(async (update) => {
            try {
                if (update instanceof Api.UpdateEditMessage || update instanceof Api.UpdateEditChannelMessage) {
                    const message = update.message;
                    if (message && message.buttons && message.buttons.length > 0) {
                        // O'sha mantiqni tahrirlangan xabarlar uchun ham qo'llaymiz
                        let clicked = false;
                        const rows = message.buttons;
                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            for (let j = 0; j < row.length; j++) {
                                const button = row[j];
                                if (button.text) {
                                    const btnText = button.text;
                                    if ( 
                                        /^\d+\s*[💎🎁💵].*olish$/i.test(btnText) || 
                                        btnText === 'olish' || 
                                        btnText === 'клик' || 
                                        btnText === 'click' || 
                                        btnText === 'Click' || 
                                        btnText === 'Bosing' || 
                                        btnText === 'bosing' ||
                                        btnText == '💎  ta olmos olish' ||
                                        btnText == '🎁 olish'
                                     ) {
                                        message.click(i, j).catch(() => {});
                                        clicked = true;
                                        break;
                                    }
                                }
                            }
                            if (clicked) break;
                        }
                    }
                }
            } catch (e) {}
        });

    } catch (e) { console.error(`Userbot xatosi (${chatId}):`, e.message); } 
}; 

const blockExpiredUser = async (user, bot, options = {}) => {
    const { skipBackup = false } = options;
    const chatId = user.chatId;

    const fresh = await User.findOne({ where: { chatId } });
    if (!fresh || fresh.status === 'blocked') return false;
    if (!fresh.expireAt || new Date(fresh.expireAt) >= new Date()) return false;

    console.log(`[Expiry] User ${chatId} muddati tugadi va bloklandi.`);
    await User.update(
        {
            status: 'blocked',
            session: null,
            reydAccounts: [],
            reklamaAccounts: []
        },
        { where: { chatId } }
    );

    if (userClients[chatId]) {
        try { await userClients[chatId].disconnect(); delete userClients[chatId]; } catch (e) {}
    }

    bot.sendMessage(chatId, texts.payment.expired(texts.admin.username), {
        parse_mode: "Markdown",
        skipEmojiWrap: true,
        reply_markup: {
            inline_keyboard: [[texts.adminButtons.contactAdmin(texts.admin.username)]]
        }
    }).catch(() => {});

    if (!skipBackup) {
        triggerBackup('muddat_tugadi', true);
    }
    return true;
};

// --- AUTH (GramJS 2.26+ sendCode + SignIn) ---

const authErrMsg = (err) => err?.message || err?.errorMessage || String(err);

const getGramJsClientParams = (useWSS, { forAuth = false } = {}) => ({
    connectionRetries: 50,
    requestRetries: 15,
    timeout: 120000,
    autoReconnect: !forAuth,
    floodSleepThreshold: forAuth ? 120 : 300,
    receiveUpdates: false,
    deviceModel: config.tgDeviceModel,
    systemVersion: config.tgSystemVersion,
    appVersion: config.tgAppVersion,
    langCode: 'en',
    systemLangCode: 'en-US',
    useWSS,
    useIPV6: false
});

const buildAuthClientOptions = (useWSS) => {
    const opts = { ...getGramJsClientParams(useWSS, { forAuth: true }) };
    if (config.telegramProxy?.host) {
        opts.proxy = {
            ip: config.telegramProxy.host,
            port: config.telegramProxy.port,
            secret: config.telegramProxy.secret,
            MTProxy: true
        };
        console.log(`[Auth] MTProxy: ${config.telegramProxy.host}:${config.telegramProxy.port}`);
    }
    return opts;
};

/** Cloud serverda avval WSS (443), keyin TCP (80) sinab ko'radi */
const connectAuthClient = async () => {
    const modes = config.authUseWss
        ? [{ useWSS: true, label: 'WSS:443' }, { useWSS: false, label: 'TCP:80' }]
        : [{ useWSS: false, label: 'TCP:80' }, { useWSS: true, label: 'WSS:443' }];

    let lastErr;
    for (const mode of modes) {
        const client = new TelegramClient(
            new StringSession(""),
            config.apiId,
            config.apiHash,
            buildAuthClientOptions(mode.useWSS)
        );
        try {
            await client.connect();
            const dc = client.session?.dcId ?? '?';
            console.log(`[Auth] Ulandi: ${mode.label}, DC=${dc}`);
            return client;
        } catch (e) {
            lastErr = e;
            console.error(`[Auth] ${mode.label} ulanmadi:`, e.message);
            try { await client.disconnect(); } catch (err) {}
        }
    }
    throw lastErr || new Error("Telegram serverga ulanib bo'lmadi");
};

const cleanupAuthClient = async (chatId) => {
    const auth = global.authClients[chatId];
    if (auth?.client) {
        try { await auth.client.disconnect(); } catch (e) {}
    }
    delete global.authClients[chatId];
};

const getCodeDeliveryHint = (isCodeViaApp, sentCode) => {
    if (isCodeViaApp === false) {
        return "📱 Kod **SMS** orqali keladi.";
    }
    if (isCodeViaApp === true) {
        return "📲 Kod **Telegram ilovangizda** keladi (Chatlar → «Telegram» tizim xabari). Boshqa qurilmada ham ochiq bo'lsa, u yerga ham kelishi mumkin.";
    }
    const t = sentCode?.type;
    if (t instanceof Api.auth.SentCodeTypeSms) return "📱 Kod **SMS** orqali keladi.";
    if (t instanceof Api.auth.SentCodeTypeApp) return "📲 Kod **Telegram** tizim chatiga keladi.";
    if (t instanceof Api.auth.SentCodeTypeCall) return "📞 Kod **qo'ng'iroq** orqali aytiladi.";
    return "📲 Kodni Telegram ilovangizda tekshiring.";
};

const attachAlmazHandlers = (client, chatId, bot) => {
    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message) return;
        if (chatId.toString() !== config.adminId.toString()) {
            const user = await getUser(chatId);
            if (user?.status === 'approved' && user.expireAt && user.expireAt < new Date()) {
                await blockExpiredUser(user, bot);
                return;
            }
        }
        if (avtoAlmazStates[chatId] === false) return;
        if (!message.buttons?.length) return;
        for (let i = 0; i < message.buttons.length; i++) {
            const row = message.buttons[i];
            for (let j = 0; j < row.length; j++) {
                const btnText = row[j]?.text;
                if (!btnText) continue;
                if (/^\d+\s*[💎🎁💵].*olish$/i.test(btnText) || ['olish', 'клик', 'click', 'Click', 'Bosing', 'bosing'].includes(btnText)) {
                    message.click(i, j).then(async () => {
                        updateStats(chatId).catch(() => {});
                        const u = await getUser(chatId);
                        const totalClicks = u ? u.clicks + 1 : 1;
                        let chatTitle = "Guruh";
                        try {
                            const chat = await message.getChat();
                            chatTitle = chat.title || chat.firstName || "Guruh";
                        } catch (e) {}
                        const rewardText = btnText.includes('💵') ? "Pul olindi 💵" : "1 almaz olindi 💎";
                        bot.sendMessage(chatId, "💎 **Avto Almaz:** " + rewardText + "\n" + chatTitle + "\n\nJami: " + totalClicks + " ta", { parse_mode: "Markdown" });
                    }).catch(() => {});
                    return;
                }
            }
        }
    }, new NewMessage({}));

    client.addEventHandler(async (update) => {
        if (!(update instanceof Api.UpdateEditMessage || update instanceof Api.UpdateEditChannelMessage)) return;
        const message = update.message;
        if (!message?.buttons?.length) return;
        for (let i = 0; i < message.buttons.length; i++) {
            const row = message.buttons[i];
            for (let j = 0; j < row.length; j++) {
                const btnText = row[j]?.text;
                if (!btnText) continue;
                if (
                    /^\d+\s*[💎🎁💵].*olish$/i.test(btnText) ||
                    ['olish', 'клик', 'click', 'Click', 'Bosing', 'bosing', '💎 1 ta olmos olish', '1🎁 olish'].includes(btnText)
                ) {
                    message.click(i, j).catch(() => {});
                    return;
                }
            }
        }
    });
};

const finalizeAuthLogin = async (client, chatId, bot, isAdditional, isReyd, phoneNumber) => {
    console.log(`[Auth Success] ${chatId} muvaffaqiyatli kirdi.`);
    const sessionStr = client.session.save();

    if (isAdditional) {
        const user = await User.findOne({ where: { chatId } });
        const accounts = isReyd ? (user.reydAccounts || []) : (user.reklamaAccounts || []);
        accounts.push({ session: sessionStr, phoneNumber, addedAt: new Date() });
        const updateData = isReyd ? { reydAccounts: accounts } : { reklamaAccounts: accounts };
        await User.update(updateData, { where: { chatId } });
        triggerBackup('qoshimcha_akkaunt', true);
        const accCount = accounts.length;
        if (isReyd) {
            await bot.sendMessage(chatId, `✅ Qo'shimcha akkaunt Reyd uchun ulandi: ${phoneNumber}`, getReydMenu(accCount));
        } else {
            await bot.sendMessage(chatId, `✅ Qo'shimcha akkaunt Reklama uchun ulandi: ${phoneNumber}`, getReklamaMenu(accCount));
        }
        try { await client.disconnect(); } catch (e) {}
    } else {
        const existing = await User.findOne({ where: { chatId } });
        const updateFields = { session: sessionStr };
        if (!existing || existing.status !== 'approved') updateFields.status = 'approved';
        await User.update(updateFields, { where: { chatId } });
        const user = await User.findOne({ where: { chatId } });
        avtoAlmazStates[chatId] = user ? user.avtoAlmaz : true;
        triggerBackup('login_sessiya', true);
        attachAlmazHandlers(client, chatId, bot);
        userClients[chatId] = client;
        await bot.sendMessage(chatId, "✅ Raqam muvaffaqiyatli kiritildi! Endi bot funksiyalaridan foydalanishingiz mumkin.", getMainMenu(chatId));
    }

    delete global.authClients[chatId];
    delete global.userStates[chatId];
};

const getApiCredentials = () => ({
    apiId: Number(config.apiId),
    apiHash: config.apiHash
});

/** GramJS rasmiy sendCode (AUTH_RESTART qo'llab-quvvatlaydi) */
const requestAuthCode = async (client, phoneNumber, forceSMS = false) => {
    try {
        return await client.sendCode(getApiCredentials(), phoneNumber, forceSMS);
    } catch (err) {
        if (authErrMsg(err).includes('AUTH_RESTART')) {
            return client.sendCode(getApiCredentials(), phoneNumber, forceSMS);
        }
        throw err;
    }
};

const initAuth = async (chatId, phoneNumber, bot, isAdditional = false, isReyd = false) => {
    console.log(`[Auth Start] ${chatId}: ${phoneNumber}`);

    if (!process.env.API_ID || !process.env.API_HASH) {
        throw new Error(texts.errors.apiMissing);
    }

    await cleanupAuthClient(chatId);
    const client = await connectAuthClient();

    let codeResult;
    try {
        codeResult = await requestAuthCode(client, phoneNumber, false);
    } catch (err) {
        await client.disconnect().catch(() => {});
        const msg = authErrMsg(err);
        if (msg.includes('FLOOD') || msg.includes('A wait of')) {
            const sec = msg.match(/\d+/)?.[0] || '?';
            throw new Error(`Telegram cheklovi: ${sec} soniya kuting, keyin qayta urinib ko'ring.`);
        }
        throw new Error(msg);
    }

    const { phoneCodeHash, isCodeViaApp } = codeResult;
    let gramVersion = '?';
    try { gramVersion = require('telegram/package.json').version; } catch (e) {}
    console.log(`[Auth] sendCode OK: ${phoneNumber}, viaApp=${isCodeViaApp}, DC=${client.session?.dcId}, gramjs=${gramVersion}`);

    global.authClients[chatId] = {
        client,
        phoneNumber,
        phoneCodeHash,
        isAdditional,
        isReyd,
        step: 'WAITING_CODE',
        isCodeViaApp
    };

    const hint = getCodeDeliveryHint(isCodeViaApp);
    const isSms = isCodeViaApp === false;
    const keyboard = isSms
        ? { inline_keyboard: [[{ text: '🔄 SMS qayta yuborish', callback_data: 'auth_resend_sms' }]] }
        : {
            inline_keyboard: [
                [{ text: '📱 SMS orqali yuborish', callback_data: 'auth_resend_sms' }],
                [{ text: '🔄 Kodni qayta so\'rash', callback_data: 'auth_resend_app' }]
            ]
        };

    await bot.sendMessage(
        chatId,
        `📩 **Kirish kodi yuborildi.**\n\n${hint}\n\n` +
        `Kodni shu yerga kiriting **(Masalan: \`12.345\`)**\n\n` +
        `_Kod kelmasa pastdagi tugmani bosing._`,
        { parse_mode: "Markdown", reply_markup: keyboard }
    );

    return true;
};

const resendAuthCode = async (chatId, bot, viaSms = false) => {
    const auth = global.authClients[chatId];
    if (!auth?.client || !auth.phoneCodeHash) {
        throw new Error("Avval telefon raqam yuboring.");
    }

    let phoneCodeHash;
    let isCodeViaApp;

    if (viaSms) {
        const result = await requestAuthCode(auth.client, auth.phoneNumber, true);
        phoneCodeHash = result.phoneCodeHash;
        isCodeViaApp = result.isCodeViaApp;
    } else {
        const sentCode = await auth.client.invoke(new Api.auth.ResendCode({
            phoneNumber: auth.phoneNumber,
            phoneCodeHash: auth.phoneCodeHash
        }));
        if (sentCode instanceof Api.auth.SentCodeSuccess) {
            throw new Error("Allaqachon kirilgan. /start bosing.");
        }
        phoneCodeHash = sentCode.phoneCodeHash;
        isCodeViaApp = sentCode.type instanceof Api.auth.SentCodeTypeApp;
    }

    auth.phoneCodeHash = phoneCodeHash;
    auth.isCodeViaApp = isCodeViaApp;
    auth.step = 'WAITING_CODE';
    console.log(`[Auth] Resend: ${auth.phoneNumber}, sms=${viaSms}, viaApp=${isCodeViaApp}`);

    const hint = getCodeDeliveryHint(isCodeViaApp);
    await bot.sendMessage(chatId, `🔄 **Kod qayta yuborildi.**\n\n${hint}`, { parse_mode: "Markdown" });
    return true;
};

const handleAuthStep = async (chatId, input, bot) => {
    const auth = global.authClients[chatId];
    if (!auth) throw new Error("AUTH_NOT_FOUND");

    if (auth.step === 'WAITING_CODE') {
        const code = input.replace(/[^\d]/g, '');
        if (code.length < 5) throw new Error("Kod noto'g'ri. 5 xonali kodni yuboring.");

        try {
            const result = await auth.client.invoke(new Api.auth.SignIn({
                phoneNumber: auth.phoneNumber,
                phoneCodeHash: auth.phoneCodeHash,
                phoneCode: code
            }));

            if (result instanceof Api.auth.AuthorizationSignUpRequired) {
                throw new Error("Bu raqam Telegramda ro'yxatdan o'tmagan.");
            }

            await finalizeAuthLogin(auth.client, chatId, bot, auth.isAdditional, auth.isReyd, auth.phoneNumber);
            return "CODE_SUBMITTED";
        } catch (err) {
            const msg = authErrMsg(err);
            if (msg.includes('SESSION_PASSWORD_NEEDED')) {
                auth.step = 'WAITING_PASSWORD';
                await bot.sendMessage(chatId, "🔐 **2FA parol** kerak. Parolingizni yuboring:", { parse_mode: "Markdown" });
                return "NEED_PASSWORD";
            }
            if (msg.includes('PHONE_CODE_INVALID')) throw new Error("Kod noto'g'ri. Qaytadan yuboring.");
            if (msg.includes('PHONE_CODE_EXPIRED')) {
                await cleanupAuthClient(chatId);
                delete global.userStates[chatId];
                throw new Error("Kod muddati tugagan. /start bosing.");
            }
            throw new Error(msg);
        }
    }

    if (auth.step === 'WAITING_PASSWORD') {
        const password = input.trim();
        if (!password) throw new Error("Parol bo'sh bo'lmasligi kerak.");
        try {
            const pwd = await auth.client.invoke(new Api.account.GetPassword());
            const passwordCheck = await computeCheck(pwd, password);
            await auth.client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
            await finalizeAuthLogin(auth.client, chatId, bot, auth.isAdditional, auth.isReyd, auth.phoneNumber);
            return "PASSWORD_SUBMITTED";
        } catch (err) {
            const msg = authErrMsg(err);
            if (msg.includes('PASSWORD_HASH_INVALID')) throw new Error("Parol noto'g'ri.");
            throw new Error(msg);
        }
    }

    throw new Error("INVALID_STEP");
};

// --- FEATURE FUNCTIONS ---
const scrapeUsers = async (chatId, groupLink, limit = 1000, bot) => {
    const client = await ensureClient(chatId, bot);
    const me = await client.getMe();
    const myId = me.id;
    
    try {
        let entity;
        const rawLink = String(groupLink).trim();
        // 1. Guruhga ulanish (link, @username yoki chat_shared ID)
        if (/^-?\d+$/.test(rawLink)) {
            entity = await client.getEntity(BigInt(rawLink));
        } else if (rawLink.includes("t.me/+") || rawLink.includes("joinchat/")) {
            const hash = rawLink.split('/').pop().replace('+', '');
            try {
                const result = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                entity = result.chats ? result.chats[0] : result.chat;
            } catch (err) {
                if (err.message.includes("USER_ALREADY_PARTICIPANT")) {
                    const check = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
                    entity = check.chat;
                } else { throw err; }
            }
        } else {
            try {
                entity = await client.getEntity(rawLink);
                await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            } catch (err) {
                if (!err.message.includes("USER_ALREADY_PARTICIPANT")) {
                    entity = await client.getEntity(rawLink);
                }
            }
        }

        if (!entity) throw new Error("Guruh topilmadi.");

        const statusMsg = await bot.sendMessage(chatId, "⏳ **Userlarni yig'ish boshlandi...**\nIltimos, jarayon tugashini kuting.", { parse_mode: "Markdown" });

        const gatheredUserIds = new Set();
        const members = [];
        let adminCount = 0; // Adminlar soni
        let adminParts = 1; // Adminlar qismlari soni
        let memberCount = 0; // A'zolar soni
        let memberParts = 1; // A'zolar qismlari soni

        // 2. Adminlarni yig'ish
        try {
            const adminParticipants = await client.getParticipants(entity, {
                filter: new Api.ChannelParticipantsAdmins()
            });

            const currentAdmins = [];
            for (const p of adminParticipants) {
                if (p.bot || !p.username || p.deleted || p.id.toString() === myId.toString()) continue;
                if (!gatheredUserIds.has(p.id.toString())) {
                    currentAdmins.push({ id: p.id.toString(), username: p.username });
                    gatheredUserIds.add(p.id.toString());
                    adminCount++; // Adminlar sonini oshirish
                    
                    // Har 100 ta yig'ilganda yuborish
                    if (currentAdmins.length >= 100) {
                        let text = `👑 **Adminlar:** ( ${adminCount} ta, ${adminParts} qism ) \n\n`;
                        text += currentAdmins.map(a => `@${a.username}`).join("\n");
                        await bot.sendMessage(chatId, text).catch(() => {});
                        currentAdmins.length = 0;
                        adminParts++; // Qism sonini oshirish
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
            }
            // Qolgan adminlarni yuborish
            if (currentAdmins.length > 0) {
                let text = `👑 **Adminlar:** ( ${adminCount} ta, ${adminParts} qism )\n\n`;
                text += currentAdmins.map(a => `@${a.username}`).join("\n");
                await bot.sendMessage(chatId, text).catch(() => {});
                adminParts++; // Qism sonini oshirish
            }
        } catch (e) {
            console.error("Adminlarni yig'ishda xato:", e.message);
        }

        // 3. Tarixdan qidirish (History Scan) - faqat bu ishlaydi, admin huquqi yo'q bo'lsa
        let scannedMessages = 0;
        try {
            // 2 MLN xabargacha skan qilish
            const scanLimit = 3000000;
            
            for await (const message of client.iterMessages(entity, { limit: scanLimit })) {
                if (gatheredUserIds.size >= limit) break;
                scannedMessages++;

                const sender = message.sender;
                // SENDER mavjudligini va u USER ekanligini tekshiramiz
                if (sender && sender instanceof Api.User && !sender.bot && sender.username && !sender.deleted && sender.id.toString() !== myId.toString()) {
                    const senderIdStr = sender.id.toString();
                    if (!gatheredUserIds.has(senderIdStr)) {
                        members.push({ id: senderIdStr, username: sender.username });
                        gatheredUserIds.add(senderIdStr);
                        memberCount++; // A'zolar sonini oshirish

                        // Har 100 ta yig'ilganda darhol yuborish
                        if (members.length >= 100) {
                            let text = `👥 **Azolar:** ( ${memberCount} ta, ${memberParts} qism )\n\n`;
                            text += members.map(m => `@${m.username}`).join("\n");
                            await bot.sendMessage(chatId, text).catch(e => console.error("Batch send error:", e.message));
                            members.length = 0; // Massivni tozalash
                            memberParts++; // Qism sonini oshirish
                            await new Promise(r => setTimeout(r, 2000)); // Flood protection
                        }
                    }
                }
                
                // Har 500 ta xabardan keyin kichik tanaffus (Flood protection)
                if (scannedMessages % 500 === 0) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }
        } catch (e) {
            console.error("History scan xatosi:", e.message);
        }

        // 5. Yakuniy natija
        const summaryText = `🏁 **NATIJA:**\n\n` +
            `👑 **Adminlar:** ${adminCount} ta, ${adminParts} qism\n` +
            `👥 **A'zolar:** ${memberCount} ta, ${memberParts} qism\n` +
            `📊 **Jami:** ${gatheredUserIds.size} ta`;
        
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        // Qolgan a'zolarni yuborish (agar 100 taga yetmagan bo'lsa)
        if (members.length > 0) {
            let text = `👥 **Azolar:** ( ${memberCount} ta, ${memberParts} qism )\n\n`;
            text += members.map(m => `@${m.username}`).join("\n");
            await bot.sendMessage(chatId, text).catch(e => console.error("Final batch send error:", e.message));
            memberParts++; // Qism sonini oshirish
        }

        // 3. Yakuniy xulosa va menyu
        await bot.sendMessage(chatId, summaryText, { 
            parse_mode: "Markdown",
            ...getMainMenu(chatId)
        });

        // Bazani yangilash
        await User.increment({ usersGathered: gatheredUserIds.size }, { where: { chatId } });

        return true;
    } catch (error) { 
        console.error("Scrape error:", error);
        throw error; 
    }
};

// reydSessions allaqachon tepada e'lon qilingan (30-qator)

const ensureClient = async (chatId, bot) => {
    if (userClients[chatId] && userClients[chatId].connected) return userClients[chatId];
    
    const user = await User.findOne({ where: { chatId } });
    if (!user || !user.session) throw new Error("Asosiy akkaunt ulanmagan.");
    
    await startUserbot(chatId, user.session, bot);
    return userClients[chatId];
};

const startReyd = async (chatId, target, reydMsg, limit, bot, savedPath = null) => {
    if (reydSessions[chatId] && reydSessions[chatId].status !== 'stopped') {
        throw new Error("Reyd allaqachon ishga tushirilgan.");
    }

    const user = await User.findOne({ where: { chatId } });
    if (!user) {
        throw new Error("Foydalanuvchi topilmadi.");
    }

    const allSessions = [
        user.session, 
        ...(user.reydAccounts || []).map(s => s.session)
    ].filter(Boolean);

    if (allSessions.length === 0) {
        throw new Error("Reyd uchun asosiy yoki qo'shimcha akkauntlar ulanmagan.");
    }

    const clients = [];
    for (let i = 0; i < allSessions.length; i++) {
        try {
            const sessionStr = allSessions[i];
            const tempChatId = `${chatId}_${i}`;
            const client = new TelegramClient(new StringSession(sessionStr), config.apiId, config.apiHash, { 
                connectionRetries: 50,
                requestRetries: 15,
                timeout: 120000,
                autoReconnect: true,
                floodSleepThreshold: 120,
                useWSS: false,
                proxy: undefined
            });
            await client.connect();
            if (await client.checkAuthorization()) {
                userClients[tempChatId] = client;
                clients.push(client);
            } else {
                console.error(`[Reyd] Akkaunt ${i} avtorizatsiyadan o'tolmadi.`);
            }
        } catch (e) {
            console.error(`[Reyd] Akkaunt ${i} ulanishda xato:`, e.message);
        }
    }

    if (clients.length === 0) throw new Error("Reyd uchun aktiv akkauntlar topilmadi. Akkauntlarni qaytadan ulab ko'ring.");

    reydSessions[chatId] = { status: 'running', count: 0, total: limit, target };

    const getReydButtons = (status) => {
        const buttons = [];
        if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "reyd_pause" });
        if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "reyd_resume" });
        buttons.push({ text: "⏹ To'xtatish", callback_data: "reyd_stop" });
        return { reply_markup: { inline_keyboard: [buttons] } };
    };

    const statusMsg = await bot.sendMessage(chatId, `🚀 **Reyd boshlandi!**\nNishon: ${target}\nAkkauntlar: ${clients.length} ta\nProgress: 0/${limit}`, getReydButtons('running'));

    // Nishonni tozalash
    let cleanTarget = String(target).trim();
    if (cleanTarget.startsWith("https://t.me/")) {
        cleanTarget = cleanTarget.replace("https://t.me/", "");
    } else if (cleanTarget.startsWith("t.me/")) {
        cleanTarget = cleanTarget.replace("t.me/", "");
    }
    if (cleanTarget.startsWith("@")) cleanTarget = cleanTarget.substring(1);
    
    // Private link handling (t.me/c/ID/MSG)
    if (cleanTarget.startsWith("c/")) {
        cleanTarget = cleanTarget.split('/')[1];
        if (!cleanTarget.startsWith("-100")) cleanTarget = "-100" + cleanTarget;
    }

    const originalText = (reydMsg.text || reydMsg.caption || "").trim();
    const originalEntities = reydMsg.entities || reydMsg.caption_entities || [];
    const entities = convertToGramJsEntities(originalEntities);

    // Har bir akkaunt uchun nishonni (entity) aniqlab olamiz
    const clientEntities = new Map();
    
    await bot.editMessageText(`🔍 **Nishonni barcha akkauntlarda tasdiqlash...**\nProgress: 0/${clients.length}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
    }).catch(() => {});

    for (let i = 0; i < clients.length; i++) {
        const currentClient = clients[i];
        try {
            let entity;
            if (cleanTarget.includes("+") || cleanTarget.includes("joinchat/")) {
                const hash = cleanTarget.split('/').pop().replace('+', '');
                try {
                    const result = await currentClient.invoke(new Api.messages.ImportChatInvite({ hash }));
                    entity = result.chats ? result.chats[0] : result.chat;
                } catch (err) {
                    if (err.message.includes("USER_ALREADY_PARTICIPANT")) {
                        const check = await currentClient.invoke(new Api.messages.CheckChatInvite({ hash }));
                        entity = check.chat;
                    } else { throw err; }
                }
            } else {
                // Agar target raqam bo'lsa (ID), uni BigInt ga o'tkazamiz
                const maybeId = cleanTarget.replace("-100", "");
                if (/^\d+$/.test(maybeId)) {
                    entity = await currentClient.getInputEntity(cleanTarget);
                } else {
                    entity = await currentClient.getInputEntity(cleanTarget);
                }
            }
            
            if (entity) {
                clientEntities.set(i, entity);
            }
            
            await bot.editMessageText(`🔍 **Nishonni barcha akkauntlarda tasdiqlash...**\nProgress: ${i + 1}/${clients.length}`, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            }).catch(() => {});
        } catch (e) {
            console.error(`[Reyd Auth Error] Akkaunt ${i}:`, e.message);
        }
    }

    if (clientEntities.size === 0) {
        throw new Error("Hech bir akkaunt orqali nishonni topib bo'lmadi. Link yoki username noto'g'ri.");
    }

    let mediaBuffer = null;
    let stickerPath = savedPath;
    let uploadedFile = null;

    try {
        if (reydMsg.sticker && !stickerPath) {
            const tempDir = path.join(process.cwd(), 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
            stickerPath = await bot.downloadFile(reydMsg.sticker.file_id, tempDir);
        } else if (reydMsg.photo) {
            const file = await bot.getFile(reydMsg.photo[reydMsg.photo.length - 1].file_id);
            mediaBuffer = await downloadFile(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
        } else if (reydMsg.video) {
            const file = await bot.getFile(reydMsg.video.file_id);
            mediaBuffer = await downloadFile(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
        }

        // Mediani birinchi akkaunt orqali bir marta yuklab olamiz (optimallashtirish)
        if (clients.length > 0) {
            if (stickerPath) {
                uploadedFile = await clients[0].uploadFile({ file: stickerPath, workers: 1 });
            } else if (mediaBuffer) {
                uploadedFile = await clients[0].uploadFile({ file: mediaBuffer, workers: 1 });
            }
        }
    } catch (err) { console.error("Media yuklash xatosi:", err.message); }

    try {
        let currentClientIndex = 0;

        for (let i = 0; i < limit; i++) {
            while (reydSessions[chatId]?.status === 'paused') {
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!reydSessions[chatId] || reydSessions[chatId].status === 'stopped') break;

            const currentClient = clients[currentClientIndex];
            const entity = clientEntities.get(currentClientIndex);

            if (!entity) {
                currentClientIndex = (currentClientIndex + 1) % clients.length;
                i--;
                continue;
            }

            try {
                if (reydMsg.sticker && stickerPath) {
                    await currentClient.sendFile(entity, {
                        file: uploadedFile || stickerPath,
                        attributes: [new Api.DocumentAttributeSticker({ alt: reydMsg.sticker.emoji || "", stickerset: new Api.InputStickerSetEmpty() })]
                    }).catch(e => { throw e; });
                } else if (reydMsg.photo || reydMsg.video) {
                    await currentClient.sendFile(entity, {
                        file: uploadedFile || mediaBuffer,
                        caption: originalText,
                        formattingEntities: entities
                    }).catch(e => { throw e; });
                } else {
                    const textToSend = originalText || "."; 
                    await currentClient.sendMessage(entity, {
                        message: textToSend,
                        formattingEntities: entities
                    }).catch(e => { throw e; });
                }
                
                reydSessions[chatId].count++;

                // Har bir xabardan keyin akkauntni almashtirish (Rotation)
                currentClientIndex = (currentClientIndex + 1) % clients.length;

                if (reydSessions[chatId].count % 10 === 0 || reydSessions[chatId].count === limit) {
                    await bot.editMessageText(`🚀 **Reyd jarayoni...**\nNishon: ${target}\nProgress: ${reydSessions[chatId].count}/${limit}`, {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        ...getReydButtons(reydSessions[chatId].status)
                    }).catch(() => {});
                }

                // Super tezlik uchun kechikishni 50ms ga tushiramiz (1 sekunda 20 ta xabar nazariy)
                // Lekin bitta akkaunt uchun FloodWait tushmaslik uchun akkauntlar soniga qarab sozlanadi
                const delay = clients.length > 1 ? 50 : 150;
                await new Promise(r => setTimeout(r, delay)); 

            } catch (e) {
                if (e.message.includes("FLOOD_WAIT_")) {
                    const seconds = parseInt(e.message.split("_").pop()) || 10;
                    console.log(`[FloodWait] Akkaunt ${i % clients.length} - ${seconds} soniya kutilmoqda...`);
                    await new Promise(r => setTimeout(r, seconds * 1000));
                    i--;
                    continue;
                } else {
                    console.error(`[Reyd Xatosi] Akkaunt ${i % clients.length}:`, e.message);
                    if (e.message.includes("PEER_FLOOD")) {
                        console.log(`Akkaunt ${i % clients.length} PEER_FLOOD oldi, davom etamiz...`);
                    }
                }
            }
        }
    } catch (criticalErr) {
        console.error("Reyd critical error:", criticalErr.message);
    } finally {
        if (stickerPath && fs.existsSync(stickerPath)) {
            try { fs.unlinkSync(stickerPath); } catch (cleanupErr) {}
        }
        
    if (reydSessions[chatId]?.status === 'stopped' || reydSessions[chatId]?.status === 'finished') {
        const finalStatus = reydSessions[chatId]?.status === 'stopped' ? "to'xtatildi" : "tugadi";
        bot.sendMessage(chatId, `🏁 **Avto Reyd ${finalStatus}!**\nJami yuborildi: ${reydSessions[chatId]?.count || 0} ta.`, getMainMenu(chatId));
        
        // finishedAt timestamp qo'shish (cleanup uchun)
        if (reydSessions[chatId]) {
            reydSessions[chatId].finishedAt = Date.now();
        }
        
        const countToAdd = reydSessions[chatId]?.count || 0;
        // 10 daqiqadan keyin cleanup avtomatik o'chiradi
        // delete reydSessions[chatId]; - buni olib tashladik
        
        await User.increment({ reydCount: 1 }, { where: { chatId } });
        
        // Barcha vaqtinchalik klientlarni uzish
        for (const key in userClients) {
            if (key.startsWith(`${chatId}_`)) {
                try { 
                    await userClients[key].disconnect(); 
                } catch(e) {
                    console.error('[Reyd] Client disconnect error:', e.message);
                }
                delete userClients[key];
            }
        }
    }
    }
};

const https = require('https');

const downloadFile = (url) => {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download file: ${res.statusCode}`));
                return;
            }
            const data = [];
            res.on('data', (chunk) => data.push(chunk));
            res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', reject);
    });
};

const PremiumAd = require("../models/PremiumAd");

const startReklama = async (chatId, usersList, reklamaMsg, bot) => {
    const user = await User.findOne({ where: { chatId } });
    if (!user) throw new Error("Foydalanuvchi topilmadi.");

    const originalText = reklamaMsg.text || reklamaMsg.caption || "";
    const originalEntities = reklamaMsg.entities || reklamaMsg.caption_entities || [];
    const promoFooter = `\n\n${PROMO_REKLAMA()}`;
    const reklamaTextRaw = originalText ? `${originalText}${promoFooter}` : PROMO_REKLAMA();
    
    // Premium emoji'larni qo'shish
    const { cleanText: reklamaText, entities: promoEntities } = withPremiumEmojis(reklamaTextRaw);
    
    // GramJS uchun entitylarni konvertatsiya qilish (asl matn + promo entitylari)
    const originalGramJsEntities = convertToGramJsEntities(originalEntities) || [];
    const promoGramJsEntities = convertToGramJsEntities(promoEntities) || [];
    const entities = [...originalGramJsEntities, ...promoGramJsEntities].filter(Boolean);
    
    console.log(`[Reklama] Matn tayyorlandi: ${reklamaText.length} belgi, ${entities.length} ta entity`);

    // Reklamani vaqtinchalik bazaga saqlash
    await PremiumAd.upsert({
        chatId,
        content: {
            text: reklamaMsg.text,
            caption: reklamaMsg.caption,
            entities: reklamaMsg.entities,
            caption_entities: reklamaMsg.caption_entities,
            photo: reklamaMsg.photo,
            sticker: reklamaMsg.sticker,
            video: reklamaMsg.video
        },
        usersList,
        status: 'running'
    });

    const sessions = [
        user.session, 
        ...(user.reklamaAccounts || []).map(s => s.session)
    ].filter(Boolean);

    if (sessions.length === 0) {
        throw new Error("Reklama uchun asosiy yoki qo'shimcha akkauntlar ulanmagan.");
    }

    // Telefon raqamlarini olish (asosiy akkaunt uchun null, qo'shimchalar uchun phoneNumber)
    const phoneNumbers = [
        null, // Asosiy akkaunt (session saqlanmagan telefon raqami bilan)
        ...(user.reklamaAccounts || []).map(acc => acc.phoneNumber || 'Noma\'lum')
    ];

    const users = usersList.split(/\s+/).filter(u => u.startsWith('@')).slice(0, 500);
    
    let currentSessionIndex = 0;
    let count = 0;

    // Har bir akkaunt uchun statistika
    const accountStats = sessions.map((_, idx) => ({
        phone: phoneNumbers[idx] || (idx === 0 ? 'Asosiy akkaunt' : 'Noma\'lum'),
        sent: 0,
        status: 'kutilmoqda' // kutilmoqda | ishlayapti | spam | flood | ulanmadi
    }));

    reklamaStates[chatId] = { status: 'running', count: 0, total: users.length, sessionIndex: 0 };

    const getReklamaButtons = (status) => {
        const buttons = [];
        if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "reklama_pause" });
        if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "reklama_resume" });
        buttons.push({ text: "⏹ To'xtatish", callback_data: "reklama_stop" });
        return { reply_markup: { inline_keyboard: [buttons] } };
    };

    // Status matnini yaratish funksiyasi
    const buildReklamaStatusText = () => {
        let text = `🚀 **Reklama jarayoni**\n\n`;
        text += `📊 Progress: ${count}/${users.length}\n\n`;
        text += `📱 **Akkauntlar:**\n`;
        
        accountStats.forEach((acc, idx) => {
            const statusEmoji = acc.status === 'ishlayapti' ? '✅' : 
                               acc.status === 'spam' ? '🚫' :
                               acc.status === 'flood' ? '⏳' :
                               acc.status === 'ulanmadi' ? '❌' : '⏸';
            const statusText = acc.status === 'ishlayapti' ? 'ishlayapti' :
                              acc.status === 'spam' ? 'spam' :
                              acc.status === 'flood' ? 'flood' :
                              acc.status === 'ulanmadi' ? 'ulanmadi' : 'kutilmoqda';
            text += `${idx + 1}. ${acc.phone}\n`;
            text += `   ├ Yuborildi: ${acc.sent} ta\n`;
            text += `   └ Holat: ${statusEmoji} ${statusText}\n\n`;
        });
        
        return text;
    };

    const statusMsg = await bot.sendMessage(chatId, buildReklamaStatusText(), getReklamaButtons('running'));

    let client = null;
    const clients = [];
    const connectedIndexes = []; // Muvaffaqiyatli ulangan akkauntlar

    const connectClient = async (index) => {
        if (clients[index]) return clients[index];
        
        accountStats[index].status = 'ulanmoqda...';
        await bot.editMessageText(buildReklamaStatusText(), {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown',
            ...getReklamaButtons(reklamaStates[chatId].status)
        }).catch(() => {});
        
        try {
            const newClient = new TelegramClient(new StringSession(sessions[index]), config.apiId, config.apiHash, {
                connectionRetries: 5,
                requestRetries: 3,
                timeout: 30000,
                autoReconnect: true,
                floodSleepThreshold: 120,
                useWSS: false,
                proxy: undefined
            });
            
            await newClient.connect();
            
            if (!(await newClient.checkAuthorization())) {
                throw new Error(`Akkaunt avtorizatsiyadan o'tolmadi`);
            }
            
            clients[index] = newClient;
            connectedIndexes.push(index);
            reklamaStates[chatId].sessionIndex = index;
            client = newClient;
            accountStats[index].status = 'ishlayapti';
            console.log(`[Reklama] Akkaunt ${index + 1}/${sessions.length} muvaffaqiyatli ulandi`);
            return newClient;
        } catch (err) {
            console.error(`[Reklama] Akkaunt ${index + 1} ulanishda xato:`, err.message);
            accountStats[index].status = 'ulanmadi';
            return null;
        }
    };

    // Birinchi ishlaydigan akkauntni topish
    let initialConnected = false;
    for (let i = 0; i < sessions.length; i++) {
        const result = await connectClient(i);
        if (result) {
            currentSessionIndex = i;
            initialConnected = true;
            break;
        }
    }

    if (!initialConnected || connectedIndexes.length === 0) {
        throw new Error("Hech bir akkaunt ulanmadi. Iltimos, akkauntlarni qayta ulang.");
    }

    await bot.editMessageText(buildReklamaStatusText(), {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        ...getReklamaButtons(reklamaStates[chatId].status)
    }).catch(() => {});

    // Keyingi ishlaydigan akkauntga KETMA-KET o'tish (1→2→3→4 tartibida)
    const switchToNextAccount = async () => {
        for (let idx = currentSessionIndex + 1; idx < sessions.length; idx++) {
            // Agar akkaunt allaqachon ulangan bo'lsa - shunga o'tamiz
            if (clients[idx]) {
                currentSessionIndex = idx;
                accountStats[idx].status = 'ishlayapti';
                console.log(`[Reklama] Akkaunt ${currentSessionIndex + 1} ga o'tildi`);
                return true;
            }
            // Ulanmagan bo'lsa - ulashga harakat qilamiz
            console.log(`[Reklama] Akkaunt ${idx + 1} ulanishga harakat...`);
            const result = await connectClient(idx);
            if (result) {
                currentSessionIndex = idx;
                accountStats[idx].status = 'ishlayapti';
                console.log(`[Reklama] Akkaunt ${currentSessionIndex + 1} ulandi va ishga tushdi`);
                return true;
            } else {
                console.log(`[Reklama] Akkaunt ${idx + 1}/${sessions.length} ulanmadi, o'tkazib yuborildi`);
            }
        }
        return false;
    };

    try {
        // Mediani bir marta yuklab olish (Buffer sifatida)
        let mediaBuffer = null;
        try {
            if (reklamaMsg.photo) {
                const file = await bot.getFile(reklamaMsg.photo[reklamaMsg.photo.length - 1].file_id);
                mediaBuffer = await downloadFile(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
            } else if (reklamaMsg.sticker) {
                const file = await bot.getFile(reklamaMsg.sticker.file_id);
                mediaBuffer = await downloadFile(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
            } else if (reklamaMsg.video) {
                const file = await bot.getFile(reklamaMsg.video.file_id);
                mediaBuffer = await downloadFile(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
            }
        } catch (downloadErr) {
            console.error(`[Media Download Error] ${chatId}:`, downloadErr.message);
            // Faqat console'da loglab, foydalanuvchiga xabar yubormaymiz
            reklamaMsg.photo = null;
            reklamaMsg.video = null;
            reklamaMsg.sticker = null;
        }

        for (let i = 0; i < users.length; i++) {
            while (reklamaStates[chatId]?.status === 'paused') {
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!reklamaStates[chatId] || reklamaStates[chatId].status === 'stopped') break;

            const targetUser = users[i];
            let success = false;
            
            console.log(`[Reklama] User ${i + 1}/${users.length}: ${targetUser}`);

            while (currentSessionIndex < sessions.length && !success) {
                // Faqat ulangan akkauntlardan foydalanish
                if (!clients[currentSessionIndex]) {
                    console.log(`[Reklama] Akkaunt ${currentSessionIndex + 1} ulanmagan, keyingisiga o'tilmoqda...`);
                    currentSessionIndex++;
                    if (currentSessionIndex >= sessions.length || connectedIndexes.length === 0) {
                        reklamaStates[chatId].status = 'stopped';
                        success = true;
                        break;
                    }
                    continue;
                }
                
                // Har safar client o'zgarganini tekshirish
                client = clients[currentSessionIndex];
                console.log(`[Reklama] Akkaunt ${currentSessionIndex + 1} ishlatilmoqda...`);
                
                try {
                    if (reklamaMsg.sticker && mediaBuffer) {
                        await client.sendFile(targetUser, {
                            file: mediaBuffer,
                            attributes: [new Api.DocumentAttributeSticker({ alt: reklamaMsg.sticker.emoji || "", stickerset: new Api.InputStickerSetEmpty() })]
                        });
                    } else if ((reklamaMsg.photo || reklamaMsg.video) && mediaBuffer) {
                        await client.sendFile(targetUser, {
                            file: mediaBuffer,
                            caption: reklamaText,
                            formattingEntities: entities.length > 0 ? entities : undefined
                        });
                    } else {
                        await client.sendMessage(targetUser, {
                            message: reklamaText,
                            formattingEntities: entities.length > 0 ? entities : undefined
                        });
                    }

                    success = true;
                    count++;
                    accountStats[currentSessionIndex].sent++;
                    reklamaStates[chatId].count = count;
                    console.log(`[Reklama] ✅ Yuborildi: ${targetUser}, Jami: ${count}`);

                    // Har 3 ta xabar yuborilgandan keyin yoki oxirgi xabar yuborilganda status yangilash
                    if (count % 3 === 0 || count === users.length) {
                        await bot.editMessageText(buildReklamaStatusText(), {
                            chat_id: chatId,
                            message_id: statusMsg.message_id,
                            parse_mode: 'Markdown',
                            ...getReklamaButtons(reklamaStates[chatId].status)
                        }).catch(() => {});
                    }
                    
                    // Sekundiga 2 ta xabar (500ms kechikish)
                    await new Promise(r => setTimeout(r, 500)); 
                } catch (err) {
                    console.error(`[Reklama Error] ${targetUser} -> Akkaunt ${currentSessionIndex + 1}:`, err.message);

                    const isFlood = err.message.includes("FLOOD_WAIT") || err.message.includes("A wait of");
                    const isSpam = err.message.includes("PEER_FLOOD") || err.message.includes("USER_PRIVACY_RESTRICTED") || err.message.includes("Spam");
                    const isUsernameError = err.message.includes("No user has") || err.message.includes("USERNAME_NOT_OCCUPIED") || err.message.includes("USERNAME_INVALID");

                    // 1. Username topilmasa - bu userni tashlab ketamiz (akkaunt almashtirmaymiz)
                    if (isUsernameError) {
                        console.log(`[Reklama] Username topilmadi: ${targetUser}, skip`);
                        success = true; // Keyingi userga o'tamiz
                        break;
                    }

                    // 2. FLOOD_WAIT yoki SPAM - foydalanuvchidan keyingi akkauntga o'tishni so'rash
                    if (isFlood || isSpam) {
                        // Joriy akkaunt statusini o'zgartirish
                        accountStats[currentSessionIndex].status = isFlood ? 'flood' : 'spam';
                        await bot.editMessageText(buildReklamaStatusText(), {
                            chat_id: chatId,
                            message_id: statusMsg.message_id,
                            parse_mode: 'Markdown',
                            ...getReklamaButtons(reklamaStates[chatId].status)
                        }).catch(() => {});
                        
                        const nextAcc = currentSessionIndex + 1;
                        if (nextAcc >= sessions.length) {
                            reklamaStates[chatId].status = 'stopped';
                            success = true;
                            break;
                        }

                        // Xabar matnini xato turiga qarab tayyorlash
                        let askInfo;
                        if (isFlood) {
                            const waitMatch = err.message.match(/(\d+)\s*seconds/i);
                            const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 60;
                            const waitMinutes = Math.floor(waitSeconds / 60);
                            const waitHours = Math.floor(waitMinutes / 60);
                            const waitText = waitHours > 0 ? `${waitHours} soat` : `${waitMinutes} daqiqa`;
                            console.log(`[Reklama] ⚠️ FLOOD_WAIT: Akkaunt ${currentSessionIndex + 1} - ${waitSeconds}s`);
                            askInfo = `⚠️ **Akkaunt flood oldi!**\n\n` +
                                `Akkaunt: ${currentSessionIndex + 1}/${sessions.length}\n` +
                                `Kutish vaqti: ${waitText}\n` +
                                `Progress: ${count}/${users.length}\n\n` +
                                `Keyingi akkauntga o'tib davom etaylikmi?`;
                        } else {
                            console.log(`[Reklama] ⚠️ PEER_FLOOD/SPAM: Akkaunt ${currentSessionIndex + 1}`);
                            askInfo = `⚠️ **Akkaunt spamga tushdi!**\n\nAkkaunt: ${currentSessionIndex + 1}/${sessions.length}\nProgress: ${count}/${users.length}\n\nKeyingi akkauntga o'tib davom etaylikmi?`;
                        }

                        bot.sendMessage(chatId, askInfo, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: "▶️ Davom etish", callback_data: "reklama_spam_continue" }],
                                    [{ text: "⏹ To'xtatish", callback_data: "reklama_spam_stop" }]
                                ]
                            }
                        });

                        // Foydalanuvchi javobini kutish
                        const userDecision = await new Promise((resolve) => {
                            reklamaStates[chatId].resolveSpam = resolve;
                        });

                        if (!userDecision) {
                            reklamaStates[chatId].status = 'stopped';
                            success = true;
                            break;
                        }

                        // Keyingi ishlaydigan akkauntga o'tish
                        const switched = await switchToNextAccount();
                        if (switched) {
                            await bot.editMessageText(buildReklamaStatusText(), {
                                chat_id: chatId,
                                message_id: statusMsg.message_id,
                                parse_mode: 'Markdown',
                                ...getReklamaButtons(reklamaStates[chatId].status)
                            }).catch(() => {});
                            // success = false -> while loop shu userni qayta urinadi
                            continue;
                        } else {
                            reklamaStates[chatId].status = 'stopped';
                            success = true;
                            break;
                        }
                    }

                    // 3. Boshqa xatoliklar - bu userni tashlab ketamiz
                    console.log(`[Reklama] Boshqa xato, user skip: ${targetUser}`);
                    success = true;
                    break;
                }
            }
        }
    } catch (e) {
        console.error("Reklama critical error:", e.message);
    }

    // Reklama tugadi.
    const finalStatus = reklamaStates[chatId]?.status === 'stopped' ? "to'xtatildi" : "tugadi";
    
    // finishedAt timestamp qo'shish (cleanup uchun)
    if (reklamaStates[chatId]) {
        reklamaStates[chatId].finishedAt = Date.now();
    }
    
    // Clientlarni yopish
    for (const cl of clients) {
        if (cl) { 
            try { 
                await cl.disconnect(); 
            } catch (e) {
                console.error('[Reklama] Client disconnect error:', e.message);
            }
        }
    }

    // Bazadan reklamani o'chirish
    await PremiumAd.destroy({ where: { chatId } });

    await User.increment({ adsCount: count }, { where: { chatId } });
    
    // Final statistikani yaratish
    let finalText = `✅ **Reklama ${finalStatus}**\n\n`;
    finalText += `📊 Jami yuborildi: ${count}/${users.length}\n\n`;
    finalText += `📱 **Akkauntlar statistikasi:**\n`;
    accountStats.forEach((acc, idx) => {
        const statusEmoji = acc.status === 'ishlayapti' ? '✅' : 
                           acc.status === 'spam' ? '🚫' :
                           acc.status === 'flood' ? '⏳' :
                           acc.status === 'ulanmadi' ? '❌' : '⏸';
        finalText += `${idx + 1}. ${acc.phone}\n`;
        finalText += `   ├ Yuborildi: ${acc.sent} ta\n`;
        finalText += `   └ Holat: ${statusEmoji} ${acc.status}\n\n`;
    });
    
    // Status xabarini yakuniy natijaga o'zgartirish (tugmasiz)
    await bot.editMessageText(finalText, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
    }).catch(() => {});
    
    // Asosiy menuni alohida yuborish
    bot.sendMessage(chatId, "🏠 Asosiy menu:", getMainMenu(chatId));
    
    // 10 daqiqadan keyin cleanup avtomatik o'chiradi
    // delete reklamaStates[chatId]; - buni olib tashladik
    
    return count;
};

const normalizeTelegramGroupId = (linkOrId) => {
    const s = String(linkOrId).trim();
    if (!s) return s;
    if (s.startsWith('@') || s.includes('t.me/') || s.includes('joinchat')) return s;
    if (/^-100\d+$/.test(s)) return s;
    if (/^-\d+$/.test(s)) return s;
    if (/^\d+$/.test(s)) return `-100${s}`;
    return s;
};

const isUtagGroupEntity = (entity) => {
    if (!entity) return false;
    const cn = entity.className || entity.constructor?.name || '';
    return cn === 'Channel' || cn === 'Chat' || entity.megagroup || entity.broadcast !== undefined;
};

const cacheUtagParticipant = async (client, participant) => {
    if (!participant || participant.username) return true;
    const userId = BigInt(participant.id);
    const accessHash = participant.accessHash != null ? BigInt(participant.accessHash) : null;
    try {
        if (accessHash != null) {
            await client.getInputEntity(new Api.InputPeerUser({ userId, accessHash }));
        } else {
            await client.getInputEntity(participant);
        }
        return true;
    } catch (e) {
        console.error(`[UTag] User ${participant.id} cache xato:`, e.message);
        return false;
    }
};

const sendUtagToParticipant = async (client, groupEntity, participant, extraText, fallbackClient = null, fallbackEntity = null) => {
    if (participant.bot || participant.deleted) return false;

    const send = async (activeClient, activeEntity) => {
        if (participant.username) {
            await activeClient.sendMessage(activeEntity, { message: `@${participant.username}${extraText}` });
            return;
        }
        await cacheUtagParticipant(activeClient, participant).catch(() => {});
        const name = participant.firstName || 'Foydalanuvchi';
        const userId = participant.id?.toString?.() || String(participant.id);
        await activeClient.sendMessage(activeEntity, {
            message: `<a href="tg://user?id=${userId}">${escapeHTML(name)}</a>${extraText}`,
            parseMode: 'html'
        });
    };

    try {
        await send(client, groupEntity);
        return true;
    } catch (e) {
        if (fallbackClient && fallbackClient !== client) {
            try {
                await send(fallbackClient, fallbackEntity || groupEntity);
                return true;
            } catch (e2) {
                console.error(`[UTag] Fallback ham xato (User: ${participant.id}):`, e2.message);
            }
        }
        throw e;
    }
};

const fetchUtagParticipants = async (client, entity, memberFilter, limit) => {
    const cap = limit > 0 ? limit : undefined;
    let participants = [];

    if (memberFilter === 'online') {
        try {
            participants = await client.getParticipants(entity, {
                filter: new Api.ChannelParticipantsOnline({}),
                limit: cap
            });
        } catch (e) {
            console.error('[UTag] Online filter xato, fallback:', e.message);
            const all = await client.getParticipants(entity, { limit: cap ? cap * 3 : 500 });
            participants = all.filter((p) => {
                const st = p.status;
                return st && (
                    st instanceof Api.UserStatusOnline ||
                    st instanceof Api.UserStatusRecently ||
                    st instanceof Api.UserStatusLastMonth
                );
            });
            if (cap) participants = participants.slice(0, cap);
        }
    } else {
        participants = await client.getParticipants(entity, { limit: cap });
    }
    return participants;
};

const startAutoTag = async (chatId, groupLink, bot, opts = {}) => {
    const {
        limit = 0,
        tagText = null,
        mode = 'only_mention',
        memberFilter = 'all',
        isCommand = false,
        groupTitle: presetTitle = null
    } = opts;
    const user = await User.findOne({ where: { chatId } });
    if (!user) throw new Error("Foydalanuvchi topilmadi.");

    // Akkauntlarni tayyorlash
    const useAllMode = user.utagAccountMode === 'all';
    const rekAccs = (user.reklamaAccounts || []).map(acc => acc.session);

    // Telefon raqamlarini olish
    const phoneNumbers = [
        null, // Asosiy akkaunt
        ...(user.reklamaAccounts || []).map(acc => acc.phoneNumber || 'Noma\'lum')
    ];

    // Agar barcha akkauntlar rejimida bo'lsa, faqat qo'shimcha akkauntlarni ishlatamiz
    let sessions;
    if (useAllMode) {
        sessions = rekAccs;
        if (sessions.length === 0) {
            throw new Error("Sizda qo'shimcha akkaunt ulanmagan.");
        }
    } else {
        sessions = [user.session];
    }

    const clients = [];
    let mainClient = null;
    
    // Har bir akkaunt uchun statistika
    const accountStats = sessions.map((_, idx) => ({
        phone: useAllMode ? phoneNumbers[idx + 1] : (phoneNumbers[0] || 'Asosiy akkaunt'),
        sent: 0,
        status: 'kutilmoqda' // kutilmoqda | ishlayapti | ulanmadi | flood
    }));

    if (useAllMode) {
        // Barcha akkauntlar rejimida: faqat qo'shimcha akkauntlar
        for (let i = 0; i < sessions.length; i++) {
            accountStats[i].status = 'ulanmoqda...';
            try {
                const tempClient = new TelegramClient(new StringSession(sessions[i]), config.apiId, config.apiHash, {
                    connectionRetries: 5,
                    requestRetries: 2,
                    timeout: 30000,
                    autoReconnect: true,
                    floodSleepThreshold: 300,
                    useWSS: false,
                    proxy: undefined
                });
                await tempClient.connect();
                if (await tempClient.checkAuthorization()) {
                    await tempClient.getDialogs({ limit: 50 }).catch(() => {});
                    clients.push(tempClient);
                    accountStats[i].status = 'ishlayapti';
                    console.log(`[UTag] Akkaunt ${i + 1}/${sessions.length} ulandi ✅`);
                } else {
                    accountStats[i].status = 'ulanmadi';
                }
            } catch (e) {
                console.error(`[UTag] Akkaunt ${i + 1} ulanishda xato:`, e.message);
                accountStats[i].status = 'ulanmadi';
            }
        }
        if (clients.length === 0) {
            throw new Error("Hech bir qo'shimcha akkaunt ulanmadi.");
        }
        mainClient = clients[0];
    } else {
        // Faqat asosiy akkaunt rejimida
        mainClient = await ensureClient(chatId, bot);
        clients.push(mainClient);
        accountStats[0].status = 'ishlayapti';
    }

    try {
        let entity;
        const rawLink = String(groupLink).trim();
        const peer = normalizeTelegramGroupId(rawLink);

        if (typeof peer === 'string' && (peer.includes("t.me/+") || peer.includes("joinchat/"))) {
            const hash = peer.split('/').pop().replace('+', '');
            try {
                const result = await mainClient.invoke(new Api.messages.ImportChatInvite({ hash }));
                entity = result.chats ? result.chats[0] : result.chat;
            } catch (err) {
                if (err.message.includes("USER_ALREADY_PARTICIPANT")) {
                    const check = await mainClient.invoke(new Api.messages.CheckChatInvite({ hash }));
                    entity = check.chat;
                } else { throw err; }
            }
        } else {
            entity = await mainClient.getEntity(peer);
        }

        if (!isUtagGroupEntity(entity)) {
            throw new Error("Bu guruh/kanal emas. Guruhni qayta tanlang.");
        }

        // Har bir client uchun guruhni ALOHIDA resolve qilish
        const clientEntities = new Map();
        const workingClients = [];
        for (let i = 0; i < clients.length; i++) {
            const cl = clients[i];
            let clEntity = null;
            try {
                await cl.getDialogs({ limit: 50 }).catch(() => {});
                clEntity = await cl.getEntity(entity);
            } catch (e1) {
                // Agar entity ishlamasa, link/username orqali urinib ko'ramiz
                try {
                    const rawPeer = normalizeTelegramGroupId(String(groupLink).trim());
                    clEntity = await cl.getEntity(rawPeer);
                } catch (e2) {
                    // CHANNEL_INVALID yoki boshqa xatolar
                    console.error(`[UTag] Akkaunt #${i + 1} guruhni topa olmadi: ${e2.message}`);
                    clEntity = null;
                }
            }
            if (clEntity) {
                clientEntities.set(cl, clEntity);
                workingClients.push(cl);
                console.log(`[UTag] Akkaunt #${i + 1} guruhni topdi ✅`);
            } else {
                console.log(`[UTag] Akkaunt #${i + 1} guruhga kira olmadi ❌`);
                accountStats[i].status = 'guruhga kira olmadi';
            }
        }

        if (workingClients.length === 0) {
            throw new Error("Hech bir akkaunt guruhga kira olmadi. Akkauntlar guruhga a'zo ekanligini tekshiring.");
        }

        // Faqat ishlaydigan clientlar bilan davom etamiz
        clients.length = 0;
        clients.push(...workingClients);
        mainClient = clients[0];
        console.log(`[UTag] Guruhga kira oladigan akkauntlar: ${clients.length} ta`);

        const mainEntity = clientEntities.get(mainClient) || entity;

        const participants = await fetchUtagParticipants(mainClient, mainEntity, memberFilter, parseInt(limit, 10) || 0);

        const groupId = normalizeUtagGroupId(mainEntity.id?.toString() || groupLink);
        const groupTitle = presetTitle || mainEntity.title || mainEntity.username || "Guruh";
        const historyLink = /^-?\d+$/.test(String(groupLink).trim())
            ? groupId
            : (mainEntity.username ? `@${mainEntity.username}` : String(groupLink).trim());

        const history = upsertUtagHistory(user.utagHistory, {
            id: groupId,
            title: groupTitle,
            link: historyLink,
            mode,
            limit: parseInt(limit, 10) || 0,
            tagText: mode === 'custom' ? tagText : null,
            memberFilter
        });
        await User.update({ utagHistory: history }, { where: { chatId } });

        let count = 0;
        utagStates[chatId] = { status: 'running', count: 0, total: participants.length };

        const shuffledMessages = [...DEFAULT_TAG_MESSAGES].sort(() => Math.random() - 0.5);

        const getUtagButtons = (status) => {
            const buttons = [];
            if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "utag_pause" });
            if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "utag_resume" });
            buttons.push({ text: "⏹ To'xtatish", callback_data: "utag_stop" });
            return { reply_markup: { inline_keyboard: [buttons] } };
        };

        // Status xabarini yaratish funksiyasi
        const buildUtagStatusText = () => {
            const modeText = mode === 'custom' ? `"${tagText}"` : (mode === 'only_mention' ? "Faqat @" : "Bot so'zlari");
            const filterText = memberFilter === 'online' ? 'Online' : (limit > 0 ? `${limit} ta` : 'Hammasi');
            
            let text = `🚀 **Utag jarayoni**\n\n`;
            text += `📊 Progress: ${count}/${participants.length}\n`;
            text += `👥 Guruh: ${groupTitle}\n`;
            text += `🏷 Rejim: ${modeText} | ${filterText}\n\n`;
            text += `📱 **Akkauntlar:**\n`;
            
            accountStats.forEach((acc, idx) => {
                const statusEmoji = acc.status === 'ishlayapti' ? '✅' : 
                                   acc.status === 'flood' ? '⏳' :
                                   acc.status === 'ulanmadi' || acc.status === 'guruhga kira olmadi' ? '❌' : '⏸';
                text += `${idx + 1}. ${acc.phone}\n`;
                text += `   ├ Yuborildi: ${acc.sent} ta\n`;
                text += `   └ Holat: ${statusEmoji} ${acc.status}\n\n`;
            });
            
            return text;
        };

        const statusMsg = await bot.sendMessage(chatId, buildUtagStatusText(), isCommand ? {} : getUtagButtons('running')).catch(() => null);

        let currentClientIndex = 0;

        for (const p of participants) {
            while (utagStates[chatId]?.status === 'paused') {
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!utagStates[chatId] || utagStates[chatId].status === 'stopped') break;

            const currentClient = clients[currentClientIndex];
            
            try {
                const tagNumber = count + 1;
                let extraText = '';
                if (mode === 'random_words') {
                    extraText = ' ' + (shuffledMessages[count % shuffledMessages.length] || "");
                } else if (mode === 'custom' && tagText) {
                    extraText = ' ' + tagText;
                }

                if (tagNumber % 10 === 0) {
                    extraText += ` ${PROMO_UTAG()}`;
                }

                await sendUtagToParticipant(currentClient, clientEntities.get(currentClient) || mainEntity, p, extraText, mainClient, mainEntity);

                count++;
                accountStats[currentClientIndex].sent++;
                utagStates[chatId].count = count;
                
                // Har 2 ta xabardan keyin keyingi clientga o'tish (ketma-ketlik)
                if (count % 2 === 0) {
                    currentClientIndex = (currentClientIndex + 1) % clients.length;
                }

                // Har 3 ta xabardan keyin status yangilash
                if (statusMsg && (count % 3 === 0 || count === participants.length)) {
                    const buttons = isCommand ? {} : getUtagButtons(utagStates[chatId].status);
                    await bot.editMessageText(buildUtagStatusText(), {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        parse_mode: 'Markdown',
                        ...buttons
                    }).catch(() => {});
                }

                // Delay: Akkauntlar ko'p bo'lsa tezroq
                const delay = clients.length > 1 ? 500 : 1000;
                await new Promise(r => setTimeout(r, delay)); 
            } catch (e) {
                if (e.message.includes("FLOOD_WAIT")) {
                    accountStats[currentClientIndex].status = 'flood';
                    const waitTime = parseInt(e.message.match(/\d+/)?.[0] || 60);
                    console.error(`[UTag] Akkaunt ${currentClientIndex + 1} flood oldi: ${waitTime}s`);
                    
                    // Keyingi akkauntga o'tish
                    if (clients.length > 1) {
                        currentClientIndex = (currentClientIndex + 1) % clients.length;
                    } else {
                        // Yagona akkaunt flood bo'lsa - to'xtatish
                        break;
                    }
                } else {
                    console.error(`Tag xatosi (User: ${p.id}):`, e.message);
                }
            }
        }
        
        const finalStatus = utagStates[chatId]?.status === 'stopped' ? "to'xtatildi" : "tugadi";
        
        // finishedAt timestamp qo'shish
        if (utagStates[chatId]) {
            utagStates[chatId].finishedAt = Date.now();
        }
        
        // Final statistikani yaratish
        let finalText = `✅ **Utag ${finalStatus}**\n\n`;
        finalText += `📊 Jami tag qilindi: ${count}/${participants.length}\n`;
        finalText += `👥 Guruh: ${groupTitle}\n\n`;
        finalText += `📱 **Akkauntlar statistikasi:**\n`;
        accountStats.forEach((acc, idx) => {
            const statusEmoji = acc.status === 'ishlayapti' ? '✅' : 
                               acc.status === 'flood' ? '⏳' :
                               acc.status === 'ulanmadi' || acc.status === 'guruhga kira olmadi' ? '❌' : '⏸';
            finalText += `${idx + 1}. ${acc.phone}\n`;
            finalText += `   ├ Yuborildi: ${acc.sent} ta\n`;
            finalText += `   └ Holat: ${statusEmoji} ${acc.status}\n\n`;
        });
        
        // Status xabarini yakuniy natijaga o'zgartirish
        if (statusMsg) {
            await bot.editMessageText(finalText, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
            }).catch(() => {});
        }
        
        // Asosiy menuni alohida yuborish
        bot.sendMessage(chatId, "🏠 Asosiy menu:", getMainMenu(chatId));
        
        await User.increment({ utagCount: 1 }, { where: { chatId } });
        
    } catch (e) {
        throw new Error(`Uteg xatosi: ${e.message}`);
    } finally {
        // Barcha qo'shimcha/clientlarni uzish
        if (useAllMode) {
            for (let i = 0; i < clients.length; i++) {
                try { 
                    await clients[i].disconnect(); 
                } catch (e) {
                    console.error('[Utag] Client disconnect error:', e.message);
                }
            }
        }
    }
};

module.exports = { 
    userClients, avtoAlmazStates, utagStates, reklamaStates, reydSessions, startUserbot, blockExpiredUser,
    initAuth, handleAuthStep, resendAuthCode, scrapeUsers, startReyd, startReklama, startAutoTag, loadAllStates
};
