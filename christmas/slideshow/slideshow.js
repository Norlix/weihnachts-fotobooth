/*
 * Slideshow for the Christmas photo booth.
 *
 * Patterns taken from live event slideshows. Single pictures with a soft crossfade and a very slow Ken Burns move, a
 * blurred copy of the picture as background so mixed formats never show black bars, a regular photo wall as an
 * interlude, and a celebration when a new picture arrives so guests notice theirs.
 *
 * Parameters
 *   m     address of the manifest, required
 *   t     seconds per picture, default 6
 *   p     seconds between checks for new pictures, default 10
 *   wall  show the photo wall after this many pictures, 0 switches it off, default 7
 *   back  address to open on Esc
 */
(() => {
    const parameters = new URLSearchParams(location.search);
    const manifestUrl = parameters.get('m');
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
    const SHOW_MS = clamp(Number(parameters.get('t') ?? 6), 3, 30) * 1000;
    const POLL_MS = clamp(Number(parameters.get('p') ?? 10), 5, 120) * 1000;
    const WALL_EVERY = clamp(Number(parameters.get('wall') ?? 7), 0, 50);
    const FADE_MS = 1400;
    const WALL_MS = 9000;
    const NEW_BONUS_MS = 2500;
    const RUSH_MS = 4000; // shorter slides while several new pictures wait
    const MIN_FOR_WALL = 6;

    const $ = (id) => document.getElementById(id);
    const layers = [$('layerA'), $('layerB')];
    const wall = $('wall');
    const progress = $('progress');
    const stateLabel = $('state');
    const root = document.documentElement;

    const KEN_BURNS = [
        { name: 'kb-in', origin: '50% 55%' },
        { name: 'kb-drift-left', origin: '50% 50%' },
        { name: 'kb-out', origin: '50% 50%' },
        { name: 'kb-drift-right', origin: '50% 50%' }
    ];
    const ENTRANCES = ['enter-fade', 'enter-lift', 'enter-fade', 'enter-zoom'];

    const known = new Map(); // address -> { url, added, isNew }
    const fresh = []; // pictures that arrived since the start and are waiting for their turn
    let bag = []; // shuffled round of the remaining pictures
    let front = -1;
    let lastUrl = null;
    let slidesSinceWall = 0;
    let slideIndex = 0;
    let firstPoll = true;
    let paused = false;
    let timer = null;
    let current = null;

    function shuffle(list) {
        for (let index = list.length - 1; index > 0; index -= 1) {
            const other = Math.floor(Math.random() * (index + 1));
            [list[index], list[other]] = [list[other], list[index]];
        }
        return list;
    }

    function setState(text) {
        stateLabel.textContent = text;
        stateLabel.classList.toggle('visible', Boolean(text));
    }

    function updateCount() {
        $('count').textContent = known.size ? `${known.size} ${known.size === 1 ? 'Foto' : 'Fotos'}` : '';
        $('empty').style.display = known.size ? 'none' : '';
    }

    async function poll() {
        if (!manifestUrl) {
            $('emptyHint').textContent = 'Die Adresse des Manifests fehlt. Die Seite mit ?m=<Adresse> öffnen.';
            return;
        }
        try {
            // No cache buster in the address, a signed link must stay exactly as it was created.
            const response = await fetch(manifestUrl, { cache: 'no-store' });
            if (response.status === 403 && !manifestUrl.includes('X-Amz-')) {
                throw new Error('Anmeldung nötig');
            }
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            const manifest = await response.json();
            const urls = new Set();
            for (const image of manifest.images ?? []) {
                urls.add(image.url);
                if (!known.has(image.url)) {
                    const entry = { url: image.url, added: image.added, isNew: !firstPoll };
                    known.set(image.url, entry);
                    if (entry.isNew) {
                        fresh.push(entry);
                    }
                }
            }
            for (const url of [...known.keys()]) {
                if (!urls.has(url)) {
                    known.delete(url);
                }
            }
            bag = bag.filter((entry) => known.has(entry.url));
            firstPoll = false;
            setState('');
            updateCount();
        } catch (error) {
            setState(error.message === 'Anmeldung nötig' ? 'Anmeldung nötig' : 'Verbindung unterbrochen, die vorhandenen Bilder laufen weiter');
        }
    }

    function nextEntry() {
        if (fresh.length) {
            return fresh.shift();
        }
        if (!bag.length && known.size) {
            bag = shuffle([...known.values()].filter((entry) => entry.url !== lastUrl));
            if (!bag.length) {
                bag = [...known.values()];
            }
        }
        return bag.pop() ?? null;
    }

    function load(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.decoding = 'async';
            const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
            image.onload = () => { clearTimeout(timeout); resolve(image); };
            image.onerror = () => { clearTimeout(timeout); reject(new Error('error')); };
            image.src = url;
        });
    }

    function schedule(milliseconds) {
        clearTimeout(timer);
        progress.style.transition = 'none';
        progress.style.transform = 'scaleX(0)';
        void progress.offsetWidth;
        progress.style.transition = `transform ${milliseconds}ms linear`;
        progress.style.transform = 'scaleX(1)';
        timer = setTimeout(advance, milliseconds);
    }

    async function advance() {
        if (paused) {
            return;
        }
        if (WALL_EVERY > 0 && slidesSinceWall >= WALL_EVERY && known.size >= MIN_FOR_WALL && !fresh.length) {
            showWall();
            return;
        }
        const entry = nextEntry();
        if (!entry) {
            schedule(2000);
            return;
        }
        try {
            const image = await load(entry.url);
            show(entry, image);
        } catch {
            known.delete(entry.url);
            updateCount();
            timer = setTimeout(advance, 300);
        }
    }

    function show(entry, image) {
        const back = front === -1 ? 0 : 1 - front;
        const layer = layers[back];
        const variant = KEN_BURNS[slideIndex % KEN_BURNS.length];
        const entrance = ENTRANCES[slideIndex % ENTRANCES.length];
        slideIndex += 1;
        const duration = fresh.length >= 3 ? RUSH_MS : SHOW_MS;
        const holdMs = duration + (entry.isNew ? NEW_BONUS_MS : 0);

        root.style.setProperty('--show-ms', `${holdMs}ms`);
        layer.className = 'layer';
        layer.innerHTML = '';
        const ambient = document.createElement('div');
        ambient.className = 'ambient';
        ambient.style.backgroundImage = `url("${image.src}")`;
        const frame = document.createElement('div');
        frame.className = 'frame';
        frame.style.setProperty('--enter-animation', entrance);
        const photo = document.createElement('img');
        photo.className = 'photo';
        photo.alt = '';
        photo.src = image.src;
        photo.style.setProperty('--kb', variant.name);
        photo.style.setProperty('--kb-origin', variant.origin);
        frame.append(photo);
        layer.append(ambient, frame);
        if (entry.isNew) {
            const badge = document.createElement('div');
            badge.className = 'badge';
            badge.textContent = '★ Neu in der Diashow';
            layer.append(badge);
            setTimeout(() => confetti(), 700);
            entry.isNew = false;
        }

        // The new layer fades in over the old one, which only disappears afterwards, so there is no dip in between.
        void layer.offsetWidth;
        layer.classList.add('entering');
        const old = front === -1 ? null : layers[front];
        setTimeout(() => {
            layer.classList.remove('entering');
            layer.classList.add('front');
            if (old) {
                old.classList.remove('front');
                old.classList.add('hidden-instantly');
            }
        }, FADE_MS);
        front = back;
        lastUrl = entry.url;
        current = entry;
        slidesSinceWall += 1;
        schedule(holdMs);
    }

    function showWall() {
        const pool = [...known.values()].sort((a, b) => b.added - a.added).slice(0, 36);
        const count = pool.length >= 12 ? 12 : pool.length >= 8 ? 8 : 6;
        const tiles = shuffle(pool).slice(0, count);
        const columns = count === 12 ? 4 : count === 8 ? 4 : 3;
        const grid = wall.querySelector('.grid');
        grid.innerHTML = '';
        grid.style.setProperty('--cols', String(columns));
        grid.style.setProperty('--rows', String(count / columns));
        tiles.forEach((entry, index) => {
            const figure = document.createElement('figure');
            figure.style.setProperty('--i', String(index));
            figure.style.setProperty('--tilt', `${(Math.random() * 3 - 1.5).toFixed(2)}deg`);
            const image = document.createElement('img');
            image.alt = '';
            image.src = entry.url;
            figure.append(image);
            grid.append(figure);
        });
        wall.classList.remove('leaving');
        wall.classList.add('visible');
        slidesSinceWall = 0;
        schedule(WALL_MS);
        clearTimeout(timer);
        timer = setTimeout(() => {
            wall.classList.add('leaving');
            setTimeout(() => {
                wall.classList.remove('visible', 'leaving');
                advance();
            }, FADE_MS);
        }, WALL_MS);
    }

    /* ---------- Snow and confetti on one canvas ---------- */
    const canvas = $('snow');
    const context = canvas.getContext('2d');
    const flakes = [];
    const pieces = [];
    const COLORS = ['#da1e28', '#f1c21b', '#24a148', '#78a9ff', '#ffffff', '#ff8389'];

    function resize() {
        canvas.width = innerWidth;
        canvas.height = innerHeight;
    }

    function seedSnow() {
        flakes.length = 0;
        for (let index = 0; index < 90; index += 1) {
            const depth = Math.random();
            flakes.push({ x: Math.random(), y: Math.random(), size: 1.5 + depth * 4, speed: 0.02 + depth * 0.06, drift: Math.random() * Math.PI * 2, alpha: 0.25 + depth * 0.5 });
        }
    }

    function confetti() {
        for (let index = 0; index < 110; index += 1) {
            pieces.push({
                x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
                y: innerHeight * 0.12,
                vx: (Math.random() - 0.5) * innerWidth * 0.9,
                vy: -Math.random() * innerHeight * 0.55,
                angle: Math.random() * Math.PI * 2,
                spin: (Math.random() - 0.5) * 12,
                size: innerHeight * (0.008 + Math.random() * 0.012),
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                life: 0
            });
        }
    }

    let lastFrame = performance.now();
    function draw(now) {
        requestAnimationFrame(draw);
        const delta = Math.min((now - lastFrame) / 1000, 0.1);
        lastFrame = now;
        context.clearRect(0, 0, canvas.width, canvas.height);
        for (const flake of flakes) {
            flake.y += flake.speed * delta;
            flake.drift += delta * 0.8;
            flake.x += Math.sin(flake.drift) * 0.012 * delta;
            if (flake.y > 1.02) { flake.y = -0.02; flake.x = Math.random(); }
            context.globalAlpha = flake.alpha;
            context.fillStyle = '#fff';
            context.beginPath();
            context.arc(flake.x * canvas.width, flake.y * canvas.height, flake.size, 0, Math.PI * 2);
            context.fill();
        }
        for (let index = pieces.length - 1; index >= 0; index -= 1) {
            const piece = pieces[index];
            piece.life += delta;
            piece.vy += innerHeight * 1.1 * delta;
            piece.vx *= 1 - 0.9 * delta;
            piece.x += piece.vx * delta;
            piece.y += piece.vy * delta;
            piece.angle += piece.spin * delta;
            if (piece.y > canvas.height + 40 || piece.life > 6) { pieces.splice(index, 1); continue; }
            context.save();
            context.globalAlpha = Math.max(0, 1 - piece.life / 6);
            context.translate(piece.x, piece.y);
            context.rotate(piece.angle);
            context.fillStyle = piece.color;
            context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
            context.restore();
        }
        context.globalAlpha = 1;
    }

    /* ---------- Controls ---------- */
    let idleTimer;
    function wake() {
        document.body.classList.remove('idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
    }
    addEventListener('mousemove', wake);
    addEventListener('keydown', (event) => {
        wake();
        if (event.key === 'f' || event.key === 'F') {
            document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        } else if (event.key === ' ') {
            event.preventDefault();
            paused = !paused;
            if (paused) {
                clearTimeout(timer);
                progress.style.transition = 'none';
                setState('Pause');
            } else {
                setState('');
                advance();
            }
        } else if (event.key === 'ArrowRight') {
            clearTimeout(timer);
            advance();
        } else if (event.key === 'Escape' && parameters.get('back')) {
            location.href = parameters.get('back');
        }
    });
    addEventListener('resize', resize);

    resize();
    seedSnow();
    requestAnimationFrame(draw);
    wake();
    poll().then(() => {
        advance();
        setInterval(poll, POLL_MS);
    });
})();
