const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 8080;

const ADMIN_EMAIL = 'admin@padayon.com';

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.txt');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '');
}

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'padayon-secret-key',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  (accessToken, refreshToken, profile, done) => {
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : '';
    let usersContent = fs.readFileSync(USERS_FILE, 'utf8');
    if (!usersContent.includes(email + ':')) {
      const now = Date.now();
      fs.appendFileSync(USERS_FILE, `${email}::google_oauth:${now}:${now}\n`);
    }
    return done(null, { email });
  }
));

passport.serializeUser((user, done) => done(null, user.email));
passport.deserializeUser((email, done) => done(null, { email }));

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 256, 'sha256').toString('hex');
}

function updateUserActivity(targetEmail) {
  try {
    const lines = fs.readFileSync(USERS_FILE, 'utf8').split('\n').filter(Boolean);
    const newLines = lines.map(line => {
      const parts = line.split(':');
      const email = parts[0];
      const salt = parts[1];
      const hashedPassword = parts[2];
      const createdAt = parts[3] || Date.now();
      
      if (email === targetEmail) {
        return `${email}:${salt}:${hashedPassword}:${createdAt}:${Date.now()}`;
      }
      return line;
    });
    fs.writeFileSync(USERS_FILE, newLines.join('\n') + (newLines.length ? '\n' : ''));
  } catch (err) {
    console.error('Failed to update user activity timestamp:', err);
  }
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    req.userEmail = req.user.email;
    return next();
  }
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.userEmail !== ADMIN_EMAIL) {
    return res.status(403).send('Access denied. Admins only! 🌸');
  }
  next();
}

// Serve app.js dynamically
app.get('/app.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
const $ = s => document.querySelector(s);
const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let S = { taskStack: [], historyStack: [] }; 
let focus = false, formTags = [];

async function api(path, opt = {}) {
  try {
    const r = await fetch(path, opt);
    if (r.status === 401) { 
      window.location.href = '/login'; 
      throw new Error('Unauthorized'); 
    }
    return r;
  } catch (err) {
    console.error("API Error on", path, err);
    throw err;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('padayon_theme');
  const themeBtn = $('#themeBtn');
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (themeBtn) themeBtn.textContent = '☀️ Day';
  } else {
    if (themeBtn) themeBtn.textContent = '🌙 Night';
  }

  initListeners();
  if ($('#app')) enter();
});

async function enter() {
  try {
    const res = await api('/api/state');
    if (res.ok) {
      S = await res.json();
      if (!S.taskStack) S.taskStack = [];
      if (!S.historyStack) S.historyStack = [];
    }
  } catch (e) {
    console.log("Using empty local state due to fetch error:", e);
  }
  render();
}

async function save() {
  try {
    await api('/api/state', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(S) 
    });
  } catch (e) {
    console.error("Failed to save state to server:", e);
  }
}

function addTask(task) { 
  S.taskStack.push(task); 
  render(true); 
  save();       
}         

function completeTask() {                                                       
  const t = S.taskStack.pop();
  if (!t) return;
  S.historyStack.push(t); 
  render(); 
  save();
}

function peekTask() {                                                        
  const t = S.taskStack.at(-1);
  if (!t) return;
  const dlgBody = $('#dlgBody');
  const dlg = $('#dlg');
  if (dlgBody) {
    dlgBody.innerHTML = \`<h2>\${esc(t.title)}</h2><p>\${esc(t.description || 'No description')}</p>\` +
      \`<p>\${tagsHtml(t)}</p><p class="note">\${t.deadline ? new Date(t.deadline).toLocaleString() : 'No deadline'}\` +
      \` · \${t.mins ? t.mins + ' min' : 'No estimate'}<br>Created \${new Date(t.createdAt).toLocaleString()}</p>\`;
  }
  if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
}

function undoTask() {                                                           
  const t = S.historyStack.pop();
  if (!t) return;
  S.taskStack.push(t); 
  render(true);
  save();
}

function toggleFocusMode(on) { 
  focus = on; 
  render(); 
}

const tagsHtml = t => (t.tags || []).map(g => \`<span class="pill">\${esc(g)}</span>\`).join('');

function render(animate) {
  const top = S.taskStack.at(-1);
  const appEl = $('#app');
  if (appEl) appEl.classList.toggle('focus', focus);
  
  const focusToggle = $('#focusToggle');
  if (focusToggle) focusToggle.checked = focus;
  
  const fs = $('#fs');
  if (fs) fs.disabled = focus;
  
  const focusNote = $('#focusNote');
  if (focusNote) focusNote.hidden = !focus;
  
  const focusCard = $('#focusCard');
  if (focusCard) {
    focusCard.innerHTML = top
      ? \`<span class="badge">Do this first</span><h2>\${esc(top.title)}</h2>\` +
        \`<p>\${esc(top.description || '')}</p><p>\${tagsHtml(top)}</p>\` +
        \`<p class="note">\${top.deadline ? new Date(top.deadline).toLocaleString() : ''} \${top.mins ? top.mins + ' min' : ''}</p>\` +
        \`<div class="row" style="justify-content:center"><button class="btn primary" id="doneBtn" type="button">Done</button><button class="btn" id="peekBtn" type="button">Peek</button></div>\`
      : \`<div class="empty">🌸</div><h2>All done!</h2><p>Nothing left to do. Time to rest or add a new task.</p>\`;
    
    if (animate) focusCard.classList.add('slide');
    else focusCard.classList.remove('slide');
    
    if (top) { 
      const doneBtn = $('#doneBtn');
      const peekBtn = $('#peekBtn');
      if (doneBtn) doneBtn.onclick = completeTask; 
      if (peekBtn) peekBtn.onclick = peekTask; 
    }
  }

  const waitingTasks = S.taskStack.slice(0, -1).reverse();
  const upnextHeading = $('#upnext h2');
  if (upnextHeading) {
    upnextHeading.textContent = \`Up Next (\${waitingTasks.length})\`;
  }

  const list = $('#list');
  if (list) {
    list.innerHTML = waitingTasks
      .map((t, i) => \`<li><strong>\${i + 1}.</strong> \${esc(t.title)} \${tagsHtml(t)}</li>\`).join('') || '<li>Nothing waiting.</li>';
  }

  const hlist = $('#hlist');
  if (hlist) {
    hlist.innerHTML = S.historyStack.slice().reverse()
      .map(t => \`<li>\${esc(t.title)}</li>\`).join('') || '<li>No completed tasks yet.</li>';
  }

  const hCount = $('#hCount');
  if (hCount) hCount.textContent = S.historyStack.length;
  
  const undoBtn = $('#undoBtn');
  if (undoBtn) undoBtn.disabled = !S.historyStack.length;
}

function renderPills() {
  const pills = $('#pills');
  if (!pills) return;
  pills.innerHTML = formTags.map((g, i) =>
    \`<span class="pill">\${esc(g)} <button type="button" data-i="\${i}" aria-label="Remove tag">×</button></span>\`).join('');
  pills.querySelectorAll('button').forEach(b => {
    b.onclick = () => { 
      formTags.splice(b.dataset.i, 1); 
      renderPills(); 
    };
  });
}

function commitTag() {
  const tagIn = $('#tagIn');
  if (!tagIn) return true;
  const v = tagIn.value.trim().replace(/,$/, '');
  if (!v) return true;
  
  const err = $('#err');
  if (formTags.length >= 3) { 
    if (err) err.textContent = 'Only 3 tags per task. 🌸'; 
    return false; 
  }
  
  formTags.push(v.slice(0, 25)); 
  tagIn.value = ''; 
  
  const tagCount = $('#tagCount');
  if (tagCount) tagCount.textContent = '0/25';
  if (err) err.textContent = ''; 
  
  renderPills(); 
  return true;
}

function initListeners() {
  const tagIn = $('#tagIn');
  if (tagIn) {
    tagIn.addEventListener('input', e => {
      const tagCount = $('#tagCount');
      if (tagCount) tagCount.textContent = e.target.value.length + '/25';
    });
    tagIn.addEventListener('keydown', e => { 
      if (e.key === 'Enter' || e.key === ',') { 
        e.preventDefault(); 
        commitTag(); 
      } 
    });
  }

  const form = $('#form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (focus) return;
      
      const titleEl = $('#title');
      const title = titleEl ? titleEl.value.trim() : '';
      const deadlineEl = $('#deadline');
      const deadline = deadlineEl ? deadlineEl.value : '';
      const minsEl = $('#mins');
      const mins = minsEl ? minsEl.value : '';
      const err = $('#err');
      
      if (tagIn && tagIn.value.trim()) {
        commitTag();
      }
      
      if (!title || !deadline || !mins || formTags.length === 0) { 
        if (err) err.textContent = 'Please fill out all required fields (Title, Deadline, Estimated minutes, and at least 1 Tag)! 🌼'; 
        if (!title && titleEl) titleEl.focus(); 
        return; 
      }
      
      const descEl = $('#desc');

      addTask({
        id: Date.now(), 
        title, 
        description: descEl ? descEl.value.trim() : '', 
        tags: formTags.slice(),
        deadline, 
        mins, 
        createdAt: new Date().toISOString()
      });
      
      form.reset(); 
      formTags = []; 
      renderPills(); 
      if (err) err.textContent = ''; 
      const tagCount = $('#tagCount');
      if (tagCount) tagCount.textContent = '0/25';
    });
  }

  const undoBtn = $('#undoBtn');
  if (undoBtn) undoBtn.onclick = undoTask;
  
  const focusToggle = $('#focusToggle');
  if (focusToggle) {
    focusToggle.onchange = e => toggleFocusMode(e.target.checked);
  }

  const dlgClose = $('#dlgClose');
  if (dlgClose) {
    dlgClose.onclick = () => { 
      const dlg = $('#dlg');
      if (dlg) dlg.close(); 
    };
  }

  const themeBtn = $('#themeBtn');
  if (themeBtn) {
    themeBtn.onclick = () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const isDark = currentTheme === 'dark';
      
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        themeBtn.textContent = '🌙 Night';
        localStorage.setItem('padayon_theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeBtn.textContent = '☀️ Day';
        localStorage.setItem('padayon_theme', 'dark');
      }
    };
  }
}
  `);
});

// Routes
app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.get('/signup', (req, res) => {
  res.render('signup', { error: null });
});

// Google OAuth routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

app.get('/dashboard', requireAuth, (req, res) => {
  updateUserActivity(req.userEmail);
  res.render('dashboard', { 
    email: req.userEmail, 
    isAdmin: req.userEmail === ADMIN_EMAIL 
  });
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const usersRaw = fs.readFileSync(USERS_FILE, 'utf8').split('\n').filter(Boolean);
  const users = usersRaw.map(line => {
    const parts = line.split(':');
    return {
      email: parts[0],
      createdAt: parts[3] ? Number(parts[3]) : null,
      lastActive: parts[4] ? Number(parts[4]) : null
    };
  });

  res.render('adminpanel', { 
    email: req.userEmail, 
    users 
  });
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    res.redirect('/login');
  });
});

app.post('/api/signup', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const emailRegex = /^[^\s@"\\:]+@[^\s@"\\:]+\.[^\s@"\\:]+$/;
  if (!emailRegex.test(email)) {
    return res.render('signup', { error: 'Please enter a valid email.' });
  }
  if (password.length < 6) {
    return res.render('signup', { error: 'Password needs at least 6 characters.' });
  }

  const users = fs.readFileSync(USERS_FILE, 'utf8').split('\n');
  for (const line of users) {
    if (line.startsWith(email + ':')) {
      return res.render('signup', { error: 'That email already has an account. Try logging in.' });
    }
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hashedPassword = hashPassword(password, salt);
  const now = Date.now();
  
  fs.appendFileSync(USERS_FILE, `${email}:${salt}:${hashedPassword}:${now}:${now}\n`);

  req.login({ email }, (err) => {
    if (err) return res.render('signup', { error: 'Session error after signup.' });
    res.redirect('/dashboard');
  });
});

app.post('/api/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const users = fs.readFileSync(USERS_FILE, 'utf8').split('\n');
  let foundLine = null;
  for (const line of users) {
    if (line.startsWith(email + ':')) {
      foundLine = line;
      break;
    }
  }

  if (!foundLine) {
    return res.render('login', { error: 'Wrong email or password.' });
  }

  const parts = foundLine.split(':');
  const salt = parts[1];
  const storedHash = parts[2];
  const hashedPassword = hashPassword(password, salt);

  if (!crypto.timingSafeEqual(Buffer.from(storedHash, 'hex'), Buffer.from(hashedPassword, 'hex'))) {
    return res.render('login', { error: 'Wrong email or password.' });
  }

  updateUserActivity(email);

  req.login({ email }, (err) => {
    if (err) return res.render('login', { error: 'Login session error.' });
    res.redirect('/dashboard');
  });
});

app.all('/api/state', requireAuth, (req, res) => {
  const userFile = path.join(DATA_DIR, crypto.createHash('sha256').update(req.userEmail).digest('hex') + '.json');

  if (req.method === 'POST') {
    fs.writeFileSync(userFile, JSON.stringify(req.body));
    updateUserActivity(req.userEmail);
    return res.send('ok');
  } else {
    updateUserActivity(req.userEmail);
    if (fs.existsSync(userFile)) {
      res.setHeader('Content-Type', 'application/json');
      res.send(fs.readFileSync(userFile, 'utf8'));
    } else {
      res.json({ taskStack: [], historyStack: [] });
    }
  }
});

app.listen(PORT, () => {
  console.log(`PADAYON running at port ${PORT}`);
});