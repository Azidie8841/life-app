// Middleware = fungsi yang "duduk di tengah" antara request masuk dan route
// handler. Ni yang kita guna untuk kunci pintu — kalau session tak sah,
// request tak sampai ke route sebenar langsung.
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  res.status(401).json({ error: 'Sila log masuk dahulu.' });
}

module.exports = { requireAuth };
