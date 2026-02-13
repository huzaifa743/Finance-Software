import db from '../db/database.js';

export const logActivity = (action, module, details = '') => (req, res, next) => {
  const log = () => {
    try {
      if (req.user?.id) {
        db.prepare(
          'INSERT INTO activity_logs (user_id, action, module, details) VALUES (?, ?, ?, ?)'
        ).run(req.user.id, action, module, typeof details === 'function' ? details(req) : details);
      }
    } catch (e) {
      console.error('Activity log error:', e.message);
    }
  };
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 400) log();
    return origJson(body);
  };
  next();
};
