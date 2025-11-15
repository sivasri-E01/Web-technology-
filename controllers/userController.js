// aurachef-backend/controllers/userController.js
import User from '../models/userModel.js';
import generateToken from '../utils/generateToken.js';

// Public Routes
// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Please provide name, email and password' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
        return res.status(400).json({ message: 'User already exists with this email' });
    }

    const user = await User.create({ name, email, password });

    if (user) {
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            pantry: user.pantry,
            token: generateToken(user._id),
        });
    } else {
        res.status(400).json({ message: 'Invalid user data' });
    }
};

// @desc    Authenticate user & get token
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            pantry: user.pantry,
            token: generateToken(user._id),
        });
    } else {
        res.status(401).json({ message: 'Invalid email or password' });
    }
};


// --- NEW PRIVATE ROUTES ---

// @desc    Get user profile (including pantry)
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
    // req.user is attached by the 'protect' middleware
    const user = req.user;
    if (user) {
        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            pantry: user.pantry,
        });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

// @desc    Update user pantry
// @route   PUT /api/users/pantry
// @access  Private
const updateUserPantry = async (req, res) => {
    const user = await User.findById(req.user._id);

    if (user) {
        // We expect the entire new pantry array in the body
        user.pantry = req.body.pantry || user.pantry;
        const updatedUser = await user.save();

        res.json({
            message: 'Pantry updated successfully',
            pantry: updatedUser.pantry,
        });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

// @desc    Update user profile (email and/or password)
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { email, password } = req.body;

        // Update email if provided and different
        if (email && email !== user.email) {
            const exists = await User.findOne({ email });
            if (exists) {
                return res.status(400).json({ message: 'Email already in use' });
            }
            user.email = email;
        }

        // Update password if provided
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ message: 'Password must be at least 6 characters' });
            }
            user.password = password; // Will be hashed by pre-save middleware
        }

        const updated = await user.save();
        return res.json({
            _id: updated._id,
            name: updated.name,
            email: updated.email,
            pantry: updated.pantry,
            token: generateToken(updated._id),
            message: 'Profile updated successfully'
        });
    } catch (err) {
        console.error('Update profile error:', err);
        return res.status(500).json({ message: 'Server error updating profile' });
    }
};

export { registerUser, loginUser, getUserProfile, updateUserPantry, updateUserProfile };
