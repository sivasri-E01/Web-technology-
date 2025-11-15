// aurachef-backend/routes/userRoutes.js
import express from 'express';
const router = express.Router();
import {
    registerUser,
    loginUser,
    getUserProfile,
    updateUserPantry,
    updateUserProfile
} from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Private routes (protected by middleware)
router.route('/profile').get(protect, getUserProfile).put(protect, updateUserProfile);
router.route('/pantry').put(protect, updateUserPantry);

export default router;