import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['earn', 'spend'],
        required: true
    },
    description: {
        type: String, // e.g., "Report #1005 Verified", "Redeemed Amazon Voucher"
        required: true
    },
    referenceId: { // Optional: Link to Report ID or Reward ID
        type: String
    },
    date: {
        type: Date,
        default: Date.now,
        index: -1 // Sort by newest first by default
    }
}, {
    timestamps: true // Adds createdAt, updatedAt
});

export default mongoose.model('Transaction', transactionSchema);
