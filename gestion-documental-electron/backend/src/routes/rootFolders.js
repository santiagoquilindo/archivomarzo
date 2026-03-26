const express = require('express');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { getAllRootFolders, createRootFolder, updateRootFolder, deleteRootFolder } = require('../services/rootFolderService');

const router = express.Router();

router.get('/', verifyToken, requireRole('admin'), async (req, res) => {
  console.log('GET /api/root-folders', { user: req.user });
  try {
    const folders = await getAllRootFolders();
    res.json(folders);
  } catch (error) {
    console.error('Get root folders error:', error);
    res.status(500).json({ message: 'Error obteniendo carpetas raíz' });
  }
});

router.post('/', verifyToken, requireRole('admin'), async (req, res) => {
  const { name, absolutePath } = req.body;
  if (!name || !absolutePath) {
    return res.status(400).json({ message: 'Nombre y ruta absoluta son requeridos' });
  }
  try {
    const folder = await createRootFolder(name, absolutePath);
    res.status(201).json(folder);
  } catch (error) {
    console.error('Create root folder error:', error);
    res.status(500).json({ message: 'Error creando carpeta raíz' });
  }
});

router.put('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, absolutePath, isActive } = req.body;
  if (!name || !absolutePath) {
    return res.status(400).json({ message: 'Nombre y ruta absoluta son requeridos' });
  }
  try {
    await updateRootFolder(id, name, absolutePath, isActive);
    res.json({ message: 'Carpeta raíz actualizada' });
  } catch (error) {
    console.error('Update root folder error:', error);
    res.status(500).json({ message: 'Error actualizando carpeta raíz' });
  }
});

router.delete('/:id', verifyToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    await deleteRootFolder(id);
    res.json({ message: 'Carpeta raíz eliminada' });
  } catch (error) {
    console.error('Delete root folder error:', error);
    res.status(500).json({ message: 'Error eliminando carpeta raíz' });
  }
});

module.exports = router;