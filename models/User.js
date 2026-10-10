import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  // NEW: Streak fields
  currentStreak: {
    type: Number,
    default: 0
  },
  lastReportDate: {
    type: Date,
    default: null
  },
  longestStreak: {
    type: Number,
    default: 0
  },
  // Original fields
  profilePic: {
    type: String,
    default: null
  },
  credits: {
    type: Number,
    default: 0
  },
  lifetimeCredits: {
    type: Number,
    default: 0
  },
  reportsCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);
