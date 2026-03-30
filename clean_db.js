const mongoose = require('mongoose');
const config = require('./src/config');
const PremiumAd = require('./src/models/PremiumAd');

async function cleanAndRestart() {
    try {
        await mongoose.connect(config.mongoUri);
        console.log("✅ MongoDB connected for cleaning...");
        
        const result = await PremiumAd.deleteMany({});
        console.log(`🗑 Deleted ${result.deletedCount} old premium ad records.`);
        
        await mongoose.disconnect();
        console.log("✅ Cleaning done. Restarting bot...");
    } catch (error) {
        console.error("❌ Cleaning error:", error);
        process.exit(1);
    }
}

cleanAndRestart();
