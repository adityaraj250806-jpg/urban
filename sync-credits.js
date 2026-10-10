import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({}, { strict: false });
const Report = mongoose.model('Report', reportSchema);

const creditSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  totalCredits: { type: Number, default: 0 },
  availableCredits: { type: Number, default: 0 },
  reportsVerified: { type: Number, default: 0 },
  badges: [{ type: String }],
  transactions: [{
    type: { type: String, enum: ['earn', 'redeem'] },
    amount: Number,
    description: String,
    timestamp: { type: Date, default: Date.now }
  }]
});
const Credit = mongoose.model('Credit', creditSchema);

const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', userSchema);

const BADGE_CRITERIA = [
  { key: 'first_report', threshold: 1, field: 'reportCount' },
  { key: 'eco_warrior', threshold: 10, field: 'reportCount' },
  { key: 'green_champion', threshold: 50, field: 'reportCount' }
];

async function syncCredits() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const users = await User.find({});
  for (const user of users) {
    const reports = await Report.find({ userId: user._id, status: { $in: ['resolved', 'verified'] } });
    
    let totalCredits = reports.length * 10; // base credits for now
    
    let creditDoc = await Credit.findOne({ userId: user._id });
    if (!creditDoc) {
      creditDoc = new Credit({ userId: user._id });
    }
    
    creditDoc.totalCredits = totalCredits;
    creditDoc.availableCredits = totalCredits;
    creditDoc.reportsVerified = reports.length;
    
    // Add simple badge logic
    const newBadges = BADGE_CRITERIA.filter(b => creditDoc.reportsVerified >= b.threshold).map(b => b.key);
    creditDoc.badges = newBadges;
    
    await creditDoc.save();
    
    user.credits = totalCredits;
    await user.save();
    
    console.log(`Synced user ${user.email || user._id}: ${totalCredits} credits, ${reports.length} reports`);
  }

  console.log('Credit sync complete');
  mongoose.disconnect();
}

syncCredits();
