const TelegramBot = require('node-telegram-bot-api'); 
const mongoose = require('mongoose'); 
const express = require('express');
const dns = require('dns');
const os = require('os');
const config = require('./config'); 
const User = require('./models/User'); 
const { blockExpiredUser } = require('./services/userbot'); 
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
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;

setInterval(() => {
    if (RENDER_URL && !RENDER_URL.includes('undefined')) {
        axios.get(RENDER_URL)
            .then(() => console.log('Self-ping muvaffaqiyatli: Bot uyg\'oq!'))
            .catch((err) => console.log('Self-ping xatosi:', err.message));
    }
}, 10 * 60 * 1000); // Har 10 daqiqada o'zini uyg'otadi

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
const bot = new TelegramBot(config.token, { polling: true }); 

// Interceptors for Premium Emojis
const originalSendMessage = bot.sendMessage.bind(bot);
const originalEditMessageText = bot.editMessageText.bind(bot);

bot.sendMessage = async function(chatId, text, options = {}) {
    const { cleanText, entities } = withPremiumEmojis(text);
    let finalOptions = { ...options };
    if (entities.length > 0) {
        finalOptions.entities = JSON.stringify(entities); // JSON formatiga o'tkazish
        delete finalOptions.parse_mode; 
        text = cleanText;
    }
    try {
        return await originalSendMessage(chatId, text, finalOptions);
    } catch (e) {
        console.error(`Failed to send to ${chatId}:`, e.message);
        return await originalSendMessage(chatId, text.replace(/[*_`]/g, ''), { ...options, parse_mode: undefined });
    }
};

bot.editMessageText = async function(text, options = {}) {
    const { cleanText, entities } = withPremiumEmojis(text);
    let finalOptions = { ...options };
    if (entities.length > 0) {
        finalOptions.entities = JSON.stringify(entities); // JSON formatiga o'tkazish
        delete finalOptions.parse_mode; 
        text = cleanText;
    }
    try {
        return await originalEditMessageText(text, finalOptions);
    } catch (e) {
        console.error(`Failed to edit message:`, e.message);
        return await originalEditMessageText(text.replace(/[*_`]/g, ''), { ...options, parse_mode: undefined });
    }
};

// Global states 
global.userStates = {}; 

// DB Connection 
const connectDB = async () => {
    try {
        await mongoose.connect(config.mongoUri, { 
            family: 4,
            serverSelectionTimeoutMS: 5000 // Ulanishni uzoq kutib qolmaslik uchun
        });
        console.log("✅ MongoDB Ulangan");
    } catch (err) {
        console.error("❌ DB Xatosi:", err.message);
        console.log("🔄 5 soniyadan so'ng qayta ulanishga urinib ko'riladi...");
        setTimeout(connectDB, 5000);
    }
};

connectDB(); 

// --- 3. REAL-TIME EXPIRY & WARNING CHECKER --- 
setInterval(async () => { 
    try {
        const now = new Date(); 
        
        // Expiry check - Status 'approved' bo'lgan va muddati o'tganlarni bloklash
        const expiredUsers = await User.find({ 
            status: 'approved', 
            expireAt: { $ne: null, $lt: now } 
        }); 
        for (const user of expiredUsers) { 
            await blockExpiredUser(user, bot); 
        }

        // 1 kunlik (24 soat) ogohlantirish 
        const oneDayLater = new Date(now.getTime() + 86400000); 
        const warningUsers = await User.find({ 
            status: 'approved', 
            expireAt: { $gt: now, $lt: oneDayLater }, 
            expiryWarningSent: false 
        }); 
        for (const u of warningUsers) { 
            const warningText = `⚠️ **Diqqat!**\n\nSizning botdan foydalanish muddatingiz tugashiga **1 kun** qoldi. Botdan foydalanishni davom ettirish uchun to'lovni amalga oshiring.\n\n👨‍💼 Admin: @ortiqov_x7`;
            bot.sendMessage(u.chatId, warningText, { parse_mode: "Markdown" }); 
            await User.findOneAndUpdate({ chatId: u.chatId }, { expiryWarningSent: true }); 
        } 
    } catch (error) {
        console.error("Expiry checker error:", error);
    }
}, 60000); 

// --- 4. HANDLERS INTEGRATION --- 
require('./handlers/commands')(bot); 
require('./handlers/callbacks')(bot); 
require('./handlers/messages')(bot); 

const hostName = os.hostname();
const startTime = new Date().toLocaleString('en-US');
const startupMessage = `🚀 **Bot ishga tushdi!**\n\n💻 **Host:** ${hostName}\n📅 **Vaqt:** ${startTime}`;

if (config.adminId) {
    bot.sendMessage(config.adminId, startupMessage, { parse_mode: "Markdown" }).catch(err => {
        console.error("Admin startup notification error:", err.message);
    });
}

console.log(`🚀 AVTOCLICK PRO Ishga tushdi (Host: ${hostName})!`);
