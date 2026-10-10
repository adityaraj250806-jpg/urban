import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const adminSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  phone: String,
  role: {
    type: String,
    enum: ['superadmin', 'super_admin', 'zone_officer', 'zoneofficer', 'admin'],
    required: true
  },
  department: String,
  assignedZones: [String],  // For zone officers
  isActive: {
    type: Boolean,
    default: true
  },
  permissions: {
    canApproveWorkers: { type: Boolean, default: false },
    canAssignWork: { type: Boolean, default: false },
    canViewReports: { type: Boolean, default: true },
    canManageOfficers: { type: Boolean, default: false }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ⭐⭐⭐ CRITICAL: Hash password before saving ⭐⭐⭐
adminSchema.pre('save', async function(next) {
  // Only hash if password is new or modified
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    console.log(`✅ Password hashed for: ${this.email}`);
    next();
  } catch (error) {
    console.error('❌ Password hashing error:', error);
    next(error);
  }
});

// ⭐⭐⭐ CRITICAL: Compare password method ⭐⭐⭐
adminSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    const isMatch = await bcrypt.compare(candidatePassword, this.password);
    console.log(`🔐 Password check for ${this.email}: ${isMatch ? '✅ MATCH' : '❌ NO MATCH'}`);
    return isMatch;
  } catch (error) {
    console.error('❌ Password comparison error:', error);
    return false;
  }
};

export default mongoose.model('Admin', adminSchema);
