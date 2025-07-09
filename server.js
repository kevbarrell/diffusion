import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

import userRoutes from './routes/userRoutes.js';
import messagesRouter from './routes/messages.js';
import authRoutes from './routes/auth.js'; // ← Make sure this is AFTER `dotenv.config()`

dotenv.config();

const app = express(); // ← This must come BEFORE any `app.use(...)`

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/messages', messagesRouter);
app.use('/api/auth', authRoutes); // ← Now it's safe to use

// Test route
app.get('/', (req, res) => {
  res.send('CalvinCrush API is live');
});

// Connect to MongoDB and start server
mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => console.error('❌ MongoDB connection error:', err));
