import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  type: String,
  amount: Number,
  description: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const creditSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  totalCredits: {
    type: Number,
    default: 0
  },
  availableCredits: {
    type: Number,
    default: 0
  },
  badges: [{
    key: String,
    name: String,
    icon: String,
    earnedAt: Date
  }],
  transactions: [transactionSchema],
  reportCount: {
    type: Number,
    default: 0
  },
  reportsVerified: {
    type: Number,
    default: 0
  }
});

export default mongoose.model('Credit', creditSchema);
