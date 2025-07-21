import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: Number,
  image: { type: String },
  bio: String,
  gender: { type: String, enum: ['male', 'female'] },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  matches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  rejected: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  secondChanceShown: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Editable profile fields
  photos: [String],
  location: String,
  denomination: String,
  maritalStatus: String,
  drinking: String,
  smoking: String,
  hobbies: [String],
  aboutMe: String,

  // Tracks if user has saved profile info
  profileCompleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    try {
      this.password = await bcrypt.hash(this.password, 10);
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;
