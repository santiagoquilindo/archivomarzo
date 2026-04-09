const path = require('path');
const { AppError } = require('../../utils/http');
const {
  getRootFolderById,
  insertDocument,
  updateDocumentFields,
  updateDocumentStatus,
} = require('./documentRepository');
const { addDocumentHistoryEntry } = require('./documentHistoryService');
const { prepareDocumentCopy } = require('./documentFileService');

const EDITABLE_FIELDS = new Set([
  'document_date',
  'voucher_number',
  'category',
  'document_type',
  'notes',
  'source_area',
]);

async function createDocument(docData, userId) {
  const rootFolder = await getRootFolderById(docData.rootFolderId);

  if (!rootFolder) {
    throw new AppError(
      'La carpeta raíz seleccionada no existe',
      404,
      'ROOT_FOLDER_NOT_FOUND',
    );
  }

  const rootFolderPath = path.resolve(rootFolder.absolute_path);
  const preparedFile = await prepareDocumentCopy({
    sourcePath: docData.absolutePath,
    rootFolderPath,
    relativePath: docData.relativePath,
  });
  const createdAt = new Date().toISOString();
  const fileExtension = docData.fileExtension || preparedFile.fileExtension;

  const documentId = await insertDocument({
    originalName: docData.originalName,
    storedName: preparedFile.storedName,
    absolutePath: preparedFile.finalDestinationPath,
    relativePath: preparedFile.finalRelativePath,
    rootFolderId: rootFolder.id,
    rootFolderName: rootFolder.name,
    fileExtension,
    fileSize: preparedFile.fileSize,
    fileHash: preparedFile.fileHash,
    fileModifiedAt: preparedFile.fileModifiedAt,
    documentDate: docData.documentDate,
    voucherNumber: docData.voucherNumber,
    category: docData.category,
    documentType: docData.documentType,
    notes: docData.notes,
    sourceArea: docData.sourceArea,
    status: 'pending',
    createdBy: userId,
    updatedBy: userId,
    createdAt,
    updatedAt: createdAt,
  });

  await addDocumentHistoryEntry(documentId, 'created', userId);

  return {
    id: documentId,
    absolutePath: preparedFile.finalDestinationPath,
    relativePath: preparedFile.finalRelativePath,
    copiedFrom: preparedFile.sourcePath,
  };
}

async function updateDocument(id, updates, userId) {
  const updatedAt = new Date().toISOString();
  const fieldNames = Object.keys(updates).filter((key) => EDITABLE_FIELDS.has(key));

  if (!fieldNames.length) {
    throw new AppError(
      'No hay campos válidos para actualizar',
      400,
      'NO_VALID_UPDATE_FIELDS',
    );
  }

  const fieldUpdates = Object.fromEntries(
    fieldNames.map((field) => [field, updates[field]]),
  );
  const result = await updateDocumentFields(id, fieldUpdates, updatedAt, userId);

  if (!result.changes) {
    throw new AppError('Documento no encontrado', 404, 'DOCUMENT_NOT_FOUND');
  }

  await Promise.all(
    fieldNames.map((field) =>
      addDocumentHistoryEntry(id, 'updated', userId, field, updates[field])),
  );

  return result;
}

async function markDocumentMissing(id, userId) {
  const performedAt = new Date().toISOString();
  const result = await updateDocumentStatus(id, 'missing', performedAt, userId);
  await addDocumentHistoryEntry(id, 'marked_missing', userId);
  return result;
}

module.exports = {
  createDocument,
  updateDocument,
  markDocumentMissing,
};
