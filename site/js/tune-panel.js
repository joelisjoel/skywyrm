// Dev panel (` key): live sliders over every tunable + the measurements
// that decide whether the 3D arena works (spec §2, §4, §6.10).
import { T, DEFAULTS, PANEL, saveTune, resetTune } from './tunables.js?v=23';

export class TunePanel {
    constructor(onRestart) {
        this.onRestart = onRestart;
        this.locked = false;               // online: the room's numbers rule
        this.el = document.getElementById('tune');
        this.stats = document.createElement('div');
        this.stats.className = 'tune-stats';
        this.inputs = new Map();
        this.build();
    }

    build() {
        const el = this.el;
        el.textContent = '';
        const head = document.createElement('div');
        head.className = 'tune-head';
        head.textContent = 'Tuning — changes apply live and are saved in this browser';
        el.appendChild(head);
        el.appendChild(this.stats);
        const btns = document.createElement('div');
        btns.className = 'tune-btns';
        const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; btns.appendChild(b); return b; };
        mk('Restart world', () => { if (!this.locked) this.onRestart(); });
        const copy = mk('Copy JSON', async () => {
            if (this.locked) return;
            const json = JSON.stringify(saveTune(), null, 1);
            try { await navigator.clipboard.writeText(json); copy.textContent = 'Copied!'; }
            catch { prompt('Copy your tuning:', json); }
            setTimeout(() => (copy.textContent = 'Copy JSON'), 1200);
        });
        mk('Reset all', () => { if (this.locked) return; resetTune(); this.sync(); this.onRestart(); });
        el.appendChild(btns);
        let group = null, box = null;
        for (const [key, min, max, step, g, restart] of PANEL) {
            if (g !== group) {
                group = g;
                box = document.createElement('details');
                box.open = g === 'Flight';
                const s = document.createElement('summary'); s.textContent = g;
                box.appendChild(s);
                el.appendChild(box);
            }
            const row = document.createElement('label');
            row.className = 'tune-row';
            const name = document.createElement('span');
            name.textContent = key + (restart ? ' ⟳' : '');
            name.title = restart ? 'Applies on "Restart world"' : '';
            const input = document.createElement('input');
            input.type = 'range'; input.min = min; input.max = max; input.step = step;
            const val = document.createElement('span'); val.className = 'tune-val';
            input.oninput = () => {
                if (this.locked) { this.sync(); return; }
                T[key] = parseFloat(input.value);
                val.textContent = fmt(T[key]);
                row.classList.toggle('changed', T[key] !== DEFAULTS[key]);
                saveTune();
            };
            row.append(name, input, val);
            box.appendChild(row);
            this.inputs.set(key, { input, val, row });
        }
        this.sync();
    }

    sync() {
        for (const [key, { input, val, row }] of this.inputs) {
            input.value = T[key]; val.textContent = fmt(T[key]);
            row.classList.toggle('changed', T[key] !== DEFAULTS[key]);
        }
    }

    toggle() { if (!this.locked) this.el.classList.toggle('open'); }
    // In a room: close, and don't open or change anything until you leave.
    lock(on) { this.locked = on; if (on) this.el.classList.remove('open'); }
    get open() { return this.el.classList.contains('open'); }

    update(world, renderer, simMs, fps) {
        if (!this.open) return;
        const e = world.encounterStats();
        const f = (x) => (Number.isFinite(x) ? x.toFixed(1) + ' s' : '—');
        this.stats.textContent =
            `encounter every ${f(e.all)} (all) · ${f(e.player)} (you) · target 5–10 s\n` +
            `${world.dragons.filter((d) => d.alive).length} dragons · ${renderer.beadCount} beads · ${world.orbCount} orbs\n` +
            `sim ${simMs.toFixed(2)} ms/frame · ${fps} fps`;
    }
}

function fmt(v) { return Math.abs(v) >= 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100); }
