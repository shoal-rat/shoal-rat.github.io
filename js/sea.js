/* Chrome-first SeaTimeline
   A single 7.2s clock drives non-rigid canvas water, printed foam particles,
   and WAAPI fish. The static PNG layers remain the no-JS loading fallback. */
(function () {
  "use strict";

  const scene = document.getElementById("hero-scene");
  const hero = scene && scene.closest(".hero");
  const button = document.getElementById("sea-button");
  const shade = hero && hero.querySelector(".hero-shade");
  const midCanvas = scene && scene.querySelector(".hero-ocean-mid");
  const frontCanvas = scene && scene.querySelector(".hero-ocean-front");
  const midImage = scene && scene.querySelector(".hero-wave-mid");
  const frontImage = scene && scene.querySelector(".hero-wave-front");
  const fish = scene ? Array.from(scene.querySelectorAll(".hero-fish")) : [];

  if (!scene || !hero || !button || !midCanvas || !frontCanvas || !midImage || !frontImage || fish.length !== 3) return;

  const DURATION = 7200;
  const DPR_LIMIT = 2;
  const PIXEL_BUDGET = 6000000;
  const ASSET_TIMEOUT = 12000;
  const STRIPS = 40;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const crownImage = new Image();
  const ribbonImage = new Image();
  const sprayImage = new Image();
  crownImage.decoding = ribbonImage.decoding = sprayImage.decoding = "async";

  const OPTIONAL_ASSETS = [
    { key: "crown", image: crownImage, src: "/images/hero-wave-crown-v2.png" },
    { key: "ribbon", image: ribbonImage, src: "/images/hero-surge-ribbon-v2.png" },
    { key: "spray", image: sprayImage, src: "/images/hero-spray-atlas-v2.png" }
  ];

  /* The generated atlas is visually arranged as twelve subjects, but they do
     not fit a mathematical 4 x 3 grid. These padded source rectangles retain
     each complete crest/droplet group without cutting across its neighbour. */
  const SPRITE_RECTS = [
    { x: 58, y: 75, width: 365, height: 259 },
    { x: 470, y: 133, width: 267, height: 201 },
    { x: 795, y: 66, width: 342, height: 309 },
    { x: 1163, y: 144, width: 337, height: 195 },
    { x: 71, y: 418, width: 302, height: 210 },
    { x: 424, y: 400, width: 397, height: 227 },
    { x: 873, y: 449, width: 227, height: 180 },
    { x: 1163, y: 426, width: 312, height: 214 },
    { x: 66, y: 676, width: 369, height: 257 },
    { x: 507, y: 710, width: 239, height: 214 },
    { x: 833, y: 719, width: 246, height: 206 },
    { x: 1185, y: 735, width: 220, height: 175 }
  ];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let midBuffer = null;
  let frontBuffer = null;
  let crownBuffer = null;
  let crownFrameBuffer = null;
  let waterlineY = 0;
  let frameRequest = 0;
  let resizeRequest = 0;
  let runToken = 0;
  let startTime = 0;
  let state = "loading";
  let animations = [];
  let reducedTimer = 0;
  let requiredReady = false;
  let optionalLoadPromise = null;
  let resizeObserver = null;
  let intersectionObserver = null;
  let dprQuery = null;
  let rebuildPending = false;
  let lastCssWidth = 0;
  let lastCssHeight = 0;
  let lastDevicePixelRatio = window.devicePixelRatio || 1;
  let optionalReady = { crown: false, ribbon: false, spray: false };
  let runFeatures = { crown: false, ribbon: false, spray: false };
  let fallbackLogged = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mix(from, to, amount) {
    return from + (to - from) * amount;
  }

  function segment(progress, start, end) {
    return clamp((progress - start) / (end - start), 0, 1);
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function easeInCubic(value) {
    return value * value * value;
  }

  function easeOutCubic(value) {
    const t = 1 - value;
    return 1 - t * t * t;
  }

  function easeInOutCubic(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function imageReady(image, label) {
    return new Promise(function (resolve, reject) {
      let finished = false;

      function cleanup() {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
      }

      function finishReady() {
        if (finished) return;
        finished = true;
        cleanup();
        const decoded = image.decode ? image.decode().catch(function () {}) : Promise.resolve();
        decoded.then(resolve);
      }

      function onLoad() {
        if (image.naturalWidth) finishReady();
        else onError();
      }

      function onError() {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error("Unable to load " + label));
      }

      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);

      if (image.complete) {
        if (image.naturalWidth) finishReady();
        else onError();
      }
    });
  }

  function withTimeout(promise, label) {
    return new Promise(function (resolve, reject) {
      const timer = window.setTimeout(function () {
        reject(new Error("Timed out loading " + label));
      }, ASSET_TIMEOUT);
      promise.then(function (value) {
        window.clearTimeout(timer);
        resolve(value);
      }, function (error) {
        window.clearTimeout(timer);
        reject(error);
      });
    });
  }

  function context2d(canvas, label) {
    const context = canvas && canvas.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable: " + label);
    return context;
  }

  function makeBuffer() {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    context2d(canvas, "offscreen buffer");
    return canvas;
  }

  function sourceWidth(image) {
    return image.naturalWidth || image.width;
  }

  function sourceHeight(image) {
    return image.naturalHeight || image.height;
  }

  function makeCrownBuffer() {
    const canvas = document.createElement("canvas");
    canvas.width = crownImage.naturalWidth;
    canvas.height = crownImage.naturalHeight;
    const context = context2d(canvas, "crown buffer");
    context.drawImage(crownImage, 0, 0);
    /* ImageGen's breaker intentionally meets the right frame. Feather that
       registration edge so it merges with the older water instead of ever
       exposing a vertical cut while the crown travels left. */
    context.globalCompositeOperation = "destination-in";
    const mask = context.createLinearGradient(canvas.width * 0.82, 0, canvas.width, 0);
    mask.addColorStop(0, "rgba(0,0,0,1)");
    mask.addColorStop(0.72, "rgba(0,0,0,0.96)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = mask;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";
    return canvas;
  }

  /* Match object-fit: cover; object-position: center right; transform:
     scale(1.045) closely enough that the fallback/canvas crossfade is still. */
  function coverMetrics(image, scale) {
    const imageWidth = sourceWidth(image);
    const imageHeight = sourceHeight(image);
    const cover = Math.max(width / imageWidth, height / imageHeight);
    const baseWidth = imageWidth * cover;
    const baseHeight = imageHeight * cover;
    const baseX = width - baseWidth;
    const baseY = (height - baseHeight) / 2;
    const drawWidth = baseWidth * scale;
    const drawHeight = baseHeight * scale;
    const drawX = width / 2 + (baseX - width / 2) * scale;
    const drawY = height / 2 + (baseY - height / 2) * scale;
    return { x: drawX, y: drawY, width: drawWidth, height: drawHeight };
  }

  function drawCover(context, image, scale) {
    const metrics = coverMetrics(image, scale);
    context.drawImage(image, metrics.x, metrics.y, metrics.width, metrics.height);
    return metrics;
  }

  function rebuildCrownFrame() {
    crownFrameBuffer = null;
    if (!optionalReady.crown || !crownBuffer) return;
    const frame = makeBuffer();
    drawCover(context2d(frame, "aligned crown frame"), crownBuffer, 1.045);
    crownFrameBuffer = frame;
  }

  function rebuildCrownFrameSafely() {
    try {
      rebuildCrownFrame();
    } catch (error) {
      optionalReady.crown = false;
      runFeatures.crown = false;
      crownBuffer = null;
      crownFrameBuffer = null;
      if (window.console && console.warn) console.warn("Optional sea crown disabled", error);
    }
  }

  function rebuildBuffers() {
    const rect = scene.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    lastCssWidth = rect.width;
    lastCssHeight = rect.height;
    lastDevicePixelRatio = window.devicePixelRatio || 1;
    const cssPixels = rect.width * rect.height;
    const crownPixels = crownBuffer ? crownBuffer.width * crownBuffer.height : 0;
    const surfaceCount = crownBuffer ? 5 : 4;
    const frameBudget = Math.max(1, PIXEL_BUDGET - crownPixels);
    const budgetDpr = Math.sqrt(frameBudget / Math.max(1, cssPixels * surfaceCount));
    dpr = Math.max(0.25, Math.min(window.devicePixelRatio || 1, DPR_LIMIT, budgetDpr));
    width = Math.max(1, Math.round(rect.width * dpr));
    height = Math.max(1, Math.round(rect.height * dpr));

    [midCanvas, frontCanvas].forEach(function (canvas) {
      canvas.width = width;
      canvas.height = height;
      context2d(canvas, "visible ocean canvas");
    });

    midBuffer = makeBuffer();
    frontBuffer = makeBuffer();
    const midMetrics = drawCover(context2d(midBuffer, "mid buffer"), midImage, 1.045);
    drawCover(context2d(frontBuffer, "front buffer"), frontImage, 1.045);
    waterlineY = midMetrics.y + midMetrics.height * (574 / 941);
    rebuildCrownFrameSafely();
    drawRestFrame();
    return true;
  }

  function loadOptionalAssets() {
    if (reduced.matches) return Promise.resolve(optionalReady);
    if (optionalLoadPromise) return optionalLoadPromise;

    const pending = OPTIONAL_ASSETS.map(function (asset) {
      asset.image.src = asset.src;
      return withTimeout(imageReady(asset.image, asset.src), asset.src);
    });

    optionalLoadPromise = Promise.allSettled(pending).then(function (results) {
      results.forEach(function (result, index) {
        optionalReady[OPTIONAL_ASSETS[index].key] = result.status === "fulfilled";
      });

      if (optionalReady.crown) {
        try {
          crownBuffer = makeCrownBuffer();
          if (width && height) {
            if (state === "idle") tryRebuildBuffers();
            else {
              rebuildPending = true;
              rebuildCrownFrameSafely();
            }
          }
        } catch (error) {
          optionalReady.crown = false;
          crownBuffer = null;
          crownFrameBuffer = null;
          if (window.console && console.warn) console.warn("Optional sea crown disabled", error);
        }
      }
      return optionalReady;
    });
    return optionalLoadPromise;
  }

  function drawRestFrame() {
    if (!midBuffer || !frontBuffer) return;
    const midContext = context2d(midCanvas, "mid ocean");
    const frontContext = context2d(frontCanvas, "front ocean");
    midContext.clearRect(0, 0, width, height);
    frontContext.clearRect(0, 0, width, height);
    midContext.drawImage(midBuffer, 0, 0);
    frontContext.drawImage(frontBuffer, 0, 0);
  }

  /* Evaluate deformation at N + 1 shared edges, then draw every strip between
     the same adjacent destination boundaries. Integer boundaries prevent the
     independent overlaps/gaps that otherwise show up as vertical hairlines. */
  function drawContinuousStrips(context, buffer, offsetAt) {
    const sourceEdges = [];
    const targetEdges = [];
    const yOffsets = [];

    for (let index = 0; index <= STRIPS; index += 1) {
      const sourceX = Math.round(index * width / STRIPS);
      const offset = offsetAt(sourceX / width, sourceX);
      sourceEdges.push(sourceX);
      targetEdges.push(Math.round(sourceX + offset.x));
      yOffsets.push(offset.y);
    }

    /* The outer strips absorb movement at the frame edges so deformation can
       never uncover a transparent gutter on either side. */
    targetEdges[0] = Math.min(0, targetEdges[0]);
    targetEdges[STRIPS] = Math.max(width, targetEdges[STRIPS]);

    for (let index = 0; index < STRIPS; index += 1) {
      const sourceX = sourceEdges[index];
      const sourceStripWidth = sourceEdges[index + 1] - sourceX;
      const destinationX = targetEdges[index];
      const destinationWidth = targetEdges[index + 1] - destinationX;
      const offsetY = (yOffsets[index] + yOffsets[index + 1]) / 2;
      if (sourceStripWidth <= 0 || destinationWidth <= 0) continue;

      /* A strip pulled upward grows by the same amount, keeping its source
         bottom mapped exactly to the canvas bottom instead of opening a seam. */
      const destinationHeight = height + Math.max(0, -offsetY);
      context.drawImage(
        buffer,
        sourceX,
        0,
        sourceStripWidth,
        height,
        destinationX,
        offsetY,
        destinationWidth,
        destinationHeight
      );
    }
  }

  function drawMid(progress) {
    const context = context2d(midCanvas, "mid ocean");
    context.clearRect(0, 0, width, height);
    if (progress <= 0 || progress >= 0.94) {
      context.drawImage(midBuffer, 0, 0);
      return;
    }

    const travel = easeInOutCubic(segment(progress, 0.04, 0.57));
    const waveFront = mix(width * 1.18, -width * 0.18, travel);
    const attackEnvelope = Math.sin(Math.PI * segment(progress, 0.03, 0.62));
    const undertowPhase = segment(progress, 0.48, 0.88);
    const undertow = undertowPhase > 0 && undertowPhase < 1
      ? Math.sin(undertowPhase * Math.PI * 4) * Math.pow(1 - undertowPhase, 1.7)
      : 0;

    drawContinuousStrips(context, midBuffer, function (normalizedX, sourceX) {
      const distance = (sourceX - waveFront) / (width * 0.16);
      const impulse = Math.exp(-distance * distance) * attackEnvelope;
      const ripple = Math.sin(normalizedX * Math.PI * 8 - progress * Math.PI * 6);
      const offsetX = -width * 0.016 * impulse + width * 0.008 * undertow;
      const offsetY = -height * 0.024 * impulse + height * 0.004 * ripple * impulse - height * 0.006 * undertow;
      return { x: offsetX, y: offsetY };
    });
  }

  function drawDeformedFront(context, progress) {
    const charge = smoothstep(segment(progress, 0.0, 0.12));
    const strike = easeInOutCubic(segment(progress, 0.12, 0.54));
    const restore = easeOutCubic(segment(progress, 0.68, 0.96));
    let alpha;
    if (progress < 0.54) alpha = 1 - strike * 0.72;
    else if (progress < 0.68) alpha = 0.28;
    else alpha = mix(0.28, 1, restore);

    if (progress >= 0.68) {
      context.save();
      context.globalAlpha = restore * 0.68;
      context.drawImage(frontBuffer, 0, 0);
      context.restore();
    }

    context.save();
    context.globalAlpha = alpha;
    drawContinuousStrips(context, frontBuffer, function (normalizedX) {
      const headWeight = smoothstep(segment(normalizedX, 0.36, 0.97));
      let offsetX;
      let offsetY;
      if (progress < 0.68) {
        offsetX = width * 0.022 * charge * headWeight - width * 0.29 * strike * headWeight;
        offsetY = -height * 0.035 * Math.sin(Math.PI * strike) * headWeight + height * 0.045 * strike * headWeight;
      } else {
        offsetX = width * 0.11 * (1 - restore) * headWeight;
        offsetY = height * 0.035 * (1 - restore) * headWeight;
      }
      return { x: offsetX, y: offsetY };
    });
    context.restore();
  }

  function featherOriginalBreaker(context, progress) {
    if (!runFeatures.crown || progress < 0.025 || progress > 0.66) return;
    const charge = smoothstep(segment(progress, 0.025, 0.16));
    const release = 1 - smoothstep(segment(progress, 0.46, 0.66));
    const amount = charge * release * 0.92;
    if (amount <= 0) return;

    context.save();
    context.globalCompositeOperation = "destination-out";
    const mask = context.createLinearGradient(width * 0.38, 0, width, 0);
    mask.addColorStop(0, "rgba(0,0,0,0)");
    mask.addColorStop(0.58, "rgba(0,0,0," + (amount * 0.46) + ")");
    mask.addColorStop(1, "rgba(0,0,0," + amount + ")");
    context.fillStyle = mask;
    const top = Math.max(0, waterlineY - height * 0.48);
    context.fillRect(width * 0.34, top, width * 0.66, height - top);
    context.restore();
  }

  function drawAnchoredImage(context, image, x, y, drawWidth, rotation, scaleY, alpha, flipX) {
    if (alpha <= 0 || drawWidth <= 0) return;
    const drawHeight = drawWidth * sourceHeight(image) / sourceWidth(image);
    context.save();
    context.globalAlpha = alpha;
    context.translate(x + drawWidth, y + drawHeight);
    context.rotate(rotation);
    context.scale(flipX ? -1 : 1, scaleY);
    context.drawImage(image, flipX ? 0 : -drawWidth, -drawHeight, drawWidth, drawHeight);
    context.restore();
  }

  function drawRibbons(context, progress) {
    if (!runFeatures.ribbon) return;
    if (progress >= 0.1 && progress <= 0.66) {
      const phase = segment(progress, 0.1, 0.66);
      const enter = smoothstep(segment(phase, 0, 0.12));
      const exit = 1 - smoothstep(segment(phase, 0.72, 1));
      const x = mix(width * 0.22, -width * 1.14, easeInOutCubic(phase));
      const y = height * 0.49 - Math.sin(phase * Math.PI) * height * 0.025;
      drawAnchoredImage(context, ribbonImage, x, y, width * 1.28, -0.01, 1.02, enter * exit * 0.96, false);
    }

    if (progress >= 0.44 && progress <= 0.94) {
      const phase = segment(progress, 0.44, 0.94);
      const enter = smoothstep(segment(phase, 0, 0.18));
      const merge = 1 - smoothstep(segment(phase, 0.7, 1));
      const x = mix(width * 1.06, -width * 0.08, easeOutCubic(phase));
      const y = height * 0.52 + Math.sin(phase * Math.PI) * height * 0.018;
      drawAnchoredImage(context, ribbonImage, x, y, width * 1.16, 0.008, 0.98, enter * merge * 0.82, false);
    }
  }

  function drawCrown(context, progress) {
    if (!runFeatures.crown || !crownFrameBuffer) return;
    if (progress < 0.025 || progress > 0.57) return;
    const charge = smoothstep(segment(progress, 0.025, 0.16));
    const strike = easeInCubic(segment(progress, 0.16, 0.57));
    const isStriking = progress >= 0.16;
    const offsetX = isStriking
      ? mix(0, -width * 1.13, strike)
      : mix(width * 0.12, 0, charge);
    const rotation = (isStriking ? mix(-1.2, 6.5, strike) : mix(1.4, -1.2, charge)) * Math.PI / 180;
    const scaleY = isStriking ? mix(1.04, 0.86, strike) + Math.sin(strike * Math.PI) * 0.14 : mix(0.86, 1.04, charge);
    const appear = smoothstep(segment(progress, 0.025, 0.085));
    const vanish = 1 - smoothstep(segment(progress, 0.49, 0.57));

    /* The generated crown shares the mid-wave source dimensions. Draw it with
       the same cover transform, then animate around the mapped waterline. Its
       foot therefore remains attached on tall/narrow crops such as 390 x 574. */
    const pivotX = width * 0.78;
    context.save();
    context.globalAlpha = appear * vanish;
    context.translate(pivotX + offsetX, waterlineY);
    context.rotate(rotation);
    context.scale(1, scaleY);
    context.translate(-pivotX, -waterlineY);
    context.drawImage(crownFrameBuffer, 0, 0);
    context.restore();
  }

  function randomFactory(seed) {
    let value = seed >>> 0;
    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function createParticles() {
    const random = randomFactory(0x5ea2026);
    const particles = [];
    for (let index = 0; index < 34; index += 1) {
      const birth = 0.14 + random() * 0.27;
      const travelAtBirth = segment(birth, 0.14, 0.41);
      particles.push({
        birth: birth,
        life: 0.13 + random() * 0.15,
        x: 1.03 - travelAtBirth * 1.08 + (random() - 0.5) * 0.14,
        y: 0.25 + random() * 0.27,
        vx: -(0.1 + random() * 0.24),
        vy: -(0.05 + random() * 0.14),
        gravity: 0.16 + random() * 0.26,
        size: 0.035 + random() * 0.075,
        spin: (random() - 0.5) * 1.6,
        sprite: Math.floor(random() * 11),
        flip: true
      });
    }

    const landings = [
      { birth: 0.465, x: 0.74 },
      { birth: 0.54, x: 0.62 },
      { birth: 0.64, x: 0.47 }
    ];
    landings.forEach(function (landing) {
      for (let index = 0; index < 6; index += 1) {
        particles.push({
          birth: landing.birth + random() * 0.025,
          life: 0.09 + random() * 0.09,
          x: landing.x + (random() - 0.5) * 0.08,
          y: 0.58 + (random() - 0.5) * 0.035,
          vx: -(0.025 + random() * 0.1),
          vy: -(0.05 + random() * 0.12),
          gravity: 0.18 + random() * 0.24,
          size: 0.018 + random() * 0.045,
          spin: (random() - 0.5) * 2,
          sprite: random() > 0.58 ? 11 : Math.floor(random() * 11),
          flip: true
        });
      }
    });
    return particles;
  }

  const particles = createParticles();

  function drawParticles(context, progress) {
    if (!runFeatures.spray) return;

    particles.forEach(function (particle) {
      if (progress < particle.birth || progress > particle.birth + particle.life) return;
      const phase = (progress - particle.birth) / particle.life;
      const opacity = Math.pow(Math.sin(Math.PI * phase), 0.7);
      const x = (particle.x + particle.vx * phase) * width;
      const y = (particle.y + particle.vy * phase + particle.gravity * phase * phase) * height;
      const drawWidth = particle.size * width * (0.82 + Math.sin(Math.PI * phase) * 0.28);
      const source = SPRITE_RECTS[particle.sprite % SPRITE_RECTS.length];
      const drawHeight = drawWidth * source.height / source.width;

      context.save();
      context.globalAlpha = opacity;
      context.translate(x, y);
      context.rotate(particle.spin * phase);
      context.scale(particle.flip ? -1 : 1, 1);
        context.drawImage(
          sprayImage,
          source.x,
          source.y,
          source.width,
          source.height,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight
      );
      context.restore();
    });
  }

  function drawFront(progress) {
    const context = context2d(frontCanvas, "front ocean");
    context.clearRect(0, 0, width, height);
    if (progress <= 0 || progress >= 0.94) {
      context.drawImage(frontBuffer, 0, 0);
      return;
    }
    drawDeformedFront(context, progress);
    featherOriginalBreaker(context, progress);
    drawRibbons(context, progress);
    drawCrown(context, progress);
    drawParticles(context, progress);
  }

  function normalizeAngle(value, previous) {
    let result = value;
    if (typeof previous !== "number") return result;
    while (result - previous > 180) result -= 360;
    while (result - previous < -180) result += 360;
    return result;
  }

  function animateFish(sharedStart) {
    const rect = scene.getBoundingClientRect();
    const specs = [
      { delay: 2050, duration: 2550, distance: 0.19, rise: 0.2, submerge: 0.72, heading: -135, flip: true },
      { delay: 1880, duration: 2020, distance: 0.14, rise: 0.15, submerge: 0.76, heading: 135, flip: true },
      { delay: 1700, duration: 1680, distance: 0.11, rise: 0.12, submerge: 0.72, heading: -135, flip: false }
    ];

    fish.forEach(function (element, index) {
      const spec = specs[index];
      const elementWidth = element.getBoundingClientRect().width || 48;
      const distance = rect.width * spec.distance;
      const rise = Math.max(elementWidth * 2.4, rect.height * spec.rise);
      const startY = elementWidth * spec.submerge;
      const keyframes = [];
      let previousRotation;

      for (let step = 0; step <= 18; step += 1) {
        const progress = step / 18;
        const x = -distance * progress;
        const y = startY - rise * 4 * progress * (1 - progress);
        const tangentX = -distance;
        const tangentY = -4 * rise * (1 - 2 * progress);
        const tangent = Math.atan2(tangentY, tangentX) * 180 / Math.PI;
        const rotation = normalizeAngle(tangent - spec.heading, previousRotation);
        previousRotation = rotation;
        keyframes.push({
          offset: progress,
          transform: "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0) rotate(" + rotation.toFixed(2) + "deg)" + (spec.flip ? " scaleX(-1)" : "")
        });
      }

      const animation = element.animate(keyframes, {
        duration: spec.duration,
        delay: spec.delay,
        easing: "linear",
        fill: "both"
      });
      if (sharedStart != null) animation.startTime = sharedStart;
      animations.push(animation);
    });
  }

  function animateShade(sharedStart) {
    if (!shade) return;
    const animation = shade.animate([
      { opacity: 1, offset: 0 },
      { opacity: 0.88, offset: 0.24 },
      { opacity: 0.96, offset: 0.53 },
      { opacity: 0.9, offset: 0.72 },
      { opacity: 1, offset: 1 }
    ], {
      duration: DURATION,
      easing: "linear",
      fill: "both"
    });
    if (sharedStart != null) animation.startTime = sharedStart;
    animations.push(animation);
  }

  function cancelAnimations() {
    animations.forEach(function (animation) {
      try { animation.cancel(); } catch (_) {}
    });
    animations = [];
  }

  function stopActiveWork() {
    runToken += 1;
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    window.clearTimeout(reducedTimer);
    reducedTimer = 0;
    cancelAnimations();
  }

  function setLoadingState() {
    if (state === "unavailable") return;
    state = "loading";
    scene.classList.remove("is-canvas-ready");
    hero.classList.remove("is-sea-running");
    button.removeAttribute("aria-busy");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-label", "Ocean animation loading");
  }

  function setReadyState() {
    state = "idle";
    scene.classList.add("is-canvas-ready");
    hero.classList.remove("is-sea-running");
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-disabled");
    button.setAttribute("aria-label", "Play ocean animation");
  }

  function disableCanvasFallback(error) {
    stopActiveWork();
    state = "unavailable";
    rebuildPending = false;
    runFeatures = { crown: false, ribbon: false, spray: false };
    scene.classList.remove("is-canvas-ready");
    hero.classList.remove("is-sea-running");
    button.removeAttribute("aria-busy");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-label", "Ocean animation unavailable");
    if (!fallbackLogged && window.console && console.warn) {
      fallbackLogged = true;
      console.warn("Sea animation disabled; keeping the static ocean fallback.", error);
    }
    return false;
  }

  function tryRebuildBuffers() {
    if (!requiredReady || state === "unavailable") return false;
    try {
      if (!rebuildBuffers()) {
        setLoadingState();
        return false;
      }
      rebuildPending = false;
      setReadyState();
      return true;
    } catch (error) {
      return disableCanvasFallback(error);
    }
  }

  function settle(token) {
    if (token != null && token !== runToken) return false;
    if (state !== "running" && state !== "reduced") return false;
    stopActiveWork();
    try {
      drawRestFrame();
    } catch (error) {
      return disableCanvasFallback(error);
    }
    setReadyState();
    if (rebuildPending) tryRebuildBuffers();
    return state !== "unavailable";
  }

  function render(now, token) {
    if (token !== runToken || state !== "running") return;
    try {
      const progress = clamp((now - startTime) / DURATION, 0, 1);
      drawMid(progress);
      drawFront(progress);
      if (progress >= 1) {
        settle(token);
        return;
      }
      frameRequest = requestAnimationFrame(function (time) { render(time, token); });
    } catch (error) {
      disableCanvasFallback(error);
    }
  }

  function playReduced() {
    if (state !== "idle") return "busy";
    state = "reduced";
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", "Ocean response in progress");
    try {
      if (shade) {
        animations.push(shade.animate([
          { opacity: 1 },
          { opacity: 0.86 },
          { opacity: 1 }
        ], { duration: 700, easing: "ease-in-out" }));
      }
      reducedTimer = window.setTimeout(function () { settle(); }, 760);
      return "reduced";
    } catch (error) {
      disableCanvasFallback(error);
      return "unavailable";
    }
  }

  function play() {
    if (state === "loading") return "loading";
    if (state === "unavailable") return "unavailable";
    if (state !== "idle") return "busy";
    if (reduced.matches) return playReduced();

    if (rebuildPending && !tryRebuildBuffers()) {
      return state === "unavailable" ? "unavailable" : "loading";
    }
    loadOptionalAssets();
    runFeatures = {
      crown: optionalReady.crown,
      ribbon: optionalReady.ribbon,
      spray: optionalReady.spray
    };

    state = "running";
    runToken += 1;
    const token = runToken;
    hero.classList.add("is-sea-running");
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", "Ocean animation in progress");
    try {
      const sharedStart = document.timeline ? document.timeline.currentTime : null;
      startTime = sharedStart == null ? performance.now() : sharedStart;
      animateFish(sharedStart);
      animateShade(sharedStart);
      frameRequest = requestAnimationFrame(function (time) { render(time, token); });
      return true;
    } catch (error) {
      disableCanvasFallback(error);
      return "unavailable";
    }
  }

  const controller = {
    get state() { return state; },
    play: play,
    settle: function () { return settle(); }
  };

  window.__sea = controller;
  window.__setSea = function (alive) {
    if (alive) return controller.play();
    if (state === "loading") return "loading";
    if (state === "unavailable") return "unavailable";
    if (state === "idle") return false;
    return controller.settle() ? "settled" : (state === "unavailable" ? "unavailable" : false);
  };

  button.addEventListener("click", function () { play(); });

  setLoadingState();
  Promise.all([
    withTimeout(imageReady(midImage, "mid wave"), "mid wave"),
    withTimeout(imageReady(frontImage, "front wave"), "front wave")
  ]).then(function () {
    requiredReady = true;
    if (tryRebuildBuffers() && !reduced.matches) loadOptionalAssets();
  }).catch(function (error) {
    disableCanvasFallback(error);
  });

  function scheduleResize() {
    window.cancelAnimationFrame(resizeRequest);
    resizeRequest = window.requestAnimationFrame(function () {
      resizeRequest = 0;
      const rect = scene.getBoundingClientRect();
      const currentDevicePixelRatio = window.devicePixelRatio || 1;
      const sizeChanged = Math.abs(rect.width - lastCssWidth) > 0.5 || Math.abs(rect.height - lastCssHeight) > 0.5;
      const dprChanged = Math.abs(currentDevicePixelRatio - lastDevicePixelRatio) > 0.001;
      if (!sizeChanged && !dprChanged) return;
      if (state === "running" || state === "reduced") settle();
      if (requiredReady && state !== "unavailable") tryRebuildBuffers();
    });
  }

  window.addEventListener("resize", scheduleResize, { passive: true });
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(scene);
  }

  function watchDpr() {
    const query = window.matchMedia("(resolution: " + (window.devicePixelRatio || 1) + "dppx)");
    dprQuery = query;
    const onChange = function () {
      if (query.removeEventListener) query.removeEventListener("change", onChange);
      else if (query.removeListener) query.removeListener(onChange);
      if (dprQuery === query) watchDpr();
      scheduleResize();
    };
    if (query.addEventListener) query.addEventListener("change", onChange, { once: true });
    else if (query.addListener) query.addListener(onChange);
  }
  watchDpr();

  [midCanvas, frontCanvas].forEach(function (canvas) {
    canvas.addEventListener("contextlost", function (event) {
      event.preventDefault();
      disableCanvasFallback(new Error("Ocean canvas context lost"));
    });
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && (state === "running" || state === "reduced")) settle();
  });

  if ("IntersectionObserver" in window) {
    intersectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting && (state === "running" || state === "reduced")) settle();
      });
    }, { threshold: 0 });
    intersectionObserver.observe(hero);
  }

  const onReducedChange = function () {
    if (state === "running" || state === "reduced") settle();
    if (!reduced.matches && requiredReady && state === "idle") loadOptionalAssets();
  };
  if (reduced.addEventListener) reduced.addEventListener("change", onReducedChange);
  else if (reduced.addListener) reduced.addListener(onReducedChange);
})();
