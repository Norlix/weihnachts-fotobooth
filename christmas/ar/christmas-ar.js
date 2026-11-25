/*
 * Christmas AR filters for the Photobooth live preview.
 *
 * A transparent canvas is laid over the preview video. Face landmarks from MediaPipe place hats, beards and other
 * accessories, ambient effects like snow, lights and confetti are drawn on top. Photobooth composites the same canvas
 * into the photo (see core.js), so what the guests see in the preview is what ends up in the picture. Everything runs
 * in the browser, no image leaves the device.
 */

/* globals config */

const MODULE_URL = new URL(import.meta.url);
const VENDOR_URL = new URL('../vendor/mediapipe/', MODULE_URL);
const ASSET_URL = new URL('assets/', MODULE_URL);
const STORAGE_KEY = 'christmasArFilter';
const DELEGATE_KEY = 'christmasArDelegate';
const MAX_FACES = 6;
const DETECTION_WIDTH = 960;
const SCAN_WIDTH = 640;
// The face detector looks at the whole frame in a very small input, so faces of people standing further back in a
// group are missed. Zoomed tiles, scanned one per frame in rotation, find them. Neighbouring tiles overlap by half.
const SCAN_TILES = [0, 0.4].flatMap((y) => [0, 0.25, 0.5].map((x) => ({ x, y, w: 0.5, h: 0.6 })));
// Tracked faces are looked at again in a close-up around their last position, which keeps them stable far more reliably
// than waiting for a tile scan to come around.
const REFRESH_SPAN = 3.2;
const REFRESH_AFTER_MS = 90;
const SCAN_EVERY = 1;
const CONFIDENCE = 0.35;
const SMOOTHING = 0.6;
// A face that is missed for a few frames keeps its accessories and fades out instead of vanishing.
const TRACK_HOLD_MS = 700;
const TRACK_FADE_MS = 300;
const TRACK_CONFIRM_HITS = 2;
const TRACK_MATCH_DISTANCE = 0.9;
const TRACK_DUPLICATE_DISTANCE = 0.5;
const SNOWFLAKE_COUNT = 140;
const CONFETTI_COUNT = 90;
const SPARKLE_COUNT = 26;
const BAUBLE_COLORS = ['#da1e28', '#f1c21b', '#0f62fe', '#24a148', '#ff8389', '#78a9ff'];
const CONFETTI_COLORS = ['#da1e28', '#f1c21b', '#24a148', '#78a9ff', '#ffffff', '#ff8389'];

// MediaPipe face mesh indices
const LANDMARK = {
    forehead: 10,
    chin: 152,
    cheekLeft: 234,
    cheekRight: 454,
    eyeLeftOuter: 33,
    eyeLeftInner: 133,
    eyeRightInner: 362,
    eyeRightOuter: 263,
    noseTip: 1,
    lipTop: 0,
    lipBottom: 17
};

const LABELS = {
    de: {
        none: 'Ohne',
        santa: 'Mütze',
        claus: 'Weihnachtsmann',
        reindeer: 'Rentier',
        elf: 'Elf',
        angel: 'Engel',
        snowman: 'Schneemann',
        stars: 'Sternenbrille',
        snow: 'Schnee',
        lights: 'Lichter',
        baubles: 'Kugeln',
        confetti: 'Konfetti',
        festive: 'Festlich'
    },
    en: {
        none: 'None',
        santa: 'Hat',
        claus: 'Santa',
        reindeer: 'Reindeer',
        elf: 'Elf',
        angel: 'Angel',
        snowman: 'Snowman',
        stars: 'Star glasses',
        snow: 'Snow',
        lights: 'Lights',
        baubles: 'Baubles',
        confetti: 'Confetti',
        festive: 'Festive'
    }
};

const FILTERS = [
    { id: 'none', icon: '🚫', parts: [] },
    { id: 'santa', icon: '🎅', parts: ['hat'] },
    { id: 'claus', icon: '🤶', parts: ['hat', 'beard', 'mustache'] },
    { id: 'reindeer', icon: '🦌', parts: ['antlers', 'nose'] },
    { id: 'elf', icon: '🧝', parts: ['hatGreen', 'ears'] },
    { id: 'angel', icon: '😇', parts: ['halo', 'sparkles'] },
    { id: 'snowman', icon: '⛄', parts: ['topHat', 'carrot', 'scarf', 'snow'] },
    { id: 'stars', icon: '🌟', parts: ['starGlasses', 'sparkles'] },
    { id: 'snow', icon: '❄️', parts: ['snow', 'glow'] },
    { id: 'lights', icon: '💡', parts: ['lights', 'glow'] },
    { id: 'baubles', icon: '🎁', parts: ['baubles', 'snow'] },
    { id: 'confetti', icon: '🎊', parts: ['confetti', 'sparkles'] },
    { id: 'festive', icon: '🎄', parts: ['hat', 'snow', 'glow'] }
];
const FACE_PARTS = new Set([
    'hat',
    'hatGreen',
    'antlers',
    'nose',
    'beard',
    'mustache',
    'ears',
    'halo',
    'topHat',
    'carrot',
    'scarf',
    'starGlasses'
]);

const video = document.getElementById('preview--video');
const wrapper = document.getElementById('preview-wrapper');

if (video && wrapper) {
    start();
}

function start() {
    document.head.append(
        Object.assign(document.createElement('link'), {
            rel: 'stylesheet',
            href: new URL('christmas-ar.css', MODULE_URL).href
        })
    );

    const canvas = document.createElement('canvas');
    canvas.id = 'preview--ar';
    canvas.className = video.className;
    canvas.setAttribute('style', video.getAttribute('style') ?? '');
    canvas.style.display = 'none';
    video.after(canvas);
    const context = canvas.getContext('2d');

    const images = {
        hat: loadImage('hat.svg'),
        hatGreen: loadImage('hat-green.svg'),
        antlers: loadImage('antlers.svg'),
        beard: loadImage('beard.svg'),
        mustache: loadImage('mustache.svg'),
        topHat: loadImage('tophat.svg'),
        ear: loadImage('ear.svg'),
        scarf: loadImage('scarf.svg')
    };

    const detectionCanvas = document.createElement('canvas');
    const state = {
        detectionCanvas,
        detectionContext: detectionCanvas.getContext('2d', { willReadFrequently: true }),
        scanContext: null,
        filterId: readStoredFilter(),
        scanCanvas: document.createElement('canvas'),
        landmarker: null,
        scanner: null,
        scanIndex: 0,
        scanTurn: 0,
        scanMs: 0,
        landmarkerLoading: false,
        delegate: null,
        lastVideoTime: -1,
        tracks: [],
        nextTrackId: 1,
        faces: [],
        detectMs: 0,
        snow: createSnow(),
        confetti: createConfetti(),
        sparkles: createSparkles(),
        baubles: createBaubles(),
        lastFrame: performance.now(),
        frames: 0,
        fps: 0,
        fpsSince: performance.now()
    };

    state.scanContext = state.scanCanvas.getContext('2d', { willReadFrequently: true });
    const bar = createFilterBar(state);

    async function ensureLandmarker() {
        if (state.landmarker || state.landmarkerLoading) {
            return;
        }
        state.landmarkerLoading = true;
        try {
            const { FaceLandmarker, FilesetResolver } = await import(new URL('vision_bundle.mjs', VENDOR_URL).href);
            const fileset = await FilesetResolver.forVisionTasks(VENDOR_URL.href.replace(/\/$/, ''));
            const createOptions = (delegate, runningMode = 'VIDEO') => ({
                baseOptions: { modelAssetPath: new URL('face_landmarker.task', VENDOR_URL).href, delegate },
                runningMode,
                numFaces: MAX_FACES,
                minFaceDetectionConfidence: CONFIDENCE,
                minFacePresenceConfidence: CONFIDENCE,
                minTrackingConfidence: CONFIDENCE
            });
            // The GPU delegate can fail silently without a suitable graphics driver and then detects no faces at
            // all, so the reliable CPU delegate is the default. Set localStorage.christmasArDelegate = 'GPU' to try it.
            const preferred = readStored(DELEGATE_KEY, 'CPU') === 'GPU' ? 'GPU' : 'CPU';
            const fallback = preferred === 'GPU' ? 'CPU' : 'GPU';
            try {
                state.landmarker = await FaceLandmarker.createFromOptions(fileset, createOptions(preferred));
                state.delegate = preferred;
            } catch (error) {
                console.warn(`Christmas AR: ${preferred} delegate unavailable, falling back to ${fallback}.`, error);
                state.landmarker = await FaceLandmarker.createFromOptions(fileset, createOptions(fallback));
                state.delegate = fallback;
            }
            // The scanner has no tracking state, so it can be pointed at a different tile on every call.
            state.scanner = await FaceLandmarker.createFromOptions(fileset, createOptions(state.delegate, 'IMAGE'));
        } catch (error) {
            console.error('Christmas AR: face landmarker could not be loaded.', error);
        } finally {
            state.landmarkerLoading = false;
        }
    }

    function currentFilter() {
        return FILTERS.find((filter) => filter.id === state.filterId) ?? FILTERS[0];
    }

    function detectFaces(width, height, now) {
        if (!state.landmarker || video.currentTime === state.lastVideoTime) {
            return;
        }
        state.lastVideoTime = video.currentTime;
        // Detection runs on a downscaled copy. That keeps 4K cameras fast, and the landmarks are normalised, so they
        // map onto the full resolution frame unchanged.
        const detectionHeight = Math.round((DETECTION_WIDTH * video.videoHeight) / video.videoWidth);
        if (state.detectionCanvas.width !== DETECTION_WIDTH || state.detectionCanvas.height !== detectionHeight) {
            state.detectionCanvas.width = DETECTION_WIDTH;
            state.detectionCanvas.height = detectionHeight;
        }
        state.detectionContext.drawImage(video, 0, 0, DETECTION_WIDTH, detectionHeight);
        const startedAt = performance.now();
        const result = state.landmarker.detectForVideo(state.detectionCanvas, startedAt);
        state.detectMs = state.detectMs * 0.9 + (performance.now() - startedAt) * 0.1;
        updateTracks(
            state,
            result.faceLandmarks.map((landmarks) => faceTransform(landmarks, width, height)),
            now
        );
        if (state.scanner) {
            state.scanTurn += 1;
            if (state.scanTurn % SCAN_EVERY === 0) {
                scanRegion(SCAN_TILES[state.scanIndex], width, height, now);
                state.scanIndex = (state.scanIndex + 1) % SCAN_TILES.length;
            }
            const stale = state.tracks
                .filter((track) => now - track.lastSeen > REFRESH_AFTER_MS)
                .sort((a, b) => a.lastSeen - b.lastSeen)[0];
            if (stale) {
                scanRegion(closeUp(stale.face, width, height), width, height, now);
            }
        }
    }

    function scanRegion(tile, width, height, now) {
        const sourceWidth = tile.w * video.videoWidth;
        const sourceHeight = tile.h * video.videoHeight;
        const scanHeight = Math.round((SCAN_WIDTH * sourceHeight) / sourceWidth);
        if (state.scanCanvas.width !== SCAN_WIDTH || state.scanCanvas.height !== scanHeight) {
            state.scanCanvas.width = SCAN_WIDTH;
            state.scanCanvas.height = scanHeight;
        }
        state.scanContext.drawImage(
            video,
            tile.x * video.videoWidth,
            tile.y * video.videoHeight,
            sourceWidth,
            sourceHeight,
            0,
            0,
            SCAN_WIDTH,
            scanHeight
        );
        const startedAt = performance.now();
        const result = state.scanner.detect(state.scanCanvas);
        state.scanMs = state.scanMs * 0.9 + (performance.now() - startedAt) * 0.1;
        const margin = 0.02;
        const detected = [];
        for (const landmarks of result.faceLandmarks) {
            // A face cut off by the edge of a tile would get distorted landmarks. It is covered by a neighbouring
            // tile, unless the tile edge is the edge of the camera frame.
            const xs = landmarks.map((landmark) => landmark.x);
            const ys = landmarks.map((landmark) => landmark.y);
            const cutOff =
                (tile.x > 0 && Math.min(...xs) < margin) ||
                (tile.x + tile.w < 1 && Math.max(...xs) > 1 - margin) ||
                (tile.y > 0 && Math.min(...ys) < margin) ||
                (tile.y + tile.h < 1 && Math.max(...ys) > 1 - margin);
            if (!cutOff) {
                const mapped = landmarks.map((landmark) => ({
                    x: tile.x + landmark.x * tile.w,
                    y: tile.y + landmark.y * tile.h
                }));
                detected.push(faceTransform(mapped, width, height));
            }
        }
        updateTracks(state, detected, now);
    }

    function render(now) {
        requestAnimationFrame(render);

        const filter = currentFilter();
        const visible = video.offsetParent !== null && video.readyState >= 2 && video.videoWidth > 0;
        canvas.style.display = visible && filter.id !== 'none' ? 'block' : 'none';
        bar.update();

        if (!visible || filter.id === 'none') {
            state.tracks = [];
            state.faces = [];
            return;
        }

        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }

        const has = (part) => filter.parts.includes(part);
        if (filter.parts.some((part) => FACE_PARTS.has(part))) {
            void ensureLandmarker();
            detectFaces(canvas.width, canvas.height, now);
        } else {
            state.tracks = [];
        }
        state.tracks = state.tracks.filter((track) => now - track.lastSeen < TRACK_HOLD_MS);
        state.faces = state.tracks
            .filter((track) => track.hits >= TRACK_CONFIRM_HITS)
            .map((track) => ({
                face: track.face,
                alpha: Math.min(1, (TRACK_HOLD_MS - (now - track.lastSeen)) / TRACK_FADE_MS)
            }));

        const delta = Math.min((now - state.lastFrame) / 1000, 0.1);
        state.lastFrame = now;
        const { width, height } = canvas;

        context.clearRect(0, 0, width, height);
        if (has('glow')) {
            drawGlow(context, width, height);
        }
        for (const { face, alpha } of state.faces) {
            context.globalAlpha = alpha;
            if (has('scarf')) {
                drawScarf(context, images.scarf, face);
            }
            if (has('beard')) {
                drawBeard(context, images.beard, face);
            }
            if (has('mustache')) {
                drawMustache(context, images.mustache, face);
            }
            if (has('ears')) {
                drawEars(context, images.ear, face);
            }
            if (has('hat')) {
                drawHat(context, images.hat, face);
            }
            if (has('hatGreen')) {
                drawHat(context, images.hatGreen, face);
            }
            if (has('topHat')) {
                drawTopHat(context, images.topHat, face);
            }
            if (has('antlers')) {
                drawAntlers(context, images.antlers, face);
            }
            if (has('halo')) {
                drawHalo(context, face, now);
            }
            if (has('starGlasses')) {
                drawStarGlasses(context, face);
            }
            if (has('carrot')) {
                drawCarrot(context, face);
            }
            if (has('nose')) {
                drawNose(context, face);
            }
        }
        context.globalAlpha = 1;
        if (has('lights')) {
            drawLights(context, width, height, now);
        }
        if (has('baubles')) {
            drawBaubles(context, state.baubles, width, height, now);
        }
        if (has('snow')) {
            drawSnow(context, state.snow, width, height, delta);
        }
        if (has('confetti')) {
            drawConfetti(context, state.confetti, width, height, delta);
        }
        if (has('sparkles')) {
            drawSparkles(context, state.sparkles, width, height, now);
        }

        state.frames += 1;
        if (now - state.fpsSince >= 1000) {
            state.fps = Math.round((state.frames * 1000) / (now - state.fpsSince));
            state.frames = 0;
            state.fpsSince = now;
        }
    }

    requestAnimationFrame(render);

    window.christmasAr = {
        // Called by core.js right after the video frame was copied into the capture canvas.
        drawOverlay(targetContext) {
            if (canvas.style.display === 'none') {
                return;
            }
            targetContext.drawImage(canvas, 0, 0, targetContext.canvas.width, targetContext.canvas.height);
        },
        setFilter(filterId) {
            state.filterId = FILTERS.some((filter) => filter.id === filterId) ? filterId : 'none';
            storeFilter(state.filterId);
        },
        getFilter: () => state.filterId,
        filters: () => FILTERS.map((filter) => filter.id),
        // Steps through the filters, wrapping around at both ends. Used by the keyboard control of the start screen.
        cycle(direction) {
            const index = FILTERS.findIndex((filter) => filter.id === state.filterId);
            const next = (index + direction + FILTERS.length) % FILTERS.length;
            state.filterId = FILTERS[next].id;
            storeFilter(state.filterId);
        },
        stats: () => ({
            faces: state.faces.length,
            tracks: state.tracks.map((track) => ({
                id: track.id,
                x: Math.round(track.face.nose.x),
                y: Math.round(track.face.nose.y)
            })),
            scanMs: Math.round(state.scanMs),
            fps: state.fps,
            detectMs: Math.round(state.detectMs),
            delegate: state.delegate,
            filter: state.filterId
        })
    };
}

function loadImage(name) {
    const image = new Image();
    image.src = new URL(name, ASSET_URL).href;
    return image;
}

function readStored(key, fallback) {
    try {
        return window.localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function readStoredFilter() {
    return readStored(STORAGE_KEY, 'none');
}

function storeFilter(filterId) {
    try {
        window.localStorage.setItem(STORAGE_KEY, filterId);
    } catch {
        // storage is optional
    }
}

function createFilterBar(state) {
    const language = typeof config !== 'undefined' && config.ui?.language === 'de' ? 'de' : 'en';
    const bar = document.createElement('div');
    bar.id = 'christmas-ar-bar';
    bar.setAttribute('role', 'toolbar');

    const buttons = FILTERS.map((filter) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.filter = filter.id;
        const icon = document.createElement('span');
        icon.className = 'christmas-ar-icon';
        icon.textContent = filter.icon;
        const label = document.createElement('span');
        label.textContent = LABELS[language][filter.id];
        button.append(icon, label);
        button.addEventListener('click', () => {
            state.filterId = filter.id;
            storeFilter(filter.id);
        });
        bar.append(button);
        return button;
    });

    document.body.append(bar);
    let shownFilter = null;

    return {
        update() {
            const startStage = document.querySelector('.stage[data-stage="start"]');
            // The Christmas start screen hides the bar while its title slide is shown.
            const view = document.body.dataset.christmasView ?? 'camera';
            const visible = view === 'camera' && Boolean(startStage?.classList.contains('stage--active'));
            bar.classList.toggle('christmas-ar-bar--visible', visible);
            for (const button of buttons) {
                button.setAttribute('aria-pressed', String(button.dataset.filter === state.filterId));
            }
            if (visible && shownFilter !== state.filterId) {
                shownFilter = state.filterId;
                // With many filters the bar scrolls, so the active one is kept in view.
                buttons
                    .find((button) => button.dataset.filter === state.filterId)
                    ?.scrollIntoView({
                        block: 'nearest',
                        inline: 'center'
                    });
            }
        }
    };
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function middle(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Square region around a face in normalised frame coordinates, kept inside the frame.
function closeUp(face, width, height) {
    const side = face.width * REFRESH_SPAN;
    const w = Math.min(1, side / width);
    const h = Math.min(1, side / height);
    const centre = middle(face.cheekLeft, face.cheekRight);
    return {
        x: Math.min(Math.max(centre.x / width - w / 2, 0), 1 - w),
        y: Math.min(Math.max(centre.y / height - h / 2, 0), 1 - h),
        w,
        h
    };
}

function faceTransform(landmarks, width, height) {
    const point = (index) => ({ x: landmarks[index].x * width, y: landmarks[index].y * height });
    const cheekLeft = point(LANDMARK.cheekLeft);
    const cheekRight = point(LANDMARK.cheekRight);
    const eyeLeft = middle(point(LANDMARK.eyeLeftOuter), point(LANDMARK.eyeLeftInner));
    const eyeRight = middle(point(LANDMARK.eyeRightInner), point(LANDMARK.eyeRightOuter));
    const faceWidth = distance(cheekLeft, cheekRight);
    const angle = Math.atan2(
        landmarks[LANDMARK.eyeRightOuter].y * height - landmarks[LANDMARK.eyeLeftOuter].y * height,
        landmarks[LANDMARK.eyeRightOuter].x * width - landmarks[LANDMARK.eyeLeftOuter].x * width
    );
    const up = { x: Math.sin(angle), y: -Math.cos(angle) };

    // Project the forehead onto the vertical axis through the middle of the face, so a turned head does not
    // push hats and antlers sideways.
    const cheekMiddle = middle(cheekLeft, cheekRight);
    const forehead = point(LANDMARK.forehead);
    const heightAboveCheeks = (forehead.x - cheekMiddle.x) * up.x + (forehead.y - cheekMiddle.y) * up.y;

    return {
        width: faceWidth,
        angle,
        // unit vector pointing from chin towards the top of the head
        up,
        forehead: { x: cheekMiddle.x + up.x * heightAboveCheeks, y: cheekMiddle.y + up.y * heightAboveCheeks },
        nose: point(LANDMARK.noseTip),
        chin: point(LANDMARK.chin),
        lipTop: point(LANDMARK.lipTop),
        lipBottom: point(LANDMARK.lipBottom),
        eyeLeft,
        eyeRight,
        cheekLeft,
        cheekRight
    };
}

function smooth(previous, next) {
    const mix = (a, b) => a + (b - a) * SMOOTHING;
    const result = {};
    for (const key of Object.keys(next)) {
        if (key === 'up') {
            continue;
        }
        const value = next[key];
        result[key] =
            typeof value === 'number'
                ? mix(previous[key], value)
                : { x: mix(previous[key].x, value.x), y: mix(previous[key].y, value.y) };
    }
    result.up = { x: Math.sin(result.angle), y: -Math.cos(result.angle) };
    return result;
}

/*
 * The detector returns faces in no particular order, so they are matched to existing tracks by position. Every face
 * keeps its own smoothing state and identity, which stops accessories from jumping between people, and a track
 * survives short gaps in the detection.
 */
function updateTracks(state, detections, now) {
    const center = (face) => middle(face.cheekLeft, face.cheekRight);
    const pairs = [];
    detections.forEach((face, detectionIndex) => {
        state.tracks.forEach((track, trackIndex) => {
            const gap = distance(center(face), center(track.face));
            const ratio = face.width / track.face.width;
            const reach = Math.max(face.width, track.face.width) * TRACK_MATCH_DISTANCE;
            if (gap < reach && ratio > 0.5 && ratio < 2) {
                pairs.push({ detectionIndex, trackIndex, gap });
            }
        });
    });
    pairs.sort((a, b) => a.gap - b.gap);

    const usedDetections = new Set();
    const usedTracks = new Set();
    for (const { detectionIndex, trackIndex } of pairs) {
        if (usedDetections.has(detectionIndex) || usedTracks.has(trackIndex)) {
            continue;
        }
        usedDetections.add(detectionIndex);
        usedTracks.add(trackIndex);
        const track = state.tracks[trackIndex];
        track.face = smooth(track.face, detections[detectionIndex]);
        track.lastSeen = now;
        track.hits += 1;
    }
    detections.forEach((face, detectionIndex) => {
        if (!usedDetections.has(detectionIndex)) {
            state.tracks.push({ id: state.nextTrackId, face, lastSeen: now, hits: 1 });
            state.nextTrackId += 1;
        }
    });

    // Detections of the same face at different scales can create a second track on top of the first. The one with the
    // longer history wins.
    state.tracks = state.tracks.filter(
        (track) =>
            !state.tracks.some(
                (other) =>
                    other !== track &&
                    (other.hits > track.hits || (other.hits === track.hits && other.id < track.id)) &&
                    distance(center(other.face), center(track.face)) <
                        Math.max(other.face.width, track.face.width) * TRACK_DUPLICATE_DISTANCE
            )
    );
}

/*
 * Draws an image relative to a face point. widthFactor is relative to the face width and lift moves the anchor along
 * the up axis of the head (negative values move it down).
 */
function drawSprite(context, image, face, point, { widthFactor, anchorX, anchorY, lift = 0, mirror = false }) {
    if (!image.complete || image.naturalWidth === 0) {
        return;
    }
    const width = face.width * widthFactor;
    const height = (width / image.naturalWidth) * image.naturalHeight;

    context.save();
    context.translate(point.x + face.up.x * face.width * lift, point.y + face.up.y * face.width * lift);
    context.rotate(face.angle);
    if (mirror) {
        context.scale(-1, 1);
    }
    context.drawImage(image, -width * anchorX, -height * anchorY, width, height);
    context.restore();
}

function drawHat(context, image, face) {
    drawSprite(context, image, face, face.forehead, { widthFactor: 1.55, anchorX: 0.5, anchorY: 0.84, lift: 0.1 });
}

function drawTopHat(context, image, face) {
    drawSprite(context, image, face, face.forehead, { widthFactor: 1.15, anchorX: 0.5, anchorY: 0.78, lift: 0.08 });
}

function drawAntlers(context, image, face) {
    drawSprite(context, image, face, face.forehead, { widthFactor: 1.5, anchorX: 0.5, anchorY: 0.93, lift: 0.14 });
}

function drawBeard(context, image, face) {
    drawSprite(context, image, face, face.lipBottom, { widthFactor: 1.02, anchorX: 0.5, anchorY: 0.19, lift: 0.04 });
}

function drawMustache(context, image, face) {
    drawSprite(context, image, face, face.lipTop, { widthFactor: 0.62, anchorX: 0.5, anchorY: 0.62, lift: 0.015 });
}

function drawScarf(context, image, face) {
    drawSprite(context, image, face, face.chin, { widthFactor: 1.7, anchorX: 0.5, anchorY: 0.15, lift: -0.16 });
}

function drawEars(context, image, face) {
    drawSprite(context, image, face, face.cheekLeft, { widthFactor: 0.44, anchorX: 0.92, anchorY: 0.88, lift: 0.1 });
    drawSprite(context, image, face, face.cheekRight, {
        widthFactor: 0.44,
        anchorX: 0.92,
        anchorY: 0.88,
        lift: 0.1,
        mirror: true
    });
}

function drawNose(context, face) {
    const radius = face.width * 0.085;
    const gradient = context.createRadialGradient(
        face.nose.x - radius * 0.35,
        face.nose.y - radius * 0.35,
        radius * 0.1,
        face.nose.x,
        face.nose.y,
        radius
    );
    gradient.addColorStop(0, '#ff8a8a');
    gradient.addColorStop(0.45, '#e0262d');
    gradient.addColorStop(1, '#a3121a');

    context.beginPath();
    context.arc(face.nose.x, face.nose.y, radius, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();
}

function drawCarrot(context, face) {
    const length = face.width * 0.5;
    const half = face.width * 0.075;
    context.save();
    context.translate(face.nose.x, face.nose.y - half * 0.6);
    context.rotate(face.angle - 0.45);
    const gradient = context.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, '#ff9a3c');
    gradient.addColorStop(1, '#e2631a');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(-half, 0);
    context.lineTo(half, 0);
    context.lineTo(0, length);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(150, 60, 10, 0.55)';
    context.lineWidth = Math.max(1.5, half * 0.12);
    for (const fraction of [0.3, 0.55, 0.78]) {
        const reach = half * (1 - fraction);
        context.beginPath();
        context.moveTo(-reach * 0.7, length * fraction);
        context.lineTo(reach * 0.7, length * fraction);
        context.stroke();
    }
    context.restore();
}

function drawHalo(context, face, now) {
    const center = {
        x: face.forehead.x + face.up.x * face.width * 0.34,
        y: face.forehead.y + face.up.y * face.width * 0.34
    };
    const pulse = 0.75 + 0.25 * Math.sin(now / 400);
    context.save();
    context.translate(center.x, center.y);
    context.rotate(face.angle);
    context.shadowColor = `rgba(255, 220, 100, ${pulse})`;
    context.shadowBlur = face.width * 0.18;
    context.lineWidth = face.width * 0.05;
    const gradient = context.createLinearGradient(-face.width * 0.4, 0, face.width * 0.4, 0);
    gradient.addColorStop(0, '#f1c21b');
    gradient.addColorStop(0.5, '#fff3b0');
    gradient.addColorStop(1, '#f1c21b');
    context.strokeStyle = gradient;
    context.beginPath();
    context.ellipse(0, 0, face.width * 0.4, face.width * 0.1, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
}

function starPath(context, radius, innerRatio = 0.45) {
    context.beginPath();
    for (let index = 0; index < 10; index += 1) {
        const angle = -Math.PI / 2 + (index * Math.PI) / 5;
        const length = index % 2 === 0 ? radius : radius * innerRatio;
        const x = Math.cos(angle) * length;
        const y = Math.sin(angle) * length;
        if (index === 0) {
            context.moveTo(x, y);
        } else {
            context.lineTo(x, y);
        }
    }
    context.closePath();
}

function drawStarGlasses(context, face) {
    const radius = face.width * 0.21;
    context.save();
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2, face.width * 0.025);
    context.strokeStyle = '#b8860b';
    context.beginPath();
    context.moveTo(face.eyeLeft.x, face.eyeLeft.y);
    context.lineTo(face.eyeRight.x, face.eyeRight.y);
    context.stroke();
    for (const eye of [face.eyeLeft, face.eyeRight]) {
        context.save();
        context.translate(eye.x, eye.y);
        context.rotate(face.angle);
        starPath(context, radius);
        context.fillStyle = 'rgba(241, 194, 27, 0.82)';
        context.fill();
        context.stroke();
        context.restore();
    }
    context.restore();
}

function drawGlow(context, width, height) {
    context.fillStyle = 'rgba(255, 170, 80, 0.1)';
    context.fillRect(0, 0, width, height);

    const vignette = context.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.35,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.7
    );
    vignette.addColorStop(0, 'rgba(160, 10, 25, 0)');
    vignette.addColorStop(1, 'rgba(160, 10, 25, 0.45)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
}

function drawLights(context, width, height, now) {
    const bulbCount = 18;
    const wireY = (x) => height * 0.11 + Math.abs(Math.sin((x / width) * Math.PI * 6)) * height * 0.05;
    context.save();
    context.strokeStyle = '#1b1b1b';
    context.lineWidth = Math.max(2, height * 0.004);
    context.beginPath();
    for (let x = 0; x <= width; x += 12) {
        context[x === 0 ? 'moveTo' : 'lineTo'](x, wireY(x));
    }
    context.stroke();
    for (let index = 0; index < bulbCount; index += 1) {
        const x = ((index + 0.5) * width) / bulbCount;
        const y = wireY(x);
        const color = BAUBLE_COLORS[index % BAUBLE_COLORS.length];
        const twinkle = 0.65 + 0.35 * Math.sin(now / 320 + index * 1.7);
        context.shadowColor = color;
        context.shadowBlur = height * 0.04 * twinkle;
        context.globalAlpha = 0.55 + 0.45 * twinkle;
        context.fillStyle = color;
        context.beginPath();
        context.ellipse(x, y + height * 0.032, height * 0.017, height * 0.028, 0, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

function createBaubles() {
    return Array.from({ length: 9 }, (_, index) => ({
        x: (index + 0.5) / 9 + (Math.random() - 0.5) * 0.04,
        string: 0.06 + Math.random() * 0.2,
        radius: 0.028 + Math.random() * 0.016,
        color: BAUBLE_COLORS[index % BAUBLE_COLORS.length],
        phase: Math.random() * Math.PI * 2
    }));
}

function drawBaubles(context, baubles, width, height, now) {
    context.save();
    for (const bauble of baubles) {
        const sway = Math.sin(now / 1100 + bauble.phase) * 0.04;
        const radius = bauble.radius * height;
        const anchorX = bauble.x * width;
        const length = bauble.string * height;
        const x = anchorX + Math.sin(sway) * length;
        const y = Math.cos(sway) * length + radius;
        context.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        context.lineWidth = Math.max(1.5, height * 0.002);
        context.beginPath();
        context.moveTo(anchorX, 0);
        context.lineTo(x, y - radius);
        context.stroke();
        context.fillStyle = '#d0d0d0';
        context.fillRect(x - radius * 0.22, y - radius * 1.12, radius * 0.44, radius * 0.18);
        const gradient = context.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.25, bauble.color);
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
        context.fillStyle = bauble.color;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = gradient;
        context.fill();
    }
    context.restore();
}

function createSnow() {
    return Array.from({ length: SNOWFLAKE_COUNT }, () => ({
        x: Math.random(),
        y: Math.random(),
        radius: 0.002 + Math.random() * 0.005,
        speed: 0.04 + Math.random() * 0.08,
        drift: Math.random() * Math.PI * 2
    }));
}

function drawSnow(context, flakes, width, height, delta) {
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (const flake of flakes) {
        flake.y += flake.speed * delta;
        flake.drift += delta;
        flake.x += Math.sin(flake.drift) * 0.01 * delta;
        if (flake.y > 1.02) {
            flake.y = -0.02;
            flake.x = Math.random();
        }
        context.beginPath();
        context.arc(flake.x * width, flake.y * height, flake.radius * Math.max(width, height), 0, Math.PI * 2);
        context.fill();
    }
}

function createConfetti() {
    return Array.from({ length: CONFETTI_COUNT }, () => ({
        x: Math.random(),
        y: Math.random(),
        size: 0.008 + Math.random() * 0.01,
        speed: 0.12 + Math.random() * 0.18,
        spin: (Math.random() - 0.5) * 8,
        angle: Math.random() * Math.PI * 2,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
    }));
}

function drawConfetti(context, pieces, width, height, delta) {
    for (const piece of pieces) {
        piece.y += piece.speed * delta;
        piece.angle += piece.spin * delta;
        if (piece.y > 1.03) {
            piece.y = -0.03;
            piece.x = Math.random();
        }
        const size = piece.size * Math.max(width, height);
        context.save();
        context.translate(piece.x * width, piece.y * height);
        context.rotate(piece.angle);
        context.fillStyle = piece.color;
        context.fillRect(-size / 2, -size / 4, size, size / 2);
        context.restore();
    }
}

function createSparkles() {
    return Array.from({ length: SPARKLE_COUNT }, () => ({
        x: Math.random(),
        y: Math.random(),
        size: 0.012 + Math.random() * 0.02,
        phase: Math.random() * Math.PI * 2,
        rate: 0.8 + Math.random() * 1.6
    }));
}

function drawSparkles(context, sparkles, width, height, now) {
    context.save();
    for (const sparkle of sparkles) {
        const strength = Math.max(0, Math.sin((now / 1000) * sparkle.rate + sparkle.phase));
        if (strength < 0.05) {
            continue;
        }
        const radius = sparkle.size * height * strength;
        context.save();
        context.translate(sparkle.x * width, sparkle.y * height);
        context.shadowColor = 'rgba(255, 240, 160, 0.9)';
        context.shadowBlur = radius * 1.2;
        context.fillStyle = 'rgba(255, 250, 220, 0.95)';
        starPath(context, radius, 0.2);
        context.fill();
        context.restore();
    }
    context.restore();
}
