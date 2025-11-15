// config/geminiClient.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

let geminiModel;
let initializationError = null;

console.log("--- Initializing Gemini Client ---");

try {
    // Step 1: Read the API Key from the environment
    const geminiApiKey = process.env.GEMINI_API_KEY;
    console.log("Step 1: Reading GEMINI_API_KEY from .env file...");

    if (!geminiApiKey || geminiApiKey.length < 30) {
        throw new Error("API Key not found or is invalid in .env file.");
    }
    console.log("   ✅ API Key loaded successfully.");

    // Step 2: Instantiate the main GoogleGenerativeAI class
    console.log("Step 2: Instantiating GoogleGenerativeAI with the key...");
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    console.log("   ✅ GoogleGenerativeAI instance created.");

    // Step 3: Get the specific generative model.
    // --- FINAL FIX: Use the modern, recommended, and universally available model ---
    const modelNameToUse = "gemini-2.5-flash-lite";
    console.log(`Step 3: Attempting to get model: '${modelNameToUse}'...`);
    geminiModel = genAI.getGenerativeModel({ model: modelNameToUse });
    console.log("   ✅ Model retrieved successfully.");

    // If all steps passed, we are successful.
    console.log(`✅ Gemini client fully initialized and ready to use model '${modelNameToUse}'.`);

} catch (error) {
    // If ANY of the above steps fail, this block will run.
    initializationError = `AI Engine Initialization Failed. Reason: ${error.message}`;
    console.error("\n" + "=".repeat(60));
    console.error("❌ FATAL: Gemini client initialization failed.");
    console.error(`   ERROR DETAILS: ${error.message}`);
    console.error("   Please meticulously check your .env file and Google Cloud project settings.");
    console.error("=".repeat(60) + "\n");
}

export { geminiModel, initializationError };
