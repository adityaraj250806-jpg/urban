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

// Password comparison
workerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('Worker', workerSchema);
