export const sensor = { width: 960, height: 640 };
export const board = { columns: 8, rows: 6, cell: 32 };
export const initial = {
  fx: 920, fy: 900, skew: 0, u0: 480, v0: 320,
  rx: 20, ry: -25, rz: 0, tx: -130, ty: -85, tz: 720,
};

export const corners = Array.from({ length: (board.columns - 1) * (board.rows - 1) }, (_, index) => {
  const column = index % (board.columns - 1) + 1;
  const row = Math.floor(index / (board.columns - 1)) + 1;
  return { column, row, world: [column * board.cell, row * board.cell, 0] };
});

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const matrixVector = (matrix, vector) => matrix.map(row => dot(row, vector));
const multiply = (a, b) => a.map(row => b[0].map((_, col) => dot(row, b.map(r => r[col]))));
const normalize = ([u, v, w]) => [u / w, v / w];

export function model({ fx, fy, skew, u0, v0, rx, ry, rz, tx, ty, tz }) {
  const [x, y, z] = [rx, ry, rz].map(angle => angle * Math.PI / 180);
  const [cx, cy, cz] = [x, y, z].map(Math.cos);
  const [sx, sy, sz] = [x, y, z].map(Math.sin);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const K = [[fx, skew, u0], [0, fy, v0], [0, 0, 1]];
  const R = multiply(Rz, multiply(Ry, Rx));
  const t = [tx, ty, tz];
  const H = multiply(K, R.map(([r1, r2], i) => [r1, r2, t[i]]))
    .map(row => row.map(value => value / tz));

  function camera(world) {
    return matrixVector(R, world).map((value, i) => value + t[i]);
  }
  function project(world) {
    return normalize(matrixVector(K, camera(world)));
  }
  function homogeneous([X, Y]) {
    return matrixVector(H, [X, Y, 1]);
  }

  return { K, R, t, H, camera, project, homogeneous, viaHomography: world => normalize(homogeneous(world)) };
}

export const projectCorners = calibration => corners.map(({ world }) => calibration.project(world));
export const pixelError = ([u, v], [observedU, observedV]) => Math.hypot(u - observedU, v - observedV);
export function reprojectionRMSE(predicted, observed) {
  const sum = predicted.reduce((total, point, i) => total + pixelError(point, observed[i]) ** 2, 0);
  return Math.sqrt(sum / predicted.length);
}

export function onImage([u, v]) {
  return u >= 0 && u < sensor.width && v >= 0 && v < sensor.height;
}
