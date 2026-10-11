import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const workerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  mobile: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    sparse: true
  },
  password: {
    type: String,
    required: true
  },
  aadhaar: String,
  address: String,
  photo: String,
  idProof: String,
  assignedZone: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  appliedDate: {
    type: Date,
    default: Date.now
  },
  approvedDate: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  totalReportsCompleted: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Password hashing
workerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Password comparison with self-healing & demo fallback
workerSchema.methods.comparePassword = async function(candidatePassword) {
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

    // 3. Demo worker fallback (9999999991 - 9999999995)
    if (/^999999999[1-5]$/.test(this.mobile) && candidatePassword === 'Worker@123') {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Worker password compare error:', error);
    return false;
  }
};

export default mongoose.model('Worker', workerSchema);
