/*
 * Christmas start screen for the Photobooth.
 *
 * Two views sit on top of the regular start stage.
 *   intro  A title slide with a legend and the options photo, collage and slideshow.
 *   camera The live preview with the filter bar, operated with the keyboard.
 *
 * The intro is shown after the first start and after a period without interaction. Photos and collages are still
 * taken by the regular Photobooth buttons, this module only clicks them.
 */

/* globals config */

const MODULE_URL = new URL(import.meta.url);
const ASSET_URL = new URL('assets/', MODULE_URL);

const MODE_KEY = 'christmasMode';
const NEXT_KEY = 'christmasNext';
const SHOOT_COOLDOWN_MS = 700;

const TEXTS = {
    de: {
        legendTitle: "So funktioniert's",
        filter: 'Filter wechseln',
        photo: 'Foto aufnehmen',
        collage: 'Collage aufnehmen',
        slideshow: 'Diashow',
        spaceOrEnter: 'Leertaste oder Enter',
        back: 'Zurück zum Start',
        shareNote: 'Nach dem Foto fragen wir, ob es in der Diashow der Weihnachtsfeier gezeigt werden darf.',
        shootPhoto: 'Foto auslösen',
        shootCollage: 'Collage auslösen',
        back_short: 'Zurück',
        keyboardHint: 'Mit der Tastatur'
    },
    en: {
        legendTitle: 'How it works',
        filter: 'Switch filter',
        photo: 'Take a photo',
        collage: 'Take a collage',
        slideshow: 'Slideshow',
        spaceOrEnter: 'Space or Enter',
        back: 'Back to start',
        shareNote: 'After the photo we ask whether it may be shown in the Christmas party slideshow.',
        shootPhoto: 'Take photo',
        shootCollage: 'Take collage',
        back_short: 'Back',
        keyboardHint: 'With the keyboard'
    }
};

const language = typeof config !== 'undefined' && config.ui?.language === 'de' ? 'de' : 'en';
const text = TEXTS[language];
const idleMs = Number(config.christmasui?.idle_minutes ?? 5) * 60 * 1000;

const state = {
    view: 'intro',
    mode: 'photo',
    lastActive: Date.now(),
    lastShoot: 0
};

start();

function start() {
    state.mode = readStorage(MODE_KEY) === 'collage' ? 'collage' : 'photo';

    const intro = buildIntro();
    const hud = buildHud();
    document.body.append(intro.element, hud.element);

    const applyView = (view) => {
        state.view = view;
        document.body.dataset.christmasView = view;
        intro.element.hidden = view !== 'intro';
        hud.element.hidden = view !== 'camera';
        if (view === 'intro') {
            intro.focusFirst();
        }
        if (view === 'camera') {
            hud.update();
        }
    };

    const chooseMode = (mode) => {
        state.mode = mode;
        writeStorage(MODE_KEY, mode);
        state.lastShoot = Date.now();
        applyView('camera');
    };

    intro.onChoose((choice) => {
        if (choice === 'slideshow') {
            const link = document.querySelector('a.slideshow-button');
            if (link) {
                window.location.href = link.href;
            }
            return;
        }
        chooseMode(choice);
    });
    hud.onBack(() => applyView('intro'));
    hud.onShoot(() => shoot());
    hud.setModeResolver(() => state.mode);

    function startStageActive() {
        return Boolean(document.querySelector('.stage[data-stage="start"]')?.classList.contains('stage--active'));
    }

    function shoot() {
        if (!startStageActive() || document.querySelector('dialog[open]')) {
            return;
        }
        const now = Date.now();
        if (now - state.lastShoot < SHOOT_COOLDOWN_MS) {
            return;
        }
        state.lastShoot = now;
        const selector = state.mode === 'collage' ? '.takeCollage' : '.takePic';
        document.querySelector(selector)?.click();
    }

    document.addEventListener(
        'keydown',
        (event) => {
            touch();
            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }
            if (state.view === 'camera') {
                if (!startStageActive() || document.querySelector('dialog[open]')) {
                    return;
                }
                const handled = handleCameraKey(event);
                if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            } else if (state.view === 'intro') {
                const handled = intro.handleKey(event);
                if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }
        },
        true
    );

    function handleCameraKey(event) {
        switch (event.key) {
            case 'ArrowLeft':
                window.christmasAr?.cycle(-1);
                return true;
            case 'ArrowRight':
                window.christmasAr?.cycle(1);
                return true;
            case ' ':
            case 'Enter':
                if (!event.repeat) {
                    shoot();
                }
                return true;
            case 'Escape':
                applyView('intro');
                return true;
            default:
                return false;
        }
    }

    function touch() {
        state.lastActive = Date.now();
    }

    for (const type of ['pointerdown', 'pointermove', 'touchstart', 'wheel']) {
        document.addEventListener(type, touch, { passive: true, capture: true });
    }

    // After a quiet period the booth returns to the title slide. A reload also clears result pages and dialogs.
    // Every page load starts with the title slide, which includes the reload Photobooth triggers after a result.
    setInterval(() => {
        if (state.view === 'intro' || Date.now() - state.lastActive < idleMs) {
            return;
        }
        window.location.reload();
    }, 1000);

    // "New photo" and "New collage" on the result page lead back to the filter selection and not straight into a new
    // countdown. A reload clears the result page and restarts the camera cleanly.
    document.addEventListener(
        'click',
        (event) => {
            const button = event.target.closest?.('.newpic, .newcollage');
            if (!button) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            writeStorage(NEXT_KEY, button.classList.contains('newcollage') ? 'collage' : 'photo');
            window.location.reload();
        },
        true
    );

    const next = readStorage(NEXT_KEY);
    if (next === 'photo' || next === 'collage') {
        removeStorage(NEXT_KEY);
        state.mode = next;
        writeStorage(MODE_KEY, next);
        state.lastShoot = Date.now();
        applyView('camera');
    } else {
        applyView('intro');
    }
}

function readStorage(key) {
    try {
        return window.sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function removeStorage(key) {
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // storage is optional
    }
}

function writeStorage(key, value) {
    try {
        window.sessionStorage.setItem(key, value);
    } catch {
        // storage is optional
    }
}

function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (content !== undefined) {
        node.textContent = content;
    }
    return node;
}

function keycap(label) {
    return element('kbd', 'ci-key', label);
}

function buildIntro() {
    const root = element('div', 'ci-intro');
    root.id = 'christmas-intro';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', config.christmasui.title);

    const sky = element('div', 'ci-sky');
    for (let index = 0; index < 70; index += 1) {
        const flake = element('span', 'ci-flake');
        const size = 4 + Math.random() * 9;
        flake.style.cssText = [
            `left:${(Math.random() * 100).toFixed(1)}%`,
            `width:${size.toFixed(1)}px`,
            `height:${size.toFixed(1)}px`,
            `animation-duration:${(9 + Math.random() * 12).toFixed(1)}s`,
            `animation-delay:${(-Math.random() * 20).toFixed(1)}s`,
            `opacity:${(0.35 + Math.random() * 0.6).toFixed(2)}`
        ].join(';');
        sky.append(flake);
    }

    const garland = element('img', 'ci-garland');
    garland.src = new URL('garland.svg', ASSET_URL).href;
    garland.alt = '';
    const trees = element('div', 'ci-trees');
    trees.style.backgroundImage = `url("${new URL('trees.svg', ASSET_URL).href}")`;

    const content = element('div', 'ci-content');

    const logo = element('img', 'ci-logo');
    logo.src = new URL('ibm-logo.svg', ASSET_URL).href;
    logo.alt = 'IBM';

    const title = element('h1', 'ci-title');
    title.textContent = config.christmasui.title;

    const legend = element('section', 'ci-legend');
    legend.append(element('h2', 'ci-legend__title', text.legendTitle));
    const rows = element('ul', 'ci-legend__rows');
    const addRow = (keys, label) => {
        const row = element('li', 'ci-legend__row');
        const keyWrap = element('span', 'ci-legend__keys');
        keys.forEach((key, index) => {
            if (index > 0) {
                keyWrap.append(element('span', 'ci-legend__or', '/'));
            }
            keyWrap.append(keycap(key));
        });
        row.append(keyWrap, element('span', 'ci-legend__label', label));
        rows.append(row);
    };
    addRow(['←', '→'], text.filter);
    addRow([language === 'de' ? 'Leertaste' : 'Space', 'Enter'], text.photo);
    addRow(['Esc'], text.back);
    legend.append(rows);
    if (config.slideshowshare?.enabled) {
        legend.append(element('p', 'ci-legend__note', text.shareNote));
    }

    const options = element('div', 'ci-options');
    const choices = [
        { id: 'photo', label: text.photo, icon: config.icons?.take_picture ?? 'fa fa-camera', tone: 'blue' },
        { id: 'collage', label: text.collage, icon: config.icons?.take_collage ?? 'fa fa-th-large', tone: 'green' }
    ];
    if (document.querySelector('a.slideshow-button')) {
        choices.push({
            id: 'slideshow',
            label: text.slideshow,
            icon: config.icons?.slideshow ?? 'fa fa-play',
            tone: 'red'
        });
    }
    const buttons = choices.map((choice, index) => {
        const button = element('button', `ci-option ci-option--${choice.tone}`);
        button.type = 'button';
        button.dataset.choice = choice.id;
        const icon = element('i', `ci-option__icon ${choice.icon}`);
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon, element('span', 'ci-option__label', choice.label));
        button.append(element('span', 'ci-option__number', String(index + 1)));
        options.append(button);
        return button;
    });

    content.append(logo, title, legend, options);
    root.append(sky, garland, trees, content);

    let handler = () => {};
    buttons.forEach((button) => button.addEventListener('click', () => handler(button.dataset.choice)));

    return {
        element: root,
        onChoose(callback) {
            handler = callback;
        },
        focusFirst() {
            buttons[0]?.focus({ preventScroll: true });
        },
        handleKey(event) {
            const index = buttons.indexOf(document.activeElement);
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                const step = event.key === 'ArrowRight' ? 1 : -1;
                buttons[(Math.max(index, 0) + step + buttons.length) % buttons.length].focus();
                return true;
            }
            if (event.key === ' ' || event.key === 'Enter') {
                (buttons[index] ?? buttons[0]).click();
                return true;
            }
            const number = Number(event.key);
            if (number >= 1 && number <= buttons.length) {
                buttons[number - 1].click();
                return true;
            }
            return false;
        }
    };
}

function buildHud() {
    const root = element('div', 'ci-hud');
    root.id = 'christmas-hud';

    const back = element('button', 'ci-hud__button ci-hud__button--ghost');
    back.type = 'button';
    back.append(keycap('Esc'), element('span', '', text.back_short));

    const shoot = element('button', 'ci-hud__button ci-hud__button--primary');
    shoot.type = 'button';
    const shootLabel = element('span', 'ci-hud__shoot-label', text.shootPhoto);
    const shootKeys = element('span', 'ci-hud__shoot-keys');
    shootKeys.append(keycap(language === 'de' ? 'Leertaste' : 'Space'), keycap('Enter'));
    shoot.append(shootLabel, shootKeys);

    const filterHint = element('div', 'ci-hud__hint');
    filterHint.append(keycap('←'), keycap('→'), element('span', '', text.filter));

    root.append(back, shoot, filterHint);

    let modeResolver = () => 'photo';
    return {
        element: root,
        onBack(callback) {
            back.addEventListener('click', callback);
        },
        onShoot(callback) {
            shoot.addEventListener('click', callback);
        },
        setModeResolver(resolver) {
            modeResolver = resolver;
        },
        update() {
            shootLabel.textContent = modeResolver() === 'collage' ? text.shootCollage : text.shootPhoto;
        }
    };
}
