#!/usr/bin/env node
// Cache-stamp checker. Phones cache aggressively, so every module under
// site/ that pages reference with a ?v=N query must have its stamp bumped
// in EVERY referencing file whenever the module's content changes.
// This script enforces both halves of that contract:
//
//   1. consistency — all current references to a module agree on one stamp
//   2. freshness   — a module whose content differs from the base ref has
//                    a different stamp than it had in the base
//
// Usage: node scripts/check-stamps.mjs [--fix] [base-ref]   (default: origin/main)
// With --fix it bumps every stale or inconsistent stamp (in every file that
// references the module) and checks again, since bumping a stamp changes
// the importing file, which may then need its own stamp bumped.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const BASE = args.find((a) => !a.startsWith('--')) ?? 'origin/main';
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });

// A ?v= reference: a relative module path followed by ?v=N. Matches both
// HTML attributes and JS import specifiers.
const REF_RE = /([A-Za-z0-9_@.\-/]+\.(?:m?js|css))\?v=(\d+)/g;

const resolve = (file, ref) => path.posix.normalize(path.posix.join(path.posix.dirname(file), ref));

// module path (repo-relative) -> Map(stamp -> [referencing files])
function collectStamps(readFile, listFiles) {
    const stamps = new Map();
    for (const file of listFiles()) {
        const text = readFile(file);
        if (text === null) continue;
        for (const match of text.matchAll(REF_RE)) {
            const [, ref, stamp] = match;
            if (ref.startsWith('http')) continue;
            const resolved = resolve(file, ref);
            if (!stamps.has(resolved)) stamps.set(resolved, new Map());
            const byStamp = stamps.get(resolved);
            if (!byStamp.has(stamp)) byStamp.set(stamp, []);
            byStamp.get(stamp).push(file);
        }
    }
    return stamps;
}

const trackedDocs = () => git('ls-files', '--', 'site')
    .split('\n').filter((f) => /\.(html|m?js|css)$/.test(f));

const readWorking = (f) => {
    try { return readFileSync(path.join(root, f), 'utf8'); } catch { return null; }
};
const base = collectStamps(
    (f) => {
        try { return git('show', `${BASE}:${f}`); } catch { return null; }
    },
    () => git('ls-tree', '-r', '--name-only', BASE, '--', 'site')
        .split('\n').filter((f) => /\.(html|m?js|css)$/.test(f)),
);

// Returns { current, problems: [{ kind, module, byStamp, message }] }.
function check() {
    const current = collectStamps(readWorking, trackedDocs);
    const problems = [];

    // 1. Consistency: one stamp per module across all current references
    for (const [module, byStamp] of current) {
        if (byStamp.size > 1) {
            const lines = [...byStamp].map(([stamp, files]) => `  ?v=${stamp} in ${files.join(', ')}`);
            problems.push({ kind: 'inconsistent', module, byStamp,
                message: `INCONSISTENT ${module}: referenced with ${byStamp.size} different stamps:\n${lines.join('\n')}` });
        }
    }

    // 2. Freshness: content changed since base => stamp changed since base
    const changed = new Set(git('diff', '--name-only', BASE)
        .split('\n').filter(Boolean));
    for (const [module, byStamp] of current) {
        if (!changed.has(module)) continue;
        const baseStamps = base.get(module);
        if (!baseStamps) continue; // new module (or newly stamped): nothing to compare
        const now = [...byStamp.keys()].sort().join(',');
        const then = [...baseStamps.keys()].sort().join(',');
        if (now === then) {
            problems.push({ kind: 'stale', module, byStamp,
                message: `STALE ${module}: content changed vs ${BASE} but still stamped ?v=${now}\n` +
                    `  bump the stamp in: ${[...byStamp.values()].flat().join(', ')}` });
        }
    }
    return { current, problems };
}

// Give a module one new stamp, higher than any it has now or had in base.
function bump({ module, byStamp }) {
    const seen = [...byStamp.keys(), ...(base.get(module)?.keys() ?? [])].map(Number);
    const next = String(Math.max(...seen) + 1);
    for (const file of new Set([...byStamp.values()].flat())) {
        const text = readWorking(file);
        const out = text.replace(REF_RE, (all, ref, stamp) =>
            (!ref.startsWith('http') && resolve(file, ref) === module ? `${ref}?v=${next}` : all));
        if (out !== text) writeFileSync(path.join(root, file), out);
    }
    console.log(`bumped ${module} → ?v=${next}`);
}

let result = check();
for (let pass = 0; FIX && result.problems.length && pass < 20; pass++) {
    for (const p of result.problems) bump(p);
    result = check();
}

for (const p of result.problems) console.error(p.message);
if (!result.problems.length) console.log(`stamps ok (${result.current.size} stamped modules, base ${BASE})`);
process.exit(result.problems.length ? 1 : 0);
