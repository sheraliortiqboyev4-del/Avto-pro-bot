/**
 * To'lov tizimi (Telegram Stars)
 * Bu faylda barcha to'lov bilan bog'liq logikalar joylashgan:
 * - Tariflar (narxlar va Stars miqdori)
 * - Tugmalar (keyboard)
 * - Matnlar (xabarlar)
 * - Handler'lar (callback va to'lov tasdiqlash)
 *
 * Foydalanuvchi tomonidan o'zgartirish uchun:
 * - TARIFFS arrayini o'zgartirib narxlarni yangilashingiz mumkin
 * - TEXTS objektidagi matnlarni o'zgartirishingiz mumkin
 * - getStarsTariffKeyboard() funksiyasi orqali tugma ko'rinishini o'zgartirishingiz mumkin
 */

const User = require('../models/User');
const config = require('../config');
const { triggerBackup } = require('../utils/dbBackup');

// ============================================
// TARIFLAR
// ============================================
// 1 Star ≈ 250 so'm (taxminiy narx)
// Narxlarni o'zgartirish uchun shu yerni tahrirlang
const TARIFFS = [
    { id: '1day',   label: '1 Kun',    days: 1,  stars: 16,  price: 4000  },
    { id: '3day',   label: '3 Kun',    days: 3,  stars: 48,  price: 12000 },
    { id: '1week',  label: '1 Hafta',  days: 7,  stars: 110, price: 28000 },
    { id: '1month', label: '1 Oy',     days: 30, stars: 200, price: 50000 }
];

// ============================================
// MATNLAR
// ============================================
const TEXTS = {
    title: '💳 **Tarif Tanlash**\n\n',

    description: (tariffs) => 
        `📦 **Mavjud Tariflar:**\n\n` +
        tariffs.map(t => `💎 ${t.label} — ${t.stars} ⭐ (${t.price.toLocaleString('uz-UZ')} so'm)`).join('\n') +
        `\n\n💡 **To'lov Telegram Stars orqali amalga oshiriladi.**\n` +
        `🎁 **Do'stingizni taklif qilib bonus oling!**`,

    invoiceTitle: (label) => `${label} obuna`,

    invoiceDescription: (label) => 
        `${label} obuna\n\n` +
        `🔄 Vaqtingiz tugamagan bo'lsa — muddatga qo'shiladi`,

    successMessage: (stars, days, expireAt) =>
        `✅ **To'lov muvaffaqiyatli!**\n\n` +
        `💎 To'lov: ${stars} ⭐ Stars\n` +
        `📅 Qo'shildi: ${days} kun\n` +
        `⏰ Muddat: ${expireAt.toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}\n\n` +
        `🎉 Bot funksiyalaridan foydalanishingiz mumkin!`,

    adminNotification: (userName, chatId, stars, days, expireAt) =>
        `💳 **Stars to'lov!**\n\n` +
        `👤 User: ${userName} (\`${chatId}\`)\n` +
        `💎 Miqdor: ${stars} ⭐\n` +
        `📅 Tarif: ${days} kun\n` +
        `⏰ Muddati: ${expireAt.toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`,

    tariffNotFound: '❌ Tarif topilmadi.',
    invoiceError: (msg) => `❌ Xatolik: ${msg}`
};

// ============================================
// TUGMALAR (KEYBOARD)
// ============================================
const getStarsTariffKeyboard = () => {
    const { BUTTON_EMOJI_IDS, BUTTON_STYLES } = require('../utils/helpers');
    
    const buttons = TARIFFS.map(t => ([{
        text: `${t.stars} — ${t.label} `,
        callback_data: `stars_pay_${t.id}`,
        icon_custom_emoji_id: BUTTON_EMOJI_IDS.stars,
        style: BUTTON_STYLES.success
    }]));
    
    // Bonus tugmasi (Do'stlarni taklif qilish)
    buttons.push([{
        text: "Bonus",
        callback_data: "menu_bonus",
        icon_custom_emoji_id: BUTTON_EMOJI_IDS.bonus,
        style: BUTTON_STYLES.danger
    }]);
    
    // Orqaga
    buttons.push([{
        text: "Orqaga",
        callback_data: "stars_back",
        icon_custom_emoji_id: BUTTON_EMOJI_IDS.back,
        style: BUTTON_STYLES.primary
    }]);
    
    return { inline_keyboard: buttons };
};

// ============================================
// HANDLER'LAR
// ============================================

/**
 * Stars sotib olish menyusini ko'rsatish (callback: stars_buy)
 */
const handleStarsBuy = async (bot, chatId, messageId, safeEdit, safeAnswer) => {
    const text = TEXTS.title +
        `❌ Hozircha ruxsatingiz yo'q — tarif tanlang!\n\n` +
        TEXTS.description(TARIFFS);
    
    const opts = {
        parse_mode: 'Markdown',
        reply_markup: getStarsTariffKeyboard()
    };
    
    try {
        await safeEdit(chatId, messageId, text, opts);
    } catch (e) {
        await bot.sendMessage(chatId, text, opts);
    }
    return await safeAnswer();
};

/**
 * Stars to'lash invoice yuborish (callback: stars_pay_<tariffId>)
 */
const handleStarsPay = async (bot, chatId, tariffId, safeAnswer) => {
    const tariff = TARIFFS.find(t => t.id === tariffId);
    if (!tariff) {
        return await safeAnswer({ text: TEXTS.tariffNotFound, show_alert: true });
    }
    
    try {
        await bot.sendInvoice(
            chatId,
            TEXTS.invoiceTitle(tariff.label),
            TEXTS.invoiceDescription(tariff.label),
            JSON.stringify({ tariffId: tariff.id, days: tariff.days, stars: tariff.stars }),
            '',      // provider_token bo'sh = Telegram Stars
            'XTR',   // Stars currency
            [{ label: tariff.label, amount: tariff.stars }]
        );
        return await safeAnswer();
    } catch (e) {
        console.error('[Stars Invoice Error]:', e.message);
        return await safeAnswer({ text: TEXTS.invoiceError(e.message), show_alert: true });
    }
};

/**
 * Pre-checkout query (Telegram to'lov oldidan tasdiq so'raydi)
 */
const handlePreCheckout = async (bot, query) => {
    try {
        await bot.answerPreCheckoutQuery(query.id, true);
    } catch (e) {
        console.error('[PreCheckout Error]:', e.message);
        try {
            await bot.answerPreCheckoutQuery(query.id, false, {
                error_message: 'To\'lov tasdiqlanmadi. Iltimos, qayta urinib ko\'ring.'
            });
        } catch (e2) {}
    }
};

/**
 * Successful payment - to'lov amalga oshganda
 * Muddat qo'shish logikasi:
 * - Mavjud muddat hali tugamagan bo'lsa - shu muddatga qo'shamiz
 * - Tugagan yoki yo'q bo'lsa - hozirgi vaqtdan boshlaymiz
 */
const handleSuccessfulPayment = async (bot, msg) => {
    try {
        const chatId = msg.chat.id;
        const payment = msg.successful_payment;
        const payload = JSON.parse(payment.invoice_payload || '{}');
        const days = parseInt(payload.days) || 30;
        const stars = parseInt(payload.stars) || 0;
        
        const user = await User.findOne({ where: { chatId } });
        if (!user) {
            console.error(`[Stars Payment] User ${chatId} topilmadi`);
            return;
        }
        
        // Muddat hisoblash
        const now = new Date();
        let baseDate = now;
        if (user.expireAt && new Date(user.expireAt) > now) {
            baseDate = new Date(user.expireAt);
        }
        const newExpireAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
        
        // DB yangilash
        await User.update({
            status: 'approved',
            subscriptionType: 'Stars',
            expireAt: newExpireAt,
            expiryWarningSent: false  // yangi eslatma yuborish uchun
        }, { where: { chatId } });
        
        triggerBackup('stars_tolov', true);
        
        // Foydalanuvchiga tasdiq xabari
        await bot.sendMessage(chatId, TEXTS.successMessage(stars, days, newExpireAt), { 
            parse_mode: 'Markdown' 
        });
        
        // Asosiy menu
        const { getMainMenu } = require('../utils/helpers');
        await bot.sendMessage(chatId, "🏠 Asosiy menu:", getMainMenu(chatId));
        
        // Adminga xabar
        const userName = user.name || 'Noma\'lum';
        await bot.sendMessage(
            config.adminId, 
            TEXTS.adminNotification(userName, chatId, stars, days, newExpireAt),
            { parse_mode: 'Markdown' }
        ).catch(() => {});
        
        console.log(`[Stars Payment] User ${chatId} - ${stars}⭐ - ${days} kun, expire: ${newExpireAt}`);
    } catch (e) {
        console.error('[Successful Payment Error]:', e.message);
    }
};

/**
 * Bot.js'da chaqirish uchun barcha handlerlarni ulash
 */
const attachPaymentHandlers = (bot) => {
    bot.on('pre_checkout_query', (query) => handlePreCheckout(bot, query));
    bot.on('successful_payment', (msg) => handleSuccessfulPayment(bot, msg));
};

module.exports = {
    TARIFFS,
    TEXTS,
    getStarsTariffKeyboard,
    handleStarsBuy,
    handleStarsPay,
    handlePreCheckout,
    handleSuccessfulPayment,
    attachPaymentHandlers
};
