const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
    channelId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    url: {
        type: String,
        required: true
    }
}, {
    collection: 'channels',
    timestamps: false
});

module.exports = mongoose.model('ChannelMongo', channelSchema);
