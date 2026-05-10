const mongoose = require('mongoose');
const config = require('./index');

const connectDB = async () => {
    try {
        await mongoose.connect(config.mongoUri);
        console.log('✅ MongoDB ulanishi muvaffaqiyatli.');
    } catch (error) {
        console.error('❌ MongoDB ulanishida xato:', error.message);
        setTimeout(connectDB, 5000);
    }
};

module.exports = { connectDB };
