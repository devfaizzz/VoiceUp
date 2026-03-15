const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth.routes');
const issueRoutes = require('./routes/issue.routes');
const adminRoutes = require('./routes/admin.routes');
const userRoutes = require('./routes/user.routes');
const notificationRoutes = require('./routes/notification.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const sentimentRoutes = require('./routes/sentiment.routes');
const communicationRoutes = require('./routes/communication.routes');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/auth');

// Import config
const { connectDB } = require('./config/database');
const logger = require('./utils/logger');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});

// Connect to MongoDB
connectDB();

// Initialize AI classifier
const classifier = require('./ai/classificationService');
classifier.initialize();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.tailwindcss.com",
        "https://maps.googleapis.com",
        "https://maps.gstatic.com",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.tailwindcss.com",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "blob:"
      ],
      connectSrc: [
        "'self'",
        "https://maps.googleapis.com",
        "https://maps.gstatic.com",
        "https://*.googleapis.com",
        "https://*.gstatic.com"
      ],
      fontSrc: [
        "'self'",
        "data:",
        "https://fonts.gstatic.com",
        "https://fonts.googleapis.com"
      ],
      frameSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"]
    }
  }
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use('/api/', limiter);

// Socket.io middleware
io.use((socket, next) => {
  // Add authentication for socket connections
  const token = socket.handshake.auth.token;
  if (token) {
    // Verify token here
    next();
  } else {
    next(new Error('Authentication error'));
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info('New client connected:', socket.id);

  socket.on('join-room', (userId) => {
    socket.join(`user-${userId}`);
  });

  socket.on('disconnect', () => {
    logger.info('Client disconnected:', socket.id);
  });
});

// Make io accessible to routes
app.set('io', io);

// Static Frontend (Citizen Panel at /, Admin Panel at /admin)
const citizenPanelDir = path.join(__dirname, '..', '..', 'frontend', 'citizen-panel');
const adminPanelDir = path.join(__dirname, '..', '..', 'frontend', 'admin-panel');

// Serve static BEFORE API routes to ensure HTML takes precedence
app.use('/admin', express.static(adminPanelDir));
app.use(express.static(citizenPanelDir));

// Proxy Tailwind CDN locally to avoid third-party blocking
let cachedTailwind = { content: null, fetchedAt: 0 };
app.get('/assets/tailwind.js', async (req, res) => {
  try {
    const now = Date.now();
    if (!cachedTailwind.content || now - cachedTailwind.fetchedAt > 6 * 60 * 60 * 1000) {
      const response = await axios.get('https://cdn.tailwindcss.com', { responseType: 'text' });
      cachedTailwind = { content: response.data, fetchedAt: now };
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.send(cachedTailwind.content);
  } catch (err) {
    res.status(502).send('// Failed to load Tailwind CDN');
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/sentiment', sentimentRoutes);
app.use('/api/communications', communicationRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// HTML entry points
app.get('/', (req, res) => {
  res.sendFile(path.join(citizenPanelDir, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(adminPanelDir, 'index.html'));
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource does not exist'
  });
});

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    mongoose.connection.close(false, () => {
      logger.info('MongoDB connection closed');
      process.exit(0);
    });
  });
});

module.exports = { app, io };
