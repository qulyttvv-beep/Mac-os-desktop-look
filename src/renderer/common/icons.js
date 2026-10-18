// Original mac-style app icons (SVG) + small UI glyphs.
(function () {
  let uid = 0;

  // Superellipse ("squircle") outline, inset to leave room for a shadow.
  const SQUIRCLE = (() => {
    const n = 5;
    const pts = [];
    const c = 50;
    const r = 46;
    for (let i = 0; i < 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const x = c + r * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n);
      const y = c + r * Math.sign(st) * Math.pow(Math.abs(st), 2 / n);
      pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return `M${pts.join('L')}Z`;
  })();

  function tile(top, bottom, inner, opts = {}) {
    const id = `ic${++uid}`;
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/>
        </linearGradient>
        <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="${id}c"><path d="${SQUIRCLE}"/></clipPath>
      </defs>
      <g clip-path="url(#${id}c)">
        <rect width="100" height="100" fill="url(#${id}g)"/>
        ${inner(id)}
        ${opts.noSheen ? '' : `<rect width="100" height="100" fill="url(#${id}s)" opacity=".5"/>`}
      </g>
      <path d="${SQUIRCLE}" fill="none" stroke="rgba(0,0,0,.18)" stroke-width=".6"/>
    </svg>`;
  }

  const ICONS = {
    finder: () =>
      tile('#7fd3ff', '#1b74f0', () => `
        <path d="M22 33a5 5 0 0 1 5-5h15l6 6h25a5 5 0 0 1 5 5v31a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5z" fill="#fff" opacity=".55"/>
        <rect x="22" y="40" width="56" height="36" rx="5" fill="#fff"/>
        <path d="M38 55q12 9 24 0" stroke="#1b74f0" stroke-width="3.2" fill="none" stroke-linecap="round"/>
        <circle cx="40" cy="50" r="2.2" fill="#1b74f0"/><circle cx="60" cy="50" r="2.2" fill="#1b74f0"/>`),

    launchpad: () =>
      tile('#5a5a66', '#1c1c24', () => {
        const colors = ['#ff5f57', '#febc2e', '#28c840', '#64d2ff', '#0a84ff', '#bf5af2', '#ff9f0a', '#ff375f', '#30d158'];
        let s = '';
        colors.forEach((c, i) => {
          const x = 24 + (i % 3) * 19;
          const y = 24 + Math.floor(i / 3) * 19;
          s += `<rect x="${x}" y="${y}" width="14" height="14" rx="4.2" fill="${c}"/>`;
        });
        return s;
      }),

    mail: () =>
      tile('#69c2ff', '#1567ee', () => `
        <rect x="19" y="30" width="62" height="42" rx="6" fill="#fff"/>
        <path d="M21 33l29 22 29-22" stroke="#1567ee" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linejoin="round"/>`),

    notes: () =>
      tile('#ffffff', '#f1f1f3', () => `
        <rect width="100" height="31" fill="#ffd60a"/>
        <rect y="22" width="100" height="9" fill="#ffc400"/>
        <path d="M8 34H92" stroke="#c9c9cc" stroke-width="2" stroke-dasharray="1.5 4" stroke-linecap="round"/>
        <path d="M18 48H82M18 60H82M18 72H82M18 84H66" stroke="#dadadd" stroke-width="2"/>`, { noSheen: true }),

    terminal: () =>
      tile('#4a4a4e', '#121214', () => `
        <rect x="13" y="17" width="74" height="66" rx="9" fill="#0b0b0c" stroke="rgba(255,255,255,.14)"/>
        <path d="M26 38l11 9-11 9" stroke="#f5f5f7" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M43 60h17" stroke="#f5f5f7" stroke-width="5" stroke-linecap="round"/>`),

    calculator: () =>
      tile('#3a3a3e', '#141416', () => {
        let s = '<rect x="17" y="15" width="66" height="20" rx="5" fill="#2a2a2d"/><text x="77" y="31" font-size="15" font-family="Segoe UI, sans-serif" text-anchor="end" fill="#fff">42</text>';
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 4; c++) {
            const x = 26 + c * 16;
            const y = 50 + r * 15.5;
            s += `<circle cx="${x}" cy="${y}" r="6.3" fill="${c === 3 ? '#ff9f0a' : r === 0 ? '#a5a5aa' : '#5c5c60'}"/>`;
          }
        }
        return s;
      }),

    photos: () =>
      tile('#9ad8ff', '#3d97f5', () => `
        <circle cx="68" cy="31" r="10" fill="#ffd60a"/>
        <path d="M0 78L30 46L50 66L64 54L100 84V100H0Z" fill="#2fb350"/>
        <path d="M0 86L26 66L44 80L62 68L100 92V100H0Z" fill="#1e8e3e"/>`),

    music: () =>
      tile('#ff7a8a', '#f5213b', () => `
        <path d="M41 31L70 24V32L45.5 38Z" fill="#fff"/>
        <rect x="41" y="31" width="4.6" height="37" fill="#fff"/>
        <rect x="65.4" y="24" width="4.6" height="37" fill="#fff"/>
        <ellipse cx="37" cy="68" rx="9" ry="7" transform="rotate(-20 37 68)" fill="#fff"/>
        <ellipse cx="61.5" cy="61" rx="9" ry="7" transform="rotate(-20 61.5 61)" fill="#fff"/>`),

    store: () =>
      tile('#5fd0ff', '#0a6cf5', () => `
        <path d="M38 42V35a12 12 0 0 1 24 0v7" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>
        <rect x="25" y="40" width="50" height="38" rx="7" fill="#fff"/>
        <path d="M50 49l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" fill="#0a6cf5"/>`),

    settings: () =>
      tile('#c4c4ca', '#6d6d74', () => {
        let teeth = '';
        for (let i = 0; i < 12; i++) teeth += `<rect x="45.5" y="15" width="9" height="16" rx="2" transform="rotate(${i * 30} 50 50)"/>`;
        return `<g fill="#3d3d42">${teeth}<circle cx="50" cy="50" r="25"/></g>
          <circle cx="50" cy="50" r="17" fill="none" stroke="#8a8a90" stroke-width="2.5"/>
          <circle cx="50" cy="50" r="9" fill="#a8a8ae"/>`;
      }),

    compass: () =>
      tile('#ffffff', '#e4e4ea', () => `
        <circle cx="50" cy="50" r="36" fill="#1e88ff"/><circle cx="50" cy="50" r="31" fill="#4fb2ff"/>
        <path d="M50 50L71 29L56 56Z" fill="#ff3b30"/><path d="M50 50L29 71L44 44Z" fill="#fff"/>`),

    downloads: () => {
      const id = `ic${++uid}`;
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc8ff"/><stop offset="1" stop-color="#2a8cf5"/></linearGradient></defs>
        <path d="M8 26a6 6 0 0 1 6-6h22l7 7h43a6 6 0 0 1 6 6v6H8z" fill="#4aa6f8"/>
        <rect x="8" y="31" width="84" height="57" rx="7" fill="url(#${id})"/>
        <path d="M50 44v26M39 60l11 11 11-11" stroke="#fff" stroke-width="5.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    },

    trash: (full) => {
      const id = `ic${++uid}`;
      const ribs = [36, 43, 50, 57, 64].map((x) => `<path d="M${x} 36L${x + (x - 50) * 0.08} 86" stroke="#9aa3ad" stroke-width="1.4"/>`).join('');
      const papers = full
        ? `<path d="M30 30c-2-10 8-16 14-10 4-8 16-6 16 2 8-4 16 4 10 12z" fill="#fff" stroke="#c9ced4"/>
           <path d="M40 26l8-9 7 8" stroke="#e1e4e8" fill="none"/>`
        : '';
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e6eaee"/><stop offset=".5" stop-color="#fbfcfd"/><stop offset="1" stop-color="#d3d9df"/></linearGradient></defs>
        ${papers}
        <path d="M24 32H76L70.5 87a5 5 0 0 1-5 4.5H34.5a5 5 0 0 1-5-4.5Z" fill="url(#${id})" fill-opacity=".92" stroke="#aab2bb" stroke-width="1.2"/>
        ${ribs}
        <rect x="20" y="26" width="60" height="9" rx="4.5" fill="#f2f4f6" stroke="#aab2bb" stroke-width="1.2"/>
      </svg>`;
    },

    generic: (name) =>
      tile('#a1a1aa', '#5b5b66', () => `<text x="50" y="64" font-size="40" font-weight="600" font-family="Segoe UI, sans-serif" text-anchor="middle" fill="#fff">${(name || '?').trim().charAt(0).toUpperCase()}</text>`),
  };

  // 16px line glyphs for the menu bar & control center (currentColor).
  const G = {
    logo: '<svg viewBox="0 0 16 16"><path d="M8 .8c.5 3.6 3.6 6.7 7.2 7.2-3.6.5-6.7 3.6-7.2 7.2C7.5 11.6 4.4 8.5.8 8 4.4 7.5 7.5 4.4 8 .8z" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 16 16"><circle cx="6.8" cy="6.8" r="4.9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5l4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    control: '<svg viewBox="0 0 16 16"><rect x="1" y="2.5" width="14" height="4.6" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.6" cy="4.8" r="1.5" fill="currentColor"/><rect x="1" y="9" width="14" height="4.6" rx="2.3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="4.4" cy="11.3" r="1.5" fill="currentColor"/></svg>',
    wifi: '<svg viewBox="0 0 16 16"><path d="M1 6.2a10 10 0 0 1 14 0M3.3 8.6a6.7 6.7 0 0 1 9.4 0M5.6 11a3.3 3.3 0 0 1 4.8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="13.4" r="1.2" fill="currentColor"/></svg>',
    wifiOff: '<svg viewBox="0 0 16 16"><path d="M1 6.2a10 10 0 0 1 14 0M3.3 8.6a6.7 6.7 0 0 1 9.4 0M5.6 11a3.3 3.3 0 0 1 4.8 0" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/><path d="M2 2l12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    ethernet: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10v6H11v2H5v-2H3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 7v1.6M8 7v1.6M10 7v1.6" stroke="currentColor" stroke-width="1.2"/></svg>',
    bluetooth: '<svg viewBox="0 0 16 16"><path d="M4.5 4.8l7 6.2L8 14V2l3.5 3L4.5 11.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    moon: '<svg viewBox="0 0 16 16"><path d="M13.6 10.2A6 6 0 0 1 5.8 2.4a6 6 0 1 0 7.8 7.8z" fill="currentColor"/></svg>',
    sun: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3"/></g></svg>',
    speaker: '<svg viewBox="0 0 16 16"><path d="M2 6h2.6L8 3v10L4.6 10H2z" fill="currentColor"/><path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.3 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    speakerMute: '<svg viewBox="0 0 16 16"><path d="M2 6h2.6L8 3v10L4.6 10H2z" fill="currentColor"/><path d="M10.5 6l4 4M14.5 6l-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    prev: '<svg viewBox="0 0 16 16"><path d="M8 8l6-4.5v9zM2 8l6-4.5v9z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 16 16"><path d="M8 8L2 3.5v9zM14 8L8 3.5v9z" fill="currentColor"/></svg>',
    playpause: '<svg viewBox="0 0 16 16"><path d="M2 3l6 5-6 5z" fill="currentColor"/><rect x="9.5" y="3" width="1.9" height="10" rx=".6" fill="currentColor"/><rect x="12.6" y="3" width="1.9" height="10" rx=".6" fill="currentColor"/></svg>',
    gear: '<svg viewBox="0 0 16 16"><path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zm6 3.6V7.2l-1.7-.4-.5-1.2.9-1.5-1.1-1.1-1.5.9-1.2-.5L8.8 1.6H7.2l-.4 1.8-1.2.5-1.5-.9L3 4.1l.9 1.5-.5 1.2L1.6 7.2v1.6l1.8.4.5 1.2-.9 1.5L4.1 13l1.5-.9 1.2.5.4 1.8h1.6l.4-1.8 1.2-.5 1.5.9 1.1-1.1-.9-1.5.5-1.2z" fill="currentColor" fill-rule="evenodd"/></svg>',
    lock: '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    chevL: '<svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevR: '<svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    taskbar: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3" y="10.5" width="10" height="1.6" rx=".8" fill="currentColor"/></svg>',
    dock: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="4" y="9.6" width="8" height="2.4" rx="1.2" fill="currentColor"/></svg>',
    power: '<svg viewBox="0 0 16 16"><path d="M8 1.8v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.6 4a5.2 5.2 0 1 0 6.8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    restart: '<svg viewBox="0 0 16 16"><path d="M13.2 8.6A5.3 5.3 0 1 1 11.6 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.9 1.6v3.2H9.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plug: '<svg viewBox="0 0 16 16"><path d="M9.6 1.5L4.5 9h3.2l-1.3 5.5L11.5 7H8.3z" fill="currentColor"/></svg>',
    mic: '<svg viewBox="0 0 16 16"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor"/><path d="M3.2 7.5a4.8 4.8 0 0 0 9.6 0M8 12.3v2.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    micOff: '<svg viewBox="0 0 16 16"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" opacity=".45"/><path d="M3.2 7.5a4.8 4.8 0 0 0 9.6 0M8 12.3v2.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".45"/><path d="M2.5 2.5l11 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5l9 5.5-9 5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>',
    music: '<svg viewBox="0 0 16 16"><path d="M6 3.2l7-1.6v8.6a2 1.7 0 1 1-1.4-1.6V4.1L7.4 5.1v6.8a2 1.7 0 1 1-1.4-1.6z" fill="currentColor"/></svg>',
  };

  function battery(pct, charging) {
    const w = Math.max(1.5, Math.round((Math.max(0, Math.min(100, pct || 0)) / 100) * 16 * 10) / 10);
    const color = pct <= 20 && !charging ? '#ff3b30' : 'currentColor';
    return `<svg viewBox="0 0 25 12" width="25" height="12"><rect x=".6" y=".6" width="21" height="10.8" rx="3.2" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/><rect x="2.5" y="2.5" width="${w}" height="7" rx="1.6" fill="${color}"/><path d="M23.2 4.2v3.6a1.6 1.6 0 0 0 0-3.6z" fill="currentColor" fill-opacity=".45"/>${charging ? '<path d="M12.6 1.8L8.9 6.6h2.6l-1 3.8 3.8-4.9h-2.6z" fill="#fff" stroke="rgba(0,0,0,.35)" stroke-width=".5"/>' : ''}</svg>`;
  }

  window.Icons = {
    app: (key, arg) => (ICONS[key] ? ICONS[key](arg) : ICONS.generic(arg)),
    has: (key) => !!ICONS[key],
    glyph: (key) => G[key] || '',
    battery,
  };
})();
