/**
 * Tailwind-Build für das Admin-Dashboard (statt CDN).
 * Neu bauen nach Änderungen an Klassen in public/admin.html, public/admin-tabs/*.html oder public/js/*.js:
 *   npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o public/css/tw.css --minify
 * Die erzeugte public/css/tw.css wird eingecheckt.
 */
function mix(hex, amount, to) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const t = to === 'white' ? 255 : 0;
  const m = c.map(v => Math.round(v + (t - v) * amount));
  return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
}
// Hub-Farbe als Tailwind-Skala (400 = Hub-Farbe)
function scale(base) {
  return {
    50: mix(base, 0.92, 'white'), 100: mix(base, 0.84, 'white'), 200: mix(base, 0.68, 'white'),
    300: mix(base, 0.4, 'white'), 400: base, 500: mix(base, 0.12, 'black'), 600: mix(base, 0.3, 'black'),
    700: mix(base, 0.48, 'black'), 800: mix(base, 0.64, 'black'), 900: mix(base, 0.76, 'black'), 950: mix(base, 0.88, 'black')
  };
}
const green = scale('#34d27b'), pink = scale('#ff5c8a'), gold = scale('#ffd477'), blue = scale('#5b8cff'), violet = scale('#a56bff');

module.exports = {
  content: ['./public/admin.html', './public/admin-tabs/*.html', './public/js/*.js'],
  theme: {
    extend: {
      fontFamily: { sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      colors: {
        slate: { 50:'#eef1ff',100:'#eef1ff',200:'#cfd5f0',300:'#a3acd1',400:'#8a93b8',500:'#6b7499',600:'#4b5378',700:'#2c3354',800:'#1b2140',850:'#141a36',900:'#0f1430',950:'#080b1a' },
        emerald: green, green, rose: pink, red: pink, amber: gold, yellow: gold, blue, sky: blue, purple: violet, violet
      }
    }
  }
};
