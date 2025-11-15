// aurachef-backend/routes/orderRoutes.js
import express from 'express';
import { simulateOrder } from '../controllers/orderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/simulate', protect, simulateOrder);

export default router;
