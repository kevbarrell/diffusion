import express from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import User from '../models/User.js';

const router = express.Router();

// 🔹 Get list of conversations (must be FIRST)
router.get('/conversations/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const messages = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: new mongoose.Types.ObjectId(userId) },
            { recipient: new mongoose.Types.ObjectId(userId) }
          ]
        }
      },
      {
        $addFields: {
          senderStr: { $toString: '$sender' },
          recipientStr: { $toString: '$recipient' }
        }
      },
      {
        $addFields: {
          otherUserId: {
            $cond: {
              if: { $eq: ['$senderStr', userId] },
              then: '$recipient',
              else: '$sender'
            }
          }
        }
      },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$otherUserId',
          lastMessage: { $first: '$text' },
          timestamp: { $first: '$timestamp' },
          unread: {
            $first: {
              $cond: [
                { $and: [
                  { $ne: ['$senderStr', userId] },
                  { $eq: ['$read', false] }
                ] },
                true,
                false
              ]
            }
          }
        }
      }
    ]);

    const results = await Promise.all(
      messages.map(async (msg) => {
        const user = await User.findById(msg._id).lean();
        if (!user) return null;

        return {
          _id: msg._id,
          lastMessage: msg.lastMessage,
          timestamp: msg.timestamp,
          unread: msg.unread,
          otherUser: {
            _id: user._id,
            name: user.name,
            image: user.image
          }
        };
      })
    );

    res.json(results.filter(Boolean));
  } catch (err) {
    console.error('Failed to fetch conversations:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// 🔹 Get full message thread between two users (put this AFTER `/conversations/:userId`)
router.get('/:userId/:otherUserId', async (req, res) => {
  const { userId, otherUserId } = req.params;

  try {
    const messages = await Message.find({
      $or: [
        { sender: userId, recipient: otherUserId },
        { sender: otherUserId, recipient: userId }
      ]
    }).sort({ timestamp: 1 });

    // Mark all messages sent to the current user as read
    await Message.updateMany(
      { sender: otherUserId, recipient: userId, read: false },
      { $set: { read: true } }
    );

    res.json(messages);
  } catch (err) {
    console.error('Error fetching thread:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// 🔹 Send a new message
router.post('/', async (req, res) => {
  const { sender, recipient, text } = req.body;

  if (!sender || !recipient || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const message = new Message({
      sender,
      recipient,
      text,
      timestamp: new Date(),
      read: false
    });

    await message.save();
    res.status(201).json(message);
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
