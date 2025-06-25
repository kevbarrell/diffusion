import express from 'express';
import Message from '../models/Message.js';

const router = express.Router();

// Get all messages between two users
router.get('/:userId/:otherUserId', async (req, res) => {
  const { userId, otherUserId } = req.params;

  try {
    const messages = await Message.find({
      $or: [
        { sender: userId, recipient: otherUserId },
        { sender: otherUserId, recipient: userId }
      ]
    }).sort('timestamp');

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message
router.post('/', async (req, res) => {
  const { sender, recipient, text } = req.body;

  if (!sender || !recipient || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const message = new Message({ sender, recipient, text });
    await message.save();
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
