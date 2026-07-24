import dotenv from 'dotenv';

// Must be imported before any module that reads process.env at load time (e.g. app.js's
// COOKIE_SECRET check), so it's kept as its own module rather than inlined in server.js.
dotenv.config();
