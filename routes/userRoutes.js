import express from 'express';
import User from '../models/User.js';
import { createRequire } from 'module';

const router = express.Router();

const require = createRequire(import.meta.url);
const zipcodes = require('zipcodes');

const isValidUSZip = (zip) => /^\d{5}$/.test(String(zip || '').trim());

const getZipCoords = (zip) => {
  if (!isValidUSZip(zip)) return null;
  const info = zipcodes.lookup(String(zip).trim());
  if (!info || info.latitude == null || info.longitude == null) return null;
  return { lat: Number(info.latitude), lon: Number(info.longitude) };
};

const haversineMiles = (a, b) => {
  if (!a || !b) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.7613; // Earth radius in miles

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const x =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return R * c;
};

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

// Update user profile (EditProfileScreen)
router.put('/:userId', async (req, res) => {
  try {
    const { age, gender, photos, zipCode, ...rest } = req.body;

    // ZIP required
    if (!zipCode || !isValidUSZip(zipCode)) {
      return res.status(400).json({ message: 'Valid 5-digit ZIP code is required.' });
    }

    const profileCompleted =
      !!age &&
      !!gender &&
      Array.isArray(photos) &&
      photos.length > 0 &&
      isValidUSZip(zipCode);

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      {
        age: age != null ? Number(age) : age,
        gender,
        photos,
        zipCode: String(zipCode).trim(),
        ...rest,
        profileCompleted,
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recommendations with Second Chance support + gender filtering + distanceMiles
router.get('/:userId/recommendations', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const oppositeGender = user.gender === 'male' ? 'female' : 'male';

    const swipedIds = [
      ...user.likes.map(String),
      ...user.matches.map(String),
    ];

    let candidates = await User.find({
      _id: { $ne: userId, $nin: swipedIds },
      gender: oppositeGender,
    }).select('name age image bio gender photos aboutMe zipCode');

    candidates = candidates.filter((c) => !user.rejected.includes(c._id));

    const userCoords = getZipCoords(user.zipCode);

    const shaped = candidates.map((c) => {
      const photo0 = Array.isArray(c.photos) && c.photos.length > 0 ? c.photos[0] : null;

      const candidateCoords = getZipCoords(c.zipCode);
      const dist = haversineMiles(userCoords, candidateCoords);

      return {
        _id: c._id,
        name: c.name,
        age: c.age,
        gender: c.gender,
        zipCode: c.zipCode,
        image: photo0 || c.image,
        bio: c.aboutMe || c.bio,
        photos: c.photos || [],
        distanceMiles: typeof dist === 'number' ? dist : null,
      };
    });

    if (shaped.length > 0) {
      return res.status(200).json({ users: shaped, secondChance: false });
    }

    const secondChanceIds = user.rejected.filter(
      (id) => !user.secondChanceShown.includes(id)
    );

    const secondChanceUsers = await User.find({
      _id: { $in: secondChanceIds },
      gender: oppositeGender,
    }).select('name age image bio gender photos aboutMe zipCode');

    const shapedSecond = secondChanceUsers.map((c) => {
      const photo0 = Array.isArray(c.photos) && c.photos.length > 0 ? c.photos[0] : null;

      const candidateCoords = getZipCoords(c.zipCode);
      const dist = haversineMiles(userCoords, candidateCoords);

      return {
        _id: c._id,
        name: c.name,
        age: c.age,
        gender: c.gender,
        zipCode: c.zipCode,
        image: photo0 || c.image,
        bio: c.aboutMe || c.bio,
        photos: c.photos || [],
        distanceMiles: typeof dist === 'number' ? dist : null,
      };
    });

    return res.status(200).json({ users: shapedSecond, secondChance: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH to mark second chance profile as shown
router.patch('/:userId/secondChance/:targetId', async (req, res) => {
  const { userId, targetId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.secondChanceShown.includes(targetId)) {
      user.secondChanceShown.push(targetId);
      await user.save();
    }

    res.sendStatus(200);
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
    }

    if (action === 'reject') {
      if (swiper.rejected.includes(targetId)) {
        return res.status(400).json({ message: 'Already rejected this user' });
      }

      swiper.rejected.push(targetId);
      await swiper.save();
      return res.status(200).json({ message: 'User rejected' });
    }

    return res.status(400).json({ message: 'Invalid action' });
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
