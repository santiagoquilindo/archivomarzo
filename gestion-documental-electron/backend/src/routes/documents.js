const express = require('express');
const fs = require('fs');
const { spawn } = require('child_process');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const {
  getDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  getDocumentHistory,
  markDocumentMissing,
  addDocumentHistoryEntry,
} = require('../services/documentService');
const {
  AppError,
  normalizeText,
  parseId,
  sendError,
  sendSuccess,
} = require('../utils/http');

const router = express.Router();

async function openFileWithSystem(absolutePath) {
  try {
    const electron = require('electron');
    if (electron?.shell?.openPath) {
      const result = await electron.shell.openPath(absolutePath);
      if (result) {
        throw new Error(result);
      }
      return { method: 'electron.shell.openPath' };
    }
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }

  const escapedForPowerShell = absolutePath.replace(/'/g, "''");
  const powerShellCommand = `Start-Process -LiteralPath '${escapedForPowerShell}'`;

  const powerShellExitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', powerShellCommand],
      { windowsHide: true, stdio: 'ignore' },
    );

    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });

  if (powerShellExitCode === 0) {
    return { method: 'powershell Start-Process' };
  }

  const command = `start "" "${absolutePath.replace(/"/g, '""')}"`;
  const cmdExitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', command], {
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    });

    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve(0);
    });
  });

  if (cmdExitCode !== 0) {
    throw new Error('No se pudo abrir el archivo con la aplicación predeterminada');
  }

  return { method: 'cmd /c start' };
}

router.get('/', verifyToken, async (req, res) => {
  const filters = {
    name: normalizeText(req.query.name),
    date: normalizeText(req.query.date),
    voucher: normalizeText(req.query.voucher),
    rootFolderId: normalizeText(req.query.rootFolderId),
    extension: normalizeText(req.query.extension),
    category: normalizeText(req.query.category),
    type: normalizeText(req.query.type),
    status: normalizeText(req.query.status),
  };

  try {
    const docs = await getDocuments(filters);
    return res.json(docs);
  } catch (error) {
    console.error('Get documents error:', error.message);
    return sendError(res, error, 'Error obteniendo documentos');
  }
});

router.get('/:id', verifyToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const doc = await getDocumentById(id);

    if (!doc) {
      return sendError(
        res,
        new AppError('Documento no encontrado', 404, 'DOCUMENT_NOT_FOUND'),
      );
    }

    return res.json(doc);
  } catch (error) {
    console.error('Get document error:', error.message);
    return sendError(res, error, 'Error obteniendo documento');
  }
});

router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  const payload = {
    originalName: normalizeText(req.body?.originalName),
    absolutePath: normalizeText(req.body?.absolutePath),
    relativePath: normalizeText(req.body?.relativePath),
    rootFolderId: req.body?.rootFolderId,
    rootFolderName: normalizeText(req.body?.rootFolderName),
    fileExtension: normalizeText(req.body?.fileExtension),
    documentDate: normalizeText(req.body?.documentDate),
    voucherNumber: normalizeText(req.body?.voucherNumber),
    category: normalizeText(req.body?.category),
    documentType: normalizeText(req.body?.documentType),
    notes: normalizeText(req.body?.notes),
    sourceArea: normalizeText(req.body?.sourceArea),
  };

  if (!payload.originalName || !payload.absolutePath || !payload.rootFolderId) {
    return sendError(
      res,
      new AppError(
        'originalName, absolutePath y rootFolderId son requeridos',
        400,
        'MISSING_DOCUMENT_FIELDS',
      ),
    );
  }

  try {
    const document = await createDocument(payload, req.user.id);
    return sendSuccess(res, { message: 'Documento creado', document }, 201);
  } catch (error) {
    console.error('Create document error:', error.message);
    return sendError(res, error, 'Error creando documento');
  }
});

router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    await updateDocument(id, req.body || {}, req.user.id);
    return sendSuccess(res, { message: 'Documento actualizado' });
  } catch (error) {
    console.error('Update document error:', error.message);
    return sendError(res, error, 'Error actualizando documento');
  }
});

router.get('/:id/history', verifyToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const history = await getDocumentHistory(id);
    return res.json(history);
  } catch (error) {
    console.error('Get history error:', error.message);
    return sendError(res, error, 'Error obteniendo historial');
  }
});

router.post('/:id/open', verifyToken, async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const doc = await getDocumentById(id);

    if (!doc) {
      return sendError(
        res,
        new AppError('Documento no encontrado', 404, 'DOCUMENT_NOT_FOUND'),
      );
    }

    if (!doc.absolute_path) {
      return sendError(
        res,
        new AppError(
          'El documento no tiene ruta absoluta registrada',
          400,
          'MISSING_ABSOLUTE_PATH',
        ),
      );
    }

    if (!fs.existsSync(doc.absolute_path)) {
      await markDocumentMissing(id, req.user.id);
      return sendError(
        res,
        new AppError('Archivo no encontrado en disco', 404, 'FILE_NOT_FOUND'),
      );
    }

    const openResult = await openFileWithSystem(doc.absolute_path);
    await addDocumentHistoryEntry(id, 'opened', req.user.id);

    return sendSuccess(res, {
      message: 'Archivo abierto con la aplicación predeterminada',
      path: doc.absolute_path,
      method: openResult.method,
    });
  } catch (error) {
    console.error('Open document error:', error.message);
    return sendError(res, error, 'Error abriendo documento');
  }
});

module.exports = router;
