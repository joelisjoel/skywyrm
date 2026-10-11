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
// Usage: node scripts/check-stamps.mjs [base-ref]   (default: origin/main)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] ?? 'origin/main';
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });

// A ?v= reference: a relative module path followed by ?v=N. Matches both
// HTML attributes and JS import specifiers.
const REF_RE = /([A-Za-z0-9_@.\-/]+\.(?:m?js|css))\?v=(\d+)/g;

// module path (repo-relative) -> Map(stamp -> [referencing files])
function collectStamps(readFile, listFiles) {
    const stamps = new Map();
    for (const file of listFiles()) {
        const text = readFile(file);
        if (text === null) continue;
        for (const match of text.matchAll(REF_RE)) {
            const [, ref, stamp] = match;
            if (ref.startsWith('http')) continue;
            const resolved = path.posix.normalize(
                path.posix.join(path.posix.dirname(file), ref));
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

const current = collectStamps(
    (f) => {
        try { return readFileSync(path.join(root, f), 'utf8'); } catch { return null; }
    },
    trackedDocs,
);
const base = collectStamps(
    (f) => {
        try { return git('show', `${BASE}:${f}`); } catch { return null; }
    },
    () => git('ls-tree', '-r', '--name-only', BASE, '--', 'site')
        .split('\n').filter((f) => /\.(html|m?js|css)$/.test(f)),
);

let failed = false;

// 1. Consistency: one stamp per module across all current references
for (const [module, byStamp] of current) {
    if (byStamp.size > 1) {
        failed = true;
        console.error(`INCONSISTENT ${module}: referenced with ${byStamp.size} different stamps:`);
        for (const [stamp, files] of byStamp) {
            console.error(`  ?v=${stamp} in ${files.join(', ')}`);
        }
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
        failed = true;
        console.error(`STALE ${module}: content changed vs ${BASE} but still stamped ?v=${now}`);
        console.error(`  bump the stamp in: ${[...byStamp.values()].flat().join(', ')}`);
    }
}

if (!failed) console.log(`stamps ok (${current.size} stamped modules, base ${BASE})`);
process.exit(failed ? 1 : 0);
