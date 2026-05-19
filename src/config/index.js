require('dotenv').config(); 

module.exports = { 
    botToken: process.env.BOT_TOKEN, 
    apiId: parseInt(process.env.API_ID) || 2040, 
    apiHash: process.env.API_HASH || "b18441a1ff607e10a989891a5462e627", 
    adminId: parseInt(process.env.ADMIN_ID), 
    databaseUrl: process.env.DATABASE_URL, 
    port: process.env.PORT || 3000,
    botPromoUsername: process.env.BOT_PROMO_USERNAME || '@Foydasizku_bot',
    // BACKUP_SECRET — zaxira shifrlash (kamida 16 belgi, Render .env ga qo'shing)
    channels: [
        // { id: '@ortiqov_w', name: 'Personal', url: 'https://t.me/ortiqov_w' },
        // { id: '@AvtoBot_News', name: '𝗔𝗩𝗧𝗢 𝗕𝗢𝗧 𝗡𝗘𝗪𝗦 💎', url: 'https://t.me/AvtoBot_News' }
    ]
};
