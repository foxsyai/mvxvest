// Dates are computed in the reader's time zone. Tests run in one fixed zone
// wherever they run (a laptop, CI in UTC): Bucharest, east of UTC and with
// summer time, where a date computed in UTC instead shows up as wrong.
module.exports = () => {
  process.env.TZ = 'Europe/Bucharest';
};
