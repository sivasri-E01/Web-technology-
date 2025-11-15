// aurachef-backend/controllers/recipeController.js

// Import the results of our synchronous initialization.
import { geminiModel, initializationError } from '../config/geminiClient.js';
import JSON5 from 'json5';

const generateRecipes = async (req, res) => {
    // This check is our gatekeeper. If initialization failed, we stop immediately.
    if (initializationError || !geminiModel) {
        console.error("Request failed because AI Engine is offline. Error:", initializationError);
        return res.status(503).json({ message: initializationError || "AI Culinary Engine is offline." });
    }

    try {
        let ingredients = req.user.pantry;
        // Fallback sample pantry if user pantry is empty – prevents silent empty UI
        if (!ingredients || ingredients.length === 0) {
            console.warn('[RecipeController] User pantry empty – using fallback sample ingredients.');
            ingredients = ['rice','onion','tomato','garlic','chicken','turmeric','cumin','chilli powder','ginger','butter'];
        }
        // Avoid accessing geminiModel.model (may not exist); keep the log safe.
        console.log(`[Gemini Request] Generating recipes for: [${ingredients.join(', ')}]`);

        // (Removed early return so fallback pantry always drives generation)

        const buildPrompt = (attempt) => {
            const countDirective = attempt === 1 ? 'length 4-10' : 'length EXACTLY 6';
            const emphasis = attempt === 1 ? '' : '\nREPAIR: Previous attempt truncated. Provide COMPLETE array with closing "]".';
            return `You are AuraChef Master – output strictly valid JSON only.\n\nINGREDIENTS: [${ingredients.join(', ')}]\nTASK: Produce an array (${countDirective}, majority Indian cuisine) of recipe objects.${emphasis}\nLANGUAGE: English only.\nOUTPUT RULES (CRITICAL):\n1. Output MUST be ONLY a raw JSON array. No prose, no comments, no explanations.\n2. First character MUST be '[' and last MUST be ']'. NO markdown fences/backticks.\n3. Objects MUST have keys: id, title, cuisine, description, cookTime, difficulty, image ( Exact The Same recipe Image Url from pixabay), ingredients, nutritionalInfo, steps.\n4. nutritionalInfo must have: Calories, Protein, Carbs, Fat (string values).\n5. Use double quotes, no trailing commas, no unquoted keys.\nRETURN: Only the JSON array.`;
        };

        const requestRecipes = async (attempt = 1) => {
            const prompt = buildPrompt(attempt);
            return await geminiModel.generateContent({
                contents: [ { role: 'user', parts: [{ text: prompt }] } ],
                generationConfig: {
                    maxOutputTokens: 2200,
                    temperature: 0.15,
                    responseMimeType: 'application/json'
                }
            });
        };

        let result = await requestRecipes(1);

        // Robust extraction of text across SDK variants
        let text = '';
        try {
            if (typeof result?.response?.text === 'function') {
                text = result.response.text();
            } else if (Array.isArray(result?.response?.candidates) && result.response.candidates[0]?.content?.parts) {
                text = result.response.candidates[0].content.parts.map(p => p.text || '').join('\n');
            } else {
                text = String(result?.response ?? '');
            }
        } catch (ex) {
            console.warn('Fallback extracting Gemini text:', ex?.message);
            text = '';
        }
        console.log(`[Gemini Raw Response] Length=${text?.length}`);

        // If model returned empty / near-empty output, short-circuit with descriptive error.
        if (!text || text.trim().length < 5) {
            console.error('[Gemini Empty Output] Model returned insufficient content.');
            return res.status(502).json({
                message: 'AI returned empty output',
                rawPreview: text || ''
            });
        }

        // --- Robust Parsing Pipeline ---
        const robustParseRecipes = (raw) => {
            if (!raw || typeof raw !== 'string') throw new Error('Empty AI response');
            let working = raw.replace(/[“”]/g,'"').replace(/[‘’]/g,"'").trim();
            // Fast path: attempt direct JSON.parse if it already looks like an array
            if (working.startsWith('[') && working.endsWith(']')) {
                try {
                    const direct = JSON.parse(working);
                    if (Array.isArray(direct)) return direct;
                } catch { /* fall through */ }
                // Try JSON5 on direct form
                try {
                    const j5 = JSON5.parse(working);
                    if (Array.isArray(j5)) return j5;
                } catch { /* continue to heuristics */ }
            }
            // Fence extraction if mistakenly wrapped
            const fence = working.match(/```(?:json)?\s*([\s\S]*?)```/i);
            if (fence && fence[1]) working = fence[1].trim();
            // Slice outer brackets
            const arrayMatch = working.match(/\[\s*{[\s\S]*}\s*\]/);
            if (arrayMatch) working = arrayMatch[0];
            else {
                const s = working.indexOf('[');
                const e = working.lastIndexOf(']');
                if (s === -1 || e === -1) throw new Error('Could not locate JSON array brackets');
                working = working.substring(s, e + 1);
            }
            // Clean common issues
            working = working
                .replace(/^(json|JSON|Output:?)\s*/,'')
                .replace(/,\s*]/g,']')
                .replace(/,\s*}/g,'}')
                .trim();
            // Primary parse attempt
            try {
                const parsed = JSON.parse(working);
                if (Array.isArray(parsed)) return parsed;
            } catch {/* try JSON5 next */}
            try {
                const parsed5 = JSON5.parse(working);
                if (Array.isArray(parsed5)) return parsed5;
            } catch (e) {
                throw new Error('Final parse failure after JSON & JSON5 attempts: ' + e.message);
            }
            throw new Error('Parsed structure is not an array');
        };

        const salvagePartial = (raw) => {
            const startIdx = raw.indexOf('[');
            if (startIdx === -1) return [];
            let slice = raw.substring(startIdx + 1);
            const objects = [];
            let depth = 0, current = '', inString = false, escape = false;
            for (let i = 0; i < slice.length; i++) {
                const ch = slice[i];
                current += ch;
                if (escape) { escape = false; continue; }
                if (ch === '\\') { escape = true; continue; }
                if (ch === '"') inString = !inString;
                if (inString) continue;
                if (ch === '{') depth++;
                if (ch === '}') depth--;
                if (depth === 0 && ch === '}') {
                    let objText = current.trim();
                    if (objText.endsWith(',')) objText = objText.slice(0, -1);
                    try {
                        const parsed = JSON5.parse(objText);
                        objects.push(parsed);
                        current = '';
                    } catch { /* ignore bad fragment */ }
                }
            }
            return objects;
        };

        let recipes;
        try {
            recipes = robustParseRecipes(text);
            // Normalize fields
            recipes = recipes.map((r, idx) => {
                const safe = { ...r };
                if (typeof safe.id !== 'number') safe.id = idx + 1;
                if (typeof safe.title !== 'string') safe.title = `Recipe ${safe.id}`;
                if (typeof safe.description !== 'string') safe.description = '';
                if (!Array.isArray(safe.steps)) safe.steps = [];
                if (!Array.isArray(safe.ingredients)) safe.ingredients = [];
                if (safe['Nutritonal Information'] && !safe.nutritionalInfo) safe.nutritionalInfo = safe['Nutritonal Information'];
                if (safe['Nutritional Information'] && !safe.nutritionalInfo) safe.nutritionalInfo = safe['Nutritional Information'];
                // Ensure nutritionalInfo minimal shape
                if (typeof safe.nutritionalInfo !== 'object' || Array.isArray(safe.nutritionalInfo)) {
                    safe.nutritionalInfo = { Calories: 'N/A', Protein: 'N/A', Carbs: 'N/A', Fat: 'N/A' };
                }
                return safe;
            });
            console.log(`[Gemini Response] Parsed ${recipes.length} recipes. Raw length=${text?.length}`);
        } catch (e) {
            const isTruncated = /end of input|locate JSON array|Final parse failure/i.test(e.message);
            if (isTruncated) {
                console.warn('[Parse Warning] Possible truncated JSON. Retrying ...');
                result = await requestRecipes(2);
                try {
                    if (typeof result?.response?.text === 'function') {
                        text = result.response.text();
                    } else if (Array.isArray(result?.response?.candidates) && result.response.candidates[0]?.content?.parts) {
                        text = result.response.candidates[0].content.parts.map(p => p.text || '').join('\n');
                    } else {
                        text = String(result?.response ?? '');
                    }
                } catch { text = ''; }
                console.log(`[Gemini Raw Response Retry] Length=${text?.length}`);
                try {
                    recipes = robustParseRecipes(text);
                    recipes = recipes.map((r, idx) => {
                        const safe = { ...r };
                        if (typeof safe.id !== 'number') safe.id = idx + 1;
                        if (typeof safe.title !== 'string') safe.title = `Recipe ${safe.id}`;
                        if (typeof safe.description !== 'string') safe.description = '';
                        if (!Array.isArray(safe.steps)) safe.steps = [];
                        if (!Array.isArray(safe.ingredients)) safe.ingredients = [];
                        if (safe['Nutritonal Information'] && !safe.nutritionalInfo) safe.nutritionalInfo = safe['Nutritonal Information'];
                        if (safe['Nutritional Information'] && !safe.nutritionalInfo) safe.nutritionalInfo = safe['Nutritional Information'];
                        if (typeof safe.nutritionalInfo !== 'object' || Array.isArray(safe.nutritionalInfo)) {
                            safe.nutritionalInfo = { Calories: 'N/A', Protein: 'N/A', Carbs: 'N/A', Fat: 'N/A' };
                        }
                        return safe;
                    });
                    console.log(`[Gemini Response] Parsed ${recipes.length} recipes on retry.`);
                } catch (retryErr) {
                    console.error('[Retry Parse Failed] Attempting salvage ...');
                    const salvaged = salvagePartial(text);
                    if (salvaged.length >= 2) {
                        console.warn(`[Salvage Success] Returning ${salvaged.length} partial recipes.`);
                        recipes = salvaged.map((r, idx) => ({
                            id: typeof r.id === 'number' ? r.id : idx + 1,
                            title: typeof r.title === 'string' ? r.title : `Recipe ${idx + 1}`,
                            cuisine: r.cuisine || 'Indian',
                            description: r.description || '',
                            cookTime: r.cookTime || '30 minutes',
                            difficulty: r.difficulty || 'Medium',
                            image: r.image || 'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?auto=format&fit=crop&w=1170&q=80',
                            ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
                            nutritionalInfo: (typeof r.nutritionalInfo === 'object' && !Array.isArray(r.nutritionalInfo)) ? r.nutritionalInfo : { Calories: 'N/A', Protein: 'N/A', Carbs: 'N/A', Fat: 'N/A' },
                            steps: Array.isArray(r.steps) ? r.steps : []
                        }));
                    } else {
                        console.error('--- PARSING FAILED (FINAL) ---');
                        console.error('Reason:', retryErr.message);
                        return res.status(502).json({
                            message: 'AI response parsing failed',
                            error: retryErr.message,
                            rawPreview: (text||'').slice(0,250)
                        });
                    }
                }
            } else {
                console.error('--- PARSING FAILED ---');
                console.error('Reason:', e.message);
                console.error('Raw preview (first 400):', (text||'').slice(0,400));
                return res.status(502).json({
                    message: 'AI response parsing failed',
                    error: e.message,
                    rawPreview: (text||'').slice(0,250)
                });
            }
        }
        res.status(200).json(recipes);
    } catch (error) {
        console.error("[Controller Runtime Error]", error.message);
        // This will catch runtime API errors from Google.
        res.status(500).json({ message: `Google API Error: ${error.message}` });
    }
};

export { generateRecipes };

// --- New: Generate a single recipe by user query and compare with pantry ---
export const generateRecipeByQuery = async (req, res) => {
    if (initializationError || !geminiModel) {
        return res.status(503).json({ message: initializationError || 'AI Culinary Engine is offline.' });
    }
    try {
        const query = (req.body?.query || '').toString().trim();
        if (!query) return res.status(400).json({ message: 'Missing recipe query' });
        let pantry = req.user?.pantry || [];
        if (!Array.isArray(pantry)) pantry = [];
        if (pantry.length === 0) pantry = ['rice','onion','tomato','garlic','ginger','turmeric','cumin','chilli powder','butter'];

        console.log(`[Gemini Agent] Query='${query}' pantry=[${pantry.join(', ')}]`);

        const prompt = `You are AuraChef Master. Create ONE complete recipe tailored to the user's requested dish and pantry.\n\nREQUESTED_DISH: "${query}"\nPANTRY: [${pantry.join(', ')}]\nOUTPUT: Return ONLY a JSON object (no array, no prose) with EXACT keys: id (number), title (string), cuisine (string), description (string), cookTime (string), difficulty ("Easy"|"Medium"|"Hard"), image (HTTPS URL from images.unsplash.com or cdn.pixabay.com), ingredients (array 8-16 strings), nutritionalInfo (object with Calories, Protein, Carbs, Fat as strings), steps (array 6-14 strings). Ensure steps are sequential and ingredients reflect the dish. Use English. Strict JSON.`;

        const result = await geminiModel.generateContent({
            contents: [ { role: 'user', parts: [{ text: prompt }] } ],
            generationConfig: { maxOutputTokens: 1800, temperature: 0.15, responseMimeType: 'application/json' }
        });
        let text = '';
        try {
            if (typeof result?.response?.text === 'function') text = result.response.text();
            else if (Array.isArray(result?.response?.candidates) && result.response.candidates[0]?.content?.parts) {
                text = result.response.candidates[0].content.parts.map(p => p.text || '').join('\n');
            } else { text = String(result?.response ?? ''); }
        } catch { text=''; }

        // Chairman request: log Gemini raw output for diagnostics
        console.log(`[Gemini Agent Raw] length=${(text||'').length}`);
        if (text) {
            const preview = text.slice(0, 300).replace(/\n/g,' ');
            console.log('[Gemini Agent Preview]', preview);
        }

        if (!text || text.trim().length < 5) {
            return res.status(502).json({ message: 'AI returned empty output', rawPreview: text || '' });
        }

        const parseOne = (raw) => {
            let working = raw.replace(/[“”]/g,'"').replace(/[‘’]/g,"'").trim();
            // If it's an array by mistake, parse and take first
            if (working.startsWith('[')) {
                try { const arr = JSON.parse(working); if (Array.isArray(arr)) return arr[0]; } catch {}
                try { const arr5 = JSON5.parse(working); if (Array.isArray(arr5)) return arr5[0]; } catch {}
            }
            // Fenced code
            const fence = working.match(/```(?:json)?\s*([\s\S]*?)```/i);
            if (fence && fence[1]) working = fence[1].trim();
            // Trim trailing commas
            working = working.replace(/,\s*}/g,'}');
            try { const obj = JSON.parse(working); if (obj && typeof obj === 'object') return obj; } catch {}
            const obj5 = JSON5.parse(working); if (obj5 && typeof obj5 === 'object') return obj5;
            throw new Error('Could not parse recipe object');
        };

        let recipe = parseOne(text) || {};
        console.log('[Gemini Agent Parsed Keys]', Object.keys(recipe||{}));
        // Normalize
        if (typeof recipe.id !== 'number') recipe.id = 1;
        if (typeof recipe.title !== 'string') recipe.title = query;
        if (!Array.isArray(recipe.ingredients)) recipe.ingredients = [];
        if (!Array.isArray(recipe.steps)) recipe.steps = [];
        if (!recipe.nutritionalInfo || typeof recipe.nutritionalInfo !== 'object') {
            recipe.nutritionalInfo = { Calories: 'N/A', Protein: 'N/A', Carbs: 'N/A', Fat: 'N/A' };
        }
        // Image normalization
        const normalizeImageUrl = (url) => {
            if (!url || typeof url !== 'string') return null;
            let u = url.trim().replace(/^"|"$/g,'');
            if (!/^https:\/\//i.test(u)) return null;
            // Force Unsplash params if Unsplash
            if (/^https:\/\/images\.unsplash\.com\//i.test(u)) {
                if (!u.includes('auto=format')) {
                    u += (u.includes('?') ? '&' : '?') + 'auto=format&fit=crop&w=640&q=80';
                }
            }
            return u;
        };
        recipe.image = normalizeImageUrl(recipe.image) || 'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?auto=format&fit=crop&w=640&q=80';

        // Compare ingredients vs pantry with fuzzy/semantic matching
        const synonyms = new Map([
            ['panner','paneer'], ['paneer','paneer'], ['cottage cheese','paneer'],
            ['chilli','chili'], ['chilies','chilli'], ['chillies','chilli'], ['green chilli','chilli'],
            ['tomatoe','tomato'], ['tamato','tomato'], ['tomatos','tomato'],
            ['curd','yogurt'], ['yoghurt','yogurt'],
            ['capsicum','bell pepper'], ['bell pepper','capsicum'],
            ['coriander leaves','cilantro'], ['cilantro','cilantro'], ['coriander','coriander'],
            ['garam masala','garam masala']
        ]);

        const normalize = (s) => (s||'').toString().toLowerCase()
            .replace(/[^a-z0-9\s]/g,' ')
            .replace(/\s+/g,' ')
            .trim();
        const singular = (s) => s.replace(/(ses|xes|zes|ches|shes)$/,'s')
                                  .replace(/ies$/,'y')
                                  .replace(/s$/,'');
        const canonical = (s) => {
            let n = normalize(s);
            n = synonyms.get(n) || n; // direct synonym mapping
            n = singular(n);
            return n;
        };
        const pantryCanon = pantry.map(canonical);
        const pantrySet = new Set(pantryCanon);

        const wordContains = (needle, hay) => {
            // hay contains needle as whole word
            const re = new RegExp(`(^|\s)${needle.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}(\s|$)`);
            return re.test(hay);
        };
        const levenshtein = (a,b) => {
            const m = a.length, n = b.length; if (m===0) return n; if (n===0) return m;
            const dp = Array.from({length:m+1},()=>Array(n+1).fill(0));
            for (let i=0;i<=m;i++) dp[i][0]=i; for (let j=0;j<=n;j++) dp[0][j]=j;
            for (let i=1;i<=m;i++) for (let j=1;j<=n;j++) {
                const cost = a[i-1]===b[j-1]?0:1;
                dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
            }
            return dp[m][n];
        };

        const isCoveredByPantry = (ingredient) => {
            const inc = canonical(ingredient);
            if (!inc) return true; // ignore empty
            // Exact canonical match
            if (pantrySet.has(inc)) return true;
            // Word containment: if pantry item appears as word in ingredient phrase or vice versa
            for (const p of pantryCanon) {
                if (wordContains(p, inc) || wordContains(inc, p)) return true;
                // fuzzy: small edit distance for common misspells (threshold 1-2 for <=7 chars)
                if (Math.min(p.length, inc.length) >= 4) {
                    const d = levenshtein(p, inc);
                    if (d <= 2) return true;
                }
            }
            return false;
        };

        const missing = Array.from(new Set(
            (recipe.ingredients||[])
                .filter(it => typeof it === 'string' && it.trim())
                .filter(it => !isCoveredByPantry(it))
                .map(it => it.trim())
        )).slice(0, 20);

        return res.status(200).json({ recipe, missing });
    } catch (err) {
        console.error('[Agent Controller Error]', err.message);
        return res.status(500).json({ message: 'Agent generation failed', error: err.message });
    }
};

// --- New: Smart diff between recipe ingredients and pantry ---
export const diffIngredientsSmart = async (req, res) => {
    try {
        const ingredients = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];
        let pantry = Array.isArray(req.body?.pantry) ? req.body.pantry : (Array.isArray(req.user?.pantry) ? req.user.pantry : []);
        if (!Array.isArray(ingredients) || ingredients.length === 0) {
            return res.status(400).json({ message: 'ingredients array required' });
        }

        const norm = (s) => (s||'').toString().toLowerCase().trim()
            .replace(/\s+/g,' ')
            .replace(/[\.\,\(\)\[\]\-]/g,'')
            .replace(/\b(fresh|chopped|sliced|minced|diced|optional|to taste)\b/g,'')
            .trim();
        const synonyms = new Map([
            ['paneer','paneer'], ['cottage cheese','paneer'],
            ['curd','yogurt'], ['yoghurt','yogurt'], ['yogurt','yogurt'],
            ['maida','all purpose flour'], ['all-purpose flour','all purpose flour'], ['ap flour','all purpose flour'],
            ['capsicum','bell pepper'], ['bell pepper','bell pepper'],
            ['coriander leaves','cilantro'], ['cilantro','cilantro'],
            ['coriander','coriander powder'], ['dhaniya powder','coriander powder'], ['dhania powder','coriander powder'],
            ['cumin','cumin seeds'], ['jeera','cumin seeds'],
            ['green chilli','green chili'], ['green chillies','green chili'], ['green chili','green chili'],
            ['chickpeas','chickpeas'], ['garbanzo beans','chickpeas'],
            ['semolina','semolina'], ['sooji','semolina'], ['suji','semolina'], ['rava','semolina'],
            ['eggplant','eggplant'], ['aubergine','eggplant'], ['brinjal','eggplant'],
            ['okra','okra'], ['ladyfinger','okra'], ['bhindi','okra'],
            ['pigeon peas','toor dal'], ['toor dal','toor dal'], ['tuvar dal','toor dal'], ['arhar dal','toor dal']
        ]);
        const canon = (s) => synonyms.get(norm(s)) || norm(s);
        const pantrySet = new Set((pantry||[]).map(canon));
        const localMissing = ingredients
            .map(canon)
            .filter(x => x && !pantrySet.has(x))
            .filter((x,i,arr) => arr.indexOf(x)===i)
            .slice(0, 40);

        // If AI not available, return local
        if (initializationError || !geminiModel) {
            return res.status(200).json({ missing: localMissing });
        }

        // Ask Gemini for canonical diff only
        const prompt = `You are a precise kitchen inventory assistant.\nGiven a RECIPE_INGREDIENTS array and a PANTRY array, return ONLY the list of ingredients that are required for the recipe but NOT available in the pantry.\nRules:\n- Map synonyms and regional terms (e.g., paneer=cottage cheese, capsicum=bell pepper, curd=yogurt).\n- Ignore optional words like 'fresh', 'chopped', 'to taste'.\n- Canonicalize names for grocery purchase (lowercase, simple names).\n- Return ONLY a JSON array of strings (no prose, no objects).\n- Max 30 items.\n\nRECIPE_INGREDIENTS: ${JSON.stringify(ingredients)}\nPANTRY: ${JSON.stringify(pantry)}\nOUTPUT: JSON array of missing items only.`;

        const result = await geminiModel.generateContent({
            contents: [ { role:'user', parts: [{ text: prompt }] } ],
            generationConfig: { maxOutputTokens: 800, temperature: 0.1, responseMimeType: 'application/json' }
        });
        let text = '';
        try {
            if (typeof result?.response?.text === 'function') text = result.response.text();
            else if (Array.isArray(result?.response?.candidates) && result.response.candidates[0]?.content?.parts) {
                text = result.response.candidates[0].content.parts.map(p => p.text || '').join('\n');
            } else text = String(result?.response ?? '');
        } catch { text=''; }

        const parseArray = (raw) => {
            let w = (raw||'').toString().replace(/[“”]/g,'"').replace(/[‘’]/g,"'").trim();
            if (w.startsWith('[') && w.endsWith(']')) {
                try { const a = JSON.parse(w); if (Array.isArray(a)) return a; } catch {}
                try { const a5 = JSON5.parse(w); if (Array.isArray(a5)) return a5; } catch {}
            }
            const m = w.match(/\[\s*[\s\S]*]\s*$/); if (m) w = m[0];
            w = w.replace(/,\s*]/g,']').trim();
            try { const a = JSON.parse(w); if (Array.isArray(a)) return a; } catch {}
            const a5 = JSON5.parse(w); if (Array.isArray(a5)) return a5;
            return [];
        };
        const aiMissing = parseArray(text)
            .map(s => canon(s))
            .filter(x => x)
            .filter((x,i,arr) => arr.indexOf(x)===i);

        const finalMissing = aiMissing.length ? aiMissing : localMissing;
        return res.status(200).json({ missing: finalMissing });
    } catch (err) {
        console.error('[Smart Diff Error]', err.message);
        // Fallback to local diff if available in request
        const ingredients = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];
        let pantry = Array.isArray(req.body?.pantry) ? req.body.pantry : (Array.isArray(req.user?.pantry) ? req.user.pantry : []);
        const norm = (s) => (s||'').toString().toLowerCase().trim()
            .replace(/\s+/g,' ')
            .replace(/[\.\,\(\)\[\]\-]/g,'')
            .replace(/\b(fresh|chopped|sliced|minced|diced|optional|to taste)\b/g,'')
            .trim();
        const synonyms = new Map([
            ['paneer','paneer'], ['cottage cheese','paneer'],
            ['curd','yogurt'], ['yogurt','yogurt'],
            ['capsicum','bell pepper'], ['bell pepper','bell pepper']
        ]);
        const canon = (s) => synonyms.get(norm(s)) || norm(s);
        const pantrySet = new Set((pantry||[]).map(canon));
        const localMissing = (ingredients||[]).map(canon).filter(x => x && !pantrySet.has(x)).filter((x,i,arr)=>arr.indexOf(x)===i);
        return res.status(200).json({ missing: localMissing });
    }
};
