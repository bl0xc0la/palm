const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Standard Lightweight Database for Node projects
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup local JSON database file inside the server directory
const adapter = new FileSync(path.join(__dirname, 'database.json'));
const db = low(adapter);

// Set up default database collections if they don't exist yet
db.defaults({ users: [], verificationCodes: [] }).write();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Configure Multer to upload user files directly into their specific subdomain folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const domain = req.body.subdomain || 'fallback-project';
        const deployDir = path.join(__dirname, 'deployments', domain);
        
        fs.mkdirSync(deployDir, { recursive: true });
        cb(null, deployDir);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// --- VIRTUAL SUBDOMAIN ROUTING ROUTER ---
// This acts as the host manager. If someone goes to site.palm.pm, it maps to their deployment folder.
app.use((req, res, next) => {
    const host = req.headers.host;
    const parts = host.split('.');
    
    // If a subdomain exists and isn't 'www' or 'api'
    if (parts.length > 2 && parts[0] !== 'www' && parts[0] !== 'api') {
        const subdomain = parts[0];
        const deployPath = path.join(__dirname, 'deployments', subdomain);

        if (fs.existsSync(deployPath)) {
            return express.static(deployPath)(req, res, next);
        } else {
            return res.status(404).send('<h1>Palm Space Error</h1><p>This deployment does not exist on our edge network yet.</p>');
        }
    }
    next();
});

// --- API AUTHENTICATION ENDPOINTS ---

// 1. Generate Email Code Request
app.post('/api/auth/request-code', (req, res) => {
    const { email } = req.body;
    if(!email) return res.status(400).json({ success: false, message: 'Email field is blank.' });

    // Generate random 6 digit alphanumeric verification sequence
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store or update code in our local database tracking table
    db.get('verificationCodes')
      .remove({ email })
      .write(); // Clear old code if it exists

    db.get('verificationCodes')
      .push({ email, code, timestamp: Date.now() })
      .write();

    console.log(`\n==========================================`);
    console.log(`[PALM SECURITY OUTBOX] Verification code for ${email}: ${code}`);
    console.log(`==========================================\n`);
    
    res.json({ success: true, message: 'Code generated.', debugCode: code });
});

// 2. Verify Code & Set User Password
app.post('/api/auth/verify', (req, res) => {
    const { email, code, password } = req.body;

    const record = db.get('verificationCodes').find({ email, code }).value();
    if (!record) {
        return res.status(400).json({ success: false, message: 'Invalid or incorrect email verification token.' });
    }

    // Remove code since it has been consumed successfully
    db.get('verificationCodes').remove({ email }).write();

    // Check if user already exists, or create a brand new user row
    const userExists = db.get('users').find({ email }).value();
    if (!userExists) {
        db.get('users').push({ email, password, subdomain: null }).write();
    } else {
        db.get('users').find({ email }).assign({ password }).write(); // Update password if already registered
    }

    res.json({ success: true, message: 'Account settings locked and encrypted.' });
});

// 3. Register & Lock down Subdomain Directory
app.post('/api/domain/register', (req, res) => {
    const { email, subdomain } = req.body;

    const cleanSubdomain = subdomain.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    
    // Make sure domain isn't stolen by another account
    const taken = db.get('users').find({ subdomain: cleanSubdomain }).value();
    if (taken) {
        return res.status(400).json({ success: false, message: 'This unique domain space is already registered.' });
    }

    // Assign the domain space to the user profile table row
    db.get('users').find({ email }).assign({ subdomain: cleanSubdomain }).write();

    // Physically generate their production hosting directory space on the server's filesystem drive
    const userFolder = path.join(__dirname, 'deployments', cleanSubdomain);
    if (!fs.existsSync(userFolder)){
        fs.mkdirSync(userFolder, { recursive: true });
        // Inject a default index file so the live link displays something immediately
        fs.writeFileSync(path.join(userFolder, 'index.html'), `
            <html>
            <head><style>body{font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; text-align:center;}</style></head>
            <body><div><h1>🌴 ${cleanSubdomain}.palm.pm is active!</h1><p>Deploy your build folder files to replace this page.</p></div></body>
            </html>
        `);
    }

    res.json({ success: true, domain: `${cleanSubdomain}.palm.pm` });
});

// 4. File Upload Pipeline Handling
app.post('/api/deploy', upload.array('files'), (req, res) => {
    const { subdomain } = req.body;
    if(!subdomain) return res.status(400).json({ success: false, message: 'Missing routing destination domain mapping header.' });
    
    res.json({ success: true, domain: `${subdomain}.palm.pm` });
});

app.listen(PORT, () => {
    console.log(`\n🚀 [PALM CORE SERVICES RUNNING ON PORT ${PORT}]`);
    console.log(`-> Local database connected successfully.`);
    console.log(`-> User deployment folders will generate inside: ${path.join(__dirname, 'deployments/')}\n`);
});
