const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
    channelId: {
        type: String,
        required: true,
        unique: true
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
    collection: 'channels'
});

module.exports = mongoose.model('Channel', channelSchema);
