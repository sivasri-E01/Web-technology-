// model_checker_flash_lite.js
import dotenv from "dotenv";
dotenv.config();

import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";

console.log("--- AuraChef: Flash-Lite Model Checker ---");

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("❌ GEMINI_API_KEY missing. Set GEMINI_API_KEY=AIza... in your .env and restart.");
  process.exit(1);
}

async function listModels() {
  try {
    console.log("\n1) Listing accessible models (via REST)...");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const json = await res.json();
    if (!res.ok) {
      console.error("Failed to list models. HTTP status:", res.status);
      console.error("Response:", JSON.stringify(json, null, 2));
      return null;
    }
    const models = json.models || [];
    console.log(`Found ${models.length} models. Showing names that include "flash" or "flash-lite":`);
    models
      .filter(m => /flash/i.test(m.name))
      .slice(0, 50)
      .forEach(m => console.log(" -", m.name));
    return models;
  } catch (err) {
    console.error("Error listing models:", err.message || err);
    return null;
  }
}

async function testGenerate() {
  try {
    console.log("\n2) Testing generateContent with model: gemini-2.5-flash-lite");

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    // Prompt you requested (cleaned)
    const prompt = "Hi, good morning. Let us check the output.";

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: 32,
        temperature: 0.0
      }
    });

    const text = result?.response?.text?.();
    if (text) {
      console.log("✅ SUCCESS: Model output:");
      console.log("---- BEGIN OUTPUT ----");
      console.log(text.trim());
      console.log("----  END OUTPUT  ----");
    } else {
      console.error("❌ No text returned from generateContent. Full result object:");
      console.error(result);
    }
  } catch (err) {
    console.error("❌ generateContent failed:");
    if (err?.message) console.error("ERROR MESSAGE:", err.message);
    if (err?.response) {
      console.error("API response (debug):", err.response);
    }
  }
}

(async function main() {
  await listModels();
  await testGenerate();
})();
