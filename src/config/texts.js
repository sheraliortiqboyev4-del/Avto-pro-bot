/**
 * Bot matnlari va tugmalari - markazlashtirilgan konfiguratsiya
 * Bu faylda barcha foydalanuvchi va admin uchun xabarlar joylashgan
 */

const { BUTTON_EMOJI_IDS, BUTTON_STYLES } = require('../utils/helpers');

module.exports = {
    // ============================================
    // ADMIN MA'LUMOTLARI
    // ============================================
    admin: {
        username: '@id_uzzz',
        channel: '@AvtoBotOfficial'
    },

    // ============================================
    // ASOSIY XABARLAR
    // ============================================
    welcome: {
        withSession: (name) => 
            `👋 Assalomu alaykum, Hurmatli ${name}! \n\n` +
            `🤖 Bu bot orqali siz: \n` +
            ` • 💎 Avto Almaz - avtomatik almaz yig'ish \n` +
            ` • 👤 AvtoUser - guruhdan foydalanuvchilarni yig'ish \n` +
            ` • ⚔ Avto Reyd - guruhga yoki userga xabar yuborish \n` +
            ` • 📣 Avto Reklama - foydalanuvchilarga reklama yuborish \n` +
            ` • 🏷 Avto Uteg - guruhda foydalanuvchilarni uteg qilish \n\n` +
            `Botdan foydalanish uchun menudan tanlang!`,

        withoutSession: 
            `👋 **Xush kelibsiz!**\n\n` +
            `Bot funksiyalaridan foydalanish uchun Telegram akkauntingizga kirishingiz kerak.\n\n` +
            `📞 Iltimos, **telefon raqamingizni** xalqaro formatda yuboring:\n` +
            `(Masalan: \`+998901234567\`)`
    },

    // ============================================
    // PAYMENT VA TASDIQLASH XABARLARI
    // ============================================
    payment: {
        pending: (name, adminUsername) => 
            `👋 Assalomu alaykum, Hurmatli ${name}!\n\n` +
            `⚠ Siz botdan foydalanish uchun botning oylik tulovini amalga oshirmagansiz.\n` +
            `⚠ Botdan foydalanish uchun admin orqali to'lov qiling yoki dostlarni taklif qilish orqali tekin foydalaning!!!\n\n` +
            `👨‍💼 Admin: ${adminUsername}`,

        blocked: (adminUsername) => 
            `⚠ Sizning foydalanish muddatingiz tugagan.\n` +
            `Botdan foydalanishni davom ettirish uchun to'lovni amalga oshiring va botni qayta ishga tushiring.\n\n` +
            `👨‍💼 Admin: ${adminUsername}`,

        expired: (adminUsername) =>
            `⚠️ **Foydalanish muddatingiz tugadi!**\n\n` +
            `Botdan foydalanishni davom ettirish uchun to'lovni amalga oshiring.\n\n` +
            `👨‍💼 Admin: ${adminUsername}`
    },

    // ============================================
    // ADMIN UCHUN XABARLAR
    // ============================================
    adminNotifications: {
        newUser: (name, username, chatId) => 
            `🆕 **Yangi foydalanuvchi!**\n\n` +
            `Ism: ${name}\n` +
            `Username: @${username || 'yo\'q'}\n` +
            `ID: \`${chatId}\`\n\n` +
            `Tasdiqlash uchun quyidagi tugmani bosing:`,

        blockedUser: (name, chatId, time) =>
            `🆕 **Yangi foydalanuvchi!**\n\n` +
            `👤 Ism: ${name}\n` +
            `🆔 ID: \`${chatId}\`\n` +
            `📅 Vaqt: ${time}\n\n` +
            `Blokdan ochish uchun tugmani bosing:`
    },

    // ============================================
    // ADMIN TUGMALARI
    // ============================================
    adminButtons: {
        approve1Month: (chatId) => ({ 
            text: "1 Oy", 
            callback_data: `admin_approve_1month_${chatId}`,
            icon_custom_emoji_id: BUTTON_EMOJI_IDS.check,
            style: BUTTON_STYLES.success
        }),
        approveVIP: (chatId) => ({ 
            text: "VIP", 
            callback_data: `admin_approve_vip_${chatId}`,
            icon_custom_emoji_id: BUTTON_EMOJI_IDS.crown,
            style: BUTTON_STYLES.success
        }),
        approveCustom: (chatId) => ({ 
            text: "Ixtiyoriy", 
            callback_data: `admin_approve_${chatId}`,
            icon_custom_emoji_id: BUTTON_EMOJI_IDS.custom,
            style: BUTTON_STYLES.primary
        }),
        block: (chatId) => ({ 
            text: "Bloklash", 
            callback_data: `admin_block_${chatId}`,
            icon_custom_emoji_id: BUTTON_EMOJI_IDS.block,
            style: BUTTON_STYLES.danger
        }),
        
        // Payment tugmalari
        contactAdmin: (adminUsername) => ({ 
            text: "Admin bilan bog'lanish", 
            url: `https://t.me/${adminUsername.replace('@', '')}`,
            icon_custom_emoji_id: BUTTON_EMOJI_IDS.admin
        })
    },

    // ============================================
    // YORDAM MATNI
    // ============================================
    help: (channel, adminUsername) => 
        `🧾 **YORDAM BO'LIMI**\n\n` +
        `🤖 **Botning barcha imkoniyatlari bilan tanishing:**\n\n` +
        `💎 **Avto Almaz**\n` +
        `➤ Guruhlarga yuborilgan almaz va pullarni avto yigadi. \n` +
        `➤ Siz botni yoqib qo'ysangiz kifoya, qolganini o'zi bajaradi.\n\n` +
        `🏷 **Avto Utag**\n` +
        `➤ Guruh a'zolarini bittalab "tag" qilib chiqadi.\n` +
        `➤ Guruhda: /t (o'z so'z) , /b (bot so'zlari) , /s (to'xtatish).\n` +
        `➤ Bot orqali: online/hamma + tarixda saqlangan sozlamalar bilan qayta boshlash.\n\n` +
        `👤 **AvtoUser**\n` +
        `➤ Istalgan guruhdan foydalanuvchilar ro'yxatini (username) yig'ib beradi. \n` +
        `➤ Yig'ilgan ro'yxatni Reklama uchun ishlatishingiz mumkin.\n\n` +
        `⚔️ **Avto Reyd**\n` +
        `➤ Berilgan guruh yoki foydalanuvchiga tinimsiz xabar/stiker yuboradi. \n` +
        `➤ Bir vaqtning o'zida bir nechta akkauntdan foydalanish imkoniyati mavjud.\n\n` +
        `🚀 **Avto Reklama**\n` +
        `➤ Siz yuborgan foydalanuvchilar ro'yxatiga avtomatik reklama tarqatadi. \n` +
        `➤ Spamga tushmaslik uchun akkauntlarni navbatma-navbat almashtiradi.\n\n` +
        `📊 **Profil va Statistika**\n` +
        `➤ Sizning botdagi holatingiz, tarifingiz va statistikangizni ko'rsatadi.\n\n` +
        `🔄 **Raqamni o'zgartirish**\n` +
        `➤ Joriy akkauntdan chiqib, yangi raqam orqali kirish imkonini beradi.\n\n` +
        `⚠️ **Eslatma:** Botdan to'liq foydalanish uchun admin tomonidan tasdiqlangan bo'lishingiz shart.\n\n` +
        `📞 **Rasmiy kanal:** ${channel}\n` +
        `👨‍💼 **Admin:** ${adminUsername}`,

    // ============================================
    // XATOLIK VA OGOHLANTIRISH XABARLARI
    // ============================================
    errors: {
        botLoading: '⏳ Bot hali yuklanmoqda. Iltimos, 10 soniyadan keyin qayta /start bosing.',
        userNotFound: '❌ Foydalanuvchi topilmadi.',
        notRegistered: '❌ Ro\'yxatdan o\'tmagansiz.',
        needLogin: '❌ Menyuni ko\'rish uchun avval botga kiring.',
        referralExpired: '⚠️ Referral havola eskirgan. Do\'stingizdan yangi havola so\'rang.',
        apiMissing: `Botda API_ID/API_HASH yo'q. Admin Render → Environment ga my.telegram.org dan olingan API_ID va API_HASH qo'shishi shart — aks holda kod kelmaydi.`
    },

    // ============================================
    // KANAL OBUNA XABARLARI
    // ============================================
    subscription: {
        askJoin: '📢 Kanallarga obuna bo\'ling va **Tekshirish** ni bosing.',
    }
};
