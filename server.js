require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const FB = require('fb'); 
const https = require('https'); // Import the built-in https module for the test

const { db, initializeDatabase } = require('./database'); 
const Papa = require('papaparse');

const app = express();
const PORT = process.env.PORT || 3000;

// --- NETWORK DIAGNOSTIC TEST ---
// This code will run once when the server starts to test connectivity.
function checkFacebookConnectivity() {
    console.log("Running network diagnostic test to Facebook Graph API...");
    const options = {
        hostname: 'graph.facebook.com',
        port: 443,
        path: '/v20.0/me', // A simple endpoint that should respond
        method: 'GET',
        timeout: 5000 // 5 second timeout
    };

    const req = https.request(options, (res) => {
        if (res.statusCode === 200 || res.statusCode === 400) { // 400 is also a success, it means we connected but didn't provide a token
            console.log("\x1b[32m%s\x1b[0m", "SUCCESS: Connection to Facebook Graph API was successful.");
        } else {
            console.error("\x1b[31m%s\x1b[0m", `FAILURE: Connected, but received an unexpected status code: ${res.statusCode}`);
        }
    });

    req.on('error', (e) => {
        console.error("\x1b[31m%s\x1b[0m", `FAILURE: Could not connect to Facebook Graph API. Error: ${e.message}`);
        console.error("This is likely a network issue (firewall, proxy, or ISP) on your machine, not a code issue.");
    });
    
    req.on('timeout', () => {
        req.destroy();
        console.error("\x1b[31m%s\x1b[0m", "FAILURE: Connection to Facebook Graph API timed out (ETIMEDOUT).");
        console.error("This strongly indicates a network issue (firewall, proxy, or ISP) is blocking the connection.");
    });

    req.end();
}


// --- Middleware --
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));
app.use(express.static('.'));

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- API Routes ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error("Database error during login:", err);
            return res.status(500).json({ message: 'Server error during login.' });
        }
        if (!user) {
            console.log(`Login attempt failed: User "${username}" not found.`);
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
                 console.error("Bcrypt error during login:", err);
                 return res.status(500).json({ message: 'Server error during password check.' });
            }
            if (!isMatch) {
                console.log(`Login attempt failed for "${username}": Password does not match.`);
                return res.status(401).json({ message: 'Invalid username or password.' });
            }
            
            const accessToken = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '8h' });
            res.json({ accessToken });
        });
    });
});

app.post('/api/ai-insight', authenticateToken, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ message: 'A prompt is required.' });
    }
    try {
        const insight = await callGeminiAPI(prompt);
        const cleanedInsight = insight.replace(/```html/g, '').replace(/```/g, '').trim();
        res.json({ insight: cleanedInsight });
    } catch (error) {
        console.error('Gemini API call for insight failed:', error);
        res.status(500).json({ message: 'Failed to get AI insight.' });
    }
});


app.post('/api/sentiment', authenticateToken, async (req, res) => {
    const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

    if (!pageAccessToken || pageAccessToken === 'your_token_here') {
        return res.status(500).json({ message: 'Facebook Page Access Token is not configured on the server.' });
    }

    FB.setAccessToken(pageAccessToken);

    try {
        const pageInfo = await FB.api('/me', { fields: 'id,name' });
        const pageId = pageInfo.id;

        const postsResponse = await FB.api(`/${pageId}/posts`, { fields: 'id,message', limit: 5 });
        if (!postsResponse || !postsResponse.data || postsResponse.data.length === 0) {
            return res.json({ scores: { positive: 0, neutral: 0, negative: 0 }, mentions: [] });
        }

        const commentPromises = postsResponse.data.map(post => 
            FB.api(`/${post.id}/comments`, { fields: 'message,from' })
        );
        const commentResponses = await Promise.all(commentPromises);
        const allComments = commentResponses.flatMap(response => response.data);

        if (allComments.length === 0) {
             return res.json({ scores: { positive: 0, neutral: 0, negative: 0 }, mentions: [{ sentiment: 'neutral', author: 'System', text: 'Found recent posts, but no comments to analyze.' }] });
        }

        const sentimentPromises = allComments.map(async (comment) => {
            if (!comment.message) return null;
            const prompt = `Classify the sentiment of the following comment as 'positive', 'negative', or 'neutral'. Respond with only one of those three words. Comment: "${comment.message}"`;
            const sentiment = await callGeminiAPI(prompt);
            return {
                sentiment: sentiment.toLowerCase().trim(),
                author: comment.from?.name || 'A user',
                text: comment.message
            };
        });

        const analyzedMentions = (await Promise.all(sentimentPromises)).filter(Boolean);

        const scores = { positive: 0, neutral: 0, negative: 0 };
        analyzedMentions.forEach(mention => {
            if (scores[mention.sentiment] !== undefined) {
                scores[mention.sentiment]++;
            }
        });

        res.json({ scores, mentions: analyzedMentions.slice(0, 3) });

    } catch (error) {
        console.error('Facebook API or Gemini API call failed:', error);
        res.status(500).json({ message: `Failed to get Facebook sentiment data. Error: ${error.message}` });
    }
});


app.post('/api/analyze', authenticateToken, (req, res) => {
    try {
        const csvData = req.body;
        if (!csvData) return res.status(400).json({ message: 'No data provided.' });
        
        const parsedResults = Papa.parse(csvData, { header: true, skipEmptyLines: true });
        const dataToProcess = parsedResults.data;
        const headers = parsedResults.meta.fields;

        db.get('SELECT settings FROM users WHERE id = ?', [req.user.id], (err, row) => {
            if (err) return res.status(500).json({ message: 'Error fetching settings for analysis.' });
            
            const settings = JSON.parse(row.settings || '{}');
            const analysisResult = processDataOnServer(dataToProcess, headers, settings);
            
            if (!analysisResult) return res.status(400).json({ message: 'Failed to process data on the server.' });
            res.json(analysisResult);
        });
    } catch (error) {
        console.error("Analysis error:", error);
        res.status(500).json({ message: 'An error occurred during analysis.' });
    }
});

app.get('/api/settings', authenticateToken, (req, res) => {
    db.get('SELECT settings FROM users WHERE id = ?', [req.user.id], (err, row) => {
        if (err) return res.status(500).json({ message: 'Error fetching settings.' });
        res.json(JSON.parse(row.settings || '{}'));
    });
});
app.post('/api/settings', authenticateToken, (req, res) => {
    const settings = JSON.stringify(req.body);
    db.run('UPDATE users SET settings = ? WHERE id = ?', [settings, req.user.id], (err) => {
        if (err) return res.status(500).json({ message: 'Error saving settings.' });
        res.json({ message: 'Settings saved.' });
    });
});
app.get('/api/history', authenticateToken, (req, res) => {
    db.all('SELECT id, file_name, analysis_date FROM analyses WHERE user_id = ? ORDER BY analysis_date DESC LIMIT 10', [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ message: 'Error fetching history.' });
        res.json(rows);
    });
});
app.get('/api/history/:id', authenticateToken, (req, res) => {
     db.get('SELECT data FROM analyses WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, row) => {
        if (err || !row) return res.status(404).json({ message: 'History not found.' });
        res.json(JSON.parse(row.data));
     });
});
app.post('/api/history', authenticateToken, (req, res) => {
    const { fileName, analysisDate, segmentedData } = req.body;
    const data = JSON.stringify({ segmentedData });
    db.run('INSERT INTO analyses (user_id, file_name, analysis_date, data) VALUES (?, ?, ?, ?)', 
        [req.user.id, fileName, analysisDate, data], function(err) {
        if (err) return res.status(500).json({ message: 'Error saving history.' });
        res.status(201).json({ message: 'History saved.', id: this.lastID });
    });
});
app.delete('/api/history', authenticateToken, (req, res) => {
    db.run('DELETE FROM analyses WHERE user_id = ?', [req.user.id], function(err) {
        if (err) return res.status(500).json({ message: 'Error clearing history.' });
        res.json({ message: 'History cleared.' });
    });
});

// --- Server-Side Data Processing Logic (Unchanged) ---
function processDataOnServer(data, headers, userSettings) {
    const defaultSettings = { championRecency: 30, championFrequency: 5, atRiskRecency: 90 };
    const settings = { ...defaultSettings, ...userSettings };
    const columnMap = detectColumnMappings(headers);
    if (!columnMap.success) {
        console.error("Column mapping failed:", columnMap.message);
        return null;
    }
    const detectedFormat = 'dd/MM/yyyy';
    let latestDate = new Date(0);
    data.forEach(tx => {
        const date = parseDate(tx[columnMap.date], detectedFormat);
        if (date && date > latestDate) latestDate = date;
    });
    latestDate.setDate(latestDate.getDate() + 1);
    const rfmData = calculateRFM(data, latestDate, detectedFormat, columnMap);
    const segmentedData = segmentCustomers(rfmData, settings);
    return { segmentedData, columnMap };
}
function detectColumnMappings(headers) {
    const lowerCaseHeaders = headers.map(h => h.toLowerCase().trim().replace(/^\uFEFF/, ''));
    const mappings = {
        customerId: ['customer id', 'customer_id', 'customerid', 'cust id', 'user id', 'userid', 'customer'],
        date: ['order date', 'invoicedate', 'transactiondate', 'date', 'orderdate', 'purchase date', 'purchase_date'],
        amount: ['sales', 'transactionamount', 'totalamount', 'amount', 'total amount', 'total', 'total price', 'revenue', 'amount_spent', 'price'],
        location: ['state', 'region', 'country', 'city', 'store', 'branch', 'location', 'store_name', 'store name']
    };
    let columnMap = {};
    for (const key in mappings) {
        for (const variant of mappings[key]) {
            const index = lowerCaseHeaders.indexOf(variant);
            if (index !== -1) {
                if (key === 'location') columnMap[key] = { name: headers[index], type: variant };
                else columnMap[key] = headers[index];
                break;
            }
        }
    }
    if (!columnMap.customerId || !columnMap.date || !columnMap.amount) {
        return { success: false, message: 'Upload failed: The CSV must contain headers for Customer ID, a Date, and Sales/Amount.' };
    }
    return { success: true, ...columnMap };
}
function parseDate(dateString, format) {
    if (!dateString) return null;
    const parts = dateString.split(' ')[0].split(/[-/]/);
    if (parts.length !== 3) return null;
    let date = new Date(parts[2], parts[1] - 1, parts[0]);
    return isNaN(date.getTime()) ? null : date;
}
function calculateRFM(transactions, analysisDate, dateFormat, columnMap) {
    const customerData = {};
    transactions.forEach(tx => {
        const customerId = tx[columnMap.customerId];
        const date = parseDate(tx[columnMap.date], dateFormat);
        const amount = parseFloat(String(tx[columnMap.amount]).replace(/[^0-9.-]+/g, ""));
        if (!customerId || !date || isNaN(amount)) return;
        if (!customerData[customerId]) {
            customerData[customerId] = { transactions: 0, totalSpend: 0, lastVisitDate: new Date(0) };
        }
        customerData[customerId].transactions++;
        customerData[customerId].totalSpend += amount;
        if (date > customerData[customerId].lastVisitDate) {
            customerData[customerId].lastVisitDate = date;
        }
    });
    const rfmResult = {};
    for (const customerId in customerData) {
        const data = customerData[customerId];
        const recency = Math.round((analysisDate - data.lastVisitDate) / (1000 * 60 * 60 * 24));
        rfmResult[customerId] = {
            recency: recency >= 0 ? recency : 0,
            frequency: data.transactions,
            monetary: data.totalSpend
        };
    }
    return rfmResult;
}
function segmentCustomers(rfmData, settings) {
    const segments = {
        'Champions': { customers: [], description: "Your best and most frequent customers. Reward them!" },
        'Loyal Customers': { customers: [], description: "Consistent customers. Nurture them to become Champions." },
        'At-Risk': { customers: [], description: "Good customers who haven't visited recently. Re-engage them!" },
        'New Customers': { customers: [], description: "First-time buyers. Encourage a second purchase." },
        'Hibernating': { customers: [], description: "Haven't visited in a long time. Try to win them back." }
    };
    for (const customerId in rfmData) {
        const rfm = rfmData[customerId];
        const customerInfo = { id: customerId, lastVisit: rfm.recency, visits: rfm.frequency, spend: rfm.monetary };
        if (rfm.recency <= settings.championRecency && rfm.frequency >= settings.championFrequency) segments['Champions'].customers.push(customerInfo);
        else if (rfm.recency <= (settings.atRiskRecency - 1) && rfm.frequency >= 2) segments['Loyal Customers'].customers.push(customerInfo);
        else if (rfm.recency > settings.atRiskRecency && rfm.frequency > 1) segments['At-Risk'].customers.push(customerInfo);
        else if (rfm.frequency === 1) segments['New Customers'].customers.push(customerInfo);
        else segments['Hibernating'].customers.push(customerInfo);
    }
    return segments;
}

// --- Gemini API Helper with Retry Logic ---
async function callGeminiAPI(prompt, retries = 3, delay = 1000) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_actual_gemini_api_key_here') {
        throw new Error("GEMINI_API_KEY is not set in the .env file.");
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    const modifiedPrompt = `${prompt} Do not include the markdown characters \`\`\` in your response.`;
    const payload = { contents: [{ parts: [{ text: modifiedPrompt }] }] };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.status === 503 && retries > 0) {
            console.log(`Gemini API overloaded. Retrying in ${delay / 1000}s... (${retries} retries left)`);
            await new Promise(res => setTimeout(res, delay));
            return callGeminiAPI(prompt, retries - 1, delay * 2); // Exponential backoff
        }

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API call failed with status ${response.status}: ${errorBody}`);
        }

        const result = await response.json();
        return result?.candidates?.[0]?.content?.parts?.[0]?.text || 'neutral';
    } catch (error) {
        if (retries > 0) {
            console.log(`API call failed. Retrying in ${delay / 1000}s... (${retries} retries left)`);
            await new Promise(res => setTimeout(res, delay));
            return callGeminiAPI(prompt, retries - 1, delay * 2);
        }
        throw error;
    }
}


// --- Server Start ---
async function startServer() {
    try {
        checkFacebookConnectivity(); // Run the diagnostic test on start
        await initializeDatabase();
        console.log('Database initialized successfully.');
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

startServer();
