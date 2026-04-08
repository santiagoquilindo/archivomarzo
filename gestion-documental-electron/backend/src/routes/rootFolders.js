const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const {
  getAllRootFolders,
  createRootFolder,
  updateRootFolder,
  deleteRootFolder,
} = require('../services/rootFolderService');
const {
  AppError,
  normalizeText,
  parseId,
  sendError,
  sendSuccess,
} = require('../utils/http');

const router = express.Router();

router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const folders = await getAllRootFolders();
    return res.json(folders);
  } catch (error) {
    console.error('Get root folders error:', error.message);
    return sendError(res, error, 'Error obteniendo carpetas raíz');
  }
});

router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  const name = normalizeText(req.body?.name);
  const absolutePath = normalizeText(req.body?.absolutePath);

  if (!name || !absolutePath) {
    return sendError(
      res,
      new AppError(
        'Nombre y ruta absoluta son requeridos',
        400,
        'MISSING_ROOT_FOLDER_FIELDS',
      ),
    );
  }

  try {
    const folder = await createRootFolder(name, absolutePath);
    return sendSuccess(
      res,
      { message: 'Carpeta raíz creada', folder },
      201,
    );
  } catch (error) {
    console.error('Create root folder error:', error.message);
    return sendError(res, error, 'Error creando carpeta raíz');
  }
});

router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const name = normalizeText(req.body?.name);
    const absolutePath = normalizeText(req.body?.absolutePath);
    const isActive = req.body?.isActive;

    if (!name || !absolutePath) {
      return sendError(
        res,
        new AppError(
          'Nombre y ruta absoluta son requeridos',
          400,
          'MISSING_ROOT_FOLDER_FIELDS',
        ),
      );
    }

    if (typeof isActive !== 'boolean') {
      return sendError(
        res,
        new AppError('isActive debe ser booleano', 400, 'INVALID_IS_ACTIVE'),
      );
    }

    const result = await updateRootFolder(id, name, absolutePath, isActive);

    if (!result.changes) {
      return sendError(
        res,
        new AppError('Carpeta raíz no encontrada', 404, 'ROOT_FOLDER_NOT_FOUND'),
      );
    }

    return sendSuccess(res, { message: 'Carpeta raíz actualizada' });
  } catch (error) {
    console.error('Update root folder error:', error.message);
    return sendError(res, error, 'Error actualizando carpeta raíz');
  }
});

router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const result = await deleteRootFolder(id);

    if (!result.changes) {
      return sendError(
        res,
        new AppError('Carpeta raíz no encontrada', 404, 'ROOT_FOLDER_NOT_FOUND'),
      );
    }

    return sendSuccess(res, { message: 'Carpeta raíz eliminada' });
  } catch (error) {
    console.error('Delete root folder error:', error.message);
    return sendError(res, error, 'Error eliminando carpeta raíz');
  }
});

module.exports = router;
