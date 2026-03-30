require('dotenv').config(); 

module.exports = { 
    botToken: process.env.BOT_TOKEN, 
    apiId: parseInt(process.env.API_ID) || 2040, 
    apiHash: process.env.API_HASH || "b18441a1ff607e10a989891a5462e627", 
    adminId: parseInt(process.env.ADMIN_ID), 
    mongoUri: process.env.MONGO_URI, 
    port: process.env.PORT || 3000,
    channels: [
        // { id: '@ortiqov_w', name: 'Personal', url: 'https://t.me/ortiqov_w' },
        // { id: '@AvtoBot_News', name: '𝗔𝗩𝗧𝗢 𝗕𝗢𝗧 𝗡𝗘𝗪𝗦 💎', url: 'https://t.me/AvtoBot_News' }
    ]
};
