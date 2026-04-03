// --- 0. GLOBAL ERROR HANDLING (CRASH PROTECTION) ---
process.on('uncaughtException', (err) => {
    console.error('❌ UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
    // Jarayonni to'xtatmaymiz, shunchaki log qilamiz
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const TelegramBot = require('node-telegram-bot-api'); 
const { connectDB, sequelize } = require('./config/db'); 
const express = require('express');
const dns = require('dns');
const os = require('os');
const config = require('./config'); 
const User = require('./models/User'); 
const { blockExpiredUser, loadAllStates } = require('./services/userbot'); 
const { withPremiumEmojis } = require('./utils/helpers');

// --- 1. SERVER & DNS SETUP ---
try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
    console.log("DNS serverlarini o'zgartirib bo'lmadi.");
}

const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));

// --- RENDER SELF-PING SYSTEM ---
const axios = require('axios');
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_SERVICE_NAME ? `https://${process.env.RENDER_SERVICE_NAME}.onrender.com` : null);

if (RENDER_URL) {
    console.log(`📡 Self-ping tizimi faollashtirildi: ${RENDER_URL}`);
    setInterval(() => {
        axios.get(RENDER_URL)
            .then(() => console.log('📡 Self-ping: Bot uyg\'oq!'))
            .catch((err) => {
                // Xatolikni faqat bir qator qilib log qilamiz, loglarni to'ldirmaslik uchun
                console.log('📡 Self-ping ulanish xatosi (Bot baribir ishlayapti)');
            });
    }, 10 * 60 * 1000); // Har 10 daqiqada
} else {
    console.log('📡 Self-ping tizimi ishga tushmadi (URL topilmadi)');
}

const startServer = (port) => {
    const p = parseInt(port);
    app.listen(p, () => {
        console.log(`✅ Server running on port ${p}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${p} band, ${p + 1} urinib ko'rilmoqda...`);
            startServer(p + 1);
        } else {
            console.error("Server error:", err);
        }
    });
};

startServer(config.port || 3000);

// --- 2. BOT INITIALIZATION ---
const bot = new TelegramBot(config.botToken, { 
    polling: {
        interval: 300,
        autoStart: false,
        params: {
            timeout: 10
        }
    }
});

// Pollingni xavfsiz boshlash funksiyasi
const startPolling = async () => {
    try {
        // Eski webhooklarni tozalash
        await bot.deleteWebHook({ drop_pending_updates: true });
        console.log("Sweep: Eski sessiyalar va webhooklar tozalandi.");
        
        // Pollingni boshlash
        bot.startPolling();
        console.log("🤖 Polling boshlandi...");
    } catch (err) {
        console.error("❌ Pollingni boshlashda xato:", err.message);
        setTimeout(startPolling, 5000);
    }
};

// Polling error handling
bot.on('polling_error', (error) => {
    if (error.message.includes('409 Conflict')) {
        console.error("⚠️ [409 Conflict] Bot boshqa joyda ham ishlamoqda. Eski sessiya hali yopilmagan bo'lishi mumkin.");
        // 409 bo'lganda pollingni to'xtatib, birozdan keyin qayta boshlaymiz
        bot.stopPolling().then(() => {
            setTimeout(startPolling, 10000);
        });
    } else {
        console.error("Polling error:", error.message);
    }
});

// --- 4. HANDLERS INTEGRATION --- 
require('./handlers/commands')(bot); 
require('./handlers/callbacks')(bot); 
require('./handlers/messages')(bot); 

// Debug: Xabar kelayotganini tekshirish
bot.on('message', (msg) => {
    console.log(`📩 Xabar keldi [${msg.chat.id}]: ${msg.text || '[Media/Other]'}`);
});

// --- 3. DATABASE CONNECTION ---
connectDB();

startPolling().then(() => {
    // Polling boshlangandan keyin holatlarni yuklaymiz
    loadAllStates(bot);
}).catch(err => {
    console.error("Critical error in startPolling chain:", err);
});

// Polling error handling
bot.on('polling_error', (error) => {
    if (error.message.includes('409 Conflict')) {
        console.error("⚠️ [409 Conflict] Bot boshqa joyda ham ishlamoqda. Eski sessiya hali yopilmagan bo'lishi mumkin.");
    } else {
        console.error("Polling error:", error.message);
    }
});

// --- GRACEFUL SHUTDOWN (Render Deploy uchun) ---
const shutdown = async (signal) => {
    console.log(`\n Industrial shutdown (${signal})...`);
    try {
        await bot.stopPolling();
        console.log("🛑 Polling to'xtatildi.");
        await sequelize.close();
        console.log("🔌 PostgreSQL ulanishi yopildi.");
        process.exit(0);
    } catch (err) {
        console.error("Shutdown error:", err.message);
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT')); 

// Interceptors for Premium Emojis
const originalSendMessage = bot.sendMessage.bind(bot);
const originalEditMessageText = bot.editMessageText.bind(bot);

bot.sendMessage = async function(chatId, text, options = {}) {
    // Premium emoji wrapperini vaqtincha soddalashtiramiz yoki xatolarni yaxshiroq ushlaymiz
    try {
        const { cleanText, entities } = withPremiumEmojis(text);
        let finalOptions = { ...options };
        
        if (entities && entities.length > 0) {
            finalOptions.entities = entities;
            delete finalOptions.parse_mode; 
            text = cleanText;
        }
        return await originalSendMessage(chatId, text, finalOptions);
    } catch (e) {
        console.error(`[Wrapper Error] Failed to send to ${chatId}:`, e.message);
        // Xatolik bo'lsa, mutlaqo oddiy matn ko'rinishida yuboramiz
        const safeText = text ? text.toString().replace(/[_*`]/g, '') : "Xatolik yuz berdi";
        return await originalSendMessage(chatId, safeText, { chat_id: chatId });
    }
};

bot.editMessageText = async function(text, options = {}) {
    const { cleanText, entities } = withPremiumEmojis(text);
    let finalOptions = { ...options };
    if (entities.length > 0) {
        finalOptions.entities = entities; // JSON.stringify KERAK EMAS
        delete finalOptions.parse_mode; 
        text = cleanText;
    }
    try {
        return await originalEditMessageText(text, finalOptions);
    } catch (e) {
        console.error(`Failed to edit message:`, e.message);
        return await originalEditMessageText(text.replace(/[_*`]/g, ''), { ...options, parse_mode: undefined, entities: undefined });
    }
};

// Global states 
global.userStates = {}; 

// --- 3. REAL-TIME EXPIRY & WARNING CHECKER --- 
setInterval(async () => { 
    try {
        const now = new Date(); 
        const { Op } = require('sequelize');
        
        // Expiry check - Status 'approved' bo'lgan va muddati o'tganlarni bloklash
        const expiredUsers = await User.findAll({ 
            where: {
                status: 'approved', 
                expireAt: { 
                    [Op.ne]: null, 
                    [Op.lt]: now 
                } 
            }
        }); 
        for (const user of expiredUsers) { 
            await blockExpiredUser(user, bot); 
        }

        // 1 kunlik (24 soat) ogohlantirish 
        const oneDayLater = new Date(now.getTime() + 86400000); 
        const warningUsers = await User.findAll({ 
            where: {
                status: 'approved', 
                expireAt: { 
                    [Op.gt]: now, 
                    [Op.lt]: oneDayLater 
                }, 
                expiryWarningSent: false 
            }
        }); 
        for (const u of warningUsers) { 
            const warningText = `⚠️ **Diqqat!**\n\nSizning botdan foydalanish muddatingiz tugashiga **1 kun** qoldi. Botdan foydalanishni davom ettirish uchun to'lovni amalga oshiring.\n\n👨‍💼 Admin: @ortiqov_x7`;
            bot.sendMessage(u.chatId, warningText, { parse_mode: "Markdown" }); 
            await User.update({ expiryWarningSent: true }, { where: { chatId: u.chatId } }); 
        } 
    } catch (error) {
        console.error("Expiry checker error:", error);
    }
}, 60000); 

const hostName = os.hostname();
const startTime = new Date().toLocaleString('en-US');
const startupMessage = `🚀 **Bot ishga tushdi!**\n\n💻 **Host:** ${hostName}\n📅 **Vaqt:** ${startTime}`;

if (config.adminId) {
    bot.sendMessage(config.adminId, startupMessage, { parse_mode: "Markdown" }).catch(err => {
        console.error("Admin startup notification error:", err.message);
    });
}

console.log(`🚀 AVTOCLICK PRO Ishga tushdi (Host: ${hostName})!`);
