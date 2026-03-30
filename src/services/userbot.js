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
const reklamaStates = {}; // { chatId: { status: 'running'|'paused'|'stopped', count: 0, total: 0 } }

const DEFAULT_TAG_MESSAGES = [
    "Mafia sizni qidirmoqda 🔫",
    "Sizsiz o‘yin zerikarli 😄",
    "Tezroq keling, gap bor 😉",
    "Sizni kutib o‘tiribmiz 👀",
    "Mafia sizni tanladi 🖤",
    "Sizsiz boshlamaymiz 😏",
    "Keling, rol sizniki 🎭",
    "Siz kech qolyapsiz ⏳",
    "O‘yin sizni sog‘indi 😂",
    "Sizsiz kim o‘ynaydi",
    "O'yinda joy bor 🔫",
    "Sizsiz qiziq emas 😄",
    "Keling, hammamiz shu yerdamiz",
    "Sizni kutishdan charchadik 😂",
    "Rolingiz tayyor 🎭",
    "Sizsiz kech o‘tmaydi 🌙",
    "Keling, sirlar kutmoqda",
    "Sizni izlashyapti 👀",
    "Mafia sizni chaqiryapti 🖤",
    "Sizsiz o‘yin to‘liq emas",
    "Keling, vaqt keldi ⏳",
    "Sizsiz hamma jim 😂",
    "Xamma sizni kutmoqda 👀",
    "Rol sizni kutmoqda 🎭",
    "Sizsiz boshlanmaydi 😏",
    "Keling, qiziq bo‘ladi",
    "Sizni kutib turibmiz",
    "Mafia sizni esladi 🖤",
    "Sizsiz kim kuldiradi 😄",
    "Keling, o‘yin qiziyapti 🔥",
    "Sizni qidiryapmiz 🔍",
    "Mafia sizni unutmagan 🖤",
    "Sizsiz zerikdik 😂",
    "Keling, sahna sizniki 🎭",
    "Sizni kutib qolamiz",
    "Rolingiz tayyor turibdi",
    "Sizsiz kech bo‘lmaydi 🌙",
    "Mafia sizni ko‘rmoqchi",
    "Keling, joy bor",
    "Sizsiz bu o‘yin zerikarli",
    "Sizni kutyapmiz 😉",
    "Mafia sizni chaqirdi 🔫",
    "Sizsiz gap chiqmayapti 😂",
    "Keling, sir ochiladi",
    "Sizsiz boshlamaymiz",
    "Rolingiz qiziq 🎭",
    "Sizni sog‘indik 😄",
    "Mafia sizni kutmoqda 🖤",
    "Keling, vaqt o‘tdi ⏳",
    "Sizsiz bu o‘yin sust"
];

// Global xotirada sessiyalarni saqlaymiz
if (!global.authClients) global.authClients = {};

const startUserbot = async (chatId, sessionStr, bot) => { 
    try { 
        if (userClients[chatId]) {
            try { await userClients[chatId].disconnect(); } catch (e) {}
        }

        const client = new TelegramClient(new StringSession(sessionStr), config.apiId, config.apiHash, { 
            connectionRetries: 10,
            requestRetries: 5,
            timeout: 30000,
            autoReconnect: true,
            deviceModel: "AvtoBotPro_v2",
            systemVersion: "Windows 11",
            appVersion: "1.0.0"
        }); 
        await client.connect(); 
        userClients[chatId] = client; 
        
        // GramJS xatolarini ushlash va avtomatik qayta ulanishni ta'minlash
        client.on('error', (err) => {
            if (err.message.includes('Not connected') || err.message.includes('TIMEOUT')) {
                console.log(`[GramJS Reconnect] User ${chatId} ulanish uzildi, qayta ulanishga harakat qilinmoqda...`);
            } else {
                console.error(`[GramJS Error] User ${chatId}:`, err.message);
            }
        });

        console.log(`✅ Userbot ulandi: ${chatId}`);

        // Avto Almaz event handler - Ham yangi, ham tahrirlangan xabarlar uchun
        const almazHandler = async (event) => { 
            handleAlmazClick(event, chatId, bot, avtoAlmazStates);
        };

        // GramJS da EditedMessage o'rniga Raw event yoki NewMessage ni tahrirlanganini ishlatish mumkin
        client.addEventHandler(almazHandler, new NewMessage({})); 
        
        // Tahrirlangan xabarlarni tutish uchun Raw event ishlatamiz
        client.addEventHandler(async (update) => {
            if (update instanceof Api.UpdateEditMessage || update instanceof Api.UpdateEditChannelMessage) {
                const message = update.message;
                if (message) {
                    handleAlmazClick({ message }, chatId, bot, avtoAlmazStates);
                }
            }
        });

    } catch (e) { console.error(`Userbot xatosi (${chatId}):`, e.message); } 
}; 

const blockExpiredUser = async (user, bot) => { 
    console.log(`[Expiry] User ${user.chatId} muddati tugadi va bloklandi.`); 
    await User.findOneAndUpdate(
        { chatId: user.chatId }, 
        { 
            status: 'blocked', 
            session: null,
            reydAccounts: [],
            reklamaAccounts: []
        } 
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
        connectionRetries: 10,
        requestRetries: 5,
        timeout: 30000,
        autoReconnect: true,
        deviceModel: "AvtoBotPro_v2",
        systemVersion: "Windows 11",
        appVersion: "1.0.0",
        useWSS: false
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
            const updateQuery = isReyd
                ? { $push: { reydAccounts: { session: sessionStr, phoneNumber } } }
                : { $push: { reklamaAccounts: { session: sessionStr, phoneNumber } } };

            const user = await User.findOneAndUpdate({ chatId }, updateQuery, { new: true });
            
            const accCount = isReyd
                ? (user.reydAccounts ? user.reydAccounts.length : 0)
                : (user.reklamaAccounts ? user.reklamaAccounts.length : 0);

            if (isReyd) {
                bot.sendMessage(chatId, `✅ Qo'shimcha akkaunt Reyd uchun ulandi: ${phoneNumber}`, getReydMenu(accCount));
            } else {
                bot.sendMessage(chatId, `✅ Qo'shimcha akkaunt Reklama uchun ulandi: ${phoneNumber}`, getReklamaMenu(accCount));
            }
        } else {
            // Asosiy akkauntni saqlash
            const user = await User.findOneAndUpdate({ chatId }, { session: sessionStr, status: 'approved' }, { new: true });
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
        const admins = [];
        const members = [];

        // 2. Adminlarni yig'ish
        try {
            const adminParticipants = await client.getParticipants(entity, {
                filter: new Api.ChannelParticipantsAdmins()
            });

            for (const p of adminParticipants) {
                if (p.bot || !p.username || p.deleted || p.id.toString() === myId.toString()) continue;
                if (!gatheredUserIds.has(p.id.toString())) {
                    admins.push({ id: p.id.toString(), username: p.username });
                    gatheredUserIds.add(p.id.toString());
                }
            }
        } catch (e) {
            console.error("Adminlarni yig'ishda xato:", e.message);
        }

        // 3. Tarixdan qidirish (History Scan)
        let scannedMessages = 0;
        try {
            for await (const message of client.iterMessages(entity, { limit: 1000000 })) {
                if (gatheredUserIds.size >= limit) break;
                scannedMessages++;

                const sender = message.sender;
                if (sender && !sender.bot && sender.username && !sender.deleted && sender.id.toString() !== myId.toString()) {
                    const senderIdStr = sender.id.toString();
                    if (!gatheredUserIds.has(senderIdStr)) {
                        members.push({ id: senderIdStr, username: sender.username });
                        gatheredUserIds.add(senderIdStr);
                    }
                }
            }
        } catch (e) {
            console.error("History scan xatosi:", e.message);
        }

        // 5. Yakuniy natija
        const summaryText = `🏁 **NATIJA:**\n\n` +
            `👑 **Adminlar (${admins.length} ta):**\n` +
            `👥 **Azolar (${members.length} ta):**\n` +
            `📦 **Jami:** ${gatheredUserIds.size} ta`;
        
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        
        // 1. Adminlarni yuborish
        if (admins.length > 0) {
            const adminChunks = chunkArray(admins, 100);
            for (let i = 0; i < adminChunks.length; i++) {
                let text = i === 0 ? `👑 Adminlar (${admins.length} ta):\n\n` : "";
                text += adminChunks[i].map(a => `@${a.username}`).join("\n");
                await bot.sendMessage(chatId, text).catch(e => console.error("Admin list send error:", e.message));
                await new Promise(r => setTimeout(r, 500)); // Flood protection
            }
        }

        // 2. Azolarni yuborish
        if (members.length > 0) {
            const memberChunks = chunkArray(members, 100);
            for (let i = 0; i < memberChunks.length; i++) {
                let text = i === 0 ? `👥 Azolar (${members.length} ta):\n\n` : "";
                text += memberChunks[i].map(m => `@${m.username}`).join("\n");
                await bot.sendMessage(chatId, text).catch(e => console.error("Member list send error:", e.message));
                await new Promise(r => setTimeout(r, 500)); // Flood protection
            }
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
                connectionRetries: 10,
                requestRetries: 5,
                timeout: 30000,
                autoReconnect: true
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
        
        const finalStatus = reydSessions[chatId]?.status === 'stopped' ? "to'xtatildi" : "tugadi";
        bot.sendMessage(chatId, `🏁 **Avto Reyd ${finalStatus}!**\nJami yuborildi: ${reydSessions[chatId]?.count || 0} ta.`, getMainMenu(chatId));
        
        delete reydSessions[chatId];
        await User.findOneAndUpdate({ chatId }, { $inc: { reydCount: 1 } });
        
        // Barcha vaqtinchalik klientlarni uzish
        for (const key in userClients) {
            if (key.startsWith(`${chatId}_`)) {
                try { await userClients[key].disconnect(); } catch(e) {}
                delete userClients[key];
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
            connectionRetries: 10,
            requestRetries: 5,
            timeout: 30000,
            autoReconnect: true
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
    await PremiumAd.deleteOne({ chatId });

    await User.findOneAndUpdate({ chatId }, { $inc: { adsCount: count } });
    bot.sendMessage(chatId, `✅ Reklama yakunlandi. Jami yuborildi: ${count} ta.`, getMainMenu(chatId));
    delete reklamaStates[chatId];
    return count;
};

const startAutoTag = async (chatId, groupLink, limit, tagText, bot, mode = 'random') => {
    const client = await ensureClient(chatId, bot);

    try {
        let entity;
        if (groupLink.includes("t.me/+") || groupLink.includes("joinchat/")) {
            const hash = groupLink.split('/').pop().replace('+', '');
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
            entity = await client.getEntity(groupLink);
        }

        const participants = await client.getParticipants(entity, { limit: parseInt(limit) || 100 });
        
        // Tarixga saqlash
        const groupTitle = entity.title || entity.username || "Guruh";
        await User.findOneAndUpdate(
            { chatId }, 
            { $pull: { utagHistory: { link: groupLink } } } // Eskisini o'chirish
        );
        await User.findOneAndUpdate(
            { chatId }, 
            { $push: { utagHistory: { $each: [{ title: groupTitle, link: groupLink }], $slice: -5 } } } // Oxirgi 5 tasini saqlash
        );

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

        const statusMsg = await bot.sendMessage(chatId, `🚀 **Avto Utag boshlandi!**\nJami: ${participants.length} ta foydalanuvchi.\nRejim: ${mode === 'custom' ? 'Matn bilan' : (mode === 'only_mention' ? 'Faqat @' : 'Tasodifiy so\'zlar')}`, getUtagButtons('running'));

        for (const p of participants) {
            // Holatni tekshirish
            while (utagStates[chatId]?.status === 'paused') {
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!utagStates[chatId] || utagStates[chatId].status === 'stopped') break;

            try {
                // Xabarni tanlash
                let messageToSend = "";
                if (mode === 'custom' && tagText) {
                    messageToSend = ` ${tagText}`;
                } else if (mode === 'random_words') {
                    messageToSend = ` ${shuffledMessages[msgIndex % shuffledMessages.length]}`;
                    msgIndex++;
                }
                
                let message;
                if (p.username) {
                    message = `@${p.username}${messageToSend}`;
                } else {
                    const name = p.firstName || "Foydalanuvchi";
                    message = `<a href="tg://user?id=${p.id.toString()}">${name}</a>${messageToSend}`;
                }
                
                await client.sendMessage(entity, { 
                    message, 
                    parseMode: p.username ? undefined : 'html' 
                });
                count++;
                utagStates[chatId].count = count;
                
                // Har 2 ta xabarda progressni yangilash
                if (count % 2 === 0 || count === participants.length) {
                    await bot.editMessageText(`🚀 **Avto UTag jarayoni...**\nProgress: ${count}/${participants.length}`, {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        ...getUtagButtons(utagStates[chatId].status)
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
        
        const finalStatus = utagStates[chatId]?.status === 'stopped' ? "to'xtatildi" : "tugadi";
        bot.sendMessage(chatId, `🏁 **Avto UTag ${finalStatus}!**\nJami tag qilindi: ${count} ta.`, getMainMenu(chatId));
        
        await User.findOneAndUpdate({ chatId }, { $inc: { utagCount: 1 } });
        delete utagStates[chatId];
    } catch (e) {
        throw new Error(`UTag xatosi: ${e.message}`);
    }
};

module.exports = { 
    userClients, avtoAlmazStates, utagStates, reklamaStates, reydSessions, startUserbot, blockExpiredUser,
    initAuth, handleAuthStep, scrapeUsers, startReyd, startReklama, startAutoTag
};
