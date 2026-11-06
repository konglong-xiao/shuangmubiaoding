import { board, corners, initial, model, onImage, pixelError, projectCorners, reprojectionRMSE, sensor } from "./model.mjs";

const $ = id => document.getElementById(id);
const settings = [
  ["intrinsic", [
    ["fx", "fₓ", "横向焦距", 450, 1400, "px"],
    ["fy", "fᵧ", "纵向焦距", 450, 1400, "px"],
    ["skew", "γ", "轴斜切系数", -150, 150, "px"],
    ["u0", "u₀", "主点横坐标", 320, 640, "px"],
    ["v0", "v₀", "主点纵坐标", 200, 440, "px"],
  ]],
  ["rotation", [
    ["rx", "θₓ", "绕 X 轴", -45, 45, "°"],
    ["ry", "θᵧ", "绕 Y 轴", -45, 45, "°"],
    ["rz", "θ<sub>z</sub>", "绕 Z 轴", -45, 45, "°"],
  ]],
  ["translation", [
    ["tx", "tₓ", "横向", -240, 240, "mm"],
    ["ty", "tᵧ", "纵向", -180, 180, "mm"],
    ["tz", "t<sub>z</sub>", "深度", 540, 1300, "mm"],
  ]],
];
const presets = {
  front: { rx: 0, ry: 0, rz: 0, tx: -128, ty: -96, tz: 720 },
  tilt: { rx: 0, ry: 30, rz: 0, tx: -128, ty: -96, tz: 720 },
};
const startCorner = corners.findIndex(({ column, row }) => column === 4 && row === 3);
const traceSelect = $("point-select");
const cornerName = ({ column, row }) => `第 ${column} 列 · 第 ${row} 行`;
const referenceIntro = "固定在初始投影上。拖动参数后，看金色观测点与绿色投影点分开。";
const colors = { x: "#ff9c9f", y: "#83f3c4", z: "#9bd3ff", observed: "#ffce77", image: "#baacf8" };
let parameters = { ...initial };
let observed = projectCorners(model(initial));
let selected = startCorner;
let activeView = "image";

for (const [group, controls] of settings) {
  $(`${group}-controls`).innerHTML = controls.map(([key, symbol, label, min, max, unit]) => `
    <div class="control">
      <label for="${key}"><b>${symbol}</b> ${label}</label>
      <output id="${key}-output" for="${key}"></output>
      <input type="range" id="${key}" min="${min}" max="${max}" step="1" value="${initial[key]}" data-unit="${unit}">
    </div>`).join("");
}
const inputs = [...document.querySelectorAll("input[type=range]")];
for (const input of inputs) {
  input.addEventListener("input", () => {
    parameters[input.id] = input.valueAsNumber;
    syncControl(input);
    render();
  });
}

function syncControl(input) {
  const unit = input.dataset.unit;
  const display = `${input.value}${unit === "°" ? "" : " "}${unit}`;
  const percent = 100 * (input.valueAsNumber - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty("--fill", `${percent}%`);
  input.setAttribute("aria-valuetext", display);
  $(`${input.id}-output`).textContent = display;
}

function syncControls() {
  for (const input of inputs) {
    input.value = parameters[input.id];
    syncControl(input);
  }
}

traceSelect.innerHTML = corners.map((point, i) => `<option value="${i}">${cornerName(point)}</option>`).join("");
traceSelect.addEventListener("change", () => selectCorner(Number(traceSelect.value)));
$("projected-objects").addEventListener("click", event => {
  const target = event.target.closest("[data-corner]");
  if (target) selectCorner(Number(target.dataset.corner));
});
$("reset").addEventListener("click", () => {
  parameters = { ...initial };
  observed = projectCorners(model(initial));
  selected = startCorner;
  $("reference-status").textContent = referenceIntro;
  syncControls();
  render();
});
$("capture").addEventListener("click", () => {
  observed = projectCorners(model(parameters));
  $("reference-status").textContent = "已用当前参数生成固定观测。再次拖动参数即可比较。";
  render();
});
for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => {
    Object.assign(parameters, presets[button.dataset.preset]);
    syncControls();
    render();
  });
}

const tabs = [$("image-tab"), $("scene-tab")];
for (const tab of tabs) {
  tab.addEventListener("click", () => showView(tab.id === "image-tab" ? "image" : "scene"));
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" || (event.key !== "End" && tab.id === "scene-tab") ? tabs[0] : tabs[1];
    next.click();
    next.focus();
  });
}
function showView(view) {
  activeView = view;
  for (const name of ["image", "scene"]) {
    const visible = name === view;
    const tab = $(`${name}-tab`);
    tab.setAttribute("aria-selected", String(visible));
    tab.tabIndex = visible ? 0 : -1;
    $(`${name}-view`).hidden = !visible;
    $(`${name}-legend`).hidden = !visible;
  }
  render();
}

function selectCorner(index) {
  selected = index;
  render();
}

function format(value, digits = 2) {
  const rounded = value.toFixed(digits);
  return Number(rounded) === 0 ? (0).toFixed(digits) : rounded;
}
const vector = (values, digits = 2) => `(${values.map(value => format(value, digits)).join(", ")})`;
const xy = point => point.map(value => format(value, 2)).join(",");
const line = ([x1, y1], [x2, y2], stroke, width = 1.5, extra = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const circle = ([cx, cy], radius, fill, extra = "") =>
  `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fill}" ${extra}/>`;
const polygon = (points, fill, extra = "") =>
  `<polygon points="${points.map(xy).join(" ")}" fill="${fill}" ${extra}/>`;

const plateWidth = board.columns * board.cell;
const plateHeight = board.rows * board.cell;
const plateCorners = [[0, 0, 0], [plateWidth, 0, 0], [plateWidth, plateHeight, 0], [0, plateHeight, 0]];
function checkerboard(project, light, dark) {
  const vertices = Array.from({ length: board.rows + 1 }, (_, row) =>
    Array.from({ length: board.columns + 1 }, (_, column) => project([column * board.cell, row * board.cell, 0])),
  );
  let shapes = "";
  for (let row = 0; row < board.rows; row++) {
    for (let column = 0; column < board.columns; column++) {
      const cell = [vertices[row][column], vertices[row][column + 1], vertices[row + 1][column + 1], vertices[row + 1][column]];
      shapes += polygon(cell, (row + column) % 2 === 0 ? light : dark);
    }
  }
  return shapes;
}

function imageView(calibration, predicted) {
  const u0 = parameters.u0;
  const v0 = parameters.v0;
  const selectedPixel = predicted[selected];
  const frame = polygon(plateCorners.map(calibration.project), "none", 'stroke="#b5d8d8" stroke-width="1.7"');
  const boardShape = checkerboard(calibration.project, "#d9e8e2", "#31464c");
  const residuals = predicted.map((point, i) => line(observed[i], point, colors.observed, 1.5, 'opacity=".58"')).join("");
  const observations = observed.map(point => circle(point, 6.5, "none", `stroke="${colors.observed}" stroke-width="1.7"`)).join("");
  const points = predicted.map(point => circle(point, 3.2, colors.y, 'stroke="#15302c" stroke-width=".8"')).join("");
  const principal = [
    line([u0 - 12, v0], [u0 + 12, v0], colors.z, 2),
    line([u0, v0 - 12], [u0, v0 + 12], colors.z, 2),
    circle([u0, v0], 11, "none", `stroke="${colors.z}" stroke-width="1.3"`),
  ].join("");
  const focus = circle(selectedPixel, 12, "none", 'stroke="#0b171e" stroke-width="5"') +
    circle(selectedPixel, 12, "none", `stroke="${colors.y}" stroke-width="2.5"`);
  const hitAreas = predicted.map((point, i) => circle(point, 12, "transparent",
    `class="corner-hit" data-corner="${i}"`)).join("");
  $("projected-objects").innerHTML = boardShape + frame + residuals + observations + points + principal + focus + hitAreas;
}

const imageDepth = 180;
const cameraOrigin = [0, 0, 0];
const cameraAxes = [[112, 0, 0], [0, 112, 0], [0, 0, 113]];
const worldAxes = [[91, 0, 0], [0, 91, 0], [0, 0, 91]];
const axisColors = [colors.x, colors.y, colors.z];

function chartTransform(points) {
  const oblique = ([x, y, z]) => [.67 * x - .18 * y + .77 * z, .34 * x + .92 * y - .18 * z];
  const chartPoints = points.map(oblique);
  const xs = chartPoints.map(([x]) => x);
  const ys = chartPoints.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  const scale = Math.min(724 / width, 424 / height);
  return point => {
    const [x, y] = oblique(point);
    return [480 + scale * (x - minX - width / 2), 324 + scale * (y - minY - height / 2)];
  };
}
function chartText([x, y], value, fill, anchor = "start", size = 20) {
  return `<text x="${x}" y="${y}" fill="${fill}" text-anchor="${anchor}" font-size="${size}" font-weight="650" stroke="#101f26" stroke-width="5" paint-order="stroke">${value}</text>`;
}
function axis(origin, end, name, color) {
  const [x, y] = end;
  const angle = Math.atan2(y - origin[1], x - origin[0]);
  const left = [x - 10 * Math.cos(angle - .42), y - 10 * Math.sin(angle - .42)];
  const right = [x - 10 * Math.cos(angle + .42), y - 10 * Math.sin(angle + .42)];
  return line(origin, end, color, 2.4) + polygon([end, left, right], color) +
    chartText([x + 13 * Math.cos(angle), y + 13 * Math.sin(angle) + 6], name, color,
      Math.cos(angle) < -.15 ? "end" : "start", 20);
}

function sceneView(calibration) {
  const { fx, fy, skew, u0, v0 } = parameters;
  function imagePoint(u, v) {
    const y = (v - v0) / fy;
    return [(u - u0 - skew * y) * imageDepth / fx, y * imageDepth, imageDepth];
  }
  const image = [[0, 0], [sensor.width, 0], [sensor.width, sensor.height], [0, sensor.height]]
    .map(([u, v]) => imagePoint(u, v));
  const imageAxes = [
    imagePoint(sensor.width * .33, 0),
    imagePoint(0, sensor.height * .36),
    [image[0][0], image[0][1], imageDepth + 83],
  ];
  const boardOutline = plateCorners.map(calibration.camera);
  const boardAxes = worldAxes.map(calibration.camera);
  const chart = chartTransform([cameraOrigin, ...cameraAxes, ...image, ...imageAxes, ...boardOutline, ...boardAxes]);
  const eye = chart(cameraOrigin);
  const boardOrigin = chart(calibration.t);
  const imageOrigin = chart(image[0]);
  const point = calibration.camera(corners[selected].world);
  const intersection = chart(point.map(value => value * imageDepth / point[2]));
  const boardPoint = chart(point);
  const imagePlane = polygon(image.map(chart), "#71679f45", `stroke="${colors.image}" stroke-width="1.8"`);
  const frustum = image.map(vertex => line(eye, chart(vertex), "#8d91b6", 1, 'stroke-dasharray="5 6" opacity=".75"')).join("");
  const boardShape = checkerboard(world => chart(calibration.camera(world)), "#bccdc8", "#374e53");
  const rays = line(eye, intersection, colors.observed, 1.4) + line(intersection, boardPoint, colors.observed, 1.4, 'stroke-dasharray="5 6"');
  const imageLabels = ["+u", "+v", "正法向"];
  const cameraLabels = ["+Xc", "+Yc", "+Zc"];
  const worldLabels = ["+Xw", "+Yw", "+Zw"];
  const axes = cameraAxes.map((end, i) => axis(eye, chart(end), cameraLabels[i], axisColors[i])).join("") +
    imageAxes.map((end, i) => axis(imageOrigin, chart(end), imageLabels[i], axisColors[i])).join("") +
    boardAxes.map((end, i) => axis(boardOrigin, chart(end), worldLabels[i], axisColors[i])).join("");
  const origins = [eye, imageOrigin, boardOrigin].map(origin => circle(origin, 4.5, "#eaf5f1")).join("");
  const offset = ([x, y], dx, dy) => [x + dx, y + dy];
  const names = chartText(offset(eye, -9, -12), "Oc 光心", "#edf5f3", "end") +
    chartText(offset(imageOrigin, -7, -13), "Oi 图像原点", colors.image, "end") +
    chartText(offset(boardOrigin, -7, -13), "Ow 世界原点", "#edf5f3", "end");
  const heading = chartText([23, 34], "三维示意 · 相机前方的虚拟图像平面", "#b0c6c8", "start", 19);
  $("scene-objects").innerHTML = heading + frustum + imagePlane + boardShape +
    polygon(boardOutline.map(chart), "none", 'stroke="#bad4cd" stroke-width="1.5"') +
    rays + circle(intersection, 5, colors.observed) + circle(boardPoint, 6, colors.y, 'stroke="#163932" stroke-width="1.4"') +
    axes + origins + names;
}

function matrix(id, values, digits) {
  $(id).innerHTML = values.map((row, r) => `<div role="row">${row.map((value, c) =>
    `<span role="cell">${r === 2 && c === 2 && id === "homography" ? "1" : format(value, digits(r, c))}</span>`).join("")}</div>`).join("");
}

function render() {
  const calibration = model(parameters);
  const predicted = projectCorners(calibration);
  const { world } = corners[selected];
  const point = predicted[selected];
  const error = pixelError(point, observed[selected]);
  const rmse = reprojectionRMSE(predicted, observed);
  if (activeView === "image") imageView(calibration, predicted);
  else sceneView(calibration);

  $("rmse").textContent = format(rmse, 3);
  $("point-error").textContent = format(error, 3);
  $("visible-count").textContent = predicted.filter(onImage).length;
  traceSelect.value = String(selected);
  matrix("homography", calibration.H, row => row === 2 ? 6 : 4);
  matrix("camera-matrix", calibration.K, () => 0);
  matrix("rotation-matrix", calibration.R, () => 4);
  $("translation-value").textContent = `t = ${vector(calibration.t, 0)} mm`;
  $("world-value").textContent = `(Xw, Yw, Zw) = ${vector(world, 0)} mm`;
  $("camera-value").textContent = `(Xc, Yc, Zc) = ${vector(calibration.camera(world))} mm`;
  $("homogeneous-value").textContent = `H [Xw, Yw, 1]ᵀ → ${vector(calibration.homogeneous(world), 4)}`;
  $("pixel-value").textContent = `(u, v) = ${vector(calibration.viaHomography(world))} px${onImage(point) ? "" : " · 画面外"}`;
  $("observed-value").textContent = `观测 ${vector(observed[selected])} px`;
  $("residual-value").textContent = `投影 − 观测 = ${vector(point.map((value, i) => value - observed[selected][i]))} px`;
}

syncControls();
render();
