// routes/userRoutes.js
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

// ✅ Centralized shaping so normal + second-chance + crushes match exactly
const shapeCandidate = (candidate, userCoords) => {
  const photo0 =
    Array.isArray(candidate.photos) && candidate.photos.length > 0
      ? candidate.photos[0]
      : null;

  const candidateCoords = getZipCoords(candidate.zipCode);
  const dist = haversineMiles(userCoords, candidateCoords);

  return {
    _id: candidate._id,
    name: candidate.name,
    age: candidate.age,
    gender: candidate.gender,
    zipCode: candidate.zipCode,

    image: photo0 || candidate.image,
    photos: candidate.photos || [],

    bio: candidate.aboutMe || candidate.bio,
    aboutMe: candidate.aboutMe || null,
    headline: candidate.headline || null,

    city: candidate.city || null,
    state: candidate.state || null,

    denomination: candidate.denomination || null,
    maritalStatus: candidate.maritalStatus || null,
    hasChildren: candidate.hasChildren || null,

    drinking: candidate.drinking || null,
    smoking: candidate.smoking || null,
    hobbies: Array.isArray(candidate.hobbies)
      ? candidate.hobbies
      : candidate.hobbies || null,

    distanceMiles: typeof dist === 'number' ? dist : null,
  };
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
      return res
        .status(400)
        .json({ message: 'Valid 5-digit ZIP code is required.' });
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

    const swipedIds = [...user.likes.map(String), ...user.matches.map(String)];

    let candidates = await User.find({
      _id: { $ne: userId, $nin: swipedIds },
      gender: oppositeGender,
    }).select(
      [
        'name',
        'age',
        'image',
        'bio',
        'gender',
        'photos',
        'aboutMe',
        'headline',
        'zipCode',
        'city',
        'state',
        'denomination',
        'maritalStatus',
        'hasChildren',
        'drinking',
        'smoking',
        'hobbies',
      ].join(' ')
    );

    candidates = candidates.filter((c) => !user.rejected.includes(c._id));

    const userCoords = getZipCoords(user.zipCode);

    const shaped = candidates.map((c) => shapeCandidate(c, userCoords));

    if (shaped.length > 0) {
      return res.status(200).json({ users: shaped, secondChance: false });
    }

    const secondChanceIds = user.rejected.filter(
      (id) => !user.secondChanceShown.includes(id)
    );

    const secondChanceUsers = await User.find({
      _id: { $in: secondChanceIds },
      gender: oppositeGender,
    }).select(
      [
        'name',
        'age',
        'image',
        'bio',
        'gender',
        'photos',
        'aboutMe',
        'headline',
        'zipCode',
        'city',
        'state',
        'denomination',
        'maritalStatus',
        'hasChildren',
        'drinking',
        'smoking',
        'hobbies',
      ].join(' ')
    );

    const shapedSecond = secondChanceUsers.map((c) =>
      shapeCandidate(c, userCoords)
    );

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

/**
 * ✅ NEW: Get "My Crushes" (people I swiped right on)
 * GET /api/users/:userId/crushes
 */
router.get('/:userId/crushes', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId).populate(
      'likes',
      [
        'name',
        'age',
        'image',
        'bio',
        'gender',
        'photos',
        'aboutMe',
        'headline',
        'zipCode',
        'city',
        'state',
        'denomination',
        'maritalStatus',
        'hasChildren',
        'drinking',
        'smoking',
        'hobbies',
      ].join(' ')
    );

    if (!user) return res.status(404).json({ message: 'User not found' });

    const userCoords = getZipCoords(user.zipCode);

    const shaped = (user.likes || []).map((c) => shapeCandidate(c, userCoords));

    res.status(200).json(shaped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * ✅ NEW: Remove a crush (un-like)
 * DELETE /api/users/:userId/crushes/:targetId
 * - removes targetId from likes
 * - if they were a match, removes from BOTH users' matches arrays too
 */
router.delete('/:userId/crushes/:targetId', async (req, res) => {
  const { userId, targetId } = req.params;

  try {
    const user = await User.findById(userId);
    const target = await User.findById(targetId);

    if (!user || !target) {
      return res.status(404).json({ message: 'User not found' });
    }

    // remove like
    user.likes = (user.likes || []).filter((id) => String(id) !== String(targetId));

    // if they were matched, unmatch both sides
    const wasMatch =
      (user.matches || []).some((id) => String(id) === String(targetId)) ||
      (target.matches || []).some((id) => String(id) === String(userId));

    if (wasMatch) {
      user.matches = (user.matches || []).filter((id) => String(id) !== String(targetId));
      target.matches = (target.matches || []).filter((id) => String(id) !== String(userId));
      await target.save();
    }

    await user.save();

    res.status(200).json({ message: 'Crush removed', wasMatch });
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
        if (!swiper.matches.includes(targetId)) swiper.matches.push(targetId);
        if (!target.matches.includes(userId)) target.matches.push(userId);

        await target.save();
        await swiper.save();

        return res.status(200).json({ message: 'It’s a match!', match: true });
      }

      await swiper.save();
      return res.status(200).json({ message: 'Swipe recorded', match: false });
    }

    if (action === 'reject') {
      // ✅ If they were previously liked/matched, cleanly remove those relationships
      swiper.likes = (swiper.likes || []).filter((id) => String(id) !== String(targetId));
      swiper.matches = (swiper.matches || []).filter((id) => String(id) !== String(targetId));
      target.matches = (target.matches || []).filter((id) => String(id) !== String(userId));

      if (!swiper.rejected.includes(targetId)) {
        swiper.rejected.push(targetId);
      }

      await target.save();
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
    const user = await User.findById(userId).populate(
      'matches',
      [
        'name',
        'age',
        'image',
        'bio',
        'photos',
        'aboutMe',
        'headline',
        'denomination',
        'maritalStatus',
        'hasChildren',
        'drinking',
        'smoking',
        'hobbies',
        'zipCode',
      ].join(' ')
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const shapedMatches = (user.matches || []).map((m) => {
      const photo0 =
        Array.isArray(m.photos) && m.photos.length > 0 ? m.photos[0] : null;

      return {
        ...m.toObject(),
        image: photo0 || m.image,
        bio: m.aboutMe || m.bio,
      };
    });

    res.status(200).json(shapedMatches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
