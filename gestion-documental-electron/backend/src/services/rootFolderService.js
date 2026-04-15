const path = require('path');
const { db } = require('../db/db');
const { AppError } = require('../utils/http');

const PROJECT_ROOT_PATH = path.resolve(__dirname, '../../..');
const TEST_DOCS_PATH = path.resolve(PROJECT_ROOT_PATH, 'test_docs');
const SEGMENT_TECHNICAL_RULES = [
  { segment: 'node_modules', code: 'ROOT_FOLDER_TECHNICAL_PATH', reason: 'node_modules' },
  { segment: '.git', code: 'ROOT_FOLDER_TECHNICAL_PATH', reason: '.git' },
  { segment: 'dist', code: 'ROOT_FOLDER_TECHNICAL_PATH', reason: 'dist' },
  { segment: 'build', code: 'ROOT_FOLDER_TECHNICAL_PATH', reason: 'build' },
  { segment: 'coverage', code: 'ROOT_FOLDER_TECHNICAL_PATH', reason: 'coverage' },
  { segment: 'electron-user-data', code: 'ROOT_FOLDER_TECHNICAL_PATH', reason: 'electron-user-data' },
  { segment: 'tmp', code: 'ROOT_FOLDER_TEMP_PATH', reason: 'tmp' },
  { segment: 'temp', code: 'ROOT_FOLDER_TEMP_PATH', reason: 'temp' },
  { segment: 'cache', code: 'ROOT_FOLDER_TEMP_PATH', reason: 'cache' },
];
const TEMP_BASENAME_PATTERNS = [
  { regex: /^~\$/i, reason: 'office_temp_prefix' },
  { regex: /^~wrl/i, reason: 'office_lock_prefix' },
  { regex: /\.tmp$/i, reason: 'tmp_extension' },
  { regex: /\.lock$/i, reason: 'lock_extension' },
];

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes || 0, lastID: this.lastID || null });
    });
  });
}

function normalizeRootPathForComparison(inputPath) {
  let normalized = String(inputPath || '').trim().replace(/\//g, '\\');
  normalized = path.win32.normalize(normalized);

  const parsed = path.win32.parse(normalized);
  const root = String(parsed.root || '').replace(/\//g, '\\');

  if (normalized.length > root.length) {
    normalized = normalized.replace(/\\+$/g, '');
  }

  return normalized.toLowerCase();
}

function isSubpath(parentPath, childPath) {
  return childPath.startsWith(`${parentPath}\\`);
}

function splitNormalizedSegments(normalizedPath) {
  const parsed = path.win32.parse(normalizedPath);
  return normalizedPath
    .slice(parsed.root.length)
    .split('\\')
    .filter(Boolean);
}

function findTechnicalPathConflict(candidateAbsolutePath) {
  const candidateNormalized = normalizeRootPathForComparison(candidateAbsolutePath);
  const candidateSegments = splitNormalizedSegments(candidateNormalized);
  const basename = candidateSegments[candidateSegments.length - 1] || '';

  const normalizedProjectRoot = normalizeRootPathForComparison(PROJECT_ROOT_PATH);
  const normalizedTestDocs = normalizeRootPathForComparison(TEST_DOCS_PATH);

  if (
    candidateNormalized === normalizedProjectRoot
    || isSubpath(normalizedProjectRoot, candidateNormalized)
    || isSubpath(candidateNormalized, normalizedProjectRoot)
  ) {
    return {
      code: 'ROOT_FOLDER_PROJECT_PATH',
      message: `La ruta ${candidateAbsolutePath} apunta al proyecto o lo contiene, y no puede registrarse como carpeta raiz.`,
      details: {
        reason: 'gestion-documental-electron',
        candidatePath: candidateAbsolutePath,
        projectRootPath: PROJECT_ROOT_PATH,
      },
    };
  }

  if (
    candidateNormalized === normalizedTestDocs
    || isSubpath(normalizedTestDocs, candidateNormalized)
    || isSubpath(candidateNormalized, normalizedTestDocs)
  ) {
    return {
      code: 'ROOT_FOLDER_TECHNICAL_PATH',
      message: `La ruta ${candidateAbsolutePath} apunta a test_docs o lo contiene, y no puede registrarse como carpeta raiz.`,
      details: {
        reason: 'test_docs',
        candidatePath: candidateAbsolutePath,
        technicalPath: TEST_DOCS_PATH,
      },
    };
  }

  const segmentConflict = SEGMENT_TECHNICAL_RULES.find((rule) => candidateSegments.includes(rule.segment));
  if (segmentConflict) {
    return {
      code: segmentConflict.code,
      message: `La ruta ${candidateAbsolutePath} contiene un segmento tecnico bloqueado: ${segmentConflict.segment}.`,
      details: {
        reason: segmentConflict.reason,
        candidatePath: candidateAbsolutePath,
      },
    };
  }

  const tempBasenameConflict = TEMP_BASENAME_PATTERNS.find((rule) => rule.regex.test(basename));
  if (tempBasenameConflict) {
    return {
      code: 'ROOT_FOLDER_TEMP_PATH',
      message: `La ruta ${candidateAbsolutePath} coincide con un patron temporal bloqueado.`,
      details: {
        reason: tempBasenameConflict.reason,
        candidatePath: candidateAbsolutePath,
      },
    };
  }

  return null;
}

function buildConflictDetails(candidatePath, existingFolder, conflictType) {
  return {
    conflictType,
    candidatePath,
    existing: {
      id: existingFolder.id,
      name: existingFolder.name,
      absolute_path: existingFolder.absolute_path,
      is_active: existingFolder.is_active,
    },
  };
}

function buildConflictError(candidatePath, existingFolder, conflictType) {
  if (conflictType === 'duplicate') {
    return new AppError(
      `La ruta ya esta registrada: ${existingFolder.absolute_path}`,
      409,
      'ROOT_FOLDER_PATH_DUPLICATE',
      buildConflictDetails(candidatePath, existingFolder, conflictType),
    );
  }

  if (conflictType === 'contained_in_existing') {
    return new AppError(
      `La ruta ${candidatePath} esta contenida en una carpeta raiz existente: ${existingFolder.absolute_path}`,
      409,
      'ROOT_FOLDER_PATH_CONTAINED',
      buildConflictDetails(candidatePath, existingFolder, conflictType),
    );
  }

  return new AppError(
    `La ruta ${candidatePath} contiene una carpeta raiz existente: ${existingFolder.absolute_path}`,
    409,
    'ROOT_FOLDER_PATH_CONTAINS_EXISTING',
    buildConflictDetails(candidatePath, existingFolder, conflictType),
  );
}

function findPathOverlap(candidateAbsolutePath, existingFolders, excludedId = null) {
  const candidateNormalized = normalizeRootPathForComparison(candidateAbsolutePath);

  for (const folder of existingFolders) {
    if (excludedId != null && Number(folder.id) === Number(excludedId)) {
      continue;
    }

    const existingNormalized = normalizeRootPathForComparison(folder.absolute_path);

    if (candidateNormalized === existingNormalized) {
      return {
        conflictType: 'duplicate',
        folder,
      };
    }

    if (isSubpath(existingNormalized, candidateNormalized)) {
      return {
        conflictType: 'contained_in_existing',
        folder,
      };
    }

    if (isSubpath(candidateNormalized, existingNormalized)) {
      return {
        conflictType: 'contains_existing',
        folder,
      };
    }
  }

  return null;
}

async function ensureRootFolderPathIsAllowed(absolutePath, options = {}) {
  const {
    excludedId = null,
    activeOnly = false,
  } = options;

  const technicalConflict = findTechnicalPathConflict(absolutePath);
  if (technicalConflict) {
    throw new AppError(
      technicalConflict.message,
      409,
      technicalConflict.code,
      technicalConflict.details,
    );
  }

  const existingFolders = activeOnly
    ? await all('SELECT * FROM root_folders WHERE is_active = 1 ORDER BY name')
    : await all('SELECT * FROM root_folders ORDER BY name');

  const conflict = findPathOverlap(absolutePath, existingFolders, excludedId);
  if (!conflict) {
    return;
  }

  throw buildConflictError(absolutePath, conflict.folder, conflict.conflictType);
}

function getAllRootFolders() {
  return all('SELECT * FROM root_folders ORDER BY name');
}

async function createRootFolder(name, absolutePath) {
  await ensureRootFolderPathIsAllowed(absolutePath, { activeOnly: false });

  const createdAt = new Date().toISOString();
  const updatedAt = createdAt;
  const result = await run(
    'INSERT INTO root_folders (name, absolute_path, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
    [name, absolutePath, createdAt, updatedAt],
  );

  return {
    id: result.lastID,
    name,
    absolute_path: absolutePath,
    is_active: 1,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

async function updateRootFolder(id, name, absolutePath, isActive) {
  const existingFolder = await get('SELECT * FROM root_folders WHERE id = ?', [id]);
  if (!existingFolder) {
    return { changes: 0 };
  }

  await ensureRootFolderPathIsAllowed(absolutePath, {
    excludedId: id,
    activeOnly: false,
  });

  const updatedAt = new Date().toISOString();
  return run(
    'UPDATE root_folders SET name = ?, absolute_path = ?, is_active = ?, updated_at = ? WHERE id = ?',
    [name, absolutePath, isActive ? 1 : 0, updatedAt, id],
  );
}

async function setRootFolderActive(id, isActive) {
  const existingFolder = await get('SELECT * FROM root_folders WHERE id = ?', [id]);
  if (!existingFolder) {
    return { changes: 0 };
  }

  if (isActive) {
    await ensureRootFolderPathIsAllowed(existingFolder.absolute_path, {
      excludedId: id,
      activeOnly: true,
    });
  }

  const updatedAt = new Date().toISOString();
  return run(
    'UPDATE root_folders SET is_active = ?, updated_at = ? WHERE id = ?',
    [isActive ? 1 : 0, updatedAt, id],
  );
}

function deleteRootFolder(id) {
  return run('DELETE FROM root_folders WHERE id = ?', [id]);
}

module.exports = {
  getAllRootFolders,
  createRootFolder,
  updateRootFolder,
  setRootFolderActive,
  deleteRootFolder,
  normalizeRootPathForComparison,
  findPathOverlap,
  findTechnicalPathConflict,
};
