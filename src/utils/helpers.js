const config = require('../config');
const Channel = require('../models/Channel');

const { Api } = require("telegram");

// Bot API entitylarini GramJS entitylariga o'tkazish
const convertToGramJsEntities = (entities) => {
    if (!entities || !Array.isArray(entities)) return undefined;
    return entities.map(e => {
        const args = { offset: e.offset, length: e.length };
        
        // Premium emoji (custom_emoji) uchun BigInt handling
        if (e.type === 'custom_emoji' && e.custom_emoji_id) {
            return new Api.MessageEntityCustomEmoji({
                ...args,
                documentId: BigInt(e.custom_emoji_id)
            });
        }

        // Boshqa standart entity turlari
        switch (e.type) {
            case 'bold': return new Api.MessageEntityBold(args);
            case 'italic': return new Api.MessageEntityItalic(args);
            case 'underline': return new Api.MessageEntityUnderline(args);
            case 'strikethrough': return new Api.MessageEntityStrike(args);
            case 'code': return new Api.MessageEntityCode(args);
            case 'pre': return new Api.MessageEntityPre({ ...args, language: e.language || '' });
            case 'text_link': return new Api.MessageEntityTextUrl({ ...args, url: e.url });
            case 'text_mention': {
                if (!e.user) return null;
                const userId = BigInt(e.user.id);
                // Agar accessHash bo'lsa, InputMessageEntityMentionName ishlatamiz (link bo'ladi)
                if (e.user.accessHash != null) {
                    try {
                        return new Api.InputMessageEntityMentionName({
                            ...args,
                            userId: new Api.InputUser({
                                userId,
                                accessHash: BigInt(e.user.accessHash)
                            })
                        });
                    } catch (err) {
                        // Fallback - oddiy MessageEntityMentionName
                        return new Api.MessageEntityMentionName({ ...args, userId });
                    }
                }
                // accessHash yo'q bo'lsa - MessageEntityMentionName (ba'zan ishlamaydi)
                return new Api.MessageEntityMentionName({ ...args, userId });
            }
            case 'mention': return new Api.MessageEntityMention(args);
            case 'hashtag': return new Api.MessageEntityHashtag(args);
            case 'bot_command': return new Api.MessageEntityBotCommand(args);
            case 'url': return new Api.MessageEntityUrl(args);
            case 'email': return new Api.MessageEntityEmail(args);
            case 'phone_number': return new Api.MessageEntityPhone(args);
            case 'spoiler': return new Api.MessageEntitySpoiler(args);
            default: return null;
        }
    }).filter(Boolean);
};

// Premium Emojilar xaritasi (inline tugmalar uchun)
const BUTTON_EMOJI_IDS = {
    // Asosiy menu
    almaz: '5427168083074628963',   // 💎
    utag: '5471901288448924312',     // 🏷
    user: '5255883984151276991',     // 👤
    reyd: '5377725257081696849',     // ⚔️
    reklama: '5305548297312675223',  // 📣
    bonus: '5305687351173849819',    // 🎁
    logout: '5305737159909581647',   // 🔄
    profile: '5305587785241992785',  // 📊
    admin: '5431650332419563627',    // 👨‍💻
    help: '5366068097365066701',     // 🧾
    
    // Umumiy
    back: '5352759161945867747',     // ◀️
    check: '5269481695991580059',    // ✅
    cancel: '5269501757783819821',   // ❌
    settings: '5341715473882955310', // ⚙️
    start: '5372917041193828849',    // 🚀
    add: '5397916757333654639',      // ➕
    remove: '5445267414562389170',   // 🗑
    history: '5197269100878907942',  // 📜
    random: '5305784520513954243',  //
    custom: '5305557136355370145',   // ✍️
    share: '5305733135525224451',    // 👥 (Do'stlarga ulashish)
    stars: '5346309121794659890',
    
    // Rejim/status
    on: '5416081784641168838',       // 🟢
    off: '5411225014148014586',      // 🔴
    pause: '5359543311897998264',    // ⏸
    play: '5348125953090403204',     // ▶️
    stop: '5472030751648127392',     // ⏹
    
    // Admin
    crown: '5217822164362739968',    // 👑
    block: '5472267631979405211'     // 🚫
};


const BUTTON_STYLES = {
    primary: 'primary',   // Ko'k
    success: 'success',   // Yashil
    danger: 'danger'      // Qizil
};

// Premium Emojilar xaritasi (matn uchun)
const EMOJI_MAP = {
    '💎': '5427168083074628963',
    '❌': '5210952531676504517',
    '✅': '5462919317832082236',
    '⚠️': '5420323339723881652',
    '👨': '5474667187258006816', 
    '💼': '5359785904535774578', 
    '⏳': '5451732530048802485',
    '👤': '5305291329419354124', 
    '🆔': '5334890573281114250',
    '📢': '5305548297312675223',
    '💻': '5366288132834599020',
    '🧾': '5305295963689067405',
    '⚔️': '5408935401442267103', 
    '📣': '5424818078833715060', 
    '📊': '5231200819986047254',
    '🔄': '5264727218734524899',
    '👥': '5305733135525224451',
    '🚫': '5472267631979405211',
    '🔙': '5253997076169115797',
    '🚀': '5445284980978621387',
    '📅': '5472100751025118421',
    '👋': '5472427507842032538',
    '👇': '5470177992950946662',
    '🆕': '5265244349976832702',
    '🔗': '5305789962237518029',
    '⛔': '5260293700088511294',
    'ℹ️': '5334544901428229844',
    '🤖': '5372981976804366741',
    '🎉': '5388674524583572460',
    '👑': '5217822164362739968',
    '📛': '5260293700088511294',
    '🔰': '5282843764451195532',
    '📋': '5174771276203427153',
    '📌': '5397782960512444700',
    '📂': '5431721976769027887',
    '⚙️': '5341715473882955310',
    '🟢': '5416081784641168838',
    '🔴': '5411225014148014586',
    '🔌': '5339517760592421605',
    '⏸': '5359543311897998264',
    '⏹': '5467643373835815896',
    '🛑': '5472030751648127392',
    '▶️': '5348125953090403204',
    '🔢': '5467370987009909520',
    '📝': '5334882760735598374',
    '🔐': '5472308992514464048',
    '🏁': '5411520005386806155',
    '📦': '5271923685547058434',
    '🎁': '5190527303599283765',
    '💵': '5215239948420003628',
    '👉': '5471978009449731768',
    '✍️': '5470060791883374114',
    '📞': '5467538555158943525',
    '⏰': '4904882772637648609',
    '🏷': '5471901288448924312',
    '🔓': '5465443379917629504',
    '📱': '5471960722206366390',
    '📍': '5228967510006580700',
    '🧙': '5305367311685788308',
    '✈':'5305338582649545744',
    '📜':'5305444432118555890',
    '💰': '5305517270468928539',
    '🪙': '5395536520817947330',
    '🗂': '5445221832074483553',
    '💳' : '5402377703640800862',
    '⭐' : '5346309121794659890',
    '🏠' : '5416041192905265756',
};

// Utag uchun alohida emoji xaritasi (DEFAULT_TAG_MESSAGES ichidagi emojilar)
const UTAG_EMOJI_MAP = {
    '💎': '5427168083074628963',
    '🦦': '5933844391436230115',
    '🤨': '5933614739534913978',
    '🧐': '5406669204898201943',
    '🫂': '5933554975064988681',
    '👀': '5949637815112310049',
    '👊': '5936118327511358849',
    '😁': '5953846402026052829',
    '🥱': '5954011711022308464',
    '😾': '5947074570040121675',
    '😆': '5949701170174892761',
    '🫣': '5935918362423991077',
    '😅': '5953942824041848229',
    '😎': '5933513893702802685',
    '😂': '5933896970425868228',
    '💥': '5933582802158100579',
    '💬': '5944815322753145500',
};

// Bot reaksiyalari uchun standart emojilar (Bot API qo'llab-quvvatlaydi)
// Premium emoji'lar faqat GramJS orqali ishlaydi, Bot API uchun standart emoji kerak
const REACTION_EMOJIS = {
    success: '❤️', // 👍 - To'g'ri xabar uchun
    error: '👎',   // 👎 - Noto'g'ri xabar uchun
    // Kerak bo'lsa qo'shimcha:
    fire: '🔥',
    heart: '❤',
    party: '🎉',
    ok: '👌'
};

// UTF-16 asosida matn uzunligini to'g'ri hisoblash (Telegram uchun .length kifoya)
const getUtf16Length = (str) => str.length;

// Matn ichidan barcha emojilarni topib, ularni custom_emoji entitylariga aylantiruvchi universal funksiya
function withPremiumEmojis(text) {
    if (!text) return { cleanText: "", entities: [] };
    let entities = [];
    let cleanText = text;

    // 1. Markdown va Custom Emojilarni qayta ishlash
    // Muhim: Markdown belgilarini olib tashlashda offsetlarni to'g'ri hisoblash kerak
    
    // Bold (**text**)
    const boldRegex = /\*\*(.*?)\*\*/g;
    let boldMatch;
    while ((boldMatch = boldRegex.exec(cleanText)) !== null) {
        const fullMatch = boldMatch[0];
        const innerText = boldMatch[1];
        const offset = boldMatch.index;
        const length = innerText.length;

        entities.push({ type: "bold", offset, length });
        
        // cleanText'ni yangilaymiz (belgilarni olib tashlaymiz)
        cleanText = cleanText.slice(0, offset) + innerText + cleanText.slice(offset + fullMatch.length);
        
        // Regex lastIndex'ni yangilangan matnga moslashtiramiz
        boldRegex.lastIndex = offset + length;
    }

    // Code (`text`)
    const codeRegex = /`(.*?)`/g;
    let codeMatch;
    while ((codeMatch = codeRegex.exec(cleanText)) !== null) {
        const fullMatch = codeMatch[0];
        const innerText = codeMatch[1];
        const offset = codeMatch.index;
        const length = innerText.length;

        entities.push({ type: "code", offset, length });
        
        cleanText = cleanText.slice(0, offset) + innerText + cleanText.slice(offset + fullMatch.length);
        codeRegex.lastIndex = offset + length;
    }

    // 2. Standart Telegram entitylari (Commands, Mentions)
    // Bu entitylar cleanText o'zgarmaganda ham ishlaydi
    
    // Commands (/start)
    const commandRegex = /(\/[a-zA-Z0-9_]+)/g;
    let cmdMatch;
    while ((cmdMatch = commandRegex.exec(cleanText)) !== null) {
        entities.push({ type: "bot_command", offset: cmdMatch.index, length: cmdMatch[0].length });
    }

    // Mentions (@username)
    const mentionRegex = /(@[a-zA-Z0-9_]+)/g;
    let mMatch;
    while ((mMatch = mentionRegex.exec(cleanText)) !== null) {
        entities.push({ type: "mention", offset: mMatch.index, length: mMatch[0].length });
    }

    // 3. Premium Emojilar (Custom Emojis)
    const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
    let eMatch;
    while ((eMatch = emojiRegex.exec(cleanText)) !== null) {
        const emoji = eMatch[0];
        let mappedId = EMOJI_MAP[emoji];
        
        if (!mappedId && EMOJI_MAP[emoji + '\uFE0F']) mappedId = EMOJI_MAP[emoji + '\uFE0F'];
        else if (!mappedId && emoji.endsWith('\uFE0F') && EMOJI_MAP[emoji.slice(0, -1)]) mappedId = EMOJI_MAP[emoji.slice(0, -1)];

        if (mappedId) {
            entities.push({
                type: "custom_emoji",
                offset: eMatch.index,
                length: emoji.length,
                custom_emoji_id: mappedId
            });
        }
    }

    // Entitylarni offset bo'yicha saralaymiz (Telegram talabi)
    entities.sort((a, b) => a.offset - b.offset);

    return { cleanText, entities };
}

/**
 * Utag uchun maxsus funksiya:
 * - DEFAULT_TAG_MESSAGES (random_words mode) uchun UTAG_EMOJI_MAP'dan emojilarni custom_emoji entitylariga o'tkazadi
 * - Custom mode (foydalanuvchi o'z matni) uchun foydalanuvchi entity'larini saqlab qoladi (qo'shilmaydi)
 * - Username yo'q foydalanuvchi uchun text_mention entity yaratadi
 * - Username bor foydalanuvchi uchun mention entity yaratadi (@username)
 *
 * @param {string} mentionText - "@username" yoki "Foydalanuvchi ismi"
 * @param {string} extraText - Tag matni (DEFAULT_TAG_MESSAGES yoki tagText)
 * @param {object} opts - { mentionUser, useEmojiMap, customEntities }
 *   - mentionUser: {id, accessHash} agar text_mention bo'lsa
 *   - useEmojiMap: true bo'lsa UTAG_EMOJI_MAP'dan custom_emoji qo'shadi (random_words uchun)
 *   - customEntities: foydalanuvchi yuborgan entitylar (custom mode uchun)
 * @returns {{ cleanText: string, entities: Array }}
 */
function buildUtagMessage(mentionText, extraText, opts = {}) {
    const { mentionUser = null, useEmojiMap = false, customEntities = null } = opts;
    const fullText = `${mentionText}${extraText || ''}`;
    const entities = [];

    // 1. Mention qismi (boshda)
    if (mentionUser && mentionUser.id) {
        entities.push({
            type: 'text_mention',
            offset: 0,
            length: mentionText.length,
            user: { id: mentionUser.id, accessHash: mentionUser.accessHash || null }
        });
    } else if (mentionText.startsWith('@')) {
        entities.push({
            type: 'mention',
            offset: 0,
            length: mentionText.length
        });
    }

    // 2. Custom mode: foydalanuvchining yuborgan entitylarini saqlaymiz
    // (offset'larni mentionText uzunligi bo'yicha to'g'rilaymiz)
    if (customEntities && Array.isArray(customEntities) && customEntities.length > 0) {
        const offsetShift = mentionText.length + (extraText && extraText.startsWith(' ') ? 1 : 0);
        // extraText odatda " <text>" - boshlanish bo'shligi bilan
        // Foydalanuvchi xabari boshidan offset hisoblangan, biz uni mentionText.length + bo'shliq qadar surishimiz kerak
        const baseOffset = mentionText.length + (extraText && extraText.length > 0 ? (extraText[0] === ' ' ? 1 : 0) : 0);
        for (const ent of customEntities) {
            entities.push({
                ...ent,
                offset: ent.offset + baseOffset
            });
        }
    }
    // 3. Random words / default messages: UTAG_EMOJI_MAP'dan emojilar
    else if (useEmojiMap) {
        const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
        let eMatch;
        while ((eMatch = emojiRegex.exec(fullText)) !== null) {
            const emoji = eMatch[0];
            let mappedId = UTAG_EMOJI_MAP[emoji];

            if (!mappedId && UTAG_EMOJI_MAP[emoji + '\uFE0F']) mappedId = UTAG_EMOJI_MAP[emoji + '\uFE0F'];
            else if (!mappedId && emoji.endsWith('\uFE0F') && UTAG_EMOJI_MAP[emoji.slice(0, -1)]) mappedId = UTAG_EMOJI_MAP[emoji.slice(0, -1)];

            if (mappedId) {
                entities.push({
                    type: 'custom_emoji',
                    offset: eMatch.index,
                    length: emoji.length,
                    custom_emoji_id: mappedId
                });
            }
        }
    }

    // Entitylarni offset bo'yicha saralash (Telegram talabi)
    entities.sort((a, b) => a.offset - b.offset);

    return { cleanText: fullText, entities };
}

const escapeMarkdown = (text) => text ? text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&') : ""; 

const escapeHTML = (text) => {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
};

const chunkArray = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

const parseTime = (input) => { 
    const units = { 'kun': 86400000, 'soat': 3600000, 'minut': 60000, 'oy': 2592000000, 'daqiqa': 60000 }; 
    let totalMs = 0; 
    const regex = /(\d+)\s*(kun|soat|minut|daqiqa|oy)/gi; 
    let match, found = false; 
    while ((match = regex.exec(input)) !== null) { 
        totalMs += parseInt(match[1]) * (units[match[2].toLowerCase()] || 0); 
        found = true; 
    } 
    return found ? totalMs : 0; 
}; 

const formatRemainingTime = (expireAt) => { 
    if (!expireAt) return "Cheksiz 👑"; 
    const diff = new Date(expireAt) - new Date(); 
    if (diff <= 0) return "Tugagan ❌"; 
    const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000); 
    return `${d} kun ${h} soat qoldi`; 
}; 

/** Telegram inline tugma uchun to'g'ri https://t.me/... link */
function normalizeTelegramUrl(raw) {
    if (!raw) return null;
    let url = String(raw).trim();
    if (!url) return null;

    if (/^https?:\/\//i.test(url)) {
        return url.replace(/^http:\/\//i, 'https://');
    }
    if (/^(t\.me|telegram\.me)\//i.test(url)) {
        return `https://${url}`;
    }
    if (url.startsWith('@')) {
        return `https://t.me/${url.slice(1)}`;
    }
    if (/^[a-zA-Z0-9_]{4,}$/.test(url)) {
        return `https://t.me/${url}`;
    }
    return null;
}

// Helper: Obuna tekshirish
async function checkMembership(bot, userId) {
    if (config.adminId && userId.toString() === config.adminId.toString()) return true; 
    
    try {
        const channels = await Channel.findAll();
        if (channels.length === 0) return true;

        for (const channel of channels) {
            try {
                const chatMember = await bot.getChatMember(channel.channelId, userId);
                // Member statuses that are considered "subscribed"
                const subscribedStatuses = ['creator', 'administrator', 'member'];
                if (!subscribedStatuses.includes(chatMember.status)) {
                    return false;
                }
            } catch (e) {
                console.error(`Kanalga a'zolikni tekshirishda xatolik (${channel.channelId}):`, e.message);
                // Agar kanal topilmasa yoki bot admin bo'lmasa, xavfsizlik uchun false qaytaramiz
                // Bu adminni kanallarni to'g'ri sozlashga majbur qiladi
                if (e.message.includes("chat not found") || e.message.includes("bot is not a member")) {
                    // return false; // Bu yerda false qaytarish foydalanuvchini bloklab qo'yishi mumkin
                }
            }
        }
        return true;
    } catch (err) {
        console.error("checkMembership global error:", err.message);
        return true; // Xatolik bo'lsa bot to'xtab qolmasligi uchun true
    }
}

// Helper: Obuna xabari
async function sendSubscriptionAsk(bot, chatId) {
    const channels = await Channel.findAll();
    const buttons = [];

    for (const channel of channels) {
        const url = normalizeTelegramUrl(channel.url);
        if (!url) {
            console.error(`Kanal URL noto'g'ri (${channel.name}): ${channel.url}`);
            continue;
        }
        buttons.push([{ text: `${channel.name} `, url , style: 'success'}]);
    }

    buttons.push([{ text: "Tekshirish", callback_data: "check_subscription", icon_custom_emoji_id: '5269481695991580059', style: 'success' }]);

    const text = buttons.length > 1
        ? "⚠️ **Botdan foydalanish uchun quyidagi kanallarga a'zo bo'ling:**\n\nA'zo bo'lgandan so'ng \"✅ Tekshirish\" tugmasini bosing."
        : "⚠️ **Majburiy obuna kanallari sozlanmagan yoki linklar noto'g'ri.**\n\nAdmin bilan bog'laning.";

    try {
        await bot.sendMessage(chatId, text, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: buttons }
        });
    } catch (e) {
        console.error('sendSubscriptionAsk xatosi:', e.message);
        await bot.sendMessage(chatId, text, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[{ 
                    text: "Tekshirish", 
                    callback_data: "check_subscription", 
                    icon_custom_emoji_id: '5269481695991580059',
                    style: 'success'
                }]]
            }
        }).catch(() => {});
    }
}

// Helper: Asosiy menyu (Inline)
function getMainMenu(chatId) {
    const isAdmin = config.adminId && chatId.toString() === config.adminId.toString();
    const lastRow = isAdmin 
        ? [{ text: "Admin Panel", callback_data: "admin_panel", icon_custom_emoji_id: BUTTON_EMOJI_IDS.admin , style: BUTTON_STYLES.success  }]
        : [{ text: "Yordam", callback_data: "menu_help", icon_custom_emoji_id: BUTTON_EMOJI_IDS.help , style: BUTTON_STYLES.success }];

    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "Avto Almaz", callback_data: "menu_almaz", icon_custom_emoji_id: BUTTON_EMOJI_IDS.almaz , style: BUTTON_STYLES.primary}, 
                    { text: "Avto Utag", callback_data: "menu_utag", icon_custom_emoji_id: BUTTON_EMOJI_IDS.utag , style: BUTTON_STYLES.primary}
                ],
                [
                    { text: "Avto User", callback_data: "menu_avtouser", icon_custom_emoji_id: BUTTON_EMOJI_IDS.user , style: BUTTON_STYLES.primary}, 
                    { text: "Avto Reyd", callback_data: "menu_reyd", icon_custom_emoji_id: BUTTON_EMOJI_IDS.reyd , style: BUTTON_STYLES.primary}
                ],
                [{ text: "Avto Reklama", callback_data: "menu_reklama", icon_custom_emoji_id: BUTTON_EMOJI_IDS.reklama , style: BUTTON_STYLES.primary}],
                [{ text: "Bonus", callback_data: "menu_bonus", icon_custom_emoji_id: BUTTON_EMOJI_IDS.bonus, style: BUTTON_STYLES.primary }],
                [
                    { text: "Logout", callback_data: "menu_logout", icon_custom_emoji_id: BUTTON_EMOJI_IDS.logout, style: BUTTON_STYLES.danger }, 
                    { text: "Profil", callback_data: "menu_profile", icon_custom_emoji_id: BUTTON_EMOJI_IDS.profile , style: BUTTON_STYLES.danger }
                ],
                lastRow
            ]
        }
    };
}

// Helper: Avto Almaz Menyu
const getAlmazMenu = (isEnabled) => {
    const buttonText = isEnabled ? "O'chirish" : "Yoqish";
    const buttonAction = isEnabled ? "almaz_off" : "almaz_on";
    const emojiId = isEnabled ? BUTTON_EMOJI_IDS.off : BUTTON_EMOJI_IDS.on;
    const buttonColorType = isEnabled ? BUTTON_STYLES.danger : BUTTON_STYLES.success;

    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: buttonText, callback_data: buttonAction, icon_custom_emoji_id: emojiId, style: buttonColorType }],
                [{ text: "Orqaga", callback_data: "menu_back_main", icon_custom_emoji_id: BUTTON_EMOJI_IDS.back , style: BUTTON_STYLES.primary}]
            ]
        }
    };
};

/** Guruh ID bo'yicha tarixda bitta yozuv */
function normalizeUtagGroupId(idOrLink) {
    const s = String(idOrLink).trim();
    if (/^-?\d+$/.test(s)) return s;
    return s;
}

function upsertUtagHistory(history, entry) {
    const id = normalizeUtagGroupId(entry.id);
    const list = (history || []).filter((h) => normalizeUtagGroupId(h.id) !== id);
    list.push({
        id,
        title: entry.title || 'Guruh',
        link: entry.link || id,
        mode: entry.mode || 'only_mention',
        limit: entry.limit ?? 0,
        tagText: entry.tagText || null,
        tagEntities: entry.tagEntities || null,
        memberFilter: entry.memberFilter || 'all',
        updatedAt: new Date().toISOString()
    });
    return list.slice(-15);
}

function getUtagSetupKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Faqat online', callback_data: 'utag_filter_online', icon_custom_emoji_id: BUTTON_EMOJI_IDS.on, style: BUTTON_STYLES.success },
                    { text: 'Hammani', callback_data: 'utag_filter_all', icon_custom_emoji_id: BUTTON_EMOJI_IDS.user , style: BUTTON_STYLES.primary }
                ],
                [{ text: 'Bekor', callback_data: 'menu_utag', icon_custom_emoji_id: BUTTON_EMOJI_IDS.cancel, style: BUTTON_STYLES.danger }]
            ]
        }
    };
}

function getUtagModeKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "@ Foydalanuvchi o'zi", callback_data: 'utag_mode_only_mention', icon_custom_emoji_id: BUTTON_EMOJI_IDS.user , style: BUTTON_STYLES.primary }],
                [{ text: "Tasodifiy so'zlar (bot)", callback_data: 'utag_mode_random_words', icon_custom_emoji_id: BUTTON_EMOJI_IDS.random , style: BUTTON_STYLES.primary }],
                [{ text: "O'z matnim bilan", callback_data: 'utag_mode_custom', icon_custom_emoji_id: BUTTON_EMOJI_IDS.custom , style: BUTTON_STYLES.primary }]
            ]
        }
    };
}

function getUtagMenu(accountMode = 'main', rekCount = 0) {
    const modeText = accountMode === 'all' ? "Barcha akkauntlar" : "Faqat asosiy";
    const modeIcon = accountMode === 'all' ? '5471952088544950134' : BUTTON_EMOJI_IDS.user;
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Yangi boshlash", callback_data: "utag_start_new", icon_custom_emoji_id: BUTTON_EMOJI_IDS.start, style: BUTTON_STYLES.primary }],
                [{ text: `Rejim: ${modeText}`, callback_data: "utag_change_mode", icon_custom_emoji_id: modeIcon , style: BUTTON_STYLES.primary }],
                [
                    { text: `Akkaunt qo'shish (${rekCount}/10)`, callback_data: "reklama_add_acc", icon_custom_emoji_id: BUTTON_EMOJI_IDS.add, style: BUTTON_STYLES.success },
                    { text: "Tozalash", callback_data: "reklama_clear_accs", icon_custom_emoji_id: BUTTON_EMOJI_IDS.remove, style: BUTTON_STYLES.danger }
                ],
                [{ text: "Tarix", callback_data: "utag_history", icon_custom_emoji_id: BUTTON_EMOJI_IDS.history , style: BUTTON_STYLES.primary }],
                [{ text: "Tarixni tozalash", callback_data: "utag_clear_history", icon_custom_emoji_id: BUTTON_EMOJI_IDS.remove, style: BUTTON_STYLES.danger }],
                [{ text: "Orqaga", callback_data: "menu_back_main", icon_custom_emoji_id: BUTTON_EMOJI_IDS.back , style: BUTTON_STYLES.primary }]
            ]
        }
    };
}

function getReklamaMenu(accountsCount = 0) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Reklama boshlash", callback_data: "reklama_start", icon_custom_emoji_id: BUTTON_EMOJI_IDS.start, style: BUTTON_STYLES.primary }],
                [{ text: `Akkaunt qo'shish (${accountsCount}/10)`, callback_data: "reklama_add_acc", icon_custom_emoji_id: BUTTON_EMOJI_IDS.add, style: BUTTON_STYLES.success }],
                [{ text: "Akkauntlarni tozalash", callback_data: "reklama_clear_acc", icon_custom_emoji_id: BUTTON_EMOJI_IDS.remove, style: BUTTON_STYLES.danger }],
                [{ text: "Orqaga", callback_data: "menu_back_main", icon_custom_emoji_id: BUTTON_EMOJI_IDS.back , style: BUTTON_STYLES.primary  }]
            ]
        }
    };
}

function getReydMenu(accountsCount = 0) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Reyd boshlash", callback_data: "reyd_start", icon_custom_emoji_id: BUTTON_EMOJI_IDS.start, style: BUTTON_STYLES.primary }],
                [{ text: `Akkaunt qo'shish (${accountsCount}/10)`, callback_data: "reyd_add_acc", icon_custom_emoji_id: BUTTON_EMOJI_IDS.add, style: BUTTON_STYLES.success }],
                [{ text: "Akkauntlarni tozalash", callback_data: "reyd_clear_acc", icon_custom_emoji_id: BUTTON_EMOJI_IDS.remove, style: BUTTON_STYLES.danger }],
                [{ text: "Orqaga", callback_data: "menu_back_main", icon_custom_emoji_id: BUTTON_EMOJI_IDS.back , style: BUTTON_STYLES.primary  }]
            ]
        }
    };
}

// Helper: Admin Menyu
function getAdminMenu() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "Statistika", callback_data: "admin_stats", icon_custom_emoji_id: '5231200819986047254' , style: BUTTON_STYLES.primary  }, 
                ],
                [
                    { text: "Kutilayotganlar", callback_data: "admin_pending", icon_custom_emoji_id: '5451732530048802485' , style: BUTTON_STYLES.primary }, 
                    { text: "Barcha A'zolar", callback_data: "admin_all_users", icon_custom_emoji_id: '5305733135525224451' , style: BUTTON_STYLES.primary  }
                ],
                [
                    { text: "Bloklanganlar", callback_data: "admin_blocked", icon_custom_emoji_id: '5472267631979405211', style: BUTTON_STYLES.danger }, 
                    { text: "Tasdiqlanganlar", callback_data: "admin_approved", icon_custom_emoji_id: BUTTON_EMOJI_IDS.check, style: BUTTON_STYLES.success }
                ],
                [{ text: "Kanallar sozlamasi", callback_data: "admin_channels", icon_custom_emoji_id: BUTTON_EMOJI_IDS.settings , style: BUTTON_STYLES.primary }],
                [
                    { text: "Bonus tizimi", callback_data: "admin_bonus", icon_custom_emoji_id: BUTTON_EMOJI_IDS.bonus, style: BUTTON_STYLES.primary },
                    { text: "Barchaga Xabar", callback_data: "admin_broadcast", icon_custom_emoji_id: BUTTON_EMOJI_IDS.reklama, style: BUTTON_STYLES.primary }

                ],
                [{ text: "Orqaga", callback_data: "menu_back_main", icon_custom_emoji_id: BUTTON_EMOJI_IDS.back , style: BUTTON_STYLES.primary }]
            ]
        }
    };
}

// Foydalanuvchi guruh admini ekanligini tekshirish
const isUserAdmin = async (bot, chatId, userId) => {
    try {
        if (chatId === userId) return true; // Shaxsiy chatda o'zi admin
        const member = await bot.getChatMember(chatId, userId);
        return ['creator', 'administrator'].includes(member.status);
    } catch (e) {
        console.error("Admin check error:", e.message);
        return false;
    }
};

function getBonusCoinRow() {
    return [{ 
        text: "Bonus", 
        callback_data: "menu_bonus", 
        icon_custom_emoji_id: '5305687351173849819',
        style: 'primary'
    }];
}

function getPendingPaymentKeyboard() {
    // Lazy require - circular dependency oldini olish uchun
    const texts = require('../config/texts');
    return {
        inline_keyboard: [
            [{
                text: "Stars orqali to'lov",
                callback_data: "stars_buy",
                icon_custom_emoji_id: BUTTON_EMOJI_IDS.stars,
                style: BUTTON_STYLES.success
            }],
            [texts.adminButtons.contactAdmin(texts.admin.username)]
        ]
    };
}

function getAdminCoinKeyboard(targetId) {
    const id = String(targetId);
    return [
        [{ text: "➖ Coin yechib olish", callback_data: `admin_coins_deduct_${id}` , style: BUTTON_STYLES.primary }],
        [{ text: "✏️ Coin belgilash", callback_data: `admin_coins_set_${id}` , style: BUTTON_STYLES.primary }]
    ];
}

/** Guruh tanlash (request_chat) — har bir funksiya uchun alohida request_id */
const SCRAPE_CHAT_REQUEST_ID = 1;
const REYD_CHAT_REQUEST_ID = 2;
const UTAG_CHAT_REQUEST_ID = 3;

function getGroupPickerKeyboard(requestId) {
    return {
        keyboard: [
            [{
                text: 'Guruh',
                icon_custom_emoji_id: '5305733135525224451',
                style: BUTTON_STYLES.success ,
                request_chat: {
                    request_id: requestId,
                    chat_is_channel: false,
                    chat_is_forum: false,
                    bot_is_member: false
                }
            }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
        is_persistent: false
    };
}

function getAvtoUserGroupPickerKeyboard() {
    return getGroupPickerKeyboard(SCRAPE_CHAT_REQUEST_ID);
}

function getPhoneShareKeyboard() {
    return {
        keyboard: [[{ 
            text: 'Telefon raqamni ulashish', 
            icon_custom_emoji_id: '5471960722206366390',
            request_contact: true 
        }]],
        resize_keyboard: true,
        one_time_keyboard: true,
        is_persistent: false
    };
}

function parseSharedGroup(chatShared) {
    return {
        id: String(chatShared.chat_id),
        title: chatShared.title || chatShared.username || 'Guruh'
    };
}

function normalizePhoneInput(input) {
    let phoneNumber = String(input).replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (!phoneNumber.startsWith('+')) {
        if (phoneNumber.length === 9) {
            phoneNumber = '+998' + phoneNumber;
        } else if (phoneNumber.length === 12) {
            phoneNumber = '+' + phoneNumber;
        }
    }
    return phoneNumber;
}

function removeKeyboardMarkup() {
    return { reply_markup: { remove_keyboard: true } };
}

// Bot reaksiya qo'yish funksiyasi
async function sendBotReaction(bot, chatId, messageId, reactionType = 'success') {
    try {
        const reactionEmoji = REACTION_EMOJIS[reactionType] || REACTION_EMOJIS.success;
        
        console.log(`[Reaction START] chatId=${chatId}, msgId=${messageId}, type=${reactionType}, emoji=${reactionEmoji}`);
        
        // node-telegram-bot-api orqali to'g'ridan-to'g'ri API'ga murojaat qilamiz
        const axios = require('axios');
        const botToken = require('../config').botToken;
        
        const url = `https://api.telegram.org/bot${botToken}/setMessageReaction`;
        const payload = {
            chat_id: chatId,
            message_id: messageId,
            reaction: [{
                type: 'emoji',  // Standart emoji uchun 'emoji' type ishlatiladi
                emoji: reactionEmoji
            }],
            is_big: false
        };
        
        console.log(`[Reaction] So'rov yuborilmoqda:`, JSON.stringify(payload));
        
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000 // 10 soniya timeout
        });
        
        if (response.data && response.data.ok) {
            console.log(`[Reaction SUCCESS] ${reactionType} (${reactionEmoji}) reaksiya qo'yildi ✅`);
            return true;
        } else {
            console.error(`[Reaction FAILED] Response:`, response.data);
            return false;
        }
    } catch (error) {
        // Reaksiya xato bersa ham, asosiy jarayonni to'xtatmaymiz
        const errorMsg = error.response?.data?.description || error.message;
        console.error(`[Reaction ERROR] (${reactionType}):`, errorMsg);
        
        // Batafsil debug uchun
        if (error.response?.data) {
            console.error('[Reaction] API Response:', JSON.stringify(error.response.data, null, 2));
        }
        if (error.code) {
            console.error('[Reaction] Error code:', error.code);
        }
        
        return false;
    }
}

module.exports = { 
    escapeMarkdown, 
    escapeHTML,
    chunkArray,
    parseTime, 
    formatRemainingTime, 
    withPremiumEmojis, 
    convertToGramJsEntities,
    getUtf16Length,
    normalizeTelegramUrl,
    checkMembership, 
    sendSubscriptionAsk,
    sendBotReaction, 
    getMainMenu, 
    getAlmazMenu,
    getUtagMenu,
    normalizeUtagGroupId,
    upsertUtagHistory,
    getUtagSetupKeyboard,
    getUtagModeKeyboard,
    getReklamaMenu,
    getReydMenu,
    getAdminMenu,
    getBonusCoinRow,
    getPendingPaymentKeyboard,
    getAdminCoinKeyboard,
    getAvtoUserGroupPickerKeyboard,
    getGroupPickerKeyboard,
    getPhoneShareKeyboard,
    parseSharedGroup,
    normalizePhoneInput,
    removeKeyboardMarkup,
    SCRAPE_CHAT_REQUEST_ID,
    REYD_CHAT_REQUEST_ID,
    UTAG_CHAT_REQUEST_ID,
    isUserAdmin,
    EMOJI_MAP,
    UTAG_EMOJI_MAP,
    buildUtagMessage,
    BUTTON_EMOJI_IDS,
    BUTTON_STYLES
};
