const SPECIES = ['cat', 'bear', 'bunny', 'frog', 'chick', 'alien', 'panda', 'sprout', 'star'];
const BODIES = [
  { body: '#FFC2D8', shade: '#F79ABD', tint: '#3a2130' },
  { body: '#A9DDFF', shade: '#7FC1F0', tint: '#1d2b3a' },
  { body: '#A8F0C6', shade: '#7CDCA6', tint: '#1b2f26' },
  { body: '#FFE3A0', shade: '#F4C96C', tint: '#332a17' },
  { body: '#D7C1FF', shade: '#B49CF0', tint: '#28203a' },
  { body: '#FFC9B5', shade: '#F2A78E', tint: '#36241e' },
  { body: '#D8F0A2', shade: '#B4DC6F', tint: '#2a3317' },
  { body: '#FFB8A8', shade: '#F2907C', tint: '#361f1a' }
];
const ACCENTS = ['#F7CE46', '#F0533C', '#4B9DED', '#4FC26B', '#FF8FBE', '#B98CFF'];
const INK = '#2b2436';
const PINK = '#FF8FB1';
const WHITE = '#FFFFFF';

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || 'lunch')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomAvatarSeed() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function avatarTint(seed) {
  const random = createRandom(seed);
  const palette = BODIES[Math.floor(random() * BODIES.length)];
  return palette.tint;
}

export function avatarSVG(seed) {
  const random = createRandom(`${seed}:avatar`);
  const pick = list => list[Math.floor(random() * list.length)];
  const species = pick(SPECIES);
  const palette = pick(BODIES);
  const accent = pick(ACCENTS);
  const cells = new Map();
  const set = (x, y, color) => cells.set(`${x},${y}`, color);
  const paint = (coords, color) => { for (const [x, y] of coords) set(x, y, color); };
  const mirror = coords => coords.map(([x, y]) => [11 - x, y]);
  const both = coords => [...coords, ...mirror(coords)];

  const body = species === 'panda' ? '#FFF6EC' : species === 'chick' ? '#FFE3A0' : palette.body;
  const shade = species === 'panda' ? '#EADCCB' : species === 'chick' ? '#F4C96C' : palette.shade;
  const dark = species === 'panda' ? '#3A3240' : INK;

  const cx = 6, cy = 7, rx = 4.7, ry = 4.5;
  for (let y = 1; y < 12; y++) {
    for (let x = 1; x < 11; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(x, y, dx + dy < -0.45 ? shade : body);
    }
  }

  if (species === 'cat') {
    paint(both([[2, 2], [3, 1], [3, 2], [3, 3], [4, 2]]), body);
    paint(both([[3, 2]]), PINK);
  } else if (species === 'bear') {
    paint(both([[1, 2], [2, 2], [1, 3], [2, 3]]), body);
    paint(both([[1, 2]]), shade);
  } else if (species === 'bunny') {
    paint(both([[3, 0], [3, 1], [3, 2], [3, 3]]), body);
    paint(both([[3, 0]]), shade);
    paint(both([[3, 1], [3, 2]]), PINK);
  } else if (species === 'frog') {
    paint(both([[2, 2], [3, 2], [2, 3], [3, 3]]), body);
  } else if (species === 'chick') {
    paint([[5, 1], [6, 1], [6, 2]], accent);
  } else if (species === 'alien') {
    paint([[6, 0], [6, 1]], body);
    paint([[6, 0]], accent);
  } else if (species === 'panda') {
    paint(both([[1, 2], [2, 2], [1, 3], [2, 3]]), dark);
  } else if (species === 'sprout') {
    paint([[6, 0], [7, 0], [6, 1]], '#7CDCA6');
    paint([[5, 0]], '#4FC26B');
  } else if (species === 'star') {
    paint([[5, 0], [6, 1], [5, 1], [4, 2], [7, 2]], shade);
  }

  if (species === 'cat' || species === 'bear' || species === 'bunny' || species === 'sprout' || species === 'star' || species === 'chick' || species === 'frog') {
    paint([[3, 6], [4, 6], [3, 7], [4, 7], [7, 6], [8, 6], [7, 7], [8, 7]], dark);
    paint([[3, 6], [7, 6]], WHITE);
  } else if (species === 'alien') {
    paint([[3, 6], [4, 6], [3, 7], [4, 7], [7, 6], [8, 6], [7, 7], [8, 7]], dark);
    paint([[4, 6], [7, 6]], WHITE);
  } else if (species === 'panda') {
    paint([[2, 5], [3, 5], [2, 6], [3, 6], [2, 7], [3, 7], [8, 5], [9, 5], [8, 6], [9, 6], [8, 7], [9, 7]], '#3A3240');
    paint([[3, 6], [8, 6]], WHITE);
  }

  paint(both([[1, 8], [2, 8]]), PINK);
  if (species === 'frog') paint([[5, 9], [6, 9]], dark);
  else if (species === 'chick') paint([[5, 8], [6, 8]], '#F5A623');
  else paint([[5, 9], [6, 9]], dark);

  const sparkle = pick([[0, 3], [10, 4], [1, 5], [9, 2], [0, 9], [11, 8]]);
  paint([sparkle], accent);
  if (random() > 0.45) paint([[sparkle[0], sparkle[1] - 1], [sparkle[0] + 1, sparkle[1]]].filter(([x, y]) => x >= 0 && x <= 11 && y >= 0 && y <= 11), accent);

  const rects = [...cells].map(([key, color]) => {
    const [x, y] = key.split(',');
    return `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
  }).join('');

  return `<svg class="avatar-svg" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
}
