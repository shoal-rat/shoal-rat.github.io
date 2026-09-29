/* The living print — behaviour for the home hero.
   CSS owns the continuous motion (tiles drifting, swells, crest sway, mist).
   This file only adds the occasional events CSS cannot express: fish that
   leap out of the near swell on real ballistic arcs, foam peeling off the
   crest's lip, the loading fade, off-screen pausing, and the controller the
   site terminal talks to (`wake` / `still`). */
(function () {
  "use strict";

  const sea = document.getElementById("sea");
  const hero = sea && sea.closest(".hero");
  const button = document.getElementById("sea-button");
  const crest = sea && sea.querySelector("[data-sea-crest]");
  const near = sea && sea.querySelector("[data-sea-near]");
  const fishLayer = sea && sea.querySelector("[data-sea-fish]");
  const sprayLayer = sea && sea.querySelector("[data-sea-spray]");
  const header = document.querySelector(".site-header");

  /* --- header: transparent while the print is behind it ----------------- */
  if (header && document.body.classList.contains("is-home")) {
    let queued = false;
    const syncHeader = function () {
      queued = false;
      header.classList.toggle("is-clear", window.scrollY < 24);
    };
    window.addEventListener("scroll", function () {
      if (!queued) {
        queued = true;
        window.requestAnimationFrame(syncHeader);
      }
    }, { passive: true });
    syncHeader();
  }

  if (!sea || !hero || !crest || !near || !fishLayer || !sprayLayer) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const FISH_SRC = "/images/sea/fish-2.webp";
  const PRELOAD = [
    "/images/sea/far.webp",
    "/images/sea/mid.webp",
    "/images/sea/near.webp",
    FISH_SRC
  ];

  /* Leading edge of the crest's lip in the crest image's own 0..1 space:
     the claw fingers that spray peels away from. */
  const LIP = [
    [0.30, 0.13], [0.27, 0.20], [0.25, 0.28], [0.24, 0.37],
    [0.33, 0.09], [0.36, 0.07], [0.29, 0.45], [0.34, 0.52]
  ];

  let ready = false;
  let visible = true;
  let still = false;
  let fishTimer = 0;
  let sprayTimer = 0;
  let activeFish = 0;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function running() {
    return ready && visible && !still && !document.hidden && !reduced.matches;
  }

  function seaRect() {
    return sea.getBoundingClientRect();
  }

  function local(rect, base) {
    return {
      left: rect.left - base.left,
      top: rect.top - base.top,
      width: rect.width,
      height: rect.height
    };
  }

  /* --- foam droplets ------------------------------------------------------ */

  function droplet(x, y, vx, vy, gravity, duration, size, delay) {
    const dot = document.createElement("i");
    dot.style.setProperty("--d", size.toFixed(1) + "px");
    sprayLayer.appendChild(dot);
    const frames = [];
    const steps = 10;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const seconds = t * duration / 1000;
      const px = x + vx * seconds;
      const py = y + vy * seconds + 0.5 * gravity * seconds * seconds;
      const fade = t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 1.4);
      frames.push({
        offset: t,
        transform: "translate3d(" + px.toFixed(1) + "px," + py.toFixed(1) + "px,0) scale(" + (1 - t * 0.35).toFixed(3) + ")",
        opacity: Math.max(0, Math.min(1, fade)).toFixed(3)
      });
    }
    const animation = dot.animate(frames, {
      duration: duration,
      delay: delay || 0,
      easing: "linear",
      fill: "both"
    });
    animation.onfinish = animation.oncancel = function () { dot.remove(); };
  }

  function splash(x, y, direction, strength) {
    const count = Math.round(6 + strength * 5);
    for (let index = 0; index < count; index += 1) {
      droplet(
        x + rand(-10, 10),
        y + rand(-4, 4),
        rand(-70, 70) + direction * rand(20, 70),
        -rand(90, 190) * (0.7 + strength * 0.5),
        rand(520, 680),
        rand(620, 900),
        rand(2.8, 6.4),
        rand(0, 60)
      );
    }
  }

  function crestSpray(count) {
    const base = seaRect();
    const box = local(crest.getBoundingClientRect(), base);
    if (!box.width) return;
    for (let index = 0; index < count; index += 1) {
      const lip = LIP[Math.floor(Math.random() * LIP.length)];
      droplet(
        box.left + box.width * lip[0] + rand(-8, 8),
        box.top + box.height * lip[1] + rand(-8, 8),
        -rand(30, 110),
        -rand(5, 60),
        rand(90, 170),
        rand(1300, 2200),
        rand(2.6, 6.2),
        rand(0, 380)
      );
    }
  }

  /* --- fish ----------------------------------------------------------------
     Constant horizontal speed and a parabolic height: a real ballistic arc.
     The sprite faces left, so its rotation is the path tangent minus 180°.
     It starts and ends inside the near swell, which hides it on both ends. */

  function leap(options) {
    const opts = options || {};
    const base = seaRect();
    const water = local(near.getBoundingClientRect(), base);
    if (!base.width || !water.height) return false;

    const narrow = base.width < 880;
    const fish = document.createElement("img");
    fish.src = FISH_SRC;
    fish.alt = "";
    fish.decoding = "async";
    fishLayer.appendChild(fish);
    const fishWidth = fish.getBoundingClientRect().width || 56;
    const fishHeight = fishWidth * 166 / 360;

    const surface = water.top + water.height * 0.2;
    const x0 = opts.x != null ? opts.x : base.width * (narrow ? rand(0.4, 0.8) : rand(0.55, 0.66));
    const y0 = water.top + water.height * 0.62;
    const travel = base.width * (narrow ? rand(0.12, 0.2) : rand(0.07, 0.12)) * (opts.scale || 1);
    const rise = base.height * (narrow ? rand(0.13, 0.18) : rand(0.17, 0.23)) * (opts.scale || 1);
    const apex = surface - rise;
    const lift = apex - y0; // negative
    const duration = rand(1650, 2100) * Math.sqrt(opts.scale || 1);

    const frames = [];
    const steps = 24;
    let previous;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = x0 - travel * t;
      const y = y0 + lift * 4 * t * (1 - t);
      const angle = Math.atan2(lift * 4 * (1 - 2 * t), -travel) * 180 / Math.PI;
      let rotation = angle - 180;
      if (previous != null) {
        while (rotation - previous > 180) rotation -= 360;
        while (rotation - previous < -180) rotation += 360;
      }
      previous = rotation;
      frames.push({
        offset: t,
        transform: "translate3d(" + (x - fishWidth / 2).toFixed(1) + "px," + (y - fishHeight / 2).toFixed(1) + "px,0) rotate(" + rotation.toFixed(1) + "deg)",
        opacity: 1
      });
    }

    activeFish += 1;
    const animation = fish.animate(frames, { duration: duration, easing: "linear", fill: "both" });
    animation.onfinish = animation.oncancel = function () {
      fish.remove();
      activeFish = Math.max(0, activeFish - 1);
    };

    /* splash where the arc crosses the swell's surface, up and down */
    const k = (surface - y0) / lift;
    if (k > 0 && k < 1) {
      const tUp = (1 - Math.sqrt(1 - k)) / 2;
      const tDown = 1 - tUp;
      window.setTimeout(function () {
        splash(x0 - travel * tUp, surface, -1, 0.6);
      }, duration * tUp);
      window.setTimeout(function () {
        splash(x0 - travel * tDown, surface, -1, 1);
      }, duration * tDown);
    }
    return true;
  }

  function school() {
    const base = seaRect();
    const x = base.width * (base.width < 880 ? rand(0.5, 0.75) : rand(0.56, 0.64));
    leap({ x: x, scale: 1 });
    window.setTimeout(function () { leap({ x: x + base.width * 0.035, scale: 0.8 }); }, 260);
    if (Math.random() > 0.45) {
      window.setTimeout(function () { leap({ x: x - base.width * 0.03, scale: 0.65 }); }, 520);
    }
  }

  /* --- schedulers ------------------------------------------------------------ */

  function scheduleFish(delay) {
    window.clearTimeout(fishTimer);
    fishTimer = window.setTimeout(function () {
      if (running() && activeFish === 0) {
        if (Math.random() > 0.72) school();
        else leap();
      }
      scheduleFish(rand(7000, 12500));
    }, delay);
  }

  function scheduleSpray(delay) {
    window.clearTimeout(sprayTimer);
    sprayTimer = window.setTimeout(function () {
      if (running()) crestSpray(Math.round(rand(3, 7)));
      scheduleSpray(rand(1600, 3200));
    }, delay);
  }

  function syncPaused() {
    sea.classList.toggle("is-paused", !visible || still || document.hidden);
  }

  /* --- controller shared with the site terminal ----------------------------- */

  function wake() {
    if (!ready) return "loading";
    const wasStill = still;
    still = false;
    syncPaused();
    if (reduced.matches) return "reduced";
    school();
    crestSpray(8);
    if (wasStill) {
      scheduleFish(rand(6000, 9000));
      scheduleSpray(900);
    }
    return true;
  }

  function settle() {
    if (!ready) return "loading";
    if (still) return false;
    still = true;
    syncPaused();
    return "settled";
  }

  window.__sea = {
    get state() {
      if (!ready) return "loading";
      if (reduced.matches) return "reduced";
      return still ? "still" : "alive";
    },
    play: wake,
    settle: settle
  };
  window.__setSea = function (alive) {
    return alive ? wake() : settle();
  };

  button.addEventListener("click", function () {
    if (reduced.matches || !ready) return;
    if (still) {
      wake();
      return;
    }
    if (activeFish < 3) school();
    crestSpray(5);
  });

  /* --- loading: fade the planes in together once they are decoded --------- */

  function decode(src) {
    return new Promise(function (resolve) {
      const image = new Image();
      image.decoding = "async";
      image.onload = function () {
        if (image.decode) image.decode().then(resolve, resolve);
        else resolve();
      };
      image.onerror = resolve;
      image.src = src;
    });
  }

  const inline = Array.prototype.slice.call(sea.querySelectorAll("img")).map(function (image) {
    if (image.complete) return Promise.resolve();
    return new Promise(function (resolve) {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  });

  Promise.race([
    Promise.all(inline.concat(PRELOAD.map(decode))),
    new Promise(function (resolve) { window.setTimeout(resolve, 4000); })
  ]).then(function () {
    window.requestAnimationFrame(function () {
      sea.classList.remove("is-loading");
      ready = true;
      button.setAttribute("aria-label", "Make the fish leap");
      if (!reduced.matches) {
        scheduleFish(2200);
        scheduleSpray(1400);
      }
    });
  });

  /* --- never animate unseen ------------------------------------------------- */

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible = entry.isIntersecting;
        syncPaused();
      });
    }, { threshold: 0.02 }).observe(hero);
  }

  document.addEventListener("visibilitychange", syncPaused);

  const onReducedChange = function () {
    if (reduced.matches) {
      window.clearTimeout(fishTimer);
      window.clearTimeout(sprayTimer);
    } else if (ready) {
      scheduleFish(3000);
      scheduleSpray(1500);
    }
  };
  if (reduced.addEventListener) reduced.addEventListener("change", onReducedChange);
  else if (reduced.addListener) reduced.addListener(onReducedChange);
})();
