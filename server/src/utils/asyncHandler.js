// Route handler kita semua guna "async function" (contoh: async (req, res) => {...}).
// Masalahnya, dalam Express 4, kalau async function tu "reject" (error berlaku),
// Express TAK automatik tangkap dia — server boleh crash macam yang kau alami tadi.
//
// Wrapper ni "bungkus" setiap route handler supaya sebarang error automatik
// dihantar ke Express punya error handler (next(err)), bukan crash terus.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
