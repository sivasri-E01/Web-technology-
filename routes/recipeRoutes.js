// aurachef-backend/routes/recipeRoutes.js
import express from 'express';
const router = express.Router();
import { generateRecipes, generateRecipeByQuery, diffIngredientsSmart } from '../controllers/recipeController.js';
import { protect } from '../middleware/authMiddleware.js'; // Import protect

// Apply the middleware to the route
router.get('/generate', protect, generateRecipes);
router.post('/agent', protect, generateRecipeByQuery);
router.post('/diff', protect, diffIngredientsSmart);

export default router;