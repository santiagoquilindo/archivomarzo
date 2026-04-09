const path = require('path');
const { calculateFileHash } = require('../documentService');
const {
  getDocumentsByRootFolder,
  insertIndexedDocument,
  updateIndexedDocument,
  markDocumentMissing,
  markDocumentError,
} = require('./indexedDocumentRepository');
const { ensureDirectoryAccessible, walkDirectory } = require('./fileScanner');
const { logIndexing } = require('./indexingLogger');

function createFileDescriptor(filePath, rootPath, stats) {
  const normalizedPath = path.resolve(filePath);

  return {
    absolutePath: normalizedPath,
    relativePath: path.relative(rootPath, normalizedPath),
    fileExtension: path.extname(normalizedPath).toLowerCase(),
    originalName: path.basename(normalizedPath),
    fileSize: stats.size,
    fileModifiedAt: stats.mtime.toISOString(),
  };
}

function isUnchangedFile(existingDocument, descriptor) {
  return (
    Number(existingDocument.file_size) === Number(descriptor.fileSize) &&
    existingDocument.file_modified_at === descriptor.fileModifiedAt
  );
}

function shouldUpdateDocument(existingDocument, descriptor, unchangedFile) {
  return (
    !unchangedFile ||
    existingDocument.status !== 'available' ||
    existingDocument.relative_path !== descriptor.relativePath ||
    existingDocument.original_name !== descriptor.originalName ||
    existingDocument.file_extension !== descriptor.fileExtension
  );
}

function buildStoredDocumentSnapshot(existingDocument, descriptor, nextHash, nextStatus, rootName) {
  return {
    ...existingDocument,
    original_name: descriptor.originalName,
    absolute_path: descriptor.absolutePath,
    relative_path: descriptor.relativePath,
    root_folder_name: rootName,
    file_extension: descriptor.fileExtension,
    file_size: descriptor.fileSize,
    file_hash: nextHash,
    file_modified_at: descriptor.fileModifiedAt,
    status: nextStatus,
  };
}

async function handleNewDocument(context, descriptor) {
  const createdAt = new Date().toISOString();
  const fileHash = await calculateFileHash(descriptor.absolutePath);
  const documentId = await insertIndexedDocument({
    originalName: descriptor.originalName,
    absolutePath: descriptor.absolutePath,
    relativePath: descriptor.relativePath,
    rootFolderId: context.rootId,
    rootFolderName: context.rootName,
    fileExtension: descriptor.fileExtension,
    fileSize: descriptor.fileSize,
    fileHash,
    fileModifiedAt: descriptor.fileModifiedAt,
    userId: context.userId,
    createdAt,
  });

  context.existingDocuments.set(descriptor.absolutePath, {
    id: documentId,
    absolute_path: descriptor.absolutePath,
    original_name: descriptor.originalName,
    relative_path: descriptor.relativePath,
    file_extension: descriptor.fileExtension,
    file_size: descriptor.fileSize,
    file_modified_at: descriptor.fileModifiedAt,
    file_hash: fileHash,
    status: 'available',
  });
  context.counters.indexed += 1;
}

async function handleExistingDocument(context, existingDocument, descriptor) {
  const unchangedFile = isUnchangedFile(existingDocument, descriptor);

  if (unchangedFile && existingDocument.status === 'available') {
    return;
  }

  let nextHash = existingDocument.file_hash;
  if (!unchangedFile) {
    nextHash = await calculateFileHash(descriptor.absolutePath);
  }

  if (!shouldUpdateDocument(existingDocument, descriptor, unchangedFile)) {
    return;
  }

  const nextStatus = unchangedFile ? 'available' : 'updated';
  const updatedAt = new Date().toISOString();
  await updateIndexedDocument(existingDocument.id, {
    originalName: descriptor.originalName,
    absolutePath: descriptor.absolutePath,
    relativePath: descriptor.relativePath,
    rootFolderName: context.rootName,
    fileExtension: descriptor.fileExtension,
    fileSize: descriptor.fileSize,
    fileHash: nextHash,
    fileModifiedAt: descriptor.fileModifiedAt,
    status: nextStatus,
    updatedAt,
    userId: context.userId,
  });

  context.existingDocuments.set(
    descriptor.absolutePath,
    buildStoredDocumentSnapshot(
      existingDocument,
      descriptor,
      nextHash,
      nextStatus,
      context.rootName,
    ),
  );

  if (nextStatus === 'updated') {
    context.counters.updated += 1;
  }
}

async function handleFile(context, filePath, stats, rootPath) {
  const descriptor = createFileDescriptor(filePath, rootPath, stats);
  const existingDocument = context.existingDocuments.get(descriptor.absolutePath);

  context.seenPaths.add(descriptor.absolutePath);

  try {
    if (!existingDocument) {
      await handleNewDocument(context, descriptor);
      return;
    }

    await handleExistingDocument(context, existingDocument, descriptor);
  } catch (error) {
    console.error(`Error indexing file ${descriptor.absolutePath}: ${error.message}`);

    if (existingDocument) {
      const performedAt = new Date().toISOString();
      await markDocumentError(
        existingDocument.id,
        context.userId,
        error.message,
        performedAt,
      );
      context.existingDocuments.set(descriptor.absolutePath, {
        ...existingDocument,
        status: 'error',
      });
    }

    context.counters.errors += 1;
  }
}

async function reconcileMissingDocuments(context) {
  for (const [absolutePath, document] of context.existingDocuments.entries()) {
    if (context.seenPaths.has(absolutePath) || document.status === 'missing') {
      continue;
    }

    const performedAt = new Date().toISOString();
    await markDocumentMissing(document.id, context.userId, performedAt);

    context.existingDocuments.set(absolutePath, {
      ...document,
      status: 'missing',
    });
    context.counters.missing += 1;
  }
}

async function synchronizeRootFolder(folder, userId, counters) {
  const rootPath = path.resolve(folder.absolute_path);
  const context = {
    rootId: folder.id,
    rootName: folder.name,
    userId,
    counters,
    existingDocuments: await getDocumentsByRootFolder(folder.id),
    seenPaths: new Set(),
  };

  logIndexing(
    `[INDEXING] Indexing folder: ${folder.name}, raw path: ${folder.absolute_path}, normalized: ${rootPath}`,
  );

  try {
    ensureDirectoryAccessible(rootPath);
  } catch (error) {
    console.error(`[INDEXING] Path does not exist: ${rootPath}`);
    counters.errors += 1;
    await reconcileMissingDocuments(context);
    return;
  }

  await walkDirectory(rootPath, rootPath, {
    onItem: () => {
      counters.scanned += 1;
    },
    onFile: (filePath, stats) => handleFile(context, filePath, stats, rootPath),
    onStatError: async (fullPath, error) => {
      console.error(`Error stating ${fullPath}: ${error.message}`);
      counters.errors += 1;
    },
    onReadDirError: async (directoryPath, error) => {
      console.error(`Error reading dir ${directoryPath}: ${error.message}`);
      counters.errors += 1;
    },
  });

  await reconcileMissingDocuments(context);
}

module.exports = {
  synchronizeRootFolder,
};
