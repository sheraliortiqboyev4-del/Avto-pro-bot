const { TelegramClient, Api } = require("telegram"); 
const { StringSession } = require("telegram/sessions"); 
const { NewMessage } = require("telegram/events");
const { CallbackQuery } = require("telegram/events/CallbackQuery");
const fs = require("fs");
const path = require("path");
const config = require("../config"); 
const User = require("../models/User");

const { handleAlmazClick } = require("./almaz");
const { 
    convertToGramJsEntities, 
    escapeHTML, 
    chunkArray, 
    getMainMenu, 
    getReklamaMenu, 
    getReydMenu,
    withPremiumEmojis,
    getUtf16Length
} = require('../utils/helpers');

const userClients = {}; 
const avtoAlmazStates = {}; 
const utagStates = {}; 
const reklamaStates = {}; 

// --- YANGI: Holatlarni bazadan yuklash va botlarni ishga tushirish ---
const loadAllStates = async (bot) => {
    try {
        const users = await User.findAll({ where: { session: { [require('sequelize').Op.ne]: null }, status: 'approved' } });
        console.log(`🔄 [Init] ${users.length} ta foydalanuvchi botlarini ishga tushirish...`);
        for (const user of users) {
            avtoAlmazStates[user.chatId] = user.avtoAlmaz !== false;
            // Har bir foydalanuvchi uchun userbotni ishga tushiramiz
            startUserbot(user.chatId, user.session, bot).catch(e => {
                console.error(`[AutoStart Error] ${user.chatId}:`, e.message);
            });
            // Akkauntlar ko'p bo'lsa, Telegram blocklamasligi uchun biroz kutamiz
            await new Promise(r => setTimeout(r, 1000)); 
        }
        console.log(`✅ [States] ${users.length} ta foydalanuvchi holati yuklandi va botlar ishga tushirildi.`);
    } catch (e) {
        console.error("loadAllStates error:", e.message);
    }
};

const DEFAULT_TAG_MESSAGES = [
"sizni maxsus chaqiryapman 😆",
"online bo‘lib jim turish – jinoyat",
"ramantika qlamizmi?🫣",
"importni bomjdan salom😅",
"Szam joining",
"Qalesz, ko‘rinmay ketdizku",
"Tanidizmi o‘zi 😎",
"10ta almaz tashavorin",
"Qoshilmasez tepaman",
"Oynamismi bugun 😂",
"Bot kelin",
"men seni ko'ryapman 👀",
"Online turib yozmaysizmi 👀",
"Yozing, kutyapman",
"Jim turish taqiqlanadi",
"Yozing darrov",
"Sizni chaqiryapman ⚡️",
"Kuzatuvda siz 👀",
"Jim turish yaxshimas",
"Gapiring tez",
"Sizsiz zerikdik 😏",
"nima gap",
"Bugun siz bosh rolda",
"Gap yo‘qmi sizda 💬",
"Shunaqa jim yuraverasizmi",
"Almazli oyin kelin",
"Qani siz",
"Szi kutib zerikdim",
"qo'shiling boshlaymiz",
"Qochib ketmang 😂",
"Aktivlik qani 🔥",
"Gap boshlang 💬",
"Yozib turing",
"Jim o'tirmang👀",
"Aktiv bo‘ling",
"Gapiring tez",
"Sizni kutyapmiz 💥",
"Jim turmang",
"Yozing",
"Bugun aktiv siz 😎",
"Szi chaqrganm uchun 10💎 berng😎",
"Jonkam keling😂"
];

// Global xotirada sessiyalarni saqlaymiz
if (!global.authClients) global.authClients = {};

const startUserbot = async (chatId, sessionStr, bot) => { 
    try { 
        if (userClients[chatId]) {
            try { await userClients[chatId].disconnect(); } catch (e) {}
        }

        const client = new TelegramClient(new StringSession(sessionStr), config.apiId, config.apiHash, { 
            connectionRetries: 50, // Ulanish urinishlarini 50 taga oshiramiz
            requestRetries: 15,
            timeout: 120000, // Kutish vaqtini 2 daqiqaga oshiramiz
            autoReconnect: true,
            floodSleepThreshold: 120, // Flood wait uchun 2 daqiqagacha kutishga ruxsat
            deviceModel: "AvtoBotPro_v2",
            systemVersion: "Windows 11",
            appVersion: "1.0.0",
            useWSS: false,
            proxy: undefined
        }); 
        await client.connect(); 
        userClients[chatId] = client; 

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
            else if (message.peerId instanceof Api.PeerChat) peerStr = message.peerId.chatId.toString();
            else if (message.peerId instanceof Api.PeerChannel) peerStr = message.peerId.channelId.toString();

            // Faqat akkaunt egasi yuborgan buyruqlarni tekshiramiz (/uteg yoki .uteg)
            const isOwner = fromId === chatId.toString();
            const isCommand = text.startsWith('/uteg') || text.startsWith('.uteg') || text.startsWith('!uteg');

            if (isOwner && isCommand) {
                const parts = text.split(' ');
                const rawCommand = parts[0].toLowerCase();
                // Komandani tozalash (/uteg@bot -> /uteg, .uteg -> uteg)
                const command = rawCommand.replace(/^[./!]/, '').split('@')[0];

                try {
                    // 1. Foydalanuvchi obunasini tekshirish
                    const { checkMembership } = require('../utils/helpers');
                    const isMember = await checkMembership(bot, chatId);
                    if (!isMember) return;

                    // 2. Statusni tekshirish
                    const user = await User.findOne({ where: { chatId } });
                    if (!user || user.status !== 'approved') return;

                    // --- BUYRUQLAR ---
                    if (command === 'utegstop') {
                        if (utagStates[chatId]) {
                            utagStates[chatId].status = 'stopped';
                            await client.sendMessage(message.peerId, { message: "⏹ **Azoblash xizmati to'xtatildi.**" });
                        }
                        return;
                    }

                    if (command === 'utegtext') {
                        await client.sendMessage(message.peerId, { message: "🚀 **Azoblash xizmati boshlanmoqda... Tugatish uchun /utegStop buyrug'ini yuboring.**" });
                        startAutoTag(chatId, peerStr, 0, null, bot, 'random_words', true);
                        return;
                    }

                    if (command === 'uteg') {
                        const args = parts.slice(1).join(' ').trim();
                        if (args) {
                            await client.sendMessage(message.peerId, { message: `🚀 **Azoblash xizmati ("${args}" bilan) boshlanmoqda... Tugatish uchun /utegStop buyrug'ini yuboring.**` });
                            startAutoTag(chatId, peerStr, 0, args, bot, 'custom', true);
                        } else {
                            await client.sendMessage(message.peerId, { message: "🚀 **Azoblash xizmati (faqat @) boshlanmoqda... Tugatish uchun /utegStop buyrug'ini yuboring.**" });
                            startAutoTag(chatId, peerStr, 0, null, bot, 'only_mention', true);
                        }
                    }
                } catch (e) {
                    console.error(`[Userbot Command Error] ${chatId}:`, e.message);
                }
            }
        }, new NewMessage({}));

        // GramJS xatolarini ushlash
        client.on('error', (err) => {
            if (err.message.includes('Not connected') || err.message.includes('TIMEOUT')) {
                console.log(`[GramJS Reconnect] User ${chatId} ulanish uzildi, qayta ulanishga harakat qilinmoqda...`);
            } else {
                console.error(`[GramJS Error] User ${chatId}:`, err.message);
            }
        });

        console.log(`✅ Userbot ulandi: ${chatId}`);

        // Avto Almaz event handler
        const almazHandler = async (event) => { 
            try {
                await handleAlmazClick(client, event.message, chatId, bot, avtoAlmazStates);
            } catch (e) {
                console.error(`[Almaz Error] ${chatId}:`, e.message);
            }
        };

        // Yangi xabarlar uchun
        client.addEventHandler(almazHandler, new NewMessage({})); 
        
        // Tahrirlangan xabarlar uchun (ba'zi botlar tugmalarni tahrirlangan xabarda yuboradi)
        client.addEventHandler(async (update) => {
            try {
                if (update instanceof Api.UpdateEditMessage || update instanceof Api.UpdateEditChannelMessage) {
                    const message = update.message;
                    if (message) {
                        await handleAlmazClick(client, message, chatId, bot, avtoAlmazStates);
                    }
                }
            } catch (e) {
                console.error(`[Edit Update Error] ${chatId}:`, e.message);
            }
        });

        // Ba'zi hollarda tugmalar Raw update sifatida kelishi mumkin
        client.addEventHandler(async (update) => {
            try {
                if (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) {
                    const message = update.message;
                    if (message && (message.buttons || (message.replyMarkup && message.replyMarkup.rows))) {
                        await handleAlmazClick(client, message, chatId, bot, avtoAlmazStates);
                    }
                }
            } catch (e) {}
        });

    } catch (e) { console.error(`Userbot xatosi (${chatId}):`, e.message); } 
}; 

const blockExpiredUser = async (user, bot) => { 
    console.log(`[Expiry] User ${user.chatId} muddati tugadi va bloklandi.`); 
    await User.update(
        { 
            status: 'blocked', 
            session: null,
            reydAccounts: [],
            reklamaAccounts: []
        },
        { where: { chatId: user.chatId } }
    ); 
    
    if (userClients[user.chatId]) { 
        try { await userClients[user.chatId].disconnect(); delete userClients[user.chatId]; } catch (e) {} 
    } 
    
    const blockedText = `⚠️ **Foydalanish muddati tugadi!**\n\nBotdan foydalanishni davom ettirish uchun to'lovni amalga oshiring.\n\n👨‍💼 Admin: @ortiqov_x7`;
    bot.sendMessage(user.chatId, blockedText, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [[{ text: "👨‍💼 Admin bilan bog'lanish", url: "https://t.me/ortiqov_x7" }]]
        }
    }); 
};

// --- YANGI AUTH TIZIMI (START RESOLVERS BILAN) ---

const initAuth = async (chatId, phoneNumber, bot, isAdditional = false, isReyd = false) => {
    console.log(`[Auth Start] ${chatId} uchun login boshlandi: ${phoneNumber} (Additional: ${isAdditional}, isReyd: ${isReyd})`);
    
    // Eski auth client bo'lsa o'chirib yuboramiz
    if (global.authClients[chatId]) {
        try { await global.authClients[chatId].client.disconnect(); } catch (e) {}
        delete global.authClients[chatId];
    }

    const client = new TelegramClient(new StringSession(""), config.apiId, config.apiHash, { 
        connectionRetries: 50,
        requestRetries: 15,
        timeout: 120000,
        autoReconnect: true,
        floodSleepThreshold: 120,
        deviceModel: "AvtoBotPro_v2",
        systemVersion: "Windows 11",
        appVersion: "1.0.0",
        useWSS: false,
        proxy: undefined
    });
    
    await client.connect();

    global.authClients[chatId] = {
        client,
        phoneNumber,
        isAdditional,
        isReyd,
        step: 'WAITING_CODE',
        resolveCode: null,
        resolvePassword: null,
        reject: null
    };

    // Fon rejimida loginni boshlaymiz
    client.start({
        phoneNumber: () => phoneNumber,
        phoneCode: async () => {
            console.log(`[Auth] ${chatId} uchun kod kutilmoqda...`);
            return new Promise((resolve, reject) => {
                global.authClients[chatId].resolveCode = resolve;
                global.authClients[chatId].reject = reject;
            });
        },
        password: async () => {
            console.log(`[Auth] ${chatId} uchun parol kutilmoqda...`);
            global.authClients[chatId].step = 'WAITING_PASSWORD';
            // Bot orqali parol so'rash
            bot.sendMessage(chatId, "🔐 Akkauntingizda **Ikki bosqichli tekshiruv (2FA)** yoqilgan. Iltimos, parolingizni yuboring:");
            return new Promise((resolve, reject) => {
                global.authClients[chatId].resolvePassword = resolve;
                global.authClients[chatId].reject = reject;
            });
        },
        onError: (err) => {
            console.error(`[Auth Start Error] ${chatId}:`, err.message);
            if (global.authClients[chatId] && global.authClients[chatId].reject) {
                global.authClients[chatId].reject(err);
            }
        }
    }).then(async () => {
        // Muvaffaqiyatli login
        console.log(`[Auth Success] ${chatId} muvaffaqiyatli kirdi.`);
        const sessionStr = client.session.save();
        
        if (isAdditional) {
            const user = await User.findOne({ where: { chatId } });
            const accounts = isReyd ? (user.reydAccounts || []) : (user.reklamaAccounts || []);
            accounts.push({ session: sessionStr, phoneNumber, addedAt: new Date() });

            const updateData = isReyd ? { reydAccounts: accounts } : { reklamaAccounts: accounts };
            await User.update(updateData, { where: { chatId } });
            
            const accCount = accounts.length;

            if (isReyd) {
                bot.sendMessage(chatId, `✅ Qo'shimcha akkaunt Reyd uchun ulandi: ${phoneNumber}`, getReydMenu(accCount));
            } else {
                bot.sendMessage(chatId, `✅ Qo'shimcha akkaunt Reklama uchun ulandi: ${phoneNumber}`, getReklamaMenu(accCount));
            }
        } else {
            // Asosiy akkauntni saqlash
            await User.update({ session: sessionStr, status: 'approved' }, { where: { chatId } });
            const user = await User.findOne({ where: { chatId } });
            avtoAlmazStates[chatId] = user ? user.avtoAlmaz : true;

            // Avto Almaz event handlerlari...
            const almazHandler = async (event) => { handleAlmazClick(event, chatId, bot, avtoAlmazStates); };
            client.addEventHandler(almazHandler, new NewMessage({})); 
            client.addEventHandler(async (update) => {
                if (update instanceof Api.UpdateEditMessage || update instanceof Api.UpdateEditChannelMessage) {
                    const message = update.message;
                    if (message) handleAlmazClick({ message }, chatId, bot, avtoAlmazStates);
                }
            });

            bot.sendMessage(chatId, "✅ Muvaffaqiyatli kirdingiz! Endi bot funksiyalaridan foydalanishingiz mumkin.", getMainMenu(chatId));
        }
        
        delete global.authClients[chatId];
        delete global.userStates[chatId];
    }).catch(async (err) => {
        console.error(`[Auth Final Error] ${chatId}:`, err.message);
        let errorMsg = `❌ Xatolik yuz berdi: ${err.message}`;
        if (err.message.includes("PHONE_CODE_INVALID")) errorMsg = "❌ Kod noto'g'ri. Qaytadan urinib ko'ring.";
        if (err.message.includes("PASSWORD_HASH_INVALID")) errorMsg = "❌ Parol noto'g'ri. Qaytadan urinib ko'ring.";
        
        bot.sendMessage(chatId, errorMsg);
        delete global.authClients[chatId];
        delete global.userStates[chatId];
    });

    return true;
};

const handleAuthStep = async (chatId, input) => {
    const auth = global.authClients[chatId];
    if (!auth) throw new Error("AUTH_NOT_FOUND");

    if (auth.step === 'WAITING_CODE' && auth.resolveCode) {
        const code = input.replace(/[^\d]/g, '');
        auth.resolveCode(code);
        return "CODE_SUBMITTED";
    } else if (auth.step === 'WAITING_PASSWORD' && auth.resolvePassword) {
        auth.resolvePassword(input.trim());
        return "PASSWORD_SUBMITTED";
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
        // 1. Guruhga ulanish
        if (groupLink.includes("t.me/+") || groupLink.includes("joinchat/")) {
            const hash = groupLink.split('/').pop().replace('+', '');
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
                entity = await client.getEntity(groupLink);
                await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
            } catch (err) {
                if (!err.message.includes("USER_ALREADY_PARTICIPANT")) {
                    // Agar getEntity ishlamasa yoki boshqa xato bo'lsa
                    entity = await client.getEntity(groupLink);
                }
            }
        }

        if (!entity) throw new Error("Guruh topilmadi.");

        const statusMsg = await bot.sendMessage(chatId, "⏳ **Userlarni yig'ish boshlandi...**\nIltimos, jarayon tugashini kuting.", { parse_mode: "Markdown" });

        const gatheredUserIds = new Set();
        const members = [];

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
                    
                    // Har 100 ta yig'ilganda yuborish
                    if (currentAdmins.length >= 100) {
                        let text = `👑 **Adminlar (Yig'ilmoqda...):**\n\n`;
                        text += currentAdmins.map(a => `@${a.username}`).join("\n");
                        await bot.sendMessage(chatId, text).catch(() => {});
                        currentAdmins.length = 0;
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
            }
            // Qolgan adminlarni yuborish
            if (currentAdmins.length > 0) {
                let text = `👑 **Adminlar (Yig'ilmoqda...):**\n\n`;
                text += currentAdmins.map(a => `@${a.username}`).join("\n");
                await bot.sendMessage(chatId, text).catch(() => {});
            }
        } catch (e) {
            console.error("Adminlarni yig'ishda xato:", e.message);
        }

        // 3. Tarixdan qidirish (History Scan)
        let scannedMessages = 0;
        try {
            // 1 MLN xabargacha skan qilish
            const scanLimit = 1000000;
            
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

                        // Har 100 ta yig'ilganda darhol yuborish
                        if (members.length >= 100) {
                            let text = `👥 **Azolar (Yig'ilmoqda...):**\n\n`;
                            text += members.map(m => `@${m.username}`).join("\n");
                            await bot.sendMessage(chatId, text).catch(e => console.error("Batch send error:", e.message));
                            members.length = 0; // Massivni tozalash
                            await new Promise(r => setTimeout(r, 500)); // Flood protection
                        }
                    }
                }
                
                // Har 200 ta xabardan keyin kichik tanaffus (Flood protection)
                if (scannedMessages % 200 === 0) {
                    await new Promise(r => setTimeout(r, 300));
                }
            }
        } catch (e) {
            console.error("History scan xatosi:", e.message);
        }

        // 5. Yakuniy natija
        const summaryText = `🏁 **NATIJA:**\n\n` +
            `� **Jami yig'ilgan userlar:** ${gatheredUserIds.size} ta\n` +
            `(Adminlar va a'zolar umumiy soni)`;
        
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        // Qolgan a'zolarni yuborish (agar 100 taga yetmagan bo'lsa)
        if (members.length > 0) {
            let text = `👥 **Azolar (Oxirgi qism):**\n\n`;
            text += members.map(m => `@${m.username}`).join("\n");
            await bot.sendMessage(chatId, text).catch(e => console.error("Final batch send error:", e.message));
        }

        // 3. Yakuniy xulosa va menyu
        await bot.sendMessage(chatId, summaryText, { 
            parse_mode: "Markdown",
            ...getMainMenu(chatId)
        });

        // Bazani yangilash
        await User.findOneAndUpdate({ chatId }, { $inc: { usersGathered: gatheredUserIds.size } });

        return true;
    } catch (error) { 
        console.error("Scrape error:", error);
        throw error; 
    }
};

const reydSessions = {}; // { chatId: { status: 'running'|'stopped' } }

const ensureClient = async (chatId, bot) => {
    if (userClients[chatId] && userClients[chatId].connected) return userClients[chatId];
    
    const user = await User.findOne({ chatId });
    if (!user || !user.session) throw new Error("Asosiy akkaunt ulanmagan.");
    
    await startUserbot(chatId, user.session, bot);
    return userClients[chatId];
};

const startReyd = async (chatId, target, reydMsg, limit, bot, savedPath = null) => {
    if (reydSessions[chatId] && reydSessions[chatId].status !== 'stopped') {
        throw new Error("Reyd allaqachon ishga tushirilgan.");
    }

    const user = await User.findOne({ chatId });
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

    const statusMsg = await bot.sendMessage(chatId, `🚀 **Avto Reyd boshlandi!**\nNishon: ${target}\nAkkauntlar: ${clients.length} ta\nProgress: 0/${limit}`, getReydButtons('running'));

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
                    currentClient.sendFile(entity, {
                        file: uploadedFile || stickerPath,
                        attributes: [new Api.DocumentAttributeSticker({ alt: reydMsg.sticker.emoji || "", stickerset: new Api.InputStickerSetEmpty() })]
                    }).catch(e => console.error("Send sticker error:", e.message));
                } else if (reydMsg.photo || reydMsg.video) {
                    currentClient.sendFile(entity, {
                        file: uploadedFile || mediaBuffer,
                        caption: originalText,
                        formattingEntities: entities
                    }).catch(e => console.error("Send media error:", e.message));
                } else {
                    const textToSend = originalText || "."; 
                    currentClient.sendMessage(entity, {
                        message: textToSend,
                        formattingEntities: entities
                    }).catch(e => console.error("Send message error:", e.message));
                }
                
                reydSessions[chatId].count++;

                // Har bir xabardan keyin akkauntni almashtirish (Rotation)
                currentClientIndex = (currentClientIndex + 1) % clients.length;

                if (reydSessions[chatId].count % 10 === 0 || reydSessions[chatId].count === limit) {
                    await bot.editMessageText(`🚀 **Avto Reyd jarayoni...**\nNishon: ${target}\nProgress: ${reydSessions[chatId].count}/${limit}`, {
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
        
        const countToAdd = reydSessions[chatId]?.count || 0;
        delete reydSessions[chatId];
        await User.increment({ reydCount: 1 }, { where: { chatId } });
        
        // Barcha vaqtinchalik klientlarni uzish
        for (const key in userClients) {
            if (key.startsWith(`${chatId}_`)) {
                try { await userClients[key].disconnect(); } catch(e) {}
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
    const user = await User.findOne({ chatId });
    if (!user) throw new Error("Foydalanuvchi topilmadi.");

    const originalText = reklamaMsg.text || reklamaMsg.caption || "";
    const originalEntities = reklamaMsg.entities || reklamaMsg.caption_entities || [];
    
    // GramJS uchun entitylarni konvertatsiya qilish
    const entities = convertToGramJsEntities(originalEntities);

    // Reklamani vaqtinchalik bazaga saqlash
    await PremiumAd.findOneAndUpdate(
        { chatId },
        {
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
        },
        { upsert: true, new: true }
    );

    const sessions = [
        user.session, 
        ...(user.reklamaAccounts || []).map(s => s.session)
    ].filter(Boolean);

    if (sessions.length === 0) {
        throw new Error("Reklama uchun asosiy yoki qo'shimcha akkauntlar ulanmagan.");
    }

    const users = usersList.split(/\s+/).filter(u => u.startsWith('@')).slice(0, 500);
    
    let currentSessionIndex = 0;
    let count = 0;

    reklamaStates[chatId] = { status: 'running', count: 0, total: users.length, sessionIndex: 0 };

    const getReklamaButtons = (status) => {
        const buttons = [];
        if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "reklama_pause" });
        if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "reklama_resume" });
        buttons.push({ text: "⏹ To'xtatish", callback_data: "reklama_stop" });
        return { reply_markup: { inline_keyboard: [buttons] } };
    };

    const statusMsg = await bot.sendMessage(chatId, `🚀 **Avto Reklama boshlandi!**\nAkkauntlar soni: ${sessions.length}\nUserlar soni: ${users.length}`, getReklamaButtons('running'));

    let client = null;
    const clients = [];

    const connectClient = async (index) => {
        if (clients[index]) return clients[index];
        const newClient = new TelegramClient(new StringSession(sessions[index]), config.apiId, config.apiHash, {
            connectionRetries: 50,
            requestRetries: 15,
            timeout: 120000,
            autoReconnect: true,
            floodSleepThreshold: 120,
            useWSS: false,
            proxy: undefined
        });
        await newClient.connect();
        if (!(await newClient.checkAuthorization())) {
            throw new Error(`[Reklama] Akkaunt ${index} avtorizatsiyadan o'tolmadi.`);
        }
        clients[index] = newClient;
        reklamaStates[chatId].sessionIndex = index;
        client = newClient;
        return newClient;
    };

    try {
        await connectClient(currentSessionIndex);

        // Mediani bir marta yuklab olish va Telegramga upload qilish (Optimallashtirish)
        let mediaBuffer = null;
        let uploadedFile = null;
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

            if (mediaBuffer && client) {
                uploadedFile = await client.uploadFile({ file: mediaBuffer, workers: 1 });
            }
        } catch (downloadErr) {
            console.error(`[Media Download/Upload Error] ${chatId}:`, downloadErr.message);
            bot.sendMessage(chatId, `⚠️ Media yuklashda xatolik: ${downloadErr.message}. Reklama faqat matn ko'rinishida davom etadi.`);
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

            while (currentSessionIndex < sessions.length && !success) {
                try {
                    if (reklamaMsg.sticker) {
                        await client.sendFile(targetUser, {
                            file: uploadedFile || mediaBuffer,
                            attributes: [new Api.DocumentAttributeSticker({ alt: reklamaMsg.sticker.emoji || "", stickerset: new Api.InputStickerSetEmpty() })]
                        });
                    } else if (reklamaMsg.photo || reklamaMsg.video) {
                        await client.sendFile(targetUser, {
                            file: uploadedFile || mediaBuffer,
                            caption: originalText,
                            formattingEntities: entities
                        });
                    } else {
                        await client.sendMessage(targetUser, {
                            message: originalText,
                            formattingEntities: entities
                        });
                    }

                    success = true;
                    count++;
                    reklamaStates[chatId].count = count;

                    if (count % 5 === 0 || count === users.length) {
                        await bot.editMessageText(`🚀 **Avto Reklama jarayoni...**\nProgress: ${count}/${users.length}\nAkkaunt: ${currentSessionIndex + 1}/${sessions.length}`, {
                            chat_id: chatId,
                            message_id: statusMsg.message_id,
                            ...getReklamaButtons(reklamaStates[chatId].status)
                        }).catch(() => {});
                    }
                    
                    // Sekundiga 2 ta xabar (500ms kechikish)
                    await new Promise(r => setTimeout(r, 500)); 
                } catch (err) {
                    console.error(`[Reklama Error] Akkaunt ${currentSessionIndex}:`, err.message);
                    const isSpam = err.message.includes("PEER_FLOOD") || err.message.includes("USER_PRIVACY_RESTRICTED") || err.message.includes("FLOOD_WAIT") || err.message.includes("Spam");
                    
                    if (isSpam) {
                        currentSessionIndex++;
                        if (currentSessionIndex < sessions.length) {
                            bot.sendMessage(chatId, `⚠️ Akkaunt spamga tushdi. Keyingisiga o'tilmoqda... (${currentSessionIndex + 1}/${sessions.length})`);
                            await connectClient(currentSessionIndex);
                            // Yangi akkaunt bilan mediani qayta upload qilish shart emas, lekin access_hash xatosi bo'lishi mumkin
                            // GramJS odatda uploadedFile (InputFile) ni boshqa klientlarda ham qabul qiladi
                        } else {
                            bot.sendMessage(chatId, "❌ Barcha akkauntlar spamga tushdi yoki tugadi.");
                            reklamaStates[chatId].status = 'stopped';
                            success = false;
                            break;
                        }
                    } else {
                        // Boshqa xatoliklar (masalan, noto'g'ri username) bo'lsa, bu userni tashlab ketamiz
                        success = true; 
                    }
                }
            }
        }
    } catch (e) {
        console.error("Reklama critical error:", e.message);
    }

    // Reklama tugadi.
    const finalStatus = reklamaStates[chatId]?.status === 'stopped' ? "to'xtatildi" : "tugadi";
    
    // Clientlarni yopish
    for (const cl of clients) {
        if (cl) { try { await cl.disconnect(); } catch (e) {} }
    }

    // Bazadan reklamani o'chirish
    await PremiumAd.destroy({ where: { chatId } });

    await User.increment({ adsCount: count }, { where: { chatId } });
    bot.sendMessage(chatId, `✅ Reklama yakunlandi. Jami yuborildi: ${count} ta.`, getMainMenu(chatId));
    delete reklamaStates[chatId];
    return count;
};

const startAutoTag = async (chatId, groupLink, limit, tagText, bot, mode = 'random', isCommand = false) => {
    const client = await ensureClient(chatId, bot);

    try {
        let entity;
        // Agar link raqam bo'lsa (chatId), uni numberga o'tkazamiz
        const isNumeric = /^-?\d+$/.test(groupLink);
        const peer = isNumeric ? parseInt(groupLink) : groupLink;

        if (typeof peer === 'string' && (peer.includes("t.me/+") || peer.includes("joinchat/"))) {
            const hash = peer.split('/').pop().replace('+', '');
            try {
                const result = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                entity = result.chats ? result.chats[0] : result.chat;
            } catch (err) {
                if (err.message.includes("USER_ALREADY_PARTICIPANT")) {
                    const check = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
                    entity = check.chat;
                } else {
                    throw err;
                }
            }
        } else {
            entity = await client.getEntity(peer);
        }

        // Agar limit 0 bo'lsa, barcha a'zolarni olishga harakat qilamiz
        const fetchLimit = (limit === 0 || limit === "0") ? undefined : parseInt(limit);
        const participants = await client.getParticipants(entity, { limit: fetchLimit });
        
        // Tarixga saqlash
        const groupTitle = entity.title || entity.username || "Guruh";
        const historyLink = (typeof peer === 'string' && peer.startsWith('@')) ? peer : (entity.username ? `@${entity.username}` : groupLink);
        
        const user = await User.findOne({ where: { chatId } });
        let history = user.utagHistory || [];
        history = history.filter(h => h.link !== historyLink);
        history.push({ title: groupTitle, link: historyLink, addedAt: new Date() });
        if (history.length > 5) history = history.slice(-5);

        await User.update({ utagHistory: history }, { where: { chatId } });

        let count = 0;
        utagStates[chatId] = { status: 'running', count: 0, total: participants.length };

        // Xabarlarni aralashtirish (shuffle) funksiyasi
        const shuffledMessages = [...DEFAULT_TAG_MESSAGES].sort(() => Math.random() - 0.5);
        let msgIndex = 0;

        const getUtagButtons = (status) => {
            const buttons = [];
            if (status === 'running') buttons.push({ text: "⏸ Pauza", callback_data: "utag_pause" });
            if (status === 'paused') buttons.push({ text: "▶️ Davom etish", callback_data: "utag_resume" });
            buttons.push({ text: "⏹ To'xtatish", callback_data: "utag_stop" });
            return { reply_markup: { inline_keyboard: [buttons] } };
        };

        const modeText = mode === 'custom' ? `Matn bilan ("${tagText}")` : (mode === 'only_mention' ? 'Faqat @' : 'Tasodifiy so\'zlar');
        const startText = `🚀 **Azoblash xizmati boshlanmoqda...**\nTugatish uchun /utegStop buyrug'ini yuboring.\nGuruh: ${groupTitle}\nJami: ${participants.length} ta foydalanuvchi.\nRejim: ${modeText}`;
        
        // Agar komanda orqali bo'lsa (Userbot orqali), bot guruhga yubora olmaydi (agar u yerda bo'lmasa)
        // Shuning uchun har doim foydalanuvchining o'ziga (chatId) xabar yuboramiz
        const statusMsg = await bot.sendMessage(chatId, startText, isCommand ? {} : getUtagButtons('running')).catch(() => null);

        for (const p of participants) {
            // Holatni tekshirish
            while (utagStates[chatId]?.status === 'paused') {
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!utagStates[chatId] || utagStates[chatId].status === 'stopped') break;

            try {
                // Mention yaratish (usernamesi bor yoki yo'qligiga qarab)
                let message;
                if (p.username) {
                    message = `@${p.username} ${tagText || shuffledMessages[count % shuffledMessages.length]}`;
                } else {
                    const name = p.firstName || "Foydalanuvchi";
                    message = `<a href="tg://user?id=${p.id.toString()}">${name}</a> ${tagText || shuffledMessages[count % shuffledMessages.length]}`;
                }

                await client.sendMessage(entity, { 
                    message, 
                    parseMode: p.username ? undefined : 'html' 
                });
                count++;
                utagStates[chatId].count = count;
                
                // Progressni yangilash
                if (statusMsg && (count % 5 === 0 || count === participants.length)) {
                    const buttons = isCommand ? {} : getUtagButtons(utagStates[chatId].status);
                    await bot.editMessageText(`🚀 **Azoblash xizmati jarayoni...**\nProgress: ${count}/${participants.length}`, {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        ...buttons
                    }).catch(() => {});
                }

                await new Promise(r => setTimeout(r, 1000)); 
            } catch (e) {
                if (e.message.includes("FLOOD_WAIT")) {
                    const waitTime = parseInt(e.message.match(/\d+/)[0]);
                    await new Promise(r => setTimeout(r, waitTime * 1000));
                } else {
                    console.error(`Tag xatosi (User: ${p.id}):`, e.message);
                }
            }
        }
        
        const finalStatus = utagStates[chatId]?.status === 'stopped' ? "to'xtatildi yoki tugadi" : "tugadi";
        bot.sendMessage(chatId, `🏁 **Azoblash xizmati ${finalStatus}!**\nJami tag qilindi: ${count} ta.`);
        
        await User.increment({ utagCount: 1 }, { where: { chatId } });
        delete utagStates[chatId];
    } catch (e) {
        throw new Error(`UTag xatosi: ${e.message}`);
    }
};

module.exports = { 
    userClients, avtoAlmazStates, utagStates, reklamaStates, reydSessions, startUserbot, blockExpiredUser,
    initAuth, handleAuthStep, scrapeUsers, startReyd, startReklama, startAutoTag, loadAllStates
};
