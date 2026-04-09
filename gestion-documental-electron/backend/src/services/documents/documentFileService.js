const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { AppError } = require('../../utils/http');

function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function normalizeRelativePath(relativePath, fallbackFileName) {
  const cleaned = String(relativePath || '')
    .trim()
    .replace(/[\\/]+/g, path.sep)
    .replace(new RegExp(`^[${path.sep === '\\' ? '\\\\' : path.sep}]+`), '');

  return cleaned || fallbackFileName;
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }

  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new AppError(
      'La ruta relativa queda por fuera de la carpeta raíz seleccionada',
      400,
      'PATH_OUTSIDE_ROOT',
    );
  }

  return resolvedTarget;
}

async function getAvailableDestinationPath(destinationPath) {
  const parsed = path.parse(destinationPath);
  let attempt = 0;
  let candidatePath = destinationPath;

  while (true) {
    try {
      await fs.access(candidatePath);
      attempt += 1;
      candidatePath = path.join(
        parsed.dir,
        `${parsed.name}-${attempt}${parsed.ext}`,
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        return candidatePath;
      }

      throw error;
    }
  }
}

async function prepareDocumentCopy({
  sourcePath,
  rootFolderPath,
  relativePath,
}) {
  const resolvedSourcePath = path.resolve(sourcePath);
  await fs.stat(resolvedSourcePath);

  const sourceFileName = path.basename(resolvedSourcePath);
  const desiredRelativePath = normalizeRelativePath(relativePath, sourceFileName);
  const requestedDestination = ensurePathInsideRoot(
    rootFolderPath,
    path.resolve(rootFolderPath, desiredRelativePath),
  );
  const finalDestinationPath =
    await getAvailableDestinationPath(requestedDestination);
  const finalRelativePath = path.relative(rootFolderPath, finalDestinationPath);

  await fs.mkdir(path.dirname(finalDestinationPath), { recursive: true });
  await fs.copyFile(resolvedSourcePath, finalDestinationPath);

  const stats = await fs.stat(finalDestinationPath);
  const fileHash = await calculateFileHash(finalDestinationPath);

  return {
    sourcePath: resolvedSourcePath,
    finalDestinationPath,
    finalRelativePath,
    storedName: path.basename(finalDestinationPath),
    fileExtension: path.extname(finalDestinationPath).toLowerCase(),
    fileSize: stats.size,
    fileHash,
    fileModifiedAt: stats.mtime.toISOString(),
  };
}

module.exports = {
  calculateFileHash,
  prepareDocumentCopy,
};
