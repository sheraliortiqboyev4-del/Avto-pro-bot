const mongoose = require('mongoose'); 

const UserSchema = new mongoose.Schema({ 
    chatId: { type: Number, required: true, unique: true }, 
    name: String, 
    username: String, 
    status: { type: String, default: 'pending' }, // approved, blocked, pending 
    subscriptionType: { type: String, default: 'free' }, // monthly, vip, free, expired
    session: { type: String, default: null }, 
    reydAccounts: [{
        session: String,
        phoneNumber: String,
        addedAt: { type: Date, default: Date.now }
    }],
    reklamaAccounts: [{
        session: String,
        phoneNumber: String,
        addedAt: { type: Date, default: Date.now }
    }],
    expireAt: { type: Date, default: null }, 
    avtoAlmaz: { type: Boolean, default: true }, 
    expiryWarningSent: { type: Boolean, default: false }, 
    clicks: { type: Number, default: 0 }, // Almazlar soni
    reydCount: { type: Number, default: 0 }, 
    usersGathered: { type: Number, default: 0 }, 
    adsCount: { type: Number, default: 0 }, // Reklamalar soni
    utagCount: { type: Number, default: 0 },
    utagHistory: [{
        title: String,
        link: String,
        addedAt: { type: Date, default: Date.now }
    }],
    joinedAt: { type: Date, default: Date.now } 
}); 

module.exports = mongoose.model('User', UserSchema);
