const mongoose = require('mongoose');
const config = require('./index');

const connectMongoDB = async () => {
    try {
        await mongoose.connect(config.mongodbUrl);
        console.log('✅ MongoDB ulanishi muvaffaqiyatli.');
    } catch (error) {
        console.error('❌ MongoDB ulanishida xato:', error.message);
        setTimeout(connectMongoDB, 5000);
    }
};

module.exports = { mongoose, connectMongoDB };
