const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { getDocuments, getDocumentById, createDocument, updateDocument, getDocumentHistory, markDocumentMissing } = require('../services/documentService');
const fs = require('fs');
const { spawn } = require('child_process');

const router = express.Router();

async function openFileWithSystem(absolutePath) {
  let electronShellAvailable = false;

  try {
    const electron = require('electron');
    if (electron?.shell?.openPath) {
      electronShellAvailable = true;
      console.log(`[OPEN_DOC] Metodo de apertura: electron.shell.openPath`);
      const result = await electron.shell.openPath(absolutePath);
      console.log(`[OPEN_DOC] Resultado: ${result || '[empty string]'}`);
      if (result) {
        throw new Error(result);
      }
      return { method: 'electron.shell.openPath', result };
    }
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      console.error(`[OPEN_DOC] Error: ${error.message}`);
      throw error;
    }
  }

  console.log(`[OPEN_DOC] electron.shell disponible: ${electronShellAvailable}`);
  console.log(`[OPEN_DOC] Metodo de apertura: powershell Start-Process`);

  const escapedForPowerShell = absolutePath.replace(/'/g, "''");
  const powerShellCommand = `Start-Process -LiteralPath '${escapedForPowerShell}'`;
  console.log(`[OPEN_DOC] Comando PowerShell: ${powerShellCommand}`);

  const powerShellExitCode = await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', powerShellCommand], {
      windowsHide: true,
      stdio: 'ignore',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code);
    });
  });

  console.log(`[OPEN_DOC] Resultado: Start-Process exitCode=${powerShellExitCode}`);

  if (powerShellExitCode === 0) {
    return { method: 'powershell Start-Process', result: `exitCode=${powerShellExitCode}` };
  }

  console.log(`[OPEN_DOC] Fallback adicional: cmd /c start`);

  const command = `start "" "${absolutePath.replace(/"/g, '""')}"`;
  console.log(`[OPEN_DOC] Comando Windows: ${command}`);

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

  console.log(`[OPEN_DOC] Resultado: cmd start exitCode=${cmdExitCode}`);

  if (cmdExitCode !== 0) {
    throw new Error(`Start-Process devolvio ${powerShellExitCode} y cmd start devolvio ${cmdExitCode}`);
  }

  return { method: 'cmd /c start', result: `exitCode=${cmdExitCode}` };
}

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
  console.log(`[OPEN_DOC] Documento solicitado id=${id}`);

  try {
    const doc = await getDocumentById(id);
    if (!doc) {
      console.log(`[OPEN_DOC] Documento no encontrado id=${id}`);
      return res.status(404).json({ success: false, message: 'Documento no encontrado', error: 'DOCUMENT_NOT_FOUND' });
    }

    console.log(`[OPEN_DOC] absolute_path encontrado: ${doc.absolute_path || '[null]'}`);

    if (!doc.absolute_path) {
      return res.status(400).json({
        success: false,
        message: 'El documento no tiene ruta absoluta registrada',
        error: 'MISSING_ABSOLUTE_PATH',
      });
    }

    const exists = fs.existsSync(doc.absolute_path);
    console.log(`[OPEN_DOC] Existe en disco: ${exists}`);

    if (!exists) {
      await markDocumentMissing(id, req.user.id);
      return res.status(404).json({
        success: false,
        message: 'Archivo no encontrado en disco',
        error: 'FILE_NOT_FOUND',
      });
    }

    try {
      const openResult = await openFileWithSystem(doc.absolute_path);

      const performedAt = new Date().toISOString();
      require('../db/db').db.run(
        'INSERT INTO document_history (document_id, action, performed_by, performed_at) VALUES (?, ?, ?, ?)',
        [id, 'opened', req.user.id, performedAt],
        (err) => err && console.error('History open error:', err)
      );

      res.json({
        success: true,
        message: 'Archivo abierto con la aplicacion predeterminada',
        path: doc.absolute_path,
        method: openResult.method,
      });
    } catch (openError) {
      console.error(`[OPEN_DOC] Error: ${openError.stack || openError.message}`);
      res.status(500).json({
        success: false,
        message: `No se pudo abrir el archivo: ${openError.message}`,
        error: openError.message,
      });
    }
  } catch (error) {
    console.error(`[OPEN_DOC] Error: ${error.stack || error.message}`);
    res.status(500).json({
      success: false,
      message: `Error abriendo documento: ${error.message}`,
      error: error.message,
    });
  }
});

module.exports = router;
