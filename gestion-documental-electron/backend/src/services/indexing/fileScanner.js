const fs = require('fs');
const path = require('path');

function ensureDirectoryAccessible(directoryPath) {
  fs.accessSync(directoryPath);
}

async function walkDirectory(rootPath, currentPath, handlers) {
  const normalizedDirPath = path.resolve(currentPath);

  try {
    const itemNames = fs.readdirSync(normalizedDirPath);

    for (const itemName of itemNames) {
      const fullPath = path.join(normalizedDirPath, itemName);
      handlers.onItem();

      try {
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          await walkDirectory(rootPath, fullPath, handlers);
          continue;
        }

        if (stats.isFile()) {
          await handlers.onFile(fullPath, stats, rootPath);
        }
      } catch (error) {
        await handlers.onStatError(fullPath, error);
      }
    }
  } catch (error) {
    await handlers.onReadDirError(normalizedDirPath, error);
  }
}

module.exports = {
  ensureDirectoryAccessible,
  walkDirectory,
};
