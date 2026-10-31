/* Minimal dependency-free QR encoder (byte mode, ECC levels L/M, versions 1-15).
   Returns a boolean matrix. Verified against the Python `qrcode` reference. */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= gfMul(poly[j], GF_EXP[i]); }
    poly = next;
  }
  return poly;
}

function rsEncode(data, degree) {
  const gen = rsGenerator(degree);
  const rem = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift(); rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

// ECC block structure per version (ISO/IEC 18004): [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data]
const TABLE = {
  L: {
    1:[7,1,19,0,0],2:[10,1,34,0,0],3:[15,1,55,0,0],4:[20,1,80,0,0],5:[26,1,108,0,0],6:[18,2,68,0,0],
    7:[20,2,78,0,0],8:[24,2,97,0,0],9:[30,2,116,0,0],10:[18,2,68,2,69],11:[20,4,81,0,0],12:[24,2,92,2,93],
    13:[26,4,107,0,0],14:[30,3,115,1,116],15:[22,5,87,1,88]
  },
  M: {
    1:[10,1,16,0,0],2:[16,1,28,0,0],3:[26,1,44,0,0],4:[18,2,32,0,0],5:[24,2,43,0,0],6:[16,4,27,0,0],
    7:[18,4,31,0,0],8:[22,2,38,2,39],9:[22,3,36,2,37],10:[26,4,43,1,44],11:[30,1,50,4,51],12:[22,6,36,2,37],
    13:[22,8,37,1,38],14:[24,4,40,5,41],15:[24,5,41,5,42]
  }
};

const ALIGNMENT = {
  1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50],
  11:[6,30,54],12:[6,32,58],13:[6,34,62],14:[6,26,46,66],15:[6,26,48,70]
};

function bchFormat(data) { // 5 data bits -> 15-bit format info
  let d = data << 10;
  const g = 0b10100110111;
  for (let i = 14; i >= 10; i--) if ((d >> i) & 1) d ^= g << (i - 10);
  return ((data << 10) | d) ^ 0b101010000010010;
}

function bchVersion(data) { // 6 data bits -> 18-bit version info
  let d = data << 12;
  const g = 0b1111100100101;
  for (let i = 17; i >= 12; i--) if ((d >> i) & 1) d ^= g << (i - 12);
  return (data << 12) | d;
}

const FORMAT_POSITIONS_A = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];

function formatPositionsB(size) {
  const a = [], b = [];
  for (let i = 0; i < 7; i++) a.push([size - 1 - i, 8]);
  for (let i = 0; i < 8; i++) b.push([8, size - 8 + i]);
  return a.concat(b);
}

function encode(text, options) {
  const level = options && options.level === 'L' ? 'L' : 'M';
  const fixedMask = options && Number.isInteger(options.mask) ? options.mask : null;
  const bytes = new TextEncoder().encode(text);
  let version = 0, spec = null;
  for (let v = 1; v <= 15; v++) {
    const t = TABLE[level][v];
    const capacity = t[1] * t[2] + t[3] * t[4];
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= capacity * 8) { version = v; spec = t; break; }
  }
  if (!version) throw new Error('text too long');
  const dataCodewords = spec[1] * spec[2] + spec[3] * spec[4];

  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(4, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCodewords * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0; for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (const pad of [0xec, 0x11]) while (codewords.length < dataCodewords) codewords.push(pad);
  codewords.length = dataCodewords;

  const blocks = [];
  let offset = 0;
  for (let g = 0; g < 2; g++) {
    const count = spec[1 + g * 2], len = spec[2 + g * 2];
    for (let b = 0; b < count; b++) { blocks.push(codewords.slice(offset, offset + len)); offset += len; }
  }
  const ecBlocks = blocks.map(b => rsEncode(b, spec[0]));
  const maxLen = blocks[blocks.length - 1].length;
  const interleaved = [];
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) interleaved.push(b[i]);
  for (let i = 0; i < spec[0]; i++) for (const b of ecBlocks) interleaved.push(b[i]);

  const size = version * 4 + 17;
  const matrix = Array.from({length: size}, () => new Array(size).fill(null));
  const functionModule = Array.from({length: size}, () => new Array(size).fill(false));
  const setFinder = (r, c) => {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const ring = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6);
      const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      matrix[rr][cc] = (ring || core) ? 1 : 0;
      functionModule[rr][cc] = true;
    }
  };
  setFinder(0, 0); setFinder(0, size - 7); setFinder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { const v = i % 2 ? 0 : 1; matrix[6][i] = v; matrix[i][6] = v; functionModule[6][i] = true; functionModule[i][6] = true; }
  const centers = ALIGNMENT[version];
  const nCenters = centers.length;
  for (let i = 0; i < nCenters; i++) for (let j = 0; j < nCenters; j++) {
    // Skip only the three grid corners that overlap finder patterns.
    if ((i === 0 && j === 0) || (i === 0 && j === nCenters - 1) || (i === nCenters - 1 && j === 0)) continue;
    const r = centers[i], c = centers[j];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { matrix[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0; functionModule[r + dr][c + dc] = true; }
  }
  for (let i = 0; i < 9; i++) { if (matrix[8][i] === null) matrix[8][i] = 0; if (matrix[i][8] === null) matrix[i][8] = 0; functionModule[8][i] = true; functionModule[i][8] = true; }
  for (let i = 0; i < 8; i++) { if (matrix[8][size - 1 - i] === null) matrix[8][size - 1 - i] = 0; if (matrix[size - 1 - i][8] === null) matrix[size - 1 - i][8] = 0; functionModule[8][size - 1 - i] = true; functionModule[size - 1 - i][8] = true; }
  matrix[size - 8][8] = 1; // dark module
  functionModule[size - 8][8] = true;
  if (version >= 7) {
    const bitsv = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bitsv >> i) & 1;
      // bottom-left 3x6 block plus mirrored top-right 6x3 block
      const r = Math.floor(i / 3), c = size - 11 + (i % 3);
      matrix[r][c] = bit; matrix[c][r] = bit;
      functionModule[r][c] = true; functionModule[c][r] = true;
    }
  }
  let bitIndex = 0;
  const totalBits = interleaved.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (matrix[row][c] !== null) continue;
        let bit = 0;
        if (bitIndex < totalBits) bit = (interleaved[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
        bitIndex++;
        matrix[row][c] = bit;
      }
    }
    upward = !upward;
  }
  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];
  const penalty = (m) => {
    let score = 0;
    const runs = (get) => {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          if (get(a, b) === get(a, b - 1)) { run++; if (b === size - 1 && run >= 5) score += 3 + run - 5; }
          else { if (run >= 5) score += 3 + run - 5; run = 1; }
        }
      }
    };
    runs((a, b) => m[a][b]); runs((a, b) => m[b][a]);
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const finderLike = (get) => {
      for (let a = 0; a < size; a++) for (let b = 0; b <= size - 11; b++) {
        let match = true;
        for (let k = 0; k < 11; k++) if (get(a, b + k) !== pattern[k]) { match = false; break; }
        if (match) score += 40;
      }
    };
    finderLike((a, b) => m[a][b]); finderLike((a, b) => m[b][a]);
    let dark = 0;
    for (const row of m) for (const v of row) dark += v;
    score += Math.floor(Math.abs(dark * 100 - size * size * 50) / (size * size) / 5) * 10;
    return score;
  };
  const formatBits = mask => bchFormat(((level === 'L' ? 0b01 : 0b00) << 3) | mask); // L=01, M=00 (ISO 18004)
  const buildWithMask = (mask) => {
    const m = matrix.map(row => row.slice());
    const fn = maskFns[mask];
    // The mask applies to the encoding region only, never to function modules.
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!functionModule[r][c] && fn(r, c)) m[r][c] ^= 1;
    const bitsf = formatBits(mask);
    const posB = formatPositionsB(size);
    for (let i = 0; i < 15; i++) {
      const bit = (bitsf >> (14 - i)) & 1; // MSB is placed first, at (8,0)
      m[FORMAT_POSITIONS_A[i][0]][FORMAT_POSITIONS_A[i][1]] = bit;
      m[posB[i][0]][posB[i][1]] = bit;
    }
    return m;
  };
  if (fixedMask !== null) return {matrix: buildWithMask(fixedMask), version, mask: fixedMask, size};
  let best = null, bestScore = Infinity, bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const score = penalty(buildWithMask(mask));
    if (score < bestScore) { bestScore = score; best = mask; }
  }
  bestMask = best;
  return {matrix: buildWithMask(bestMask), version, mask: bestMask, size};
}

if (typeof module !== 'undefined' && module.exports) module.exports = {encode};
if (typeof window !== 'undefined') window.QRCode = {encode};
