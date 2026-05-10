const mongoose = require('mongoose');

const premiumAdSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true,
        unique: true
    },
    content: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    usersList: {
        type: String,
        default: null
    },
    status: {
        type: String,
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    collection: 'premium_ads'
});

module.exports = mongoose.model('PremiumAd', premiumAdSchema);
