const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { getDocuments, getDocumentById, createDocument, updateDocument, getDocumentHistory, markDocumentMissing } = require('../services/documentService');
const fs = require('fs').promises;

const router = express.Router();

// Listar documentos con filtros
router.get('/', async (req, res) => {
  const filters = {
    name: req.query.name,
    date: req.query.date,
    voucher: req.query.voucher,
    rootFolderId: req.query.rootFolderId,
    extension: req.query.extension,
    category: req.query.category,
    type: req.query.type,
    status: req.query.status,
  };
  try {
    const docs = await getDocuments(filters);
    res.json(docs);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ message: 'Error obteniendo documentos' });
  }
});

// Obtener documento por ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await getDocumentById(id);
    if (!doc) return res.status(404).json({ message: 'Documento no encontrado' });
    res.json(doc);
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ message: 'Error obteniendo documento' });
  }
});

// Crear documento nuevo (solo admin)
router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { originalName, absolutePath, relativePath, rootFolderId, rootFolderName, fileExtension, documentDate, voucherNumber, category, documentType, notes, sourceArea } = req.body;
  if (!originalName || !absolutePath || !rootFolderId) {
    return res.status(400).json({ message: 'Campos requeridos faltan' });
  }
  try {
    const doc = await createDocument({
      originalName, absolutePath, relativePath: relativePath || '', rootFolderId, rootFolderName,
      fileExtension, documentDate, voucherNumber, category, documentType, notes, sourceArea
    }, req.user.id);
    res.status(201).json(doc);
  } catch (error) {
    console.error('Create document error:', error);
    res.status(500).json({ message: 'Error creando documento' });
  }
});

// Editar documento (solo admin)
router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    await updateDocument(id, updates, req.user.id);
    res.json({ message: 'Documento actualizado' });
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ message: 'Error actualizando documento' });
  }
});

// Historial de documento (auth requerida)
router.get('/:id/history', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const history = await getDocumentHistory(id);
    res.json(history);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ message: 'Error obteniendo historial' });
  }
});

// Abrir documento (verificar existencia, auth)
router.post('/:id/open', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await getDocumentById(id);
    if (!doc) return res.status(404).json({ message: 'Documento no encontrado' });

    try {
      await fs.access(doc.absolute_path);
      // Registrar apertura en history
      const performedAt = new Date().toISOString();
      require('../db/db').db.run(
        'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
        [id, 'opened', req.user.id, performedAt],
        (err) => err && console.error('History open error:', err)
      );
      res.json({ path: doc.absolute_path });
    } catch (accessError) {
      // Archivo no existe, marcar missing
      await markDocumentMissing(id, req.user.id);
      res.status(404).json({ message: 'Archivo no encontrado en disco' });
    }
  } catch (error) {
    console.error('Open document error:', error);
    res.status(500).json({ message: 'Error abriendo documento' });
  }
});

module.exports = router;