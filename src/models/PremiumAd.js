const mongoose = require('mongoose');

const PremiumAdSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, unique: true },
    content: {
        text: String,
        caption: String,
        entities: Array,
        caption_entities: Array,
        photo: Array,
        sticker: Object,
        video: Object
    },
    usersList: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PremiumAd', PremiumAdSchema);
