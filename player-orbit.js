import * as THREE from "three";

const FRAME_INTERVAL = 1000 / 30;
const BASE_CAMERA_FOV = 38;
const DESKTOP_STAGE_BASE_HEIGHT = 900;
const COMPACT_STAGE_BASE_HEIGHT = 760;
const PLANET_RADIUS = 4.2;
const DESKTOP_CAMERA_DISTANCE = 25.5;
const RING_CONFIGS = [
  { radius: 8.2, shapeX: 1.45, shapeY: 0.7, glowWidth: 0.04, coreWidth: 0.009, glowOpacity: 0.2, coreOpacity: 0.72, tiltX: 1.38, tiltY: -0.14, tiltZ: -0.12, speed: 0.032, phase: 0.18 },
  { radius: 10, shapeX: 0.85, shapeY: 1.05, glowWidth: 0.06, coreWidth: 0.016, glowOpacity: 0.32, coreOpacity: 0.94, tiltX: 0.72, tiltY: 0.74, tiltZ: -0.42, speed: -0.022, phase: 0.72 },
  { radius: 12.2, shapeX: 1.15, shapeY: 0.62, glowWidth: 0.03, coreWidth: 0.007, glowOpacity: 0.15, coreOpacity: 0.54, tiltX: 1.12, tiltY: -0.52, tiltZ: 0.46, speed: 0.015, phase: 1.26 }
];

let activeOrbit = null;

function createPlayerSignal(player) {
  const signal = document.createElement("span");
  signal.className = "player-orbit-signal";
  signal.setAttribute("aria-hidden", "true");

  const metrics = document.createElement("span");
  metrics.className = "player-orbit-signal-metrics";
  [
    ["评分", player.rating ?? "-"],
    ["胜场", String(player.wins ?? 0)],
    ["负场", String(player.losses ?? 0)]
  ].forEach(([label, value]) => {
    const item = document.createElement("span");
    const caption = document.createElement("small");
    const strong = document.createElement("strong");
    caption.textContent = label;
    strong.textContent = value;
    item.append(caption, strong);
    metrics.append(item);
  });

  const heroStrip = document.createElement("span");
  heroStrip.className = "player-orbit-signal-heroes";
  const heroList = document.createElement("span");
  heroList.className = "player-orbit-signal-hero-list";
  (player.heroes || []).slice(0, 3).forEach((hero, index) => {
    const heroSlot = document.createElement("span");
    heroSlot.className = "player-orbit-signal-hero";
    heroSlot.style.setProperty("--hero-order", index);
    heroSlot.dataset.heroName = hero.name || "-";
    if (hero.image) heroSlot.dataset.heroSrc = hero.image;
    heroSlot.textContent = String(hero.name || "-").slice(0, 1);
    heroList.append(heroSlot);
  });
  if (!heroList.childElementCount) {
    const empty = document.createElement("em");
    empty.textContent = "暂无记录";
    heroList.append(empty);
  }
  heroStrip.append(heroList);
  signal.append(metrics, heroStrip);
  return signal;
}

function hydratePlayerHeroes(element) {
  element.querySelectorAll("[data-hero-src]").forEach((slot) => {
    if (slot.querySelector("img")) return;
    const image = document.createElement("img");
    image.src = slot.dataset.heroSrc;
    image.alt = slot.dataset.heroName || "";
    image.title = slot.dataset.heroName || "";
    image.decoding = "async";
    slot.replaceChildren(image);
  });
}

function createProfileMorphPage(markup) {
  const page = document.createElement("section");
  page.className = "player-profile-morph-page";
  page.setAttribute("aria-hidden", "true");
  page.innerHTML = `
    <div class="player-profile-morph-body">
      ${markup}
    </div>
  `;
  page.querySelectorAll("[data-player-profile-back], [data-open-match]").forEach((element) => {
    element.removeAttribute("data-player-profile-back");
    element.removeAttribute("data-open-match");
    element.setAttribute("tabindex", "-1");
  });
  return page;
}

function openPlayerFromOrbit(state, label) {
  const playerId = label.element.dataset.playerProfileId;
  if (!playerId || state.transitioning) return;

  const selectPlayer = (sharedElement = false) => {
    return state.onSelect?.(playerId, { sharedElement });
  };
  const signal = label.element.querySelector(".player-orbit-signal");
  const previewMarkup = state.createPreview?.(playerId);
  const canTransition = !state.reducedMotion
    && signal
    && previewMarkup
    && typeof signal.animate === "function";
  if (!canTransition) {
    selectPlayer();
    return;
  }

  state.transitioning = true;
  state.hovered = true;
  label.element.classList.add("is-hovered", "is-transitioning");
  hydratePlayerHeroes(label.element);
  const sourceRect = signal.getBoundingClientRect();
  const main = document.querySelector(".main");
  const mainRect = main?.getBoundingClientRect();
  const navigationRect = document.querySelector(".sidebar")?.getBoundingClientRect();
  const horizontalNavigationBottom = navigationRect
    && navigationRect.width > window.innerWidth * 0.65
    && navigationRect.height < window.innerHeight * 0.35
    ? navigationRect.bottom
    : 0;
  const targetLeft = Math.max(0, mainRect?.left || 0);
  const targetTop = Math.max(0, mainRect?.top || 0, horizontalNavigationBottom);
  const targetRight = Math.min(window.innerWidth, mainRect?.right || window.innerWidth);
  const targetBottom = window.innerHeight;
  const targetWidth = Math.max(1, targetRight - targetLeft);
  const targetHeight = Math.max(1, targetBottom - targetTop);
  // Directory mode removes the main area's inline padding for the full-bleed planet.
  // Match the padding restored by the profile view before the real page is mounted.
  const profileInlinePadding = window.innerWidth <= 640
    ? 16
    : Math.min(64, Math.max(22, window.innerWidth * 0.04));
  const contentInsetTop = Math.max(0, main ? Number.parseFloat(getComputedStyle(main).paddingTop) || 0 : 0);
  const contentInsetLeft = profileInlinePadding;
  const contentInsetRight = profileInlinePadding;
  const flightCard = signal.cloneNode(true);
  flightCard.classList.add("player-profile-flight-card");
  const flightFrame = document.createElement("span");
  flightFrame.className = "player-profile-flight-frame";
  flightCard.append(flightFrame);
  Object.assign(flightCard.style, {
    top: `${sourceRect.top}px`,
    left: `${sourceRect.left}px`,
    width: `${sourceRect.width}px`,
    height: `${sourceRect.height}px`
  });
  const morphPage = createProfileMorphPage(previewMarkup);
  Object.assign(morphPage.style, {
    top: `${targetTop}px`,
    left: `${targetLeft}px`,
    width: `${targetWidth}px`,
    height: `${targetHeight}px`,
    paddingTop: `${contentInsetTop}px`,
    paddingRight: `${contentInsetRight}px`,
    paddingLeft: `${contentInsetLeft}px`
  });
  document.body.append(flightCard);
  document.body.append(morphPage);
  document.documentElement.classList.add("is-player-profile-transitioning");

  const translateX = targetLeft - sourceRect.left;
  const translateY = targetTop - sourceRect.top;
  const scaleX = targetWidth / Math.max(sourceRect.width, 1);
  const scaleY = targetHeight / Math.max(sourceRect.height, 1);
  const transitionDuration = 920;
  const easing = "cubic-bezier(0.65, 0, 0.35, 1)";
  let transitionTarget = null;
  let pageAnimation = null;
  let navigationAnimation = null;
  let previewFadeAnimation = null;

  const cleanup = () => {
    state.transitioning = false;
    document.documentElement.classList.remove("is-player-profile-transitioning");
    flightCard.remove();
    morphPage.remove();
    transitionTarget?.classList.remove("is-transition-target");
    pageAnimation?.cancel();
    navigationAnimation?.cancel();
    previewFadeAnimation?.cancel();
    label.element.classList.remove("is-transitioning");
  };

  const clipTop = Math.max(0, sourceRect.top - targetTop);
  const clipLeft = Math.max(0, sourceRect.left - targetLeft);
  const clipRight = Math.max(0, targetRight - sourceRect.right);
  const clipBottom = Math.max(0, targetBottom - sourceRect.bottom);
  const initialClip = `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px round 5px)`;

  const flightAnimation = flightCard.animate([
    { transform: "translate3d(0, 0, 0) scale(1, 1)", opacity: 0.9 },
    { transform: `translate3d(${translateX * 0.26}px, ${translateY * 0.26}px, 0) scale(${1 + (scaleX - 1) * 0.26}, ${1 + (scaleY - 1) * 0.26})`, opacity: 0.78, offset: 0.24 },
    { transform: `translate3d(${translateX * 0.72}px, ${translateY * 0.72}px, 0) scale(${1 + (scaleX - 1) * 0.72}, ${1 + (scaleY - 1) * 0.72})`, opacity: 0.3, offset: 0.68 },
    { transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`, opacity: 0 }
  ], { duration: transitionDuration, easing, fill: "both" });
  const contentAnimation = flightCard.querySelectorAll(".player-orbit-signal-metrics, .player-orbit-signal-heroes");
  const contentAnimations = Array.from(contentAnimation, (element) => element.animate([
    { opacity: 1 },
    { opacity: 1, offset: 0.12 },
    { opacity: 0, offset: 0.4 },
    { opacity: 0 }
  ], { duration: transitionDuration, easing: "ease-out", fill: "both" }));
  pageAnimation = morphPage.animate([
    { clipPath: initialClip, opacity: 0.34 },
    { clipPath: `inset(${clipTop * 0.74}px ${clipRight * 0.74}px ${clipBottom * 0.74}px ${clipLeft * 0.74}px round 4px)`, opacity: 0.68, offset: 0.24 },
    { clipPath: `inset(${clipTop * 0.28}px ${clipRight * 0.28}px ${clipBottom * 0.28}px ${clipLeft * 0.28}px round 2px)`, opacity: 0.94, offset: 0.68 },
    { clipPath: "inset(0px 0px 0px 0px round 0px)", opacity: 1 }
  ], { duration: transitionDuration, easing, fill: "both" });
  const morphNavigation = morphPage.querySelector(".player-profile-location");
  const navigationStartX = Math.max(0, clipLeft - contentInsetLeft);
  const navigationStartY = Math.max(0, clipTop - contentInsetTop);
  navigationAnimation = morphNavigation?.animate([
    { transform: `translate3d(${navigationStartX}px, ${navigationStartY}px, 0)`, opacity: 0.18 },
    { transform: `translate3d(${navigationStartX * 0.74}px, ${navigationStartY * 0.74}px, 0)`, opacity: 0.68, offset: 0.24 },
    { transform: `translate3d(${navigationStartX * 0.28}px, ${navigationStartY * 0.28}px, 0)`, opacity: 0.94, offset: 0.68 },
    { transform: "translate3d(0, 0, 0)", opacity: 1 }
  ], { duration: transitionDuration, easing, fill: "both" });

  Promise.allSettled([
    flightAnimation.finished,
    pageAnimation.finished,
    navigationAnimation?.finished,
    ...contentAnimations.map((animation) => animation.finished)
  ]).then(() => {
    const scrollShell = document.querySelector(".app-shell");
    label.element.blur();
    if (scrollShell) scrollShell.scrollTop = 0;
    transitionTarget = selectPlayer(true);
    if (!(transitionTarget instanceof Element)) {
      cleanup();
      return;
    }
    if (scrollShell) scrollShell.scrollTop = 0;
    transitionTarget.classList.add("is-transition-target");
    previewFadeAnimation = morphPage.animate([
      { opacity: 1 },
      { opacity: 0 }
    ], { duration: 140, easing: "ease-out", fill: "both" });
    requestAnimationFrame(() => {
      if (scrollShell) scrollShell.scrollTop = 0;
    });
    previewFadeAnimation.finished.catch(() => {}).finally(() => {
      if (scrollShell) scrollShell.scrollTop = 0;
      cleanup();
    });
  });
}

function createProceduralPlanetTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  let seed = 271828;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const image = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const broadCloud = Math.sin(x * 0.018 + Math.sin(y * 0.025) * 3.4)
        + Math.sin(y * 0.031 - Math.cos(x * 0.014) * 2.8);
      const fineCloud = Math.sin(x * 0.064 + Math.sin(y * 0.052) * 2.2)
        + Math.sin((x + y) * 0.105) * 0.7;
      const cloud = broadCloud * 0.62 + fineCloud * 0.38;
      const grain = (random() - 0.5) * 26;
      image.data[index] = THREE.MathUtils.clamp(20 + cloud * 11 + grain * 0.16, 7, 70);
      image.data[index + 1] = THREE.MathUtils.clamp(64 + cloud * 22 + grain * 0.28, 26, 142);
      image.data[index + 2] = THREE.MathUtils.clamp(142 + cloud * 34 + grain * 0.42, 72, 228);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  context.globalCompositeOperation = "screen";
  for (let index = 0; index < 76; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 10 + random() * 42;
    const cloud = context.createRadialGradient(x, y, 0, x, y, radius);
    const isViolet = random() > 0.72;
    cloud.addColorStop(0, isViolet
      ? `rgba(111, 119, 238, ${0.06 + random() * 0.12})`
      : `rgba(91, 190, 255, ${0.075 + random() * 0.15})`);
    cloud.addColorStop(0.48, isViolet
      ? "rgba(52, 64, 157, 0.025)"
      : "rgba(30, 104, 188, 0.032)");
    cloud.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = cloud;
    context.beginPath();
    context.ellipse(x, y, radius, radius * (0.28 + random() * 0.42), random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  context.lineCap = "round";
  context.filter = "blur(4px)";
  for (let index = 0; index < 52; index += 1) {
    const startX = random() * canvas.width;
    const startY = random() * canvas.height;
    const angle = random() * Math.PI * 2;
    const length = 24 + random() * 86;
    const bend = (random() - 0.5) * 64;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    context.strokeStyle = `rgba(${random() > 0.76 ? "152, 143, 255" : "120, 205, 255"}, ${0.024 + random() * 0.055})`;
    context.lineWidth = 3 + random() * 9;
    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + Math.cos(angle) * length * 0.3 + normalX * bend,
      startY + Math.sin(angle) * length * 0.3 + normalY * bend,
      startX + Math.cos(angle) * length * 0.72 - normalX * bend * 0.55,
      startY + Math.sin(angle) * length * 0.72 - normalY * bend * 0.55,
      startX + Math.cos(angle) * length,
      startY + Math.sin(angle) * length
    );
    context.stroke();
  }

  for (let index = 0; index < 22; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radiusX = 8 + random() * 34;
    const radiusY = radiusX * (0.35 + random() * 0.45);
    context.strokeStyle = `rgba(111, 194, 255, ${0.018 + random() * 0.045})`;
    context.lineWidth = 2 + random() * 7;
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, random() * Math.PI, random() * 1.2, Math.PI * (1.1 + random() * 0.7));
    context.stroke();
  }
  context.filter = "none";

  for (let index = 0; index < 760; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 0.18 + Math.pow(random(), 3) * 1.55;
    context.fillStyle = `rgba(196, 232, 255, ${0.06 + random() * 0.3})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  context.globalCompositeOperation = "multiply";
  for (let index = 0; index < 84; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 3 + random() * 13;
    context.fillStyle = `rgba(1, 8, 35, ${0.018 + random() * 0.055})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function createPlanetTexture(renderer) {
  const texture = new THREE.TextureLoader().load("./fengmian/player-star-surface-v1.webp");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function createStarGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const glow = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  glow.addColorStop(0, "rgba(65, 132, 216, 0.36)");
  glow.addColorStop(0.68, "rgba(54, 144, 236, 0.34)");
  glow.addColorStop(0.84, "rgba(81, 196, 255, 0.31)");
  glow.addColorStop(0.93, "rgba(72, 171, 255, 0.16)");
  glow.addColorStop(1, "rgba(13, 47, 116, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStarPointTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  const glow = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.18, "rgba(255, 255, 255, 0.96)");
  glow.addColorStop(0.48, "rgba(217, 238, 255, 0.48)");
  glow.addColorStop(1, "rgba(180, 219, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStarFlareTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  const center = canvas.width / 2;

  const halo = context.createRadialGradient(center, center, 0, center, center, center);
  halo.addColorStop(0, "rgba(255, 255, 255, 1)");
  halo.addColorStop(0.08, "rgba(255, 255, 255, 0.98)");
  halo.addColorStop(0.2, "rgba(220, 239, 255, 0.58)");
  halo.addColorStop(0.48, "rgba(151, 205, 255, 0.12)");
  halo.addColorStop(1, "rgba(120, 180, 255, 0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const horizontal = context.createLinearGradient(0, center, canvas.width, center);
  horizontal.addColorStop(0, "rgba(255, 255, 255, 0)");
  horizontal.addColorStop(0.43, "rgba(224, 241, 255, 0.08)");
  horizontal.addColorStop(0.5, "rgba(255, 255, 255, 0.9)");
  horizontal.addColorStop(0.57, "rgba(224, 241, 255, 0.08)");
  horizontal.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = horizontal;
  context.fillRect(0, center - 2.5, canvas.width, 5);

  const vertical = context.createLinearGradient(center, 0, center, canvas.height);
  vertical.addColorStop(0, "rgba(255, 255, 255, 0)");
  vertical.addColorStop(0.4, "rgba(224, 241, 255, 0.07)");
  vertical.addColorStop(0.5, "rgba(255, 255, 255, 0.82)");
  vertical.addColorStop(0.6, "rgba(224, 241, 255, 0.07)");
  vertical.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = vertical;
  context.fillRect(center - 2.5, 0, 5, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStarClusterDirections(count, seed) {
  const directions = [];
  let value = seed >>> 0;
  const random = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
  for (let index = 0; index < count; index += 1) {
    const vertical = random() * 2 - 1;
    const azimuth = random() * Math.PI * 2;
    const planar = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    directions.push(new THREE.Vector3(
      Math.cos(azimuth) * planar,
      vertical,
      Math.sin(azimuth) * planar
    ));
  }
  return directions;
}

function createStarLayer({
  count,
  size,
  opacity,
  seed,
  color,
  colorPalette,
  map,
  clusters = [],
  clusterFraction = 0,
  clusterSpread = 0.08,
  sizeAttenuation = false
}) {
  const positions = new Float32Array(count * 3);
  const colors = colorPalette?.length ? new Float32Array(count * 3) : null;
  const palette = colorPalette?.map((entry) => new THREE.Color(entry)) || [];
  let value = seed >>> 0;
  const random = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    let directionX;
    let directionY;
    let directionZ;
    if (clusters.length && random() < clusterFraction) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      directionX = cluster.x + (random() - 0.5) * clusterSpread;
      directionY = cluster.y + (random() - 0.5) * clusterSpread;
      directionZ = cluster.z + (random() - 0.5) * clusterSpread;
      const length = Math.hypot(directionX, directionY, directionZ) || 1;
      directionX /= length;
      directionY /= length;
      directionZ /= length;
    } else {
      const vertical = random() * 2 - 1;
      const azimuth = random() * Math.PI * 2;
      const planar = Math.sqrt(Math.max(0, 1 - vertical * vertical));
      directionX = Math.cos(azimuth) * planar;
      directionY = vertical;
      directionZ = Math.sin(azimuth) * planar;
    }
    const radius = 34 + random() * 18;
    positions[offset] = directionX * radius;
    positions[offset + 1] = directionY * radius;
    positions[offset + 2] = directionZ * radius;
    if (colors) {
      const selected = palette[Math.floor(random() * palette.length)];
      colors[offset] = selected.r;
      colors[offset + 1] = selected.g;
      colors[offset + 2] = selected.b;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const materialOptions = {
    color: colors ? 0xffffff : color,
    vertexColors: Boolean(colors),
    size,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation
  };
  if (map) materialOptions.map = map;
  const material = new THREE.PointsMaterial(materialOptions);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -20;
  return points;
}

function createSimpleStarField(isCompact) {
  const field = new THREE.Group();
  const pointTexture = createStarPointTexture();
  const flareTexture = createStarFlareTexture();
  const clusters = createStarClusterDirections(isCompact ? 24 : 42, 24681357);
  field.userData.pointTextures = [pointTexture, flareTexture];
  field.add(
    createStarLayer({
      count: isCompact ? 4200 : 13000,
      size: isCompact ? 1.05 : 1.25,
      opacity: 0.78,
      seed: 424242,
      colorPalette: [0xf6f8ff, 0xe9f2ff, 0xd9eaff, 0xfff0d9, 0xf7f7f2]
    }),
    createStarLayer({
      count: isCompact ? 650 : 1800,
      size: isCompact ? 1.8 : 2.2,
      opacity: 0.86,
      seed: 8675309,
      colorPalette: [0xf8fbff, 0xd8edff, 0xd8edff, 0xffeed3, 0xe8e3ff],
      map: pointTexture,
      clusters,
      clusterFraction: 0.58,
      clusterSpread: 0.11
    }),
    createStarLayer({
      count: isCompact ? 100 : 260,
      size: isCompact ? 12 : 18,
      opacity: 0.96,
      seed: 1357911,
      colorPalette: [0xf8fbff, 0xd6edff, 0xd6edff, 0xffe5c5, 0xffc9ab, 0xded9ff],
      map: flareTexture,
      clusters,
      clusterFraction: 0.72,
      clusterSpread: 0.065
    })
  );
  return field;
}

function createOrbitTrack(radius, isCompact, config, isPrimary) {
  const track = new THREE.Group();
  const tubularSegments = isCompact ? 384 : 768;
  const radialSegments = isCompact ? 12 : 16;
  const tubeRadii = isPrimary
    ? { halo: isCompact ? 0.13 : 0.155, rail: isCompact ? 0.058 : 0.067, highlight: isCompact ? 0.018 : 0.021 }
    : { halo: isCompact ? 0.105 : 0.13, rail: isCompact ? 0.047 : 0.055, highlight: isCompact ? 0.015 : 0.019 };
  const createRail = ({ color, tubeRadius, opacity }) => {
    const geometry = new THREE.TorusGeometry(radius, tubeRadius, radialSegments, tubularSegments);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
      alphaToCoverage: !isCompact
    });
    const rail = new THREE.Mesh(geometry, material);
    rail.frustumCulled = false;
    return rail;
  };
  const halo = createRail({
    color: isPrimary ? 0x2d91cf : 0x235f8b,
    tubeRadius: tubeRadii.halo,
    opacity: Math.max(0.08, config.glowOpacity * 0.52)
  });
  const rail = createRail({
    color: isPrimary ? 0x83cdf4 : 0x5797c2,
    tubeRadius: tubeRadii.rail,
    opacity: Math.max(0.58, config.coreOpacity * 0.8)
  });
  const highlight = createRail({
    color: isPrimary ? 0xe0f6ff : 0xa7d4ec,
    tubeRadius: tubeRadii.highlight,
    opacity: isPrimary ? 0.82 : Math.max(0.44, config.coreOpacity * 0.7)
  });
  track.add(halo, rail, highlight);
  return track;
}

function createLuminousStarMaterial(surfaceTexture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      surfaceMap: { value: surfaceTexture }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDirection;

      void main() {
        vUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D surfaceMap;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDirection;

      void main() {
        float facing = clamp(dot(normalize(vNormalView), normalize(vViewDirection)), 0.0, 1.0);
        float softRim = pow(1.0 - facing, 1.7);
        float edgeLine = pow(1.0 - facing, 5.8);
        vec3 surface = texture2D(surfaceMap, vUv).rgb;
        float sourceLuminance = dot(surface, vec3(0.2126, 0.7152, 0.0722));
        vec3 saturatedSurface = max(vec3(0.0), mix(vec3(sourceLuminance), surface, 1.42));
        vec3 deepSurface = pow(clamp(saturatedSurface, 0.0, 1.0), vec3(1.24));
        vec3 color = deepSurface * (0.34 + (1.0 - facing) * 0.2);
        color += vec3(0.003, 0.014, 0.06) * (0.55 + facing * 0.2);
        color += vec3(0.11, 0.47, 0.9) * softRim * 0.94;
        color += vec3(0.62, 0.94, 1.0) * edgeLine * 1.25;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: false,
    depthTest: true,
    depthWrite: true
  });
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}

function renderLabels(state) {
  const worldPosition = state.tempWorld;
  const projected = state.tempProjected;
  state.system.getWorldPosition(state.tempCenterWorld);
  state.tempCenterProjected.copy(state.tempCenterWorld).project(state.camera);
  state.tempEdgeWorld.set(PLANET_RADIUS * 1.03, 0, 0);
  state.system.localToWorld(state.tempEdgeWorld);
  state.tempEdgeProjected.copy(state.tempEdgeWorld).project(state.camera);
  const planetRadiusX = Math.abs(state.tempEdgeProjected.x - state.tempCenterProjected.x);
  state.tempEdgeWorld.set(0, PLANET_RADIUS * 1.03, 0);
  state.system.localToWorld(state.tempEdgeWorld);
  state.tempEdgeProjected.copy(state.tempEdgeWorld).project(state.camera);
  const planetRadiusY = Math.abs(state.tempEdgeProjected.y - state.tempCenterProjected.y);
  state.labels.forEach((label) => {
    label.anchor.getWorldPosition(worldPosition);
    projected.copy(worldPosition).project(state.camera);
    const onScreen = projected.z > -1 && projected.z < 1
      && projected.x > -1.2 && projected.x < 1.2
      && projected.y > -1.15 && projected.y < 1.15;
    if (!onScreen) {
      label.element.style.opacity = "0";
      label.element.style.pointerEvents = "none";
      return;
    }

    const x = (projected.x * 0.5 + 0.5) * state.width;
    const y = (-projected.y * 0.5 + 0.5) * state.height;
    const behindPlanet = worldPosition.z < state.tempCenterWorld.z
      && Math.pow((projected.x - state.tempCenterProjected.x) / Math.max(planetRadiusX, 0.001), 2)
        + Math.pow((projected.y - state.tempCenterProjected.y) / Math.max(planetRadiusY, 0.001), 2) < 1;
    if (behindPlanet) {
      label.element.style.opacity = "0";
      label.element.style.pointerEvents = "none";
      return;
    }
    const depth = THREE.MathUtils.clamp((worldPosition.z + 5.5) / 11, 0, 1);
    const scale = 0.96 + depth * 0.3;
    const opacity = 0.62 + depth * 0.38;
    label.element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(0, -50%)`;
    label.element.style.setProperty("--orbit-depth-scale", String(scale));
    label.element.style.setProperty("--orbit-depth-opacity", String(opacity));
    label.element.style.opacity = "1";
    label.element.style.zIndex = String(20 + Math.round(depth * 70));
    label.element.style.pointerEvents = opacity > 0.42 ? "auto" : "none";
    label.element.classList.toggle("is-signal-left", x > state.width - 346);
    label.element.classList.toggle("is-signal-up", y > state.height - 194);
  });
}

function renderScene(state) {
  state.starField.rotation.x = state.system.rotation.x * 0.12;
  state.starField.rotation.y = state.system.rotation.y * 0.18;
  state.starField.rotation.z = state.system.rotation.z * 0.08;
  state.renderer.render(state.scene, state.camera);
  renderLabels(state);
}

function requestFrame(state) {
  if (state.frameId || state.destroyed || document.hidden) return;
  state.frameId = requestAnimationFrame((time) => animate(state, time));
}

function animate(state, time) {
  state.frameId = 0;
  if (state.destroyed || !state.stage.isConnected || document.hidden) return;
  const elapsed = Math.min(0.08, Math.max(0, (time - state.lastTime) / 1000 || 0));
  if (time - state.lastRendered >= FRAME_INTERVAL) {
    state.lastRendered = time;
    if (!state.dragging && !state.hovered && !state.reducedMotion) state.system.rotation.y += 0.035 * elapsed;
    if (!state.dragging && !state.reducedMotion) {
      state.system.rotation.x += state.velocityY;
      state.system.rotation.y += state.velocityX;
      state.velocityX *= 0.91;
      state.velocityY *= 0.91;
    }
    state.planet.rotation.y += (state.reducedMotion ? 0 : 0.055) * elapsed;
    state.rings.forEach((ring, index) => {
      ring.rotation.z += (state.reducedMotion || state.hovered ? 0 : RING_CONFIGS[index].speed) * elapsed;
    });
    renderScene(state);
  }
  state.lastTime = time;
  if (!state.reducedMotion) requestFrame(state);
}

function resize(state) {
  const bounds = state.stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (width === state.width && height === state.height) return;
  state.width = width;
  state.height = height;
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, state.isCompact ? 1 : 1.1));
  state.renderer.setSize(width, height, false);
  state.camera.aspect = width / height;
  const baseHeight = state.isCompact ? COMPACT_STAGE_BASE_HEIGHT : DESKTOP_STAGE_BASE_HEIGHT;
  const baseHalfFov = THREE.MathUtils.degToRad(BASE_CAMERA_FOV / 2);
  state.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(baseHalfFov) * height / baseHeight));
  state.camera.position.z = state.isCompact ? 23.5 : DESKTOP_CAMERA_DISTANCE;
  state.starField.position.copy(state.camera.position);
  state.camera.updateProjectionMatrix();
  renderScene(state);
}

function bindInteractions(state) {
  const canvas = state.renderer.domElement;
  const onPointerDown = (event) => {
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.lastPointerX = event.clientX;
    state.lastPointerY = event.clientY;
    state.velocityX = 0;
    state.velocityY = 0;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
  };
  const onPointerMove = (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    const deltaX = event.clientX - state.lastPointerX;
    const deltaY = event.clientY - state.lastPointerY;
    state.lastPointerX = event.clientX;
    state.lastPointerY = event.clientY;
    state.velocityX = deltaX * 0.0038;
    state.velocityY = deltaY * 0.0032;
    state.system.rotation.y += state.velocityX;
    state.system.rotation.x += state.velocityY;
    if (state.reducedMotion) renderScene(state);
  };
  const onPointerUp = (event) => {
    if (event.pointerId !== state.pointerId) return;
    state.dragging = false;
    state.pointerId = null;
    canvas.classList.remove("is-dragging");
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    requestFrame(state);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  state.cleanupInteractions = () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
  };
}

function buildOrbit({ stage, players, onSelect, createPreview }) {
  const isCompact = window.matchMedia("(max-width: 620px)").matches;
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !isCompact, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "player-orbit-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");

  stage.replaceChildren();
  const labelLayer = document.createElement("div");
  labelLayer.className = "player-orbit-labels";
  stage.append(renderer.domElement, labelLayer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(BASE_CAMERA_FOV, 1, 0.1, 60);
  camera.position.set(0, -0.25, isCompact ? 23.5 : DESKTOP_CAMERA_DISTANCE);
  camera.lookAt(0, -0.25, 0);
  const system = new THREE.Group();
  system.rotation.set(-0.18, -0.34, -0.08);
  system.position.y = isCompact ? 2.4 : 3.65;
  const starField = createSimpleStarField(isCompact);
  starField.position.copy(camera.position);
  scene.add(starField);
  scene.add(system);

  const ambient = new THREE.AmbientLight(0x756842, 0.72);
  const keyLight = new THREE.DirectionalLight(0xffdfa0, 2.2);
  keyLight.position.set(-3.8, 2.8, 5.2);
  const rimLight = new THREE.PointLight(0xa66f13, 7.5, 18, 2);
  rimLight.position.set(4.2, -2.4, 2.6);
  scene.add(ambient, keyLight, rimLight);

  const planetTexture = createPlanetTexture(renderer);
  const glowTexture = createStarGlowTexture();
  const starGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0x5aa7e8,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  starGlow.scale.setScalar(10.15);
  starGlow.position.z = -0.55;
  system.add(starGlow);
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS, isCompact ? 40 : 64, isCompact ? 24 : 36),
    createLuminousStarMaterial(planetTexture)
  );
  planet.rotation.x = 0.52;
  planet.rotation.z = -0.18;
  system.add(planet);

  const labels = [];
  const orbitScale = isCompact ? 0.72 : 1;
  const rings = RING_CONFIGS.map((config, ringIndex) => {
    const ring = new THREE.Group();
    ring.rotation.set(config.tiltX, config.tiltY, config.tiltZ);
    ring.scale.set(config.shapeX, config.shapeY, 1);
    ring.add(createOrbitTrack(config.radius * orbitScale, isCompact, config, ringIndex === 1));
    system.add(ring);
    return ring;
  });

  players.forEach((player, index) => {
    const ringIndex = index % rings.length;
    const positionInRing = Math.floor(index / rings.length);
    const totalInRing = Math.ceil((players.length - ringIndex) / rings.length);
    const config = RING_CONFIGS[ringIndex];
    const angle = config.phase + positionInRing / Math.max(1, totalInRing) * Math.PI * 2;
    const anchor = new THREE.Object3D();
    anchor.position.set(Math.cos(angle) * config.radius * orbitScale, Math.sin(angle) * config.radius * orbitScale, 0);
    rings[ringIndex].add(anchor);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-orbit-id";
    const anchorDot = document.createElement("span");
    anchorDot.className = "player-orbit-anchor";
    anchorDot.setAttribute("aria-hidden", "true");
    const content = document.createElement("span");
    content.className = "player-orbit-id-content";
    content.textContent = player.name;
    button.append(anchorDot, content, createPlayerSignal(player));
    button.dataset.playerProfileId = player.id;
    button.setAttribute("aria-label", `查看 ${player.name} 的选手档案`);
    labelLayer.append(button);
    labels.push({ anchor, element: button, player });
  });

  const state = {
    stage, renderer, scene, camera, system, starField, planet, starGlow, planetTexture, glowTexture, rings, labels, isCompact,
    reducedMotion: reducedMotionQuery.matches,
    reducedMotionQuery,
    onSelect,
    createPreview,
    width: 0,
    height: 0,
    frameId: 0,
    lastTime: performance.now(),
    lastRendered: 0,
    velocityX: 0,
    velocityY: 0,
    dragging: false,
    hovered: false,
    transitioning: false,
    destroyed: false,
    pointerId: null,
    tempWorld: new THREE.Vector3(),
    tempProjected: new THREE.Vector3(),
    tempCenterWorld: new THREE.Vector3(),
    tempCenterProjected: new THREE.Vector3(),
    tempEdgeWorld: new THREE.Vector3(),
    tempEdgeProjected: new THREE.Vector3()
  };

  labels.forEach((label) => {
    label.element.addEventListener("mouseenter", () => {
      state.hovered = true;
      label.element.classList.add("is-hovered");
      hydratePlayerHeroes(label.element);
    });
    label.element.addEventListener("mouseleave", () => {
      state.hovered = false;
      label.element.classList.remove("is-hovered");
      requestFrame(state);
    });
    label.element.addEventListener("click", (event) => {
      event.stopPropagation();
      openPlayerFromOrbit(state, label);
    });
    label.element.addEventListener("focus", () => hydratePlayerHeroes(label.element));
  });

  state.resizeObserver = new ResizeObserver(() => resize(state));
  state.resizeObserver.observe(stage);
  const onVisibilityChange = () => {
    if (!document.hidden) {
      state.lastTime = performance.now();
      requestFrame(state);
    }
  };
  const onReducedMotionChange = (event) => {
    state.reducedMotion = event.matches;
    if (state.reducedMotion && state.frameId) {
      cancelAnimationFrame(state.frameId);
      state.frameId = 0;
      renderScene(state);
    } else requestFrame(state);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  reducedMotionQuery.addEventListener?.("change", onReducedMotionChange);
  state.cleanupLifecycle = () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    reducedMotionQuery.removeEventListener?.("change", onReducedMotionChange);
  };
  bindInteractions(state);
  resize(state);
  stage.classList.remove("is-failed");
  stage.classList.add("is-ready");
  requestFrame(state);
  return state;
}

export function mountPlayerOrbit({ stage, players, onSelect, createPreview }) {
  const signature = players.map((player) => [
    player.id,
    player.name,
    player.rating,
    player.wins,
    player.losses,
    (player.heroes || []).map((hero) => hero.name).join(",")
  ].join(":")).join("|");
  if (activeOrbit?.stage === stage && activeOrbit.signature === signature && !activeOrbit.destroyed) {
    activeOrbit.onSelect = onSelect;
    activeOrbit.createPreview = createPreview;
    requestFrame(activeOrbit);
    return;
  }
  destroyPlayerOrbit();
  try {
    activeOrbit = buildOrbit({ stage, players, onSelect, createPreview });
    activeOrbit.signature = signature;
  } catch (error) {
    stage.classList.remove("is-ready");
    stage.classList.add("is-failed");
    stage.innerHTML = `<p class="player-orbit-error">当前设备无法启动 3D 选手星球，可使用下方选手目录。</p>`;
    throw error;
  }
}

export function destroyPlayerOrbit() {
  const state = activeOrbit;
  if (!state) return;
  state.destroyed = true;
  if (state.frameId) cancelAnimationFrame(state.frameId);
  state.resizeObserver?.disconnect();
  state.cleanupInteractions?.();
  state.cleanupLifecycle?.();
  disposeObject(state.scene);
  state.planetTexture?.dispose?.();
  state.glowTexture?.dispose?.();
  state.starField?.userData?.pointTextures?.forEach((texture) => texture.dispose?.());
  state.renderer.dispose();
  state.renderer.forceContextLoss?.();
  state.stage.classList.remove("is-ready");
  state.stage.replaceChildren();
  activeOrbit = null;
}
