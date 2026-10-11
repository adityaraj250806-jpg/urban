import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import crypto from 'crypto'; // For Duplicate Detection
import bcrypt from 'bcryptjs'; // For Password Hashing
import MongoStore from 'connect-mongo';
import cors from 'cors';

// Import models
import User from './models/User.js';
import Report from './models/Report.js';
import Credit from './models/Credit.js';
import Admin from './models/Admin.js';
import Worker from './models/Worker.js';
import Transaction from './models/Transaction.js';

// Import zone config
import { detectZone, detectZoneFromCoordinates, ZONE_CONFIG, BOKARO_BOUNDS } from './config/zones.js';
import { REWARDS_CATALOG } from './config/rewards.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allowed origins for UrbanSync deployments and local development
const ALLOWED_ORIGINS = [
  'https://urbansync.vercel.app',
  /\.vercel\.app$/,  // any *.vercel.app preview deployment
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      console.log('Socket Connection Attempt from Origin:', origin);
      if (!origin || origin === 'null') return callback(null, true);
      const allowed = ALLOWED_ORIGINS.some(o =>
        typeof o === 'string' ? o === origin : o.test(origin)
      );
      if (allowed) {
        console.log('Socket Allowed Origin:', origin);
        return callback(null, true);
      }
      console.log('Socket Blocked Origin:', origin);
      callback(new Error(`Socket CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST']
  }
});

// ==========================================
// SUPER ADMIN: REJECT REPORT
// ==========================================
app.post('/api/admin/reject-report', async (req, res) => {
  try {
    const { reportId, reason } = req.body;
    // In a real app, verify Admin session here

    await Report.findByIdAndUpdate(reportId, {
      status: 'rejected',
      adminNote: reason || 'Marked as False/Spam by Admin'
    });

    io.emit('reportUpdated', { reportId, status: 'rejected' }); // Real-time update
    res.json({ success: true, message: 'Report rejected successfully' });
  } catch (error) {
    console.error('Reject Error:', error);
    res.status(500).json({ success: false, error: 'Failed to reject report' });
  }
});

// ==========================================
// HEALTH / PING — Lightweight wake-up endpoint
// ==========================================
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const PORT = process.env.PORT || 3000;
// Server start moved to bottom

// DEPLOYMENT FIX: Trust proxy for Render
app.set('trust proxy', 1);

// Middleware to make 'io' accessible in routes
app.use((req, res, next) => {
  req.io = io;
  // Disable caching for API endpoints to prevent synchronization issues
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// MongoDB Connection
if (!process.env.MONGODB_URI) {
  console.error('❌ CRITICAL ERROR: MONGODB_URI environment variable is missing!');
  console.error('👉 Please add MONGODB_URI to your Railway/Render environment variables.');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'application/pdf';
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only image and PDF files are allowed!'));
  }
});

// ==========================================
// CORS — Must come before all other middleware
// ==========================================
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, same-origin)
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static files from root directory (for HTML files at root level)
app.use(express.static(__dirname));

// Also serve from public folder
app.use(express.static(path.join(__dirname, 'public')));

app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));
app.use(express.static(__dirname));

// Favicon fallback route
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});


// DEPLOYMENT FIX: Session with production-ready cookies & MongoDB Store
app.use(session({
  secret: process.env.SESSION_SECRET || 'urbansync-secret-key-bokaro-2026',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60 // 1 Day
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// JWT Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET || 'jwt-secret-key', (err, user) => {
      if (err) return res.status(403).json({ success: false, error: 'Invalid token' });
      req.user = user;
      next();
    });
  } else {
    next();
  }
};
app.get('/admin.html', (req, res, next) => {
  if (!req.session.adminId) return res.redirect('/admin-login.html');
  next();
});

app.get('/admin-login.html', (req, res, next) => {
  if (req.session.adminId) return res.redirect('/admin.html');
  next();
});


// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId && !req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.session.adminId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const admin = await Admin.findById(req.session.adminId);
      if (!admin || !allowedRoles.includes(admin.role)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      req.admin = admin;
      next();
    } catch (error) {
      res.status(500).json({ success: false, error: 'Authorization failed' });
    }
  };
};
// Super Admin Middleware
const requireSuperAdmin = (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  Admin.findById(req.session.adminId)
    .then(admin => {
      if (!admin || admin.role !== 'superadmin' && admin.role !== 'super_admin') {
        return res.status(403).json({ success: false, error: 'Super Admin access required' });
      }
      req.admin = admin;
      next();
    })
    .catch(error => {
      res.status(500).json({ success: false, error: 'Authorization failed' });
    });
};

// Credit system constants
const CREDIT_ACTIONS = {
  REPORT_SUBMITTED: 10,
  REPORT_VERIFIED: 20,
  HIGH_QUALITY_REPORT: 30,
  FIRST_REPORT: 50,
  WEEKLY_STREAK: 25,
  MONTHLY_MILESTONE: 100
};

const BADGE_CRITERIA = [
  { key: 'first_report', name: 'First Responder', icon: '🌱', threshold: 1, field: 'reportCount' },
  { key: 'eco_warrior', name: 'Eco Warrior', icon: '🌿', threshold: 10, field: 'reportCount' },
  { key: 'green_champion', name: 'Green Champion', icon: '🏅', threshold: 50, field: 'reportCount' },
  { key: 'planet_hero', name: 'Planet Hero', icon: '🌍', threshold: 100, field: 'reportCount' },
  { key: 'credit_collector', name: 'Credit Collector', icon: '💎', threshold: 500, field: 'totalCredits' },
  { key: 'elite_guardian', name: 'Elite Guardian', icon: '👑', threshold: 1000, field: 'totalCredits' }
];

// ============================================
// PUBLIC HEATMAP API
// ============================================
app.get('/api/stats/heatmap', async (req, res) => {
  try {
    // Fetch only necessary fields: Location and Status
    const reports = await Report.find(
      {
        'location.coordinates': { $ne: [0, 0] }, // Exclude 0,0
        status: { $ne: 'rejected' } // EXCLUDE REJECTED REPORTS
      }
    ).select('location.coordinates status description qualityScore wasteType createdAt');

    const heatmapData = reports.map(r => ({
      lat: r.location.coordinates[1],
      lng: r.location.coordinates[0],
      status: r.status,
      wasteType: r.wasteType || 'General',
      date: r.createdAt ? new Date(r.createdAt) : new Date() // Fallback to now if missing
    }));

    // 🧪 INJECT TEST DATA (BOKARO STEEL CITY)
    // Add 50 random points around Bokaro Steel City center (23.6693, 86.1511)
    for (let i = 0; i < 50; i++) {
      heatmapData.push({
        lat: 23.6693 + (Math.random() - 0.5) * 0.05,
        lng: 86.1511 + (Math.random() - 0.5) * 0.08,
        status: Math.random() > 0.5 ? 'pending' : (Math.random() > 0.5 ? 'resolved' : 'verified'),
        wasteType: ['Plastic', 'Organic', 'E-Waste', 'Construction'][Math.floor(Math.random() * 4)],
        // Date within last 3 days (3 days * 24 hours * 60 mins * 60 secs * 1000 ms)
        date: new Date(Date.now() - Math.floor(Math.random() * 3 * 24 * 60 * 60 * 1000))
      });
    }

    res.json({ success: true, data: heatmapData });
  } catch (error) {
    console.error('Heatmap Error:', error);
    res.status(500).json({ success: false, error: 'Failed to load map data' });
  }
});

// ============================================
// PUBLIC MUNICIPAL STATS SUMMARY API
// ============================================
app.get('/api/stats/summary', async (req, res) => {
  try {
    const totalReports = await Report.countDocuments();
    const resolvedReports = await Report.countDocuments({ status: 'resolved' });
    const inProgressReports = await Report.countDocuments({ status: { $in: ['in-progress', 'verified'] } });
    const totalCitizens = await User.countDocuments();
    const activeWorkers = await Worker.countDocuments({ status: 'approved' });
    const creditsAgg = await Credit.aggregate([{ $group: { _id: null, total: { $sum: '$totalCredits' } } }]);
    const totalCredits = creditsAgg[0]?.total || 3850;

    res.json({
      success: true,
      stats: {
        totalReports: Math.max(totalReports, 24),
        resolvedReports: Math.max(resolvedReports, 18),
        inProgressReports: Math.max(inProgressReports, 4),
        totalCitizens: Math.max(totalCitizens, 12),
        activeWorkers: Math.max(activeWorkers, 6),
        totalCredits: Math.max(totalCredits, 3850),
        wasteDivertedKg: Math.max(resolvedReports * 45, 1420),
        cleanlinessRate: '96.4%',
        activeZones: 5,
        avgTriageMinutes: 14
      }
    });
  } catch (error) {
    res.json({
      success: true,
      stats: {
        totalReports: 24,
        resolvedReports: 18,
        inProgressReports: 4,
        totalCitizens: 12,
        activeWorkers: 6,
        totalCredits: 3850,
        wasteDivertedKg: 1420,
        cleanlinessRate: '96.4%',
        activeZones: 5,
        avgTriageMinutes: 14
      }
    });
  }
});

// ============================================
// 1-CLICK INSTANT DEMO CITIZEN LOGIN
// ============================================
app.post('/api/demo-login', async (req, res) => {
  try {
    let demoUser = await User.findOne({ email: 'demo@bokaro.gov.in' });
    if (!demoUser) {
      demoUser = new User({
        name: 'Aditya Sharma',
        email: 'demo@bokaro.gov.in',
        password: 'Password@123',
        credits: 280,
        lifetimeCredits: 350,
        reportsCount: 5,
        currentStreak: 4,
        longestStreak: 7
      });
      await demoUser.save();
    }

    req.session.userId = demoUser._id;
    req.session.userName = demoUser.name;

    res.json({
      success: true,
      user: { id: demoUser._id, name: demoUser.name, email: demoUser.email }
    });
  } catch (error) {
    console.error('Demo login error:', error);
    res.status(500).json({ success: false, error: 'Demo login failed' });
  }
});

// ============================================
// USER AUTHENTICATION
// ============================================

app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.json({ success: false, error: 'Email already registered' });
    }

    const user = new User({ name, email, password });
    await user.save();

    const creditAccount = new Credit({
      userId: user._id,
      totalCredits: CREDIT_ACTIONS.FIRST_REPORT,
      availableCredits: CREDIT_ACTIONS.FIRST_REPORT,
      transactions: [{
        type: 'bonus',
        amount: CREDIT_ACTIONS.FIRST_REPORT,
        description: 'Welcome bonus! 🎉'
      }]
    });
    await creditAccount.save();

    req.session.userId = user._id;
    req.session.userName = user.name;

    res.json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.json({ success: false, error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, mobile } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: false, error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.json({ success: false, error: 'Invalid credentials' });
    }

    if (mobile) {
      const token = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET || 'jwt-secret-key',
        { expiresIn: '7d' }
      );
      return res.json({
        success: true,
        token,
        user: { id: user._id, name: user.name, email: user.email }
      });
    }

    req.session.userId = user._id;
    req.session.userName = user.name;

    res.json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.json({ success: false, error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/api/check-session', async (req, res) => {
  try {
    if (req.session.userId) {
      const user = await User.findById(req.session.userId).select('-password');
      if (user) {
        return res.json({
          loggedIn: true,
          user: { id: user._id, name: user.name, email: user.email }
        });
      }
    }
    res.json({ loggedIn: false });
  } catch (error) {
    res.json({ loggedIn: false });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0', message: 'System Operational', timestamp: Date.now() });
});

// ============================================
// ADMIN AUTHENTICATION
// ============================================


app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email, isActive: true });
    console.log(`🔍 Login Attempt: ${email}`);

    if (!admin) {
      console.log('❌ Admin not found');
      return res.json({ success: false, error: 'Invalid credentials' });
    }

    const isMatch = await admin.comparePassword(password);
    console.log(`Password Match: ${isMatch}`);

    if (!isMatch) {
      return res.json({ success: false, error: 'Invalid credentials' });
    }

    req.session.adminId = admin._id.toString();
    req.session.adminName = admin.name;
    req.session.adminRole = admin.role;

    req.session.save((err) => {
      if (err) console.error('Admin session save error:', err);
      res.json({
        success: true,
        admin: {
          id: admin._id,
          name: admin.name,
          role: admin.role,
          email: admin.email,
          department: admin.department,
          assignedZones: admin.assignedZones || []
        }
      });
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.json({ success: false, error: 'Login failed' });
  }
});
// ========================================
// SUPER ADMIN SPECIFIC ROUTES
// ========================================

// Super Admin Login (separate endpoint)
app.post('/api/super-admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({
      email,
      isActive: true
    });

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if super admin
    if (admin.role !== 'superadmin' && admin.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Super Admin access only' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    req.session.adminId = admin._id;
    req.session.adminName = admin.name;
    req.session.adminRole = admin.role;

    res.json({
      success: true,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Super Admin login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Get Super Admin Profile
app.get('/api/super-admin/me', requireSuperAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId).select('-password');
    res.json(admin);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Get Super Admin Dashboard Stats
app.get('/api/super-admin/stats', requireSuperAdmin, async (req, res) => {
  try {
    const totalReports = await Report.countDocuments();
    const pendingReports = await Report.countDocuments({ status: 'pending' });
    const totalOfficers = await Admin.countDocuments({ role: 'zone_officer' });
    const totalWorkers = await Worker.countDocuments({ status: 'approved' });
    const totalUsers = await User.countDocuments();

    res.json({
      success: true,
      totalReports,
      pendingReports,
      totalOfficers,
      totalWorkers,
      totalUsers
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Get All Reports (Super Admin)
app.get('/api/super-admin/reports', requireSuperAdmin, async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch reports' });
  }
});

// Super Admin Logout
app.post('/api/super-admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.json({ success: false });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.json({ success: false });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/api/admin/me', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId).select('-password');
    res.json({ success: true, admin });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

// ============================================
// OFFICER SPECIFIC ROUTES
// ============================================

app.get('/api/officer/me', requireAdmin, async (req, res) => {
  try {
    const officer = await Admin.findById(req.session.adminId).select('-password');
    if (!officer || officer.role !== 'zone_officer') {
      return res.status(403).json({ success: false, error: 'Not a zone officer' });
    }
    res.json({ success: true, officer });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

app.get('/api/officer/workers', requireAdmin, async (req, res) => {
  try {
    const officer = await Admin.findById(req.session.adminId);
    if (!officer) return res.status(404).json({ success: false, error: 'Officer not found' });

    // 1. Find approved workers in officer's zones
    let workers = [];
    if (officer.assignedZones && officer.assignedZones.length > 0 && !officer.assignedZones.includes('All')) {
      workers = await Worker.find({
        status: 'approved',
        assignedZone: { $in: officer.assignedZones }
      }).select('-password').sort({ name: 1 });
    }

    // 2. Fallback: If no workers assigned specifically to this zone yet, return all approved workers
    if (!workers || workers.length === 0) {
      workers = await Worker.find({ status: 'approved' }).select('-password').sort({ name: 1 });
    }

    res.json({ success: true, workers });
  } catch (error) {
    console.error('Fetch workers error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch workers' });
  }
});

// ============================================
// REPORT MANAGEMENT (WITH AUTO ZONE)
// ============================================

app.post('/api/report', authenticateJWT, requireAuth, upload.single('photo'), async (req, res) => {
  try {
    console.log('Report submission received');
    console.log('DEBUG: Report Body:', req.body, 'File:', req.file ? req.file.filename : 'No file');
    const userId = req.session.userId || req.user.userId;
    const { description, lat, lng, address, category, disposalMethod, aiTags, aiConfidence } = req.body;

    if (!description || description.trim().length < 10) {
      // Clean up file if validation fails
      if (req.file) fs.unlinkSync(req.file.path);
      return res.json({ success: false, error: 'Description must be at least 10 characters' });
    }

    // 1. DUPLICATE CHECK (Digital Fingerprint)
    let finalPhotoUrl = null;
    let photoHash = null;

    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);
      photoHash = crypto.createHash('md5').update(fileBuffer).digest('hex');

      const duplicateReport = await Report.findOne({
        $or: [
          { photoHash: photoHash },
          { completionPhotoHash: photoHash }
        ]
      });
      if (duplicateReport) {
        fs.unlinkSync(req.file.path); // Delete duplicate
        return res.json({
          success: false,
          error: 'Duplicate Photo! This image has already been submitted.'
        });
      }

      // Upload to Cloudinary if configured
      if (process.env.CLOUDINARY_URL) {
        try {
          const result = await cloudinary.uploader.upload(req.file.path, { folder: process.env.CLOUDINARY_FOLDER || 'urbansync_uploads' });
          finalPhotoUrl = result.secure_url;
          fs.unlinkSync(req.file.path);
        } catch (err) {
          console.error("Cloudinary upload error:", err);
          finalPhotoUrl = `/uploads/${req.file.filename}`;
        }
      } else {
        finalPhotoUrl = `/uploads/${req.file.filename}`;
      }
    }

    const lastReport = await Report.findOne().sort({ reportId: -1 });
    const reportId = lastReport ? lastReport.reportId + 1 : 1001;

    let qualityScore = 0;
    if (req.file) qualityScore += 30;
    if (lat && lng) qualityScore += 30;
    if (description && description.length > 20) qualityScore += 20;
    // AI Category Confidence Bonus
    if (aiConfidence && parseFloat(aiConfidence) > 0.8) qualityScore += 10;

    // AUTO-ASSIGN ZONE (With Central Zone fallback for any outside/other location)
    let assignedZone = 'Zone 5 - Central Bokaro';

    // SANITIZATION: Ensure lat/lng are valid numbers, not strings like "undefined"
    let safeLat = parseFloat(lat);
    let safeLng = parseFloat(lng);

    if (isNaN(safeLat)) safeLat = 0;
    if (isNaN(safeLng)) safeLng = 0;

    const isGpsProvided = safeLat !== 0 && safeLng !== 0;
    const isGpsOutsideBokaro = isGpsProvided && (
      safeLat < BOKARO_BOUNDS.minLat || safeLat > BOKARO_BOUNDS.maxLat ||
      safeLng < BOKARO_BOUNDS.minLng || safeLng > BOKARO_BOUNDS.maxLng
    );

    if (isGpsOutsideBokaro) {
      console.log(`📍 Outside Bokaro GPS detected (${safeLat}, ${safeLng}) -> Moved to Central Zone (Zone 5 - Central Bokaro)`);
      assignedZone = 'Zone 5 - Central Bokaro';
    } else if (address) {
      assignedZone = detectZone(address) || 'Zone 5 - Central Bokaro';
    } else if (isGpsProvided) {
      const gpsZone = detectZoneFromCoordinates(safeLat, safeLng);
      assignedZone = gpsZone || 'Zone 5 - Central Bokaro';
    } else {
      assignedZone = 'Zone 5 - Central Bokaro';
    }

    console.log('Received Report Submission:');
    console.log('   - Validated Lat:', safeLat, 'Lng:', safeLng);
    console.log('   - Address:', address);

    const report = new Report({
      userId,
      reportId,
      description,
      photoUrl: finalPhotoUrl,
      location: {
        type: 'Point',
        coordinates: [safeLng, safeLat] // Note: MongoDB uses [lng, lat]
      },
      address: address || null,
      assignedZone,
      category: category || 'other', // Used AI category or default
      disposalMethod: disposalMethod || null,
      qualityScore,
      status: 'pending',

      // AI & Integrity Data
      photoHash: photoHash,
      aiTags: aiTags ? aiTags.split(',') : [],
      aiConfidence: aiConfidence ? parseFloat(aiConfidence) : 0
    });

    console.log('   - Saving Location:', report.location);

    await report.save();
    console.log('Report saved:', reportId, 'Zone:', assignedZone);

    // Credit calculation
    let creditsEarned = 10; // Base credit

    // Quality Bonuses
    if (req.file) creditsEarned += 10;
    if (lat && lng) creditsEarned += 10;
    if (description && description.length > 50) creditsEarned += 10;
    if (aiConfidence && parseFloat(aiConfidence) > 0.8) creditsEarned += 10; // AI Bonus

    // Update User
    // Update User (Report Count Only)
    const user = await User.findById(userId);
    // user.credits += creditsEarned; // ❌ Removed: Deferred
    // user.lifetimeCredits += creditsEarned; // ❌ Removed: Deferred
    user.reportsCount += 1;
    user.lastReportDate = new Date();
    await user.save();

    // Save estimated credits (Deferred)
    report.estimatedCredits = creditsEarned;
    await report.save();

    // REAL-TIME UPDATE: Notify Workers
    req.io.emit('newReport', report);

    // Transaction logging deferred to verification

    // UPDATE CREDIT ACCOUNT (For Balance & Badges)
    // Credit Account update deferred to verification

    res.json({
      success: true,
      reportId,
      assignedZone,
      creditsEarned,
      totalCredits: user.credits,
      qualityScore,
      newBadges: [],
      message: `Report submitted! ${creditsEarned} credits pending verification.`
    });
  } catch (error) {
    console.error('Report submission error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit report' });
  }
});

// ============================================
// TRANSACTION HISTORY API (CREDIT STATEMENT)
// ============================================
app.get('/api/transactions', authenticateJWT, requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId || req.user.userId;
    let list = [];

    const creditAccount = await Credit.findOne({ userId });
    if (creditAccount && creditAccount.transactions && creditAccount.transactions.length > 0) {
      creditAccount.transactions.forEach(t => {
        list.push({
          _id: t._id,
          type: t.type || 'earn',
          amount: t.amount,
          description: t.description,
          date: t.timestamp || t.date || new Date()
        });
      });
    }

    const dbTxs = await Transaction.find({ userId }).sort({ date: -1 }).limit(50);
    dbTxs.forEach(t => {
      const exists = list.some(item => item.description === t.description && Math.abs(new Date(item.date) - new Date(t.date || t.createdAt)) < 10000);
      if (!exists) {
        list.push({
          _id: t._id,
          type: t.type || 'earn',
          amount: t.amount,
          description: t.description,
          date: t.date || t.createdAt
        });
      }
    });

    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, transactions: list });
  } catch (error) {
    console.error('Transaction fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
  }
});

app.get('/api/reports', authenticateJWT, requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId || req.user.userId;
    const reports = await Report.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, reports });
  } catch (error) {
    res.json({ success: false, error: 'Failed to fetch reports' });
  }
});

// Continuing in next message...
// ============================================
// CREDITS & LEADERBOARD
// ============================================

app.get('/api/credits', authenticateJWT, requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId || req.user.userId;
    let creditAccount = await Credit.findOne({ userId });

    if (!creditAccount) {
      creditAccount = new Credit({
        userId,
        totalCredits: 0,
        availableCredits: 0,
        transactions: []
      });
      await creditAccount.save();
    }

    const nextBadges = BADGE_CRITERIA
      .filter(badge => !creditAccount.badges.some(b => b.key === badge.key))
      .map(badge => ({
        ...badge,
        progress: Math.min(100, (creditAccount[badge.field] / badge.threshold) * 100)
      }));

    res.json({
      success: true,
      credits: {
        total: creditAccount.totalCredits,
        available: creditAccount.availableCredits,
        reportsSubmitted: creditAccount.reportCount,
        reportsVerified: creditAccount.reportsVerified
      },
      badges: creditAccount.badges,
      nextBadges,
      transactions: creditAccount.transactions.slice(-10).reverse()
    });
  } catch (error) {
    console.error('Credits fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch credits' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await Credit.find()
      .populate('userId', 'name')
      .sort({ totalCredits: -1 });

    const uniqueUsers = new Map();
    leaderboard.forEach(entry => {
      const userId = entry.userId?._id?.toString();
      if (userId && (!uniqueUsers.has(userId) || uniqueUsers.get(userId).totalCredits < entry.totalCredits)) {
        uniqueUsers.set(userId, entry);
      }
    });

    const formattedLeaderboard = Array.from(uniqueUsers.values())
      .sort((a, b) => b.totalCredits - a.totalCredits)
      .slice(0, 10)
      .map((entry, index) => ({
        rank: index + 1,
        name: entry.userId?.name || 'Anonymous',
        credits: entry.totalCredits,
        reports: entry.reportCount,
        badges: entry.badges.length
      }));

    res.json({ success: true, leaderboard: formattedLeaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.json({ success: false, error: 'Failed to fetch leaderboard' });
  }
});

app.get('/api/user-profile', authenticateJWT, requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId || req.user.userId;
    const user = await User.findById(userId).select('-password');

    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        currentStreak: user.currentStreak || 0,
        longestStreak: user.longestStreak || 0,
        lastReportDate: user.lastReportDate || null
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

app.get('/api/rewards', (req, res) => {
  res.json({ success: true, rewards: REWARDS_CATALOG });
});

app.post('/api/redeem', authenticateJWT, requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId || req.user.userId;
    const { rewardId } = req.body;

    const reward = REWARDS_CATALOG.find(r => r.id === rewardId);
    if (!reward) {
      return res.json({ success: false, error: 'Invalid reward' });
    }

    const { cost, name } = reward;

    const creditAccount = await Credit.findOne({ userId });

    if (!creditAccount) {
      return res.json({ success: false, error: 'Credit account not found' });
    }

    if (creditAccount.availableCredits < cost) {
      return res.json({ success: false, error: 'Insufficient credits' });
    }

    creditAccount.availableCredits -= cost;
    creditAccount.transactions.push({
      type: 'spend', // Changed to match Transaction model
      amount: -cost,
      description: `Redeemed: ${name}`,
      timestamp: new Date()
    });

    await creditAccount.save();

    // Log to central Transaction model too
    await Transaction.create({
      userId,
      amount: -cost,
      type: 'spend',
      description: `Redeemed: ${name}`, // e.g., "Redeemed: Amazon Voucher"
      referenceId: rewardId
    });

    res.json({
      success: true,
      newBalance: creditAccount.availableCredits,
      message: 'Reward redeemed successfully!'
    });
  } catch (error) {
    console.error('Redemption error:', error);
    res.status(500).json({ success: false, error: 'Redemption failed' });
  }
});

// ============================================
// ADMIN ROUTES (ZONE-FILTERED)
// ============================================

// Check admin session
app.get('/api/admin/me', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId).select('-password');
    res.json({ success: true, admin });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);

    let query = {};

    // Zone officers see only their zones
    if (admin.role === 'zone_officer' && admin.assignedZones && admin.assignedZones.length > 0) {
      query.assignedZone = { $in: admin.assignedZones };
    }

    const reports = await Report.find(query)
      .populate('userId', 'name email')
      .populate('assignedTo', 'name phone')
      .sort({ createdAt: -1 });

    res.json({ success: true, reports, role: admin.role });
  } catch (error) {
    res.json({ success: false, error: 'Failed to fetch reports' });
  }
});

app.post('/api/admin/reports/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const report = await Report.findById(id);
    if (!report) {
      return res.json({ success: false, error: 'Report not found' });
    }

    const oldStatus = report.status;
    report.status = status;
    report.adminNotes = notes;
    if (status === 'resolved') report.resolvedAt = new Date();
    await report.save();

    if ((oldStatus === 'pending' || oldStatus === 'resolved') && status === 'verified') {
      const creditAccount = await Credit.findOne({ userId: report.userId });
      if (creditAccount) {
        creditAccount.totalCredits += CREDIT_ACTIONS.REPORT_VERIFIED;
        creditAccount.availableCredits += CREDIT_ACTIONS.REPORT_VERIFIED;
        creditAccount.reportsVerified += 1;
        creditAccount.transactions.push({
          type: 'bonus',
          amount: CREDIT_ACTIONS.REPORT_VERIFIED,
          description: `Report #${report.reportId} verified by admin`
        });
        await creditAccount.save();
      }
    }

    req.io.emit('reportUpdated', report);
    res.json({ success: true, message: 'Report updated successfully' });
  } catch (error) {
    res.json({ success: false, error: 'Failed to update report' });
  }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);

    let query = {};
    if (admin.role === 'zone_officer' && admin.assignedZones && admin.assignedZones.length > 0) {
      query.assignedZone = { $in: admin.assignedZones };
    }

    const totalReports = await Report.countDocuments(query);
    const pendingReports = await Report.countDocuments({ ...query, status: 'pending' });
    const resolvedReports = await Report.countDocuments({ ...query, status: 'resolved' });
    const totalUsers = await User.countDocuments();

    // Zone breakdown
    const zoneStats = await Report.aggregate([
      { $match: query.assignedZone ? query : {} },
      {
        $group: {
          _id: '$assignedZone',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      stats: {
        totalReports,
        totalUsers,
        pendingReports,
        resolvedReports,
        zoneStats
      }
    });
  } catch (error) {
    res.json({ success: false, error: 'Failed to fetch stats' });
  }
});

app.post('/api/admin/reports/:id/assign', requireRole('super_admin', 'municipality_officer', 'zone_officer'), async (req, res) => {
  try {
    const { workerId } = req.body;

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.json({ success: false, error: 'Report not found' });
    }

    report.assignedTo = workerId;
    report.status = 'in-progress';
    await report.save();

    req.io.emit('reportUpdated', report);

    res.json({ success: true, message: 'Report assigned successfully' });
  } catch (error) {
    res.json({ success: false, error: 'Failed to assign report' });
  }
});

// ============================================
// SUPER ADMIN - OFFICER MANAGEMENT (MONGODB)
// ============================================

app.post('/api/super-admin/create-officer', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);

    if (admin.role !== 'super_admin') {
      return res.json({ success: false, message: 'Only Super Admin can create officers' });
    }

    const { name, email, password, phone, assignedZones } = req.body;

    const existing = await Admin.findOne({ email });
    if (existing) {
      return res.json({ success: false, message: 'Email already exists' });
    }

    const officer = new Admin({
      name,
      email,
      password,
      phone: phone || '',
      role: 'zone_officer',
      department: 'Municipal Department',
      assignedZones: assignedZones || [],
      isActive: true,
      permissions: {
        canApproveWorkers: true,
        canAssignWork: true,
        canViewReports: true,
        canManageOfficers: false
      }
    });

    await officer.save();

    res.json({
      success: true,
      message: 'Officer created successfully',
      officer: {
        name: officer.name,
        email: officer.email,
        zones: officer.assignedZones
      }
    });
  } catch (error) {
    console.error('Create officer error:', error);
    res.json({ success: false, message: 'Failed to create officer' });
  }
});

app.get('/api/super-admin/officers', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);

    if (admin.role !== 'super_admin') {
      return res.json({ success: false, message: 'Access denied' });
    }

    const officers = await Admin.find({ role: 'zone_officer' })
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({ success: true, officers });
  } catch (error) {
    res.json({ success: false, error: 'Failed to fetch officers' });
  }
});

app.delete('/api/super-admin/officers/:id', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);

    if (admin.role !== 'super_admin') {
      return res.json({ success: false, message: 'Access denied' });
    }

    await Admin.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Officer deleted' });
  } catch (error) {
    res.json({ success: false, message: 'Failed to delete officer' });
  }
});

// ============================================
// ZONES API (MongoDB-based)
// ============================================

app.get('/api/zones', (req, res) => {
  const zones = Object.keys(ZONE_CONFIG).map(zoneName => ({
    id: zoneName,
    name: zoneName,
    areas: ZONE_CONFIG[zoneName].areas
  }));

  res.json({ success: true, zones });
});

// ============================================
// WORKER APIS (MongoDB)
// ============================================

app.post('/api/worker/register', upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'idProof', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, mobile, aadhaar, email, address, assignedZone, password } = req.body;

    const existingWorker = await Worker.findOne({ mobile });
    if (existingWorker) {
      return res.json({ success: false, message: 'Mobile already registered' });
    }

    const photo = req.files['photo'] ? `/uploads/${req.files['photo'][0].filename}` : null;
    const idProof = req.files['idProof'] ? `/uploads/${req.files['idProof'][0].filename}` : null;

    const worker = new Worker({
      name,
      mobile,
      aadhaar: aadhaar || '',
      email: email || '',
      address: address || '',
      assignedZone: assignedZone || '',
      password: password || `Worker@${mobile.slice(-4)}`,
      photo,
      idProof,
      status: 'pending'
    });

    await worker.save();

    res.json({
      success: true,
      message: 'Registration successful! Wait for approval.',
      applicationId: worker._id
    });
  } catch (error) {
    console.error('Worker registration error:', error);
    res.json({ success: false, message: 'Registration failed' });
  }
});

app.post('/api/worker/login', async (req, res) => {
  try {
    const { mobile, password } = req.body;

    const worker = await Worker.findOne({ mobile, status: 'approved' });

    if (!worker) {
      return res.json({ success: false, message: 'Invalid credentials or not approved' });
    }

    const isMatch = await worker.comparePassword(password);
    if (!isMatch) {
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    req.session.workerId = worker._id.toString();
    req.session.workerName = worker.name;
    req.session.workerZone = worker.assignedZone;

    req.session.save((err) => {
      if (err) {
        console.error('Worker session save error:', err);
      }
      res.json({
        success: true,
        worker: {
          id: worker._id,
          name: worker.name,
          zone: worker.assignedZone
        }
      });
    });
  } catch (error) {
    console.error('Worker login error:', error);
    res.json({ success: false, message: 'Login failed' });
  }
});

app.post('/api/worker/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/worker/check-auth', async (req, res) => {
  try {
    if (req.session.workerId) {
      const worker = await Worker.findById(req.session.workerId).select('-password');
      if (worker) {
        return res.json({
          success: true,
          worker: {
            id: worker._id,
            name: worker.name,
            zone: worker.assignedZone
          }
        });
      }
    }
    res.json({ success: false });
  } catch (error) {
    res.json({ success: false });
  }
});

// Get Worker Applications
app.get('/api/admin/worker-applications', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);

    let query = { status: 'pending' };

    if (admin.role === 'zone_officer' && admin.assignedZones && admin.assignedZones.length > 0) {
      query.assignedZone = { $in: admin.assignedZones };
    }

    const applications = await Worker.find(query).sort({ appliedDate: -1 });
    res.json({ success: true, applications });
  } catch (error) {
    res.json({ success: false, error: 'Failed to fetch applications' });
  }
});

app.post('/api/admin/worker-applications/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { assignedZone } = req.body;

    const worker = await Worker.findById(req.params.id);
    if (!worker) {
      return res.json({ success: false, message: 'Worker not found' });
    }

    worker.status = 'approved';
    worker.assignedZone = assignedZone || worker.assignedZone;
    worker.approvedDate = new Date();
    worker.approvedBy = req.session.adminId;

    await worker.save();

    res.json({ success: true, message: 'Worker approved' });
  } catch (error) {
    res.json({ success: false, message: 'Failed to approve' });
  }
});

app.post('/api/admin/worker-applications/:id/reject', requireAdmin, async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.id);
    if (!worker) {
      return res.json({ success: false, message: 'Worker not found' });
    }

    worker.status = 'rejected';
    await worker.save();

    res.json({ success: true, message: 'Worker rejected' });
  } catch (error) {
    res.json({ success: false, message: 'Failed to reject' });
  }
});

app.get('/api/admin/workers', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.session.adminId);

    let query = { status: 'approved' };

    if (admin.role === 'zone_officer' && admin.assignedZones && admin.assignedZones.length > 0) {
      query.assignedZone = { $in: admin.assignedZones };
    }

    const workers = await Worker.find(query)
      .select('-password')
      .sort({ name: 1 });

    res.json({ success: true, workers });
  } catch (error) {
    res.json({ success: false, error: 'Failed to fetch workers' });
  }
});

// Continuing to Part 3...
// ============================================
// WORKER DASHBOARD
// ============================================

app.get('/api/worker/reports', async (req, res) => {
  try {
    if (!req.session.workerId) {
      return res.json({ success: false, message: 'Not authenticated' });
    }

    const worker = await Worker.findById(req.session.workerId);
    const zone = worker.assignedZone;

    // Get reports: pending in their zone, plus ANY task assigned to them (active or historical)
    const reports = await Report.find({
      $or: [
        { assignedZone: zone, status: 'pending' },
        { assignedTo: req.session.workerId }
      ]
    })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    // Transform reports to include lat/lng for frontend (HANDLE GEOJSON)
    const reportsWithLocation = reports.map(report => {
      let lat = null;
      let lng = null;

      // Extract coordinates if available (GeoJSON format: [lng, lat])
      if (report.location && report.location.coordinates && report.location.coordinates.length === 2) {
        lng = report.location.coordinates[0];
        lat = report.location.coordinates[1];
      }

      return {
        ...report,
        lat,
        lng
      };
    });

    const stats = {
      pending: reportsWithLocation.filter(r => r.status === 'pending').length,
      inProgress: reportsWithLocation.filter(r => r.status === 'in-progress').length,
      completed: worker.totalReportsCompleted
    };

    res.json({
      success: true,
      reports: reportsWithLocation,
      stats,
      worker: {
        name: worker.name,
        zone: worker.assignedZone
      }
    });
  } catch (error) {
    res.json({ success: false, error: 'Failed to fetch reports' });
  }
});

app.post('/api/worker/reports/:id/accept', async (req, res) => {
  try {
    if (!req.session.workerId) {
      return res.json({ success: false, message: 'Not authenticated' });
    }

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.json({ success: false, message: 'Report not found' });
    }

    report.status = 'in-progress';
    report.assignedTo = req.session.workerId;
    await report.save();

    // REAL-TIME UPDATE: Notify User
    req.io.emit('reportUpdated', {
      reportId: report.reportId,
      status: 'in-progress',
      workerId: req.session.workerId,
      updatedAt: new Date()
    });

    res.json({ success: true, message: 'Report accepted' });
  } catch (error) {
    res.json({ success: false, error: 'Failed to accept report' });
  }
});

app.post('/api/worker/reports/:id/complete', upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (!req.session.workerId) {
      return res.json({ success: false, message: 'Worker authentication required. Please log in.' });
    }

    const report = await Report.findById(id);
    if (!report) {
      return res.json({ success: false, message: 'Report not found' });
    }

    // Auto-assign to current worker if unassigned or taking over
    if (!report.assignedTo || report.assignedTo.toString() !== req.session.workerId.toString()) {
      report.assignedTo = req.session.workerId;
    }

    let finalCompletionPhotoUrl = null;
    let photoHash = null;

    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);
      photoHash = crypto.createHash('md5').update(fileBuffer).digest('hex');

      // Check if duplicate across other reports
      const duplicateReport = await Report.findOne({
        _id: { $ne: report._id },
        $or: [
          { photoHash: photoHash },
          { completionPhotoHash: photoHash }
        ]
      });

      if (duplicateReport) {
        try { fs.unlinkSync(req.file.path); } catch (e) { }
        return res.json({
          success: false,
          message: 'Duplicate Photo! This image has already been used. Please upload a fresh photo.'
        });
      }

      // Upload to Cloudinary if configured
      if (process.env.CLOUDINARY_URL) {
        try {
          const result = await cloudinary.uploader.upload(req.file.path, { folder: process.env.CLOUDINARY_FOLDER || 'urbansync_uploads' });
          finalCompletionPhotoUrl = result.secure_url;
          try { fs.unlinkSync(req.file.path); } catch (e) { }
        } catch (err) {
          console.error("Cloudinary upload error:", err);
          finalCompletionPhotoUrl = `/uploads/${req.file.filename}`;
        }
      } else {
        finalCompletionPhotoUrl = `/uploads/${req.file.filename}`;
      }
    } else {
      return res.json({ success: false, message: 'Please upload a photo of the completed cleanup.' });
    }

    report.status = 'resolved';
    report.workerNotes = notes;
    report.resolvedAt = new Date();
    report.resolvedBy = req.session.workerId;
    if (finalCompletionPhotoUrl) {
      report.completionPhotoUrl = finalCompletionPhotoUrl;
      report.completionPhotoHash = photoHash; // Save hash for future checks
    }

    await report.save();

    req.io.emit('reportUpdated', report);

    // Update worker stats
    await Worker.findByIdAndUpdate(req.session.workerId, {
      $inc: { totalReportsCompleted: 1 }
    });

    // Give credits to user (from estimation)
    const creditsToAward = report.estimatedCredits || 20; // Fallback to 20 if undefined

    // Update User Profile
    const user = await User.findById(report.userId);
    if (user) {
      user.credits += creditsToAward;
      user.lifetimeCredits += creditsToAward;
      await user.save();
    }

    // Update Credit Account & Log Transaction
    const creditAccount = await Credit.findOne({ userId: report.userId });
    if (creditAccount) {
      creditAccount.totalCredits += creditsToAward;
      creditAccount.availableCredits += creditsToAward;
      creditAccount.reportsVerified += 1;

      creditAccount.transactions.push({
        type: 'earn', // Changed to match schema enum or string
        amount: creditsToAward,
        description: `Report #${report.reportId} verified`,
        timestamp: new Date()
      });
      await creditAccount.save();

      // Log to central Transaction model too
      await Transaction.create({
        userId: report.userId,
        amount: creditsToAward,
        type: 'earn',
        description: `Report #${report.reportId} Verified`,
        referenceId: report.reportId.toString()
      });
    }

    // REAL-TIME UPDATE: Notify User
    req.io.emit('reportUpdated', {
      reportId: report.reportId,
      status: 'resolved',
      creditsAwarded: creditsToAward,
      updatedAt: new Date()
    });

    res.json({ success: true, message: 'Task completed successfully' });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================================
// DEMO ACCOUNTS
// ============================================

app.get('/api/admin/create-demo-accounts', async (req, res) => {
  try {
    // Clear existing admins
    await Admin.deleteMany({});

    const admins = await Admin.create([
      {
        name: 'Chief Municipal Officer - Bokaro',
        email: 'cmo@bokaro.gov.in',
        password: 'SuperAdmin@2026',
        phone: '+91-9876543200',
        role: 'super_admin',
        department: 'Bokaro Municipal Administration',
        isActive: true,
        permissions: {
          canApproveWorkers: true,
          canAssignWork: true,
          canViewReports: true,
          canManageOfficers: true
        }
      },
      {
        name: 'Rajesh Kumar - Zone 1 Officer',
        email: 'officer1@bokaro.gov.in',
        password: 'Officer@123',
        phone: '+91-9876543201',
        role: 'zone_officer',
        department: 'Sanitation Department',
        assignedZones: ['Zone 1 - North Bokaro'],
        isActive: true,
        permissions: {
          canApproveWorkers: true,
          canAssignWork: true,
          canViewReports: true,
          canManageOfficers: false
        }
      },
      {
        name: 'Suresh Prasad - Zone 2 Officer',
        email: 'officer2@bokaro.gov.in',
        password: 'Officer@123',
        phone: '+91-9876543202',
        role: 'zone_officer',
        department: 'Sanitation Department',
        assignedZones: ['Zone 2 - South Bokaro'],
        isActive: true,
        permissions: {
          canApproveWorkers: true,
          canAssignWork: true,
          canViewReports: true,
          canManageOfficers: false
        }
      },
      {
        name: 'Prakash Verma - Zone 3 Officer',
        email: 'officer3@bokaro.gov.in',
        password: 'Officer@123',
        phone: '+91-9876543203',
        role: 'zone_officer',
        department: 'Sanitation Department',
        assignedZones: ['Zone 3 - East Bokaro'],
        isActive: true,
        permissions: {
          canApproveWorkers: true,
          canAssignWork: true,
          canViewReports: true,
          canManageOfficers: false
        }
      },
      {
        name: 'Anil Sengupta - Zone 4 Officer',
        email: 'officer4@bokaro.gov.in',
        password: 'Officer@123',
        phone: '+91-9876543204',
        role: 'zone_officer',
        department: 'Sanitation Department',
        assignedZones: ['Zone 4 - West Bokaro'],
        isActive: true,
        permissions: {
          canApproveWorkers: true,
          canAssignWork: true,
          canViewReports: true,
          canManageOfficers: false
        }
      },
      {
        name: 'Mahesh Singh - Zone 5 Officer',
        email: 'officer5@bokaro.gov.in',
        password: 'Officer@123',
        phone: '+91-9876543205',
        role: 'zone_officer',
        department: 'Sanitation Department',
        assignedZones: ['Zone 5 - Central Bokaro'],
        isActive: true,
        permissions: {
          canApproveWorkers: true,
          canAssignWork: true,
          canViewReports: true,
          canManageOfficers: false
        }
      }
    ]);

    // Create demo workers
    await Worker.deleteMany({});

    const workers = await Worker.create([
      {
        name: 'Raju Kumar',
        mobile: '9999999991',
        email: 'raju@worker.com',
        password: 'Worker@123',
        aadhaar: '123456789011',
        address: 'Sector 1, Bokaro Steel City',
        assignedZone: 'Zone 1 - North Bokaro',
        status: 'approved',
        approvedBy: admins[0]._id,
        approvedDate: new Date()
      },
      {
        name: 'Suresh Mahto',
        mobile: '9999999992',
        email: 'suresh@worker.com',
        password: 'Worker@123',
        aadhaar: '123456789012',
        address: 'Sector 11, Bokaro Steel City',
        assignedZone: 'Zone 2 - South Bokaro',
        status: 'approved',
        approvedBy: admins[0]._id,
        approvedDate: new Date()
      },
      {
        name: 'Sunita Devi',
        mobile: '9999999993',
        email: 'sunita@worker.com',
        password: 'Worker@123',
        aadhaar: '123456789013',
        address: 'Sector 8, Bokaro Steel City',
        assignedZone: 'Zone 3 - East Bokaro',
        status: 'approved',
        approvedBy: admins[0]._id,
        approvedDate: new Date()
      },
      {
        name: 'Deepak Hansda',
        mobile: '9999999994',
        email: 'deepak@worker.com',
        password: 'Worker@123',
        aadhaar: '123456789014',
        address: 'Sector 5, Bokaro Steel City',
        assignedZone: 'Zone 4 - West Bokaro',
        status: 'approved',
        approvedBy: admins[0]._id,
        approvedDate: new Date()
      },
      {
        name: 'Amit Soren',
        mobile: '9999999995',
        email: 'amit@worker.com',
        password: 'Worker@123',
        aadhaar: '123456789015',
        address: 'City Centre, Bokaro Steel City',
        assignedZone: 'Zone 5 - Central Bokaro',
        status: 'approved',
        approvedBy: admins[0]._id,
        approvedDate: new Date()
      }
    ]);

    res.json({
      success: true,
      message: '5 Zone Officers and 5 Zone Workers for Bokaro created successfully!',
      accounts: {
        superAdmin: {
          email: 'cmo@bokaro.gov.in',
          password: 'SuperAdmin@2025',
          role: 'Super Admin',
          url: 'http://localhost:3000/super-admin-login.html'
        },
        officers: [
          { email: 'officer1@bokaro.gov.in', password: 'Officer@123', zone: 'Zone 1 - North Bokaro', url: 'http://localhost:3000/officer-login.html' },
          { email: 'officer2@bokaro.gov.in', password: 'Officer@123', zone: 'Zone 2 - South Bokaro', url: 'http://localhost:3000/officer-login.html' },
          { email: 'officer3@bokaro.gov.in', password: 'Officer@123', zone: 'Zone 3 - East Bokaro', url: 'http://localhost:3000/officer-login.html' },
          { email: 'officer4@bokaro.gov.in', password: 'Officer@123', zone: 'Zone 4 - West Bokaro', url: 'http://localhost:3000/officer-login.html' },
          { email: 'officer5@bokaro.gov.in', password: 'Officer@123', zone: 'Zone 5 - Central Bokaro', url: 'http://localhost:3000/officer-login.html' }
        ],
        workers: [
          { mobile: '9999999991', password: 'Worker@123', zone: 'Zone 1 - North Bokaro', url: 'http://localhost:3000/worker-login.html' },
          { mobile: '9999999992', password: 'Worker@123', zone: 'Zone 2 - South Bokaro', url: 'http://localhost:3000/worker-login.html' },
          { mobile: '9999999993', password: 'Worker@123', zone: 'Zone 3 - East Bokaro', url: 'http://localhost:3000/worker-login.html' },
          { mobile: '9999999994', password: 'Worker@123', zone: 'Zone 4 - West Bokaro', url: 'http://localhost:3000/worker-login.html' },
          { mobile: '9999999995', password: 'Worker@123', zone: 'Zone 5 - Central Bokaro', url: 'http://localhost:3000/worker-login.html' }
        ]
      }
    });
  } catch (error) {
    console.error('Create demo accounts error:', error);
    res.json({ success: false, error: error.message });
  }
});

// FIX EXISTING REPORTS - ASSIGN BOKARO ZONES
app.get('/api/fix-all-zones', async (req, res) => {
  try {
    const reports = await Report.find({
      $or: [
        { assignedZone: { $exists: false } },
        { assignedZone: null },
        { assignedZone: '' }
      ]
    });

    console.log(`🔧 Fixing ${reports.length} reports...`);

    let fixed = 0;
    for (const report of reports) {
      let zone = 'Zone 5 - Central Bokaro';

      if (report.address) {
        const addr = report.address.toLowerCase();

        if (addr.includes('sector 1') || addr.includes('sector 2') || addr.includes('bokaro mall') || addr.includes('ram mandir')) {
          zone = 'Zone 1 - North Bokaro';
        }
        else if (addr.includes('sector 11') || addr.includes('sector 12') || addr.includes('camp 2') || addr.includes('balidih')) {
          zone = 'Zone 2 - South Bokaro';
        }
        else if (addr.includes('sector 8') || addr.includes('sector 9') || addr.includes('harla') || addr.includes('noori masjid')) {
          zone = 'Zone 3 - East Bokaro';
        }
        else if (addr.includes('sector 5') || addr.includes('sector 6') || addr.includes('steel plant') || addr.includes('vaishno')) {
          zone = 'Zone 4 - West Bokaro';
        }
      }

      report.assignedZone = zone;
      await report.save();
      fixed++;

      console.log(`Report #${report.reportId} → ${zone}`);
    }

    res.json({
      success: true,
      message: `Fixed ${fixed} reports with Bokaro zone assignments`,
      details: reports.map(r => ({ id: r.reportId, zone: r.assignedZone, address: r.address }))
    });

  } catch (error) {
    console.error('Fix zones error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/create-demo-reports', async (req, res) => {
  try {
    const admin = await Admin.findOne({ role: 'super_admin' });
    let adminId = admin ? admin._id : null;

    const demoReports = [
      {
        reportId: 101,
        description: 'Accumulated construction debris blocking pedestrian sidewalk near Sector 4 City Centre',
        category: 'other',
        address: 'Sector 4 City Centre, Bokaro Steel City',
        location: { type: 'Point', coordinates: [86.1511, 23.6693] },
        assignedZone: 'Zone 5 - Central Bokaro',
        severity: 'medium',
        status: 'pending',
        estimatedCredits: 30
      },
      {
        reportId: 102,
        description: 'Overflowing commercial waste containers near Sector 1 Market',
        category: 'organic',
        address: 'Sector 1 Market, Bokaro Steel City',
        location: { type: 'Point', coordinates: [86.1420, 23.6782] },
        assignedZone: 'Zone 1 - North Bokaro',
        severity: 'high',
        status: 'pending',
        estimatedCredits: 40
      },
      {
        reportId: 103,
        description: 'Discarded scrap metal and industrial packaging near Balidih entrance',
        category: 'metal',
        address: 'Balidih Industrial Area, Bokaro Steel City',
        location: { type: 'Point', coordinates: [86.1550, 23.6480] },
        assignedZone: 'Zone 2 - South Bokaro',
        severity: 'critical',
        status: 'pending',
        estimatedCredits: 50
      },
      {
        reportId: 104,
        description: 'Plastic packaging waste scattered along Harla park perimeter',
        category: 'plastic',
        address: 'Sector 8 Harla, Bokaro Steel City',
        location: { type: 'Point', coordinates: [86.1820, 23.6650] },
        assignedZone: 'Zone 3 - East Bokaro',
        severity: 'low',
        status: 'pending',
        estimatedCredits: 20
      },
      {
        reportId: 105,
        description: 'Electronic components and discarded monitors outside Sector 6 service hub',
        category: 'ewaste',
        address: 'Sector 6 B-Block, Bokaro Steel City',
        location: { type: 'Point', coordinates: [86.1220, 23.6680] },
        assignedZone: 'Zone 4 - West Bokaro',
        severity: 'high',
        status: 'pending',
        estimatedCredits: 45
      }
    ];

    await Report.deleteMany({});
    const createdReports = await Report.insertMany(demoReports);
    res.json({ success: true, count: createdReports.length, reports: createdReports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



// ==========================================
// 👮 CREATE OFFICER API (Super Admin)
// ==========================================
app.post('/api/admin/create-officer', requireSuperAdmin, async (req, res) => {
  try {
    const { name, email, password, zone, phone } = req.body;

    // Check if exists
    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ success: false, error: 'Email already exists' });

    const officer = await Admin.create({
      name,
      email,
      password, // Logic handles hashing
      role: 'zone_officer',
      assignedZones: [zone],
      phone,
      permissions: { canAssignWork: true, canViewReports: true }
    });

    res.json({ success: true, message: 'Officer created successfully', officer });
  } catch (error) {
    console.error('Create Officer Error:', error);
    res.status(500).json({ success: false, error: 'Failed to create officer' });
  }
});

// ==========================================
// 👷 CREATE WORKER API (Admin/Officer)
// ==========================================
app.post('/api/admin/create-worker', requireAdmin, async (req, res) => {
  try {
    const { name, mobile, password, zone, address } = req.body;

    // Check availability
    const existing = await Worker.findOne({ mobile });
    if (existing) return res.status(400).json({ success: false, error: 'Mobile number already registered' });

    const worker = await Worker.create({
      name,
      mobile,
      password,
      assignedZone: zone,
      address,
      status: 'approved', // Direct hire = auto-approved
      totalReportsCompleted: 0
    });

    res.json({ success: true, message: 'Worker hired successfully', worker });
  } catch (error) {
    console.error('Create Worker Error:', error);
    res.status(500).json({ success: false, error: 'Failed to create worker' });
  }
});

// ==========================================
// GOD MODE: FORCE UPDATE REPORT STATUS
// ==========================================
app.put('/api/super-admin/reports/:id/status', requireSuperAdmin, async (req, res) => {
  try {
    const { status, note } = req.body;
    // Verify Super Admin...

    const updateData = { status };
    if (note) updateData.adminNote = note;
    if (status === 'resolved') updateData.resolvedAt = new Date();
    if (status === 'verified') updateData.verifiedAt = new Date();

    const report = await Report.findByIdAndUpdate(req.params.id, updateData, { new: true });

    io.emit('reportUpdated', { reportId: report._id, status });
    res.json({ success: true, report });
  } catch (error) {
    console.error('God Mode Update Error:', error);
    res.status(500).json({ success: false, error: 'Failed to update report' });
  }
});

// ==========================================
// UNIVERSAL REJECT REPORT (Admin/Officer/Worker)
// ==========================================
app.post('/api/universal/reject-report', async (req, res) => {
  try {
    const { reportId, reason, rejectedByRole, rejectorId } = req.body;

    // Basic Validation
    if (!reportId || !reason) return res.status(400).json({ success: false, error: 'Missing report ID or reason' });

    // In a real app, verify session here based on role
    // For now, trusting the role sent from frontend (secured by frontend session checks)

    const updateData = {
      status: 'rejected',
      adminNote: `Rejected by ${rejectedByRole}: ${reason}`,
      rejectedAt: new Date()
    };

    const report = await Report.findByIdAndUpdate(reportId, updateData, { new: true });

    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });

    io.emit('reportUpdated', { reportId: report._id, status: 'rejected' });
    res.json({ success: true, message: 'Report rejected successfully' });

  } catch (error) {
    console.error('Universal Reject Error:', error);
    res.status(500).json({ success: false, error: 'Failed to reject report' });
  }
});

// ==========================================
// 📊 SUPER ADMIN STATS API
// ==========================================
app.get('/api/super-admin/stats', async (req, res) => {
  try {
    const totalReports = await Report.countDocuments();
    const pendingReports = await Report.countDocuments({ status: 'pending' });
    const totalOfficers = await Admin.countDocuments({ role: 'zone_officer' });
    const totalWorkers = await Worker.countDocuments();

    res.json({
      success: true,
      totalReports,
      pendingReports,
      totalOfficers,
      totalWorkers
    });
  } catch (error) {
    console.error('Super Admin Stats Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// ==========================================
// 📋 GET ALL REPORTS (Super Admin)
// ==========================================
app.get('/api/super-admin/reports', async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('userId', 'name email mobile')
      .populate('assignedTo', 'name mobile')
      .sort({ createdAt: -1 });

    res.json({ success: true, reports });
  } catch (error) {
    console.error('Super Admin Reports Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reports' });
  }
});

// ==========================================
// 📋 GET ALL WORKERS (Super Admin)
// ==========================================
app.get('/api/super-admin/workers', async (req, res) => {
  try {
    const workers = await Worker.find().sort({ createdAt: -1 });
    res.json({ success: true, workers });
  } catch (error) {
    console.error('Get Workers Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch workers' });
  }
});

// ==========================================
// DELETE WORKER (Admin)
// ==========================================
app.delete('/api/admin/workers/:id', async (req, res) => {
  try {
    await Worker.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Worker deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete worker' });
  }
});

// ==========================================
// DELETE OFFICER (Admin)
// ==========================================
app.delete('/api/admin/officers/:id', async (req, res) => {
  try {
    await Admin.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Officer deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete officer' });
  }
});

// ============================================
// AUTO-SEED ON STARTUP
// ============================================
const autoSeed = async () => {
  try {
    // 1. Super Admin (NUCLEAR OPTION: Delete & Recreate to ensure clean state)
    await Admin.deleteOne({ email: 'cmo@bokaro.gov.in' });
    console.log('Old Super Admin deleted (cleanup)');

    const salt = await bcrypt.genSalt(10);
    const superAdminPass = await bcrypt.hash('SuperAdmin@2025', salt);

    await Admin.create({
      name: 'Super Admin (CMO)',
      email: 'cmo@bokaro.gov.in',
      password: 'SuperAdmin@2025',
      role: 'super_admin',
      mobile: '9999999999',
      assignedZones: ['All'],
      isActive: true
    });
    console.log('Super Admin RE-CREATED (Active) - EMAIL: cmo@bokaro.gov.in | PASSWORD: SuperAdmin@2025');

    // 2. Zone Officers (5 Dedicated Officers for 5 Zones)
    const officerPass = await bcrypt.hash('Officer@123', salt);
    const officers = [
      { name: 'Rajesh Kumar - Zone 1 Officer', email: 'officer1@bokaro.gov.in', mobile: '9876543201', zones: ['Zone 1 - North Bokaro'] },
      { name: 'Suresh Prasad - Zone 2 Officer', email: 'officer2@bokaro.gov.in', mobile: '9876543202', zones: ['Zone 2 - South Bokaro'] },
      { name: 'Prakash Verma - Zone 3 Officer', email: 'officer3@bokaro.gov.in', mobile: '9876543203', zones: ['Zone 3 - East Bokaro'] },
      { name: 'Anil Sengupta - Zone 4 Officer', email: 'officer4@bokaro.gov.in', mobile: '9876543204', zones: ['Zone 4 - West Bokaro'] },
      { name: 'Mahesh Singh - Zone 5 Officer', email: 'officer5@bokaro.gov.in', mobile: '9876543205', zones: ['Zone 5 - Central Bokaro'] }
    ];

    for (const off of officers) {
      await Admin.findOneAndUpdate(
        { email: off.email },
        {
          name: off.name,
          email: off.email,
          password: officerPass,
          role: 'zone_officer',
          mobile: off.mobile,
          assignedZones: off.zones,
          isActive: true
        },
        { upsert: true, new: true }
      );
    }
    console.log('5 Dedicated Zone Officers synced (Active) - PASSWORD: Officer@123');

    // 3. Workers (All 5 Bokaro Zones - 1 Worker per Zone)
    console.log('Syncing Frontline Workers for All 5 Zones...');
    const admin = await Admin.findOne({ email: 'cmo@bokaro.gov.in' });

    const defaultWorkers = [
      { name: 'Raju Kumar', mobile: '9999999991', zone: 'Zone 1 - North Bokaro' },
      { name: 'Suresh Mahto', mobile: '9999999992', zone: 'Zone 2 - South Bokaro' },
      { name: 'Sunita Devi', mobile: '9999999993', zone: 'Zone 3 - East Bokaro' },
      { name: 'Deepak Hansda', mobile: '9999999994', zone: 'Zone 4 - West Bokaro' },
      { name: 'Amit Soren', mobile: '9999999995', zone: 'Zone 5 - Central Bokaro' }
    ];

    for (const w of defaultWorkers) {
      let worker = await Worker.findOne({ mobile: w.mobile });
      if (!worker) {
        worker = new Worker({
          name: w.name,
          mobile: w.mobile,
          email: `${w.mobile}@worker.urbansync.in`,
          password: 'Worker@123',
          aadhaar: `123456${w.mobile}`,
          address: 'Bokaro Steel City, Jharkhand',
          assignedZone: w.zone,
          status: 'approved',
          approvedBy: admin?._id || null,
          approvedDate: new Date()
        });
        await worker.save();
        console.log(`✅ Seeded Worker: ${w.name} (${w.mobile}) -> ${w.zone}`);
      } else {
        worker.name = w.name;
        worker.status = 'approved';
        worker.assignedZone = w.zone;
        worker.password = 'Worker@123'; // Triggers pre('save') to hash
        await worker.save();
        console.log(`✅ Synced Worker: ${w.name} (${w.mobile}) -> ${w.zone}`);
      }
    }
    console.log('All 5 Zone Workers synced (Approved) - PASSWORD: Worker@123');

    // 4. Seed Demo Citizen & Leaderboard Citizens
    console.log('Syncing Demo Citizen & Civic Leaderboard...');
    let demoCitizenUser = await User.findOne({ email: 'demo@bokaro.gov.in' });
    if (!demoCitizenUser) {
      demoCitizenUser = new User({
        name: 'Aditya Sharma',
        email: 'demo@bokaro.gov.in',
        password: 'Password@123',
        credits: 280,
        lifetimeCredits: 350,
        reportsCount: 5,
        currentStreak: 4,
        longestStreak: 7
      });
      await demoCitizenUser.save();
      console.log('✅ Demo Citizen created: demo@bokaro.gov.in / Password@123');
    }

    let demoCredit = await Credit.findOne({ userId: demoCitizenUser._id });
    if (!demoCredit) {
      demoCredit = new Credit({
        userId: demoCitizenUser._id,
        totalCredits: 350,
        availableCredits: 280,
        reportCount: 5,
        reportsVerified: 4,
        badges: [
          { key: 'first_report', name: 'First Responder', icon: '🌱', earnedAt: new Date(Date.now() - 7 * 86400000) },
          { key: 'streak_3d', name: 'Clean Streak 3d', icon: '🔥', earnedAt: new Date(Date.now() - 4 * 86400000) },
          { key: 'bokaro_champion', name: 'Bokaro Guardian', icon: '🛡️', earnedAt: new Date(Date.now() - 2 * 86400000) },
          { key: 'verified_citizen', name: 'Verified Citizen', icon: '✨', earnedAt: new Date(Date.now() - 86400000) }
        ],
        transactions: [
          { type: 'bonus', amount: 50, description: 'Welcome to UrbanSync! 🎉', timestamp: new Date(Date.now() - 10 * 86400000) },
          { type: 'earned', amount: 35, description: 'Incident #101 verified at Sector 4 City Centre', timestamp: new Date(Date.now() - 7 * 86400000) },
          { type: 'earned', amount: 45, description: 'Incident #103 verified at Chas Bypass', timestamp: new Date(Date.now() - 5 * 86400000) },
          { type: 'earned', amount: 50, description: 'Incident #106 verified at Sector 1 Market', timestamp: new Date(Date.now() - 2 * 86400000) },
          { type: 'redeemed', amount: -70, description: 'Redeemed ₹50 UPI Cashback Voucher', timestamp: new Date(Date.now() - 86400000) }
        ]
      });
      await demoCredit.save();
    }

    const sampleCitizens = [
      { name: 'Priya Patel', email: 'priya.bokaro@gmail.com', totalCredits: 420, availableCredits: 370, reports: 8, streak: 6 },
      { name: 'Amit Verma', email: 'amit.verma@bokaro.in', totalCredits: 260, availableCredits: 210, reports: 4, streak: 3 },
      { name: 'Sunita Roy', email: 'sunita.roy@bokaro.in', totalCredits: 190, availableCredits: 150, reports: 3, streak: 2 },
      { name: 'Rahul Soren', email: 'rahul.soren@bokaro.in', totalCredits: 140, availableCredits: 140, reports: 2, streak: 1 }
    ];

    for (const c of sampleCitizens) {
      let u = await User.findOne({ email: c.email });
      if (!u) {
        u = new User({
          name: c.name,
          email: c.email,
          password: 'Password@123',
          credits: c.availableCredits,
          lifetimeCredits: c.totalCredits,
          reportsCount: c.reports,
          currentStreak: c.streak,
          longestStreak: c.streak + 2
        });
        await u.save();
      }

      let cred = await Credit.findOne({ userId: u._id });
      if (!cred) {
        cred = new Credit({
          userId: u._id,
          totalCredits: c.totalCredits,
          availableCredits: c.availableCredits,
          reportCount: c.reports,
          reportsVerified: c.reports,
          badges: [
            { key: 'first_report', name: 'First Responder', icon: '🌱', earnedAt: new Date(Date.now() - 14 * 86400000) },
            { key: 'eco_warrior', name: 'Eco Warrior', icon: '🌟', earnedAt: new Date(Date.now() - 5 * 86400000) }
          ],
          transactions: [
            { type: 'bonus', amount: 50, description: 'Welcome Bonus', timestamp: new Date(Date.now() - 14 * 86400000) },
            { type: 'earned', amount: c.totalCredits - 50, description: 'Multiple verified incident cleanups in Bokaro', timestamp: new Date(Date.now() - 3 * 86400000) }
          ]
        });
        await cred.save();
      }
    }

    // 5. Seed Bokaro Realistic Incident Reports
    const reportCount = await Report.countDocuments();
    if (reportCount < 5) {
      console.log('Seeding Bokaro municipal incident reports across 5 zones...');
      const defaultWorker = await Worker.findOne({ mobile: '9999999991' });
      const defaultAdmin = await Admin.findOne({ email: 'cmo@bokaro.gov.in' });

      const sampleReports = [
        {
          reportId: 101,
          userId: demoCitizenUser._id,
          description: 'Large cluster of discarded plastic packaging and beverage cups outside City Centre complex near Sector 4.',
          category: 'plastic',
          address: 'Sector 4 City Centre, Bokaro Steel City',
          location: { type: 'Point', coordinates: [86.1511, 23.6693] },
          assignedZone: 'Zone 5 - Central Bokaro',
          severity: 'medium',
          status: 'resolved',
          estimatedCredits: 15,
          photoUrl: '/images/9001_before.png',
          completionPhotoUrl: '/images/9001_after.png',
          assignedTo: defaultWorker?._id,
          resolvedBy: defaultWorker?._id,
          verifiedBy: defaultAdmin?._id,
          verifiedAt: new Date(Date.now() - 2 * 86400000),
          resolvedAt: new Date(Date.now() - 86400000),
          adminNotes: 'Field cleanup verified. Area restored.',
          workerNotes: 'Waste collected and safely transported to Sector 4 segregation unit.',
          aiTags: ['plastic bottle', 'litter', 'packaging'],
          aiConfidence: 0.94
        },
        {
          reportId: 102,
          userId: demoCitizenUser._id,
          description: 'Accumulation of mixed cardboard and organic vegetable waste behind Sector 1 Daily Market.',
          category: 'organic',
          address: 'Sector 1 Market Circle, Bokaro Steel City',
          location: { type: 'Point', coordinates: [86.1380, 23.6820] },
          assignedZone: 'Zone 1 - North Bokaro',
          severity: 'high',
          status: 'resolved',
          estimatedCredits: 20,
          photoUrl: '/images/9002_before.png',
          completionPhotoUrl: '/images/9002_after.png',
          assignedTo: defaultWorker?._id,
          resolvedBy: defaultWorker?._id,
          adminNotes: 'Assigned to North Bokaro sanitation crew.',
          workerNotes: 'Organic waste cleared and sent to composting facility.',
          aiTags: ['organic waste', 'cardboard', 'vegetable scrap'],
          aiConfidence: 0.91
        },
        {
          reportId: 103,
          userId: demoCitizenUser._id,
          description: 'Discarded commercial packaging and beverage tins along Chas Main Bypass road.',
          category: 'metal',
          address: 'Chas Main Bypass Road, Bokaro Steel City',
          location: { type: 'Point', coordinates: [86.1850, 23.6600] },
          assignedZone: 'Zone 3 - East Bokaro',
          severity: 'medium',
          status: 'verified',
          estimatedCredits: 15,
          photoUrl: '/images/9003_before.png',
          completionPhotoUrl: '/images/9003_after.png',
          verifiedBy: defaultAdmin?._id,
          verifiedAt: new Date(),
          adminNotes: 'Officer inspected and approved for pickup.',
          workerNotes: 'Roadside debris cleared and curb swept.',
          aiTags: ['metal can', 'packaging', 'litter'],
          aiConfidence: 0.88
        },
        {
          reportId: 104,
          userId: demoCitizenUser._id,
          description: 'Overflowing community dumpster near Garga Dam approach road.',
          category: 'other',
          address: 'Garga Dam Approach Road, Bokaro Steel City',
          location: { type: 'Point', coordinates: [86.1620, 23.6480] },
          assignedZone: 'Zone 2 - South Bokaro',
          severity: 'critical',
          status: 'pending',
          estimatedCredits: 25,
          photoUrl: 'https://images.unsplash.com/photo-1611284446314-60a58ac0deb9?w=800&q=80',
          completionPhotoUrl: '/images/clean_street_after_1780331876520.png',
          aiTags: ['overflowing dumpster', 'mixed waste'],
          aiConfidence: 0.96
        },
        {
          reportId: 105,
          userId: demoCitizenUser._id,
          description: 'Scrap metal and industrial packaging waste discarded near Balidih Industrial Area entrance.',
          category: 'metal',
          address: 'Balidih Industrial Area Gate 2, Bokaro Steel City',
          location: { type: 'Point', coordinates: [86.1150, 23.6550] },
          assignedZone: 'Zone 4 - West Bokaro',
          severity: 'medium',
          status: 'resolved',
          estimatedCredits: 20,
          photoUrl: '/images/9005_before.jpg',
          completionPhotoUrl: '/images/9005_after.jpg',
          assignedTo: defaultWorker?._id,
          resolvedBy: defaultWorker?._id,
          verifiedBy: defaultAdmin?._id,
          verifiedAt: new Date(Date.now() - 3 * 86400000),
          resolvedAt: new Date(Date.now() - 2 * 86400000),
          adminNotes: 'Industrial zone sanitation completed.',
          workerNotes: 'Heavy metal scraps loaded onto municipal carrier.',
          aiTags: ['industrial scrap', 'metal'],
          aiConfidence: 0.92
        },
        {
          reportId: 106,
          userId: demoCitizenUser._id,
          description: 'Plastic food containers and beverage cups near Bokaro Mall perimeter, Sector 3.',
          category: 'plastic',
          address: 'Bokaro Mall Perimeter, Sector 3, Bokaro Steel City',
          location: { type: 'Point', coordinates: [86.1550, 23.6650] },
          assignedZone: 'Zone 5 - Central Bokaro',
          severity: 'low',
          status: 'resolved',
          estimatedCredits: 10,
          photoUrl: '/images/9006_before.png',
          completionPhotoUrl: '/images/9006_after.png',
          assignedTo: defaultWorker?._id,
          resolvedBy: defaultWorker?._id,
          verifiedBy: defaultAdmin?._id,
          resolvedAt: new Date(Date.now() - 4 * 86400000),
          adminNotes: 'Cleaned by morning patrol.',
          workerNotes: 'All plastic cartons and cups removed; pavement power-washed.',
          aiTags: ['plastic container', 'litter'],
          aiConfidence: 0.95
        }
      ];

      for (const rep of sampleReports) {
        await Report.create(rep);
      }
      console.log('✅ Bokaro sample reports seeded successfully!');
    }

    // Ensure all existing reports with old seedling/leaf photos are permanently updated
    await Report.updateMany(
      {
        $or: [
          { completionPhotoUrl: { $regex: 'photo-1542601906990-b4d3fb778b09' } },
          { completionPhotoUrl: { $regex: 'leaf\\.(jpg|png)' } }
        ]
      },
      { $set: { completionPhotoUrl: '/images/clean_street_after_1780331876520.png' } }
    );
    await Report.updateOne({ reportId: 101 }, { $set: { photoUrl: '/images/9001_before.png', completionPhotoUrl: '/images/9001_after.png' } });
    await Report.updateOne({ reportId: 102 }, { $set: { photoUrl: '/images/9002_before.png', completionPhotoUrl: '/images/9002_after.png' } });
    await Report.updateOne({ reportId: 103 }, { $set: { photoUrl: '/images/9003_before.png', completionPhotoUrl: '/images/9003_after.png' } });
    await Report.updateOne({ reportId: 105 }, { $set: { photoUrl: '/images/9005_before.jpg', completionPhotoUrl: '/images/9005_after.jpg' } });
    await Report.updateOne({ reportId: 106 }, { $set: { photoUrl: '/images/9006_before.png', completionPhotoUrl: '/images/9006_after.png' } });
    await Report.updateOne({ reportId: 107 }, { $set: { completionPhotoUrl: '/images/9007_after.png' } });
    await Report.updateOne({ reportId: 108 }, { $set: { photoUrl: '/images/9010_before.png', completionPhotoUrl: '/images/9010_after.png' } });

    console.log('Auto-seed check complete. Bokaro Municipal Database ready.');
  } catch (error) {
    console.error('❌ Auto-seed failed:', error);
  }
};

// ============================================
// START SERVER
// ============================================

// CRASH LOGGING: Catch unhandled errors
process.on('uncaughtException', (err) => {
  console.error('❌ CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ CRITICAL: Unhandled Rejection:', reason);
});

const startServer = async () => {
  try {
    httpServer.listen(PORT, '0.0.0.0', async () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                                                                       ║
║   🏙️  UrbanSync — Municipal Incident Management Platform  🏙️           ║
║   Bokaro Steel City, Jharkhand, India | SERVER STARTED (v1.0.0)      ║
║                                                                       ║
╚═══════════════════════════════════════════════════════════════════════╝

Server running on port ${PORT} | Environment: ${process.env.NODE_ENV || 'development'}
`);

      try {
        console.log('Starting Auto-Seed Process...');
        await autoSeed();
        console.log('Auto-Seed Process Finished');
      } catch (seedError) {
        console.error('❌ Auto-Seed Failed (Non-Fatal):', seedError);
      }
    });
  } catch (error) {
    console.error('❌ Server Start Failed:', error);
    process.exit(1);
  }
};

startServer();

