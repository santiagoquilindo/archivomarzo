const {
  getDocuments,
  getDocumentById,
} = require('./documents/documentRepository');
const {
  createDocument,
  updateDocument,
  markDocumentMissing,
} = require('./documents/documentMutationService');
const {
  getDocumentHistory,
  addDocumentHistoryEntry,
} = require('./documents/documentHistoryService');
const {
  calculateFileHash,
} = require('./documents/documentFileService');

module.exports = {
  getDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  getDocumentHistory,
  markDocumentMissing,
  addDocumentHistoryEntry,
  calculateFileHash,
};
