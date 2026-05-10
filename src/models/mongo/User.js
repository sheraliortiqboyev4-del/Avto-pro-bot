const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    chatId: {
        type: Number,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        default: null
    },
    username: {
        type: String,
        default: null
    },
    status: {
        type: String,
        default: 'pending'
    },
    subscriptionType: {
        type: String,
        default: 'free'
    },
    session: {
        type: String,
        default: null
    },
    reydAccounts: {
        type: Array,
        default: []
    },
    reklamaAccounts: {
        type: Array,
        default: []
    },
    expireAt: {
        type: Date,
        default: null
    },
    avtoAlmaz: {
        type: Boolean,
        default: true
    },
    expiryWarningSent: {
        type: Boolean,
        default: false
    },
    clicks: {
        type: Number,
        default: 0
    },
    reydCount: {
        type: Number,
        default: 0
    },
    usersGathered: {
        type: Number,
        default: 0
    },
    adsCount: {
        type: Number,
        default: 0
    },
    utagCount: {
        type: Number,
        default: 0
    },
    utagAccountMode: {
        type: String,
        default: null
    },
    utagHistory: {
        type: Array,
        default: []
    },
    joinedAt: {
        type: Date,
        default: Date.now
    }
}, {
    collection: 'users',
    timestamps: false
});

module.exports = mongoose.model('UserMongo', userSchema);
