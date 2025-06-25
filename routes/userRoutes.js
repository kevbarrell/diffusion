import express from 'express';
import User from '../models/User.js';

const router = express.Router();

// Create a user
router.post('/', async (req, res) => {
  try {
    const newUser = new User(req.body);
    const saved = await newUser.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single user by ID
router.get('/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Handle swipe from one user to another
router.post('/:userId/swipe', async (req, res) => {
  const { userId } = req.params;
  const { targetId, action } = req.body;

  try {
    const swiper = await User.findById(userId);
    const target = await User.findById(targetId);

    if (!swiper || !target) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (action === 'like') {
      if (swiper.likes.includes(targetId)) {
        return res.status(400).json({ message: 'Already liked this user' });
      }

      swiper.likes.push(targetId);

      const isMatch = target.likes.includes(userId);
      if (isMatch) {
        swiper.matches.push(targetId);
        target.matches.push(userId);

        await target.save();
        await swiper.save();

        return res.status(200).json({ message: 'It’s a match!', match: true });
      }

      await swiper.save();
      return res.status(200).json({ message: 'Swipe recorded', match: false });

    } else if (action === 'reject') {
      if (swiper.rejected.includes(targetId)) {
        return res.status(400).json({ message: 'Already rejected this user twice' });
      }

      if (!swiper.rejectedOnce.includes(targetId)) {
        swiper.rejectedOnce.push(targetId);
        await swiper.save();
        return res.status(200).json({ message: 'Rejected once' });
      } else {
        swiper.rejected.push(targetId);
        await swiper.save();
        return res.status(200).json({ message: 'Rejected permanently' });
      }
    } else {
      return res.status(400).json({ message: 'Invalid action' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all matches for a user
router.get('/:userId/matches', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId).populate('matches', 'name age image bio');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user.matches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
