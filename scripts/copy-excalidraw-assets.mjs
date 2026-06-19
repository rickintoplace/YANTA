import {
  existsSync,
  rmSync,
  mkdirSync,
  cpSync,
  readFileSync,
} from 'node:fs';

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function findPackageRootFromResolvedFile(resolvedFile) {
  let dir = path.dirname(resolvedFile);

  while (dir && dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');

    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

        if (pkg.name === '@excalidraw/excalidraw') {
          return dir;
        }
      } catch {
        // keep walking
      }
    }

    dir = path.dirname(dir);
  }

  return null;
}

function resolveExcalidrawPackageDir() {
  const candidates = [];

  try {
    const resolvedEntry = require.resolve('@excalidraw/excalidraw');
    const packageRoot = findPackageRootFromResolvedFile(resolvedEntry);

    if (packageRoot) {
      candidates.push(packageRoot);
    }
  } catch {
    // fallback below
  }

  candidates.push(
    path.join(projectRoot, 'node_modules', '@excalidraw', 'excalidraw')
  );

  for (const candidate of candidates) {
    const pkgPath = path.join(candidate, 'package.json');

    if (!existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

      if (pkg.name === '@excalidraw/excalidraw') {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  throw new Error(
    [
      'Could not locate @excalidraw/excalidraw package directory.',
      'Tried:',
      ...candidates.map((x) => `- ${x}`),
    ].join('\n')
  );
}

const excalidrawPackageDir = resolveExcalidrawPackageDir();

const sourceCandidates = [
  path.join(excalidrawPackageDir, 'dist', 'prod', 'fonts'),
  path.join(excalidrawPackageDir, 'dist', 'fonts'),
  path.join(excalidrawPackageDir, 'fonts'),
];

const sourceFontsDir = sourceCandidates.find((candidate) =>
  existsSync(candidate)
);

if (!sourceFontsDir) {
  throw new Error(
    [
      'Excalidraw fonts directory not found.',
      'Tried:',
      ...sourceCandidates.map((x) => `- ${x}`),
    ].join('\n')
  );
}

const targetFontsDir = path.join(
  projectRoot,
  'public',
  'excalidraw-assets',
  'fonts'
);

rmSync(targetFontsDir, {
  recursive: true,
  force: true,
});

mkdirSync(path.dirname(targetFontsDir), {
  recursive: true,
});

cpSync(sourceFontsDir, targetFontsDir, {
  recursive: true,
});

console.log(`[YANTA] Copied Excalidraw fonts`);
console.log(`[YANTA] From: ${sourceFontsDir}`);
console.log(`[YANTA] To:   ${targetFontsDir}`);