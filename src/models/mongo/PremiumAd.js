const mongoose = require('mongoose');

const premiumAdSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true,
        unique: true,
        index: true
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
    collection: 'premium_ads',
    timestamps: false
});

module.exports = mongoose.model('PremiumAdMongo', premiumAdSchema);
