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

// Compare password method with self-healing & demo citizen fallback
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    if (!candidatePassword) return false;

    // 1. Standard bcrypt compare
    if (this.password && (this.password.startsWith('$2a$') || this.password.startsWith('$2b$') || this.password.startsWith('$2y$'))) {
      const isMatch = await bcrypt.compare(candidatePassword, this.password);
      if (isMatch) return true;
    }

    // 2. Direct plain-text match
    if (this.password === candidatePassword) {
      try {
        this.password = candidatePassword;
        await this.save();
      } catch (err) {}
      return true;
    }

    // 3. Demo citizen fallback (demo@bokaro.gov.in)
    const cleanEmail = (this.email || '').toLowerCase().trim();
    if (cleanEmail === 'demo@bokaro.gov.in' && candidatePassword === 'Password@123') {
      return true;
    }

    return false;
  } catch (error) {
    console.error('User password compare error:', error);
    return false;
  }
};

export default mongoose.model('User', userSchema);
